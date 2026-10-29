# Plan 3 Task 2 report — fee schedules and billing-frequency backfill

## Outcome

Task 2 is complete and independently approved after one correction round. All five Important review findings were addressed with no new breakage; one Minor concerning multiple ONE_TIME entries remains explicitly deferred for final whole-branch reconciliation. The implementation and corrections are committed. Focused verification passed 23 tests, with the isolated PostgreSQL migration test intentionally skipped because `TEST_DATABASE_URL` is not set.

## Implemented behavior

- Added the version-1 billing schedule config schema with the exact cadence, date-only start date, structured custom month interval, and shared schedule-entry contracts.
- Added deterministic conversion from legacy MONTHLY, QUARTERLY, SEMI_ANNUALLY, ANNUALLY, and ONE_TIME frequencies. Present start dates create a stable `default` day-of-month entry; missing starts produce an empty entry list and `MISSING_START_DATE`; CUSTOM label-only values produce `INVALID_CUSTOM_SCHEDULE` without guessing an interval or date.
- Added billing schedule evaluation through the existing service-schedule date-only, month-clamping, and business-day APIs. Evaluation preserves calculated versus operative dates, deterministic period/entry/generation keys, stable entry ordering, one-time at-most-one behavior, custom month intervals, requested-range filtering, and legacy amount/currency values.
- Added the SQL backfill migration using the mapped legacy columns and enums. It updates only deterministic fee-line `schedule_config`, leaves CUSTOM `schedule_config` NULL, opens deterministic coverage issues for CUSTOM and missing starts, preserves `UNREVIEWED`, and queues one idempotent pending tenant-scoped `BILLING_BACKFILL` request for each active non-deleted tenant.
- Added unit/contract coverage and a `TEST_DATABASE_URL`-guarded isolated PostgreSQL migration/idempotency/tenant-isolation test. The gated test does not contact a live database locally.

## RED evidence

- Initial equivalent collected command (run from the repository root with the worktree as Vitest root) failed to collect all three new suites because the billing validation/service/migration contracts did not yet exist: 3 files failed with missing-module/missing-file errors and no feature tests passed.
- The exact worktree command was also attempted after implementation and remains blocked at Vitest startup by the environment-specific error below; this is a runner/config-resolution issue, not a test assertion result:

  `npm.cmd run test:run -- __tests__/lib/billing-validation.test.ts __tests__/services/billing-schedule.test.ts __tests__/services/billing-schedule-backfill.test.ts --reporter=dot --maxWorkers=1`

  Exit 1: `Cannot read directory "../../../../../../..": Access is denied` and `Could not resolve ...\\.worktrees\\services-administration\\vitest.config.ts`.

## GREEN evidence

- Equivalent collected focused command:

  `npx.cmd vitest run --root "C:\\Users\\Scotfield\\OneDrive\\Documents\\Python Project\\oakcloud_development\\oakcloud\\.worktrees\\services-administration" --config "C:\\Users\\Scotfield\\OneDrive\\Documents\\Python Project\\oakcloud_development\\oakcloud\\.worktrees\\services-administration\\vitest.config.ts" __tests__/lib/billing-validation.test.ts __tests__/services/billing-schedule.test.ts __tests__/services/billing-schedule-backfill.test.ts --reporter=dot --maxWorkers=1`

  Exit 0: 3 files passed, 18 tests passed.
- Gated migration command for `__tests__/integration/billing-schedule-backfill.postgres.test.ts`: exit 0, 1 file and 1 test skipped because `TEST_DATABASE_URL` was not set.
- Shared compatibility runner (temporary `vitest.task2.config.ts`, removed afterward): 3 files passed, 40 tests passed for billing-tracking schema, shared date engine, and shared schedule validation contracts.
- `npx.cmd tsc --noEmit`: exit 0.
- Scoped ESLint with `--max-warnings=0` over all Task 2 source/tests: exit 0 with no output.
- `$env:DATABASE_URL='postgresql://test:test@localhost:5432/test'; npx.cmd prisma validate`: exit 0; schema valid.
- `git diff --check` and an explicit trailing-whitespace scan over all Task 2 files: no findings.

## Files

- `src/lib/validations/billing.ts`
- `src/services/billing/types.ts`
- `src/services/billing/schedule.ts`
- `src/services/billing/index.ts`
- `prisma/migrations/20260817111000_billing_schedule_backfill/migration.sql`
- `__tests__/lib/billing-validation.test.ts`
- `__tests__/services/billing-schedule.test.ts`
- `__tests__/services/billing-schedule-backfill.test.ts`
- `__tests__/integration/billing-schedule-backfill.postgres.test.ts`

## Self-review and concerns

- No second date language, scheduler, queue, invoice/payment/ledger semantics, or manual historical deadline billing path was added.
- Tenant lineage, archive/status behavior, legacy amount/currency fields, and `UNREVIEWED` defaults are preserved. The migration scopes updates to deterministic enum frequencies and uses deterministic issue/request keys with conflict-safe reruns.
- The shared date-only engine is used for Singapore-safe month clamping and business-day adjustment; no local date arithmetic implementation was introduced.
- PostgreSQL execution remains unproven locally because the required test database URL is absent. CI should run the guarded integration test against an isolated PostgreSQL database before release.
- Restricted subagent execution could not start the worktree-local Vitest command because Vitest/esbuild could not read the worktree config path under the current Windows permissions. A fresh primary-session run of the exact focused command with the required permission passed 23 tests; the PostgreSQL test remained one intentional skip.
- The implementation subagent's `git add` attempt failed before staging with:

  `fatal: Unable to create '...\\.git\\worktrees\\services-administration\\index.lock': Permission denied`

  No lock, ACL, reset, or destructive workaround was attempted. The primary session staged and committed the verified changes.

## Commit

- `fcad7bba` — `feat: define and backfill billing schedules`
- `1e3829e4` — `fix: harden billing schedule boundaries`

The scoped rereview confirmed that all five Important findings were addressed and found no new breakage.

## Deferred gates

Repository-wide baseline/full build/full lint, live migration application, live PostgreSQL, and performance testing remain deferred by the Plan 3 ruling until all Plan 3 tasks are complete.

## Fix round 1/5 — review findings

The five Important findings from `task-2-review.md` were verified against the implementation and corrected without changing the deferred ONE_TIME lexical-first Minor.

- Range evaluation now computes a cadence-aligned one-period look-ahead from the requested end month, so a next-period date moved backward by `PREVIOUS` can be materialized when its operative date falls inside `to`.
- Billing validation now requires fixed cadences to carry their canonical month interval (MONTHLY 1, QUARTERLY 3, SEMI_ANNUALLY 6, ANNUALLY 12), requires CUSTOM to carry a structured interval, and requires ONE_TIME to carry `null`. The evaluator derives fixed cadence intervals from cadence rather than trusting a conflicting value.
- Evaluation filters both calculated and operative dates against the actual `startDate`, preventing first-month entries or business-day adjustments from producing dates before the schedule begins.
- Billing-specific validation still reuses the shared schedule-entry schema/primitives but rejects Company-field, parameter, milestone, schedule-entry, and integer-parameter operands that are not resolvable from the declared billing evaluator input.
- Both legacy issue branches capture only still-unconfigured rows (`schedule_config IS NULL`) before the deterministic UPDATE writes configs. The isolated PostgreSQL regression (gated locally) now inserts legacy rows, applies the migration, mutates/resolves state as a user or reconciliation would, reapplies the migration, and asserts configured schedules and resolved issues are preserved without new open issues.

### Fix-round RED/GREEN evidence

- Amended RED command: the equivalent collected Vitest command for the three focused Task 2 suites exited 1 with 3 files, 7 expected failures, and 16 passing tests. Failures covered canonical intervals, unsupported sources/operands, missing look-ahead, start-date lower bounds, and migration guards.
- Amended GREEN command:

  `npx.cmd vitest run --root "C:\\Users\\Scotfield\\OneDrive\\Documents\\Python Project\\oakcloud_development\\oakcloud\\.worktrees\\services-administration" --config "C:\\Users\\Scotfield\\OneDrive\\Documents\\Python Project\\oakcloud_development\\oakcloud\\.worktrees\\services-administration\\vitest.config.ts" __tests__/lib/billing-validation.test.ts __tests__/services/billing-schedule.test.ts __tests__/services/billing-schedule-backfill.test.ts --reporter=dot --maxWorkers=1`

  Exit 0: 3 files passed, 23 tests passed.
- Gated PostgreSQL migration regression: exit 0, 1 file and 1 test skipped without `TEST_DATABASE_URL`.
- Existing shared compatibility suites: exit 0, 3 files and 40 tests passed using the temporary runner configuration, which was removed immediately afterward.
- `npx.cmd tsc --noEmit`: exit 0.
- Scoped ESLint with `--max-warnings=0`: exit 0 with no output.
- `$env:DATABASE_URL='postgresql://test:test@localhost:5432/test'; npx.cmd prisma validate`: exit 0; schema valid.
- `git diff --check` and explicit trailing-whitespace scan: no findings.

### Fix-round concerns and commit

- Restricted subagent execution still encountered the Windows Vitest/esbuild config access-denied error. The primary session subsequently ran the exact focused worktree command with the required permission: 3 files passed, 23 tests passed, and the gated PostgreSQL suite remained one intentional skip.
- Actual PostgreSQL execution remains a CI gate because `TEST_DATABASE_URL` is absent locally; no live database was contacted.
- The implementation subagent could not stage the fix-round patch because of the shared worktree index-lock permission boundary. The primary session staged and committed it as `1e3829e4`; no lock or ACL was changed.
