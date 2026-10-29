# Task 6 rereview — `4c850219..97f6eb12`

## Spec Compliance

- ✅ **PASS.** The correction `077e6876..97f6eb12` addresses the original Important historical-preservation defect, and the cumulative Task 6 implementation `4c850219..97f6eb12` remains consistent with the approved occurrence list/lifecycle requirements.
- Correction scope is focused: `src/services/billing/service.ts`, the three focused Task 6 test files, and the existing Task 6 report. No unrelated production surface changed.

## Original Findings

### Important — ADDRESSED

1. **Historical Open rows are no longer included in `THIS_AND_FUTURE`.** `src/services/billing/service.ts:492-509` converts the selected operative date to DateOnly and computes the lower bound as the later of that date and the supplied Singapore `today`; the SQL predicate remains tenant/company/client-service/fee-line/schedule-entry/generation scoped, `OPEN` only, and now requires `operativeExpectedDate >= max(selectedDate, today)` (`:497-508`). This matches the approved definitions of Historical/Future and preserves overdue matching rows.
2. **One Singapore date is used throughout the mutation.** `src/services/billing/service.ts:526-532` captures `currentDateInSingapore()` exactly once after the tenant/access-safe current-row load and before the Serializable callback. The same captured value builds one `futureWhere`, which is reused for both future selection and update (`:540-550`), avoiding a midnight boundary split between those operations.
3. **The selected row remains independent of the future boundary.** The selected occurrence is still optimistically claimed first with `id + tenantId + expected updatedAt` and non-Cancelled state (`src/services/billing/service.ts:483-489,532-536`). Only the additional matching rows use the Singapore future predicate (`:540-550`), so a historical selected Billed row remains editable without admitting other historical Open rows.
4. **Future IDs, counts, audit metadata, and race rollback remain coherent.** Future IDs come from the bounded predicate inside the transaction (`src/services/billing/service.ts:541-545`); the update reasserts that same predicate plus the selected IDs (`:546-550`); count divergence throws a version conflict before `futureCount` and before audit (`:551-554,558-577`). Because the throw occurs inside `runInSerializableTransaction` (`:512-517,532-579`), the selected and partial future writes roll back together. On success, audit metadata uses exactly `1 + futureCount` and `[selectedId, ...futureIds]` (`:558-575`).
5. **Regression evidence covers the Singapore boundary and truthful audit.** `__tests__/services/billing.service.test.ts:330-373` fixes Singapore time, uses a historical selected Billed occurrence with yesterday/today/tomorrow candidates, verifies the update lower bound is Singapore today, excludes yesterday, and verifies affected IDs/count contain only the selected row plus today/tomorrow. The future-count conflict case rejects and emits no audit (`:480-493`). The code’s explicit Prisma Serializable callback supplies the rollback guarantee that the delegate-only unit double cannot itself persistently simulate.

### Minor — ADDRESSED

1. **The requested focused coverage was materially expanded.** Family/status/timing predicates plus pagination and amount sorting are asserted at `__tests__/services/billing.service.test.ts:137-166`; Open→Waived, Billed/Waived→Open metadata clearing/reason enforcement, forbidden Billed↔Waived transitions, and billed-date rejection outside Billed at `:210-297`; current/future selected/future behavior and the Singapore boundary at `:299-373`; DATE/VALUE/ALL reset isolation at `:400-478`; and future count conflict/no-audit behavior at `:480-493`.
2. **Route and hook gaps are closed.** Feature-disabled and permission-denied lifecycle/reset paths now verify safe failure and no service mutation at `__tests__/api/billing-occurrence-routes.test.ts:107-136,152-181`. Reset now explicitly verifies occurrence detail and affected client-service invalidation in addition to list/coverage/roster invalidation at `__tests__/hooks/use-billing-occurrences.test.ts:88-102`.

## New Breakage Check

- No new Critical, Important, or Minor findings.
- The correction does not broaden mutable fields, lifecycle transitions, tenant/company scope, or affected-row identity. It changes only the future lower bound and reuses the resulting predicate consistently.
- The selected claim still precedes future selection; Cancelled remains terminal; Billed date remains nullable; future updates remain Open-only; reset behavior and hook request/invalidations are unchanged except for added verification.

## Verification Evidence

- Implementer-reported correction RED: focused service suite produced the intended historical-boundary failure before the production fix (plus one corrected invalid test UUID).
- Implementer-reported correction GREEN: 3 focused Task 6 files / 37 tests passed; 12 directly affected compatibility files / 168 tests passed; TypeScript, scoped zero-warning ESLint, and diff checks passed.
- Reviewer focused read-only check: `git diff --check 4c850219..97f6eb12` produced no findings. Per reviewer guidance, the already-reported suites were not rerun.

## Assessment

**Task quality:** Approved

**Verdict:** **PASS** — 0 Critical, 0 Important, 0 Minor.

**Reasoning:** The Singapore historical boundary is now enforced without weakening the selected-row optimistic claim or future-row identity/race protections, and the expanded focused tests cover the previously identified contract gaps. No correction-induced regression was found.
