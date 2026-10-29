# Task 5 re-review — explicit client-service billing configuration

## Scope and verification

- Reviewed the cumulative range `7f03be9b..9c4ac9c3` and correction range `b809cbda..9c4ac9c3` only. No production code, tests, progress ledger, migrations, or commits were changed.
- Re-read the updated Task 5 report and re-review package, the original review, Plan 3 Task 5 and Global Constraints, approved specification, Task 5 brief, SDD progress, repository guidance, task-reviewer/requesting-code-review guidance, React state/render rules, and relevant design guidance. The project has no `components.json`, so the UI was assessed against existing Oakcloud primitives.
- Focused Task 5 correction suite: **PASS**, 10 files / 184 tests.
- Focused billing/reconciliation suite: **PASS**, 7 files / 106 tests.
- Neither focused run emitted a React `act(...)` warning. No repository-wide baseline/build/full lint/live PostgreSQL migration/performance checks were run.

## Original finding disposition

1. **ADDRESSED — billing editor capabilities.** The shared editor now accepts explicit source/offset capabilities (`src/components/services/shared/schedule-entry-editor.tsx:52-69,134-135,187-192`). Billing restricts sources to cycle start/end/current entry and literal offsets (`src/components/companies/company-detail/operational-service-form.tsx:357-361`), while the deadline editor remains unrestricted (`src/components/companies/company-detail/operational-service-form.tsx:296-307`). Tests prove both modes (`__tests__/components/schedule-entry-editor.test.tsx:48-107`).

2. **ADDRESSED — materializable defaults and CUSTOM recurrence authoring.** `scheduleConfigForFee` creates a deterministic default entry when it has a valid start and retains/configures a CUSTOM month count (`src/components/companies/company-detail/operational-service-form.tsx:24-53`). Save validation canonicalizes the schedule and requires materialization (`src/components/companies/company-detail/client-service-form-state.ts:79-105`), and the UI exposes a bounded CUSTOM interval (`src/components/companies/company-detail/operational-service-form.tsx:352-355`). Creator/form tests cover deterministic materialization, empty-schedule rejection, and an 18-month interval (`__tests__/components/client-service-creator.test.tsx:172-184`; `__tests__/components/operational-service-form.test.tsx:133-170`). A separate state-preservation regression remains below.

3. **ADDRESSED — manual-create Not-required/lifecycle invariants.** The schema no longer exposes caller-owned lifecycle fields and rejects client-owned fee identity/lineage (`src/lib/validations/client-service.ts:165-181`; `__tests__/lib/client-service-validation.test.ts:335-339`). The service boundary independently rejects lifecycle keys, Not-required rows, missing/stray reasons, and Configured without fees before opening the transaction (`src/services/client-service/manual-create.ts:43-79`). Direct-caller coverage is present (`__tests__/services/client-service-manual-create.test.ts:188-210`).

4. **ADDRESSED — structured/legacy schedule consistency.** `canonicalizeBillingSchedule` rejects cadence and start-date conflicts and materializes legacy schedules centrally (`src/services/billing/schedule.ts:51-81`). Create/update, coverage, reconciler, and activation now call the helper (`src/services/client-service/manual-create.ts:19-28,73-77`; `src/services/client-service/service.ts:37-47,929-936`; `src/services/billing/coverage.ts:697-704`; `src/services/billing/reconciler.ts:217-227`; `src/services/service-agreement/activation.service.ts:200-210`). Conflict tests cover both service write paths (`__tests__/services/client-service-manual-create.test.ts:204-218`; `__tests__/services/client-service.service.test.ts:254-271`).

5. **NOT ADDRESSED — audit snapshot lineage is incorrect after an in-place fee update.** The bounded/allowlisted audit representation itself is a strong correction: 100 fee rows, 31 entries, 500-character text fields, stable identity/lineage, archive state/reason, recurrence/start, schedule/hash, and display order are captured (`src/services/client-service/fee-summary.ts:15-17,45-110`). However, the update path builds the after snapshot by appending `preparedIncomingFeeLines` directly (`src/services/client-service/service.ts:1083-1098`). Those request-derived rows have no `sourceAgreementFeeLineId` (`src/services/client-service/service.ts:929-936`), even though the actual in-place database update deliberately leaves the stored lineage untouched (`src/services/client-service/service.ts:1019-1040`). Consequently an agreement-derived row such as the fixture at `__tests__/services/client-service.service.test.ts:34` is falsely audited with `sourceAgreementFeeLineId: null` after an ordinary update. The audit assertion checks schedule/start but omits lineage (`__tests__/services/client-service.service.test.ts:237-251`).
   - Fix: construct the after snapshot from the actual persisted/read-back rows, or merge each existing row's immutable lineage into its prepared incoming representation (and assign the exact generated ID/lineage for new rows) before snapshotting. Assert that an in-place agreement-derived update retains `sourceAgreementFeeLineId` in the new audit snapshot.

6. **ADDRESSED — activation, disposition transitions, lineage, and reconciliation handoffs.** Activation assigns Configured/Unreviewed from matching fee presence, uses fee start or deterministic item start, canonicalizes the schedule, creates fee rows, audits, and enqueues inside its Serializable transaction (`src/services/service-agreement/activation.service.ts:176-218,238-269`). Its test asserts both dispositions, lineage, start/config, audit, and transactional queue activity (`__tests__/services/service-agreement-activation.service.test.ts:63-96`). Update coverage includes Unreviewed-to-Configured (`__tests__/services/client-service.service.test.ts:210-251`), Configured-to-Not-required archival/enqueue (`__tests__/services/client-service.service.test.ts:274-307`), and Not-required-to-Configured fresh lineage without reactivation (`__tests__/services/client-service.service.test.ts:309-343`). Reconciler coverage proves only the future Open row is cancelled while historical Open/Billed/Waived rows are preserved (`__tests__/services/billing-reconciler.test.ts:202-219`).

7. **ADDRESSED (Minor) — React test warnings.** The confirmation interaction now awaits `userEvent` and asynchronous dialog/post-confirmation state (`__tests__/components/client-service-creator.test.tsx:187-200`). Both focused re-review runs completed without `act(...)` warnings.

## New findings

### Critical

None.

### Important

1. **Editing an existing fee's start date or cadence discards all authored repeatable schedule entries.**
   - Evidence: both handlers pass the newly edited compatibility field together with the old structured config into `scheduleConfigForFee` (`src/components/companies/company-detail/operational-service-form.tsx:327-350`). Canonicalization correctly throws because the old config still has the previous cadence/start (`src/components/companies/company-detail/operational-service-form.tsx:27-35`; `src/services/billing/schedule.ts:64-69`). The catch path then synthesizes a brand-new config containing only one `default` entry (`src/components/companies/company-detail/operational-service-form.tsx:39-53`), and the handler replaces `fee.scheduleConfig` with it (`src/components/companies/company-detail/operational-service-form.tsx:330-341,348-350`). A fee with multiple or customized schedule entries therefore silently loses them merely by changing Frequency or Billing start date.
   - Why it matters: repeatable any-family schedule entries are user-authored billing configuration. Silent deletion can change future occurrence dates and is especially surprising because the form gives no warning or confirmation.
   - Fix: update cadence/start on a clone of the existing structured config while preserving `scheduleEntries`; recompute only cadence/custom interval/start fields that truly depend on the edited control. Reserve default-entry synthesis for a genuinely absent/legacy schedule. Add component tests beginning with two distinct entries, then change start date and cadence and assert both entries remain unchanged.

### Minor

None.

## Requirements assessment

| Requirement | Assessment |
| --- | --- |
| Validation backward compatibility / `expectedUpdatedAt` | **Met** |
| All three update dispositions | **Met** |
| Serializable write + audit + enqueue | **Partially met** — atomicity is correct, but the after-audit can misstate immutable fee lineage |
| Fee upsert/archive lineage and Not-required reason semantics | **Met in persistence; audit representation not met** |
| Future Open cancellation handoff | **Met** |
| Agreement activation conversion/enqueue | **Met** |
| Tenant/access correctness | **Met** |
| DTO archived filtering | **Met** (`src/services/client-service/mapper.ts:71-86`; `__tests__/services/client-service.service.test.ts:345-377`) |
| Repeatable any-family schedule entries | **Not met** — frequency/start edits silently collapse authored entries |
| UI accessibility/responsiveness/warning/confirmation | **Met for reviewed flows** |
| React state correctness | **Not met** — schedule state is destructively regenerated on ordinary controlled edits |

## Severity and verdict

- Critical: **0**
- Important: **2** (one original finding still not fully addressed; one new regression)
- Minor: **0**

**FAIL — requirements not yet met / fixes required.**

The correction resolves five of the six original Important findings and the original Minor finding, and the scoped suites are clean. Acceptance is still blocked because an update audit can falsely erase agreement lineage and ordinary form edits can silently destroy repeatable schedule entries.
