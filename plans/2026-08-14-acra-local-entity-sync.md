# ACRA Local Entity Database Implementation Plan

> Supersedes `docs/superpowers/plans/2026-08-14-acra-local-entity-sync.md` (kept for history; this is the canonical plan).
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace live data.gov.sg lookups for the form "Company name check" with a locally maintained ACRA entity table. A daily scheduled task compares the database's stored updated-date against the data.gov.sg "ACRA Information on Corporate Entities" collection's updated-date; when they differ, it downloads all 27 CSV files, filters them to live companies only, and upserts them into our Postgres database. The company name check queries **only** our own database (no live API fallback); while the table is empty the check reports itself unavailable.

**Architecture:** New Prisma models `AcraEntity` (uen, entityName, entityStatus, entityType, dataAsOf) and `AcraSyncState` (singleton sync state, doubles as a sync lock). New service `src/services/acra-sync.service.ts` performs the metadata check + download + streaming CSV import. New scheduled task `acra-sync.task.ts` (daily, 03:00 SGT). `checkCompanyNameAvailability` in `src/lib/external/company-name-check.ts` becomes DB-first: query `AcraEntity` via trigram-indexed `contains` filters, keep the existing word-matching/filtering logic, and fall back to the live data.gov.sg search when the local table is empty or too stale.

**Tech Stack:** Next.js (App Router, Node runtime), Prisma 7 + Postgres (pg_trgm), `fast-csv` (streaming CSV parse; declared as a direct dependency), node-cron scheduler, Vitest.

## Verified facts (grounding this plan)

- Collection metadata endpoint: `GET https://api-production.data.gov.sg/v2/public/api/collections/2/metadata` → `data.collectionMetadata.lastUpdatedAt` (e.g. `2026-08-14T14:07:42+08:00`). This is the "data as of" value.
- Download flow (host `https://api-open.data.gov.sg`):
  - `GET /v1/public/api/datasets/{datasetId}/initiate-download` → `201 { data: { message, url? } }` (S3 presigned URL, ~1h expiry).
  - `GET /v1/public/api/datasets/{datasetId}/poll-download` → `201 { data: { status: "DOWNLOAD_SUCCESS", url } }`.
  - Optional column/filter selection is documented as a **request body** on these GETs. Node's `fetch` rejects GET bodies (`Request with GET/HEAD method cannot have body`), `POST` returns 403, and query-param `columnNames` is ignored (all verified live). Therefore we download the **full CSVs** and select columns during streaming parse. (Future optimization: raw `node:https` GET-with-body for column filtering — out of scope.)
  - Rate limits: downloads ~5 req/min without API key, higher with key. 27 files ⇒ up to 54 initiate/poll calls. Space requests ~13s apart without a key (~11 min), ~3s with `DATAGOV_API_KEY`.
- Dataset sizes: 27 CSVs, ~654 MB total, ~2.0M rows across all letters; after filtering to live companies expect roughly 400–800k rows.
- CSV header (verified): `uen, issuance_agency_id, entity_name, entity_type_description, business_constitution_description, company_type_description, ..., entity_status_description, ...` (52 columns). We only need `uen`, `entity_name`, `entity_status_description`, `entity_type_description`.
- Dataset id → letter map already exists in `src/lib/external/company-name-check.ts` (`DATASET_BY_LETTER`); the sync service will reuse/import it (add `export`).
- **CSV parsing:** `exceljs` is NOT suitable — its CSV `read` streams the parse but accumulates every row into an in-memory worksheet (`worksheet.addRow(...)` per row; `createInputStream` is deprecated and throws in v4). Use `fast-csv` (`parseStream(stream, { headers: true })` emits one object per row); `fast-csv@4.3.6` is already in `node_modules` (exceljs transitive dep) — declare it in `package.json` directly.
- Scheduler: `TaskRegistration` (`src/lib/scheduler/tasks/*.task.ts`), exported from `tasks/index.ts`, registered in `initializeScheduler()` (`src/lib/scheduler/index.ts`); env toggles `SCHEDULER_<TASK_ID>_ENABLED` / `_CRON`; auto-initialized via `src/instrumentation.ts` (Node runtime only). **`executeTask` has no overlap guard**, and every app instance initializes the scheduler — the sync needs its own DB-based lock (see Task 3).
- Migrations are raw SQL under `prisma/migrations/<timestamp>_<name>/migration.sql` + Prisma schema update; `gen_random_uuid()` is already used; deployments apply migrations via `npx prisma migrate deploy` (`scripts/setup-production.ps1`).
- `@/lib/prisma` exposes the `prisma` singleton; `initializePrisma()` runs before the scheduler in instrumentation.

## Global Constraints

- TDD iron law: no production code without a failing test first; watch each test fail for the expected reason before implementing.
- One new dependency allowed: `fast-csv` (already present transitively; declare it explicitly). No other new deps.
- Keep the existing `checkCompanyNameAvailability` public interface (`CompanyNameCheckResult` with `available`, `checkedAt`, `dataAsOf`, `records`) — the route and public form UI stay unchanged.
- Filtering rules (confirmed with user): keep entity types `Local Company` and `Foreign Company` only; exclude dead statuses (case-insensitive match on `struck off`, `deregistered`, `dissolved`, `amalgamated`, plus empty/`na`). Everything else (`Live Company`, `In Liquidation ...`, `Pending`, etc.) is kept as a potential name conflict.
- All network calls from the sync service must include a browser-like `User-Agent` and, when set, `x-api-key: <DATAGOV_API_KEY>`.
- Timestamps from upstream are stored as **ISO-8601 strings** (TEXT), not `DateTime`, to preserve the exact `+08:00` value shown to end users ("Based on ACRA registry data as of ...") without timezone conversion drift.
- The sync must be crash-safe: rows are stamped with the new `dataAsOf`; stale rows are deleted only **after** all 27 files have been imported successfully.
- Test command: `npx vitest run <path>`.

---

### Task 1: Migration + Prisma models

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260814010000_acra_entity_sync/migration.sql`
- Modify: `package.json` (add `fast-csv` under dependencies)

**Interfaces:**
- `AcraEntity`: `id String @id @default(uuid())`, `uen String @unique`, `entityName String`, `entityStatus String`, `entityType String`, `dataAsOf String`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`; `@@map("acra_entity")`.
- `AcraSyncState`: `id String @id @default("main")` (singleton), `collectionLastUpdatedAt String?` (ISO string), `entityCount Int @default(0)`, `lastStartedAt DateTime?` (sync lock), `lastCompletedAt DateTime?`, `lastError String?`, `updatedAt DateTime @updatedAt`; `@@map("acra_sync_state")`.

- [ ] **Step 1: Add `fast-csv` to `package.json`**

```json
"fast-csv": "^4.3.6",
```

Run `npm install` (resolves from the already-present version).

- [ ] **Step 2: Add the models to `prisma/schema.prisma`**

Follow existing model conventions (placement near other global models, snake_case `@@map`):

```prisma
model AcraEntity {
  id           String   @id @default(uuid())
  uen          String   @unique
  entityName   String   @map("entity_name")
  entityStatus String   @map("entity_status")
  entityType   String   @map("entity_type")
  dataAsOf     String   @map("data_as_of")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("acra_entity")
}

model AcraSyncState {
  id                      String    @id @default("main")
  collectionLastUpdatedAt String?   @map("collection_last_updated_at")
  entityCount             Int       @default(0) @map("entity_count")
  lastStartedAt           DateTime? @map("last_started_at")
  lastCompletedAt         DateTime? @map("last_completed_at")
  lastError               String?   @map("last_error")
  updatedAt               DateTime  @updatedAt @map("updated_at")

  @@map("acra_sync_state")
}
```

Note: this repo's Prisma setup does not auto-map camelCase fields to snake_case
columns (verified via the generated client's DMMF); every field needs an explicit
`@map` matching the migration SQL, following the newer models' convention.

- [ ] **Step 3: Write the migration SQL**

Create `prisma/migrations/20260814010000_acra_entity_sync/migration.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "acra_entity" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "uen" TEXT NOT NULL,
    "entity_name" TEXT NOT NULL,
    "entity_status" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "data_as_of" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acra_entity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acra_entity_uen_key" ON "acra_entity"("uen");

CREATE INDEX "acra_entity_entity_name_trgm_idx"
ON "acra_entity" USING gin ("entity_name" gin_trgm_ops);

CREATE TABLE "acra_sync_state" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "collection_last_updated_at" TEXT,
    "entity_count" INTEGER NOT NULL DEFAULT 0,
    "last_started_at" TIMESTAMP(3),
    "last_completed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acra_sync_state_pkey" PRIMARY KEY ("id")
);
```

Note: the GIN trigram index is on the raw `entity_name` column — Prisma's
`contains` with `mode: 'insensitive'` generates `ILIKE '%word%'`, which the
pg_trgm opclass matches directly. A `lower(entity_name)` expression index is
NOT used for ILIKE predicates (verified with EXPLAIN on 466k rows: seq scan
~397ms vs bitmap index scan ~0.9ms). `pg_trgm` is a trusted extension available
on standard Postgres (Docker image, RDS, etc.); if the production provider
blocks it, the fallback is a `lower(entity_name)` btree index + prefix matching
— but confirm extension availability at deploy time.

- [ ] **Step 4: Generate the client and type-check**

Run `npm run db:generate`, then `npx tsc --noEmit`. Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json prisma/schema.prisma prisma/migrations/20260814010000_acra_entity_sync/migration.sql src/generated/prisma
git commit -m "feat(acra): add acra_entity and acra_sync_state tables with trigram index"
```

---

### Task 2: CSV row mapping + filtering helpers

**Files:**
- Create: `src/services/acra-sync.helpers.ts`
- Test: `__tests__/services/acra-sync.helpers.test.ts` (create)

**Interfaces:**
- Produces: `ALLOWED_ENTITY_TYPES: Set<string>` (`'local company'`, `'foreign company'`)
- Produces: `isDeadEntityStatus(status: string): boolean`
- Produces: `isAllowedEntityType(type: string): boolean`
- Produces: `mapCsvRow(row: Record<string, string>): { uen: string; entityName: string; entityStatus: string; entityType: string } | null` — takes a fast-csv `{ headers: true }` object row; returns `null` for rows with missing `uen`/`entity_name`, non-allowed entity types, or dead statuses; trims and slices fields (uen 32, name 500, status 200, type 100).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/services/acra-sync.helpers.test.ts` covering:
- `mapCsvRow` maps a real CSV object row to the entity shape (values preserved as-is, trimmed; predicates are case-insensitive).
- Rows with `entity_type_description` = `Business`, `Limited Liability Partnership`, `Sole Proprietorship`, `na` → `null`.
- Rows with status `Struck Off`, `Deregistered`, `Dissolved - Creditors' Voluntary Winding Up`, `Amalgamated`, `na`, empty → `null`.
- Rows with `Live Company`/`In Liquidation - Creditors' Voluntary Winding Up` + `Local Company`/`Foreign Company` → mapped.
- Missing `uen` or empty `entity_name` → `null`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/services/acra-sync.helpers.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helpers**

Implement per the interface above. Keep predicates pure and exported.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/services/acra-sync.helpers.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/acra-sync.helpers.ts __tests__/services/acra-sync.helpers.test.ts
git commit -m "feat(acra): add CSV row mapping and entity filtering helpers"
```

---

### Task 3: ACRA sync service

**Files:**
- Create: `src/services/acra-sync.service.ts`
- Test: `__tests__/services/acra-sync.service.test.ts` (create)

**Interfaces:**
- Produces: `getAcraCollectionLastUpdatedAt(): Promise<string | null>` — GET collection metadata; returns ISO string or null on failure.
- Produces: `syncAcraDataIfUpdated(): Promise<{ synced: boolean; skipped: boolean; entityCount: number; dataAsOf: string | null; error?: string }>` — main entrypoint used by the task: compares the stored `collectionLastUpdatedAt` against the API's `lastUpdatedAt` and re-imports only on mismatch (the daily "updated date comparison" requested by the user).
- Produces: `getAcraSyncState()` — reads the `AcraSyncState` singleton row (used by the name-check service for `dataAsOf` and empty-table detection).

**Behavior (detail):**
1. **Claim the sync (DB lock):** `prisma.acraSyncState.updateMany({ where: { OR: [{ lastStartedAt: null }, { lastStartedAt: { lt: new Date(Date.now() - 6*3600*1000) } }] }, data: { lastStartedAt: new Date() } })`; if `count === 0`, another instance/run holds the lock → return `{ synced: false, skipped: true, ... }`. This guards against overlapping cron/manual runs and multiple app instances (every instance initializes the scheduler). The 6h window matches the expected maximum sync duration.
2. Fetch collection metadata; if `lastUpdatedAt` equals `AcraSyncState.collectionLastUpdatedAt` → release the lock (clear `lastStartedAt`) and return `{ synced: false, skipped: true, entityCount, dataAsOf }`.
3. For each of the 27 dataset ids: `initiate-download` → if no `url` in response, `poll-download` (retry up to 5 times with 10s backoff while status is processing) → `fetch` the S3 URL (timeout 15 min) → `Readable.fromWeb(response.body)` → `fastCsv.parseStream(stream, { headers: true })` → per-row `mapCsvRow` → accumulate batches of 2000 → `prisma.acraEntity.createMany({ data, skipDuplicates: true })` with `dataAsOf` = collection `lastUpdatedAt`. Memory stays flat (streamed, batched).
4. Sleep ~13s between datasets without `DATAGOV_API_KEY`, ~3s with a key (sleep isolated in a helper that tests stub out).
5. After all 27 succeed: `deleteMany({ where: { dataAsOf: { not: newDataAsOf } } })`, `count()`, upsert `AcraSyncState` (`collectionLastUpdatedAt`, `entityCount`, `lastCompletedAt`, clear `lastError` and `lastStartedAt`).
6. On failure mid-sync: set `lastError`, clear `lastStartedAt` (so the next daily run can retry), leave existing rows intact, return `{ synced: false, skipped: false, error }`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/services/acra-sync.service.test.ts` with mocked `@/lib/prisma`, real `fetch` stubbed via `vi.stubGlobal`, and the sleep helper stubbed:
- Skips when metadata `lastUpdatedAt` matches stored state (no initiate-download calls).
- Skips when the DB lock is already held (`updateMany` returns count 0).
- Full happy path: metadata changed → initiate/poll per dataset → CSV streams → `createMany` called with filtered rows and correct `dataAsOf` → stale rows deleted → sync state updated with entityCount and cleared lock.
- Rows are filtered through `mapCsvRow` (feed a small CSV string through `Readable.from`, assert only live/local-company rows reach `createMany`).
- Poll retry: first poll returns `DOWNLOAD_PROCESSING`, second returns `DOWNLOAD_SUCCESS` with URL.
- Mid-sync failure (e.g., 5th file download fails) → `lastError` set, lock released, no stale-row `deleteMany`.

CSV fixture: a small CSV with a full 52-column header line (the helper reads by header name, so the fixture must include the 4 needed column names).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/services/acra-sync.service.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service**

Implement per the interface/behavior above. Notes:
- Logging via `createLogger('acra-sync')`.
- Define `DATASET_BY_LETTER` here (moved from `company-name-check.ts`, whose live-search code is deleted in Task 4).
- Keep per-file processing isolated so one file's failure is surfaced cleanly; wrap each dataset iteration in try/catch and abort the sync on error.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/services/acra-sync.service.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/acra-sync.service.ts __tests__/services/acra-sync.service.test.ts
git commit -m "feat(acra): add scheduled ACRA dataset sync service"
```

---

### Task 4: DB-backed company name check (no live API)

**Files:**
- Modify: `src/lib/external/company-name-check.ts`
- Modify: `__tests__/services/company-name-check.service.test.ts`

**Interfaces:**
- `checkCompanyNameAvailability(name)` unchanged signature. New behavior (**DB-only, no live API fallback** per user decision):
  1. Normalize + validate as today; compute significant words (existing helpers).
  2. Read sync state. If no state row exists or `entityCount === 0`, throw `CompanyNameCheckUnavailableError('Company name check is temporarily unavailable')` (the table is empty until the first sync/bootstrap runs).
  3. Query: `prisma.acraEntity.findMany({ where: { AND: significantWords.map(w => ({ entityName: { contains: w, mode: 'insensitive' } })) }, select: { uen: true, entityName: true, entityStatus: true }, orderBy: { entityName: 'asc' }, take: 500 })` → apply the existing JS word-match filter + dedupe by `uen` + cap 10; `dataAsOf` = `AcraSyncState.collectionLastUpdatedAt` (raw ISO string) or null.
     - Trigram GIN index supports `ILIKE '%word%'` only for patterns ≥3 chars — significant words guarantee this. When `significantWords` is empty (rare: names with no ≥3-char words), fall back to `contains` on the normalized name (accept a possible seq scan for this edge).
     - Dedupe by `uen` also protects against double rows during an in-flight sync (old + new `dataAsOf` rows coexisting until the post-import delete).
  4. If the DB query throws, propagate as `CompanyNameCheckUnavailableError` (the check must not silently fall back to the live API).
  5. **Delete the now-dead live-search code** from this file: `DATASET_BY_LETTER`, `getDatasetId`, `searchDataset`, `searchWithRetry`, `buildSearchUrl`, `getDataAsOf`, metadata cache, `fetchWithTimeout`, `normalizeRecord`. `DATASET_BY_LETTER` moves into the sync service (Task 3).

- [ ] **Step 1: Update the tests first (failing)**

Modify `__tests__/services/company-name-check.service.test.ts` (rewrite: the old tests exercised the live data.gov.sg search, which is being removed):
- Mock `@/lib/prisma` (`prisma.acraEntity.findMany`, `prisma.acraSyncState.findFirst`).
- Tests: DB path returns DB records + `dataAsOf` from sync state; word-match filtering and dedupe by `uen` still apply to DB rows; record cap of 10; empty table (no state row / `entityCount` 0) → `CompanyNameCheckUnavailableError`; DB query throws → `CompanyNameCheckUnavailableError`; validation errors (empty name, >300 chars) unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/services/company-name-check.service.test.ts` — Expected: FAIL (DB path not implemented).

- [ ] **Step 3: Implement the DB-first check**

Refactor `checkCompanyNameAvailability` per the interface above.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/services/company-name-check.service.test.ts __tests__/api/form-name-check-route.test.ts __tests__/services/form-name-check-submission.test.ts __tests__/app/public-form-page.test.tsx` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/external/company-name-check.ts __tests__/services/company-name-check.service.test.ts
git commit -m "feat(acra): check company names against local ACRA table with live fallback"
```

---

### Task 5: Scheduled task + manual sync script

**Files:**
- Create: `src/lib/scheduler/tasks/acra-sync.task.ts`
- Modify: `src/lib/scheduler/tasks/index.ts` (export)
- Modify: `src/lib/scheduler/index.ts` (register in `initializeScheduler()`)
- Create: `scripts/run-acra-sync.ts` (manual bootstrap via `npx tsx scripts/run-acra-sync.ts`)

**Interfaces:**
- `acraSyncTask: TaskRegistration` with `id: 'acra-sync'`, `name: 'ACRA Entity Sync'`, `defaultCronPattern: '0 3 * * *'` (03:00 SGT daily), `execute` calling `syncAcraDataIfUpdated()` and returning a `TaskResult` summary (`synced/skipped`, entity count, dataAsOf, error). Follow the `exchange-rate-sync.task.ts` pattern (dynamic import of the service to avoid circular deps).
- Env: `SCHEDULER_ACRA_SYNC_ENABLED`, `SCHEDULER_ACRA_SYNC_CRON` (handled automatically by the scheduler convention).

- [ ] **Step 1: Create the task file and registrations**

Implement per the interface. Register in `initializeScheduler()` after `serviceAgreementActivationTask`.

- [ ] **Step 2: Create the manual sync script**

`scripts/run-acra-sync.ts`: loads `dotenv/config` (tsx does not read `.env`; same pattern as `prisma.config.ts`), imports `syncAcraDataIfUpdated`, logs the result, exits non-zero on failure. This bootstraps the table without waiting for cron.

- [ ] **Step 3: Type-check**

Run `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scheduler/tasks/acra-sync.task.ts src/lib/scheduler/tasks/index.ts src/lib/scheduler/index.ts scripts/run-acra-sync.ts
git commit -m "feat(acra): add daily ACRA sync scheduled task and manual sync script"
```

---

### Task 6: Environment variables + documentation

**Files:**
- Modify: `.env.example`
- Modify: `docs/reference/ENVIRONMENT_VARIABLES.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/reference/DATABASE_SCHEMA.md`

- [ ] **Step 1: Update `.env.example`**

Under the data.gov.sg section, document the sync toggles:

```
# ACRA local entity database sync (powers the form "Company name check")
# Daily task checks the data.gov.sg collection for updates and re-imports when changed.
SCHEDULER_ACRA_SYNC_ENABLED="false"
SCHEDULER_ACRA_SYNC_CRON="0 3 * * *"
```

Note in comments that `DATAGOV_API_KEY` raises the download rate limit and that the first sync downloads ~654 MB and imports ~2M rows filtered down to live companies.

- [ ] **Step 2: Update `docs/reference/ENVIRONMENT_VARIABLES.md`**

Extend the "ACRA Company Name Check" section: add the scheduler toggles, and describe the check-against-local-DB behavior + live fallback conditions.

- [ ] **Step 3: Update `docs/ARCHITECTURE.md`**

- In the technology table, extend the data.gov.sg row to mention the locally mirrored `acra_entity` table and daily sync task.
- In the scheduler/runtime services section, list the ACRA sync task (match how other tasks are described).

- [ ] **Step 4: Update `docs/reference/DATABASE_SCHEMA.md`**

Add `acra_entity` and `acra_sync_state` table entries (columns, purpose) matching the file's existing table documentation style.

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/reference/ENVIRONMENT_VARIABLES.md docs/ARCHITECTURE.md docs/reference/DATABASE_SCHEMA.md
git commit -m "docs(acra): document ACRA local entity sync and environment variables"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full test suite**

Run `npm run test:run` — Expected: all tests pass (including the rewritten service tests). If unrelated pre-existing failures appear, confirm they fail before this feature and report rather than fixing out of scope.

- [ ] **Step 2: Lint + typecheck**

Run `npm run lint` and `npx tsc --noEmit` — Expected: no new errors.

- [ ] **Step 3: Manual smoke (requires running app + Postgres)**

Run `npx tsx scripts/run-acra-sync.ts` and verify: sync state row populated, entity count > 0, a subsequent `checkCompanyNameAvailability('Oaktree Accounting')` hits the local DB (log lines show no data.gov.sg search requests) and returns `OAKTREE ACCOUNTING & CORPORATE SOLUTIONS PTE. LTD.` with the sync's `dataAsOf`.

## Risks & failure modes

- **Multi-instance / overlapping runs:** every app instance initializes the scheduler; the DB lock in Task 3 prevents duplicate concurrent syncs. Verify the lock works across instances (updateMany guard).
- **Memory:** full CSVs are streamed row-by-row via fast-csv; only 2000-row batches are held in memory. No file is buffered whole.
- **Upstream changes:** data.gov.sg may reorder/rename columns or change the download flow; the import fails safely (existing rows retained, `lastError` set). The live-API fallback keeps the check working regardless.
- **Stale data:** no staleness fallback exists (per user decision the check is DB-only). If the sync breaks, checks keep using the last imported data until the daily date comparison succeeds again; the task surfaces `lastError` in the sync state row.
- **Empty table:** until the first sync/bootstrap completes, `checkCompanyNameAvailability` throws `CompanyNameCheckUnavailableError` (handled as "check unavailable" by the form submission flow).
- **Rate limits:** request spacing (~13s without key) keeps the 54-call flow within the ~5 req/min quota.
- **pg_trgm availability:** trusted extension on standard Postgres; confirm at deploy time on the production provider.
- **Migration application:** applied via the existing `npx prisma migrate deploy` deployment flow (`scripts/setup-production.ps1`).

## Rollout notes

- First sync imports ~654 MB (full CSVs); with `DATAGOV_API_KEY` set, request spacing is ~3s (≈5–10 min); without a key ~13s (≈15 min). Streaming keeps memory flat.
- The name check is **unavailable until the first sync completes** — run `npx tsx scripts/run-acra-sync.ts` immediately after deploying the migration (it bootstraps the table; the daily task then keeps it current).
- Data refreshes monthly upstream; the daily task is a cheap metadata date comparison except on update days.
