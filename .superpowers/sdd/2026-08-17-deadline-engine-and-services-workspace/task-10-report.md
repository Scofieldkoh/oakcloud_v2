# Task 10 report — Services roster review remediation

Status: final-review-complete / PASS

Implementation commits: `58bb422`, `634106e`, `864868b`, `b0a1d98`

## Scope delivered

- Routed Company, Family, and Service inline filters through canonical URL state and the accepted Task 9 roster search contract as `companyQuery`, `familyQuery`, and `serviceQuery`. Prisma predicates, next-deadline SQL, totals, pagination, React Query keys, and transport parsing remain tenant/access scoped.
- Added a company-read, workspace-gated operational family-facet endpoint at `/api/client-services/families` and a stable abort-aware hook. A grouped SQL query covers both active and archived accessible client services, applies tenant/company predicates in the database, and does not depend on the current roster page or administrator-only catalog access. Facet failures no longer fall back to page-local families; the roster shows a retryable error state.
- Replaced the first-page-only Add flow with the existing server-scoped `/api/companies/options` search/page contract through `useCompanyOptionsPage` and `AsyncSearchSelect`; typed search, zero-based paging, `hasMore`, and accessible-company predicates remain server-owned.
- Made `services.roster.table.v1` a defensively parsed versioned preference containing widths, order, visibility, sort, and page size. Added accessible column visibility/order controls and resize-end/debounced width persistence. Pending resize patches merge from the current preference, cancel before immediate writes, and clean up on unmount; URL state remains authoritative for shareable filters, sorting, and pagination.
- Changed roster state to derive from `useSearchParams`, with optimistic URL updates for responsive controls and synchronization when browser Back/Forward changes the address bar. Family badges retain semantic foreground text and use configured colours only for border/dot accents.
- Upgraded the shared `AsyncSearchSelect` used by Add Service to expose a labelled WAI-ARIA combobox/listbox, active descendant, selected options, named clear action, and mobile-sized trigger/paging/option targets. Roster column controls are also at least 44px, and roster page sizes are restricted to the API-supported 10/20/50/100 values.
- Retained a visible, labelled combobox state after selection so the label target remains present while preserving keyboard/click clear and reselect behavior. Visibility labels in column customization now stretch across each 44px row.
- Preserved typed `ApiError` responses from the family-facet route, including the disabled-workspace 404.

## TDD and verification evidence

- RED: rereview boundary tests failed for archived-only family facets/page-local error fallback, delayed resize preference snapshots, real combobox/listbox semantics and touch targets, 200-page-size parsing, undersized column controls, and typed family-route 404 handling.
- GREEN: rereview correction suite — 13 files / 66 tests passed.
- RED/GREEN: final-review accessibility tests failed for the selected combobox label target and visibility-label hit area, then passed after retaining the selected combobox state and stretching the labels.
- RED/GREEN: final accessibility rereview tests failed for Enter-selection focus loss and nested clear composition, then passed with explicit focus transfer and sibling clear controls; unsupported `aria-valuetext` was removed.
- RED/GREEN: final keyboard review test failed because selected disabled values remained tabbable and lacked `aria-disabled`; it passed after the selected control became non-tabbable, keyboard-inert, and explicitly disabled.
- GREEN: final-review narrow component suite — 4 files / 18 tests passed.
- Accepted Task9/shared regression suite — 12 files / 113 tests passed.
- Chromium Services Admin + Company Services suite — 2 files / 4 tests passed.
- `npm.cmd exec -- tsc --noEmit --pretty false` — pass.
- Scoped ESLint over touched Task10 source/tests with `--max-warnings 0` — pass with zero warnings/errors.
- `git diff --check` — pass.

## Boundary coverage

- Canonical inline filters are serialized, normalized, server-predicated, page-resetting, and included in truthful totals; next-deadline SQL includes the same fields.
- Family options are complete and grouped across active and archived accessible operational records even when the visible roster page contains only another family; empty access scopes return no facet query and settled failures offer retry without page-local fallback.
- Company search includes typed query, page, limit, `hasMore`, and Next/Previous behavior; the Add dialog mounts the shared creator only after a selected accessible company.
- Preference restore defensively handles unknown columns/invalid widths/version, preserves default columns/actions, restricts page sizes to the roster/API contract, and covers order, visibility, sorting, page size, resize-end persistence, and the cross-action pending-resize race.
- The real Add Service selector exposes label association, combobox/listbox ownership and active descendant, option selection, named clear action, and 44px mobile controls; the family route preserves typed errors.
- Selected values retain the labelled combobox target and value text; Enter selection retains focus, Backspace/Delete and sibling clear return focus to the input, and keyboard reselection remains available. Each column-visibility label fills its 44px customization row.
- Selected disabled values expose `aria-disabled`, use `tabIndex=-1`, omit the clear action, and ignore keyboard clearing while enabled Add Service focus, clear, and reselection behavior remains covered.
- Browser navigation updates request state from URL changes; family text remains semantic and colour-independent.

## Assumptions and residual risks

- Family facets describe families represented by either active or archived operational client services in the accessible workspace rather than the administrator-only catalog. Families with no operational client-service record are not offered as roster filters.
- Company option paging uses the existing zero-based `/api/companies/options` contract with its server-side company-read predicate; no client tenant parameter is trusted for scope.
- Repository-wide baseline/full build/full lint, Prisma generation/migrations, live database tests, and plan-level performance tests remain deferred to the plan-level gate.
- Final Task10 review is closed at 0 Critical / 0 Important / 0 Minor; no Task11 work was started.

## Changed files

- `src/lib/validations/service-roster.ts`
- `src/services/service-roster/{service,types,index}.ts`
- `src/app/api/client-services/families/route.ts`
- `src/hooks/{use-service-roster,use-service-roster-families,use-all-company-options}.ts`
- `src/components/services/roster/{service-roster,service-roster-table,add-client-service-dialog}.tsx`
- Focused Task10/service-roster/family/options/component tests.
- This report and the SDD ledger entry.
