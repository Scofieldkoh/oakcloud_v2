# Staging & Deployment Guide

> Self-hosted Docker setup for continuous development without disrupting live users.

## Overview

This project runs two environments:

| Environment | Purpose | Branch |
|---|---|---|
| **Production** | Live users, stable only | `main` |
| **Staging** | Your review before going live | any feature branch |

---

## One-Time Setup: Staging Server

On the second device:

### 1. Install Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine + Docker Compose

### 2. Clone the Repository

```bash
git clone https://github.com/<your-org>/oakcloud.git
cd oakcloud
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with staging values (can point to same DB or a separate staging DB)
```

> **Tip:** If you want true isolation, set up a separate database for staging. If you just want to preview UI/logic changes, pointing to the same DB is fine initially.

### 4. Start the Stack

```bash
docker compose up --build -d
```

Access staging at `http://<staging-device-ip>:<port>` (or set up a subdomain like `staging.yourdomain.com` via your router/DNS).

---

## Daily Development Workflow

### Never commit directly to `main`.

```
1. Create a feature branch
   git checkout -b feat/my-change

2. Make changes, commit as you go
   git add .
   git commit -m "description of change"

3. Push branch to GitHub
   git push origin feat/my-change

4. Pull onto staging server to review
   ssh into staging device
   cd oakcloud
   git fetch && git checkout feat/my-change
   docker compose up --build -d

5. Review at staging URL

6. When satisfied, merge to main (via PR on GitHub)

7. Deploy to production
   ssh into production server
   cd oakcloud
   git pull origin main
   docker compose up --build -d
```

---

## Deploying to Production (Minimising Downtime)

### Node 24 Runtime Verification

Build and restart the staging app before production deployment:

```bash
docker compose build --pull app
docker compose up -d --no-deps app
docker compose exec -T app node --version
docker compose exec -T app sh -lc 'test -x "$CHROME_PATH" && "$CHROME_PATH" --version'
docker compose exec -T app npm run test:chromium
```

Production deployment requires a successful staging image build and runtime
verification. This migration does not require a database migration. Node 24's
stricter TLS behaviour also requires real staging smoke tests for email,
Microsoft Graph/SharePoint, HTTPS S3, and every AI provider enabled in
production. Keep the previous source commit and application image recoverable
until post-deployment checks pass.

### Release blocker: modular-task migration history

Before deploying the modular Tasks/Pipelines release, inspect the deployed
`_prisma_migrations` row and physical schema for
`20260724090000_modular_tasks_reset`. Do not deploy while its checksum state is
unknown.

- If the reset migration was never applied, deploy normally in timestamp order.
- If its stored checksum matches the restored repository migration and the
  schema still has `BLOCKED` without the lock columns/triggers, the forward
  `20260727030000_task_snapshot_guards` migration is the expected next step.
- If the database already has `WAITING`, `published_at`, `snapshot_locked_at`,
  or the guard triggers under the reset migration's history, a DBA must compare
  the stored checksum and physical objects, back up the database, and reconcile
  migration history before deployment. Use `prisma migrate resolve` only after
  that state is documented and confirmed; never edit `_prisma_migrations`
  directly.

Use this sequence to reduce the gap between old and new container:

```bash
docker compose build
docker compose up -d
```

- `build` prepares the new image while the old container is still running
- `up -d` swaps to the new container (typically a few seconds of downtime)

This is acceptable for a small self-hosted app. True zero-downtime requires a reverse proxy (e.g. Nginx + blue-green) and can be added later if needed.

---

## Branch Protection (GitHub)

To prevent accidental direct pushes to `main`:

1. Go to your GitHub repo → **Settings → Branches**
2. Add a branch protection rule for `main`
3. Enable: **Require a pull request before merging**

This ensures every change to production goes through a PR and can be reviewed first.

---

## Summary Cheatsheet

```
# Start new work
git checkout -b feat/my-feature

# Push for staging review
git push origin feat/my-feature
# → SSH into staging, git fetch + checkout + docker compose up --build -d

# Ship to production
# → Merge PR on GitHub
# → SSH into production, git pull origin main + docker compose up -d
```
