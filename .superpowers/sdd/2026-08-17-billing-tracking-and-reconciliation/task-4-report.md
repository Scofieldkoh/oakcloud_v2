# Task 4 handoff: reconcile billing configuration coverage

## Scope

Implemented Plan 3 Task 4 only. Billing coverage now materializes the seven approved issue types, supports Observe and Apply reconciliation, exposes an access-scoped summary, queues manual client-service reconciliation, and runs coverage inside the shared deadline/billing worker transaction.

## RED evidence

Focused command:

    npm.cmd run test:run -- __tests__/services/billing-coverage.test.ts __tests__/api/billing-coverage-routes.test.ts __tests__/hooks/use-billing-coverage.test.ts __tests__/services/schedule-reconciliation-worker.test.ts --reporter=dot

The first sandboxed invocation could not resolve the worktree Vitest configuration (`Cannot read directory "../../../../../../.."`). Rerunning the same focused command with the required worktree configuration access produced genuine RED failures:

- the coverage routes and hook modules were missing;
- `reconcileBillingCoverage` was not exported/implemented;
- the worker summary did not contain coverage.

No implementation was treated as passing based on the configuration-resolution failure.

## GREEN evidence

The final focused command passed:

    Test Files  4 passed (4)
    Tests       28 passed (28)

Additional scoped gates passed:

    npx.cmd tsc --noEmit
    npx.cmd eslint src/services/billing/coverage.ts src/services/billing/index.ts src/services/schedule-reconciliation/types.ts src/services/schedule-reconciliation/worker.ts src/services/schedule-reconciliation/index.ts src/app/api/billing-coverage/route.ts src/app/api/client-services/[id]/billing/reconcile/route.ts src/hooks/use-billing-coverage.ts __tests__/services/billing-coverage.test.ts __tests__/api/billing-coverage-routes.test.ts __tests__/hooks/use-billing-coverage.test.ts __tests__/services/schedule-reconciliation-worker.test.ts --max-warnings=0
    git diff --check

Prisma validation was not run because this task does not change the Prisma schema or migrations. Repository-wide build/lint, live migrations, performance checks, and unrelated test suites were intentionally not run.

## Review round 1 fixes

The first review identified four important and two minor findings. I verified each against the approved brief and implemented the valid corrections without changing the Task 4 scope.

RED command (after adding regression tests, before fixes) was the focused command above. It failed five tests: missing custom interval classification, ended-service synthetic gap, inactive Observe/Apply count parity, cancelled-occurrence coverage, and the unique-issue collision path.

Fixes include:

- structural schedule checks now classify missing `CUSTOM` interval/entries as `MISSING_SCHEDULE_PARAMETER`, while malformed custom values remain `INVALID_CUSTOM_SCHEDULE`;
- only `OPEN`, `BILLED`, and `WAIVED` occurrence identities satisfy rolling coverage; `CANCELLED` identities produce `OCCURRENCE_GAP`;
- detected issues use a PostgreSQL `INSERT ... ON CONFLICT` upsert when a transactional raw client is available, with bounded unique-collision reload/update fallback and counts based on the actual opened/refreshed outcome;
- inactive services no longer receive invented `OCCURRENCE_GAP` issues; existing genuine issues remain visible without refresh writes, and open occurrences remain in the billing-occurrence projection;
- legacy synthetic ended-service gap rows are resolved as stale without being exposed as new coverage issues, with matching Observe/Apply counts;
- stable, bounded schedule/gap details (`scheduleKey`, `missingCount`, `firstMissingPeriod`) are retained in issue persistence while the public result shape remains unchanged;
- service tests now cover all exact issue classifications, accepted/cancelled statuses, inactive lifecycle behavior, resolution parity, collision recovery, raw upsert outcomes, and tenant/company list predicates.

Review-round GREEN evidence:

    Test Files  4 passed (4)
    Tests       45 passed (45)
    npm.cmd run test:run -- __tests__/services/billing-reconciler.test.ts __tests__/services/schedule-reconciliation.test.ts --reporter=dot
    Test Files  2 passed (2)
    Tests       45 passed (45)

`npx.cmd tsc --noEmit`, the scoped zero-warning ESLint command, and `git diff --check` also pass after the fixes. No live PostgreSQL test or repository-wide gate was run.

## Files and implementation decisions

- `src/services/billing/coverage.ts`: deterministic SHA-256 issue keys using tenant, service, optional fee line, issue type, and stable schedule key; exact issue detection; Observe no-write behavior; Apply upsert/refresh and stale-open resolution; paused/ended/deleted lifecycle handling; rolling-horizon occurrence comparison; and compact SQL-backed summaries.
- `src/services/billing/index.ts`: exports the coverage API and types.
- `src/services/schedule-reconciliation/types.ts`: adds `coverage` to the worker summary contract.
- `src/services/schedule-reconciliation/worker.ts`: executes coverage after billing in the same per-service transaction, aggregates/logs coverage counts, and lets coverage failures follow existing retry/error handling.
- `src/services/schedule-reconciliation/index.ts`: exports the shared transaction helper.
- `src/app/api/billing-coverage/route.ts`: requires `company:read`, applies tenant and accessible-company scope, validates filters, and intersects requested company IDs with access scope.
- `src/app/api/client-services/[id]/billing/reconcile/route.ts`: tenant-scoped, `company:update`-authorized 202 enqueue endpoint using `CLIENT_SERVICE` and `BILLING_MANUAL_RECONCILE`.
- `src/hooks/use-billing-coverage.ts`: normalized query keys, summary fetching, manual reconcile mutation, and coverage/occurrence/roster/service cache invalidation.
- `__tests__/services/billing-coverage.test.ts`: issue detection, SHA-256 identity, Observe behavior, paused lifecycle, closed occurrence preservation, and stale issue refresh/resolution.
- `__tests__/api/billing-coverage-routes.test.ts`: permission, scope, filter intersection, and manual enqueue contracts.
- `__tests__/hooks/use-billing-coverage.test.ts`: normalization, query, mutation, and invalidation contracts.
- `__tests__/services/schedule-reconciliation-worker.test.ts`: coverage ordering/transaction wiring and retry behavior when coverage fails.

## Security and contract review

All coverage reads and writes carry tenant predicates. Issue writes derive `companyId` from the tenant-scoped service, and summary queries constrain both issue and related company rows. Manual reconcile first loads the service through the caller's company scope and then checks `company:update`; it never accepts a client-supplied tenant or company ID. Observe mode performs no issue writes. Worker coverage is invoked with the same tenant, service, date window, and write mode as billing, and any thrown coverage error prevents completion and schedules retry.

## Commit

Review-round commit: `7e1353e2 fix: harden billing coverage reconciliation`. The report remains in the ignored `.superpowers/sdd/` handoff directory by repository convention.

## Self-review

- Only Task 4 production/tests/report files are changed; `progress.md` and review artifacts were not edited.
- No broad or destructive commands were run.
- Focused tests cover the approved lifecycle and retry semantics, including non-OPEN occurrence statuses and requested-company access intersection.
