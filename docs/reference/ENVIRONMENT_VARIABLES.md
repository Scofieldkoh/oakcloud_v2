# Environment Variables

> **Last Updated**: 2026-03-11
> **Audience**: Developers, administrators

Configuration options for Oakcloud.

## Related Documents

- [Getting Started](../GETTING_STARTED.md) - Local setup and first run
- [Architecture](../ARCHITECTURE.md) - Runtime design overview

## Quick Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT signing |
| `ENCRYPTION_KEY` | Yes | 32+ character key for application encryption |
| `DEFAULT_AI_MODEL` | No | Default model used by AI-backed features |
| `FORM_RESPONSE_TOKEN_SECRET` | No | Secret for signed public form PDF tokens; falls back to `JWT_SECRET` if omitted |

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | PostgreSQL connection string |
| `TEST_DATABASE_URL` | - | Dedicated disposable PostgreSQL database for destructive integration tests; required by Stage 3 tests in CI |
| `DATABASE_SSL` | `true` in production | Enable SSL for database connections unless explicitly disabled |

Example:

```env
DATABASE_URL="postgresql://oakcloud:oakcloud_password@localhost:5433/oakcloud?schema=public"
TEST_DATABASE_URL="postgresql://oakcloud:oakcloud_password@localhost:5433/oakcloud_stage3_test?schema=public"
```

`TEST_DATABASE_URL` must never reuse the development or production database.
`npm run test:stage3:postgres` creates and deletes tenant-scoped fixtures and
fails in CI when the variable is absent.

## Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | - | Secret used for JWT signing |
| `JWT_EXPIRES_IN` | `7d` | Auth token lifetime |

Use a long random value for `JWT_SECRET`.

## AI Providers

These variables power AI-backed document processing, AI Helpbot flows, and Forms AI review / translation / context assist.
`MISTRAL_API_KEY` is used specifically for OCR-driven BizFile extraction and document field extraction.

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_AI_API_KEY` | Google AI / Gemini API key |
| `MISTRAL_API_KEY` | Mistral OCR API key for BizFile and document OCR extraction |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_SITE_URL` | Referrer sent to OpenRouter |
| `OPENROUTER_APP_NAME` | App title sent to OpenRouter |
| `DEFAULT_AI_MODEL` | Default AI model ID |

Common configured model IDs in the codebase include:

- `gpt-5.2`
- `gpt-4.1`
- `claude-opus-4.5`
- `claude-sonnet-4.5`
- `gemini-3.1`
- `gemini-3-flash`

## Application

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_APP_URL` | `https://service.oakcloud.app` | Public application base URL |
| `EMAIL_APP_URL` | `NEXT_PUBLIC_APP_URL` when omitted | Override base URL used inside email templates |
| `NODE_ENV` | `development` | Runtime mode |
| `MAX_FILE_SIZE` | `10485760` | Max upload size in bytes for standard document and public form uploads |
| `LOG_LEVEL` | `debug` in dev, `info` in prod | Logger verbosity |

## Public Forms

These variables control public form PDF token signing and download/email token lifetimes.

| Variable | Default | Description |
|----------|---------|-------------|
| `FORM_RESPONSE_TOKEN_SECRET` | Falls back to `SHARE_VERIFICATION_SECRET`, then `JWT_SECRET` | Secret for signed public form PDF tokens |
| `FORM_RESPONSE_SUBMIT_DOWNLOAD_TOKEN_TTL_SECONDS` | `1800` | Initial PDF download token lifetime after public submission |
| `FORM_RESPONSE_SUBMIT_EMAIL_REQUEST_TOKEN_TTL_SECONDS` | `1800` | Lifetime of the token that authorizes requesting a PDF email after submission |
| `FORM_RESPONSE_EMAIL_LINK_TOKEN_TTL_SECONDS` | `604800` | Lifetime of the download token embedded in the emailed PDF link |

Notes:

- In production, `FORM_RESPONSE_TOKEN_SECRET` (or a secure fallback secret) must be at least 32 characters.
- Public form draft resume uses per-draft access tokens stored in the database and does not use these env vars.

## ACRA Company Name Check (data.gov.sg)

The form builder's "Company name check" element searches a locally maintained
mirror of the data.gov.sg
[ACRA Information on Corporate Entities](https://data.gov.sg/collections/2/view)
collection to find similar ACRA-registered business names. The mirror (`acra_entity`
table) is kept current by the daily ACRA entity sync task, which compares the
collection's last-updated time against the stored value and re-imports all 27
CSV datasets when they differ. The collection is refreshed monthly by ACRA, so
check results note the collection's last-updated time ("Based on ACRA registry
data as of ..."). The check is DB-only (no live API fallback) and reports
itself unavailable until the first sync has populated the table.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATAGOV_METADATA_URL` | `https://api-production.data.gov.sg/v2/public/api/collections/2/metadata` | Metadata endpoint used to determine the collection's last-updated time ("data as of") |
| `DATAGOV_API_KEY` | - | Optional data.gov.sg API key sent via the `x-api-key` header; raises the download rate limit used by the sync task |
| `SCHEDULER_ACRA_SYNC_ENABLED` | `false` | Enables the daily ACRA entity sync task |
| `SCHEDULER_ACRA_SYNC_CRON` | `0 3 * * *` | When the daily sync runs (default: 3 AM SGT) |
| `ACRA_SYNC_SLEEP_MS` | - | Optional fixed request-spacing override in ms (e.g. `0` for faster one-off backfills via `scripts/run-acra-sync.ts`) |

### Singapore Public Holidays (MOM via data.gov.sg)

The daily public holiday sync reads MOM's
[Singapore Public Holidays (consolidated)](https://data.gov.sg/datasets/d_8ef23381f9417e4d4254ee8b4dcdb176/view)
dataset. It checks the dataset's last-updated time and downloads the small CSV
only when it changed (Administration > Services > Business Calendar > Check for
updates always downloads). The rows are stored in `public_holiday_source_records`,
and every active Singapore business calendar is then synchronized: official
holidays are added, renamed or archived (removals only inside the years the
dataset covers), manual holidays are never changed, and each changed calendar
gets a new revision, an audit entry and a `BUSINESS_CALENDAR_CHANGED`
reconciliation. Deadline calculation only reads the local calendars.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATAGOV_PUBLIC_HOLIDAY_DATASET_ID` | `d_8ef23381f9417e4d4254ee8b4dcdb176` | Optional override for the MOM public holiday dataset id |
| `SCHEDULER_PUBLIC_HOLIDAY_SYNC_ENABLED` | `false` | Enables the daily public holiday check (set `true` in `.env`) |
| `SCHEDULER_PUBLIC_HOLIDAY_SYNC_CRON` | `0 4 * * *` | When the daily check runs (default: 4 AM SGT) |

`DATAGOV_API_KEY` is sent with these requests too when it is set; the dataset is also available without a key.

## Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_PROVIDER` | `s3` | Storage backend (`s3` or `local`) |
| `STORAGE_LOCAL_PATH` | `./uploads` | Local storage path when `STORAGE_PROVIDER=local` |
| `S3_ENDPOINT` | - | S3 or MinIO endpoint |
| `S3_REGION` | `us-east-1` | Region |
| `S3_BUCKET` | - | Bucket name |
| `S3_ACCESS_KEY` | - | Access key |
| `S3_SECRET_KEY` | - | Secret key |
| `S3_FORCE_PATH_STYLE` | `true` | Required for MinIO and other path-style endpoints |
| `S3_USE_SSL` | `false` | Use HTTPS |
| `S3_ENCRYPTION` | `AES256` | Server-side encryption mode (`AES256`, `aws:kms`, `none`) |
| `S3_KMS_KEY_ID` | - | Required when `S3_ENCRYPTION=aws:kms` |

Bundled local MinIO setup (`oakcloud_db.yml`):

```env
S3_ENDPOINT="http://localhost:9000"
S3_BUCKET="oakcloud"
S3_ACCESS_KEY="oakcloud"
S3_SECRET_KEY="Preparefortrouble!"
S3_FORCE_PATH_STYLE="true"
S3_USE_SSL="false"
```

## Email

Email is used for password reset, invitations, draft resume emails, and public form PDF delivery.

### Microsoft Graph

| Variable | Description |
|----------|-------------|
| `AZURE_TENANT_ID` | Azure tenant ID |
| `AZURE_CLIENT_ID` | App registration client ID |
| `AZURE_CLIENT_SECRET` | App registration secret |
| `EMAIL_FROM_ADDRESS` | Sender email address |
| `EMAIL_FROM_NAME` | Sender display name |

### SMTP

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP hostname |
| `SMTP_PORT` | SMTP port |
| `SMTP_SECURE` | Use TLS (`true` / `false`) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASSWORD` | SMTP password |

## Encryption

| Variable | Default | Description |
|----------|---------|-------------|
| `ENCRYPTION_KEY` | - | 32+ character key used for encrypting sensitive application data |

Generate a value with:

```bash
openssl rand -hex 32
```

## Task Scheduler

The in-process scheduler is started by the app and can be configured per task.

| Variable | Default | Description |
|----------|---------|-------------|
| `SCHEDULER_ENABLED` | `true` | Master switch for the scheduler |
| `SCHEDULER_BACKUP_ENABLED` | `true` | Enable the scheduled full backup |
| `SCHEDULER_BACKUP_CRON` | `0,15,30,45 * * * *` | Backup polling cadence |
| `SCHEDULER_CLEANUP_ENABLED` | `true` | Enable cleanup processing |
| `SCHEDULER_CLEANUP_CRON` | `0 2 * * *` | Cleanup schedule |
| `SCHEDULER_ESIGNING_PDF_GENERATION_CRON` | `* * * * *` | E-signing completion recovery cadence; signed PDFs are generated on demand and this task inherits the master scheduler switch |
| `SCHEDULER_ESIGNING_SHAREPOINT_FILING_CRON` | `* * * * *` | Signed-document SharePoint filing cadence; task inherits the master scheduler switch |
| `SCHEDULER_ESIGNING_PREPARATION_CRON` | `* * * * *` | E-signing preparation queue cadence (lease recovery and durable fallback for task envelopes); task inherits the master scheduler switch |
| `SCHEDULER_ESIGNING_EXPIRY_CHECK_CRON` | `0 * * * *` | E-signing expiry check cadence (hourly). Envelopes past their deadline become `EXPIRED` and expiry emails go out only while this task runs; it inherits the master scheduler switch |
| `SCHEDULER_ESIGNING_REMINDERS_CRON` | `0 0 * * *` | E-signing reminder and expiry-warning cadence (daily at 00:00 in the server time zone); task inherits the master scheduler switch |
| `SCHEDULER_SERVICE_AGREEMENT_ACTIVATION_CRON` | `* * * * *` | Service Agreement activation retry polling cadence; task inherits the master scheduler switch |
| `SCHEDULER_SERVICE_SCHEDULE_RECONCILIATION_CRON` | `* * * * *` | Service cycle and deadline reconciliation cadence; task inherits the master scheduler switch |
| `SCHEDULER_FORM_AI_REVIEW_ENABLED` | `true` | Enable queued form AI review processing |
| `SCHEDULER_FORM_AI_REVIEW_CRON` | `*/2 * * * *` | Form AI review polling interval |
| `SCHEDULER_FORM_COUNT_RECONCILIATION_ENABLED` | `false` unless set | Enable form submission count reconciliation |
| `SCHEDULER_FORM_COUNT_RECONCILIATION_CRON` | `0 3 * * 0` | Reconciliation schedule |
| `SCHEDULER_FORM_URL_HEALTH_ENABLED` | `true` | Enable periodic checks for URL information fields |
| `SCHEDULER_FORM_URL_HEALTH_CRON` | `0 2 * * *` | URL health check schedule (daily at 02:00 by default) |
| `SCHEDULER_EXCHANGE_RATE_SYNC_ENABLED` | off unless set | Enable the MAS exchange rate sync |
| `SCHEDULER_EXCHANGE_RATE_SYNC_CRON` | `0 6 * * *` | Exchange rate sync schedule |
| `SCHEDULER_EXCHANGE_RATE_MAS_DAILY_ENABLED` | `true` | Include the MAS daily source in the exchange rate sync |
| `SCHEDULER_EXCHANGE_RATE_MAS_MONTHLY_ENABLED` | `true` | Include the MAS monthly source in the exchange rate sync |
| `SCHEDULER_PROCESSING_REVISION_BACKFILL_ENABLED` | off unless set | Enable the processing-document revision pointer repair |
| `SCHEDULER_PROCESSING_REVISION_BACKFILL_CRON` | `15 3 * * *` | Revision pointer repair schedule |
| `SCHEDULER_SUMMARY_COUNT_REFRESH_ENABLED` | off unless set | Enable the company counter and summary view refresh |
| `SCHEDULER_SUMMARY_COUNT_REFRESH_CRON` | `30 3 * * *` | Summary refresh schedule |

Form URL health scheduling also obeys the master `SCHEDULER_ENABLED` switch. Each run is bounded to 500 URLs and five concurrent checks; warnings remain visible only on authenticated Forms surfaces.

How the scheduler variables combine:

- Nothing runs unless `SCHEDULER_ENABLED=true`.
- Master-switch tasks run whenever `SCHEDULER_ENABLED=true` and have no `*_ENABLED` variable of their own: `esigning-pdf-generation`, `esigning-sharepoint-filing`, `esigning-preparation`, `esigning-expiry-check`, `esigning-reminders`, `service-agreement-activation` and `service-schedule-reconciliation`. Only their `SCHEDULER_<TASK>_CRON` can be changed. Before this was fixed, the e-signing expiry, reminder and preparation tasks required `SCHEDULER_ESIGNING_EXPIRY_CHECK_ENABLED`, `SCHEDULER_ESIGNING_REMINDERS_ENABLED` and `SCHEDULER_ESIGNING_PREPARATION_ENABLED`, which were undocumented, so they stayed off on installs that only set the master switch.
- Every other task (backup, cleanup, ACRA sync, public holiday sync, exchange rate sync, form tasks, revision backfill, summary refresh) also needs its own `SCHEDULER_<TASK_ID>_ENABLED=true`, with the task id upper-cased and `-` replaced by `_`. A task whose `*_ENABLED` variable is unset stays off, whatever "Default" shows above for the recommended value.
- `SCHEDULER_<TASK_ID>_CRON` overrides any task's schedule.

Backup-related settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_WORK_DIR` | OS temp folder + `/oakcloud-backups` | Scratch space for building, uploading and unpacking full backups. Needs room for about twice the size of the stored files. |

Full backups need no environment variables of their own: the backup password and schedule are set on the Backup page. Keep a copy of `.env` anyway; a full backup carries everything in the database and storage, but not these variables.

## Tunnel / Docker

| Variable | Default | Description |
|----------|---------|-------------|
| `CLOUDFLARE_TUNNEL_TOKEN` | - | Token used by the optional `cloudflared` container in `docker-compose.yml` |

## AI Debug

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_DEBUG` | `false` | Enable AI debug logging |
| `AI_DEBUG_LOG_PROMPTS` | `true` | Include prompts in debug logs |
| `AI_DEBUG_LOG_RESPONSES` | `true` | Include responses in debug logs |
| `AI_DEBUG_LOG_IMAGES` | `false` | Include image metadata in debug logs |

## Production Checklist

1. Set `NODE_ENV="production"`.
2. Use strong values for `JWT_SECRET`, `FORM_RESPONSE_TOKEN_SECRET`, and `ENCRYPTION_KEY`.
3. Enable secure storage settings (`S3_USE_SSL="true"`, `S3_ENCRYPTION="AES256"` or `aws:kms`).
4. Use a production database connection string and keep `DATABASE_SSL` enabled unless you have a reason not to.
5. Configure email before relying on invitation, reset, or Forms email flows.
