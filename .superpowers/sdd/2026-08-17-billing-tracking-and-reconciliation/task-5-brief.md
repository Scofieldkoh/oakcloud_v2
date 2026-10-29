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
