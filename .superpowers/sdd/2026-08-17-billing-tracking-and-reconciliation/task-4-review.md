### Spec Compliance

- ❌ Issues found. The routes, hook, public exports, worker summary, access-scoped query shape, seven issue-type union, and Observe/Apply entry point are present, but the implementation does not meet all Task 4 requirements. Missing custom parameters are misclassified, cancelled occurrences can hide real rolling-horizon gaps, detected issues are not atomically upserted, and inactive-service handling neither represents nor resolves its synthetic issue correctly.
- Previous requirements met: **No.** The tenant/access predicates and worker failure propagation are implemented, but the blocking findings below mean the complete Task 4 contract is not satisfied.

### Strengths

- `src/app/api/billing-coverage/route.ts:53-76` requires `company:read`, intersects requested company IDs with the caller's accessible-company scope, and passes the resulting scope into the service query rather than filtering tenant-wide results in memory.
- `src/app/api/client-services/[id]/billing/reconcile/route.ts:19-39` derives tenant and actor data from the session, loads the service through company scope, checks `company:update` for the resolved company, and enqueues the required `CLIENT_SERVICE` / `BILLING_MANUAL_RECONCILE` request.
- `src/services/schedule-reconciliation/worker.ts:259-294` runs deadlines, billing, and coverage in order inside one per-service transaction; `src/services/schedule-reconciliation/worker.ts:628-694` leaves thrown coverage failures on the existing bounded retry/error path and therefore does not mark the request complete.
- `src/services/billing/coverage.ts:562-575` and `src/services/billing/coverage.ts:623-657` keep issue and healthy-count queries tenant-scoped and company-scoped at the database layer.
- `src/hooks/use-billing-coverage.ts:21-35` builds the required stable normalized query key, and `src/hooks/use-billing-coverage.ts:84-99` invalidates coverage, occurrences, roster indicators, and the selected client service after enqueue.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

1. **A missing custom interval is reported as an invalid custom schedule instead of a missing schedule parameter.**
   - Evidence: `src/services/billing/coverage.ts:305-316`. `billingScheduleConfigSchema.parse()` rejects a `CUSTOM` config with `customInterval: null`, so the intended check at line 310 is unreachable; the catch block maps every failed `CUSTOM` parse to `INVALID_CUSTOM_SCHEDULE`. An empty/missing custom schedule parameter therefore cannot produce the required `MISSING_SCHEDULE_PARAMETER` classification.
   - Why it matters: Task 4 explicitly separates incomplete required parameters from invalid custom definitions. The wrong issue type drives the wrong remediation copy/filtering and breaks deterministic issue lifecycle when a configuration moves between incomplete and malformed states.
   - Fix: inspect structural omissions (`startDate`, `customInterval`, and entries) before full schema validation, or map the Zod issue paths deterministically so missing required fields become `MISSING_SCHEDULE_PARAMETER` and malformed custom definitions become `INVALID_CUSTOM_SCHEDULE`. Add focused tests for both classifications.

2. **Cancelled occurrences incorrectly satisfy current rolling-horizon coverage.**
   - Evidence: `src/services/billing/coverage.ts:273-280` loads every status, and `src/services/billing/coverage.ts:504-505,535` puts every stored identity into `occurrenceKeys`. The test at `__tests__/services/billing-coverage.test.ts:155-183` explicitly treats `CANCELLED` as valid coverage.
   - Why it matters: cancellation is system-only lifecycle state, not an existing billable occurrence. Because generation identity is stable for a fee line, a schedule changed away and later changed back can produce an expected identity that exists only as `CANCELLED`; Task 3 preserves that row, and this code then reports the service healthy even though no live occurrence covers the expected period. This violates the requirement that expected occurrences exist throughout the rolling horizon.
   - Fix: define the statuses that can satisfy expected coverage and exclude `CANCELLED` (normally `OPEN`, `BILLED`, and `WAIVED` satisfy an expected identity). Replace the current mixed-status test with explicit accepted-status cases plus a regression asserting that a matching cancelled row still produces `OCCURRENCE_GAP`.

3. **Detected issues are implemented as a read-then-create sequence, not the required concurrency-safe upsert.**
   - Evidence: `src/services/billing/coverage.ts:258-265` reads open issues, then `src/services/billing/coverage.ts:381-417` updates a previously loaded ID or performs an unconditional `create`. Focused risk check: the existing partial unique index is `prisma/migrations/20260817110000_billing_tracking/migration.sql:104-106` on `(tenant_id, issue_key) WHERE resolved_at IS NULL`.
   - Why it matters: overlapping tenant/company/manual requests can reconcile the same service concurrently. Both transactions may observe no open row; one succeeds and the other raises a unique violation, rolling back otherwise valid per-service deadline/billing/coverage work and consuming a worker retry. The task specifically requires upserted detected issues and retry-safe idempotency.
   - Fix: use a PostgreSQL atomic insert/upsert compatible with the partial index (or catch the unique collision and reload/update in a bounded retry) while preserving historical resolved rows. Base `opened`/`refreshed` counts on the actual database outcome. Add a focused concurrent APPLY test against PostgreSQL or a service-level collision test that exercises the production conflict path.

4. **Inactive-service handling creates a misleading permanent gap issue and makes Observe disagree with Apply.**
   - Evidence: `src/services/billing/coverage.ts:467-487`. For an ended/deleted service with open occurrences and no existing issue, the code creates `OCCURRENCE_GAP` with `missingCount` equal to the number of occurrences that actually exist (lines 472-475). Once that issue exists, later runs merely copy all existing issues and never resolve it when the open occurrences close. In addition, Observe reports every retained existing issue as `refreshed` (lines 481-485), while Apply with an existing issue performs no persistence and reports zero refreshes (lines 477-481).
   - Why it matters: `OCCURRENCE_GAP` is defined as missing expected rolling-horizon coverage, not as an ended service having unresolved open work. The current row can remain unresolved forever and display false remediation text, while Observe no longer describes the changes Apply would make.
   - Fix: do not synthesize a missing-occurrence issue for existing open occurrences. Surface ended/archived services with open occurrences through the appropriate occurrence/summary projection, or obtain an approved contract change for a dedicated issue type. Recompute and resolve only genuine coverage issues, and make Observe counts exactly mirror the writes Apply would perform.

#### Minor (Nice to Have)

1. **Issue-specific structured details are discarded before persistence.**
   - Evidence: `src/services/billing/coverage.ts:333-353` constructs `scheduleKey`, `missingCount`, and `firstMissingPeriod`, but `src/services/billing/coverage.ts:356-365` persists only message, date, type, and fee-line ID.
   - Why it matters: the approved model calls for safe structured details, and losing the stable schedule key and first missing period makes issue diagnosis/auditing weaker and forces consumers to parse generic message text.
   - Fix: carry a safe `details` object on the detected issue and persist the stable schedule key plus bounded diagnostic fields such as `missingCount` and `firstMissingPeriod`.

2. **The tests do not exercise the service-level access query or several exact issue classifications.**
   - Evidence: `__tests__/api/billing-coverage-routes.test.ts:25,54-75` mocks `listBillingCoverage`, so it proves route plumbing but not the tenant/company predicates in `src/services/billing/coverage.ts:562-657`. `__tests__/services/billing-coverage.test.ts:83-208` has no direct cases for `MISSING_START_DATE`, `INVALID_CUSTOM_SCHEDULE`, or `MISSING_SCHEDULE_PARAMETER`, which allowed Important finding 1 through.
   - Why it matters: accessible-company SQL scope is a global security constraint, and exact classification is Task 4's primary behavior.
   - Fix: add service tests asserting the Prisma `where` clauses and results for restricted/all/empty scopes, plus table-driven tests covering all seven issue types and their resolution transitions.

### Assessment

**Task quality:** Needs fixes

**Verdict:** **FAIL**

**Reasoning:** The implementation has a good overall shape and correct route/worker integration, but four Important defects affect exact issue semantics, rolling-horizon correctness, idempotency under concurrent queue work, and Observe/Apply lifecycle behavior. All previous requirements are therefore not met, and Task 4 should not pass until these are corrected and covered by focused regression tests.
