# Findings Verification

1. **ADDRESSED — Range evaluation omits occurrences pulled backward from the next cadence period.** The evaluator now derives a cadence-aligned cursor one period beyond the requested end and iterates through it (`src/services/billing/schedule.ts:171-184`), while retaining operative-date range filtering (`src/services/billing/schedule.ts:189-193`). The regression test proves that an August 1 occurrence adjusted with `PREVIOUS` is returned in a July range as July 31 (`__tests__/services/billing-schedule.test.ts:132-153`).

2. **ADDRESSED — The schema accepts cadence/interval combinations that the evaluator interprets inconsistently.** Fixed cadence-to-month mappings are declared and enforced during validation, CUSTOM still requires a structured interval, and ONE_TIME requires null (`src/lib/validations/billing.ts:17-22,53-79`). Evaluation now derives deterministic cadence intervals from `CADENCE_INTERVALS` instead of trusting supplied configuration (`src/services/billing/schedule.ts:43-50`). This prevents cadence/key mismatch and duplicate fixed-cadence identities.

3. **ADDRESSED — `startDate` is treated only as an anchor month, so valid configurations can generate billing before the schedule starts.** Before range filtering or emission, evaluation now rejects an occurrence when either its calculated or operative date precedes the actual `startDate` (`src/services/billing/schedule.ts:188-193`). Focused coverage exercises both a first-month calculated date and a `PREVIOUS` adjustment crossing before the start boundary (`__tests__/services/billing-schedule.test.ts:215-257`).

4. **ADDRESSED — The public validation contract accepts shared schedule entries that this evaluator cannot evaluate.** Billing validation continues to build on the shared `scheduleEntriesSchema` but now rejects parameter operands and source kinds unavailable from `BillingScheduleEvaluationInput` (`src/lib/validations/billing.ts:24-44,47-52`). Every accepted RELATIVE_TO_SOURCE variant is therefore within the evaluator's numeric-offset and CYCLE_START/CYCLE_END/CURRENT_SCHEDULE_ENTRY handling (`src/services/billing/schedule.ts:70-81,103-110`).

5. **ADDRESSED — Reapplying the migration can overwrite a schedule configured after the initial backfill.** Both issue-source branches now require `schedule_config IS NULL` (`prisma/migrations/20260817111000_billing_schedule_backfill/migration.sql:17-18,35-43`), and the deterministic backfill update has the same guard (`prisma/migrations/20260817111000_billing_schedule_backfill/migration.sql:68-104`). The PostgreSQL regression mutates deterministic, CUSTOM, and missing-start rows, resolves their issues, reapplies the migration, and asserts the configured schedules and resolved issue set remain intact (`__tests__/integration/billing-schedule-backfill.postgres.test.ts:126-180,184-244`).

# New Breakage in Fix Diff

## Critical

None.

## Important

None.

## Minor

None.

# Out-of-Scope Observations

- The original ONE_TIME lexical-first behavior remains deferred in the ledger and was not changed or re-reviewed in this fix round (`src/services/billing/schedule.ts:167-169`).
- No untouched Task 2 behavior was fresh-reviewed.

# Verdict

**APPROVED for fix round 1/5.** All five findings are ADDRESSED, and the fix diff introduces no new Critical, Important, or Minor issue.
