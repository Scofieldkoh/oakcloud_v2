# Task 8 — billing tracking acceptance

## Outcome

Task 8 closes the deferred generic `ONE_TIME` repeatable-entry contract,
adds live PostgreSQL tenant/manual-deadline/performance acceptance coverage,
and emits bounded allowlisted worker observability. The original
implementation is `5d3f5b59` (`test: verify billing tracking acceptance`).
The review hardening is `1f081801` (`test: verify billing tracking
acceptance`). The final review coverage is `d0e7a018` (`test: cover permanent
reconciliation failure event`); this report is committed separately.

The final whole-branch review corrections are included in the follow-up
implementation commit recorded with this report: schedule evaluation derives
a finite lookaround from cadence, relative offsets, and business-day
adjustments; CONFIGURED is rejected unless every active fee is materially
scheduleable; no-op fee saves compare canonical projections; migration and
runtime coverage issue identities use the same SHA-256 contract; ended or
expired services receive an explicit cancellation reason; and billing text
filters use local drafts with a 300 ms debounce while non-text filters remain
immediate.

The final shared business-day hot-path correction is `76658574` (`test: verify
billing tracking acceptance`). Schedule evaluation now snapshots and validates
the immutable calendar once per evaluation, then reuses O(1) weekend/holiday
membership during period traversal. Public date-engine helpers retain their
per-call validation/error behavior.

The round-3 calendar-validation correction is `7fdf84c8` (`test: verify
billing tracking acceptance`). Nonempty schedule evaluations now construct the
validated engine unconditionally, so plain calendar-day entries fail closed on
malformed id, revision, weekend-day, and holiday snapshots; empty or
missing-start schedules retain their existing empty-result behavior.

The `ONE_TIME` contract is explicit: every stable repeatable entry materializes
exactly once, in stable-key order. It does not silently select the lexical-first
entry.

## TDD and review evidence

- The original `ONE_TIME` RED was `1 failed / 15 passed`; GREEN was `16
  passed`. Repeated evaluation is deterministic and bounded-range behavior is
  covered.
- Review RED exposed an absent fail-closed preflight helper and unbounded
  worker event identifiers. The focused worker/preflight GREEN result is `2
  files / 24 tests passed`.
- Worker events are one fixed structured event per request. IDs/text are capped
  at 200 characters, warnings at 50, warning `missingFields` at 20 entries,
  numeric/cardinality values at 1,000,000, and duration at 86,400,000 ms.
  Warning/error/customer free text is discarded; only allowlisted warning codes
  and bounded identifiers/field names remain. Success, retry, exhausted retry,
  and permanent failure paths assert one complete event, fixed keys, metrics,
  bounds, and redaction.
- A thrown `MISSING_RULE_INPUT` dependency error with a valid lease has a
  dedicated regression test: the request completes exactly once, emits one
  complete event with the expected IDs/attempt/write mode and metrics, persists
  a bounded allowlisted warning and safe error, and never emits the original
  customer/free text. The permanent lease-handoff path remains separately
  covered as lease loss.
- Final-review RED/GREEN coverage included three distant-offset schedule
  failures before the lookaround fix, invalid CONFIGURED legacy/create/update
  cases, a UI-shaped no-op save that previously wrote/archive/audited, two
  ended/elapsed cancellation expectations, and immediate text-filter
  assertions. The final focused run was `8 files / 123 tests passed`, with no
  skips.
- The final rereview RED reproduced dense holiday positive/negative movement,
  dense `NEXT`/`PREVIOUS` adjustment lookaround, reconciler preservation,
  formatting-equivalent Decimal/string amounts, and display-order-only fee
  changes. The 7x blocker bound (required business days, finite holidays,
  weekend days, and adjustments, capped at `MAX_SEARCH_DAYS`) and canonical
  fee projection now pass the compatibility run (`7 files / 148 tests`, no
  skips).
- The final hot-path RED used the accepted maximum calendar shape (500
  holidays, six weekend days, and a one-business-day relative entry). The old
  implementation exceeded a deterministic 20,000 holiday-iteration budget and
  took 64.86 seconds for the focused test. GREEN completes the same evaluation
  in 12 ms of test execution with exactly 500 holiday iterations (one calendar
  snapshot), eliminating repeated `validateCalendar`/holiday traversal.
- The round-3 RED reproduced four malformed-calendar bypasses for plain
  `DAY_OF_MONTH` entries. GREEN covers those four validation errors plus
  empty/missing-start preservation, reconciler `INVALID_SCHEDULE` handling
  without occurrence writes, and coverage `INVALID_CUSTOM_SCHEDULE` handling.
- Tenant acceptance now seeds two companies in each tenant. An actor scoped to
  company one cannot list, read, mutate, or receive coverage rows for the
  same-tenant company two; the allowed company and tenant-two negatives remain
  covered. The service predicates enforce this in SQL.
- Billing acceptance scripts fail closed before Vitest. Without variables,
  `test:billing:postgres` exits `1` with `TEST_DATABASE_URL`, and
  `test:billing:performance` exits `1` with `TEST_DATABASE_URL,
  RUN_PERFORMANCE_TESTS=true`. The enabled PostgreSQL scripts run serially with
  `--maxWorkers=1`.

## Verification matrix

| Gate | Result |
| --- | --- |
| Worker observability + preflight focused suites | PASS; `2 files / 24 tests`, no skips |
| Live tenant/company isolation suite | PASS; `1 file / 2 tests`, no skips |
| `npm.cmd run test:billing:postgres` with isolated `TEST_DATABASE_URL` | PASS; `5 files / 9 tests`, no skips |
| `npm.cmd run test:billing:performance` with `TEST_DATABASE_URL` and `RUN_PERFORMANCE_TESTS=true` | PASS; `1 file / 2 tests`, no skips |
| Billing preflight focused suite | PASS; `1 file / 4 tests`, no skips; missing required variables exits `1` for both package scripts |
| Billing browser smoke | PASS; `1 file / 2 tests`, no skips |
| Final schedule/reconciler/client-service compatibility run | PASS; `7 files / 148 tests`, no skips |
| Final business-day/schedule/reconciler/deadline compatibility run | PASS; `13 files / 210 tests`, no skips |
| Round-3 malformed-calendar compatibility run | PASS; `6 files / 156 tests`, no skips |
| `npx.cmd prisma migrate status` on disposable database | PASS; `54 migrations found`, database schema up to date |
| `npx.cmd prisma generate` / `npx.cmd prisma validate` | PASS with the disposable database URL |
| `npx.cmd tsc --noEmit` | FAIL only at pre-existing generated route validation: `.next/types/app/api/services/settings/route.ts:38`; no changed-file errors |
| `npm.cmd run lint` (`eslint src`) | PASS; 0 errors, 4 existing warnings |
| `npm.cmd run build` | Compiled successfully; then failed at the same pre-existing generated route type error above |
| Final repository-wide Vitest baseline | `344 passed / 8 failed / 19 skipped` files; `2,895 passed / 33 failed / 54 skipped` tests; failures remain the unrelated schema/provider/role fixtures, with no billing failures |
| `git diff --check` | PASS; no findings |

The final baseline was rerun after the rereview corrections and before this
isolated in-memory helper optimization. Compared with the prior `343 / 2,866`
passing-file/test evidence, it records the added focused coverage as `344 /
2,895` while preserving the same `8` failing files, `33` failing tests, `19`
skipped files, and `54` skipped tests. The failures are unrelated existing
schema expectations and missing UI test providers/roles; no billing acceptance
test was weakened or removed. This helper-only correction changes no SQL,
migration, UI, or repository-wide test paths, so the repository-wide baseline
was not rerun; the changed shared helper was covered by the 13-file
compatibility matrix above. The skipped suites remain environment-gated
optional tests. The dedicated billing PostgreSQL, performance, and browser
gates above were enabled and had no skips.

Prior Task 8 evidence also remains valid for the Plan 3 focused matrix (`16
files / 158 tests`), worker/schedule regression matrix (`4 files / 57 tests`),
browser smoke (`1 file / 2 tests`), and the original build/baseline diagnosis;
the review reruns above cover every changed production path and acceptance
gate.

## Disposable PostgreSQL and migration evidence

Docker Desktop was unavailable. A fresh PostgreSQL 17 cluster was created
locally with trust-only authentication at
`127.0.0.1:55433`, under
`C:\Users\Scotfield\AppData\Local\Temp\oakcloud-task8-review-pg-20260825`,
using database `oakcloud_task8_review_20260825`. No credentials are recorded,
and no shared/source database was migrated or modified.

The cluster received the complete Prisma migration chain (`54 migrations
found`; `Database schema is up to date`). The live package matrix and
performance suite ran against this database, cleaned their tenant fixtures,
and the cluster was stopped and its disposable data directory removed after
verification. The backfill APPLY regression used the migration-produced
SHA-256 key and verified an existing row was refreshed (`xmax=false`/inserted
false) rather than opening a duplicate; unresolved counts remained truthful.

The live billing index inspection showed PostgreSQL's 63-character physical
names, including:

- `billing_occurrences_tenant_id_operative_expected_date_status_id`
- `billing_occurrences_tenant_id_client_service_id_operative_expec`
- `billing_occurrences_tenant_id_company_id_operative_expected_dat`
- `billing_coverage_issues_tenant_id_company_id_severity_resolved_`

## Live performance evidence

The performance fixture seeded 1,000 companies, 10,000 client services,
10,000 fee lines, 100,000 billing occurrences, and 1,000 unresolved coverage
issues, then ran `ANALYZE` before reads. Schedule-evaluator changes do not alter
the measured list/coverage query paths; the performance gate was nevertheless
rerun and remained green. The rereview changes only adjust in-memory schedule
lookaround, fee comparison, and business-day calendar traversal, so the live
PostgreSQL acceptance and performance suites were not rerun in this final
helper-only pass; their no-skip evidence from the preceding commit remains
applicable, and no migration/query shape changed. The focused 13-file matrix
and deterministic maximum-shape timing cover the changed execution path and
show the reconciler-scale lease risk is removed without changing database
behavior.

The EXPLAIN harness captures Prisma query events emitted by the actual
`listBillingOccurrences` and `listBillingCoverage` production services,
interpolates their bound parameters, and runs `EXPLAIN (ANALYZE, BUFFERS,
FORMAT JSON)` on those captured query shapes. It does not use handcrafted SQL
or force `enable_seqscan`. With one selective company input, PostgreSQL
naturally chose the tenant/client-service/operative-date occurrence index
family (with status in the production filter) and the
tenant/company/severity/unresolved coverage index.

Measured local PostgreSQL 17 representative acceptance timings were:

- occurrence list: `473.05 ms`
- coverage summary: `83.46 ms`
- target: each `<= 1,500 ms`

These are local representative acceptance results, not staging evidence. No
staging target was available in this environment; a staging-sized rerun with
production-like data remains a release/environment gate and is explicitly not
fabricated here.

The manual historical-deadline acceptance passed in the serial matrix and
confirmed no billing request or billing occurrence side effect. The tenant
suite covered same-tenant company controls and tenant-two negatives with
production SQL predicates.

## Clean-worktree and artifact policy

No credentials, PostgreSQL data directory, browser artifacts, performance
output, or review package was added. The implementation/test commits contain
only the accepted source/tests/package preflight helper. This report is committed
separately as the documentation/evidence commit.
