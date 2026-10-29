# ACRA Local Entity Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace live data.gov.sg lookups for the form "Company name check" with a locally maintained ACRA entity table. A daily scheduled task checks the data.gov.sg "ACRA Information on Corporate Entities" collection for updates; when the collection has been updated, it downloads all 27 CSV files, filters them to live companies only, and upserts them into our Postgres database. The company name check then queries our own database (with a fallback to the live data.gov.sg search API while the local table is empty).

**Architecture:** New Prisma models `AcraEntity` (uen, entityName, entityStatus, entityType, dataAsOf) and `AcraSyncState` (singleton sync state). New service `src/services/acra-sync.service.ts` performs the metadata check + download + streaming CSV import. New scheduled task `acra-sync.task.ts` (daily, 03:00 SGT). `checkCompanyNameAvailability` in `src/lib/external/company-name-check.ts` becomes DB-first: query `AcraEntity` via trigram-indexed `contains` filters, keep the existing word-matching/filtering logic, and fall back to the live data.gov.sg search when the local table has no rows (e.g., before the first sync completes).

**Tech Stack:** Next.js (App Router, Node runtime), Prisma 7 + Postgres (pg_trgm), exceljs (already a dependency; streaming CSV read), node-cron scheduler, Vitest.

## Verified facts (grounding this plan)

- Collection metadata endpoint: `GET https://api-production.data.gov.sg/v2/public/api/collections/2/metadata` → `data.collectionMetadata.lastUpdatedAt` (e.g. `2026-08-14T14:07:42+08:00`). This is the "data as of" value.
- Download flow (host `https://api-open.data.gov.sg`):
  - `GET /v1/public/api/datasets/{datasetId}/initiate-download` → `201 { data: { message, url? } }` (S3 presigned URL, ~1h expiry).
  - `GET /v1/public/api/datasets/{datasetId}/poll-download` → `201 { data: { status: "DOWNLOAD_SUCCESS", url } }`.
  - Optional column/filter selection is documented as a **request body** on these GETs. Node's `fetch` rejects GET bodies (`Request with GET/HEAD method cannot have body`) and `POST` returns 403, and query-param `columnNames` is ignored (verified). Therefore we download the **full CSVs** and select columns during streaming parse. (Future optimization: raw `node:https` GET-with-body for column filtering — out of scope.)
  - Rate limits: downloads ~5 req/min without API key, higher with key. 27 files ⇒ 54 initiate/poll calls. Space requests ~13s apart without a key (~11 min), ~3s with `DATAGOV_API_KEY`.
- Dataset sizes: 27 CSVs, ~654 MB total, ~2.0M rows across all letters; after filtering to live companies expect roughly 400–800k rows.
- CSV header (verified): `uen, issuance_agency_id, entity_name, entity_type_description, business_constitution_description, company_type_description, ..., entity_status_description, ...` (52 columns). We only need `uen`, `entity_name`, `entity_status_description`, `entity_type_description`.
- Dataset id → letter map already exists in `src/lib/external/company-name-check.ts` (`DATASET_BY_LETTER`); the sync service will reuse/import it.
- `exceljs@4.4.0` is a declared dependency and supports streaming CSV read via `workbook.csv.read(stream)` + `worksheet.eachRow(...)`.
- Scheduler pattern: `TaskRegistration` (`src/lib/scheduler/tasks/*.task.ts`), exported from `tasks/index.ts`, registered in `initializeScheduler()` in `src/lib/scheduler/index.ts`; env toggles `SCHEDULER_<TASK_ID>_ENABLED` / `_CRON`. Closest analog: `exchange-rate-sync.task.ts`.
- Migrations are raw SQL under `prisma/migrations/<timestamp>_<name>/migration.sql` + Prisma schema update; `gen_random_uuid()` is already used by existing migrations.

## Global Constraints

- TDD iron law: no production code without a failing test first; watch each test fail for the expected reason before implementing.
- No new npm dependencies (use `exceljs` for streaming CSV parsing).
- Keep the existing `checkCompanyNameAvailability` public interface (`CompanyNameCheckResult` with `available`, `checkedAt`, `dataAsOf`, `records`) — the route and public form UI stay unchanged.
- Filtering rules (confirmed with user): keep entity types `Local Company` and `Foreign Company` only; exclude dead statuses (case-insensitive match on `struck off`, `deregistered`, `dissolved`, `amalgamated`, plus empty/`na`). Everything else (`Live Company`, `In Liquidation ...`, `Pending`, etc.) is kept as a potential name conflict.
- All network calls from the sync service must include a browser-like `User-Agent` and, when set, `x-api-key: <DATAGOV_API_KEY>`.
- The sync must be crash-safe: rows are stamped with the new `dataAsOf`; stale rows are deleted only **after** all 27 files have been imported successfully.
- Test command: `npx vitest run <path>`.

---

### Task 1: Migration + Prisma models

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260814010000_acra_entity_sync/migration.sql`
- Modify: `docs/reference/DATABASE_SCHEMA.md` (add the two tables; do this in Task 8 with the other docs)

**Interfaces:**
- `AcraEntity`: `id String @id @default(uuid())`, `uen String @unique`, `entityName String`, `entityStatus String`, `entityType String`, `dataAsOf DateTime`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`; mapped to table `acra_entity`.
- `AcraSyncState`: `id String @id @default("main")` (singleton), `collectionLastUpdatedAt DateTime?`, `entityCount Int @default(0)`, `lastStartedAt DateTime?`, `lastCompletedAt DateTime?`, `lastError String?`, `updatedAt DateTime @updatedAt`; mapped to `acra_sync_state`.

- [ ] **Step 1: Add the models to `prisma/schema.prisma`**

Follow the existing model conventions (placement near other global models, snake_case `@@map`). Example:

```prisma
model AcraEntity {
  id           String   @id @default(uuid())
  uen          String   @unique
  entityName   String
  entityStatus String
  entityType   String
  dataAsOf     DateTime
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@map("acra_entity")
}

model AcraSyncState {
  id                     String    @id @default("main")
  collectionLastUpdatedAt DateTime?
  entityCount            Int       @default(0)
  lastStartedAt          DateTime?
  lastCompletedAt        DateTime?
  lastError              String?
  updatedAt              DateTime  @updatedAt

  @@map("acra_sync_state")
}
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260814010000_acra_entity_sync/migration.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "acra_entity" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "uen" TEXT NOT NULL,
    "entity_name" TEXT NOT NULL,
    "entity_status" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "data_as_of" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acra_entity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acra_entity_uen_key" ON "acra_entity"("uen");

CREATE INDEX "acra_entity_entity_name_trgm_idx"
ON "acra_entity" USING gin (lower("entity_name") gin_trgm_ops);

CREATE TABLE "acra_sync_state" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "collection_last_updated_at" TIMESTAMP(3),
    "entity_count" INTEGER NOT NULL DEFAULT 0,
    "last_started_at" TIMESTAMP(3),
    "last_completed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acra_sync_state_pkey" PRIMARY KEY ("id")
);
```

- [ ] **Step 3: Generate the client and type-check**

Run `npm run db:generate` (runs `prisma generate` + normalization script), then `npx tsc --noEmit`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260814010000_acra_entity_sync/migration.sql src/generated/prisma
git commit -m "feat(acra): add acra_entity and acra_sync_state tables with trigram index"
```

---

### Task 2: CSV row mapping + filtering helpers

**Files:**
- Create: `src/services/acra-sync.helpers.ts`
- Test: `__tests__/services/acra-sync.helpers.test.ts` (create)

**Interfaces:**
- Produces: `ACRA_ENTITY_COLUMNS = ['uen', 'entity_name', 'entity_status_description', 'entity_type_description']`
- Produces: `ALLOWED_ENTITY_TYPES: Set<string>` (`'local company'`, `'foreign company'`)
- Produces: `isDeadEntityStatus(status: string): boolean`
- Produces: `isAllowedEntityType(type: string): boolean`
- Produces: `mapCsvRow(row: string[], headerIndex: Record<string, number>): { uen: string; entityName: string; entityStatus: string; entityType: string } | null` — returns `null` for rows with missing `uen`/`entity_name`, non-allowed entity types, or dead statuses; trims and slices fields (uen 32, name 500, status 200, type 100).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/services/acra-sync.helpers.test.ts` covering:
- `mapCsvRow` maps a real CSV row (indexed by header) to the entity shape, lowercased comparisons only inside predicates (values preserved as-is, trimmed).
- Rows with `entity_type_description` = `Business`, `Limited Liability Partnership`, `Sole Proprietorship`, `na` → `null`.
- Rows with status `Struck Off`, `Deregistered`, `Dissolved - Creditors' Voluntary Winding Up`, `Amalgamated`, `na`, empty → `null`.
- Rows with `Live Company`/`In Liquidation - Creditors' Voluntary Winding Up` + `Local Company`/`Foreign Company` → mapped.
- Missing `uen` or empty `entity_name` → `null`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/services/acra-sync.helpers.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helpers**

Implement per the interface above. Keep the predicates pure and exported so the name-check service can share the same dead-status semantics later if needed.

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
- Produces: `syncAcraDataIfUpdated(): Promise<{ synced: boolean; skipped: boolean; entityCount: number; dataAsOf: string | null; error?: string }>` — main entrypoint used by the task.
- Produces: `getAcraSyncState()` — reads the `AcraSyncState` singleton row (used by the name-check service for `dataAsOf` and empty-table detection).

**Behavior (detail):**
1. Fetch collection metadata; if `lastUpdatedAt` equals `AcraSyncState.collectionLastUpdatedAt` → return `{ synced: false, skipped: true, entityCount, dataAsOf }`.
2. Set `lastStartedAt`; for each of the 27 dataset ids (reuse the letter→id map): `initiate-download` → if no `url` in response, `poll-download` (retry up to N times with 10s backoff while status is processing) → `fetch` the S3 URL with timeout 15 min → `Readable.fromWeb(response.body)` → `workbook.csv.read(stream)` → `worksheet.eachRow` skipping the header row → `mapCsvRow` → accumulate batches of 2000 → `prisma.acraEntity.createMany({ data, skipDuplicates: true })` with `dataAsOf` = collection `lastUpdatedAt`.
3. Sleep ~13s between datasets without `DATAGOV_API_KEY`, ~3s with a key.
4. After all 27 succeed: `deleteMany({ where: { dataAsOf: { not: newDataAsOf } } })`, count rows (`count()`), upsert `AcraSyncState` (`collectionLastUpdatedAt`, `entityCount`, `lastCompletedAt`, clear `lastError`).
5. On failure mid-sync: set `lastError`, leave existing rows intact, return `{ synced: false, skipped: false, error }`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/services/acra-sync.service.test.ts` with mocked `@/lib/prisma`, real `fetch` stubbed via `vi.stubGlobal`:
- Skips when metadata `lastUpdatedAt` matches stored state (no download calls; initate-download not called).
- Full happy path: metadata changed → 27 initiate calls (+polls) → CSV streams → `createMany` called with filtered rows and correct `dataAsOf` → stale rows deleted → sync state updated with entityCount.
- Rows are filtered through `mapCsvRow` (feed a small CSV string, assert only live/local-company rows reach `createMany`).
- Poll retry: first poll returns `DOWNLOAD_PROCESSING`, second returns `DOWNLOAD_SUCCESS` with URL.
- Mid-sync failure (e.g., 5th file download fails) → `lastError` set, no `deleteMany` for stale rows.
- `getAcraSyncState` returns the stored row.

CSV fixture: use a small multi-row CSV with the 52-column header (a compact header line with the 4 needed columns present is acceptable — the helper indexes by header names).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/services/acra-sync.service.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service**

Implement per the interface/behavior above. Notes:
- Use `exceljs` (`import ExcelJS from 'exceljs'`), `workbook.csv.read(nodeStream)`; wrap the per-file processing so one file's failure is surfaced cleanly.
- The sleep between datasets must be stubbed/short-circuited in tests (e.g., `SLEEP_MS` derived from a module function the tests can override via `vi.spyOn`, or accept a `requestDelayMs` option in an internal function).
- Logging via `createLogger('acra-sync')`.
- Reuse `DATASET_BY_LETTER` from `src/lib/external/company-name-check.ts` (export it if needed — add `export` there in this step).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/services/acra-sync.service.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/acra-sync.service.ts __tests__/services/acra-sync.service.test.ts src/lib/external/company-name-check.ts
git commit -m "feat(acra): add scheduled ACRA dataset sync service"
```

---

### Task 4: DB-backed company name check with live fallback

**Files:**
- Modify: `src/lib/external/company-name-check.ts`
- Modify: `__tests__/services/company-name-check.service.test.ts`

**Interfaces:**
- `checkCompanyNameAvailability(name)` unchanged signature. New behavior:
  1. Normalize + validate as today; compute significant words (existing helpers).
  2. If `AcraSyncState` exists with `entityCount > 0`: query `prisma.acraEntity.findMany({ where: { AND: significantWords.map(w => ({ entityName: { contains: w, mode: 'insensitive' } })) }, select: { uen, entityName, entityStatus }, take: 500, orderBy: { entityName: 'asc' } })`, then apply the existing JS word-match filter + dedupe by `uen` + cap 10; `dataAsOf` = `AcraSyncState.collectionLastUpdatedAt?.toISOString() ?? null`.
  3. If the local table is empty (no sync state or `entityCount === 0`), run the existing live data.gov.sg search path (current implementation) as fallback.
  4. If the local DB query throws (DB error), fall back to the live path as well (log a warning); the check must not fail because of a transient DB hiccup.

- [ ] **Step 1: Update the tests first (failing)**

Modify `__tests__/services/company-name-check.service.test.ts`:
- Mock `@/lib/prisma` (`prisma.acraEntity.findMany`, `prisma.acraSyncState.findFirst`, `prisma.acraEntity.count`).
- New tests: DB-first path returns DB records + `dataAsOf` from sync state (no fetch calls to data.gov.sg); DB empty → live path used (existing fetch-mocked tests keep passing after adjusting mocks); DB query throws → live fallback used.
- Keep all existing live-path tests by defaulting the prisma mocks to "no local data".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/services/company-name-check.service.test.ts` — Expected: FAIL (DB path not implemented; `findMany` never called).

- [ ] **Step 3: Implement the DB-first check**

Refactor `checkCompanyNameAvailability` per the interface above. Extract the current live-search internals into a private `checkViaLiveApi(...)` so both paths share the normalization + word matching. Keep `dataAsOf` semantics identical.

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

`scripts/run-acra-sync.ts`: imports `syncAcraDataIfUpdated`, logs the result, exits non-zero on failure. This bootstraps the table without waiting for cron.

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

Note in comments that `DATAGOV_API_KEY` raises the download rate limit and that the first sync imports ~2M rows (~654 MB download) filtered down to live companies.

- [ ] **Step 2: Update `docs/reference/ENVIRONMENT_VARIABLES.md`**

Extend the "ACRA Company Name Check" section: add the scheduler toggles, and describe the check-against-local-DB behavior + live fallback.

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

## Rollout notes

- First sync imports ~654 MB (full CSVs); with `DATAGOV_API_KEY` set, request spacing is ~3s (≈5–10 min); without a key ~13s (≈15 min). File streaming keeps memory flat.
- The public form keeps working against the live API until the first sync completes (empty-table fallback).
- Data refreshes monthly upstream; the daily task is a cheap metadata comparison except on update days.
