# Task 13 report — manual historical-cycle preview and apply

Status: PASS / final-review-complete

Final review: **PASS — 0 Critical / 0 Important / 0 Minor.**

## Scope delivered

- Added strict preview/apply schemas for a route-scoped client service, a
  published rule version, bounded historical period dates/key, JSON-safe
  parameter overrides and source values, repeatable schedule entries, apply
  fingerprint/notes, and exactly one selection per evaluated milestone and
  schedule-entry identity.
- Added tenant- and accessible-company-scoped service/version/calendar loads.
  Preview reuses the pure deadline evaluator, returns every evaluated
  milestone with calculated/operative dates and explanations, and performs no
  cycle, occurrence, audit, billing, or reconciliation writes.
- Added serializable apply that reloads and recomputes the preview fingerprint,
  rejects stale input, creates a deterministic `MANUAL_TRIGGER` generation,
  inserts only selected unique occurrences, records adjusted-date override and
  completion metadata, persists notes, audits included/excluded/completed
  choices atomically, and handles duplicate/race idempotency. No billing
  occurrence or schedule reconciliation side effect is called.
- Added tenant-safe `GET` options and `POST` preview/apply routes with the
  Services workspace gate and `company:update` authorization. The options
  route uses an accessible-company SQL predicate and only serializes enabled
  associations whose rule, current published version, parameter definitions,
  milestone relations, and schedule/config data pass tenant and identity
  checks; inaccessible and missing service IDs share the same safe 404 path.
- Added an accessible responsive manual-cycle dialog with 44px controls,
  period/rule inputs, repeatable parameter and schedule editors, source values,
  preview state, selectable milestone rows, explanations, status/date/
  completion controls, notes, and Apply invalidation until the current preview
  remains unchanged.
- Added gated trigger actions to the cross-company roster and company detail
  service list while preserving the existing status/family filter placement.
  The dialog now consumes the dedicated options DTO rather than the generic
  client-service detail projection, initializes all configured parameters and
  repeatable schedule entries, preserves configured string parameter types,
  and reports loading/no-rule/structured-error states.

## TDD evidence

The required RED run was collected before production modules existed:

```text
npm.cmd run test:run -- __tests__/services/manual-deadline-cycle.test.ts __tests__/api/manual-deadline-cycle-routes.test.ts __tests__/components/manual-cycle-dialog.test.tsx
FAIL — all three suites failed to resolve the new service/route/dialog modules
```

The final correction RED run also covered the new trust boundary before its
implementation existed:

```text
npm.cmd run test:run -- __tests__/services/manual-deadline-cycle-options.test.ts __tests__/api/manual-deadline-cycle-routes.test.ts __tests__/components/manual-cycle-dialog.test.tsx
FAIL — options service/route imports were unresolved and the dialog had no options source
```

Focused Task 13 GREEN evidence:

```text
npm.cmd run test:run -- __tests__/services/manual-deadline-cycle.test.ts __tests__/services/manual-deadline-cycle-options.test.ts __tests__/api/manual-deadline-cycle-routes.test.ts __tests__/components/manual-cycle-dialog.test.tsx __tests__/components/company-services-tab.test.tsx __tests__/components/service-roster.test.tsx
6 files passed; 58 tests passed
```

The Task 13 service tests cover no-write preview, no-billing apply, adjusted
dates/completion, stale fingerprints, and idempotent existing generations.

## Independent review remediation — pending final rereview

- Selection, operative-date, lifecycle, completion-date, and notes edits now
  remain apply-only metadata against the current preview fingerprint. Rule,
  period, parameter, schedule, and source inputs still invalidate the preview.
- Apply enforces the tenant deadline-write rollout flag in the service and
  route, while roster and Company detail triggers require edit permission,
  workspace-enabled settings, and deadline writes enabled. Loading, error,
  and no-applicable-rule options states fail closed in the dialog.
- The dialog selects only enabled active client rules with a consistent current
  published-version relationship and initializes every configured parameter and
  repeatable schedule entry from the dedicated tenant-safe options projection.
  Parameter serialization follows the selected version definitions, so
  configured STRING/DATE/ENUM values such as `"2"`, `"true"`, `"null"`, and
  JSON-looking text remain strings while typed numeric/boolean/object values
  retain their typed form.
- Unique-key losers escape the aborted transaction and resolve the committed
  winner in a fresh serializable transaction. Selection generation identity is
  sorted by milestone and schedule-entry identity before hashing.
- Milestone templates are loaded for post-load integrity checking and every
  template must match both the actor tenant and selected rule version before
  evaluation or disclosure; mismatches fail closed without writes or audit.
- Structured `{ error, code, details }` API responses now surface their safe
  `error` message in the dialog.

Review RED/GREEN additions cover the scoped options service/route, missing vs
inaccessible parity, cross-tenant/wrong-rule/wrong-version/draft omission,
typed parameter serialization, direct post-preview exclusion/date/status/
completion/notes flow, rollout disabled and settings-loading gates, four-entry
rule configuration, fresh-transaction P2002 behavior, reordered multi-entry
idempotency, cross-tenant milestone rejection, and structured error display.

## Compatibility evidence

The exact reproducible compatibility commands and current counts are:

```text
npm.cmd run test:run -- __tests__/services/deadline-rule-evaluator.test.ts __tests__/services/deadline.service.test.ts __tests__/api/deadline-routes.test.ts __tests__/hooks/use-deadlines.test.ts
4 files passed; 81 tests passed

npm.cmd run test:run -- __tests__/services/client-service.service.test.ts __tests__/services/client-service-manual-create.test.ts __tests__/services/client-service-catalog-options.test.ts __tests__/lib/client-service-validation.test.ts __tests__/hooks/use-client-services.test.ts __tests__/components/schedule-entry-editor.test.tsx
6 files passed; 70 tests passed

npm.cmd run test:run -- __tests__/services/deadline.service.test.ts __tests__/api/deadline-routes.test.ts __tests__/hooks/use-deadlines.test.ts __tests__/lib/deadline.validation.test.ts __tests__/components/service-roster.test.tsx __tests__/components/service-roster-preferences.test.ts __tests__/components/async-search-select.test.tsx __tests__/services/service-roster.service.test.ts __tests__/api/service-roster-families-route.test.ts __tests__/api/service-roster-route.test.ts __tests__/hooks/use-service-roster.test.ts __tests__/api/services-settings-route.test.ts
12 files passed; 112 tests passed
```

The known unrelated
`__tests__/services/client-service-schema.test.ts` exact-format assertion is
isolated separately: 1 pre-existing assertion fails and 4/5 assertions pass;
the test and Prisma schema remain untouched.

## Verification and boundaries

- Final review confirmed the dedicated options selector, typed parameter
  preservation, post-preview apply-only edits, rollout/RBAC gates, tenant
  integrity, race-safe idempotency, and no-billing/no-reconciliation
  guarantees.
- Final implementation commit: `aa42dbe5` (`fix: harden manual cycle rule options`).

- `npx.cmd tsc --noEmit --pretty false` — pass.
- Scoped ESLint with `--max-warnings 0` over changed Task 13 source/routes/
  components/tests — pass with zero warnings/errors.
- `git diff --check` — pass.
- No repository-wide baseline, full build/lint, Prisma generation/migration,
  live database, or broader Plan 2 gate was run. Task 14 was not started.

## Changed files

- `src/services/deadline/manual-cycle.ts`
- `src/services/deadline/manual-cycle-options.ts`
- `src/services/deadline/index.ts`
- `src/services/schedule-reconciliation/settings.ts`
- `src/services/schedule-reconciliation/index.ts`
- `src/app/api/client-services/[id]/deadline-cycles/options/route.ts`
- `src/app/api/client-services/[id]/deadline-cycles/preview/route.ts`
- `src/app/api/client-services/[id]/deadline-cycles/route.ts`
- `src/components/services/deadlines/manual-cycle-dialog.tsx`
- `src/components/services/roster/service-roster-table.tsx`
- `src/components/services/roster/service-roster.tsx`
- `src/components/companies/company-detail/company-services-tab.tsx`
- `__tests__/services/manual-deadline-cycle.test.ts`
- `__tests__/services/manual-deadline-cycle-options.test.ts`
- `__tests__/api/manual-deadline-cycle-routes.test.ts`
- `__tests__/components/manual-cycle-dialog.test.tsx`
- `__tests__/components/service-roster.test.tsx`
- `__tests__/components/company-services-tab.test.tsx`
