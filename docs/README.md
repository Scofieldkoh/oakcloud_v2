# Oakcloud - Practice Management System

> **Last Updated**: 2026-09-29

Oakcloud is a modular practice management system for accounting firms. It is local-first, multi-tenant, and includes versioned Tasks and Pipelines alongside the Company, Document Generation, E-signing, and Forms modules.

## Documentation

Start with [Documentation Index](./INDEX.md) for the current docs map.

### Quick Links

- [Getting Started](./GETTING_STARTED.md) - Local setup and first run
- [Architecture](./ARCHITECTURE.md) - Runtime design, modules, and service layout
- [TODO / Roadmap](./TODO.md) - Known issues and planned work

### Guides

- [RBAC Guideline](./guides/RBAC_GUIDELINE.md) - Roles, permissions, multi-tenancy
- [Design Guideline](./guides/DESIGN_GUIDELINE.md) - UI components and styling
- [Keyboard Shortcuts](./guides/KEYBOARD_SHORTCUTS.md) - Shared shortcut patterns
- [Service Patterns](./guides/SERVICE_PATTERNS.md) - Service-layer conventions
- [Audit Logging](./guides/AUDIT_LOGGING.md) - Activity tracking

### Reference

- [Database Schema](./reference/DATABASE_SCHEMA.md) - Tables, relationships, indexes, enums
- [API Reference](./reference/API_REFERENCE.md) - Authenticated and public API routes
- [Environment Variables](./reference/ENVIRONMENT_VARIABLES.md) - Runtime configuration

### Feature And Rollout Docs

- [Business Assistant Specification](./features/business-assistant/SPECIFICATION.md) - General assistant architecture; BizFile is the reference integration, with [implementation handover](./plans/2026-09-05-business-assistant-implementation.md) and [BizFile correction workflow](./features/business-assistant/CORRECTION_WORKFLOW.md)
- [Forms Improvements](./plans/2026-03-04-forms-improvements.md) - Main Forms rollout plan
- [Form Submission PDF Redesign](./plans/2026-03-09-form-submission-pdf-redesign.md) - Public and internal response PDF export
- [Resume Draft UI Implementation](./plans/2026-03-09-resume-draft-ui-implementation.md) - Draft save and resume flow
- [Forms Implementation Review](./plans/2026-03-10-forms-implementation-review.md) - Post-implementation review and hardening notes

## Overview

Oakcloud is built around a few core principles:

- **Modular**: Business capabilities are split into focused modules and services
- **Local-first**: Your data stays on your infrastructure
- **Multi-tenant**: Tenant scoping is enforced across app, API, and data layers
- **Operational**: The app includes document workflows, forms, AI-assisted processing, and auditability

## Implemented Modules

| Module | Description |
|--------|-------------|
| Company Management | Companies, BizFile uploads, compliance tracking |
| Contact Management | Individual and corporate contacts |
| Authentication | JWT-based auth with tenant-aware sessions |
| Multi-Tenancy | Tenant isolation with limits and SUPER_ADMIN scoping |
| Audit Logging | Activity tracking with reasons and change sources |
| RBAC And Permissions | Fine-grained access control |
| User Management | Accounts, invitations, assignments |
| Password Management | Reset flow and forced password changes |
| Data Purge | Recycle Bin for SUPER_ADMIN: restore or permanently delete users, companies, contacts, documents, templates and partials |
| Backup And Restore | Password-locked full backups of the whole install (all workspaces, tables and stored files) to download, schedule and restore on another machine; older per-workspace backups remain listed |
| Email Notifications | Graph API or SMTP delivery |
| Connectors Hub | External service integrations |
| Document Generation | Templates with explicit director, shareholder, and contact selection; letter-format address placeholders; PDF export, sharing, and comments |
| Document Vault | AI-powered ingestion, extraction, revisions |
| Forms | Builder, public links, drafts, uploads, PDF export, response review, AI review |
| Exchange Rates | MAS API integration and manual overrides |
| Chart Of Accounts | Hierarchical accounts and external mapping |
| Tasks | Tenant-scoped work tracked through Company-first desktop tables, responsive mobile cards, and stage detail modals |
| Pipelines | Reusable, versioned stage templates; published versions are immutable and edits affect future tasks only |
| Services | Tenant-wide operational service roster backed by a reviewed service catalog |
| Deadlines | Rule-driven service deadlines with calendar and table workflows |
| Billing | Scheduled billing occurrences, coverage checks, and billing status workflows |
| E-signing | Envelope preparation, delivery, signer lifecycle, and certificate-backed completion |

On an empty database, the seed creates an active `Oakcloud` workspace with the operational Services workspace and deadline/billing materialization enabled. For every non-deleted workspace it ensures RBAC roles, the Singapore business calendar, starter deadline-rule drafts, active `DR_Appointment of Corp Sec` Resolution and `Oaktree Master Services Agreement` Contract templates, and a published **Client Onboarding** pipeline with Company Profile, Generate Resolution, Generate Contract, and E-signing stages. Existing workspace status and settings are preserved.

The seed does not create companies, tasks, client services, billing or deadline occurrences, uploads, or other business records. Service catalog entries remain subject to administrator review and activation. Use `npm run db:seed -- --client-onboarding-only` to apply only the controlled template and pipeline changes.

## Planned Modules

| Module | Description |
|--------|-------------|
| Bank Reconciliation | Transaction matching and multi-currency support |
| Client Portal | Client access and document requests |
| Accounting Integration | Xero, QuickBooks, MYOB connectors |
| Module Marketplace | Browse and install modules |
| SuperAdmin Dashboard | System administration workflows |

## Local Development Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env

# 3. Set local credentials and secrets in .env
#    Do not commit real credentials.

# 4. Start PostgreSQL + MinIO
npm run docker:db:up

# 5. Generate client, push schema, and seed
npm run db:generate
npm run db:push
npm run db:seed

# 6. Start the local Next.js dev server
npm run dev
```

For the bundled MinIO stack from `oakcloud_db.yml`, keep the endpoint and bucket configuration in your local `.env` and set your own access credentials:

```env
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="<local-minio-access-key>"
S3_SECRET_KEY="<local-minio-secret-key>"
S3_BUCKET="oakcloud"
```

Use `.env.example` as the configuration template. Keep real passwords, API keys, signing secrets, and storage credentials only in local/deployment secret storage; do not commit them to repository documentation.

**Access**

- Frontend: `http://localhost:3000`
- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`

**Application Login**

The README intentionally does not publish application credentials. Use the credentials configured or provisioned for your local development environment. If credentials need to be shared across a team, store them in the approved password/secret manager rather than in Git-tracked files.

**Local MinIO Console Login**

Use the `S3_ACCESS_KEY` and `S3_SECRET_KEY` values from your local `.env`. Do not place working MinIO credentials in this README.

`npm run docker:up` starts the containerized app stack from `docker-compose.yml` and is optional for local development. Do not run it at the same time as `npm run dev` unless you intentionally want the app running in Docker on port `3000`.

## Tech Stack

| Layer | Technologies |
|-------|--------------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| State | Zustand, TanStack Query, React Hook Form |
| Backend | Node.js 24 LTS, PostgreSQL 16, Prisma 7 |
| Auth | JWT (`jose`), Argon2id (`@noble/hashes`) |
| AI | OpenAI, Anthropic, Google AI, OpenRouter |
| Storage | MinIO / S3-compatible object storage |
| Documents | OakDoc (Word editor via `@docx-editor.dev/react`), Microsoft Graph Word-to-PDF, pdf-lib, Puppeteer |
| Infra | Docker Compose, optional Redis, in-process scheduler |

Current package version: `0.1.0` (from [`package.json`](../package.json)).
