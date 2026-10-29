# Task 15 report — rollout, observability, isolation, performance, and documentation

Status: PASS / final-review-complete — 0 Critical / 0 Important / 0 Minor

## Plan 2 handoff and completion-gate assessment (2026-08-24)

Task 15 is ready for the Plan 2 handoff. All functional, unit, integration-
contract, invariant-compatibility, TypeScript, scoped zero-warning ESLint, and
diff gates completed for this worktree are green. The independent final
rereview recorded 0 Critical, 0 Important, and 0 Minor findings.

The following Plan 2 completion-gate items remain intentionally deferred by
the user ruling until Plan 3 completes: live PostgreSQL/database acceptance,
live migration execution, Prisma/generated-client generation, repository-wide
baseline/full lint, repository-wide full build, and wall-clock/live
performance execution. The focused EXPLAIN/cardinality/cleanup coverage is
green, but it does not claim those deferred live gates passed.

## Review correction evidence (2026-08-24)

The independent review's 7 Important and 3 Minor findings were reproduced
against the implementation and closed as follows:

1. Reconciliation event emission is best-effort and non-throwing. Regression
   tests cover successful, retryable-failure, and lease-loss outcomes with a
   logger that throws.
2. Counts, preserved-by-reason totals, and warning metadata are copied into
   event state after every committed client service and before the subsequent
   lease check. Regression tests cover later-service failure and lease loss.
3. Roster and deadline list error responses now receive timing headers through
   an in-place response decorator, preserving status, body, and response
   behavior. Tests cover 401, 403, disabled-workspace 404, validation 400,
   service 500, and empty-scope 200 responses.
4. Both new PostgreSQL suites fail explicitly in CI when `TEST_DATABASE_URL`
   is absent while retaining local `describe.skip` behavior.
5. Isolation coverage now materializes an own-tenant control occurrence,
   asserts an exact positive list result and negative cross-tenant result,
   compares inaccessible and nonexistent mutation errors, and verifies the
   target occurrence and audit count are unchanged.
6. Request storage and summaries retain only stable public error codes/messages;
   arbitrary dependency text, notes, documents, and rule wording are dropped.
   Structured event tests assert the same redaction.
7. Tenant and environment write flags use boolean-OR semantics, including the
   explicit-false/ environment-true case, and the operations guide states this
   precedence.
8. EXPLAIN coverage parses JSON plan nodes and checks tenant/date/status (and
   roster tenant/company/status/deleted) conditions, bounded actual rows,
   expected index nodes, and a normal-planner absence of an occurrence
   sequential scan.
9. PostgreSQL cleanup is idempotent, continues after individual fixture
   cleanup errors, and disconnects in `finally` blocks.
10. Performance fixtures assert persisted tenant-scoped counts of exactly
    1,000 companies, 10,000 client services, and 100,000 occurrences before
    plan acceptance.

## Correction TDD and verification evidence

The correction RED run was:

```text
npm.cmd run test:run -- __tests__/services/schedule-reconciliation-worker.test.ts __tests__/services/schedule-reconciliation.test.ts __tests__/api/task-15-server-timing.test.ts __tests__/task-15-contract.test.ts
16 tests failed / 33 passed; failures covered logger propagation, missing
error timing, flag precedence, and missing CI/rollout contracts.
```

Fresh correction GREEN evidence:

- Task 15 focused selection: 5 files passed / 2 PostgreSQL files skipped;
  50 tests passed / 4 skipped.
- Plan 2 invariant selection: 18 files / 236 tests passed.
- Additional scheduler, observability, roster-route, and deadline-route
  compatibility selection: 4 files / 24 tests passed.
- `npx.cmd tsc --noEmit --pretty false`: exit 0.
- Scoped ESLint with `--max-warnings 0` over changed routes, timing helper,
  settings, worker, tests, and PostgreSQL fixtures: exit 0 with zero warnings.
- `git diff --check`: exit 0.

The PostgreSQL suites remained locally skipped because `TEST_DATABASE_URL` was
not configured. No live PostgreSQL, wall-clock performance, migration, Prisma
generation, repository-wide build, or repository-wide lint command was run.

## Scope delivered

- Added gated PostgreSQL tenant-isolation and concurrent idempotency coverage.
  The tests use isolated random tenants and verify that cross-tenant deadline
  list/detail/mutation access returns no data (404 for detail/mutation) and
  three concurrent reconciliation retries produce one deterministic occurrence
  identity.
- Added a representative PostgreSQL fixture using batched `createMany` calls
  for 1,000 Companies, 10,000 ClientServices, and 100,000 DeadlineOccurrences.
  The fixture always runs JSON `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` index
  assertions when `TEST_DATABASE_URL` is available. Roster/deadline wall-clock
  thresholds are asserted only when `RUN_PERFORMANCE_TESTS=true`; calendar
  results remain bounded at 5,000 rows.
- Added `Server-Timing`/`X-Response-Time-Ms` through `jsonWithServerTiming`
  to the roster and deadline list routes without changing DTOs, status codes,
  cache behavior, or authorization predicates.
- Added one redacted `reconciliation_request` structured event in the worker's
  `finally` path. It includes tenant/request/correlation IDs, duration, counts,
  warnings, attempt, preserved counts, and write mode. Warning messages are
  discarded before logging; lease-loss and retry paths do not emit duplicate
  request-level logs.
- Documented feature flags, observation/apply behavior, scheduler identity and
  cadence, retry schedule, rolling horizon, operational lease recovery, timing
  headers, and logging redaction in `SERVICE_PATTERNS.md`. Added the exact
  PostgreSQL/performance package scripts and static contract tests, including
  the shared-engine no-payroll branch assertion.

## TDD and focused verification evidence

The initial Task 15 RED run was collected before the implementation existed:

```text
npm.cmd run test:run -- __tests__/services/schedule-reconciliation-observability.test.ts __tests__/api/task-15-server-timing.test.ts __tests__/task-15-contract.test.ts
FAIL — 3 files, 6 tests failed (missing event builder, timing headers, scripts, and operations documentation)
```

The Task 15 GREEN selection is:

```text
npm.cmd run test:run -- __tests__/services/schedule-reconciliation-observability.test.ts __tests__/api/task-15-server-timing.test.ts __tests__/task-15-contract.test.ts __tests__/integration/deadline-tenant-isolation.postgres.test.ts __tests__/integration/deadline-performance.postgres.test.ts
3 files passed; 2 PostgreSQL files skipped; 7 tests passed; 4 tests skipped
```

The directly relevant Plan 2 invariant selection is:

```text
npm.cmd run test:run -- __tests__/lib/service-schedule-validation.test.ts __tests__/services/service-schedule-date-engine.test.ts __tests__/services/deadline-rule-evaluator.test.ts __tests__/services/business-calendar.service.test.ts __tests__/services/deadline-rule-impact.test.ts __tests__/services/schedule-reconciliation.test.ts __tests__/services/service-roster.service.test.ts __tests__/services/deadline.service.test.ts __tests__/api/service-calendar-routes.test.ts __tests__/api/deadline-routes.test.ts __tests__/api/service-roster-route.test.ts __tests__/services/manual-deadline-cycle.test.ts __tests__/api/manual-deadline-cycle-routes.test.ts __tests__/components/schedule-entry-editor.test.tsx __tests__/components/service-roster-preferences.test.ts __tests__/components/services-admin-page.test.tsx __tests__/components/deadline-rules-admin.test.tsx __tests__/components/business-calendar-admin.test.tsx
18 files passed; 235 tests passed
```

This selection covers four-plus schedule entries, second-last working-day and
business-day offsets, stored-company source precedence, XBRL-style
not-applicable applicability, impact fingerprints, preserved history and
idempotency, accessible-company/workspace filters, calendar preferences,
manual-cycle no-billing behavior, and rule/calendar/service administration
contracts. The existing roster/deadline route mocks were extended to retain the
real timing helper.

Static checks passed:

- `npx.cmd tsc --noEmit --pretty false` — exit 0.
- Scoped ESLint with `--max-warnings 0` over changed Task 15 routes, worker,
  tests, and PostgreSQL fixtures — exit 0 with zero warnings/errors.
- `git diff --check` — exit 0 after the implementation, report, and ledger
  changes were staged for handoff.

The exact package script `npm.cmd run test:deadlines:postgres` was attempted,
but this worktree's direct Vitest executable hit the existing Windows worktree
config-resolution error (`Cannot read directory "../../../../../../..": Access
is denied`). The equivalent focused command through `test:run` passed with both
PostgreSQL suites skipped, so no database was contacted:

```text
npm.cmd run test:run -- __tests__/integration/deadline-reconciliation.postgres.test.ts __tests__/integration/deadline-tenant-isolation.postgres.test.ts
2 files skipped; 4 tests skipped
```

## PostgreSQL/performance boundary

`TEST_DATABASE_URL` was not available. Therefore the tenant-isolation,
concurrent idempotency, fixture/index-plan, and live PostgreSQL checks are
gated/skipped and remain pending the isolated database gate. `RUN_PERFORMANCE_TESTS=true`
was not set; no wall-clock performance assertion was run.

## Deferred final gates

Per the repository rollout ruling, all of the following remain deferred until
the complete three-plan implementation is assembled:

- repository-wide baseline suite;
- Plan 2 Task 15 Step 5 complete verification matrix, including the full
  deadline/browser matrix;
- `npm.cmd run db:generate`;
- `npm.cmd run lint` (repository-wide/full lint);
- `npm.cmd run build` (full build);
- `npm.cmd run db:migrate` against an isolated/live database;
- `npm.cmd run test:deadlines:postgres` with `TEST_DATABASE_URL` and all other
  live PostgreSQL integration gates;
- `npm.cmd run test:deadlines:performance` with `TEST_DATABASE_URL` and
  `RUN_PERFORMANCE_TESTS=true` wall-clock assertions;
- the final Plan 2 completion gate and any Plan 3 work.

## Changed files

- `src/app/api/client-services/route.ts`
- `src/app/api/deadlines/route.ts`
- `src/lib/api/company-query.ts`
- `src/services/schedule-reconciliation/settings.ts`
- `src/services/schedule-reconciliation/worker.ts`
- `__tests__/api/deadline-routes.test.ts`
- `__tests__/api/service-roster-route.test.ts`
- `__tests__/api/task-15-server-timing.test.ts`
- `__tests__/integration/deadline-tenant-isolation.postgres.test.ts`
- `__tests__/integration/deadline-performance.postgres.test.ts`
- `__tests__/services/schedule-reconciliation-observability.test.ts`
- `__tests__/services/schedule-reconciliation-worker.test.ts`
- `__tests__/services/schedule-reconciliation.test.ts`
- `__tests__/task-15-contract.test.ts`
- `docs/guides/SERVICE_PATTERNS.md`
- `package.json`
