# SDD ledger — plan: docs/superpowers/plans/2026-08-17-deadline-engine-and-services-workspace.md

## Execution context

- Worktree: `C:\Users\Scotfield\OneDrive\Documents\Python Project\oakcloud_development\oakcloud\.worktrees\services-administration`
- Branch: `codex/services-administration`
- Plan 2 base: `39eeb2a`
- Implementation agents: `gpt-5.6-luna`, reasoning `max`
- Per-task review agents: `gpt-5.6-sol`, reasoning `medium`
- Final whole-branch review: `gpt-5.6-sol`, reasoning `xhigh`
- Repository-wide baseline, full build/lint, and live migration gate remain deferred until all three implementation plans are complete, per the ruling recorded in the Plan 1 ledger. Focused RED/GREEN tests, TypeScript, scoped lint, browser checks, and task-specific migration verification remain required.

## Producer/consumer map

| Producer | Consumers / review consequence |
|---|---|
| Task 1 — persistence foundation | Tasks 4, 5, 7, and 11 must use the exact models, enums, relations, constraints, and indexes. |
| Task 2 — generic schedule/date contracts | Tasks 3, 4, 5, 7, 8, 12, 13, 14, 15, and Plan 3 must reuse the generic schedule contracts and Singapore date-only semantics. |
| Task 3 — applicability evaluator | Tasks 4, 6, 7, 8, and 13 must distinguish applicable, not-applicable, and missing-input results. |
| Task 4 — business calendars | Tasks 6 and 14 must use persisted calendar revisions and business-day adjustment behavior. |
| Task 5 — rule authoring/versioning | Tasks 6, 7, 8, and 14 must preserve immutable published versions and rule associations. |
| Task 6 — impact/publish/archive/queue | Tasks 7, 8, and 14 must respect impact confirmation and durable reconciliation enqueueing. |
| Task 7 — reconciliation | Tasks 8, 9, 10, 11, 15, and Plan 3 consume generated cycles/occurrences and settings. |
| Task 8 — client-service configuration | Tasks 13, 14, and Plan 3 consume generic schedule entries and per-client inputs. |
| Task 9 — roster API | Tasks 10, 15, and Plan 3 consume the accessible-company roster projection. |
| Task 10 — workspace shell | Tasks 12, 13, and Plan 3 extend its navigation and operational layout. |
| Task 11 — deadline APIs | Tasks 12, 13, and 15 consume deadline query and lifecycle contracts. |
| Task 12 — table/calendar views | Task 15 and Plan 3 extend the accepted operational views. |
| Task 13 — manual historical cycles | Task 15 verifies manual-origin behavior; manual cycles never create billing expectations. |
| Task 14 — administration UI | Task 15 and Plan 3 depend on rule/calendar administration behavior. |
| Task 15 — acceptance/isolation/performance/docs | Plan 2 phase gate and Plan 3 handoff. |

## Shared invariants

- Repeatable schedule entries are generic for every service family; there is no payroll-only schedule path.
- A schedule supports 0–31 entries with stable entry keys.
- Relative dates, including expressions such as the second-last working day, use persisted business calendars.
- Date-only computation is deterministic in `Asia/Singapore`; no UTC timestamp drift may alter a business date.
- Published rule versions are immutable. Reconfiguration changes only future/open, rule-generated, non-overridden occurrences; historical, completed, waived, cancelled, manual, and overridden records remain intact.
- Deadline types are independently filterable: `STATUTORY`, `CLIENT`, and `INTERNAL`.
- Deadline statuses are `OPEN`, `COMPLETED`, `WAIVED`, and `CANCELLED`; overdue/upcoming timing is derived.
- Accessible-company predicates must be enforced inside SQL queries, not only after retrieval.
- Administration mutations require administration authority; operational client-service writes require `company:update`.
- The generation horizon is 12 months unless the accepted contract explicitly narrows it.

## Accepted visual contract

- Cover the accepted roster, deadline table, deadline calendar, client-service configuration, rule administration, and business-calendar administration views.
- On the roster, family filters sit beside `Active`, `Paused`, and `Ended`.
- On deadline table/calendar views, family filters sit beside `Statutory`, `Client`, `Internal`, and `Open only`; do not render the wording `Filter families`.
- Service-family legends are clickable filters and preserve a non-colour text cue.
- Company events show the configured company display label and full company name where space permits; display-label fallback is the first letter of each word (for example, `Oaktree Accounting & Corporate Solution Pte. Ltd.` becomes `OACS`).
- Family colours configured in Service Administration affect both table and calendar views.
- Calendar defaults responsively to one or two months and persists the user's month-count preference.
- Maintain breathable spacing and at least 44px touch targets on mobile controls.

## Task status

| Task | Status | Commit | Review |
|---|---|---|---|
| 1 | PASS | `e33aa38`, `a6dadfb`, `67db3ee` | Third review: 0 Critical / 0 Important / 0 Minor; live PostgreSQL integration remains for CI/final gate |
| 2 | PASS | `22663fe`, `726cd46`, `3495cb7`, `db29a18` | Fourth review: 0 Critical / 0 Important / 0 Minor; 33 focused tests |
| 3 | PASS | `2847490`, `942d95b`, `a66d0bb` | Third review: 0 Critical / 0 Important / 0 Minor; 67 focused tests |
| 4 | PASS | `9f0a899`, `6b6cbdc`, `e2f64d8`, `abb3bc9` | Third review: 0 Critical / 0 Important / 0 Minor; 88 focused tests; live PostgreSQL integration remains for final gate |
| 5 | PASS | `30aec43`, `60e8efc`, `62a98ac` | Third review: 0 Critical / 0 Important / 0 Minor; 72 correction tests and 93 relevant regression tests; live PostgreSQL integration remains for final gate |
| 6 | PASS | `aed52e4`, `3015101`, `c747dee`, `c0a1c05` | Final rereview: 0 Critical / 0 Important / 1 Minor; Minor integration-fixture cleanup fixed in `c0a1c05`; PostgreSQL gates remain deferred without `TEST_DATABASE_URL` |
| 7 | PASS | `3e6d035`, `c747dee`, `c0a1c05`, `41c12dd`, `c80e1c6` | Final review: 0 Critical / 0 Important / 0 Minor; 30 focused tests and 69 Task 6 compatibility tests; PostgreSQL gates remain deferred without `TEST_DATABASE_URL` |
| 8 | PASS | `c2abca9`, `da3d31b`, `cd0cba4`, `27604d1` | Final review: 0 Critical / 0 Important / 0 Minor; 20 focused historical-audit tests plus full Task 8 correction/regression gates |
| 9 | PASS | `9d2e3ea`, `90087f0` | Rereview: 0 Critical / 0 Important / 1 unrelated pre-existing Minor; 33 focused tests plus 166 compatibility tests |
| 10 | PASS / final-review-complete | `58bb422`, `634106e`, `864868b`, `b0a1d98` | Final review 0 Critical / 0 Important / 0 Minor; selected combobox focus/composition and disabled-state semantics closed with keyboard RED/GREEN tests, visibility hit area retained; narrow final suite 4 files/18 tests, TS/lint/diff green; evidence in `task-10-report.md` |
| 11 | PASS | `2172eb1`, `c60f343` | Rereview PASS: 0 Critical / 0 Important / 1 coverage Minor, closed with RuleVersion/mutation/reset tenant-integrity and detail AbortSignal regressions; focused suite 49 tests; compatibility suite 40 tests; TS/lint/diff green; evidence in `task-11-report.md` |
| 12 | PASS / final-review-complete | `a1b12e3`, `e1f96d89`, `e855e2dc` | Final review PASS: 0 Critical / 0 Important / 0 Minor; focused 29 tests, Chromium 2 tests, exact 12-file compatibility 110 tests, TS/scoped zero-warning lint and diff evidence in task-12-report.md |
| 13 | PASS / final-review-complete | `656bcdb5`, `3a60e3c7`, `79d4e17d`, `6d5bb7a8`, `aa42dbe5` | Final review PASS: 0 Critical / 0 Important / 0 Minor; focused Task13 6/58, evaluator/Task11 4/81, exact Task8 6/70, exact compatibility 12/112, TypeScript/scoped zero-warning lint/diff evidence recorded in `task-13-report.md`; known unrelated client-service-schema exact-format assertion remains isolated |
| 14 | PASS / final-review-complete | `a27837d9`, `96267581` | Final review PASS: 0 Critical / 0 Important / 0 Minor; focused admin suite 5 files/32 tests; Task3–8/10/catalog compatibility 16 files/139 tests; Chromium 2 tests; TypeScript/scoped zero-warning lint/diff green; final evidence in `task-14-report.md` |
| 15 | PASS / final-review-complete | `5a43cb48`, `1496067e`, `af5796dd` | Final rereview: 0 Critical / 0 Important / 0 Minor; focused 50/50 with 4 intentional local PostgreSQL skips; invariant compatibility 236 tests; scheduler/route compatibility 24 tests; TypeScript/scoped zero-warning lint/diff green; live DB/migration/generated-client/full lint/build/repository baseline/performance gates deferred by user ruling until Plan 3; handoff assessment in `task-15-report.md` |

### Task 15 review-correction ledger (2026-08-24)

All 7 Important and 3 Minor findings in `task-15-review.md` were validated and
closed in the services-administration worktree. The worker now treats logging
as best effort, updates event aggregates incrementally, and persists only safe
stable error data. Roster/deadline error responses retain timing headers,
PostgreSQL acceptance suites enforce `TEST_DATABASE_URL` in CI while skipping
locally, isolation assertions include own-tenant controls and nonmutation
readback, rollout flags use tenant-or-environment semantics, and performance
fixtures parse EXPLAIN JSON with exact persisted cardinalities and failure-safe
cleanup. See `task-15-report.md` for command output and deferred-gate limits.

### Task 15 Plan 2 handoff (2026-08-24)

Task 15's functional, unit, scoped integration-contract, invariant, TypeScript,
scoped lint, and diff gates are complete and green. Plan 2's live database,
migration, generated-client, repository-wide baseline/full lint, full build,
and wall-clock performance gates remain deferred by user ruling until Plan 3
completes; this row records no pass claim for those gates.
