# Manual Client Service Creation Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the validation, draft-safety, catalog-field UX, source-aware copy, and database-proof gaps found in the completed manual Client Service creation implementation.

**Architecture:** Keep the existing server-owned catalog identity and serializable creation transaction unchanged. Repair the remaining boundaries around them: translate server validation details into the controlled operational form, make modal state reflect every editable draft value and catalog refresh, render the catalog field metadata already present in the response, and strengthen PostgreSQL invariant coverage.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, TanStack Query, Zod, Prisma 7/PostgreSQL, Vitest, Testing Library, and Vitest Browser/Playwright.

## Global Constraints

- Manual creation continues to require only `company:update`; do not introduce `document:read`.
- `source`, `serviceVariantId`, `agreementId`, and `agreementItemId` remain immutable through the operational update API.
- The server continues to own catalog identity and name snapshots; the client must not submit names or agreement lineage during creation.
- SOW `required` flags must not block manual creation, and arbitrary operational fields remain supported.
- A service must have one to 100 fee rows; blank and negative amounts are invalid, while `0.00` remains valid.
- Status and dates survive a confirmed catalog switch; only cadence, service fields, and fees are replaced.
- Every dirty modal exit must require discard confirmation, including edits made before selecting a catalog variant.
- Validation failures remain HTTP `400` with `VALIDATION_ERROR`; duplicate and write-conflict contracts remain unchanged.
- Manual and agreement-created services continue to share list, edit, archive, audit, backup, restore, and cleanup behavior; do not add a source filter.
- Follow `docs/guides/DESIGN_GUIDELINE.md`: compact controls, accessible error associations, and 44px mobile touch targets.

---

## Review Findings

| Priority | Finding | Evidence | Impact |
|---|---|---|---|
| P1 | Required start-date and structured server field errors stop at the component boundary. | `validateOperationalServiceValues` does not check `startDate` (`client-service-form-state.ts:37-58`); the start control has no error prop (`operational-service-form.tsx:72`); the creator handles duplicate `409` and catalog `404` only (`client-service-creator.tsx:116-124`). | A blank start date reaches the API and the user sees only “The service could not be created.” Server paths such as `feeLines.0.amount` are retained by the hook but never associated with the invalid control. The same shared validation gap lets the edit form submit a cleared start date. |
| P1 | Malformed JSON does not use the documented validation response. | `createManualClientServiceErrorResponse` handles `ZodError` and otherwise delegates to the generic response (`route-utils.ts:7-27`). | Invalid JSON returns a legacy `400` body without `VALIDATION_ERROR` or field details, contrary to the create API contract. |
| P2 | Dirty-state detection ignores all values before catalog selection. | `manualFormIsDirty` returns only `Boolean(selectedVariantId)` and ignores its values argument (`client-service-form-state.ts:210-211`). Status and dates are editable before selection. | A user can enter dates or change status, then close the modal without a discard confirmation and lose the draft. |
| P2 | Catalog refresh and selector state can become non-functional or inaccessible. | Submission silently returns if the selected option disappears (`client-service-creator.tsx:101`), while the submit button checks only the non-empty ID (`:166`). `SearchableSelect` is clearable by default and emits `onChange('')`, but the creator ignores an empty selection. Selector errors are rendered as an unrelated paragraph rather than through `aria-invalid`/`aria-describedby`. | A refetch that removes an inactive variant can leave an enabled button that does nothing. The visible clear button also does nothing. Screen-reader users do not get an associated selector error, and the selector misses the required mobile touch height. |
| P2 | Catalog field `label` and `type` are collected but not rendered. | `catalogReplacementForVariant` stores both values (`client-service-form-state.ts:147-148`), but `operational-service-form.tsx` renders every value as an unlabeled plain text input. | Date, boolean, number, currency, and textarea definitions lose their intended input affordance, and human-friendly catalog labels are not shown. |
| P3 | The true empty-state copy still claims agreement activation is the only source. | `company-services-tab.tsx:75` says “Services appear here after a Service Agreement is activated.” | The copy contradicts the newly implemented manual source and the design requirement for source-aware empty states. |
| P2 test gap | The migration check is inspected as text but never exercised by PostgreSQL. | `client-service-schema.test.ts:37-38` checks only `CHECK` and the constraint name. The PostgreSQL suites create valid rows but do not try every invalid source/reference combination. | A future edit could weaken the invariant while string tests continue to pass. In this review environment, all PostgreSQL cases were skipped because `TEST_DATABASE_URL` was absent. |

## Verification Baseline

- `npm.cmd run test:run`: PASS — 239 files and 1,767 tests passed; 16 PostgreSQL tests skipped.
- Focused manual-service suites: PASS — 11 files and 123 tests.
- `npm.cmd run test:browser -- __tests__/browser/company-services.browser.test.tsx`: PASS — 2 Chromium tests.
- `npm.cmd run lint`: PASS with zero errors and nine unrelated pre-existing warnings.
- `npm.cmd run build`: PASS.
- `npm.cmd run test:client-services:postgres`: suite loaded, but all four tests skipped because `TEST_DATABASE_URL` was not configured.
- `git diff --check`: PASS before this review document was added.

---

### Task 1: Complete End-to-End Validation and Error Association

**Files:**
- Modify: `src/components/companies/company-detail/client-service-form-state.ts`
- Modify: `src/components/companies/company-detail/operational-service-form.tsx`
- Modify: `src/components/companies/company-detail/client-service-creator.tsx`
- Modify: `src/app/api/companies/[id]/services/route-utils.ts`
- Modify: `__tests__/components/operational-service-form.test.tsx`
- Modify: `__tests__/components/client-service-creator.test.tsx`
- Modify: `__tests__/api/manual-client-services-routes.test.ts`

**Interfaces:**
- Consumes: `HttpRequestError.details`, whose validation shape is `{ fieldErrors: Record<string, string> }`, and the existing UI-ID-backed fee/field rows.
- Produces: client validation for required start dates, an `operationalErrorsFromServer(details, values)` translator, and accessible field errors for create and edit.

- [ ] **Step 1: Add failing required-date and structured-error tests**

Add these assertions to the creator suite:

```tsx
it('requires a start date and associates the error with the date control', async () => {
  const mutateAsync = vi.fn();
  hooksMock.useCreateManualClientService.mockReturnValue({ mutateAsync, isPending: false });
  render(<ClientServiceCreator companyId="company-1" isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
  await selectVariant('Corporate Secretarial');
  fireEvent.click(screen.getByRole('button', { name: 'Add service' }));

  const startDate = screen.getByLabelText('Start date');
  expect(startDate).toHaveAttribute('aria-invalid', 'true');
  expect(document.getElementById(startDate.getAttribute('aria-describedby')!))
    .toHaveTextContent('Start date is required.');
  expect(mutateAsync).not.toHaveBeenCalled();
});

it('maps server fee errors back to the matching controlled fee row', async () => {
  const mutateAsync = vi.fn();
  hooksMock.useCreateManualClientService.mockReturnValue({ mutateAsync, isPending: false });
  mutateAsync.mockRejectedValueOnce(Object.assign(new Error('The service could not be created.'), {
    status: 400,
    code: 'VALIDATION_ERROR',
    details: { fieldErrors: { 'feeLines.0.amount': 'Enter a non-negative amount with at most two decimals.' } },
    body: {},
  }));
  render(<ClientServiceCreator companyId="company-1" isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
  await selectVariant('Corporate Secretarial');
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add service' }));

  const amount = await screen.findByLabelText('Fee 1 amount');
  expect(amount).toHaveAttribute('aria-invalid', 'true');
  expect(document.getElementById(amount.getAttribute('aria-describedby')!))
    .toHaveTextContent('Enter a non-negative amount with at most two decimals.');
});
```

Add a route case using a malformed body:

```ts
it('returns the validation contract for malformed JSON', async () => {
  const request = new NextRequest('http://localhost/api/companies/company-1/services', {
    method: 'POST',
    body: '{',
    headers: { 'content-type': 'application/json' },
  });

  const response = await createService(request, { params: Promise.resolve({ id: 'company-1' }) });
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: 'The service could not be created.',
    code: 'VALIDATION_ERROR',
    details: { fieldErrors: { body: 'Enter a valid JSON object.' } },
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/components/operational-service-form.test.tsx __tests__/components/client-service-creator.test.tsx __tests__/api/manual-client-services-routes.test.ts
```

Expected: FAIL because start date is not validated, server paths are not translated, and malformed JSON falls through the legacy generic error branch.

- [ ] **Step 3: Add client validation and the server-path translator**

Add the required date check to `validateOperationalServiceValues`, then export this translator from `client-service-form-state.ts`:

```ts
if (!values.startDate) errors.startDate = 'Start date is required.';

export function operationalErrorsFromServer(
  details: unknown,
  values: OperationalServiceValues,
): OperationalFieldErrors {
  if (!details || typeof details !== 'object' || !('fieldErrors' in details)) return {};
  const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== 'object') return {};

  const translated: OperationalFieldErrors = {};
  const feeSuffix: Record<string, string> = {
    description: 'description',
    amount: 'amount',
    currency: 'currency',
    billingFrequency: 'frequency',
    customFrequencyLabel: 'custom-frequency',
    billingStartDate: 'billing-start-date',
  };

  for (const [path, message] of Object.entries(fieldErrors)) {
    if (typeof message !== 'string') continue;
    const feeMatch = /^feeLines\.(\d+)\.([A-Za-z]+)$/.exec(path);
    if (feeMatch) {
      const fee = values.fees[Number(feeMatch[1])];
      const suffix = feeSuffix[feeMatch[2]];
      if (fee && suffix) translated[`fee-${fee.uiId}-${suffix}`] = message;
      else translated.feeLines = message;
      continue;
    }

    const fieldMatch = /^fieldValues\.([^.]*)$/.exec(path);
    if (fieldMatch) {
      const field = values.fields.find((row) => row.key === fieldMatch[1]);
      translated[field ? `field-${field.uiId}-value` : 'fieldValues'] = message;
      continue;
    }

    translated[path || 'body'] = message;
  }
  return translated;
}
```

- [ ] **Step 4: Expose the translated errors through accessible controls**

Pass `errors.startDate` to the existing `FormInput`. Add the fee billing-date error and section-level fallbacks:

```tsx
<FormInput
  id="client-service-start-date"
  type="date"
  label="Start date"
  required
  disabled={disabled}
  value={values.startDate}
  error={errors.startDate}
  onChange={(event) => updateValue('startDate', event.target.value)}
/>

{errors.fieldValues ? <p role="alert" className="text-xs text-status-error">{errors.fieldValues}</p> : null}
{errors.feeLines ? <p role="alert" className="text-xs text-status-error">{errors.feeLines}</p> : null}
```

For field values, use `id={`field-${field.uiId}-value`}`, `aria-invalid`, `aria-describedby`, and an error paragraph with the matching ID. For billing start dates, pass `errors[`${prefix}-billing-start-date`]` to `FormInput`.

- [ ] **Step 5: Consume `VALIDATION_ERROR` in the creator without losing the draft**

Import `operationalErrorsFromServer` and add this branch before the catalog `404` branch:

```ts
if (isHttpRequestError(error, 400) && error.code === 'VALIDATION_ERROR') {
  const nextErrors = operationalErrorsFromServer(error.details, values);
  setErrors(nextErrors);
  setFormError(
    Object.keys(nextErrors).length > 0
      ? 'Review the highlighted fields and try again.'
      : error.message,
  );
  return;
}
```

Do not clear `values`, `selectedVariantId`, or `replacement` in this branch.

- [ ] **Step 6: Normalize malformed JSON into the create validation contract**

Add this branch after the Zod branch in `createManualClientServiceErrorResponse`:

```ts
if (error instanceof SyntaxError) {
  return NextResponse.json({
    error: 'The service could not be created.',
    code: ErrorCodes.VALIDATION_ERROR,
    details: { fieldErrors: { body: 'Enter a valid JSON object.' } },
  }, { status: 400 });
}
```

- [ ] **Step 7: Rerun focused tests**

Run the Step 2 command again.

Expected: PASS; create and edit reject a blank start date locally, API field paths reach their controls, and malformed JSON has a stable validation body.

- [ ] **Step 8: Commit Task 1**

```powershell
git add -- src/components/companies/company-detail/client-service-form-state.ts src/components/companies/company-detail/operational-service-form.tsx src/components/companies/company-detail/client-service-creator.tsx src/app/api/companies/[id]/services/route-utils.ts __tests__/components/operational-service-form.test.tsx __tests__/components/client-service-creator.test.tsx __tests__/api/manual-client-services-routes.test.ts
git commit -m "fix(services): surface manual creation validation"
```

---

### Task 2: Make Draft and Catalog Selection State Truthful

**Files:**
- Modify: `src/components/companies/company-detail/client-service-form-state.ts`
- Modify: `src/components/companies/company-detail/client-service-creator.tsx`
- Modify: `src/components/ui/searchable-select.tsx`
- Modify: `__tests__/components/client-service-creator.test.tsx`

**Interfaces:**
- Consumes: the initial empty operational values, catalog query refreshes, and the selected variant ID.
- Produces: semantic dirty detection, an accessible selector error contract, a disabled submit when the selected option disappears, and no dead clear affordance.

- [ ] **Step 1: Add failing draft-loss and stale-catalog tests**

```tsx
it('confirms before closing a pre-selection draft', () => {
  const onClose = vi.fn();
  render(<ClientServiceCreator companyId="company-1" isOpen onClose={onClose} onCreated={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Discard this draft?')).toBeVisible();
  expect(onClose).not.toHaveBeenCalled();
});

it('keeps the draft and blocks submission when a refetch removes the selection', async () => {
  const query = { data: options, isLoading: false, error: null };
  hooksMock.useManualClientServiceCatalogOptions.mockImplementation(() => query);
  const view = render(<ClientServiceCreator companyId="company-1" isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
  await selectVariant('Corporate Secretarial');
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-01' } });

  query.data = { variants: [] };
  view.rerender(<ClientServiceCreator companyId="company-1" isOpen onClose={vi.fn()} onCreated={vi.fn()} />);

  expect(screen.getByText(/no longer available/i)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Add service' })).toBeDisabled();
  expect(screen.getByLabelText('Start date')).toHaveValue('2026-08-01');
});

it('does not expose a non-functional clear-selection button', async () => {
  render(<ClientServiceCreator companyId="company-1" isOpen onClose={vi.fn()} onCreated={vi.fn()} />);
  await selectVariant('Corporate Secretarial');
  expect(screen.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the creator test and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/components/client-service-creator.test.tsx
```

Expected: FAIL because pre-selection values are treated as clean, a missing selected option silently stops submission, and the default selector clear action is visible.

- [ ] **Step 3: Compare the complete semantic draft with the empty state**

Replace `manualFormIsDirty` with a UI-ID-independent signature:

```ts
function manualDirtySignature(values: OperationalServiceValues): string {
  return JSON.stringify({
    status: values.status,
    serviceCadence: values.serviceCadence,
    customCadenceLabel: values.customCadenceLabel,
    startDate: values.startDate,
    endDate: values.endDate,
    fields: values.fields.map(({ key, label, type, value, catalogDerived }) => ({ key, label, type, value, catalogDerived })),
    fees: values.fees.map((fee) => ({
      description: fee.description,
      amount: fee.amount,
      currency: fee.currency,
      billingFrequency: fee.billingFrequency,
      customFrequencyLabel: fee.customFrequencyLabel,
      billingStartDate: fee.billingStartDate,
      catalogDerived: fee.catalogDerived,
    })),
  });
}

export function manualFormIsDirty(
  selectedVariantId: string | null,
  values: OperationalServiceValues,
): boolean {
  return Boolean(selectedVariantId)
    || manualDirtySignature(values) !== manualDirtySignature(emptyManualOperationalValues());
}
```

- [ ] **Step 4: Add an accessible error contract to `SearchableSelect`**

Add `error` to `SearchableSelectProps`, destructure it with the existing props, create the error ID immediately after `baseId`, and add the input/error relationships shown here:

```ts
export interface SearchableSelectProps {
  error?: string;
}

const errorId = error ? `${baseId}-error` : undefined;

<input
  aria-invalid={error ? 'true' : 'false'}
  aria-describedby={errorId}
/>
{error ? <p id={errorId} className="mt-1.5 text-xs text-status-error">{error}</p> : null}
```

Add `border-status-error` to the trigger container when `error` is present, without removing its existing focus and disabled classes.

- [ ] **Step 5: Handle missing options explicitly and remove the dead clear affordance**

In `ClientServiceCreator`, derive and use a missing-selection error:

```ts
const selectedVariantMissing = Boolean(
  selectedVariantId && catalog.data && !selectedVariant,
);
const selectorError = errors.serviceVariantId
  ?? (selectedVariantMissing
    ? 'This catalog service is no longer available. Choose another service.'
    : undefined);

if (!selectedVariantId) return;
if (!selectedVariant) {
  setErrors((current) => ({
    ...current,
    serviceVariantId: 'This catalog service is no longer available. Choose another service.',
  }));
  return;
}
```

Pass the selector props and tighten submission:

```tsx
<SearchableSelect
  label="Service"
  placeholder="Select service"
  options={selectOptions}
  value={selectedVariantId}
  onChange={requestVariantChange}
  disabled={pending}
  loading={catalog.isLoading}
  groupBy="group"
  clearable={false}
  error={selectorError}
  containerClassName="min-h-11 sm:min-h-8"
/>

<Button
  isLoading={pending}
  disabled={!selectedVariant || pending}
  onClick={() => submit(false)}
>
  Add service
</Button>
```

Remove the standalone selector-error paragraph after `SearchableSelect`; the shared component now owns the association.

- [ ] **Step 6: Rerun the creator test**

Run the Step 2 command again.

Expected: PASS; every non-empty draft is protected, stale catalog state is actionable, the selected draft is retained, and the selector has a 44px mobile target.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- src/components/companies/company-detail/client-service-form-state.ts src/components/companies/company-detail/client-service-creator.tsx src/components/ui/searchable-select.tsx __tests__/components/client-service-creator.test.tsx
git commit -m "fix(services): protect manual service drafts"
```

---

### Task 3: Render Catalog Field Labels and Input Types

**Files:**
- Modify: `src/components/companies/company-detail/operational-service-form.tsx`
- Modify: `__tests__/components/operational-service-form.test.tsx`
- Modify: `__tests__/components/client-service-creator.test.tsx`

**Interfaces:**
- Consumes: `OperationalFieldRow.label`, `OperationalFieldRow.type`, and string-backed field values.
- Produces: label-aware text, date, numeric, currency, boolean, and textarea controls while keeping keys editable and fields removable.

- [ ] **Step 1: Add failing type-aware field tests**

```tsx
it('renders catalog labels and type-appropriate field controls', () => {
  const values: OperationalServiceValues = {
    ...baseValues(),
    fields: [
      { uiId: 'text', key: 'software', label: 'Accounting software', type: 'text', value: 'Xero', catalogDerived: true },
      { uiId: 'date', key: 'renewalDate', label: 'Renewal date', type: 'date', value: '2026-08-01', catalogDerived: true },
      { uiId: 'number', key: 'headcount', label: 'Headcount', type: 'number', value: '25', catalogDerived: true },
      { uiId: 'currency', key: 'budget', label: 'Budget', type: 'currency', value: '1200.00', catalogDerived: true },
      { uiId: 'boolean', key: 'gstRegistered', label: 'GST registered', type: 'boolean', value: 'true', catalogDerived: true },
      { uiId: 'textarea', key: 'notes', label: 'Service notes', type: 'textarea', value: 'Priority filing', catalogDerived: true },
    ],
  };
  render(<Harness initial={values} />);

  expect(screen.getByLabelText('Renewal date')).toHaveAttribute('type', 'date');
  expect(screen.getByLabelText('Headcount')).toHaveAttribute('inputmode', 'decimal');
  expect(screen.getByLabelText('Budget')).toHaveAttribute('inputmode', 'decimal');
  expect(screen.getByLabelText('GST registered').tagName).toBe('SELECT');
  expect(screen.getByLabelText('Service notes').tagName).toBe('TEXTAREA');
  expect(screen.getByLabelText('Accounting software')).toHaveValue('Xero');
});
```

- [ ] **Step 2: Run the operational-form test and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/components/operational-service-form.test.tsx __tests__/components/client-service-creator.test.tsx
```

Expected: FAIL because every value is currently an unlabeled text input.

- [ ] **Step 3: Add a string-backed field value renderer**

Add a local component to `operational-service-form.tsx`:

```tsx
function OperationalFieldValue({
  field,
  disabled,
  error,
  onChange,
}: {
  field: OperationalServiceValues['fields'][number];
  disabled: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = `field-${field.uiId}-value`;
  const errorId = `${id}-error`;
  const label = field.label.trim() || field.key.trim() || 'Field value';
  const accessibility = {
    id,
    'aria-invalid': error ? 'true' : 'false',
    'aria-describedby': error ? errorId : undefined,
  } as const;

  let control: ReactNode;
  if (field.type === 'textarea') {
    control = <textarea {...accessibility} className="input min-h-24 p-3" disabled={disabled} value={field.value} onChange={(event) => onChange(event.target.value)} />;
  } else if (field.type === 'boolean') {
    control = (
      <select {...accessibility} className="input min-h-11 px-3 sm:min-h-8" disabled={disabled} value={field.value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Not set</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  } else {
    control = (
      <input
        {...accessibility}
        className="input min-h-11 px-3 sm:min-h-8"
        type={field.type === 'date' ? 'date' : 'text'}
        inputMode={field.type === 'number' || field.type === 'currency' ? 'decimal' : undefined}
        disabled={disabled}
        value={field.value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-text-secondary">{label}</label>
      {control}
      {error ? <p id={errorId} className="mt-1.5 text-xs text-status-error">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Replace only the field value input**

Keep the key input editable and the remove action unchanged. Replace the second raw input with:

```tsx
<OperationalFieldValue
  field={field}
  disabled={disabled || sectionsDisabled}
  error={errors[`field-${field.uiId}-value`]}
  onChange={(value) => updateValue(
    'fields',
    values.fields.map((item) => item.uiId === field.uiId ? { ...item, value } : item),
  )}
/>
```

For a non-catalog field, keep its display label synchronized with the editable key:

```ts
const nextKey = event.target.value;
return item.uiId === field.uiId
  ? { ...item, key: nextKey, label: item.catalogDerived ? item.label : nextKey }
  : item;
```

- [ ] **Step 5: Rerun focused component tests**

Run the Step 2 command again.

Expected: PASS; the create form uses the minimal catalog metadata it already receives, while edit values remain string-backed and flexible.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- src/components/companies/company-detail/operational-service-form.tsx __tests__/components/operational-service-form.test.tsx __tests__/components/client-service-creator.test.tsx
git commit -m "improve(services): render catalog field metadata"
```

---

### Task 4: Make the True Empty State Source-Aware

**Files:**
- Modify: `src/components/companies/company-detail/company-services-tab.tsx`
- Modify: `__tests__/components/company-services-tab.test.tsx`

**Interfaces:**
- Consumes: the existing true-empty versus filtered-empty branch.
- Produces: source-aware empty copy without changing action permissions or adding filters.

- [ ] **Step 1: Add a failing source-aware empty-state assertion**

```tsx
it('describes both manual and agreement service origins in the true empty state', () => {
  hooksMock.useClientServices.mockReturnValue({
    data: { services: [], total: 0, activations: [] },
    isLoading: false,
    error: null,
  });
  render(<CompanyServicesTab companyId="company-1" canEdit />);

  expect(screen.getByText(
    'Services appear here when they are added manually or activated from a Service Agreement.',
  )).toBeVisible();
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/components/company-services-tab.test.tsx
```

Expected: FAIL on the agreement-only sentence.

- [ ] **Step 3: Replace the true-empty sentence**

Use exactly:

```tsx
filtered
  ? 'Try adjusting your search or status filter.'
  : 'Services appear here when they are added manually or activated from a Service Agreement.'
```

Do not change the two editor-only Add service actions or the filtered-empty message.

- [ ] **Step 4: Rerun the focused test**

Run the Step 2 command again.

Expected: PASS; true empty is source-aware, filtered empty remains concise, and read-only users still see no Add service action.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- src/components/companies/company-detail/company-services-tab.tsx __tests__/components/company-services-tab.test.tsx
git commit -m "fix(services): make empty state source aware"
```

---

### Task 5: Prove the Source/Agreement Check Constraint in PostgreSQL

**Files:**
- Modify: `__tests__/services/client-service-schema.test.ts`
- Modify: `__tests__/integration/service-agreement-activation.postgres.test.ts`

**Interfaces:**
- Consumes: the existing `seedAgreement()` PostgreSQL fixture and migration-managed `client_services_source_reference_consistency` constraint.
- Produces: text-level exact invariant coverage plus database-backed rejection of all six invalid source/reference combinations.

- [ ] **Step 1: Strengthen the migration text assertion**

```ts
it('declares the exact source/reference invariant', () => {
  const normalized = sourceMigration.replace(/\s+/g, ' ');
  expect(normalized).toContain(
    '("source" = \'AGREEMENT\' AND "agreement_id" IS NOT NULL AND "agreement_item_id" IS NOT NULL)',
  );
  expect(normalized).toContain(
    '("source" = \'MANUAL\' AND "agreement_id" IS NULL AND "agreement_item_id" IS NULL)',
  );
});
```

- [ ] **Step 2: Add the failing PostgreSQL constraint matrix**

Add this test to `service-agreement-activation.postgres.test.ts`, where `seedAgreement()` already returns valid company, variant, agreement, and item IDs:

```ts
it('rejects every impossible client-service source/reference combination', async () => {
  const seeded = await seedAgreement();
  const base = {
    tenantId: seeded.workspace.id,
    companyId: seeded.company.id,
    serviceVariantId: seeded.item.serviceVariantId,
    familyName: 'Constraint family',
    serviceCadence: 'ANNUALLY' as const,
    startDate: new Date('2026-08-02T00:00:00Z'),
    fieldValues: {},
  };
  const invalid = [
    { source: 'AGREEMENT' as const, agreementId: null, agreementItemId: null },
    { source: 'AGREEMENT' as const, agreementId: seeded.agreement.id, agreementItemId: null },
    { source: 'AGREEMENT' as const, agreementId: null, agreementItemId: seeded.item.id },
    { source: 'MANUAL' as const, agreementId: seeded.agreement.id, agreementItemId: seeded.item.id },
    { source: 'MANUAL' as const, agreementId: seeded.agreement.id, agreementItemId: null },
    { source: 'MANUAL' as const, agreementId: null, agreementItemId: seeded.item.id },
  ];

  for (const [index, lineage] of invalid.entries()) {
    await expect(prisma.clientService.create({
      data: { ...base, ...lineage, serviceName: `Invalid lineage ${index}` },
    })).rejects.toMatchObject({ code: 'P2004' });
  }

  expect(await prisma.clientService.count({ where: { tenantId: seeded.workspace.id } })).toBe(0);

  await prisma.clientService.create({
    data: {
      ...base,
      source: 'AGREEMENT',
      agreementId: seeded.agreement.id,
      agreementItemId: seeded.item.id,
      serviceName: 'Valid agreement lineage',
    },
  });
  await prisma.clientService.create({
    data: {
      ...base,
      source: 'MANUAL',
      agreementId: null,
      agreementItemId: null,
      serviceName: 'Valid manual lineage',
      startDate: new Date('2026-08-03T00:00:00Z'),
    },
  });

  expect(await prisma.clientService.count({ where: { tenantId: seeded.workspace.id } })).toBe(2);
});
```

- [ ] **Step 3: Run schema coverage and the real PostgreSQL suites**

```powershell
npm.cmd run test:run -- __tests__/services/client-service-schema.test.ts
npm.cmd run test:stage3:postgres
npm.cmd run test:client-services:postgres
```

Expected: all schema tests PASS. Both PostgreSQL commands must execute—not skip—against an isolated database with all migrations applied. The constraint matrix, existing simultaneous-create test, confirmed duplicate test, archived-row test, and later-agreement test must all PASS.

- [ ] **Step 4: Commit Task 5**

```powershell
git add -- __tests__/services/client-service-schema.test.ts __tests__/integration/service-agreement-activation.postgres.test.ts
git commit -m "test(services): prove client service lineage constraints"
```

---

## Final Verification

- [ ] Run focused feature suites:

```powershell
npm.cmd run test:run -- __tests__/services/client-service-schema.test.ts __tests__/lib/client-service-validation.test.ts __tests__/services/client-service-catalog-options.test.ts __tests__/services/client-service-manual-create.test.ts __tests__/api/manual-client-services-routes.test.ts __tests__/hooks/use-client-services.test.ts __tests__/components/operational-service-form.test.tsx __tests__/components/client-service-creator.test.tsx __tests__/components/company-services-tab.test.tsx __tests__/services/backup-service-agreement-data.test.ts __tests__/services/service-agreement-activation.service.test.ts
npm.cmd run test:browser -- __tests__/browser/company-services.browser.test.tsx
```

- [ ] Run PostgreSQL verification with `TEST_DATABASE_URL` configured:

```powershell
npm.cmd run test:stage3:postgres
npm.cmd run test:client-services:postgres
```

- [ ] Run the full quality gate:

```powershell
npm.cmd run db:generate
npm.cmd run lint
npm.cmd run test:run
npm.cmd run test:browser
npm.cmd run build
git diff --check
```

- [ ] Manually verify at 320px and desktop width:

1. Enter a start date before selecting a service, close through Cancel, header close, Escape, and backdrop, and confirm every path protects the draft.
2. Select a catalog service containing all six field types and verify labels, controls, defaults, editing, removal, and arbitrary field addition.
3. Submit with a blank start date and an invalid fee, then verify focusable, associated errors without draft loss.
4. Remove or deactivate the selected variant during an open modal, refetch options, and verify the selector error, retained draft, disabled submission, and 44px mobile selector target.
5. Create a service, confirm list filters/page size/page remain unchanged, and open the returned DTO through View service.

## Acceptance Checklist

- [ ] Blank start dates are rejected in create and edit before a network request and are announced by the associated control.
- [ ] Server `VALIDATION_ERROR` paths map to the exact fee, date, selector, or service-field control; malformed JSON uses the same stable response contract.
- [ ] Pre-selection status/date edits and post-selection drafts require discard confirmation through every close path.
- [ ] A selected variant removed by catalog refetch cannot submit, does not erase the draft, and shows an accessible selector error.
- [ ] The creator has no non-functional clear control and meets mobile touch-target guidance.
- [ ] Catalog labels and six supported field types are visible and editable without enforcing SOW-required metadata.
- [ ] True empty-state copy names both manual and agreement origins; filtered-empty and read-only behavior stay unchanged.
- [ ] PostgreSQL rejects all invalid source/reference combinations and accepts both valid combinations.
- [ ] The serializable duplicate suite executes against PostgreSQL and still proves one simultaneous unconfirmed create succeeds while the other returns `DUPLICATE_CLIENT_SERVICE`.
- [ ] Focused tests, full Vitest, browser tests, lint, Prisma generation, build, and `git diff --check` pass.
