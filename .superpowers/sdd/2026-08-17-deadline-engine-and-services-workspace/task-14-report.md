# Task 14 report — deadline rules and business-calendar administration

Status: PASS / final-review-complete

## Scope delivered

- Added tenant-aware React Query hooks for deadline-rule and business-calendar
  list/detail/impact operations. Query keys normalize filters, pass abort
  signals, preserve structured API errors, and invalidate rule, calendar,
  impact, service-catalog association, and pending-reconciliation projections
  after successful writes.
- Extended Services Administration to a URL-backed three-tab page: Service
  catalog, Deadline rules, and Business calendar. Tabs preserve their selected
  state and expose semantic tab/tabpanel relationships with responsive 44px
  controls. The page consumes the existing workspace feature settings gate and
  provides loading, retryable error, and unavailable states before rendering
  administration controls.
- Added rule administration with searchable/status-filtered list, versioned
  detail view, identity/recurrence/applicability/typed-parameter/milestone
  authoring, validated expression operations, current draft revision/hash
  preview identity, publish gating, archive reason plus impact gating, eight
  impact count groups, warning state, and up-to-100 sample display.
- Added business-calendar administration for weekend days, named holidays,
  exact revision display, date-change preview/fingerprint gating, safe update
  concurrency payloads, loading/error/retry/empty states, and accessible
  semantic controls.
- Extended service-variant authoring with tenant-safe deadline-rule
  associations, enabled-by-default state, typed parameter defaults, display
  ordering, and the shared generic schedule-entry editor (0–31 stable-keyed
  entries, relative sources, and business-day adjustments).

## TDD evidence

The required RED run was collected before the new admin panels existed:

```text
npm.cmd run test:run -- __tests__/components/deadline-rules-admin.test.tsx __tests__/components/business-calendar-admin.test.tsx
FAIL — Vite could not resolve the new deadline-rules-panel and business-calendar-panel imports
```

The final focused admin suite is GREEN:

```text
npm.cmd run test:run -- __tests__/components/deadline-rules-admin.test.tsx __tests__/components/business-calendar-admin.test.tsx __tests__/components/services-admin-page.test.tsx __tests__/components/service-catalog.test.tsx __tests__/components/schedule-entry-editor.test.tsx
5 files passed; 32 tests passed
```

The focused tests cover all three administration tabs and URL state,
publish/archive/calendar impact confirmation mutations, saved-draft
revision/hash gating, nested applicability transitions that remain valid
against the accepted schema, calendar selection and inactive-holiday history,
tenant rule option/typed parameter wiring, association ordering, and stable
keyed schedule-entry limits/reordering.

## Review-correction evidence

The rereview corrections close the interaction-level gaps identified in
`task-14-review.md`:

- Impact dialogs now own the publish, archive-confirmation, and calendar-save
  mutations; cancel/close clears the corresponding preview state.
- Editing a rule marks the candidate dirty and disables preview/publish until
  the server returns the saved draft. Preview and publish then use that saved
  revision/hash identity and current impact fingerprint.
- Applicability group and predicate transitions rebuild discriminated nodes
  with field/operator-compatible defaults, including nested groups.
- Service variants load tenant-scoped active rule definitions and render typed
  parameter controls while preserving multi-association order and schedules.
- All business calendars are selectable with selection preserved through
  refresh; inactive holiday rows retain identity/state and explicit removal is
  represented by omission from the active replacement set.
- Administration panels remain mounted while hidden, tab keyboard navigation
  supports Arrow/Home/End keys, rule pagination exposes server totals, and
  catalog mutations invalidate the complete client-option projection prefix.
- Publish and archive now replace the local selected rule with the
  authoritative mutation DTO (or await detail refetch before clearing the
  override), so the post-mutation version/state and the next preview use the
  current server identity without reselecting the row.
- Reassigning a variant from one rule to another rebuilds defaults only from
  the new rule's compatible typed definitions and explicitly resets
  association schedule entries, preventing old or wrong-type keys from being
  submitted.

## Compatibility and verification evidence

The relevant Task 3–8, Task 10, catalog, API, and schedule compatibility
selection passed:

```text
npm.cmd run test:run -- __tests__/components/business-calendar-admin.test.tsx __tests__/components/deadline-rules-admin.test.tsx __tests__/components/services-admin-page.test.tsx __tests__/components/service-catalog.test.tsx __tests__/components/schedule-entry-editor.test.tsx __tests__/services/services-admin-foundation-schema.test.ts __tests__/services/deadline-rule-operation-schemas.test.ts __tests__/services/deadline-rule-impact.test.ts __tests__/services/deadline-rule.service.test.ts __tests__/services/business-calendar.service.test.ts __tests__/services/service-catalog.service.test.ts __tests__/lib/service-schedule-validation.test.ts __tests__/lib/service-catalog-validation.test.ts __tests__/api/deadline-rule-routes.test.ts __tests__/api/service-calendar-routes.test.ts __tests__/api/service-catalog-routes.test.ts
16 files passed; 139 tests passed
```

Directly relevant Chromium checks passed:

```text
npm.cmd run test:browser -- __tests__/browser/services-admin.browser.test.tsx
1 file passed; 2 tests passed
```

Static checks passed:

- `npx.cmd tsc --noEmit --pretty false`
- Scoped ESLint over changed Task 14 source/hooks/tests: zero warnings and
  zero errors.
- `git diff --check`

## Final review gate

Final review: **PASS — 0 Critical / 0 Important / 0 Minor**.
The final correction is committed as `96267581` (`fix: refresh final Task14
administration state`), on top of the implementation/remediation commit
`a27837d9`. The bounded final gate evidence above records 5 focused files / 32
tests, 16 compatibility files / 139 tests, Chromium 2 tests, TypeScript, and
scoped zero-warning lint.

No repository-wide baseline, full build/lint, Prisma generation/migration,
live database, or final Plan 2 gate was run. Task 15 was not started.

## Changed files

- `src/hooks/use-deadline-rules.ts`
- `src/hooks/use-service-calendars.ts`
- `src/hooks/use-service-catalog.ts`
- `src/hooks/use-template-partials.ts`
- `src/components/services/admin/services-admin-page.tsx`
- `src/components/services/admin/deadline-rules-panel.tsx`
- `src/components/services/admin/deadline-rule-form.tsx`
- `src/components/services/admin/business-calendar-panel.tsx`
- `src/components/services/admin/rule-impact-dialog.tsx`
- `src/components/services/admin/catalog/service-variant-form.tsx`
- `__tests__/components/deadline-rules-admin.test.tsx`
- `__tests__/components/business-calendar-admin.test.tsx`
- `__tests__/components/services-admin-page.test.tsx`
- `__tests__/components/service-catalog.test.tsx`
- `__tests__/browser/services-admin.browser.test.tsx`
