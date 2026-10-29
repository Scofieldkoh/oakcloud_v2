# Task 6 handoff: billing occurrence tracking and lifecycle APIs

## Scope

Implemented Plan 3 Task 6 only. Billing occurrence list/detail APIs, Singapore
date timing, audited optimistic lifecycle and override mutations, current-and-
future value edits, reset operations, and React Query hooks are now available.
Billing remains manual tracking only; no invoice, payment, or ledger semantics
were added.

## RED evidence

The initial focused command was run before the Task 6 modules existed:

    npm.cmd run test:run -- __tests__/services/billing.service.test.ts __tests__/api/billing-occurrence-routes.test.ts __tests__/hooks/use-billing-occurrences.test.ts --reporter=dot

It failed because the billing occurrence service, routes, and hook exports were
absent. The earlier sandboxed invocation that could not resolve linked-worktree
Vitest configuration was not treated as test evidence.

## GREEN evidence

Final focused command:

    npm.cmd run test:run -- __tests__/services/billing.service.test.ts __tests__/api/billing-occurrence-routes.test.ts __tests__/hooks/use-billing-occurrences.test.ts --reporter=dot

Result: 3 test files passed, 22 tests passed.

Directly affected billing, reconciliation, access, and hook compatibility:

    npm.cmd run test:run -- __tests__/services/billing.service.test.ts __tests__/api/billing-occurrence-routes.test.ts __tests__/hooks/use-billing-occurrences.test.ts __tests__/services/billing-reconciler.test.ts __tests__/services/schedule-reconciliation.test.ts __tests__/services/schedule-reconciliation-worker.test.ts __tests__/services/schedule-reconciliation-observability.test.ts __tests__/services/client-service.service.test.ts __tests__/api/client-services-routes.test.ts __tests__/services/billing-coverage.test.ts __tests__/api/billing-coverage-routes.test.ts __tests__/hooks/use-billing-coverage.test.ts --reporter=dot

Result: 12 test files passed, 153 tests passed.

Additional scoped gates passed:

    npx.cmd tsc --noEmit
    npx.cmd eslint src/lib/validations/billing.ts src/services/billing/index.ts src/services/billing/types.ts src/services/billing/service.ts src/app/api/billing-occurrences/route.ts src/app/api/billing-occurrences/[id]/route.ts src/app/api/billing-occurrences/[id]/reset-override/route.ts src/hooks/use-billing-occurrences.ts --max-warnings=0
    git diff --check

All scoped gates passed. Repository-wide build/lint, live migrations,
PostgreSQL integration, browser/performance checks, and unrelated test suites
were intentionally not run.

## Review-fix RED/GREEN evidence

The review regression was first run before the fix:

    npm.cmd run test:run -- __tests__/services/billing.service.test.ts --reporter=dot

Result: 2 failures and 20 passing tests. One failure was the intended
historical-boundary regression; the other exposed an invalid UUID in the new
test fixture and was corrected before the implementation GREEN run.

After the fix, the focused Task 6 command passed with 3 test files and 37
tests. The directly affected compatibility matrix passed with 12 test files
and 168 tests. The final TypeScript, scoped zero-warning ESLint, and diff
checks also passed.

## Files and implementation decisions

- `src/lib/validations/billing.ts`: strict occurrence search, lifecycle, and
  reset schemas; duplicate/unknown query-key rejection; date-only filters and
  bounded pagination parsing.
- `src/services/billing/types.ts`, `src/services/billing/index.ts`: serializable
  occurrence DTO/result/actor/database contracts and public service exports.
- `src/services/billing/service.ts`: SQL tenant/accessible-company scope,
  family/status/timing filters, Singapore derived timing, date-only/decimal
  serialization, status invariants, optional billed date, optimistic
  `expectedUpdatedAt` claims, serializable transactions, complete before/after
  audit changes, and reset behavior. Cancelled rows are system-only and
  immutable. Current-and-future edits select the matching future IDs inside the
  transaction, using one captured Singapore current-date boundary plus the
  selected operative date, update only future OPEN rows, and audit truthful
  affected IDs and counts. Historical selected rows remain editable while
  historical matching rows are preserved.
- `src/app/api/billing-occurrences/`: enabled-workspace routes with
  `company:read` list/detail access, `company:update` mutation access, tenant
  and accessible-company scoping, and structured errors.
- `src/hooks/use-billing-occurrences.ts`: normalized stable list keys,
  abortable list/detail requests, mutation helpers, and invalidation for
  occurrence, coverage, roster, and affected client-service consumers.
- `__tests__/services/billing.service.test.ts`,
  `__tests__/api/billing-occurrence-routes.test.ts`,
  `__tests__/hooks/use-billing-occurrences.test.ts`: RED/GREEN focused tests
  covering timing, scope, DTO serialization, nullable billed dates, lifecycle
  and immutable states, optimistic conflicts, current-and-future edits, route
  permissions, query strictness, pagination/sort, family/status/timing filters,
  reset isolation, future count conflicts, and hook invalidation.

## Commit

Commit message: `feat: track billing occurrence status` (final commit hash is
reported in the handoff).

## Self-review

- Only Task 6 production, test, and report files were changed; `progress.md`
  and review artifacts were not edited.
- Current-and-future is limited to amount/currency edits and preserves billed,
  waived, cancelled, historical, and unrelated fee-line occurrences. Its
  lower bound is the later of the selected operative date and one captured
  Singapore civil date.
- Status and timing are intentionally separate: timing is derived only for
  OPEN rows from Singapore's current date and is never persisted.
- Billed is a user-recorded external tracking state; the implementation does
  not issue invoices, record payments, or post ledger entries.
