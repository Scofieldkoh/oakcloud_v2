# Task 1 correction rereview — billing tracking schema

## Verdict

**PASS** — 0 Critical, 0 Important, 2 Minor.

Review target: base `41e7beb93880ca2c96b4f52db9a64b9077599eb7`, original Task 1 `66197f3c399d693e9e8816c8c251115e8bb3cf88`, corrected head `960d07789cc925ed56cb5217a011e82f66934e8a`.

All five Important and both Minor findings from `task-1-review.md` are materially closed in the implementation. The two Minor notes below concern residual test/evidence quality, not a remaining SQL/Prisma integrity defect.

## Critical

None.

## Important

None.

## Original finding closure

### I1 — CLOSED: tenant/company/client-service/fee-line lineage

- `companies` exposes `("tenantId", "id")`, `client_services` exposes `("tenant_id", "id", "company_id")`, and `client_service_fee_lines` exposes `("tenant_id", "id", "client_service_id")` as composite unique keys. Prisma declarations and mapped SQL names/order agree.
- Both new tables use composite company and client-service foreign keys, and composite fee-line foreign keys, with the same column order as their referenced keys.
- `BillingCoverageIssue.feeLineId` remains optional. PostgreSQL's default `MATCH SIMPLE` behavior correctly bypasses only the fee-line composite FK when `fee_line_id` is NULL because one referencing column is NULL. The required composite company/client-service FKs remain active, so tenant/company/client-service lineage is still enforced for fee-line-independent issues.
- Generated checked and unchecked inputs preserve required occurrence fee-line IDs and optional coverage-issue fee-line IDs; the new compound unique selectors are present.

### I2 — CLOSED: required `NOT_REQUIRED` reason

`client_services_billing_disposition_reason` now explicitly requires `billing_not_required_reason IS NOT NULL` and a `btrim` length of at least three for `NOT_REQUIRED`; every other disposition requires NULL. Existing rows safely default to `UNREVIEWED` with NULL reason.

### I3 — CLOSED: actor deletion behavior

All five billing actor foreign keys use `ON DELETE RESTRICT` in SQL and Prisma. This is consistent with the active override/lifecycle checks and retains required actor identity instead of declaring an impossible `SET NULL` action.

### I4 — CLOSED: lifecycle metadata completeness

The BILLED, WAIVED, and CANCELLED constraints now use explicit status/non-status branches. Required timestamp/actor/reason fields are complete for the active status and null otherwise. `billing_occurrences_billed_date_status` permits `billed_date` to remain optional for BILLED while requiring it to be NULL for other states.

### I5 — CLOSED: unoverridden base/operative equivalence

When `date_overridden` is false, calculated and operative dates must match. When `value_overridden` is false, base/operative amount and currency must match. True override branches require complete reason/time/actor metadata.

### M1 — CLOSED: canonical fee-line archive state

`client_service_fee_lines_archive_consistency` permits only active with null archive metadata, or inactive with timestamp and a trimmed reason of at least three characters. Existing fee lines receive the safe active/null default combination.

### M2 — CLOSED: behavioral PostgreSQL coverage added

`__tests__/integration/billing-tracking-integrity.postgres.test.ts` applies the real migration inside a random isolated schema and exercises lineage rejection, disposition reasons, archive consistency, override equivalence, lifecycle state, actor Restrict, partial issue uniqueness, and source deletion Restrict.

Without `TEST_DATABASE_URL`, `describe.skip` registers four skips and no pool/client is created because connection setup is inside `beforeAll`. With a URL, setup uses a quoted random schema, transactionally applies the migration under a schema-local search path, and `afterAll` drops the schema and closes the one-connection pool. With `CI=true` and no URL, a separate test fails explicitly instead of silently accepting missing integration configuration.

## Minor

### M1. The PostgreSQL test does not directly exercise the optional NULL fee-line success path

The nullable composite FK is correct under PostgreSQL `MATCH SIMPLE`, but the integration suite only inserts coverage issues with a non-null fee line. Add one successful `BillingCoverageIssue` insert with `fee_line_id = NULL` so future changes to FK match behavior or column nullability cannot regress this intended contract unnoticed.

### M2. The SDD report and progress ledger still describe the correction as uncommitted

`task-1-report.md` says the correction is verified but uncommitted, and `progress.md` records `66197f3c + correction worktree` with an index-lock blocker. The actual clean head is the committed correction `960d0778` (`fix: enforce billing tracking integrity`). Update those evidence statements so the handoff reflects repository state. The report's pre-existing exact-format summary also omits the separately observed service-agreement exact-format failure.

## Verification evidence

```text
npm.cmd run test:run -- __tests__/services/billing-tracking-schema.test.ts __tests__/integration/billing-tracking-integrity.postgres.test.ts __tests__/services/deadline-engine-schema.test.ts __tests__/services/services-admin-foundation-schema.test.ts --reporter=dot
PASS — 3 files passed, 1 skipped; 35 tests passed, 4 intentionally skipped

npx.cmd tsc --noEmit
PASS — exit 0

npx.cmd eslint __tests__/services/billing-tracking-schema.test.ts __tests__/integration/billing-tracking-integrity.postgres.test.ts --max-warnings=0
PASS — exit 0, zero warnings

$env:DATABASE_URL='postgresql://test:test@localhost:5432/test'; npx.cmd prisma validate
PASS — schema valid

git diff --check 66197f3c..960d0778
PASS — exit 0

git diff --check 41e7beb9..960d0778
PASS — exit 0

git diff --exit-code
PASS — clean tracked worktree before this rereview artifact

git status --short --untracked-files=all
PASS — clean worktree before this rereview artifact

git rev-parse HEAD
960d07789cc925ed56cb5217a011e82f66934e8a

git merge-base 41e7beb9 HEAD
41e7beb93880ca2c96b4f52db9a64b9077599eb7
```

The four PostgreSQL tests were intentionally not connected to or executed against a database locally. No deferred repository baseline/full build/full lint/live migration/performance gate was run. No implementation file was modified.
