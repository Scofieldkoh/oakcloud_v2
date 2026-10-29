### Spec Compliance

- ✅ Spec compliant after correction commit `7e1353e2`.
- All previous requirements met: **Yes.** Every original Important and Minor finding is addressed in the cumulative diff `195d8ca2..7e1353e2`; the correction diff `f6c5c0ac..7e1353e2` introduces no new Critical, Important, or Minor finding.

### Original Finding Verification

#### Critical

- No original Critical findings.

#### Important

1. **Missing custom interval classification — ADDRESSED.**
   - `src/services/billing/coverage.ts:364-394` performs structural checks before full schema parsing. Missing/null `customInterval`, missing interval members, and missing/empty entries now map to `MISSING_SCHEDULE_PARAMETER`, while malformed custom values map to `INVALID_CUSTOM_SCHEDULE`.
   - `__tests__/services/billing-coverage.test.ts:94-111` directly covers `MISSING_START_DATE`, `INVALID_CUSTOM_SCHEDULE`, `MISSING_SCHEDULE_PARAMETER`, `OCCURRENCE_GAP`, and `INVALID_AMOUNT_OR_CURRENCY`, alongside the existing disposition/fee-line cases.

2. **Cancelled occurrences satisfying rolling coverage — ADDRESSED.**
   - `src/services/billing/coverage.ts:147-148` defines the accepted coverage statuses as `OPEN`, `BILLED`, and `WAIVED`; `src/services/billing/coverage.ts:678-682` filters stored identities through that set before gap comparison.
   - `__tests__/services/billing-coverage.test.ts:249-277` verifies each accepted status, and `__tests__/services/billing-coverage.test.ts:279-313` verifies that matching `CANCELLED` identities still produce `OCCURRENCE_GAP`.

3. **Read-then-create issue persistence instead of a concurrency-safe upsert — ADDRESSED.**
   - `src/services/billing/coverage.ts:455-490` uses one PostgreSQL `INSERT ... ON CONFLICT ("tenant_id", "issue_key") WHERE "resolved_at" IS NULL DO UPDATE ... RETURNING` statement on clients with the production raw-query capability.
   - Static PostgreSQL check: the conflict target and predicate exactly infer the existing partial unique index at `prisma/migrations/20260817110000_billing_tracking/migration.sql:104-106`. `INSERT ... RETURNING` is valid through `$queryRaw`; enum and JSON values are explicitly cast; updates preserve `first_detected_at`; and the returned insert/update outcome drives the counts at `src/services/billing/coverage.ts:566-598`.
   - `src/services/billing/coverage.ts:493-563` provides bounded collision reload/update handling for delegate-only clients. The outcome is returned as `opened` or `refreshed` only after the corresponding create/update succeeds.
   - `__tests__/services/billing-coverage.test.ts:360-389` covers a unique-collision reload/update outcome, and `__tests__/services/billing-coverage.test.ts:391-406` covers database-returned atomic open/refresh outcomes.

4. **Inactive-service synthetic gap and Observe/Apply divergence — ADDRESSED.**
   - `src/services/billing/coverage.ts:629-662` no longer creates an `OCCURRENCE_GAP` for existing open occurrences. Genuine unresolved issues are retained without refresh counts or writes in either mode.
   - The same branch identifies the exact legacy synthetic key and resolves only that stale row. Observe reports the proposed resolution count, while Apply uses the affected-row count from the tenant/service/key-scoped update.
   - `__tests__/services/billing-coverage.test.ts:175-247` covers no invented ended-service issue, genuine issue retention with zero refreshes in both modes, and matching Observe/Apply cleanup of the legacy synthetic row.

#### Minor

1. **Structured issue details discarded — ADDRESSED.**
   - `src/services/billing/coverage.ts:226-245` bounds and sanitizes the permitted structured detail fields; `src/services/billing/coverage.ts:411-445` carries `scheduleKey`, `missingCount`, and `firstMissingPeriod` into persistence while keeping the public result shape unchanged.
   - `__tests__/services/billing-coverage.test.ts:300-311` asserts persisted rolling-gap detail fields.

2. **Missing exact-classification and access-query tests — ADDRESSED.**
   - Exact issue classification is table-tested at `__tests__/services/billing-coverage.test.ts:94-111`.
   - `__tests__/services/billing-coverage.test.ts:408-451` verifies tenant predicates, nested company tenant/deletion predicates, restricted/all/empty company scopes, issue filters, and healthy-count scope directly at the service query boundary rather than only through a mocked route service.

### Independent Regression Check

- PostgreSQL partial-index conflict syntax and semantics: no issue found. The inference predicate matches the schema index exactly, and resolved historical rows remain eligible for a new insert because only unresolved rows conflict.
- Collision fallback/count truthfulness: no issue found. Successful create/update/atomic outcomes are counted from the persistence outcome; stale resolution counts use affected-row counts in Apply.
- Inactive lifecycle and Observe parity: no issue found. Paused behavior remains retain/no-write at `src/services/billing/coverage.ts:623-627`; ended/deleted behavior is aligned at `src/services/billing/coverage.ts:629-662`.
- Exact schedule classification, cancelled handling, structured details, and access-scope tests: no new issue found at the evidence cited above.
- Worker, routes, hooks, and public contracts are unchanged by the correction commit, so the previously accepted tenant/access authorization, transaction ordering, retry propagation, query key, and invalidation behavior remain intact.
- Focused read-only check: `git diff --check 195d8ca2..7e1353e2` passed with no output. Per review instructions, the reported focused suites were not redundantly rerun, and no live PostgreSQL check was run. Actual PostgreSQL execution of the raw upsert remains part of the agreed deferred release gate, not a Task 4 defect.

### Current Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

None.

### Severity Counts

- Critical: 0
- Important: 0
- Minor: 0

### Assessment

**Task quality:** Approved

**Verdict:** **PASS**

**Reasoning:** Correction commit `7e1353e2` addresses all four Important and both Minor findings with focused regression coverage. The cumulative implementation now satisfies Task 4's classification, lifecycle, access-scope, Observe/Apply, idempotency, API/hook, and worker integration requirements without introducing new breakage.
