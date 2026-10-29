# Service Agreement Third-Round Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every actionable third-round Stage 2 finding by making representative snapshots authoritative, making Review persistence failure-safe, enforcing composition/relation consistency, confirming destructive primary-company changes, and completing every locally available release gate.

**Architecture:** Keep the persisted relational agreement authoritative. Preserve its representative snapshot until the user deliberately selects a different company/contact, make the Review transition a two-save state machine with step 2 as the failure-safe state, and enforce attached-agreement consistency on both session-save and final-generation server paths. Centralize destructive-impact calculation in the wizard so primary and additional entity changes share the same confirmation semantics.

**Tech Stack:** TypeScript 5.7, React 19, Next.js 15 route handlers, Prisma 7/PostgreSQL, Zod 3, Vitest 4, Chromium browser tests, existing Puppeteer/PDF export.

## Global Constraints

- Preserve generic document generation and generation-session v1 compatibility.
- Never refresh a saved representative or service-wording snapshot implicitly.
- Only a deliberate primary-company or authorised-contact change may capture a new representative snapshot.
- Only DRAFT Service Agreements may be discarded.
- Do not activate operational Services or implement Stage 3.
- Do not reverse-sync edited HTML into structured agreement rows.
- Preserve all unrelated user changes in the dirty worktree; do not stage or commit intermediate tasks.
- Keep the seeded Service Agreement bundle inactive until the generated-PDF inspection is complete and explicitly approved.

---

### Task 1: Make the representative snapshot authoritative across save and generation

**Files:**
- Modify: `src/services/service-agreement/draft.service.ts`
- Modify: `src/components/documents/document-generation-wizard.tsx`
- Test: `__tests__/services/service-agreement-draft.service.test.ts`
- Test: `__tests__/components/document-generation-wizard.test.tsx`

**Interfaces:**
- Preserve `upsertServiceAgreementDraft(generatedDocumentId, input, params, options)`.
- `agreementDtoToInput(saved)` must use `saved.authorizedContactId ?? saved.authorizedRepresentativeSnapshot.id` as the editable contact identity.
- A saved Service Agreement snapshot satisfies the wizard's contact requirement even if current party options omit that contact.

- [ ] **Step 1: Add a failing service regression for an unchanged deleted contact**

Extend the draft-service transaction fixture so the existing agreement has `authorizedContactId: null` and `authorizedRepresentativeSnapshot.id` equal to the submitted contact ID. Assert that `upsertServiceAgreementDraft()` succeeds without calling `companyContact.findFirst`, preserves the snapshot values, and leaves the nullable FK null.

```ts
it('preserves the pinned representative when the unchanged source contact was deleted', async () => {
  prismaMock.serviceAgreement.findUnique.mockResolvedValueOnce(existingAgreementWithDeletedContact);

  const saved = await upsertServiceAgreementDraft(documentId, unchangedInput, tenantParams);

  expect(prismaMock.companyContact.findFirst).not.toHaveBeenCalled();
  expect(saved.authorizedRepresentativeSnapshot).toEqual({
    id: contactId,
    name: 'Pinned Representative',
    role: 'Director',
    email: 'pinned@example.com',
    phone: '+65 6000 0000',
  });
  expect(prismaMock.serviceAgreement.upsert).toHaveBeenCalledWith(expect.objectContaining({
    update: expect.objectContaining({ authorizedContactId: null }),
  }));
});
```

- [ ] **Step 2: Run the service regression and verify RED**

Run:

```powershell
npx.cmd vitest run __tests__/services/service-agreement-draft.service.test.ts
```

Expected: FAIL because `representativeSnapshot()` still queries the deleted relation before loading the existing agreement.

- [ ] **Step 3: Preserve the existing snapshot by snapshot identity**

Move representative selection inside the transaction after loading `existing`. Parse the stored snapshot with the existing JSON helper. Reuse it when both the primary company and `snapshot.id` match the submitted identities; otherwise resolve a new current relation.

```ts
const existingRepresentative = existing
  ? jsonObject<AuthorizedRepresentativeSnapshot>(
      existing.authorizedRepresentativeSnapshot,
      { id: '', name: '', role: null, email: null, phone: null },
    )
  : null;
const preservesRepresentative = Boolean(
  existingRepresentative?.id
  && existing?.primaryCompanyId === parsed.primaryCompanyId
  && existingRepresentative.id === parsed.authorizedContactId,
);
const representative = preservesRepresentative
  ? existingRepresentative!
  : await representativeSnapshot(
      parsed.authorizedContactId,
      parsed.primaryCompanyId,
      params.tenantId,
      tx,
    );
const persistedContactId = preservesRepresentative
  ? existing!.authorizedContactId
  : parsed.authorizedContactId;
```

Use `persistedContactId` in the upsert update and keep the create branch tied to the newly resolved current relation.

- [ ] **Step 4: Add a failing wizard regression that clicks Save and Generate after contact deletion**

Extend the existing deleted-contact resume test. Return empty current contact options, provide `onSaveDraft` and `onGenerate`, click Save Draft and Generate Document, and assert both receive the pinned representative identity. The break caught is any current-party effect or guard that clears/requires the deleted contact.

```ts
expect(await screen.findByLabelText('Document content')).toHaveValue(savedPreview);
fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
await waitFor(() => expect(onSaveDraft).toHaveBeenCalledOnce());
fireEvent.click(screen.getByRole('button', { name: 'Generate Document' }));
await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(
  expect.objectContaining({ selectedContactId: deletedContactId }),
));
```

- [ ] **Step 5: Run the wizard regression and verify RED**

Run:

```powershell
npx.cmd vitest run __tests__/components/document-generation-wizard.test.tsx
```

Expected: FAIL because current party options clear `selectedContactId` and `handleGenerate()` applies the standard contact guard.

- [ ] **Step 6: Make saved snapshot identity survive current-party loading**

Update `agreementDtoToInput()` and `agreementDtoToWizardState()` to fall back to the snapshot ID. When loading party options, retain the current `selectedContactId` for a saved Service Agreement. Update `getRequiredPartyErrors()` and `handleGenerate()` so a persisted Service Agreement snapshot satisfies only the contact requirement; director/shareholder checks and all standard-template behavior remain unchanged.

- [ ] **Step 7: Run both Task 1 suites and verify GREEN**

```powershell
npx.cmd vitest run __tests__/services/service-agreement-draft.service.test.ts __tests__/components/document-generation-wizard.test.tsx
```

Expected: both files pass and the new regressions fail if snapshot reuse or the client exemption is removed.

---

### Task 2: Make the Review transition failure-safe and resumable

**Files:**
- Modify: `src/components/documents/document-generation-wizard.tsx`
- Test: `__tests__/components/document-generation-wizard.test.tsx`
- Test: `__tests__/browser/service-agreement-generation.browser.test.tsx`

**Interfaces:**
- The first save from Agreement details persists `currentStep: 2` and relational identities.
- The second save is the only operation that persists `currentStep: 3`, and it includes non-empty `previewContent`.
- A resumed Service Agreement state at step 3 without `previewContent` or `editedContent` normalizes to step 2.

- [ ] **Step 1: Add failing unit regressions for preview and second-save failures**

Add two tests with ordered `onSaveDraft` responses. For preview failure, make `/preview` return a non-OK response. For second-save failure, return a preview and reject the second `onSaveDraft`. Assert the first save used step 2, Review was not entered, and the error text is visible.

```ts
expect(onSaveDraft).toHaveBeenNthCalledWith(
  1,
  saved.id,
  expect.objectContaining({ currentStep: 2 }),
);
expect(screen.queryByLabelText('Document content')).not.toBeInTheDocument();
expect(await screen.findByRole('alert')).toHaveTextContent('Preview unavailable');
```

Add a resume test whose state has `currentStep: 3`, `previewContent: null`, and `editedContent: null`; assert Agreement details is displayed.

- [ ] **Step 2: Run the unit suite and verify RED**

```powershell
npx.cmd vitest run __tests__/components/document-generation-wizard.test.tsx
```

Expected: FAIL because the first save currently persists step 3 and failures are not caught by the transition branch.

- [ ] **Step 3: Implement the ordered transition and error boundary**

Change the first save override to `currentStep: 2`. Wrap both saves and preview in `try/catch/finally`; in `catch`, set the existing error state from the thrown error. Apply the first saved envelope for identity reconciliation, but enter step 3 only after the preview-bearing save succeeds.

During initial session hydration, compute:

```ts
const hasSavedReviewContent = Boolean(draft.editedContent || draft.previewContent);
const safeRestoredStep = selectedTemplate.compositionType === 'SERVICE_AGREEMENT'
  && restoredStep === 3
  && !hasSavedReviewContent
    ? 2
    : restoredStep;
```

Use `safeRestoredStep` for pending eligibility and final step restoration.

- [ ] **Step 4: Add browser coverage for a failed preview followed by successful retry**

Drive the real four-step wizard. Make the first preview call fail, assert Agreement details and the error remain visible, then make the retry succeed and assert Review contains the generated preview. This protects both failure safety and recovery.

- [ ] **Step 5: Run Task 2 unit and browser suites and verify GREEN**

```powershell
npx.cmd vitest run __tests__/components/document-generation-wizard.test.tsx
npx.cmd vitest run --config vitest.browser.config.ts __tests__/browser/service-agreement-generation.browser.test.tsx
```

Expected: both commands exit 0.

---

### Task 3: Enforce composition/relation consistency on save and generation

**Files:**
- Modify: `src/lib/validations/generated-document.ts`
- Modify: `src/services/document-generation-session.service.ts`
- Modify: `src/services/document-generator.service.ts`
- Modify: `src/components/documents/document-generation-wizard.tsx`
- Modify: `src/app/(dashboard)/generated-documents/generate/page.tsx`
- Test: `__tests__/services/document-generation-session.service.test.ts`
- Test: `__tests__/services/document-generator.service.test.ts`
- Test: `__tests__/components/document-generation-wizard.test.tsx`

**Interfaces:**
- Add `discardServiceAgreement?: boolean` to `createDocumentFromTemplateSchema`, `GenerateDocumentData`, and the generation request.
- A standard session may carry its existing `serviceAgreementId` only when `discardServiceAgreement === true`.
- Both update and generate query an attached agreement independently of target composition.

- [ ] **Step 1: Add failing session-service regressions**

Add tests for:

1. standard save with an attached DRAFT agreement and `discardServiceAgreement: true` deletes it transactionally and persists `serviceAgreementId: null`;
2. SA save with an attached agreement but null/mismatched state ID is rejected instead of hiding the relation;
3. a non-DRAFT attached agreement is never discarded.

The transaction mock must expose the same `serviceAgreement.findUnique/delete` and `generatedDocument.update` methods used by production code.

- [ ] **Step 2: Run the session suite and verify RED**

```powershell
npx.cmd vitest run __tests__/services/document-generation-session.service.test.ts
```

Expected: the confirmed standard save is rejected during reference validation, and the SA null-ID case updates metadata without detecting the relation.

- [ ] **Step 3: Query and validate the attached relation for every composition**

Load the relation immediately after reference validation:

```ts
const attachedAgreement = await prisma.serviceAgreement.findUnique({
  where: { generatedDocumentId: id },
  select: { id: true, status: true },
});
```

Permit standard `serviceAgreementId` only with explicit discard. Require DRAFT status before deletion. For SA targets, reject a supplied ID that differs from the relation and reject attempts to persist a null ID while an attached relation exists and no replacement agreement input is supplied. Keep deletion and generated-document metadata update in one transaction.

- [ ] **Step 4: Add failing standard-generation regressions**

In the document-generator suite, cover an existing document draft with an attached DRAFT agreement:

- without `discardServiceAgreement`, standard generation rejects before updating content;
- with `discardServiceAgreement`, the relation is deleted in the same transaction as the document update;
- an EFFECTIVE/CANCELLED relation is rejected.

- [ ] **Step 5: Run the generator suite and verify RED**

```powershell
npx.cmd vitest run __tests__/services/document-generator.service.test.ts
```

Expected: standard generation currently ignores the attached relation when loading `linkedAgreement`.

- [ ] **Step 6: Implement confirmed discard during generation**

Extend the Zod and client request contracts. In `createDocumentFromTemplate()`, query the attached relation whenever `draftId` is present. For standard composition, reject unless explicit discard is supplied and the relation is DRAFT. Wrap relation deletion and the existing generated-document update in `prisma.$transaction`; create-new-document behavior remains unchanged.

- [ ] **Step 7: Add a failing wizard regression for SA to standard to SA before save**

Start from a saved Service Agreement, confirm a switch to standard, switch back before saving, then save. Assert the request still includes the original agreement ID/input and omits discard. Add the standard-generation path and assert it sends discard intent but not `serviceAgreementId`.

- [ ] **Step 8: Preserve client agreement state until discard succeeds**

On a confirmed switch to standard, set only `shouldDiscardServiceAgreement` and clear preview/editor fields; retain `serviceAgreementId`, pinned items, and structured agreement state. Switching back to SA clears the pending flag and restores use of retained state. `serviceAgreementInput` remains omitted while the selected composition is standard. Send `serviceAgreementId` only for SA generation and `discardServiceAgreement` only for a pending standard discard. A successful save/generate envelope clears retained agreement state.

- [ ] **Step 9: Run all Task 3 suites and verify GREEN**

```powershell
npx.cmd vitest run __tests__/services/document-generation-session.service.test.ts __tests__/services/document-generator.service.test.ts __tests__/components/document-generation-wizard.test.tsx
```

Expected: all three files pass.

---

### Task 4: Confirm destructive primary-company changes

**Files:**
- Modify: `src/components/documents/document-generation-wizard.tsx`
- Test: `__tests__/components/document-generation-wizard.test.tsx`
- Test: `__tests__/browser/service-agreement-generation.browser.test.tsx`

**Interfaces:**
- Introduce a local pure calculation returning `{ serviceAssignments: number; feeLines: number }` for the entity IDs that will be removed.
- Use one confirmation-message formatter for primary-company changes and additional-entity removals.

- [ ] **Step 1: Add failing unit tests for cancel and confirm**

Resume a two-entity agreement whose items and fees target both companies. For cancellation, make `window.confirm` return false and assert the selected company, entity checkboxes, and fee data remain unchanged. For confirmation, return true and assert the new primary remains while removed assignments/fees disappear.

- [ ] **Step 2: Run the wizard suite and verify RED**

```powershell
npx.cmd vitest run __tests__/components/document-generation-wizard.test.tsx
```

Expected: cancellation fails because `CompanySelector.onSelect` mutates state without consulting the confirmation path.

- [ ] **Step 3: Centralize impact calculation and guard company selection**

Before any company-selection state mutation, calculate removals using the prospective primary ID:

```ts
const retained = new Set(company ? [company.id] : []);
const serviceAssignments = serviceAgreement.items.reduce(
  (count, item) => count + item.entityIds.filter((id) => !retained.has(id)).length,
  0,
);
const feeLines = serviceAgreement.items.reduce(
  (count, item) => count + item.feeLines.filter((fee) => !retained.has(fee.companyId)).length,
  0,
);
```

If either count is non-zero, confirm before clearing party, agreement, preview, or editor state. Reuse the same formatter from `onBeforeEntityRemove`.

- [ ] **Step 4: Add browser coverage for cancel then confirm**

Drive a resumed two-entity Setup screen. Cancel the first primary-company change and assert the old selection remains; confirm the second and assert the wizard reflects the new primary and removed entity-specific data.

- [ ] **Step 5: Run Task 4 unit and browser suites and verify GREEN**

```powershell
npx.cmd vitest run __tests__/components/document-generation-wizard.test.tsx
npx.cmd vitest run --config vitest.browser.config.ts __tests__/browser/service-agreement-generation.browser.test.tsx
```

Expected: both commands exit 0.

---

### Task 5: Complete the locally available PDF release gate

**Files:**
- Update: `docs/superpowers/plans/2026-07-30-service-agreement-generation-review.md`
- Create only when a real export succeeds: `output/pdf/service-agreement-two-entity-review.pdf`
- Temporary renders: `tmp/pdfs/service-agreement-two-entity-review/`

**Interfaces:**
- Use `npm.cmd run db:seed-service-agreement -- --tenantId <uuid> --userId <uuid>` only after identifying a local development tenant and active user without exposing personal/legal content.
- The final artifact must contain two entities, both supplied service variants, and different entity-specific fees.

- [ ] **Step 1: Discover whether the local development database and export prerequisites are available**

Run read-only checks for configured database connectivity, an active development tenant/user, and the existing document-export entry point. Do not print passwords, legal content, contact details, or source PDF data.

- [ ] **Step 2: Seed and generate only if prerequisites are present**

Seed the inactive bundle for the selected development tenant. Obtain explicit content approval before activating the template. Create the two-entity/two-service draft through the application/service boundary, generate the document, and export the PDF through the existing export implementation.

- [ ] **Step 3: Render and inspect every page**

Use Poppler to render the final PDF:

```powershell
pdftoppm -png output/pdf/service-agreement-two-entity-review.pdf tmp/pdfs/service-agreement-two-entity-review/page
```

Inspect every rendered page for the exact Task 9 checklist: primary company/PIC correctness, Terms continuity, SOW order/page breaks, entity-labelled fee rows, formatting, signing locations, Appendix 3 numbering/UEN snapshots, and absence of sample signatures, OpenSign identifiers, unresolved placeholders, clipping, or overlap.

- [ ] **Step 4: Record the gate result honestly**

If the artifact passes and has explicit content approval, update the review document with the artifact path and inspection result. If credentials, tenant data, approval, or export infrastructure are unavailable, record the exact external dependency and keep `SAG-REV2-009` partial; do not synthesize or approve substitute content.

---

### Task 6: Run full verification and update the third-round review status

**Files:**
- Update: `docs/superpowers/plans/2026-07-30-service-agreement-generation-review.md`

**Interfaces:**
- The review document is the durable status record for SAG-REV2-001 through SAG-REV2-009.

- [ ] **Step 1: Run the complete focused test command**

```powershell
npx.cmd vitest run __tests__/api/service-agreement-generation-routes.test.ts __tests__/api/generated-document-generation-sessions-route.test.ts __tests__/lib/service-agreement-validation.test.ts __tests__/services/service-agreement-draft.service.test.ts __tests__/services/service-agreement-renderer.test.ts __tests__/services/service-agreement-schema.test.ts __tests__/services/service-agreement-seed-content.test.ts __tests__/services/document-generation-session.service.test.ts __tests__/services/document-generator.service.test.ts __tests__/services/document-validation.test.ts __tests__/components/document-generation-wizard.test.tsx
```

- [ ] **Step 2: Run Chromium verification**

```powershell
npx.cmd vitest run --config vitest.browser.config.ts __tests__/browser/service-agreement-generation.browser.test.tsx
```

- [ ] **Step 3: Run production and diff gates**

```powershell
npm.cmd run build
git diff --check HEAD
git check-ignore -v tmp/pdfs/service-agreement-source/page-01.png
```

- [ ] **Step 4: Update the review document from fresh evidence**

Append a fix-round section containing exact test counts, build result, per-finding status, and any remaining PDF approval dependency. Mark Stage 2 acceptable only when no P0/P1 code findings remain and the prescribed PDF gate is complete.

- [ ] **Step 5: Review the final diff without staging**

```powershell
git diff -- docs/superpowers/specs/2026-08-01-service-agreement-third-round-fixes-design.md docs/superpowers/plans/2026-08-01-service-agreement-third-round-fixes.md src/services/service-agreement/draft.service.ts src/services/document-generation-session.service.ts src/services/document-generator.service.ts src/lib/validations/generated-document.ts src/components/documents/document-generation-wizard.tsx 'src/app/(dashboard)/generated-documents/generate/page.tsx' __tests__/services/service-agreement-draft.service.test.ts __tests__/services/document-generation-session.service.test.ts __tests__/services/document-generator.service.test.ts __tests__/components/document-generation-wizard.test.tsx __tests__/browser/service-agreement-generation.browser.test.tsx docs/superpowers/plans/2026-07-30-service-agreement-generation-review.md
```

Expected: only scoped fixes, tests, design/plan documentation, and truthful review status changes are present.
