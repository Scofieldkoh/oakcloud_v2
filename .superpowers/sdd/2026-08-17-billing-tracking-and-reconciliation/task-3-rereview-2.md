### Finding Verdicts

1. **Critical — optimistic collision completion, classification, and truthful APPLY counts** — **PARTIALLY ADDRESSED.** The bounded helper makes three conditional `updateMany` attempts, reloads after each collision, detects already-applied values, and throws `BILLING_RECONCILIATION_CONFLICT` only when a row remains eligible and undesired (`src/services/billing/reconciler.ts:326-413`). APPLY counters increment only for `UPDATED`; protected rows use their fresh reason, while `ALREADY_APPLIED`/`GONE` do not claim a write (`src/services/billing/reconciler.ts:649-669`, `:696-711`). All predicate fields are real `BillingOccurrence` fields; `origin` is used only in memory and is absent from the Prisma `where` (`src/services/billing/reconciler.ts:263-290`, `:344-356`). The worker allowlists the conflict code but does not mark it permanent, so the existing safe transient path stores only the generic retry message and returns the request to bounded backoff (`src/services/schedule-reconciliation/worker.ts:35-53`, `:597-665`). The unrelated-notes cancellation race now completes in the same reconciler invocation and retains the note (`__tests__/integration/billing-reconciliation.postgres.test.ts:258-268`).

   One required case remains wrong: an occurrence that was already date/value-overridden at the initial read is intentionally eligible for hidden calculated/base refresh (`src/services/billing/reconciler.ts:635-648`). After an unrelated optimistic collision, its fresh override flags still equal the initial snapshot, so `isMutationEligible` says it remains eligible (`src/services/billing/reconciler.ts:344-356`), but the earlier unconditional `isGenuinelyProtected` check treats any override as protected and exits without retrying (`src/services/billing/reconciler.ts:336-342`, `:405-411`). That leaves calculated/base values stale and completes the request, contrary to Task 3's requirement that override flags preserve operative fields while calculated/base values refresh. Distinguish a newly introduced override from an unchanged initial override: preserve when the fresh flags differ from the initial snapshot; otherwise retry the hidden-field mutation. Add date-overridden and value-overridden rows with an unrelated notes/token collision.

2. **Minor — guarded PostgreSQL production worker transaction/lease coverage** — **ADDRESSED.** `processSingleRequest` now calls `reconcileClientServiceThroughWorkerTransaction` directly for every resolved service with the claimed request ID/requester, derived rule operation, shared date window/write mode, and the real lease callback (`src/services/schedule-reconciliation/worker.ts:522-534`). The helper asserts the lease, opens one Prisma transaction, invokes deadlines before billing on the same transaction client, and forwards the same request/window/mode/lease inputs (`src/services/schedule-reconciliation/worker.ts:237-284`). The unit test verifies one transaction and invocation ordering (`__tests__/services/schedule-reconciliation-worker.test.ts:102-122`). The guarded test invokes that exact helper against the random-schema Prisma client and actor-less seeded request before its real PostgreSQL races (`__tests__/integration/billing-reconciliation.postgres.test.ts:173-186`); its existing `TEST_DATABASE_URL` guard and schema cleanup keep it isolated.

### New Breakage in the Fix Diff

- **Minor:** `src/services/schedule-reconciliation/worker.ts:250-260` calls the helper transaction “serializable,” but `$transaction` supplies no `isolationLevel`, so PostgreSQL uses the configured/default isolation level. The behavior required here is one shared transaction and is implemented; correct the comment to avoid a false concurrency guarantee, or explicitly set/handle serializable isolation if that is truly intended.

### Out-of-Scope Observations

- None.

### Verification Assessment

- The updated report includes focused reconciler and worker RED evidence, a 66-test focused matrix plus guarded skip, and TypeScript/scoped lint/diff checks. The controller independently supplied a newer 89-pass matrix plus the same guarded skip. I did not rerun them because the remaining overridden-row branch is not covered by those tests and is directly decidable from the retry ordering above.

### Verdict

**Fix round:** Findings remain open. Finding 2 is addressed. Finding 1 remains partially addressed for pre-existing overridden rows that collide on an unrelated write; there is also one new Minor documentation mismatch about transaction isolation.
