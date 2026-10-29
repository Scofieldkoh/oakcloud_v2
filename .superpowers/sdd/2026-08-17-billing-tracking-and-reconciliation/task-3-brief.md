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
