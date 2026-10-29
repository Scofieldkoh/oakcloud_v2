# Task 12 report — deadline table/calendar views and preferences

Status: PASS / final-review-complete

## Scope delivered

- Added a shared `Deadline filters` toolbar with Statutory, Client, Internal,
  Open only, and adjacent clickable service-family chips. It does not render a
  `Filter families` label.
- Added URL-backed deadline state for `deadlineView`, `from`, `to`, `types`,
  `families`, `companies`, `openOnly`, `origin`, `sortBy`, `sortOrder`, and
  `page`; explicit URL values take precedence over versioned preferences.
- Added the `services.deadlines.view.v1` schema/parser with defensive fallback,
  responsive month-count defaults, persisted one/two/three-month overrides,
  and persisted table presentation settings.
- Added a server-paginated DTO-backed deadline table with semantic badges,
  alternating rows, family accents, mobile cards, column resize persistence,
  and accessible row actions.
- Added a date-fns and React DayPicker calendar with Singapore date-only
  semantics, keyboard-accessible month grids/events, family colour plus text,
  `+N more`, full event details/notes/source/cycle popovers, and selected-day
  agenda support for compact viewports.
- Extended the Services workspace with URL-addressable Services and Deadlines
  tabs while Billing retains its existing placeholder until Plan 3.
- Hardened the media-query hook for test/SSR environments without
  `window.matchMedia`.

## TDD and verification evidence

### RED

Before the Task 12 production modules existed, this focused command failed
because the deadline workspace/calendar imports were absent:

    npm.cmd run test:run -- __tests__/components/deadline-workspace.test.tsx __tests__/components/deadline-calendar.test.tsx
    FAIL — failed to resolve deadline-workspace and deadline-calendar imports

### GREEN

- Focused Task 12 component/browser support suite: 29 tests passed across six
  files, including canonical URL ranges, malformed URL fallback, server-backed
  filters, preference precedence, page-size persistence, lifecycle actions,
  dialog focus/escape/outside/return behavior, compact agenda caps, controlled
  month transitions, and live table-column resize persistence.
- Relevant Task 10/11 compatibility suite: 110 tests passed across exactly 12
  files. The compatibility command was:

      npm.cmd run test:run -- __tests__/services/deadline.service.test.ts __tests__/api/deadline-routes.test.ts __tests__/hooks/use-deadlines.test.ts __tests__/lib/deadline.validation.test.ts __tests__/components/service-roster.test.tsx __tests__/components/service-roster-preferences.test.ts __tests__/components/async-search-select.test.tsx __tests__/services/service-roster.service.test.ts __tests__/api/service-roster-families-route.test.ts __tests__/api/service-roster-route.test.ts __tests__/hooks/use-service-roster.test.ts __tests__/api/services-settings-route.test.ts

  It covers deadline service/routes/hooks/validation and service-roster
  preference/facet/security behavior.
- Chromium browser fixtures: 2 tests passed in
  `__tests__/browser/services-deadlines.browser.test.tsx`.
- `npx.cmd tsc --noEmit --pretty false`: PASS.
- Scoped ESLint over Task 12 source/tests: PASS, 0 warnings.

### Independent review remediation — closed

- Canonical Singapore focus-month ranges now drive both URL-backed views;
  responsive desktop month defaults, persisted one/two/three-month overrides,
  navigation, and Today all reset the page and update `from`/`to` together.
- Malformed, partial, reversed, overlong, and invalid UUID/date query values
  are discarded before strict hook input; explicit URL filters remain ahead
  of versioned preferences. Company, service, milestone, type, due-range,
  status, source, and family controls stay in one unlabeled toolbar and use
  server-backed query state.
- Saved table columns now cover chooser visibility/order, live resize and
  debounced race-safe persistence, family row accents, supported page sizes,
  mobile cards, and paginated DTO results. Lifecycle writes are gated by both
  edit permission and the deadline-write feature flag, with required inputs,
  pending/error feedback, and accessible action dialogs.
- Loading, retryable error, filtered/unfiltered empty, family-facet error,
  calendar truncation, and compact agenda states are distinct; event cues
  include family/type/timing/lifecycle text and full source identity.

### Rereview remediation evidence — closed

- The calendar now has one controlled Singapore focus-month/count source;
  URL ranges are canonical full rendered-month spans across navigation,
  preference arrival, month-count changes, responsive transitions, and
  hydration without replacement loops.
- Saved column payloads accept only known IDs, append missing defaults, clamp
  valid widths, ignore malformed/unknown fields, and always show Actions.
  CANCELLED events are read-only, at least one deadline type remains selected,
  and the non-modal event disclosure plus single-layer action dialog have
  keyboard focus containment and return behavior.
- Company alias/UEN and normalized milestone searches are server-backed;
  company/due-range deviations are actionable, pagination disables terminal
  Next controls, and table sorting/resizing exposes ARIA and keyboard cues.

The final review confirmed these corrections with the focused remediation suite
(29 tests), Chromium browser fixture (2 tests), exact compatibility selection
(110 tests), TypeScript check, scoped ESLint (`--max-warnings 0`, zero
warnings), and diff check.

### Second rereview remediation — closed

- Shared event details/actions now live in `DeadlineEventPanel`, which has no
  trigger or dialog semantics. Calendar events wrap it in one non-modal
  disclosure dialog; table Actions render it directly in one modal dialog with
  a fixed backdrop that intercepts background activation, Escape/outside
  dismissal, focus return, and Tab/Shift+Tab containment.
- Due-range badges compare the effective table range with the Singapore
  semantic default. The default has no badge, and removal writes the default
  range explicitly so clearing a custom range is durable without a
  canonicalization/re-add loop.
- Live pointer and keyboard resizing share the saved 96–800px bounds; pointer
  cancel, pointer release, and component unmount all remove global listeners.

The second-rereview corrections were covered by the exact focused selection
(6 files / 29 tests), including one-dialog/backdrop activation, default-range
badge clearing, pointer cancellation, keyboard upper-bound, and unmount cleanup
assertions. The exact 12-file compatibility selection (110 tests), Chromium
fixture (2 tests), TypeScript check, and scoped zero-warning ESLint all pass.

### Final review and commit evidence

- Final review verdict: **PASS — 0 Critical / 0 Important / 0 Minor**.
- Task12 commits: `a1b12e323e936cc529c951c1693fa18f7fbd08be` (implementation),
  `e1f96d897cd2a7ab9e57fc2d58817dc84ff03cb4` (rereview remediation), and
  `e855e2dc292a7de5f0afc03d6227e62f2c6a7324` (second-rereview remediation).
- Final bounded evidence: focused 6-file/29-test suite, exact 12-file/110-test
  compatibility suite, Chromium 2-test fixture, TypeScript PASS, scoped
  zero-warning ESLint PASS, and clean diff verification.

No repository-wide suite, baseline/full build, full lint, live database, or
migration gate was run; those remain deferred to the integrated Plan 2 gate.

## Boundary and residual review

- Both views consume the Task 11 `DeadlineOccurrenceDto`; no client-side
  deadline truth is fabricated. Company aliases use the backend DTO label and
  event popovers retain the full legal name.
- DayPicker owns focus/month keyboard navigation; custom day cells keep event
  controls reachable and expose `+N more` as a real button. Family colours are
  accents only; labels, badges, and lifecycle text remain visible in both
  semantic themes.
- Final review confirmed the approved mockup spacing and action semantics.
  Prisma/live PostgreSQL and full performance acceptance remain intentionally
  deferred to the integrated Plan 2 gate.
