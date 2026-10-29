# Task 5 round-2 re-review — billing schedule and audit lineage

## Scope and verification

- Reviewed cumulative `7f03be9b..c6e91916` and latest correction `9c4ac9c3..c6e91916` only. The correction changes four focused files: the operational form, client-service update service, and their two tests.
- Re-read the updated Task 5 report, round-2 package, first re-review, and original review against the previously established Plan 3 Task 5, Global Constraints, approved specification, repository/design guidance, reviewer guidance, and React state/render criteria.
- `git diff --check 9c4ac9c3..c6e91916` — **PASS**.
- Blocker regressions: `client-service.service.test.ts` plus `operational-service-form.test.tsx` — **PASS**, 2 files / 38 tests.
- Focused Task 5 suite — **PASS**, 10 files / 185 tests, with no React `act(...)` warnings.
- No repository-wide baseline/build/full lint, live PostgreSQL migrations, browser/performance checks, or unrelated suites were run. No code, tests, progress, or commits were changed.

## Remaining finding disposition

### 1. Audit after-snapshot identity and immutable lineage

**ADDRESSED.**

- The update path now derives `persistedIncomingFeeLines` once before writing. For an in-place row it takes the exact stored ID and immutable `sourceAgreementFeeLineId`; for a new row it retains the submitted ID or generates one ID once and assigns fresh null lineage. Archived IDs are still rejected (`src/services/client-service/service.ts:938-948`).
- Persistence iterates those normalized rows. Existing rows are updated in place, while new rows use exactly `fee.id` and `fee.sourceAgreementFeeLineId` from that same normalized object (`src/services/client-service/service.ts:1029-1062`). No second UUID is generated at write time.
- The after-snapshot also uses the same `persistedIncomingFeeLines`, including their exact IDs and lineage, while retained/removed historical rows come from the stored records (`src/services/client-service/service.ts:1085-1107`). Thus database persistence and audit cannot diverge on new-row identity, and an agreement-derived in-place row cannot be falsely audited with null lineage.
- The regression test updates the agreement-derived fixture and asserts the after snapshot retains `id: 'fee-1'` and `sourceAgreementFeeLineId: 'agreement-fee-1'` (`__tests__/services/client-service.service.test.ts:58-84`). Existing replacement coverage continues to assert a new Not-required-to-Configured row receives its fresh ID and null lineage (`__tests__/services/client-service.service.test.ts:309-343`).

### 2. Cadence/start edits preserve authored repeatable schedules

**ADDRESSED.**

- `scheduleConfigForFee` now returns an existing structured schedule unchanged and reaches canonical legacy conversion/default synthesis only when `fee.scheduleConfig` is absent (`src/components/companies/company-detail/operational-service-form.tsx:24-57`). Default key creation is therefore limited to absent legacy configuration.
- The cadence handler clones that existing config and changes only cadence/custom-interval compatibility fields; it does not rebuild `scheduleEntries` (`src/components/companies/company-detail/operational-service-form.tsx:330-347`).
- The start-date handler clones the existing config and changes only `startDate`, again preserving the complete entry array and its stable keys (`src/components/companies/company-detail/operational-service-form.tsx:352-356`).
- The regression begins with two separately keyed entries, changes start date and cadence, and verifies both labels, both stable keys, and both expressions remain intact (`__tests__/components/operational-service-form.test.tsx:173-210`). Earlier creator/form coverage still proves an absent legacy schedule receives a deterministic `default` entry (`__tests__/components/client-service-creator.test.tsx:172-176`; `__tests__/components/operational-service-form.test.tsx:133-170`).

## Independent regression inspection

No new Critical, Important, or Minor findings were identified in the correction range. The normalized fee representation remains inside the existing tenant-scoped Serializable update transaction, archived-row rejection remains before persistence, the public DTO path is unchanged, and the form continues to use controlled/functional state updates and existing accessible controls.

## Severity and verdict

- Critical: **0**
- Important: **0**
- Minor: **0**

**PASS — requirements met for Task 5.**

Both previously blocking Important findings are addressed, their focused regressions pass, and the correction introduces no reviewed-scope regression.
