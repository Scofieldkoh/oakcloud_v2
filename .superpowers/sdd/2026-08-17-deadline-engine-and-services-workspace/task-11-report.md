# Task 11 report — deadline query and lifecycle APIs

## Scope

Implemented bounded deadline search/list schemas, SQL-scoped table/calendar
DTOs, Singapore date-only timing derivation, lifecycle and override mutations,
auditing, API routes, and React Query hooks. The correction pass also remediated
the independent review findings for requested Company filtering, related-row
tenant integrity, ID-route non-oracle behavior, and readable persisted notes.
The follow-up rereview passed with 0 Critical / 0 Important / 1 coverage Minor;
the remaining coverage item was closed by the regression tests recorded below.

## TDD evidence

### RED

Before production modules existed:

```text
npm.cmd run test:run -- __tests__/services/deadline.service.test.ts
FAIL — Failed to resolve import "@/services/deadline"

npm.cmd run test:run -- __tests__/services/deadline.service.test.ts __tests__/api/deadline-routes.test.ts __tests__/hooks/use-deadlines.test.ts
FAIL — deadline service, API routes, and hook modules were absent
```

The independent review correction first added focused tests for every finding
before the corresponding production changes. The correction RED run was:

```text
npx.cmd vitest run --config vitest.config.ts \
  __tests__/services/deadline.service.test.ts \
  __tests__/api/deadline-routes.test.ts \
  __tests__/lib/deadline.validation.test.ts
FAIL — 7 service assertions and 4 route assertions exposed the missing
Company intersection, relation-tenant guards, notes/audit state, and safe
404/structured JSON behavior; date validation tests passed.
```

### GREEN

Final focused Task 11 correction and rereview suite:

```text
49 tests passed across 4 files
__tests__/services/deadline.service.test.ts — 31
__tests__/api/deadline-routes.test.ts — 11
__tests__/hooks/use-deadlines.test.ts — 5
__tests__/lib/deadline.validation.test.ts — 2
```

Direct compatibility suite:

```text
40 tests passed across 4 files
__tests__/services/service-roster.service.test.ts
__tests__/api/service-roster-route.test.ts
__tests__/hooks/use-service-roster.test.ts
__tests__/api/services-settings-route.test.ts
```

Additional gates:

```text
npx.cmd tsc --noEmit --pretty false                         PASS
npx.cmd eslint --max-warnings 0 [scoped Task 11 source/tests] PASS (0 warnings)
git diff --check                                             PASS
```

No full repository suite, baseline build, full lint, live database, or
migration application was run; those remain deferred to the integrated gate.

## Implementation notes

- List predicates carry tenant, requested/access-scoped Company intersection,
  date range, family, type, status/open-only, timing, origin, and related
  ClientService/variant/family/Cycle/RuleVersion tenant predicates into Prisma
  query inputs. Restricted access with an empty requested intersection returns
  an empty result without querying. Defensive DTO filtering rejects malformed
  related tenant rows even if a test double returns one.
- Detail and mutation reads use the same tenant-integrity relation predicate;
  malformed Company, ClientService, variant, family, Cycle, or RuleVersion
  relationships return `NOT_FOUND`, including for Super Admin actors.
- Regression coverage explicitly rejects a mismatched RuleVersion tenant at
  detail, update, and reset entry points without an occurrence write or audit;
  the detail React Query hook is mounted and verified to forward its
  `AbortSignal`.
- Calendar mode fetches one row beyond the 5,000 response cap, omits page
  semantics, and emits `truncated` plus a warning only when more than 5,000
  safe rows exist. Table mode uses bounded skip/take, deterministic sorting,
  and one shared predicate for rows and count.
- `UPCOMING`, `DUE`, and `OVERDUE` are derived from open operative dates and the
  current Singapore civil date; the value is never persisted. Date-only input
  rejects impossible Gregorian dates and accepts exactly 366 elapsed days while
  rejecting 367-day ranges.
- User mutations use `updateMany` with tenant, expected `updatedAt`, and a
  non-cancelled predicate. Zero rows produce `VERSION_CONFLICT`; cancelled
  rows produce `OCCURRENCE_IMMUTABLE` and are never written. Direct
  Completed↔Waived transitions are rejected and reopening requires a reason.
- Date overrides preserve calculated dates. Reset clears all override metadata
  and copies the calculated date to the operative date.
- `DeadlineOccurrence.notes` is now a nullable persisted field, included in
  the DTO and update data. The additive SQL is recorded at
  `prisma/migrations/20260819010000_deadline_occurrence_notes/migration.sql`;
  generated Prisma client artifacts were updated, but the migration was not
  applied to a live database.
- Audit events run in the same interactive transaction as the occurrence
  update. Before/after state includes status, calculated/operative dates, all
  override date/reason/actor/time fields, completion/waiver/cancellation
  metadata, and notes. Focused tests cover successful changes, optimistic
  conflicts, and rollback when the audit write fails.
- Detail GET uses `company:read`; PATCH and reset use `company:update` only
  after loading the tenant/relation-safe occurrence. Record-level permission
  denial is normalized to the same safe 404 as a missing occurrence for GET,
  PATCH, and reset. List routes require `company:read`, the Services workspace
  feature gate, and session-derived Company scope.
- React Query keys canonicalize set-like filters and mutation success
  invalidates deadline lists, the specific deadline, and roster summaries;
  list/detail requests forward abort signals and preserve structured errors.

## Assumptions and risks

- `CANCELLED` is system-only per the domain contract and is therefore excluded
  from the PATCH schema; reconciliation remains responsible for cancellation.
- The notes migration is additive and intentionally deferred to the final
  integrated schema/live-database gate. Deploying code before that migration
  would require the normal release ordering (migration before writes).
- Calendar truncation uses a `take: 5001` probe so exactly 5,000 results are
  distinguishable from a larger result set.
- The independent rereview result is PASS with 0 Critical / 0 Important / 1
  coverage Minor; the coverage Minor is closed by the regression tests above.
