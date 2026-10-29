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
