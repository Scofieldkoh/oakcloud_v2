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
