# Getting Started

> **Last Updated**: 2026-09-05
> **Audience**: Developers

This guide walks you through setting up Oakcloud for local development.

## Related Documents

- [Architecture](./ARCHITECTURE.md) - System design and runtime layout
- [Environment Variables](./reference/ENVIRONMENT_VARIABLES.md) - Configuration options

## Prerequisites

- Node.js 24.x
- Docker Desktop or Docker Engine with Compose support
- npm

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env

# 3. Start PostgreSQL + MinIO
npm run docker:db:up

# 4. Generate Prisma client and initialize the database
npm run db:generate
npm run db:push
npm run db:seed

# 5. Start the local Next.js dev server
npm run dev
```

If you are using the bundled MinIO service from `oakcloud_db.yml`, update your local `.env` after copying it so the S3 settings match that stack before starting the app:

```env
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="oakcloud"
S3_SECRET_KEY="Preparefortrouble!"
S3_BUCKET="oakcloud"
```

**Access**

- Frontend: `http://localhost:3000`
- Prisma Studio: `npm run db:studio`
- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`

**Default Login**

- Super Admin: `admin@oaktreesolutions.com.sg` / `Preparefortrouble!`

## Local Data Services

`npm run docker:db:up` starts the local data stack from [`oakcloud_db.yml`](../oakcloud_db.yml):

| Service | Port | Description |
|---------|------|-------------|
| PostgreSQL | `5433` | Primary development database |
| MinIO S3 API | `9000` | Object storage API |
| MinIO Console | `9001` | Object storage UI |

**MinIO Console Credentials**

- Username: `oakcloud`
- Password: `Preparefortrouble!`

To stop the data stack:

```bash
npm run docker:db:down
```

## Optional Containerized App Stack

`npm run docker:up` starts the containerized app stack from [`docker-compose.yml`](../docker-compose.yml):

| Service | Port | Description |
|---------|------|-------------|
| App | `3000` | Next.js app in Docker |
| Redis | `6379` | Optional cache / support service |
| Cloudflared | - | Optional tunnel container |

Use this when you want the app itself running in Docker. Do not run it alongside `npm run dev` unless you intentionally want the Dockerized app bound to port `3000`.

To stop it:

```bash
npm run docker:down
```

## Environment Notes

- `DATABASE_URL` should point at `localhost:5433` when you use the bundled PostgreSQL container.
- `S3_ENDPOINT` should point at `http://localhost:9000` when you use the bundled MinIO container.
- `MAX_FILE_SIZE` applies to document uploads and public form uploads.
- Email configuration is optional in development, but required for password reset emails, form draft emails, and public form PDF email delivery.
- Background E-signing preparation, expiry checks and reminders all run from the master `SCHEDULER_ENABLED=true` switch alone (no per-task `*_ENABLED` variable). Preparation provides lease recovery and durable fallback processing; immediate lifecycle triggers still reduce normal wait time. Without `SCHEDULER_ENABLED=true`, envelopes never expire and no reminders are sent. See `docs/reference/ENVIRONMENT_VARIABLES.md` for every `SCHEDULER_*` variable.
- `SCHEDULER_ESIGNING_PREPARATION_CRON` overrides the default one-minute schedule.
- `ESIGNING_PREPARATION_BATCH_SIZE` (default `10`, maximum `100`) and `ESIGNING_PREPARATION_CONCURRENCY` (default `2`, maximum `20`) bound each worker run. `ESIGNING_PREPARATION_LEASE_MS` controls abandoned-claim recovery (default `300000`, maximum `3600000`).

## Database Commands

| Command | Description |
|---------|-------------|
| `npm run db:generate` | Generate Prisma client and deterministically normalize generated TypeScript whitespace |
| `npm run db:push` | Push schema to the database |
| `npm run db:migrate` | Create and run a development migration |
| `npm run db:seed` | Bootstrap the default workspace and required system foundations |
| `npm run db:studio` | Open Prisma Studio |

The seed script is idempotent and can be run multiple times safely. On an empty
database it creates an active `Oakcloud` workspace with the Services workspace
and deadline/billing materialization enabled. For every non-deleted workspace it
ensures system roles, default custom roles, the Singapore business calendar,
starter deadline-rule drafts, active Client Onboarding document templates, and
the published Client Onboarding task pipeline.

The seed deliberately does not create companies, tasks, client services,
billing occurrences, deadline occurrences, uploads, or other business records.
Existing workspace status and settings are preserved. Service catalog entries
remain subject to administrator review and activation.

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the local dev server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run the TypeScript compiler without emitting files |
| `npm run test:run` | Run the test suite once |
| `npm run test:esigning` | Run only the e-signing unit tests (no database) |
| `npm run test:esigning:postgres` | E-signing completion worker concurrency suite (needs `TEST_DATABASE_URL`) |
| `npm run test:stage3:postgres` | Service agreement activation suite (needs `TEST_DATABASE_URL`) |
| `npm run test:business-assistant:postgres` | Business Assistant and BizFile suites (needs a separate database, see below) |
| `npm run test:chromium` | Verify Chromium PDF generation and PDF-to-PNG rasterisation |
| `npm run test:coverage` | Run tests with coverage |

`npm run test:chromium` requires an installed Chrome/Chromium executable. Set
`CHROME_PATH` when the executable is not in one of Oakcloud's standard paths.

### PostgreSQL test suites

Every `*.postgres.test.ts` suite starts with `// @vitest-environment node`, because the default Vitest environment is jsdom and the Prisma client cannot load there. Keep that line when adding a Postgres suite.

Most Postgres suites (`test:esigning:postgres`, `test:stage3:postgres`, `test:client-services:postgres`, `test:deadlines:postgres`, `test:billing:postgres`) read `TEST_DATABASE_URL` and skip when it is unset. Point it at a disposable database whose name contains `test`, migrated with `prisma migrate deploy`:

```bash
export TEST_DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:5432/oakcloud_test
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
npm run test:esigning:postgres
```

Run the plain unit suites (`npm run test:run`, `npm run test:esigning`) without the application's `.env` loaded into the shell: a production `NODE_ENV` breaks the jsdom suites.

#### Business Assistant database (`test:business-assistant:postgres`)

This script needs its own PostgreSQL 16 database and will not run against `oakcloud_test`. `scripts/require-business-assistant-test-env.mjs` and the BizFile suites require all of the following:

- host `127.0.0.1`, port `55439`, database `business_assistant_test`, user `assistant_test`;
- `DATABASE_URL` and `BUSINESS_ASSISTANT_TEST_DATABASE_URL` set to the same URL.

Set it up with Docker (the same image and settings as CI):

```bash
docker run -d --name oakcloud-assistant-test -p 127.0.0.1:55439:5432 \
  -e POSTGRES_USER=assistant_test -e POSTGRES_PASSWORD=assistant-test-only \
  -e POSTGRES_DB=business_assistant_test postgres:16
```

Without Docker, run a second local cluster on that port:

```bash
export PATH=/usr/lib/postgresql/16/bin:$PATH
echo assistant-test-only > /tmp/pg55439.pw
initdb -D ~/pg55439 -U assistant_test --pwfile=/tmp/pg55439.pw --auth=scram-sha-256 -E UTF8
pg_ctl -D ~/pg55439 -o "-p 55439 -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" -l ~/pg55439.log -w start
PGPASSWORD=assistant-test-only createdb -h 127.0.0.1 -p 55439 -U assistant_test business_assistant_test
```

Then migrate and run the suites. The password above is for a throwaway local database only:

```bash
export DATABASE_URL=postgresql://assistant_test:assistant-test-only@127.0.0.1:55439/business_assistant_test
export BUSINESS_ASSISTANT_TEST_DATABASE_URL="$DATABASE_URL"
npx prisma migrate deploy
npm run test:business-assistant:postgres
```

Never point either variable at the application database; the guard script rejects ports `5433` and `3000` and a database named `oakcloud`.

### Continuous integration

GitHub Actions runs two workflows. It does not run the full test suite, so run `npm run test:run` locally before opening a PR.

- `node24-compatibility.yml` runs on every PR and every push to `main`. It covers lint, typecheck, selected test suites (including `npm run test:esigning`, all e-signing unit tests), the production Next build, the e-signing PostgreSQL suite (`test:esigning:postgres`, in the `esigning-postgres` job on a disposable `postgres:16` service), and the Business Assistant, BizFile and document-generation PostgreSQL suites on a separate disposable database.
- `production-image.yml` builds and smoke-tests the Docker image on every push to `main`. On PRs it runs only when the Dockerfile, package files, Next config, Prisma or the Chromium helpers change.

Each suite runs once per workflow. When adding a suite to CI, list its file explicitly rather than a directory filter; `vitest run <path>` matches every test file whose path contains that text.

## Common Issues

### Port `3000` already in use

You probably have the containerized app stack running. Stop it with:

```bash
npm run docker:down
```

### Port `5433` already in use

Another PostgreSQL instance is bound to that port.

```bash
npm run docker:db:down
```

Then either free the port or point `DATABASE_URL` at a different database instance.

### Storage or upload errors

1. Confirm MinIO is running on `http://localhost:9000`.
2. Confirm your local `.env` matches the MinIO credentials used by `oakcloud_db.yml`.
3. Check `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `S3_BUCKET`.

### Prisma client or schema mismatch

Regenerate the client and re-push the schema:

```bash
npm run db:generate
npm run db:push
```

## Moving Oakcloud To Another Machine

1. On the old machine, open Administration > Backup > Full backups, set a backup password (keep it in your password manager), click Back up now, and download the `.oakbackup` file when it completes. Also copy your `.env` file.
2. On the new machine, clone the repository, put the `.env` in place (a new `ENCRYPTION_KEY` also works; connectors are re-locked during the restore), start the stack, then run `docker compose exec app npx prisma migrate deploy` and `docker compose exec app npx tsx prisma/seed.ts` so you can sign in with the default admin.
3. Open Administration > Backup > Full backups, click Upload backup file, then Restore. Enter the backup password, read the check, and type `RESTORE`.
4. When the restore finishes, sign in with your own account from the backup and run `docker compose restart app`. Backups leave out the ACRA register, so open Administration > ACRA Records and click Sync now to download it again.

If the old machine copied its backups to SharePoint (Full backups > SharePoint copy), step 1 is not needed: on the new machine add the SharePoint connector on the Connectors page, choose the same folder under SharePoint copy, click Restore from SharePoint, Copy here, then Restore on the copied backup.

To put back only part of a backup (for example Companies after a bad import), click Restore on the backup, check it with the password, choose **Choose modules**, tick the modules and click Preview changes. The preview shows what is added back, replaced and removed, and asks you to add a module when restoring without it would leave records pointing at nothing.

The new machine must run the same or a newer version of Oakcloud than the one that made the backup.

## Next Steps

1. Create or select a tenant.
2. Create users and companies.
3. Explore the Forms module at `/forms`.
4. Review the seeded Client Onboarding template or create a versioned template at `/pipelines`.
5. Create and run tenant-scoped work at `/tasks`; Company, owner, due date, and stage assignee are optional.
6. Explore document generation, document processing, E-signing, Forms, and exchange rates.
