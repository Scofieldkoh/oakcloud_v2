### Finding Verdicts

1. **Critical — initially overridden rows must survive unrelated optimistic collisions while refreshing hidden calculated/base values** — **ADDRESSED.** Protection now compares the reloaded override flags with the initial occurrence: an unchanged initial date/value override remains eligible for retry, while either flag being introduced or removed concurrently returns a protected outcome (`src/services/billing/reconciler.ts:336-363`, `:412-418`). Each retry still uses the fresh `updatedAt`, OPEN/future eligibility, unchanged override flags, and the composite occurrence lineage; the Prisma `where` contains only fields present on `BillingOccurrence` and does not include the in-memory `origin` property (`src/services/billing/reconciler.ts:277-304`; `prisma/schema.prisma:1467-1504`). A write is successful only when `updateMany.count === 1`, and APPLY records the successful overridden-row refresh as persisted `OVERRIDDEN` preservation rather than a recalculation; protected, already-applied, and gone outcomes do not claim a persisted recalculation (`src/services/billing/reconciler.ts:391-420`, `:643-676`). Three still-eligible zero-count attempts continue to raise the transient `BILLING_RECONCILIATION_CONFLICT` (`src/services/billing/reconciler.ts:398-420`; `__tests__/services/billing-reconciler.test.ts:461-479`). The new parameterized tests cover both an initially date-overridden row and an initially value-overridden row, verify two conditional attempts using the fresh token/override snapshot, confirm hidden calculated/base fields are written, and confirm operative date/amount are omitted (`__tests__/services/billing-reconciler.test.ts:339-384`). The existing collision matrix continues to cover overrides introduced by a concurrent writer and verifies they are preserved without a second write (`__tests__/services/billing-reconciler.test.ts:274-305`).

2. **Minor — transaction helper falsely claimed serializable isolation** — **ADDRESSED.** The helper comment now accurately says deadlines and billing share one per-service transaction and no longer promises an isolation level that the `$transaction` call does not configure (`src/services/schedule-reconciliation/worker.ts:250-260`). Runtime transaction behavior and the public helper contract are otherwise unchanged.

### New Breakage in the Fix Diff

- None.

### Out-of-Scope Observations

- None.

### Verification Assessment

- The fix report contains focused RED evidence for both initially overridden variants and fresh GREEN evidence for the six-file matrix, TypeScript, scoped zero-warning ESLint, and diff checks. The controller independently supplied a newer result of 91 passed and 1 guarded PostgreSQL skip. Source inspection resolves the reviewed branches, so I did not rerun tests. The guarded live-PostgreSQL execution remains the already-deferred release gate, not an open fix-round finding.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.

**Final Task 3 verdict:** **PASS — spec compliant and quality acceptable for integration.** The Critical optimistic-collision gap and all prior Task 3 findings are closed; the isolated live-PostgreSQL run remains deferred to the release gate as previously agreed.
