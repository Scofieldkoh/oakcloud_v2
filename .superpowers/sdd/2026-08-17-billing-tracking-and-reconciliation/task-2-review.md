# Spec Compliance verdict

**FAIL — not spec compliant.** The implementation correctly converts deterministic legacy frequencies, preserves legacy fee values, uses the shared date-only/business-day primitives, and creates the intended coverage issues and tenant reconciliation requests. However, valid billing configurations can generate occurrences before their start date, range evaluation can omit business-day-adjusted occurrences, accepted schedule configurations can disagree with their cadence or fail only at evaluation time, and rerunning the backfill can overwrite a subsequently configured schedule.

⚠️ The focused TypeScript tests passed, but the isolated PostgreSQL test was skipped because `TEST_DATABASE_URL` was absent. Static review confirms that the partial-index conflict target matches `billing_coverage_issues_open_issue_key`, and the integration harness applies every migration preceding Task 1 before applying Task 1 and Task 2. Actual PostgreSQL execution of the migration, casts, constraints, and rerun behavior is still unverified in the supplied evidence.

⚠️ The PostgreSQL test's repeat-idempotency check immediately reapplies the migration without changing any backfilled row. It therefore does not cover the destructive rerun case where a user or later reconciliation has replaced `schedule_config` between applications.

# Strengths

- Legacy MONTHLY, QUARTERLY, SEMI_ANNUALLY, ANNUALLY, and ONE_TIME values are converted without inventing missing dates; label-only CUSTOM rows remain unconfigured and receive deterministic issues.
- The migration uses the actual mapped enum/table/column names, preserves amount, currency, custom label, legacy frequency, and `UNREVIEWED`, and carries tenant/company/service/fee-line lineage into coverage issues.
- `ON CONFLICT ("tenant_id", "issue_key") WHERE "resolved_at" IS NULL` matches the Task 1 partial unique index, and request deduplication matches the existing unique `dedupe_key` constraint.
- Reconciliation requests are restricted to active, non-deleted tenants and use stable tenant-scoped keys.
- Evaluation uses the existing UTC date-only, month-clamping, and Singapore business-calendar functions. Entry sorting gives stable output order and identities independent of configuration array order, and amount/currency strings are preserved verbatim.
- The PostgreSQL harness isolates state in a random schema, applies the Plan 1/2 prerequisite migrations before Task 1, applies Task 1 before Task 2, and cleans up its schema.

# Issues

## Critical

None.

## Important

1. **Range evaluation omits occurrences pulled backward from the next cadence period.** `evaluateBillingSchedule` only iterates while the unadjusted period cursor is on or before `to` (`src/services/billing/schedule.ts:176`), but filtering is performed on the operative date after business-day adjustment (`src/services/billing/schedule.ts:181-183`). For a monthly entry on day 1 with `PREVIOUS`, an occurrence belonging to a September period can operate on August 31; an August range never visits the September cursor and silently loses that occurrence. The evaluator deliberately visits one earlier period to catch forward adjustments at `from`, but has no corresponding look-ahead at `to`. This violates requested-range and business-calendar-aware materialization semantics.

2. **The schema accepts cadence/interval combinations that the evaluator interprets inconsistently.** Validation requires an interval only for CUSTOM and otherwise permits any nullable 1–120 month interval (`src/lib/validations/billing.ts:18-31`). Evaluation then prefers that supplied value even for deterministic cadences (`src/services/billing/schedule.ts:43-50`). Consequently `{ cadence: 'MONTHLY', customInterval: { count: 12 } }` runs annually, and `{ cadence: 'QUARTERLY', customInterval: { count: 1 } }` runs monthly while producing quarter-based period keys (`src/services/billing/schedule.ts:56-65`). The latter yields repeated `(billingPeriodKey, scheduleEntryKey)` identities within a quarter. Fixed cadences must either reject a mismatched interval or derive their fixed interval unconditionally; ONE_TIME should likewise reject a non-null interval.

3. **`startDate` is treated only as an anchor month, so valid configurations can generate billing before the schedule starts.** The evaluator truncates `startDate` to the first of its month (`src/services/billing/schedule.ts:171`) and does not compare calculated or operative dates with the actual start date before emitting (`src/services/billing/schedule.ts:180-195`). The added one-time test explicitly encodes a schedule starting on 2026-08-15 but emits 2026-08-01 (`__tests__/services/billing-schedule.test.ts:157-188`). The same defect affects recurring and CUSTOM schedules whose first-month entry is earlier than the start day. A billing start date must be a real lower bound, particularly for ONE_TIME range behavior.

4. **The public validation contract accepts shared schedule entries that this evaluator cannot evaluate.** `billingScheduleConfigSchema` imports `scheduleEntriesSchema` without narrowing it (`src/lib/validations/billing.ts:3-6,18-24`). That shared schema accepts parameter operands and sources including COMPANY_FIELD, PARAMETER, SCHEDULE_ENTRY, and MILESTONE. The billing evaluator rejects non-numeric parameter operands (`src/services/billing/schedule.ts:103-107`) and `sourceDate` supports only CYCLE_START, CYCLE_END, and CURRENT_SCHEDULE_ENTRY (`src/services/billing/schedule.ts:70-81`). Thus parsing can succeed and evaluation later throws for a supposedly valid `BillingScheduleConfigV1`. The billing schema must reject unsupported shared variants, or evaluation must provide the context and shared semantics required to resolve them.

5. **Reapplying the migration can overwrite a schedule configured after the initial backfill.** The unconditional deterministic-frequency update (`prisma/migrations/20260817111000_billing_schedule_backfill/migration.sql:4-39`) has no `schedule_config IS NULL` guard. A rerun after manual configuration or reconciliation replaces that structured schedule with the legacy-derived default, potentially discarding multiple entries and business-day rules. Its CUSTOM/missing-date issue insertions similarly key only from legacy columns. The immediate double-apply integration test (`__tests__/integration/billing-schedule-backfill.postgres.test.ts:126-127`) proves duplicate-count stability only when no intervening state changes; it does not prove safe reruns. Backfill writes should be restricted to still-unconfigured rows, with issue creation aligned to that same eligibility.

## Minor

1. **ONE_TIME silently chooses an entry by lexical key when multiple entries validate.** The schema permits multiple entries, but the evaluator sorts and slices to the first (`src/services/billing/schedule.ts:167-169`); the test consequently prefers `a-deposit` and drops `z-balance` (`__tests__/services/billing-schedule.test.ts:157-188`). If ONE_TIME truly permits only one result, validation should require at most one entry rather than making a valid second entry disappear based on its key.

# Task quality

**Needs fixes.** There are 0 Critical, 5 Important, and 1 Minor issues. PASS is not available until the Important issues are corrected and focused boundary/validation/rerun tests are added; the PostgreSQL integration test should then run against an isolated database.
