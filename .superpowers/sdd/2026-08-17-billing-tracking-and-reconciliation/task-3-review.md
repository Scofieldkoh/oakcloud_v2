### Spec Compliance

- ❌ Issues found. The implementation covers rolling creation, ordinary preservation, archival persistence, shared-worker invocation, and create-side deduplication, but it does not safely preserve concurrent user lifecycle/override changes, does not persist required automatic cancellations for actor-less daily requests, does not enqueue fee-only changes, and exposes archived fee lines through normal DTO/edit flows. Those gaps violate the approved preservation, cancellation, retry/idempotency, and archival requirements (`docs/superpowers/specs/2026-08-17-services-administration-deadlines-billing-design.md:655-670`, `:789-854`; `docs/superpowers/plans/2026-08-17-billing-tracking-and-reconciliation.md:491-543`).
- ⚠️ Cannot verify from this task alone: the later Task 5 disposition/schedule form contract, Task 4 coverage issues, Task 6 lifecycle APIs, and Task 8 full isolation/performance/operations gates are outside `bbe8d119..c36f141a`. The Task 1 database actor constraint is pre-existing and accepted; the in-scope defect is Task 3 completing automatic cancellation work without satisfying it.

### Strengths

- Creation uses the schema identity and returns PostgreSQL's persisted `createMany` count (`src/services/billing/reconciler.ts:298-327`); the isolated PostgreSQL test exercises two real concurrent reconciler calls and verifies both total persisted rows and duplicate identities (`__tests__/integration/billing-reconciliation.postgres.test.ts:78-156`).
- The normal diff correctly distinguishes historical and non-Open rows, refreshes calculated/base values while retaining the corresponding operative override, caps generation at an active service's end date, and suspends extension for paused services (`src/services/billing/reconciler.ts:392-405`, `:467-527`).
- Billing runs once after deadlines with the same tenant, service, date window, write mode, request ID, lease assertion, and per-service database transaction (`src/services/schedule-reconciliation/worker.ts:471-496`). Aggregation and log sanitization retain structured counts/IDs without free-text warning messages (`src/services/schedule-reconciliation/worker.ts:96-137`, `:501-550`).
- Fee removal is a tenant/client-scoped soft archive, and a submitted archived ID receives a new row ID instead of mutating the archived lineage (`src/services/client-service/service.ts:937-987`).

### Issues

#### Critical (Must Fix)

1. `src/services/billing/reconciler.ts:241-260`, `:467-522`, `:538-555` — reconciliation decisions are read-then-write, but every update predicate reasserts only `id + tenantId + clientServiceId`. If a user marks a row Billed/Waived or adds an override after the read, recalculation can overwrite the newly operative value, and cancellation can act on a row that is no longer eligible. A concurrent Billed/Waived transition can also turn the cancellation into a constraint failure and roll back the service. This breaks the core requirement to preserve Billed, Waived, Cancelled, and overridden rows and makes retries unsafe. Moreover, `updateOccurrence` discards `updateMany.count`, while `recalculated` and `cancelled` are incremented before/irrespective of the write, so APPLY summaries need not describe persisted outcomes. Fix by carrying an optimistic token (preferably `updatedAt`) from the read and using conditional `updateMany` predicates that reassert the expected status, operative-date eligibility, origin, and override flags. Count only affected rows; on a zero count, reload/reclassify or retry safely. Add real PostgreSQL races against Billed, Waived, date override, value override, and cancellation.

#### Important (Should Fix)

1. `src/services/schedule-reconciliation/worker.ts:201-218`, `src/services/billing/reconciler.ts:272-295`, `:549-555`, `src/services/schedule-reconciliation/worker.ts:531-550` — the daily `ROLLING_HORIZON` contract always has `requestedById: null`. In APPLY, eligible cancellations therefore produce only `CANCELLATION_ACTOR_REQUIRED`; nevertheless the reconciler increments `cancelled`, and the worker persists a COMPLETED summary. The live Task 1 constraint requires `cancelledAt + cancelledById + cancellationReason` (`prisma/migrations/20260817110000_billing_tracking/migration.sql:179-183`), but warning/no-write does not satisfy Task 3's cancellation or idempotency acceptance criteria: each daily run rediscovers the same Open row while operational summaries claim it was cancelled. Establish an approved automatic actor policy (for example, a durable tenant/system principal valid for the FK), or revise the schema/domain contract explicitly; then write all cancellation metadata atomically. Until that policy exists, APPLY must not report a persisted cancellation or mark the request successfully reconciled.

2. `src/services/client-service/service.ts:884-892`, `:998-1041` — `feesChanged` is deliberately computed and persisted, but it is excluded from `scheduleConfigurationChanged`, the only condition that creates an actor-backed reconciliation request. Removing/replacing a fee line therefore archives the source without queueing billing cancellation. The only later path is the actor-less daily request above, which cannot persist cancellation, so future Open rows can remain indefinitely. Split deadline-impact-preview decisions from reconciliation enqueue decisions: fee changes need no deadline preview, but they must enqueue `CLIENT_SERVICE_CONFIGURATION_CHANGED` in the same serializable transaction with `requestedById: params.userId`. Add a test asserting the archive/update and enqueue occur together.

3. `src/services/client-service/mapper.ts:4-5`, `:49-74`, `src/services/client-service/service.ts:937-987` — the shared include returns every fee line, and the public DTO strips `isActive/deletedAt`, making archived rows indistinguishable from active ones. A removed fee therefore immediately reappears in service lists/editor state; on a later fee edit, the submitted archived ID enters the replacement branch and is cloned under another UUID. This violates removal semantics and can repeatedly grow duplicate visible fee lines. Keep archived rows available to the internal reconciliation/update lineage logic, but filter public DTOs/edit inputs to `isActive: true, deletedAt: null` (or use separate internal/public includes). Add an end-to-end service test proving a removed row is absent from the returned DTO and a subsequent edit neither resubmits nor recreates it.

#### Minor (Nice to Have)

1. `__tests__/integration/billing-reconciliation.postgres.test.ts:78-156` — the guarded test is a useful real-database create/idempotency check, but it calls the reconciler directly and covers only concurrent creation. It does not exercise the production worker's per-service transaction/lease path, persisted cancellation metadata, recalculation counts, or conflicts with lifecycle/override writes. Extend the isolated suite with those production-path cases; retain the existing `TEST_DATABASE_URL` guard and random-schema cleanup.

### Pre-existing / Out of Scope

- The non-null cancellation-actor check and restrictive user FK predate this target range. They are not findings against Task 1 here; Task 3 must integrate with the accepted invariant rather than silently downgrade cancellation to a warning.
- Billing disposition/schedule authoring, coverage materialization, occurrence lifecycle APIs/UI, full repository verification, live migrations, and performance gates belong to later tasks or were explicitly deferred. They were not graded as missing in this task review.

### Assessment

**Spec verdict:** Not compliant — 1 Critical, 3 Important, 1 Minor.

**Quality verdict:** Needs fixes.

**Reasoning:** The create path is clean and genuinely deduplicated, and the shared transaction/summary structure is sound. The update/cancellation path is not concurrency-safe, reports non-persisted outcomes, and currently cannot complete the primary automatic/fee-removal cancellation lifecycle; archived-row DTO leakage adds a separate lineage regression.
