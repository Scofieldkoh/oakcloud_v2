# Task 5 review — explicit client-service billing configuration

## Scope and evidence

- Reviewed only `7f03be9b..b809cbda` in the shared worktree, read-only except for this required review artifact.
- Reviewed against Plan 3 Task 5 and Global Constraints, the approved specification, Task 5 brief/report/review package, the SDD ledger, repository guidance, the task-reviewer template, React state/render guidance, and the relevant form/spacing/accessibility/responsive design guidance.
- No `components.json` exists, so the UI was reviewed against the existing Oakcloud primitives.
- Focused verification: `npm.cmd run test:run -- __tests__/lib/client-service-validation.test.ts __tests__/services/client-service-manual-create.test.ts __tests__/services/client-service.service.test.ts __tests__/components/client-service-creator.test.tsx __tests__/components/operational-service-form.test.tsx __tests__/services/service-agreement-activation.service.test.ts --reporter=dot` — **PASS**, 6 files / 120 tests. The creator confirmation test emitted two React `act(...)` warnings.
- `git diff --check 7f03be9b..b809cbda` — **PASS**.

## Strengths

- The canonical optimistic-concurrency contract is preserved: the request schema accepts legacy `updatedAt` only as a transform to `expectedUpdatedAt`, rejects conflicts, and the service-layer type receives only `expectedUpdatedAt` (`src/lib/validations/client-service.ts:113-145`; `src/services/client-service/service.ts:826-830,963-979`).
- Update persistence, fee archival, audit, and reconciliation enqueue all execute in the same Serializable transaction (`src/services/client-service/service.ts:827-1100`). Manual creation and agreement activation likewise use their existing Serializable transaction helpers.
- The update path correctly supports `CONFIGURED`, `NOT_REQUIRED`, and `UNREVIEWED`, clears reasons outside `NOT_REQUIRED`, requires a reason for `NOT_REQUIRED`, archives active fee rows with the user's reason, and enqueues `CLIENT_SERVICE_CONFIGURATION_CHANGED` for the Task 3 cancellation handoff (`src/services/client-service/service.ts:836-842,906-931,963-987,1051-1097`). The existing reconciler cancels unmatched future Open occurrences for `NOT_REQUIRED`.
- Fee-line update/archive lineage is preserved rather than hard-deleted, and an archived incoming ID cannot be silently reactivated (`src/services/client-service/service.ts:988-1039`). Public DTOs filter inactive/deleted fee rows while retaining schedule configuration on active rows (`src/services/client-service/mapper.ts:71-86`).
- Service lookups remain tenant-scoped and can apply accessible-company scope in SQL (`src/services/client-service/service.ts:426-447`); routes retain `company:read` / `company:update` permission checks.
- Agreement activation sets `CONFIGURED` only when matching agreement fee lines exist, otherwise `UNREVIEWED`; it converts legacy agreement fee templates and enqueues within the activation transaction (`src/services/service-agreement/activation.service.ts:195-255`).
- The form uses controlled string amounts, functional top-level state updates, responsive one-column/two-column grids, 44px schedule-editor touch targets, visible Unreviewed warning, required reason input, pressed-state semantics, and a confirmation before hiding schedules.

## Findings

### Critical

None.

### Important

1. **The billing schedule editor offers configurations that the billing schema explicitly rejects.**
   - Evidence: the new fee UI mounts the unrestricted shared `ScheduleEntryEditor` (`src/components/companies/company-detail/operational-service-form.tsx:317-322`). That editor offers Company field, parameter, other-entry, and milestone sources plus integer-parameter offsets (`src/components/services/shared/schedule-entry-editor.tsx:151-166`). Billing validation permits only cycle/current-entry sources and numeric literal offsets (`src/lib/validations/billing.ts:24-43`). A user can therefore select a normal-looking option and only discover after submission that it is invalid.
   - Why it matters: Task 2's accepted ruling deliberately rejected expressions the fee evaluator cannot resolve. Task 5 must not present those expressions as supported billing choices.
   - Fix: add capability props or a billing-specific wrapper around the shared editor so fee schedules expose only `CYCLE_START`, `CYCLE_END`, `CURRENT_SCHEDULE_ENTRY`, and literal offsets. Keep the full editor for deadline rules. Add component tests proving unsupported source/operand choices are absent from the billing editor and valid choices serialize successfully.

2. **The normal form path can save `CONFIGURED` billing with no materializable schedule, and CUSTOM recurrence is hard-coded rather than configurable.**
   - Evidence: a missing fee schedule is synthesized with `scheduleEntries: []` (`src/components/companies/company-detail/operational-service-form.tsx:23-35`). Entering a billing start date turns that incomplete value into an explicit `scheduleConfig` while retaining the empty entry list (`src/components/companies/company-detail/operational-service-form.tsx:315-321`), so service-side legacy conversion is bypassed (`src/services/client-service/manual-create.ts:18-25`; `src/services/client-service/service.ts:37-44`). Client validation only checks that a superficially non-empty fee row exists and does not require a billing start date or schedule entry (`src/components/companies/company-detail/client-service-form-state.ts:68-88`). For CUSTOM, the UI always writes a one-month interval and provides no interval-count control (`src/components/companies/company-detail/operational-service-form.tsx:33,308-316`). Coverage later classifies missing start/entries as actionable gaps (`src/services/billing/coverage.ts:688-710`), and the evaluator emits nothing for an empty schedule.
   - Why it matters: the approved contract says `CONFIGURED` means valid fee lines and schedules. A user can complete the visible form and immediately create a missing-configuration issue instead of a rolling billing schedule; arbitrary supported custom intervals cannot be authored.
   - Fix: either retain `scheduleConfig: null` until deterministic legacy conversion can create the default entry, or create a default stable entry when the start date/frequency is supplied. Require a valid start date and at least one entry before saving Configured billing, and expose/validate the CUSTOM month interval count. Add creator/editor tests for the untouched deterministic template path, empty-entry rejection, and a non-1-month CUSTOM schedule.

3. **The manual-create schema accepts fee-row states that cannot be persisted consistently for `NOT_REQUIRED`.**
   - Evidence: `NOT_REQUIRED` validation requires only a reason and does not reject fee rows (`src/lib/validations/client-service.ts:36-48,180-195`); manual fee rows also accept caller-controlled `isActive` (`src/lib/validations/client-service.ts:165-178`). Creation then persists every supplied row with `isActive: fee.isActive !== false` but never sets archive timestamp/reason (`src/services/client-service/manual-create.ts:141-157`). Thus a schema-valid `NOT_REQUIRED` request with a normal fee row stores an active schedule, while `isActive: false` violates the existing archive check requiring `deletedAt` and a trimmed reason (`prisma/migrations/20260817110000_billing_tracking/migration.sql:138-144`).
   - Why it matters: one valid API shape creates an internally contradictory Not-required service; another valid shape fails as a database constraint error rather than a validation error. This also breaks the intended reason/confirmation semantics outside the UI's happy path.
   - Fix: make manual create require `feeLines: []` for `NOT_REQUIRED` and remove `isActive` from the create fee schema, or deliberately persist supplied rows as archived with `deletedAt` and the user's reason. Re-enforce the same invariant in the service boundary used by legacy direct callers. Add schema and service tests for both active and inactive supplied fee rows.

4. **Structured schedules can disagree with their compatibility frequency/start fields.**
   - Evidence: both create and update schemas validate `billingFrequency`, `billingStartDate`, and `scheduleConfig` independently (`src/lib/validations/client-service.ts:61-75,165-178`). Persistence then stores them independently (`src/services/client-service/manual-create.ts:147-154`; `src/services/client-service/service.ts:1009-1017`). A request may therefore say `billingFrequency: MONTHLY` while carrying an annual structured schedule, or display one start date while reconciliation uses another. The DTO returns both conflicting values (`src/services/client-service/mapper.ts:77-85`).
   - Why it matters: `scheduleConfig` drives occurrence generation while the legacy fields remain the compatibility/display contract. Divergence produces misleading UI and incorrect expectations without a coverage issue.
   - Fix: cross-validate cadence and start date when structured configuration is present, or normalize the compatibility fields from the validated schedule in one canonical helper. Add create/update tests for conflicting cadence and start-date pairs.

5. **Billing fee/schedule changes are not captured in the required before/after audit.**
   - Evidence: update auditing records fee changes only through `summarizeClientServiceFees` (`src/services/client-service/service.ts:907-926,1062-1088`), whose payload contains only count and currency totals (`src/services/client-service/fee-summary.ts:3-11`). Manual create uses the same summary (`src/services/client-service/manual-create.ts:160,265-277`). Description, recurrence, start date, structured entries, active/archive state, line identity, and archive reason are absent. The new tests assert disposition but do not assert schedule audit data (`__tests__/services/client-service.service.test.ts:237-241`).
   - Why it matters: two materially different schedule configurations with identical totals produce indistinguishable audit events, contrary to Task 5's explicit audit-before/after requirement and the approved configuration-changing audit contract.
   - Fix: audit a bounded canonical fee snapshot (stable ID/lineage, description, active/archive state and reason, amount/currency, legacy recurrence/start, and structured schedule or deterministic schedule hash) before and after. Keep payload limits explicit. Test schedule-only changes and Not-required archival snapshots.

6. **Agreement activation and cross-feature handoffs lack assertions for the new billing behavior.**
   - Evidence: the activation suite's matching-fee test asserts only agreement source and fee lineage (`__tests__/services/service-agreement-activation.service.test.ts:63-71`). It never asserts `CONFIGURED` versus `UNREVIEWED`, converted `scheduleConfig`, billing audit values, or that the activation enqueue is in the same transaction. Task 5 also has no integration assertion that a Not-required update's request is consumed to cancel only future Open occurrences. Update tests cover Configured and Not-required but not the accepted `UNREVIEWED` transition or Not-required-to-Configured replacement lineage (`__tests__/services/client-service.service.test.ts:208-295`).
   - Why it matters: the least recoverable paths—agreement activation defaults and the cancellation handoff—can regress while the claimed focused suite remains green.
   - Fix: extend the existing activation test for a fee-bearing entity and a no-fee entity, asserting disposition, deterministic conversion, audit, and enqueue transaction client. Add a focused service/worker handoff test for future Open cancellation with historical/Billed/Waived preservation, plus update-state transition/lineage tests.

### Minor

1. **The new confirmation test completes with React state-update warnings.**
   - Evidence: `__tests__/components/client-service-creator.test.tsx:154-160` uses synchronous `fireEvent` around the dialog transition. The focused run passed but emitted two `ConfirmDialog` updates-not-wrapped-in-`act(...)` warnings.
   - Why it matters: warning-bearing tests can observe intermediate state and make later regressions noisy.
   - Fix: use awaited `userEvent` interactions and `findByRole` / `waitFor` for dialog open, confirmation, and post-confirmation assertions.

## Requirements assessment

| Requirement | Assessment |
| --- | --- |
| Validation backward compatibility and canonical `expectedUpdatedAt` | **Met**, except create fee-state and schedule cross-field gaps above |
| All three update dispositions | **Implemented**, coverage incomplete |
| Serializable transactional write + audit + enqueue | **Partially met** — atomicity/enqueue are correct; audit content is insufficient |
| Fee upsert/archive lineage and Not-required reason semantics | **Met on update; not met for all valid create inputs** |
| Future Open occurrence cancellation handoff | **Implemented through enqueue/reconciler; missing focused handoff proof** |
| Agreement activation disposition/conversion/enqueue | **Implemented; inadequately tested** |
| Tenant/access correctness | **Met for reviewed paths** |
| DTO archived filtering | **Met** |
| Repeatable any-family schedule entries | **Partially met** — editor is generic, but billing exposes unsupported choices and incomplete schedule authoring |
| UI accessibility/responsiveness/warning/confirmation | **Largely met**, with the warning-bearing test and schedule-error UX gaps above |
| React state correctness | **No blocking state bug found**; functional updates are used for the new disposition flow |

## Verdict

**FAIL — requirements not met / fixes required.**

The persistence and reconciliation architecture is well integrated, but six Important issues leave schema-valid inconsistent create states, invalid or incomplete schedule authoring, ambiguous recurrence data, insufficient audit evidence, and unprotected activation/cancellation behavior. These should be fixed and rereviewed before Task 5 is accepted.
