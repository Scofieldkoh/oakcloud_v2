# Billing Tracking and Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add materialized billing-tracking occurrences, manual billed-state updates, and reconciliation that exposes every active service with missing billing configuration.

**Architecture:** Extend `ClientService` and `ClientServiceFeeLine` with explicit billing disposition and structured schedules, then use the schedule engine and durable queue from Plan 2 to materialize rolling-horizon `BillingOccurrence` records. A separate coverage reconciler materializes actionable issues, while the Billing tab provides manual tracking only and never creates invoices or payments.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma 7/PostgreSQL, Zod, React Query, shared service-schedule/reconciliation packages, Vitest, Testing Library, Vitest Browser/Playwright.

**Spec:** `docs/superpowers/specs/2026-08-17-services-administration-deadlines-billing-design.md`

**Mockups:** `docs/superpowers/mockups/2026-08-17-services-workspace-mockups.md` — implement view 4 and the Billing indicators used by view 1.

## Global Constraints

- Complete Plans 1 and 2 first. Import from `src/services/service-schedule` and `src/services/schedule-reconciliation`; do not create another date language, queue, or worker.
- Read the approved specification and repository design, service-pattern, and RBAC guides before editing.
- Preserve unrelated work and use additive migrations.
- Billing is manual tracking only. UI/API copy must not claim Oakcloud issued an invoice, received payment, or posted to a ledger.
- Stored user states are `OPEN`, `BILLED`, and `WAIVED`; `CANCELLED` is system-only. Upcoming/Due/Overdue are derived for Open occurrences.
- Billed date is optional. Amount and currency remain editable after Billed.
- Amount/currency edits always ask for `THIS_OCCURRENCE` or `THIS_AND_FUTURE`.
- Current-and-future updates affect the selected occurrence plus matching future Open occurrences only; they preserve historical, Billed, Waived, and Cancelled occurrences.
- Every active client service is explicitly `CONFIGURED` or `NOT_REQUIRED` with a reason. Migrated records default to `UNREVIEWED` and produce coverage issues.
- Paused services retain existing issues/occurrences but do not extend the horizon; Ended/Archived services do not receive new occurrences.
- Manual historical deadline cycles never generate billing occurrences or enqueue billing work.
- Billing list queries apply accessible-company scope in SQL.
- Operational writes require `company:update`; reads require `company:read`.
- Materialize from the Singapore current date through the same rolling 12-month horizon as deadlines.
- Use test-driven steps and commit after every task passes.

---

## File and responsibility map

### Database

- `prisma/migrations/20260817110000_billing_tracking/migration.sql` — disposition, soft-archivable fee lines, billing occurrences/issues, constraints, indexes.
- `prisma/migrations/20260817111000_billing_schedule_backfill/migration.sql` — deterministic schedule conversion, custom-schedule issues, and initial tenant reconciliation requests.

### Validation and services

- `src/lib/validations/billing.ts` — fee schedule, occurrence search, mutation, and coverage inputs.
- `src/services/billing/types.ts` — DTOs/results.
- `src/services/billing/schedule.ts` — existing frequency → shared schedule config and billing-period evaluation.
- `src/services/billing/reconciler.ts` — rolling occurrence diff/persist.
- `src/services/billing/coverage.ts` — issue detection/materialization.
- `src/services/billing/service.ts` — list/detail/lifecycle/current-and-future updates.
- `src/services/billing/index.ts` — public exports.

### APIs and hooks

- `src/app/api/billing-occurrences/route.ts`
- `src/app/api/billing-occurrences/[id]/route.ts`
- `src/app/api/billing-occurrences/[id]/reset-override/route.ts`
- `src/app/api/billing-coverage/route.ts`
- `src/app/api/client-services/[id]/billing/reconcile/route.ts`
- `src/hooks/use-billing-occurrences.ts`
- `src/hooks/use-billing-coverage.ts`

### UI

- `src/components/services/billing/billing-workspace.tsx`
- `src/components/services/billing/billing-filters.tsx`
- `src/components/services/billing/billing-table.tsx`
- `src/components/services/billing/billing-occurrence-dialog.tsx`
- `src/components/services/billing/billing-coverage-panel.tsx`
- Existing client-service form/editor/creator and Services workspace/roster components.

### Tests

- Schema, validation, service, API, hook, component, browser, PostgreSQL isolation/idempotency, migration, and performance tests named by each task.

## Public interfaces produced by this plan

```ts
export type BillingScheduleConfigV1 = {
  schemaVersion: 1;
  cadence: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY' | 'ONE_TIME' | 'CUSTOM';
  startDate: DateOnly | null;
  customInterval: { unit: 'MONTH'; count: number } | null;
  scheduleEntries: ScheduleEntry[];
};

export type BillingCoverageResult = {
  clientServiceId: string;
  opened: number;
  refreshed: number;
  resolved: number;
  openIssues: Array<{
    issueKey: string;
    type: BillingCoverageIssueType;
    severity: 'ERROR' | 'WARNING';
    feeLineId: string | null;
    message: string;
  }>;
};

export async function reconcileClientServiceBilling(input: {
  tenantId: string;
  clientServiceId: string;
  today: DateOnly;
  horizonEnd: DateOnly;
  writeMode: 'OBSERVE' | 'APPLY';
  reconciliationRequestId: string;
}): Promise<BillingReconciliationResult>;

export async function reconcileBillingCoverage(input: {
  tenantId: string;
  clientServiceId: string;
  today: DateOnly;
  horizonEnd: DateOnly;
  writeMode: 'OBSERVE' | 'APPLY';
}): Promise<BillingCoverageResult>;
```

---

### Task 1: Add billing disposition, occurrences, and coverage schema

**Files:**
- Create: `prisma/migrations/20260817110000_billing_tracking/migration.sql`
- Create: `__tests__/services/billing-tracking-schema.test.ts`
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: ClientService, ClientServiceFeeLine, shared generation-key conventions.
- Produces: billing disposition, soft-archivable fee lines, BillingOccurrence, and BillingCoverageIssue.

- [ ] **Step 1: Write the failing schema test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('billing tracking schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/20260817110000_billing_tracking/migration.sql'),
    'utf8',
  );

  it('defines disposition, occurrences, and coverage issues', () => {
    expect(schema).toContain('enum BillingDisposition');
    expect(schema).toContain('model BillingOccurrence');
    expect(schema).toContain('model BillingCoverageIssue');
    expect(schema).toContain('billingDisposition');
    expect(schema).toContain('scheduleConfig');
    expect(migration).toContain('billing_occurrences_identity_key');
    expect(migration).toContain('billing_coverage_issues_open_issue_key');
  });
});
```

- [ ] **Step 2: Run the schema test and confirm missing-model failure**

Run: `npm.cmd run test:run -- __tests__/services/billing-tracking-schema.test.ts`

Expected: FAIL because the migration/models do not exist.

- [ ] **Step 3: Add Prisma enums and existing-model fields**

```prisma
enum BillingDisposition { CONFIGURED NOT_REQUIRED UNREVIEWED }
enum BillingOccurrenceStatus { OPEN BILLED WAIVED CANCELLED }
enum BillingCoverageIssueSeverity { ERROR WARNING }
enum BillingCoverageIssueType {
  MISSING_DISPOSITION
  MISSING_FEE_LINES
  MISSING_START_DATE
  INVALID_CUSTOM_SCHEDULE
  MISSING_SCHEDULE_PARAMETER
  OCCURRENCE_GAP
  INVALID_AMOUNT_OR_CURRENCY
}
```

Add:

```prisma
model ClientService {
  billingDisposition        BillingDisposition @default(UNREVIEWED) @map("billing_disposition")
  billingNotRequiredReason String? @map("billing_not_required_reason") @db.VarChar(500)
  billingOccurrences       BillingOccurrence[]
  billingCoverageIssues    BillingCoverageIssue[]
}

model ClientServiceFeeLine {
  scheduleConfig Json? @map("schedule_config")
  isActive       Boolean @default(true) @map("is_active")
  deletedAt      DateTime? @map("deleted_at")
  deletedReason  String? @map("deleted_reason") @db.VarChar(1000)
  billingOccurrences BillingOccurrence[]
  billingCoverageIssues BillingCoverageIssue[]
}
```

- [ ] **Step 4: Add BillingOccurrence and BillingCoverageIssue**

`BillingOccurrence` carries these exact value fields in addition to its tenant/company/client-service/fee-line relations and timestamps:

```prisma
billingPeriodKey       String   @map("billing_period_key") @db.VarChar(100)
scheduleEntryKey       String   @default("") @map("schedule_entry_key") @db.VarChar(64)
generationKey          String   @map("generation_key") @db.VarChar(100)
calculatedExpectedDate DateTime @map("calculated_expected_date") @db.Date
operativeExpectedDate  DateTime @map("operative_expected_date") @db.Date
dateOverridden         Boolean  @default(false) @map("date_overridden")
dateOverrideReason     String?  @map("date_override_reason") @db.VarChar(1000)
dateOverriddenAt       DateTime? @map("date_overridden_at")
dateOverriddenById     String?  @map("date_overridden_by_id")
baseAmount             Decimal  @map("base_amount") @db.Decimal(18, 2)
baseCurrency           String   @map("base_currency") @db.VarChar(3)
operativeAmount        Decimal  @map("operative_amount") @db.Decimal(18, 2)
operativeCurrency      String   @map("operative_currency") @db.VarChar(3)
valueOverridden        Boolean  @default(false) @map("value_overridden")
valueOverrideReason    String?  @map("value_override_reason") @db.VarChar(1000)
valueOverriddenAt      DateTime? @map("value_overridden_at")
valueOverriddenById    String?  @map("value_overridden_by_id")
status                 BillingOccurrenceStatus @default(OPEN)
billedDate             DateTime? @map("billed_date") @db.Date
markedBilledAt         DateTime? @map("marked_billed_at")
markedBilledById       String? @map("marked_billed_by_id")
externalReference      String? @map("external_reference") @db.VarChar(200)
notes                   String? @db.Text
```

Add corresponding waiver/cancellation reason/time/actor fields and User inverse relations.

Use these identity/index contracts:

```prisma
@@unique([tenantId, feeLineId, billingPeriodKey, scheduleEntryKey, generationKey], map: "billing_occurrences_identity_key")
@@index([tenantId, operativeExpectedDate, status])
@@index([tenantId, companyId, operativeExpectedDate, status])
@@index([tenantId, clientServiceId, operativeExpectedDate])
```

`BillingCoverageIssue` carries tenant/company/client service/optional fee line, type, severity, deterministic issue key, structured details, first/last detected, resolved timestamp, and timestamps. Its partial unique open-issue index is migration-managed:

```sql
CREATE UNIQUE INDEX "billing_coverage_issues_open_issue_key"
ON "billing_coverage_issues" ("tenant_id", "issue_key")
WHERE "resolved_at" IS NULL;
```

- [ ] **Step 5: Add exact consistency constraints**

```sql
ALTER TABLE "client_services"
  ADD CONSTRAINT "client_services_billing_disposition_reason"
  CHECK (
    ("billing_disposition" = 'NOT_REQUIRED' AND length(trim("billing_not_required_reason")) >= 3)
    OR
    ("billing_disposition" <> 'NOT_REQUIRED' AND "billing_not_required_reason" IS NULL)
  );

ALTER TABLE "billing_occurrences"
  ADD CONSTRAINT "billing_occurrences_date_override_consistency"
  CHECK (
    ("date_overridden" = FALSE AND "date_override_reason" IS NULL AND "date_overridden_at" IS NULL AND "date_overridden_by_id" IS NULL)
    OR
    ("date_overridden" = TRUE AND "date_override_reason" IS NOT NULL AND "date_overridden_at" IS NOT NULL AND "date_overridden_by_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "billing_occurrences_value_override_consistency"
  CHECK (
    ("value_overridden" = FALSE AND "value_override_reason" IS NULL AND "value_overridden_at" IS NULL AND "value_overridden_by_id" IS NULL)
    OR
    ("value_overridden" = TRUE AND "value_override_reason" IS NOT NULL AND "value_overridden_at" IS NOT NULL AND "value_overridden_by_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "billing_occurrences_billed_consistency"
  CHECK (("status" = 'BILLED') = ("marked_billed_at" IS NOT NULL AND "marked_billed_by_id" IS NOT NULL)),
  ADD CONSTRAINT "billing_occurrences_waiver_consistency"
  CHECK (("status" = 'WAIVED') = ("waived_at" IS NOT NULL AND "waiver_reason" IS NOT NULL)),
  ADD CONSTRAINT "billing_occurrences_cancellation_consistency"
  CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancellation_reason" IS NOT NULL)),
  ADD CONSTRAINT "billing_occurrences_currency_codes"
  CHECK ("base_currency" ~ '^[A-Z]{3}$' AND "operative_currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "billing_occurrences_nonnegative_amounts"
  CHECK ("base_amount" >= 0 AND "operative_amount" >= 0);
```

The billed date is intentionally absent from the Billed consistency check because it is optional.

- [ ] **Step 6: Generate Prisma and run the schema test**

Run: `npm.cmd run db:generate`

Expected: PASS.

Run: `npm.cmd run test:run -- __tests__/services/billing-tracking-schema.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the billing schema**

```bash
git add prisma/schema.prisma prisma/migrations/20260817110000_billing_tracking/migration.sql src/generated/prisma __tests__/services/billing-tracking-schema.test.ts
git commit -m "feat: add billing tracking schema"
```

---

### Task 2: Define fee schedules and migrate existing billing frequencies

**Files:**
- Create: `src/lib/validations/billing.ts`
- Create: `src/services/billing/types.ts`
- Create: `src/services/billing/schedule.ts`
- Create: `src/services/billing/index.ts`
- Create: `prisma/migrations/20260817111000_billing_schedule_backfill/migration.sql`
- Create: `__tests__/lib/billing-validation.test.ts`
- Create: `__tests__/services/billing-schedule.test.ts`
- Create: `__tests__/services/billing-schedule-backfill.test.ts`

**Interfaces:**
- Consumes: Plan 2 `ScheduleEntry`, schedule schemas, and date-only functions.
- Produces: `BillingScheduleConfigV1`, frequency conversion, and billing-period evaluation.

- [ ] **Step 1: Write failing schedule validation tests**

```ts
it('accepts multiple billing entries through the shared schedule schema', () => {
  const result = billingScheduleConfigSchema.parse({
    schemaVersion: 1,
    cadence: 'MONTHLY',
    startDate: '2026-08-01',
    customInterval: null,
    scheduleEntries: [
      { key: 'deposit', label: 'Deposit', expression: { kind: 'DAY_OF_MONTH', day: 1 }, businessDayAdjustment: 'NEXT' },
      { key: 'balance', label: 'Balance', expression: { kind: 'DAY_OF_MONTH', day: 15 }, businessDayAdjustment: 'NEXT' },
    ],
  });
  expect(result.scheduleEntries).toHaveLength(2);
});

it('requires a structured custom interval', () => {
  expect(() => billingScheduleConfigSchema.parse({
    schemaVersion: 1, cadence: 'CUSTOM', startDate: '2026-08-01', customInterval: null, scheduleEntries: [],
  })).toThrow('customInterval');
});
```

- [ ] **Step 2: Write failing deterministic conversion tests**

```ts
it.each([
  ['MONTHLY', 1], ['QUARTERLY', 3], ['SEMI_ANNUALLY', 6], ['ANNUALLY', 12],
])('converts %s without guessing a missing start date', (frequency, monthCount) => {
  expect(convertLegacyBillingSchedule({
    billingFrequency: frequency,
    billingStartDate: null,
    customFrequencyLabel: null,
  })).toMatchObject({
    config: {
      cadence: frequency,
      startDate: null,
      customInterval: { unit: 'MONTH', count: monthCount },
      scheduleEntries: [],
    },
    issueType: 'MISSING_START_DATE',
  });
});

it('leaves label-only custom schedules invalid for review', () => {
  expect(convertLegacyBillingSchedule({
    billingFrequency: 'CUSTOM', billingStartDate: null, customFrequencyLabel: 'When needed',
  })).toEqual({ config: null, issueType: 'INVALID_CUSTOM_SCHEDULE' });
});
```

- [ ] **Step 3: Run validation/schedule tests and verify missing modules**

Run: `npm.cmd run test:run -- __tests__/lib/billing-validation.test.ts __tests__/services/billing-schedule.test.ts`

Expected: FAIL because billing schemas/services do not exist.

- [ ] **Step 4: Implement schemas and conversion**

```ts
export const billingScheduleConfigSchema = z.object({
  schemaVersion: z.literal(1),
  cadence: z.enum(['MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY', 'ONE_TIME', 'CUSTOM']),
  startDate: z.string().date().nullable(),
  customInterval: z.object({ unit: z.literal('MONTH'), count: z.number().int().min(1).max(120) }).nullable(),
  scheduleEntries: scheduleEntriesSchema,
}).strict().superRefine((value, ctx) => {
  if (value.cadence === 'CUSTOM' && !value.customInterval) {
    ctx.addIssue({ code: 'custom', path: ['customInterval'], message: 'customInterval is required for a custom schedule' });
  }
});
```

`convertLegacyBillingSchedule` returns a config for deterministic enum frequencies. When start date exists, create stable `default` entry anchored to its day/month semantics. When start date is absent, retain cadence/interval but no entries so coverage reports `MISSING_START_DATE`; never assume the first day.

- [ ] **Step 5: Implement period evaluation**

Export:

```ts
export function evaluateBillingSchedule(input: {
  config: BillingScheduleConfigV1;
  feeLine: { id: string; amount: string; currency: string };
  calendar: BusinessCalendarSnapshot;
  from: DateOnly;
  to: DateOnly;
  generationKey: string;
}): EvaluatedBillingOccurrence[];
```

Generate deterministic period keys and one result per schedule entry. One-time produces at most one item. Custom uses its structured month interval. Reuse Plan 2 business-day functions and month clamping.

- [ ] **Step 6: Add the data backfill and initial reconciliation requests**

The migration:

1. Leaves all existing ClientServices as `UNREVIEWED`.
2. Writes schema-version-1 JSON for Monthly/Quarterly/Semi-annually/Annually/One-time fee lines using their current frequency and optional start date.
3. Leaves label-only Custom `schedule_config` null.
4. Inserts deterministic open coverage issues for Custom rows and missing start dates.
5. Inserts one Pending TENANT `BILLING_BACKFILL` reconciliation request per active tenant using a deterministic dedupe key.

The schema test reads SQL and asserts that `CUSTOM` is never assigned a fabricated date and existing amounts/currencies are not changed.

- [ ] **Step 7: Run validation, schedule, and migration tests**

Run: `npm.cmd run test:run -- __tests__/lib/billing-validation.test.ts __tests__/services/billing-schedule.test.ts __tests__/services/billing-schedule-backfill.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit billing schedules and backfill**

```bash
git add src/lib/validations/billing.ts src/services/billing/types.ts src/services/billing/schedule.ts src/services/billing/index.ts prisma/migrations/20260817111000_billing_schedule_backfill/migration.sql __tests__/lib/billing-validation.test.ts __tests__/services/billing-schedule.test.ts __tests__/services/billing-schedule-backfill.test.ts
git commit -m "feat: define and backfill billing schedules"
```

---

### Task 3: Reconcile rolling billing occurrences through the shared worker

**Files:**
- Create: `src/services/billing/reconciler.ts`
- Modify: `src/services/billing/index.ts`
- Modify: `src/services/schedule-reconciliation/types.ts`
- Modify: `src/services/schedule-reconciliation/worker.ts`
- Modify: `src/services/schedule-reconciliation/index.ts`
- Modify: `src/services/client-service/service.ts`
- Create: `__tests__/services/billing-reconciler.test.ts`
- Modify: `__tests__/services/schedule-reconciliation.test.ts`
- Create: `__tests__/integration/billing-reconciliation.postgres.test.ts`

**Interfaces:**
- Consumes: shared worker and schedule engine plus fee-line schedules.
- Produces: `reconcileClientServiceBilling` and combined worker summaries.

- [ ] **Step 1: Write failing generation/preservation tests**

```ts
it('creates rolling occurrences from active configured fee lines', async () => {
  const result = await reconcileClientServiceBilling(input);
  expect(result.created).toBe(12);
  expect(prismaMock.billingOccurrence.createMany).toHaveBeenCalled();
});

it('preserves historical, billed, waived, cancelled, and overridden occurrences', async () => {
  const result = await reconcileClientServiceBilling(inputWithProtectedOccurrences);
  expect(result.preservedByReason).toMatchObject({
    HISTORICAL: 1, BILLED: 1, WAIVED: 1, CANCELLED: 1, OVERRIDDEN: 1,
  });
});

it.each([
  ['PAUSED', null],
  ['ENDED', null],
  ['ACTIVE', new Date('2026-08-01')],
])('does not extend a %s/deleted service', async (status, deletedAt) => {
  prismaMock.clientService.findFirst.mockResolvedValue({ ...service, status, deletedAt });
  expect((await reconcileClientServiceBilling(input)).created).toBe(0);
});
```

- [ ] **Step 2: Run reconciler tests and verify missing service**

Run: `npm.cmd run test:run -- __tests__/services/billing-reconciler.test.ts`

Expected: FAIL because the billing reconciler is absent.

- [ ] **Step 3: Implement billing occurrence diff rules**

For each active fee line on a Configured active service, evaluate from today through the shared 12-month horizon. Compare by fee line, period, schedule key, and generation key:

```ts
export type BillingReconciliationResult = {
  clientServiceId: string;
  created: number;
  recalculated: number;
  cancelled: number;
  preserved: number;
  preservedByReason: Record<string, number>;
  warnings: Array<{ code: string; message: string; feeLineId?: string }>;
};
```

Eligible future Open non-overridden rows update calculated/operative date and base/operative amount/currency. Override flags preserve the operative field while calculated/base values refresh. Removed/archived fee schedules cancel eligible future Open occurrences. Switching to Not required cancels eligible future Open occurrences and stops generation.

- [ ] **Step 4: Extend the shared worker with billing once per client service**

After deadline reconciliation, call billing reconciliation with the same tenant, service, today, horizon, write mode, and request ID. Extend the structured summary:

```ts
type ServiceScheduleReconciliationSummary = {
  deadlines: DeadlineReconciliationResult;
  billing: BillingReconciliationResult;
};
```

Manual-cycle creation still inserts no reconciliation request, so this worker cannot be reached from that action.

- [ ] **Step 5: Make fee-line removal archival**

Replace destructive `deleteMany` behavior for persisted `ClientServiceFeeLine` rows with:

```ts
await tx.clientServiceFeeLine.updateMany({
  where: { tenantId, clientServiceId, id: { in: removedIds }, deletedAt: null },
  data: { isActive: false, deletedAt: now, deletedReason: 'Removed from client service configuration' },
});
```

Existing agreement fee-line lineage remains intact. New matching rows are created instead of reusing an archived row.

- [ ] **Step 6: Run unit and PostgreSQL idempotency tests**

Run: `npm.cmd run test:run -- __tests__/services/billing-reconciler.test.ts __tests__/services/schedule-reconciliation.test.ts`

Expected: PASS.

Run with isolated PostgreSQL: `npm.cmd run test:run -- __tests__/integration/billing-reconciliation.postgres.test.ts`

Expected: PASS with one occurrence per identity under concurrent retries.

- [ ] **Step 7: Commit billing reconciliation**

```bash
git add src/services/billing/reconciler.ts src/services/billing/index.ts src/services/schedule-reconciliation src/services/client-service/service.ts __tests__/services/billing-reconciler.test.ts __tests__/services/schedule-reconciliation.test.ts __tests__/integration/billing-reconciliation.postgres.test.ts
git commit -m "feat: reconcile billing tracking occurrences"
```

---

### Task 4: Materialize billing coverage issues

**Files:**
- Create: `src/services/billing/coverage.ts`
- Modify: `src/services/billing/index.ts`
- Modify: `src/services/schedule-reconciliation/types.ts`
- Modify: `src/services/schedule-reconciliation/worker.ts`
- Modify: `src/services/schedule-reconciliation/index.ts`
- Create: `src/app/api/billing-coverage/route.ts`
- Create: `src/app/api/client-services/[id]/billing/reconcile/route.ts`
- Create: `src/hooks/use-billing-coverage.ts`
- Create: `__tests__/services/billing-coverage.test.ts`
- Create: `__tests__/api/billing-coverage-routes.test.ts`
- Create: `__tests__/hooks/use-billing-coverage.test.ts`

**Interfaces:**
- Consumes: billing schedules/occurrences and shared reconciliation queue.
- Produces: materialized issue detection, accessible summaries, and manual reconcile action.

- [ ] **Step 1: Write failing issue detection tests**

```ts
it.each([
  ['UNREVIEWED', [], 'MISSING_DISPOSITION'],
  ['CONFIGURED', [], 'MISSING_FEE_LINES'],
])('detects %s coverage as %s', async (disposition, feeLines, issueType) => {
  prismaMock.clientService.findFirst.mockResolvedValue({ ...service, billingDisposition: disposition, feeLines });
  const result = await reconcileBillingCoverage(input);
  expect(result.openIssues).toContainEqual(expect.objectContaining({ type: issueType }));
});

it('requires a reason for Not required and creates no missing-fee issue', async () => {
  prismaMock.clientService.findFirst.mockResolvedValue({
    ...service,
    billingDisposition: 'NOT_REQUIRED',
    billingNotRequiredReason: 'Included in another engagement',
    feeLines: [],
  });
  const result = await reconcileBillingCoverage(input);
  expect(result.openIssues).toHaveLength(0);
});
```

- [ ] **Step 2: Run coverage tests and verify missing service**

Run: `npm.cmd run test:run -- __tests__/services/billing-coverage.test.ts`

Expected: FAIL because coverage reconciliation does not exist.

- [ ] **Step 3: Implement exact coverage checks and issue keys**

Check active services for:

```text
MISSING_DISPOSITION
MISSING_FEE_LINES
MISSING_START_DATE
INVALID_CUSTOM_SCHEDULE
MISSING_SCHEDULE_PARAMETER
OCCURRENCE_GAP
INVALID_AMOUNT_OR_CURRENCY
```

Issue key is SHA-256 of tenant, client service, optional fee line, issue type, and stable schedule key. Upsert detected issues with `lastDetectedAt`; set `resolvedAt` on previously open issues absent from the new set. In Observe mode, return proposed changes without writes.

Paused services retain existing issues without creating new rolling-gap issues. Ended/archived services are returned only when they have unresolved Open billing occurrences or existing unresolved issues.

- [ ] **Step 4: Implement accessible summary and reconcile routes**

`GET /api/billing-coverage` requires `company:read`, applies accessible-company SQL scope, and returns:

```ts
type BillingCoverageSummary = {
  openIssueCount: number;
  affectedServiceCount: number;
  healthyActiveServiceCount: number;
  issues: Array<{
    id: string; type: BillingCoverageIssueType; severity: 'ERROR' | 'WARNING';
    company: { id: string; name: string; displayLabel: string };
    service: { id: string; name: string; familyName: string; familyColor: string };
    feeLine: { id: string; description: string } | null;
    message: string;
  }>;
};
```

Return no per-service healthy cards. POST client reconcile loads the service, requires `company:update`, and enqueues a `CLIENT_SERVICE` request with trigger `BILLING_MANUAL_RECONCILE`.

Extend the shared worker after billing reconciliation:

```ts
type ServiceScheduleReconciliationSummary = {
  deadlines: DeadlineReconciliationResult;
  billing: BillingReconciliationResult;
  coverage: BillingCoverageResult;
};
```

Call coverage with the same tenant, client service, date window, and write mode. A coverage failure follows the request's existing retry/error rules and prevents the request from being marked complete.

- [ ] **Step 5: Implement the coverage hook and run tests**

Use query key `['billing-coverage', normalizedFilters]`; reconcile mutation invalidates coverage, occurrences, roster indicators, and the client service.

Run: `npm.cmd run test:run -- __tests__/services/billing-coverage.test.ts __tests__/api/billing-coverage-routes.test.ts __tests__/hooks/use-billing-coverage.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit billing coverage reconciliation**

```bash
git add src/services/billing/coverage.ts src/services/billing/index.ts src/services/schedule-reconciliation/types.ts src/services/schedule-reconciliation/worker.ts src/services/schedule-reconciliation/index.ts src/app/api/billing-coverage src/app/api/client-services/[id]/billing/reconcile src/hooks/use-billing-coverage.ts __tests__/services/billing-coverage.test.ts __tests__/api/billing-coverage-routes.test.ts __tests__/hooks/use-billing-coverage.test.ts
git commit -m "feat: reconcile billing configuration coverage"
```

---

### Task 5: Extend client-service forms with explicit billing disposition and schedules

**Files:**
- Modify: `src/lib/validations/client-service.ts`
- Modify: `src/services/client-service/types.ts`
- Modify: `src/services/client-service/mapper.ts`
- Modify: `src/services/client-service/manual-create.ts`
- Modify: `src/services/client-service/service.ts`
- Modify: `src/services/service-agreement/activation.service.ts`
- Modify: `src/components/companies/company-detail/client-service-form-state.ts`
- Modify: `src/components/companies/company-detail/operational-service-form.tsx`
- Modify: `src/components/companies/company-detail/client-service-creator.tsx`
- Modify: `src/components/companies/company-detail/client-service-editor.tsx`
- Modify: `src/components/services/shared/schedule-entry-editor.tsx`
- Modify: `__tests__/lib/client-service-validation.test.ts`
- Modify: `__tests__/services/client-service-manual-create.test.ts`
- Modify: `__tests__/services/client-service.service.test.ts`
- Modify: `__tests__/components/client-service-creator.test.tsx`

**Interfaces:**
- Consumes: billing config schema and existing shared service form.
- Produces: explicit Configured/Not required choice, fee schedules, and transactional enqueue.

- [ ] **Step 1: Write failing cross-field validation tests**

```ts
it('requires fee lines when billing is Configured', () => {
  expect(() => createManualClientServiceSchema.parse({
    ...baseInput, billingDisposition: 'CONFIGURED', feeLines: [],
  })).toThrow('at least one fee line');
});

it('requires a reason when billing is Not required', () => {
  expect(() => createManualClientServiceSchema.parse({
    ...baseInput, billingDisposition: 'NOT_REQUIRED', billingNotRequiredReason: null, feeLines: [],
  })).toThrow('reason');
});

it('accepts a structured fee schedule for any service family', () => {
  const parsed = createManualClientServiceSchema.parse(configuredInput);
  expect(parsed.feeLines[0]?.scheduleConfig?.scheduleEntries).toHaveLength(2);
});
```

- [ ] **Step 2: Run validation/service/component tests and verify failure**

Run: `npm.cmd run test:run -- __tests__/lib/client-service-validation.test.ts __tests__/services/client-service-manual-create.test.ts __tests__/components/client-service-creator.test.tsx`

Expected: FAIL because disposition/schedule inputs are absent.

- [ ] **Step 3: Extend validation while preserving concurrency compatibility**

Manual create accepts `billingDisposition: CONFIGURED | NOT_REQUIRED`; omitted legacy requests transform to `UNREVIEWED` so old integrations remain safe and visibly unreconciled. Update accepts all three states.

Allow zero to 100 fee lines, then enforce:

```ts
if (value.billingDisposition === 'CONFIGURED' && value.feeLines?.filter((line) => line.isActive !== false).length === 0) {
  ctx.addIssue({ code: 'custom', path: ['feeLines'], message: 'Configured billing requires at least one fee line' });
}
if (value.billingDisposition === 'NOT_REQUIRED' && !value.billingNotRequiredReason?.trim()) {
  ctx.addIssue({ code: 'custom', path: ['billingNotRequiredReason'], message: 'Explain why billing is not required' });
}
```

Preserve Plan 2's canonical `expectedUpdatedAt` plus legacy `updatedAt` transform. Billing changes must not reintroduce `updatedAt` into service-layer input types.

- [ ] **Step 4: Persist disposition and schedules transactionally**

Create/update writes disposition, reason, active/archived fee lines, and `scheduleConfig` in the existing serializable transaction; audit before/after and enqueue `CLIENT_SERVICE_CONFIGURATION_CHANGED`. Switching to Not required archives active fee lines with the user's reason and lets reconciliation cancel future Open occurrences.

Agreement activation sets Configured when at least one agreement fee line exists; otherwise Unreviewed. It converts deterministic fee templates through `convertLegacyBillingSchedule` and enqueues through the existing activation transaction.

- [ ] **Step 5: Extend the shared form**

Render a required segmented choice `Billing configured` / `No billing required`. When Configured, show fee lines with amount, currency, recurrence, start date, and the shared schedule-entry editor. When Not required, show the required reason and hide active fee schedules after confirmation.

Show Unreviewed as a warning when editing migrated records and require the user to select Configured or Not required before saving.

- [ ] **Step 6: Run validation/service/component tests**

Run: `npm.cmd run test:run -- __tests__/lib/client-service-validation.test.ts __tests__/services/client-service-manual-create.test.ts __tests__/services/client-service.service.test.ts __tests__/components/client-service-creator.test.tsx __tests__/components/company-services-tab.test.tsx __tests__/api/client-services-routes.test.ts __tests__/api/manual-client-services-routes.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit client billing configuration**

```bash
git add src/lib/validations/client-service.ts src/services/client-service src/services/service-agreement/activation.service.ts src/components/companies/company-detail src/components/services/shared/schedule-entry-editor.tsx __tests__/lib/client-service-validation.test.ts __tests__/services/client-service-manual-create.test.ts __tests__/services/client-service.service.test.ts __tests__/components/client-service-creator.test.tsx __tests__/components/company-services-tab.test.tsx __tests__/api/client-services-routes.test.ts __tests__/api/manual-client-services-routes.test.ts
git commit -m "feat: configure client service billing tracking"
```

---

### Task 6: Implement billing occurrence list and lifecycle APIs

**Files:**
- Create: `src/services/billing/service.ts`
- Modify: `src/services/billing/index.ts`
- Create: `src/app/api/billing-occurrences/route.ts`
- Create: `src/app/api/billing-occurrences/[id]/route.ts`
- Create: `src/app/api/billing-occurrences/[id]/reset-override/route.ts`
- Create: `src/hooks/use-billing-occurrences.ts`
- Create: `__tests__/services/billing.service.test.ts`
- Create: `__tests__/api/billing-occurrence-routes.test.ts`
- Create: `__tests__/hooks/use-billing-occurrences.test.ts`

**Interfaces:**
- Consumes: BillingOccurrence model, accessible-company scope, date-only timing.
- Produces: paginated billing table data and audited lifecycle/current-future mutations.

- [ ] **Step 1: Write failing lifecycle and scope tests**

```ts
it('allows Billed without a billed date', async () => {
  await updateBillingOccurrence(record.id, {
    expectedUpdatedAt: record.updatedAt.toISOString(),
    status: 'BILLED', billedDate: null, updateScope: 'THIS_OCCURRENCE', reason: null,
  }, actor);
  expect(prismaMock.billingOccurrence.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'BILLED', billedDate: null, markedBilledAt: expect.any(Date) }),
  }));
});

it('updates selected plus matching future Open rows only', async () => {
  await updateBillingOccurrence(record.id, {
    expectedUpdatedAt: record.updatedAt.toISOString(),
    amount: '1500.00', currency: 'USD', updateScope: 'THIS_AND_FUTURE', reason: 'Updated engagement pricing',
  }, actor);
  expect(prismaMock.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({
      feeLineId: record.feeLineId,
      scheduleEntryKey: record.scheduleEntryKey,
      generationKey: record.generationKey,
      status: 'OPEN',
      operativeExpectedDate: { gte: expect.any(Date) },
    }),
  }));
});
```

- [ ] **Step 2: Run service/API tests and verify missing modules**

Run: `npm.cmd run test:run -- __tests__/services/billing.service.test.ts __tests__/api/billing-occurrence-routes.test.ts`

Expected: FAIL because billing service/routes are absent.

- [ ] **Step 3: Define search and patch schemas**

```ts
export const billingOccurrenceSearchSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  companyIds: z.array(z.string().uuid()).max(100).default([]),
  familyIds: z.array(z.string().uuid()).max(50).default([]),
  statuses: z.array(z.enum(['OPEN', 'BILLED', 'WAIVED', 'CANCELLED'])).default([]),
  timing: z.array(z.enum(['UPCOMING', 'DUE', 'OVERDUE'])).default([]),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sortBy: z.enum(['expectedDate', 'company', 'family', 'service', 'status', 'amount']).default('expectedDate'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
}).strict();

export const updateBillingOccurrenceSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  status: z.enum(['OPEN', 'BILLED', 'WAIVED']).optional(),
  billedDate: z.string().date().nullable().optional(),
  operativeExpectedDate: z.string().date().optional(),
  amount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  externalReference: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  updateScope: z.enum(['THIS_OCCURRENCE', 'THIS_AND_FUTURE']),
  reason: z.string().trim().min(3).max(1000).nullable(),
}).strict();

export const resetBillingOverrideSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  target: z.enum(['DATE', 'VALUE', 'ALL']),
  reason: z.string().trim().min(3).max(1000),
}).strict();
```

- [ ] **Step 4: Implement accessible list and derived timing**

Apply tenant and company scope within Prisma. Open rows derive Upcoming/Due/Overdue from `operativeExpectedDate` and current Singapore date; translate timing filters to date predicates. DTO includes full Company name/display label, family name/color, service and fee line, period, status/timing, calculated/operative date, base/operative amount/currency, billed date, reference, notes, override flags, and `updatedAt`.

- [ ] **Step 5: Implement optimistic lifecycle and override mutations**

Load occurrence tenant-safely, require Company update permission in the route, reject Cancelled, and claim the selected row with `id + tenantId + updatedAt`. Status rules:

- Open → Billed sets `markedBilledAt/By`; billed date remains the submitted nullable value.
- Open → Waived requires reason and sets waiver metadata.
- Billed/Waived → Open requires reason and clears state metadata.
- Amount/currency edits set operative overrides and audit old/new values.
- Expected-date edits set the date override and reason.
- Reset target Date copies calculated expected date to operative date; Value copies base amount/currency to operative values; All performs both. Each reset clears only the corresponding override metadata and audits the reason.

For This and future, always update the selected row even when Billed, then update only matching future Open rows. Use a serializable transaction and one audit summary with affected IDs/count.

- [ ] **Step 6: Implement routes/hooks and run tests**

List requires `company:read` and the enabled Services workspace. Mutations load Company and require `company:update`. Hooks invalidate occurrence list/detail, coverage, roster indicators, and the affected client service.

Run: `npm.cmd run test:run -- __tests__/services/billing.service.test.ts __tests__/api/billing-occurrence-routes.test.ts __tests__/hooks/use-billing-occurrences.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit billing occurrence APIs**

```bash
git add src/services/billing/service.ts src/services/billing/index.ts src/app/api/billing-occurrences src/hooks/use-billing-occurrences.ts __tests__/services/billing.service.test.ts __tests__/api/billing-occurrence-routes.test.ts __tests__/hooks/use-billing-occurrences.test.ts
git commit -m "feat: track billing occurrence status"
```

---

### Task 7: Build the Billing tab and reconciliation panel

**Files:**
- Create: `src/components/services/billing/billing-workspace.tsx`
- Create: `src/components/services/billing/billing-filters.tsx`
- Create: `src/components/services/billing/billing-table.tsx`
- Create: `src/components/services/billing/billing-occurrence-dialog.tsx`
- Create: `src/components/services/billing/billing-coverage-panel.tsx`
- Modify: `src/components/services/services-workspace.tsx`
- Modify: `src/components/services/roster/service-roster-table.tsx`
- Modify: `src/lib/validations/services-preferences.ts`
- Create: `__tests__/components/billing-workspace.test.tsx`
- Create: `__tests__/components/billing-coverage-panel.test.tsx`
- Create: `__tests__/components/billing-occurrence-dialog.test.tsx`
- Create: `__tests__/browser/services-billing.browser.test.tsx`

**Interfaces:**
- Consumes: billing occurrence/coverage hooks, family chips, preferences.
- Produces: mockup view 4 and roster billing indicators.

- [ ] **Step 1: Write failing collapsed-coverage tests**

```tsx
it('keeps reconciliation collapsed and renders cards only for issues', () => {
  coverageHook.mockReturnValue({ data: { openIssueCount: 2, issues: issueRows } });
  render(<BillingCoveragePanel />);
  expect(screen.getByRole('button', { name: /Billing reconciliation.*2 issues/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Missing billing disposition')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Billing reconciliation/ }));
  expect(screen.getByText('Missing billing disposition')).toBeVisible();
});

it('renders no healthy per-service cards', () => {
  coverageHook.mockReturnValue({ data: { openIssueCount: 0, affectedServiceCount: 0, healthyActiveServiceCount: 24, issues: [] } });
  render(<BillingCoveragePanel />);
  expect(screen.getByText('24 active services have complete billing configuration')).toBeVisible();
  expect(screen.queryAllByTestId('billing-issue-card')).toHaveLength(0);
});
```

- [ ] **Step 2: Write failing edit-scope and wording tests**

```tsx
it('asks update scope whenever amount or currency changes', () => {
  render(<BillingOccurrenceDialog occurrence={billedOccurrence} />);
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1500.00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save tracking update' }));
  expect(screen.getByRole('dialog', { name: 'Apply amount change' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'This occurrence' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'This and future' })).toBeVisible();
});

it('uses tracking language and no invoice/payment claims', () => {
  render(<BillingWorkspace />);
  expect(screen.getByText(/manual billing tracking/i)).toBeVisible();
  expect(screen.queryByText(/create invoice|collect payment/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run component tests and verify missing views**

Run: `npm.cmd run test:run -- __tests__/components/billing-workspace.test.tsx __tests__/components/billing-coverage-panel.test.tsx __tests__/components/billing-occurrence-dialog.test.tsx`

Expected: FAIL because the Billing UI is absent.

- [ ] **Step 4: Build filters, table, and responsive cards**

Toolbar includes search/company, Open/Billed/Waived, timing, date range, and clickable family chips. Columns are expected date/timing, Company, family/service, fee line/period, state, amount/currency, billed date, reference, and actions. Reuse alternating rows, inline filters, active badges, column resizing, server pagination, and mobile cards. Persist under `services.billing.table.v1`.

The edit dialog permits Billed/Waived/Open, optional billed date, amount/currency, reference, and notes. When amount or currency differs, block submission until the user chooses a scope.

- [ ] **Step 5: Build the compact coverage panel**

Default `aria-expanded=false`. With issues, header shows count/severity and expansion renders issue cards grouped by Company/service with a Configure action. Without issues, render one compact healthy summary and no issue-card container.

- [ ] **Step 6: Add Billing tab and roster indicators**

Expand `ServicesWorkspace` to exactly Services, Deadlines, and Billing. URL is `/services?tab=billing`. Roster billing cell shows disposition and next Open/Billed tracking state; missing coverage shows a warning linked to the Billing tab.

- [ ] **Step 7: Run component and browser tests**

Run: `npm.cmd run test:run -- __tests__/components/billing-workspace.test.tsx __tests__/components/billing-coverage-panel.test.tsx __tests__/components/billing-occurrence-dialog.test.tsx __tests__/components/services-workspace.test.tsx __tests__/components/service-roster.test.tsx`

Expected: PASS.

Run: `npm.cmd run test:browser -- __tests__/browser/services-billing.browser.test.tsx`

Expected: PASS at desktop, tablet, and mobile viewports with approved spacing.

- [ ] **Step 8: Commit the Billing workspace**

```bash
git add src/components/services/billing src/components/services/services-workspace.tsx src/components/services/roster/service-roster-table.tsx src/lib/validations/services-preferences.ts __tests__/components/billing-workspace.test.tsx __tests__/components/billing-coverage-panel.test.tsx __tests__/components/billing-occurrence-dialog.test.tsx __tests__/components/services-workspace.test.tsx __tests__/components/service-roster.test.tsx __tests__/browser/services-billing.browser.test.tsx
git commit -m "feat: add billing tracking workspace"
```

---

### Task 8: Verify no manual-trigger billing, isolation, performance, and operations

**Files:**
- Create: `__tests__/integration/billing-tenant-isolation.postgres.test.ts`
- Create: `__tests__/integration/manual-deadline-no-billing.postgres.test.ts`
- Create: `__tests__/integration/billing-performance.postgres.test.ts`
- Modify: `src/services/schedule-reconciliation/worker.ts`
- Modify: `docs/guides/SERVICE_PATTERNS.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: complete billing feature.
- Produces: acceptance evidence, metrics, scripts, and operational documentation.

- [ ] **Step 1: Write PostgreSQL isolation and manual-trigger tests**

```ts
it('does not expose another tenant billing occurrence or issue', async () => {
  const occurrences = await listBillingOccurrences(search, tenantOneScope);
  const coverage = await listBillingCoverage(filters, tenantOneScope);
  expect(occurrences.items).not.toContainEqual(expect.objectContaining({ tenantId: tenantTwo.id }));
  expect(coverage.issues).not.toContainEqual(expect.objectContaining({ company: { id: tenantTwoCompany.id } }));
});

it('creates no billing occurrence after a manual historical deadline cycle', async () => {
  await prisma.$transaction((tx) => enqueueScheduleReconciliation(tx, {
    tenantId, scopeType: 'CLIENT_SERVICE', scopeId: clientServiceId,
    triggerType: 'TEST_BASELINE', correlationId: 'baseline', requestedById: actor.userId,
  }));
  await processScheduleReconciliationBatch({ limit: 20, concurrency: 4 });
  const before = await prisma.billingOccurrence.count({ where: { tenantId } });
  await createManualDeadlineCycle(manualCycleInput, actor);
  expect(await prisma.serviceScheduleReconciliationRequest.count({
    where: { tenantId, triggerType: 'MANUAL_DEADLINE_CYCLE' },
  })).toBe(0);
  await processScheduleReconciliationBatch({ limit: 20, concurrency: 4 });
  expect(await prisma.billingOccurrence.count({ where: { tenantId } })).toBe(before);
});
```

- [ ] **Step 2: Add representative performance fixtures**

Seed the specification dataset: 1,000 Companies, 10,000 ClientServices, 100,000 BillingOccurrences, and coverage issues across 10% of services. Assert paginated Billing list and coverage summary service calls complete within 1.5 seconds on staging-grade PostgreSQL and use tenant/date/status/issue partial indexes under `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Gate wall-clock assertions with `RUN_PERFORMANCE_TESTS=true`.

- [ ] **Step 3: Extend structured reconciliation metrics**

The worker's single per-request structured event includes billing created/recalculated/cancelled/preserved counts, coverage opened/resolved counts, services missing disposition, invalid schedule count, occurrence gaps, duration, attempt, tenant, request/correlation ID, and write mode. Never log notes, external references, or uploaded data.

- [ ] **Step 4: Document lifecycle, recovery, and migration behavior**

Add to `SERVICE_PATTERNS.md`:

```markdown
## Billing tracking

- Billing occurrences track expected/external billing only; they are not invoices or payments.
- Existing client services migrate to `UNREVIEWED` and remain coverage issues until explicitly Configured or Not required.
- Amount/currency edits require This occurrence or This and future; future propagation touches matching Open rows only.
- Billed date is optional; Billed records retain `markedBilledAt` for audit.
- Removed fee lines are archived because occurrences retain historical lineage.
- Manual deadline cycles never enqueue or generate billing.
- Coverage issue cards render only for unresolved configuration gaps.
```

Add scripts:

```json
"test:billing:postgres": "vitest run __tests__/integration/billing-reconciliation.postgres.test.ts __tests__/integration/billing-tenant-isolation.postgres.test.ts __tests__/integration/manual-deadline-no-billing.postgres.test.ts",
"test:billing:performance": "vitest run __tests__/integration/billing-performance.postgres.test.ts"
```

- [ ] **Step 5: Run the full billing verification matrix**

Run: `npm.cmd run db:generate`

Expected: PASS.

Run: `npm.cmd run test:run -- __tests__/services/billing-tracking-schema.test.ts __tests__/lib/billing-validation.test.ts __tests__/services/billing-schedule.test.ts __tests__/services/billing-schedule-backfill.test.ts __tests__/services/billing-reconciler.test.ts __tests__/services/billing-coverage.test.ts __tests__/services/billing.service.test.ts __tests__/api/billing-coverage-routes.test.ts __tests__/api/billing-occurrence-routes.test.ts __tests__/hooks/use-billing-coverage.test.ts __tests__/hooks/use-billing-occurrences.test.ts __tests__/components/billing-workspace.test.tsx __tests__/components/billing-coverage-panel.test.tsx __tests__/components/billing-occurrence-dialog.test.tsx __tests__/components/services-workspace.test.tsx __tests__/components/service-roster.test.tsx`

Expected: PASS.

Run: `npm.cmd run test:billing:postgres`

Expected: PASS with `TEST_DATABASE_URL` pointing to an isolated PostgreSQL database.

Run: `npm.cmd run test:browser -- __tests__/browser/services-billing.browser.test.tsx`

Expected: PASS.

Run: `npm.cmd run lint`

Expected: PASS with no new warnings in changed files.

Run: `npm.cmd run build`

Expected: PASS.

- [ ] **Step 6: Apply and inspect both billing migrations in isolation**

Run: `npm.cmd run db:migrate`

Expected: schema/backfill migrations apply, existing fees/amounts/currencies remain intact, custom schedules receive issues instead of guessed dates, and one deduplicated billing backfill request exists per tenant.

- [ ] **Step 7: Commit acceptance coverage and documentation**

```bash
git add __tests__/integration/billing-tenant-isolation.postgres.test.ts __tests__/integration/manual-deadline-no-billing.postgres.test.ts __tests__/integration/billing-performance.postgres.test.ts src/services/schedule-reconciliation/worker.ts docs/guides/SERVICE_PATTERNS.md package.json
git commit -m "test: verify billing tracking acceptance"
```

## Plan 3 completion gate

The overall feature is complete only when:

- Every active service is Configured or Not required, or appears as an Unreviewed issue.
- Deterministic legacy frequencies convert without invented dates; Custom gaps remain explicit.
- Billing generation is idempotent and shares the deadline rolling horizon/calendar/date engine.
- Billed date is optional and amount/currency edits work after Billed.
- This-and-future changes preserve historical and non-Open records.
- Client-service/fee-line archive cancels future Open occurrences and preserves history.
- Billing reconciliation is collapsed by default and renders cards only for issues.
- Manual historical deadline cycles create no billing work or occurrences.
- Billing list and coverage APIs enforce tenant and company scope in SQL.
- All schema, migration, unit, API, hook, component, browser, PostgreSQL, lint, build, and performance gates pass.
