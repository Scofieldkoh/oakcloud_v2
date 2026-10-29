# Task 3 Handoff Report — Rolling Billing Reconciliation

## Outcome

**DONE**

Task 3 is implemented, corrected through three scoped review rounds, and independently accepted as spec compliant with no open findings. The implementation is committed across `c36f141a`, `4f638b17`, `9a7df209`, and `baa1e7e1`. Final controller verification passed 91 focused tests with one intentional PostgreSQL skip; the isolated live-PostgreSQL run remains the agreed deferred release gate.

## Files

Committed implementation and test files:

- `src/services/billing/reconciler.ts`
- `src/services/billing/index.ts`
- `src/services/billing/types.ts`
- `src/services/schedule-reconciliation/types.ts`
- `src/services/schedule-reconciliation/worker.ts`
- `src/services/schedule-reconciliation/index.ts`
- `src/services/client-service/service.ts`
- `__tests__/services/billing-reconciler.test.ts`
- `__tests__/services/schedule-reconciliation-worker.test.ts`
- `__tests__/services/client-service.service.test.ts`
- `__tests__/integration/billing-reconciliation.postgres.test.ts`

This report includes the initial implementation and every correction/review round. The handoff artifact is committed separately from the implementation commits.

## TDD evidence

1. Added the focused billing reconciler tests before the implementation.
2. RED: `npm.cmd run test:run -- __tests__/services/billing-reconciler.test.ts --reporter=dot` failed with 8 tests failing because `reconcileClientServiceBilling` was not exported/implemented (`TypeError: reconcileClientServiceBilling is not a function`).
3. Implemented the smallest shared-worker/reconciler path, then added invalid-schedule and actor-invariant regression assertions.
4. GREEN: the final focused matrix passed 5 test files with **67 passed, 1 skipped**. The one skipped file is the guarded PostgreSQL integration suite because `TEST_DATABASE_URL` is absent locally.

## Verification

- Focused unit/compatibility/guarded integration matrix:
  `npm.cmd run test:run -- __tests__/services/billing-reconciler.test.ts __tests__/services/schedule-reconciliation.test.ts __tests__/services/schedule-reconciliation-worker.test.ts __tests__/services/schedule-reconciliation-observability.test.ts __tests__/services/client-service.service.test.ts __tests__/integration/billing-reconciliation.postgres.test.ts --reporter=dot`
  — 5 passed, 1 guarded skip; 67 passed, 1 skipped.
- `npx.cmd tsc --noEmit` — exit 0.
- Scoped zero-warning ESLint over all changed source/test files — exit 0.
- `$env:DATABASE_URL='postgresql://test:test@localhost:5432/test'; npx.cmd prisma validate` — schema valid.
- `git diff --check` and staged diff whitespace check — clean.
- PostgreSQL integration is isolated by a random schema, applies migrations only inside that schema, uses `TEST_DATABASE_URL`, and skips when the variable is absent. It was not run against a live database locally.

## Implemented behavior

- Reconciles active `CONFIGURED` fee lines from Singapore `today` through the shared 12-month horizon using Task 2's schedule evaluator and business calendar.
- Uses deterministic fee-line/period/schedule-entry/generation identity and `createMany({ skipDuplicates: true })` for retry/concurrency-safe creation.
- Recalculates only future open non-overridden rows; refreshes hidden calculated/base values for overrides while retaining operative values.
- Preserves manual, historical, billed, waived, cancelled, and overridden rows.
- Stops generation for paused, ended, archived/deleted, and `NOT_REQUIRED` services; caps an active service at its end date.
- Excludes inactive/archived fee lines and cancels only eligible future open generated rows when a source is removed or billing is marked not required.
- Invalid amount/currency or incomplete/invalid schedule emits a permanent warning and leaves that fee line's existing rows untouched for review.
- Runs billing once per client service after deadline reconciliation inside the same worker transaction, with the same tenant, date horizon, write mode, request ID, and lease assertion.
- Includes archived client services in worker scope resolution so eligible future rows can be cancelled without extending archived services.
- Replaces client-service fee-line deletion with tenant-scoped archival (`isActive=false`, `deletedAt`, and reason); archived rows are never reused and agreement lineage is retained.
- Manual historical cycle creation remains outside the shared request queue, so it cannot reach billing reconciliation or create billing occurrences.
- Billing code has no invoice, payment, ledger, or external billing side effects.

## Initial cancellation actor concern — resolved in fix round 1

Task 1's accepted live constraint requires every `CANCELLED` billing row to have `cancelledAt`, non-null `cancelledById`, and `cancellationReason`; the actor foreign key is `ON DELETE RESTRICT`. The automatic `ROLLING_HORIZON` request contract intentionally sets `requestedById: null`, while archive/configuration requests carry the acting user.

The initial implementation forwarded `requestedById` but could not persist actor-less automatic cancellations. Fix round 1 resolved this with durable, tenant-scoped reconciliation-request provenance and a forward migration: every automatic cancellation retains its request ID, retains the human requester when one exists, and never invents a user. The final lifecycle constraint requires timestamp, trimmed reason, and a human actor and/or restrictive request provenance.

## Deferred gates

Per the task instructions, repository-wide tests, full lint/build, live migrations/database mutations, and performance tests were intentionally deferred until the complete implementation is assembled. The guarded PostgreSQL test should be run in isolated CI with `TEST_DATABASE_URL` before release.

## Commit

`c36f141a` — `feat: reconcile billing tracking occurrences`

`4f638b17` — `fix: make billing reconciliation concurrency safe`

`9a7df209` — `fix: retry billing reconciliation conflicts`

`baa1e7e1` — `fix: preserve overrides across reconciliation retries`

## Fix round 1/5 — review corrections

### Outcome

**DONE** — all requested code/test corrections are implemented, committed as `4f638b17`, and verified. The guarded PostgreSQL suite is intentionally skipped locally because `TEST_DATABASE_URL` is absent.

### Finding resolution

1. **Critical concurrency and truthful APPLY counts — ADDRESSED.** `reconciler.ts` now carries `updatedAt` and the stored identity/lifecycle snapshot into every recalculation/cancellation `updateMany`. Predicates reassert tenant, service, occurrence identity, expected timestamp, `OPEN`, future operative date, and override flags. APPLY increments `recalculated`/`cancelled` only when `count === 1`; a zero count reloads and classifies the current row as preserved. OBSERVE continues to report projected actions. Unit races cover Billed, Waived, date override, value override, and cancellation-token conflicts; the guarded PostgreSQL test uses a lease barrier to make those races real.
2. **Actor-less rolling cancellation — ADDRESSED.** Added `cancellationReconciliationRequestId` and a tenant-scoped `ON DELETE RESTRICT` FK to `ServiceScheduleReconciliationRequest`. Forward migration `20260824100000_billing_reconciliation_provenance` replaces the accepted Task 1 check with the approved invariant: CANCELLED requires timestamp, trimmed reason, and either a human actor or request provenance; non-CANCELLED rows require all cancellation metadata/provenance to be null. Worker cancellations always persist the request ID and persist `requestedById` when present; no synthetic user is selected. Unit and guarded PostgreSQL assertions verify actor-less cancellation writes, truthful counts, request provenance, and invalid-state rejection.
3. **Fee-only configuration enqueue — ADDRESSED.** Fee changes now create `CLIENT_SERVICE_CONFIGURATION_CHANGED` with `requestedById=params.userId` inside the existing Serializable transaction. Fee-only edits do not require a deadline impact fingerprint/preview. The transactional service test verifies the enqueue and fee write path together.
4. **Archived fee-line public/edit leakage — ADDRESSED.** Public DTO mapping explicitly excludes inactive/deleted fee lines while the internal service include retains archived rows for archival/lineage decisions. Active fee comparisons ignore archived rows, and submitting an archived ID to a normal edit is rejected rather than cloning it. Service tests verify removed rows disappear from DTOs and later edits do not recreate/resubmit archived lineage.
5. **Guarded PostgreSQL coverage — ADDRESSED_WITH_LOCAL_SKIP.** The isolated suite now applies the forward provenance migration, seeds a durable request with `requestedById = NULL`, executes production reconciler races for Billed/Waived/date override/value override/cancellation, verifies actor-less persisted cancellation, and exercises the production lifecycle checks. It retains random-schema cleanup and the `TEST_DATABASE_URL` guard. Worker invocation/lease semantics remain covered by the focused worker compatibility suite.

### Generation-key reassessment

The billing generation key is now derived from the fee-line row identity only. Schedule-entry reordering and ordinary schedule edits therefore recalculate the current/future generation in place; archival/replacement (the public reactivation path) creates a new fee-line identity and generation without reopening cancelled rows. Regression coverage verifies reordered and edited schedules retain the generation while a replacement fee-line ID receives a new one.

### TDD and verification evidence

- Fix RED: `npx.cmd vitest run __tests__/services/billing-reconciler.test.ts __tests__/services/client-service.service.test.ts __tests__/services/billing-tracking-schema.test.ts --reporter=dot` exited 1 with **3 failed files, 10 failed tests, 36 passed**. Failures were the missing request provenance/actor-less write, zero-count concurrency handling, fee-only enqueue, generation lifecycle, public archive filtering, and absent forward migration.
- The first `npm.cmd run test:run` wrapper attempt could not load the worktree config because the sandbox denied its parent-directory probe; the direct `npx.cmd vitest` run above provided the actual RED evidence.
- Focused GREEN: the same three-file command exited 0 with **3 passed files, 46 passed tests**.
- After correcting the generation-race fixtures to use the active fee-line lifecycle key, the billing reconciler suite exited 0 with **1 passed file, 15 passed tests**; the final compatibility matrix below includes that corrected coverage.
- Compatibility GREEN: `npx.cmd vitest run __tests__/services/billing-reconciler.test.ts __tests__/services/client-service.service.test.ts __tests__/services/billing-tracking-schema.test.ts __tests__/services/schedule-reconciliation-worker.test.ts __tests__/services/schedule-reconciliation-observability.test.ts __tests__/integration/billing-reconciliation.postgres.test.ts --reporter=dot` exited 0 with **5 passed files, 1 guarded skip; 60 passed, 1 skipped**.
- `npx.cmd tsc --noEmit` exited 0.
- Scoped ESLint over changed source/tests exited 0 with no warnings/errors.
- `$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/oakcloud'; npx.cmd prisma validate` exited 0 (`The schema at prisma\\schema.prisma is valid`). `npx.cmd prisma generate` exited 0 and generated the updated BillingOccurrence/request relation types.
- `git diff --check` exited clean. The PostgreSQL suite was not run against a live database because `TEST_DATABASE_URL` is absent locally.

### Files changed in this fix

- `src/services/billing/reconciler.ts`, `src/services/billing/types.ts`
- `src/services/client-service/mapper.ts`, `src/services/client-service/service.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260824100000_billing_reconciliation_provenance/migration.sql`
- Generated Prisma artifacts for `BillingOccurrence` and `ServiceScheduleReconciliationRequest` plus their namespace/client metadata
- `__tests__/services/billing-reconciler.test.ts`
- `__tests__/services/client-service.service.test.ts`
- `__tests__/services/billing-tracking-schema.test.ts`
- `__tests__/integration/billing-reconciliation.postgres.test.ts`

### Self-review and concerns

- Automatic cancellations never invent or select a user; request provenance is durable, tenant-scoped, restrictive, and retained by the database.
- Non-APPLY modes do not write. APPLY counters reflect affected-row counts, and concurrent state changes are preserved rather than overwritten.
- Historical, BILLED, WAIVED, CANCELLED, and overridden rows remain protected; archived fee lines are soft-archived and never deleted.
- Manual historical cycles still do not enqueue reconciliation requests, and no invoice/payment/ledger side effects were added.
- The public edit path intentionally rejects an archived fee-line ID; a later explicit reactivation flow can add a fresh fee-line lifecycle. The guarded PostgreSQL race and migration assertions remain pending in an environment with `TEST_DATABASE_URL`.

### Commit / staging

Attempted focused staging/commit for `fix: make billing reconciliation concurrency safe`, but Git returned:

`fatal: Unable to create '.../.git/worktrees/services-administration/index.lock': Permission denied`

The implementation subagent could not stage through the shared worktree index boundary. The primary session staged the verified files and committed them as `4f638b17`; no lock or ACL was changed.

## Fix round 2/5 — rereview corrections

### Outcome

**DONE** — both partially addressed rereview findings are resolved, committed as `9a7df209`, and verified. The guarded PostgreSQL suite remains locally skipped because `TEST_DATABASE_URL` is absent.

### Finding resolution

1. **Critical — optimistic collision retry and truthful APPLY counts — ADDRESSED.** Recalculation and cancellation now use one bounded optimistic mutation helper (three total `updateMany` attempts). Every retry reloads the occurrence and reasserts tenant/service, stable billing identity, fresh `updatedAt`, `OPEN`, future operative date, origin, and the original override snapshot. A fresh BILLED, WAIVED, CANCELLED, historical, manual, or override transition is preserved and counted under its actual reason. A fresh future OPEN row with the same identity and unchanged eligibility is retried; if its desired mutation is already present, the reconciler returns without claiming a write. If all bounded attempts collide while the row remains eligible and undesired, it throws `BILLING_RECONCILIATION_CONFLICT`; the worker exposes that code as a safe transient outcome so the request is retried rather than completed with stale state. APPLY `recalculated` and `cancelled` counters still increment only after `updateMany.count === 1`; OBSERVE remains projection-only. Unit coverage now exercises unrelated-note retries for both operations, already-applied recalculation, protected cancellation, and bounded exhaustion. The isolated PostgreSQL cancellation race now expects the same reconciliation to cancel the still-eligible row (`cancelled = 8`) and no longer invokes a second reconciliation workaround; the concurrent note is asserted preserved.

2. **Minor — production worker transaction/lease PostgreSQL coverage — ADDRESSED.** Added `reconcileClientServiceThroughWorkerTransaction`, a typed helper accepting the real Prisma client and transaction inputs. The production batch worker calls this helper for each client service, and it executes deadline reconciliation followed by billing reconciliation in one transaction while forwarding request ID, operation, write mode, horizon, cancellation actor, and lease assertion. Focused worker coverage verifies lease invocation, transaction use, and deadline-before-billing ordering. The guarded isolated PostgreSQL fixture invokes the same helper against its random schema with the actor-less request and a no-deadline-rule service, exercising the production transaction path without changing the public batch contract.

### TDD and verification evidence

- Rereview read completely before edits; the current implementation was verified against both findings before tests were changed.
- Fix RED (concurrency): `npx.cmd vitest run __tests__/services/billing-reconciler.test.ts --reporter=dot` exited 1 with **4 failed, 16 passed** after adding the eligible-retry/already-applied/bounded cases. Failures showed no retry, false preserved behavior, and no conflict error.
- Fix RED (worker path): `npx.cmd vitest run __tests__/services/schedule-reconciliation-worker.test.ts -t "runs deadlines then billing" --reporter=dot` exited 1 with `TypeError: reconcileClientServiceThroughWorkerTransaction is not a function` before the helper existed.
- Focused GREEN matrix: `npx.cmd vitest run __tests__/services/billing-reconciler.test.ts __tests__/services/client-service.service.test.ts __tests__/services/billing-tracking-schema.test.ts __tests__/services/schedule-reconciliation-worker.test.ts __tests__/services/schedule-reconciliation-observability.test.ts __tests__/integration/billing-reconciliation.postgres.test.ts --reporter=dot` exited 0 with **5 passed files, 1 skipped; 66 passed, 1 skipped**.
- `npx.cmd tsc --noEmit` exited 0 after the helper and retry changes.
- Scoped zero-warning ESLint over the changed reconciler/worker and focused unit/integration files exited 0.
- `git diff --check` exited 0.
- The PostgreSQL integration test remained guarded and skipped locally (`TEST_DATABASE_URL` absent); no live migration/database mutation was run.

### Self-review and concerns

- The retry helper never invents an actor: automatic cancellation persists the supplied reconciliation request provenance and optional requested user through the existing cancellation data path.
- Eligible future OPEN rows are never reported as HISTORICAL merely because an unrelated write changed `updatedAt`; they retry, no-op when already applied, or raise the bounded transient conflict.
- Identity-mismatched/deleted rows are not overwritten; protected rows retain the existing preservation accounting. No persisted fee-line deletion or public archived-line reintroduction was added.
- The production helper is used by the worker itself, and the guarded integration test uses the same helper with a real Prisma transaction. Live PostgreSQL execution remains the deferred release gate.

### Commit / staging

Attempted focused staging/commit `fix: retry billing reconciliation conflicts` for the round-2 files, but Git is expected to hit the known shared-worktree lock restriction:

`fatal: Unable to create '.../.git/worktrees/services-administration/index.lock': Permission denied`

No lock or ACL was removed or changed. The primary session staged the verified round-2 files and committed them as `9a7df209`.

Implementation-subagent attempt outcome: `git add --` failed with `fatal: Unable to create 'C:/Users/Scotfield/OneDrive/Documents/Python Project/oakcloud_development/oakcloud/.git/worktrees/services-administration/index.lock': Permission denied`; the primary session subsequently created `9a7df209`.

### Pre-commit controller correction

The controller identified that an interim retry predicate included nonexistent `BillingOccurrence.origin`. A regression assertion was added first; RED was observed in the focused unit (`expected ... not to have property "origin"`, 1 failed). The predicate was removed without adding a schema column. GREEN then passed for the targeted regression and the unchanged focused matrix (**5 passed files, 1 skipped; 66 passed, 1 skipped**). Final `npx.cmd tsc --noEmit`, scoped zero-warning ESLint, and `git diff --check` all exited 0. No staging or commit retry was performed after the known index-lock failure.

## Fix round 3/5 — rereview-2 corrections

### Outcome

**DONE** — the remaining Critical override-collision branch and the documentation Minor are resolved, committed as `baa1e7e1`, and verified. The guarded PostgreSQL suite is still skipped locally because `TEST_DATABASE_URL` is absent.

### Finding resolution

1. **Critical — pre-existing override collision — ADDRESSED.** `isGenuinelyProtected` now compares fresh date/value override flags with the initial snapshot. An unchanged initial override remains mutation-eligible for hidden calculated/base refresh, while a newly introduced or removed override, historical/non-OPEN state, manual/non-rule origin, or identity change is preserved. The conditional `updateMany` still excludes protected operative fields: initially date-overridden rows never write `operativeExpectedDate`, initially value-overridden rows never write `operativeAmount`; hidden calculated/base fields refresh only after the fresh-token retry succeeds. New parameterized unit cases cover both initial date- and value-overridden rows with unrelated notes/token collisions, two conditional attempts, updated `updatedAt`/override predicates, hidden-field writes, protected-field omissions, and `OVERRIDDEN` preservation accounting.

2. **Minor — transaction comment isolation claim — ADDRESSED.** Updated the worker helper comment from “serializable service transaction” to “one per-service transaction,” accurately describing the existing `$transaction` call without changing isolation behavior.

### TDD and verification evidence

- Rereview-2 was read completely and the current override/protection ordering was verified before edits.
- Fix RED: `npx.cmd vitest run __tests__/services/billing-reconciler.test.ts -t "initially (date-overridden|value-overridden)" --reporter=dot` exited 1 with **2 failed, 20 skipped**; both cases made only one conditional attempt and preserved stale hidden values.
- Focused GREEN matrix: `npx.cmd vitest run __tests__/services/billing-reconciler.test.ts __tests__/services/client-service.service.test.ts __tests__/services/billing-tracking-schema.test.ts __tests__/services/schedule-reconciliation-worker.test.ts __tests__/services/schedule-reconciliation-observability.test.ts __tests__/integration/billing-reconciliation.postgres.test.ts --reporter=dot` exited 0 with **5 passed files, 1 skipped; 68 passed, 1 skipped**.
- `npx.cmd tsc --noEmit` exited 0.
- Scoped zero-warning ESLint over the changed reconciler/worker and focused tests exited 0.
- `git diff --check` exited 0.
- The PostgreSQL test remained guarded and skipped locally (`TEST_DATABASE_URL` absent); no live database or migration gate was run.

### Self-review and concerns

- Existing overrides continue to protect operative date/value fields even across an unrelated `updatedAt` collision; only hidden calculated/base data is retried.
- Concurrent override introduction/removal remains preserved rather than overwritten, and APPLY counters reflect only the successful retry write.
- The worker helper comment now makes no unsupported isolation-level promise; no public contract or transaction isolation setting was changed.

### Commit / staging

The implementation subagent's focused staging attempt remained blocked by the shared-worktree index boundary. The primary session staged the verified round-3 files and committed them as `baa1e7e1`; no lock or ACL was changed.

Implementation-subagent attempt outcome: `git add --` failed with `fatal: Unable to create 'C:/Users/Scotfield/OneDrive/Documents/Python Project/oakcloud_development/oakcloud/.git/worktrees/services-administration/index.lock': Permission denied`; the primary session subsequently created `baa1e7e1`.
