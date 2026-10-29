# Plan 3 final whole-branch review

## Scope

- Reviewer: `gpt-5.6-sol`, reasoning `xhigh`.
- Review base: `41e7beb93880ca2c96b4f52db9a64b9077599eb7`.
- Final reviewed head: `589e1484`.
- Scope: complete billing tracking and reconciliation Plan 3, including schema/migrations, backfill, shared schedules, rolling reconciliation, coverage, lifecycle APIs, configuration persistence, Billing workspace, access isolation, observability, performance, operations, and all task rulings.

## Review rounds

### Initial verdict — FAIL, 0 Critical / 3 Important / 3 Minor

The initial review found:

1. relative billing dates beyond one cadence could be omitted and valid future occurrences cancelled;
2. Configured could be persisted without a materializable final fee schedule;
3. ordinary editor saves always appeared to change fees and caused writes/audits/reconciliation;
4. migration backfill issue identity differed from runtime coverage identity;
5. ended services received a schedule-removed cancellation reason;
6. Billing text filters navigated/queried on every keystroke.

Commits `04c7a45a` and `06bb3bf6` corrected all six with focused, browser, live PostgreSQL, migration, and final-baseline evidence.

### Rereview 1 — FAIL, 0 Critical / 1 Important / 1 Minor

The reviewer found that dense holiday/six-weekend calendars still exceeded the business-day lookaround bound, and fee comparison omitted `displayOrder` while treating equivalent decimal strings differently. Commits `3c715904` and `782614aa` added safe capped displacement, reconciler preservation, decimal normalization, and display-order change coverage.

### Rereview 2 — FAIL, 0 Critical / 1 Important / 0 Minor

The correctness bound exposed an O(days × holidays × periods) hot path because business calendars were reparsed for every candidate day. A maximum-valid one-fee probe exceeded 90 seconds. Commits `76658574` and `5e29dd3d` introduced one validated immutable calendar engine with O(1) membership. Recorded RED was 64.86 seconds and more than 20,000 holiday traversals; GREEN was 23 ms and exactly 500 traversals. Shared billing/deadline compatibility passed 13 files / 210 tests.

### Rereview 3 — FAIL, 0 Critical / 1 Important / 0 Minor

The optimized engine was initially created only for business-day expressions, allowing malformed calendars to bypass validation for plain calendar-day entries. Commits `7fdf84c8` and `589e1484` create/validate one engine for every nonempty schedule and reuse it. Empty/missing-start behavior remains unchanged; malformed evaluator, reconciler, and coverage cases fail closed without writes.

### Final verdict — PASS, 0 Critical / 0 Important / 0 Minor

The final xhigh rereview verified:

- unconditional one-time calendar validation for nonempty schedules;
- immutable single-pass maximum-shape evaluation without performance regression;
- fail-closed plain `DAY_OF_MONTH` malformed-calendar behavior;
- `INVALID_SCHEDULE` reconciliation with no occurrence writes;
- `INVALID_CUSTOM_SCHEDULE` coverage classification;
- preserved shared deadline behavior.

Targeted final rereview: 6 files / 154 tests passed; `git diff --check` passed; worktree clean.

## Verification and residual release gates

- Billing-focused, compatibility, Chromium, PostgreSQL, migration, performance, lint, and deterministic maximum-shape gates are detailed in `task-8-report.md`.
- Final repository baseline: 344 passed / 8 failed / 19 skipped files; 2,895 passed / 33 failed / 54 skipped tests. The unchanged failures are outside billing and are enumerated in `task-8-report.md`.
- Build compiles successfully and then reaches the unchanged generated settings-route validation failure at `.next/types/app/api/services/settings/route.ts:38`. Lint has 0 errors and 4 existing warnings.
- Local representative PostgreSQL performance passed, but a production-like staging performance run remains an explicit external release gate; no staging result was fabricated.
