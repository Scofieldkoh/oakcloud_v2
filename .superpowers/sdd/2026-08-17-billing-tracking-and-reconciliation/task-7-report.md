# Task 7 — Billing tracking workspace

## Outcome

Implemented the billing tracking workspace for the Services administration area, including the responsive occurrence table/card view, filters, coverage reconciliation summary, lifecycle/reset dialogs, table preferences, and roster billing indicators. The UI uses manual tracking language throughout and does not imply invoice or payment-provider synchronization.

## TDD evidence

RED was established before implementation:

- The initial focused component run failed because the new `BillingWorkspace` module and its supporting UI did not yet exist.
- The reset-lifecycle test then failed with the missing `Reset tracked overrides` action before the reset flow was implemented.

GREEN verification:

- `npx.cmd vitest run --config .\\vitest.config.ts __tests__/components/billing-workspace.test.tsx __tests__/components/billing-coverage-panel.test.tsx __tests__/components/billing-occurrence-dialog.test.tsx __tests__/components/services-workspace.test.tsx __tests__/components/service-roster.test.tsx __tests__/components/service-roster-preferences.test.ts __tests__/services/service-roster.service.test.ts` — 7 files, 44 tests passed.
- `npx.cmd vitest run --config .\\vitest.config.ts __tests__/services/billing.service.test.ts __tests__/services/billing-coverage.test.ts __tests__/api/billing-occurrence-routes.test.ts __tests__/api/billing-coverage-routes.test.ts __tests__/hooks/use-billing-occurrences.test.ts __tests__/hooks/use-billing-coverage.test.ts` — 6 files, 67 tests passed.
- Review-fix focused run: `npx.cmd vitest run --config .\\vitest.config.ts __tests__/components/billing-workspace.test.tsx __tests__/components/billing-coverage-panel.test.tsx __tests__/components/billing-occurrence-dialog.test.tsx __tests__/components/billing-table.test.tsx __tests__/components/services-workspace.test.tsx __tests__/components/service-roster.test.tsx __tests__/components/service-roster-preferences.test.ts __tests__/services/service-roster.service.test.ts __tests__/services/billing.service.test.ts __tests__/services/billing-coverage.test.ts __tests__/api/billing-occurrence-routes.test.ts __tests__/api/billing-coverage-routes.test.ts __tests__/hooks/use-billing-occurrences.test.ts __tests__/hooks/use-billing-coverage.test.ts` — 14 files, 126 tests passed.
- `npx.cmd vitest run --config .\\vitest.browser.config.ts __tests__/browser/services-billing.browser.test.tsx` — Chromium ServicesWorkspace route-equivalent at `/services?tab=billing`, desktop/tablet/mobile flows, 2 tests passed.
- `npx.cmd tsc --noEmit` — passed.
- Scoped ESLint over all changed production files — passed with no warnings.
- `git diff --check` — passed.

Review-fix RED/GREEN evidence:

- RED assertions covered value-field omission and scope prompting, invalid lifecycle options, mutation error retention, server-side text predicates, URL state, roster billing projection/column placement, grouped coverage severity, and sortable-header `aria-sort`; the focused run failed before the corresponding fixes.
- GREEN now omits unchanged amount/currency, restricts Billed/Waived transitions, keeps failed dialogs open with input intact, sends company/service/fee/general searches into the paginated server query, round-trips filters/sort/page/date state through URL parameters, projects the next Open/Billed roster occurrence, renders Billing as a dedicated roster column, groups issue cards by company/service, and exposes `aria-sort`.
- Rereview RED run: the two focused component files failed 5 regression assertions because unchanged `status`/`billedDate` were still submitted and mutation errors were not reset across selection. Rereview GREEN now sends lifecycle fields only when changed (including billed-date-only and real Open/Billed transitions), preserves Waived metadata on notes/reference edits, and resets both mutation states on close and before opening another row.

## Visual/browser QA

Target flow: open `/services?tab=billing`, inspect the collapsed coverage summary, filter by status/company/family/date/timing, edit a billing occurrence, choose the value-change scope, and verify desktop table versus mobile cards plus roster billing indicators.

The in-app Browser skill was connected and used for the local-app attempt. The dev server stopped during instrumentation because the worktree had no `DATABASE_URL`; the exact navigation result was `net::ERR_CONNECTION_REFUSED` after the startup error `DATABASE_URL environment variable is required` from `src/lib/prisma.ts:26`. Per the task brief, the explicitly permitted repository Vitest Browser workflow was used as the fallback. Its Chromium flow rendered `ServicesWorkspace` with `tab=billing`, verified the collapsed issue summary and company/service grouping, status filtering, sortable headers, resize pointer interaction, pagination URL state, the value-change scope dialog, tablet table layout, mobile occurrence cards, URL filter hydration, and the spacious `space-y-5` shell assertion.

Reference fidelity decisions from approved gallery view 4/view 1:

- Kept the spacious 4px-grid shell and compact table density without tight margins.
- Coverage is collapsed by default; healthy coverage is a single compact summary and issue cards render only when issues exist.
- Desktop uses a horizontally scrollable/resizable table; mobile switches to occurrence cards.
- Included Open/Billed/Waived, timing/date, company/fee search, clickable family chips, pagination, and persisted `services.billing.table.v1` preferences.
- Roster indicators expose Covered, No billing required, Missing disposition, Missing start, and next-occurrence timing with a Billing link.
- Dialogs reset values on close, prompt This occurrence versus This and future for amount/currency changes, and support reset of expected-date/value overrides.
- Server-side predicates cover company name/display alias/UEN, service/family/variant, fee description/period, and general search before count/pagination; unchanged lifecycle/notes edits do not send value override fields.
- Lifecycle payloads are sparse: unchanged status/billed date are omitted, while actual transitions and billed-date edits remain explicit; closing or changing rows clears mutation state before the next dialog opens.

## Files

Added:

- `src/components/services/billing/billing-workspace.tsx`
- `src/components/services/billing/billing-table.tsx`
- `src/components/services/billing/billing-filters.tsx`
- `src/components/services/billing/billing-coverage-panel.tsx`
- `src/components/services/billing/billing-occurrence-dialog.tsx`
- Focused component and Chromium Browser tests under `__tests__/components/` and `__tests__/browser/`.

Updated:

- `src/components/services/services-workspace.tsx` to render the Billing tab.
- `src/lib/validations/services-preferences.ts` with billing table preference parsing/defaults.
- Service roster types/service/table for billing projection and indicators.

## Self-review and scope

The implementation stays within Task 7 and reuses the existing billing occurrence/coverage hooks and Oakcloud primitives. It does not add shadcn, invoice/payment-provider behavior, or database migrations. Full baseline tests/build/lint, live PostgreSQL coverage, and production-authenticated Browser testing were intentionally deferred per the task instructions; the missing local `DATABASE_URL` is the remaining environment-dependent QA limitation.

## Review-fix handoff

The review fixes are contained in the same implementation branch.

- Commits: `f8ec5aad fix: address Task 7 billing review findings`; `d2a78803 fix: preserve billing lifecycle metadata`
- Working tree: clean after the final verification run.
