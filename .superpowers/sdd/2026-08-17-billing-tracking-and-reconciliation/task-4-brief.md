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
