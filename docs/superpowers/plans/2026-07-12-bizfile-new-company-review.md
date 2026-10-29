# BizFile New-Company Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the read-only new-company BizFile preview with a complete, validated editor that saves the user's corrected extraction.

**Architecture:** Keep upload/extraction and the existing-company diff flow in the page, but move new-company review into focused components backed by a typed draft/validation module. Share one Zod schema between client validation and the confirm route; the route persists and processes the submitted normalized draft instead of the stale extraction snapshot.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Zod 3, Vitest, Testing Library, Vitest Browser with Playwright.

## Global Constraints

- Scope is the new-company preview only; the existing-company update/diff preview must remain behaviorally unchanged.
- Represent every field in `ExtractedBizFileData`, including blank optional fields and groups.
- Repeating former-name, share-capital, officer, shareholder, and charge records support add, duplicate, remove, and session-local undo.
- Keep the BizFile visible beside the editor on desktop and use document/review tabs at narrow widths.
- Preserve upload, cancel, reset, conflict handling, `Ctrl+Backspace`, `Ctrl+S`, light/dark mode, and the Oakcloud compact design system.
- Server validation and normalization are authoritative; malformed client data must never reach `processBizFileExtraction`.
- Do not add dependencies or redesign the existing-company diff flow.

## File Structure

- Create `src/lib/validations/bizfile-review.ts`: shared Zod request schema, normalization, section metadata, issue types, and validation helpers.
- Create `src/components/companies/bizfile-review/bizfile-review-fields.tsx`: accessible scalar field primitives used by review sections.
- Create `src/components/companies/bizfile-review/repeating-record-editor.tsx`: common row container with add, duplicate, remove, and undo behavior.
- Create `src/components/companies/bizfile-review/bizfile-review-sections.tsx`: all ten editable schema sections.
- Create `src/components/companies/bizfile-review/bizfile-review-workspace.tsx`: draft ownership, section navigation, responsive source/review tabs, validation summary, unsaved state, and sticky footer.
- Modify `src/app/(dashboard)/companies/upload/page.tsx`: use canonical extraction type and mount the new workspace only for `step === 'preview'`.
- Modify `src/app/api/documents/[documentId]/confirm/route.ts`: parse, persist, and process submitted corrected data.
- Create `__tests__/lib/bizfile-review-validation.test.ts`: schema and section issue tests.
- Create `__tests__/components/bizfile-review-workspace.test.tsx`: field coverage and interaction tests.
- Create `__tests__/api/bizfile-confirm-route.test.ts`: corrected-payload and rejection tests.
- Create `__tests__/browser/bizfile-review.browser.test.tsx`: desktop/mobile rendered workflow and visual checks.

---

### Task 1: Shared Draft Validation and Normalization

**Files:**
- Create: `src/lib/validations/bizfile-review.ts`
- Create: `__tests__/lib/bizfile-review-validation.test.ts`

**Interfaces:**
- Consumes: `ExtractedBizFileData` from `@/services/bizfile/types` and Zod.
- Produces: `bizFileReviewSchema`, `BizFileReviewDraft`, `BizFileReviewSectionId`, `validateBizFileReview`, `issuesFromZodError`, `normalizeBizFileReviewDraft`, and `createEmptyBizFileReviewDraft`.

- [ ] **Step 1: Write failing validation tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  createEmptyBizFileReviewDraft,
  normalizeBizFileReviewDraft,
  validateBizFileReview,
} from '@/lib/validations/bizfile-review';

describe('BizFile review validation', () => {
  it('maps nested issues to sections', () => {
    const draft = createEmptyBizFileReviewDraft();
    draft.entityDetails.name = '';
    draft.shareholders = [{
      name: '', type: 'INDIVIDUAL', shareClass: '', numberOfShares: -1,
    }];
    const result = validateBizFileReview(draft);
    expect(result.isValid).toBe(false);
    expect(result.issuesBySection.entity).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'entityDetails.name' }),
    ]));
    expect(result.issuesBySection.shareholders).toHaveLength(3);
  });

  it('omits wholly blank optional groups while preserving entered values', () => {
    const draft = createEmptyBizFileReviewDraft();
    draft.entityDetails = { uen: '202626103M', name: 'Example Pte. Ltd.', entityType: 'PRIVATE_LIMITED', status: 'LIVE' };
    draft.mailingAddress = { streetName: '', postalCode: '' };
    draft.auditor = { name: '', address: '', appointmentDate: '' };
    expect(normalizeBizFileReviewDraft(draft)).toMatchObject({
      entityDetails: draft.entityDetails,
      mailingAddress: undefined,
      auditor: undefined,
    });
  });

  it('rejects invalid dates, percentages, and non-finite numbers', () => {
    const draft = createEmptyBizFileReviewDraft();
    draft.entityDetails = { uen: '202626103M', name: 'Example', entityType: 'PRIVATE_LIMITED', status: 'LIVE', incorporationDate: 'not-a-date' };
    draft.shareholders = [{ name: 'A', type: 'INDIVIDUAL', shareClass: 'ORDINARY', numberOfShares: 1, percentageHeld: 101 }];
    const paths = validateBizFileReview(draft).issues.map((issue) => issue.path);
    expect(paths).toContain('entityDetails.incorporationDate');
    expect(paths).toContain('shareholders.0.percentageHeld');
  });
});
```

- [ ] **Step 2: Run the tests and verify the module is missing**

Run: `npm test -- --run __tests__/lib/bizfile-review-validation.test.ts`

Expected: FAIL with `Cannot find module '@/lib/validations/bizfile-review'`.

- [ ] **Step 3: Implement the shared schema and helpers**

Create strict reusable primitives for ISO dates, optional trimmed strings, non-negative finite numbers, and percentages. Build a schema covering every property in `ExtractedBizFileData`. Export these exact public types and result shape:

```ts
export const BIZFILE_REVIEW_SECTIONS = [
  'entity', 'addresses', 'activities', 'capital', 'officers',
  'shareholders', 'auditor', 'compliance', 'charges', 'document',
] as const;
export type BizFileReviewSectionId = typeof BIZFILE_REVIEW_SECTIONS[number];
export type BizFileReviewDraft = ExtractedBizFileData;
export interface BizFileReviewIssue { path: string; message: string; section: BizFileReviewSectionId }
export interface BizFileReviewValidation {
  isValid: boolean;
  issues: BizFileReviewIssue[];
  issuesBySection: Record<BizFileReviewSectionId, BizFileReviewIssue[]>;
}
export function createEmptyBizFileReviewDraft(): BizFileReviewDraft;
export function validateBizFileReview(draft: BizFileReviewDraft): BizFileReviewValidation;
export function issuesFromZodError(error: z.ZodError): BizFileReviewValidation;
export function normalizeBizFileReviewDraft(draft: BizFileReviewDraft): ExtractedBizFileData;
```

Use `superRefine` to enforce valid calendar dates and section-specific required values. Map paths by their first segment (`entityDetails` to `entity`, `registeredAddress`/`mailingAddress` to `addresses`, `financialYear`/`compliance` to `compliance`, and so on). Recursively trim strings and remove optional blank objects before parsing the normalized result.

- [ ] **Step 4: Run focused validation tests**

Run: `npm test -- --run __tests__/lib/bizfile-review-validation.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit the validation layer**

```powershell
git add src/lib/validations/bizfile-review.ts __tests__/lib/bizfile-review-validation.test.ts
git commit -m "feat: validate editable BizFile review data"
```

---

### Task 2: Accessible Field and Repeating-Record Primitives

**Files:**
- Create: `src/components/companies/bizfile-review/bizfile-review-fields.tsx`
- Create: `src/components/companies/bizfile-review/repeating-record-editor.tsx`
- Create: `__tests__/components/bizfile-review-primitives.test.tsx`

**Interfaces:**
- Consumes: native input props, `BizFileReviewIssue`, and Oakcloud utility classes.
- Produces: `ReviewField`, `ReviewSelect`, `ReviewTextarea`, `ReviewCheckbox`, and generic `RepeatingRecordEditor<T>`.

- [ ] **Step 1: Write failing primitive interaction tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RepeatingRecordEditor } from '@/components/companies/bizfile-review/repeating-record-editor';

describe('RepeatingRecordEditor', () => {
  it('adds, duplicates, removes, and restores records', () => {
    const onChange = vi.fn();
    const items = [{ name: 'Alice' }];
    const { rerender } = render(
      <RepeatingRecordEditor title="Officers" items={items} onChange={onChange}
        createItem={() => ({ name: '' })} getItemLabel={(item) => item.name || 'New officer'}
        renderItem={(item) => <input aria-label="Officer name" value={item.name} readOnly />} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Alice' }));
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'Alice' }, { name: 'Alice' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    rerender(<RepeatingRecordEditor title="Officers" items={[]} onChange={onChange}
      createItem={() => ({ name: '' })} getItemLabel={(item) => item.name || 'New officer'}
      renderItem={() => null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo remove Alice' }));
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'Alice' }]);
  });
});
```

- [ ] **Step 2: Run and verify missing components**

Run: `npm test -- --run __tests__/components/bizfile-review-primitives.test.tsx`

Expected: FAIL with module resolution errors.

- [ ] **Step 3: Implement compact accessible fields and row editor**

`ReviewField`, `ReviewSelect`, and `ReviewTextarea` accept `label`, `id`, `error`, `hint`, and the matching native props. Each links the control to `${id}-error`, renders `aria-invalid`, and follows `text-xs`, `h-8`, `border-border-primary`, `focus:ring-oak-primary/30` conventions.

Implement the generic row editor with this signature:

```tsx
export interface RepeatingRecordEditorProps<T> {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  createItem: () => T;
  getItemLabel: (item: T, index: number) => string;
  renderItem: (item: T, index: number, update: (next: T) => void) => React.ReactNode;
}
export function RepeatingRecordEditor<T>(props: RepeatingRecordEditorProps<T>) { /* immutable row operations */ }
```

Store the most recently removed `{ item, index, label }` locally. Insert it back at its original index on undo. After add or duplicate, schedule focus to the new row's first focusable control. Use `Copy`, `Trash2`, `Plus`, and `Undo2` icons with descriptive accessible names.

- [ ] **Step 4: Run primitive tests**

Run: `npm test -- --run __tests__/components/bizfile-review-primitives.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit reusable review primitives**

```powershell
git add src/components/companies/bizfile-review/bizfile-review-fields.tsx src/components/companies/bizfile-review/repeating-record-editor.tsx __tests__/components/bizfile-review-primitives.test.tsx
git commit -m "feat: add BizFile review form primitives"
```

---

### Task 3: Complete Editable Section Set

**Files:**
- Create: `src/components/companies/bizfile-review/bizfile-review-sections.tsx`
- Create: `__tests__/components/bizfile-review-sections.test.tsx`

**Interfaces:**
- Consumes: `BizFileReviewDraft`, `BizFileReviewIssue[]`, field primitives, and `RepeatingRecordEditor<T>`.
- Produces: `BizFileReviewSections({ draft, onChange, activeSection, issues })` and all ten named section components.

- [ ] **Step 1: Write a failing all-fields coverage test**

Build a full fixture containing every field from `ExtractedBizFileData`, render each section, and assert labels for `Former names`, `Mailing street`, `Treasury shares`, `Identification number`, `FYE as at last AR`, `Charge holder`, and `Receipt number`. Add an edit assertion:

```tsx
fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Corrected Pte. Ltd.' } });
expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
  entityDetails: expect.objectContaining({ name: 'Corrected Pte. Ltd.' }),
}));
```

Also assert that an empty fixture still shows optional `Mailing address` and `Auditor` controls.

- [ ] **Step 2: Run and verify the section module is missing**

Run: `npm test -- --run __tests__/components/bizfile-review-sections.test.tsx`

Expected: FAIL with module resolution error.

- [ ] **Step 3: Implement all ten sections**

Implement immutable slice updates and these component exports:

```ts
export function EntitySection(...)
export function AddressesSection(...)
export function ActivitiesSection(...)
export function CapitalSection(...)
export function OfficersSection(...)
export function ShareholdersSection(...)
export function AuditorSection(...)
export function ComplianceSection(...)
export function ChargesSection(...)
export function DocumentSection(...)
```

Use native date inputs for ISO dates; selects for entity type, status, shareholder type, officer role, and identification type; numeric inputs with appropriate `min`, `max`, and `step`; and checkboxes for paid-up/treasury flags. Render former names, share capital, officers, shareholders, and charges through `RepeatingRecordEditor`. Never hide a singleton optional group merely because it is blank.

- [ ] **Step 4: Run section tests and TypeScript**

Run: `npm test -- --run __tests__/components/bizfile-review-sections.test.tsx`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 5: Commit the complete field surface**

```powershell
git add src/components/companies/bizfile-review/bizfile-review-sections.tsx __tests__/components/bizfile-review-sections.test.tsx
git commit -m "feat: edit every BizFile extraction field"
```

---

### Task 4: Review Workspace, Navigation, Validation, and Responsive Layout

**Files:**
- Create: `src/components/companies/bizfile-review/bizfile-review-workspace.tsx`
- Create: `__tests__/components/bizfile-review-workspace.test.tsx`

**Interfaces:**
- Consumes: `ExtractedBizFileData`, the validation module, sections, and a `sourcePanel: ReactNode`.
- Produces: `BizFileReviewWorkspace` and `onConfirm(correctedData)` callback behavior.

- [ ] **Step 1: Write failing workspace behavior tests**

```tsx
render(<BizFileReviewWorkspace initialData={fixture} aiMetadata={metadata}
  sourcePanel={<div>PDF source</div>} onCancel={vi.fn()} onReset={vi.fn()} onConfirm={onConfirm} />);
expect(screen.getByText('Review extracted information')).toBeVisible();
expect(screen.getByText('10 sections')).toBeVisible();
fireEvent.change(screen.getByLabelText('Company name'), { target: { value: '' } });
fireEvent.click(screen.getByRole('button', { name: 'Confirm & Save' }));
expect(onConfirm).not.toHaveBeenCalled();
expect(screen.getByText('Company name is required')).toBeVisible();
fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Corrected Pte. Ltd.' } });
fireEvent.click(screen.getByRole('button', { name: 'Confirm & Save' }));
expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ entityDetails: expect.objectContaining({ name: 'Corrected Pte. Ltd.' }) }));
```

Add tests for section error counts, narrow-layout Document/Review tabs, `Ctrl+S`, dirty `beforeunload`, and no dirty prompt before edits.

- [ ] **Step 2: Run and verify the workspace is missing**

Run: `npm test -- --run __tests__/components/bizfile-review-workspace.test.tsx`

Expected: FAIL with module resolution error.

- [ ] **Step 3: Implement draft ownership and compact workspace chrome**

Use lazy state initialization and stable top-level components:

```tsx
export interface BizFileReviewWorkspaceProps {
  initialData: ExtractedBizFileData;
  aiMetadata?: { modelUsed: string; modelName?: string; providerUsed: string; formattedCost?: string; usage?: { totalTokens: number; pagesProcessed?: number } } | null;
  sourcePanel: React.ReactNode;
  isSaving?: boolean;
  serverIssues?: BizFileReviewIssue[];
  onConfirm: (data: ExtractedBizFileData) => void | Promise<void>;
  onCancel: () => void;
  onReset: () => void;
}
```

Deep-clone `initialData` once into `draft`, derive validation during render, and compare normalized snapshots to derive `isDirty`. Register `beforeunload` only while dirty. The header shows reviewed/valid section count, issue count, and repeating-record total. The vertical desktop navigation lists all ten sections with counts and `Complete`/`Needs attention`/`Errors` text plus icons. The main editor scrolls independently and uses a sticky footer.

At `lg` and above render `ResizableSplitView`. Below `lg`, render `Document` and `Review` tabs and only display the selected panel. On invalid save, activate the first issue's section, then focus `[data-field-path="${firstIssue.path}"]`.

- [ ] **Step 4: Run workspace tests**

Run: `npm test -- --run __tests__/components/bizfile-review-workspace.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the review workspace**

```powershell
git add src/components/companies/bizfile-review/bizfile-review-workspace.tsx __tests__/components/bizfile-review-workspace.test.tsx
git commit -m "feat: add guided BizFile review workspace"
```

---

### Task 5: Confirm Corrected Data Safely on the Server

**Files:**
- Modify: `src/app/api/documents/[documentId]/confirm/route.ts`
- Create: `__tests__/api/bizfile-confirm-route.test.ts`

**Interfaces:**
- Consumes: `{ extractedData: unknown }`, `bizFileReviewSchema`, and `normalizeBizFileReviewDraft`.
- Produces: unchanged success response; validation failure response `{ error: string, issues: BizFileReviewIssue[] }` with HTTP 400.

- [ ] **Step 1: Write failing confirm-route tests**

Mock auth, `prisma.document.findUnique`, `prisma.document.update`, and `processBizFileExtraction`. Call `POST` with a corrected valid payload and assert:

```ts
expect(mockDocumentUpdate).toHaveBeenCalledWith({
  where: { id: 'doc-1' },
  data: { extractedData: expect.objectContaining({ entityDetails: expect.objectContaining({ name: 'Corrected Pte. Ltd.' }) }) },
});
expect(mockProcess).toHaveBeenCalledWith(
  'doc-1', expect.objectContaining({ entityDetails: expect.objectContaining({ name: 'Corrected Pte. Ltd.' }) }),
  'user-1', 'tenant-1', 'pending/doc.pdf', 'application/pdf'
);
```

Add a malformed request test expecting 400, field issues, no update, and no processor call. Retain tests for 404, tenant/owner 403, non-extracted 400, and idempotent completed documents.

- [ ] **Step 2: Run and observe stale document data being processed**

Run: `npm test -- --run __tests__/api/bizfile-confirm-route.test.ts`

Expected: FAIL because the current route ignores the request body and never updates `document.extractedData`.

- [ ] **Step 3: Parse, normalize, persist, and process the corrected payload**

After authorization and extraction-status checks:

```ts
const body: unknown = await request.json();
const candidate = typeof body === 'object' && body !== null && 'extractedData' in body
  ? (body as { extractedData: unknown }).extractedData
  : undefined;
const parsed = bizFileReviewSchema.safeParse(candidate);
if (!parsed.success) {
  const validation = issuesFromZodError(parsed.error);
  return NextResponse.json({ error: 'Please correct the highlighted fields', issues: validation.issues }, { status: 400 });
}
const correctedData = normalizeBizFileReviewDraft(parsed.data);
await prisma.document.update({ where: { id: documentId }, data: { extractedData: correctedData as object } });
const result = await processBizFileExtraction(documentId, correctedData, session.id, document.tenantId, document.storageKey || undefined, document.mimeType);
```

Keep the existing idempotent `COMPLETED` branch before request parsing so retries remain safe.

- [ ] **Step 4: Run API and service regression tests**

Run: `npm test -- --run __tests__/api/bizfile-confirm-route.test.ts __tests__/services/bizfile.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit corrected-data confirmation**

```powershell
git add 'src/app/api/documents/[documentId]/confirm/route.ts' __tests__/api/bizfile-confirm-route.test.ts
git commit -m "fix: save corrected BizFile review payload"
```

---

### Task 6: Integrate the Workspace into New-Company Upload

**Files:**
- Modify: `src/app/(dashboard)/companies/upload/page.tsx`
- Create: `__tests__/app/companies-upload-bizfile-review.test.tsx`

**Interfaces:**
- Consumes: `BizFileReviewWorkspace`, `ExtractedBizFileData`, and confirm API field issues.
- Produces: new-company preview integration while leaving `diff-preview` JSX and request behavior unchanged.

- [ ] **Step 1: Write a failing integration test**

Mock upload/extract responses and the document viewer. Drive upload to preview and assert that all section navigation labels render. Edit company name, click save, and inspect the final confirm request:

```ts
const confirmCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/confirm'));
expect(JSON.parse(String(confirmCall?.[1]?.body))).toMatchObject({
  extractedData: { entityDetails: { name: 'Corrected Pte. Ltd.' } },
});
```

Add a separate update-mode test asserting `Update Company Information` still renders and `/apply-update` remains the save endpoint.

- [ ] **Step 2: Run and verify the read-only preview fails expectations**

Run: `npm test -- --run __tests__/app/companies-upload-bizfile-review.test.tsx`

Expected: FAIL because the current new-company preview has no editable inputs or complete section set.

- [ ] **Step 3: Replace only the new-company preview branch**

Remove the page-local narrow `ExtractedData` interface and import `ExtractedBizFileData`. Add `serverIssues` and `isConfirming` state. Change `handleConfirm` to accept corrected data, set `isConfirming` instead of unmounting the preview through `step = 'saving'`, submit it, parse `{ issues }` on HTTP 400, and preserve the mounted workspace draft on failure. Set `step = 'complete'` only after success.

Replace only this branch:

```tsx
{step === 'preview' && extractedData && (
  <BizFileReviewWorkspace
    initialData={extractedData}
    aiMetadata={aiMetadata}
    sourcePanel={previewPanel}
    isSaving={isConfirming}
    serverIssues={serverIssues}
    onConfirm={handleConfirm}
    onReset={handleReset}
    onCancel={() => router.push('/companies')}
  />
)}
```

Do not edit the `diff-preview` markup or `handleApplyUpdate`. Update reset/extraction success paths to clear `serverIssues`.

- [ ] **Step 4: Run integration tests, related tests, and lint**

Run: `npm test -- --run __tests__/app/companies-upload-bizfile-review.test.tsx __tests__/components/bizfile-review-workspace.test.tsx __tests__/api/bizfile-confirm-route.test.ts`

Expected: PASS.

Run: `npx eslint 'src/app/(dashboard)/companies/upload/page.tsx' src/components/companies/bizfile-review src/lib/validations/bizfile-review.ts`

Expected: exit 0.

- [ ] **Step 5: Commit page integration**

```powershell
git add 'src/app/(dashboard)/companies/upload/page.tsx' __tests__/app/companies-upload-bizfile-review.test.tsx
git commit -m "feat: integrate editable BizFile new-company review"
```

---

### Task 7: Browser QA and Responsive Polish

**Files:**
- Create: `__tests__/browser/bizfile-review.browser.test.tsx`
- Modify if verification finds issues: `src/components/companies/bizfile-review/*.tsx`

**Interfaces:**
- Consumes: completed review flow.
- Produces: browser evidence and final responsive/accessibility polish. The approved design and implementation plan already document the architecture under `docs/`.

- [ ] **Step 1: Add a browser test for desktop and narrow layouts**

Mount `BizFileReviewWorkspace` with a full fixture. At 1440×900 assert source/editor coexist, edit a scalar, add and remove an officer, trigger validation, repair it, and confirm the corrected payload. At 390×844 assert Document/Review tabs switch visible content and no horizontal overflow exists:

```ts
await expect.element(screen.getByRole('tab', { name: 'Document' })).toBeVisible();
await userEvent.click(screen.getByRole('tab', { name: 'Review' }));
await expect.element(screen.getByLabelText('Company name')).toBeVisible();
expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
```

- [ ] **Step 2: Run browser tests**

Run: `npm run test:browser -- __tests__/browser/bizfile-review.browser.test.tsx`

Expected: PASS at both configured viewports.

- [ ] **Step 3: Run in-app Browser verification against the real route**

The flow under test is: `/companies/upload` → extracted new-company preview → edit scalar and repeating records → validation → corrected confirm request.

Use the installed Browser skill and verify:

1. URL and title identify the upload page.
2. DOM snapshot contains the source viewer, all ten review sections, and editable fields.
3. No Next.js/Vite error overlay appears.
4. Console has no relevant errors or warnings.
5. Desktop screenshot at native 1440×900 shows a balanced resizable split, legible density, sticky actions, and no clipping.
6. Mobile screenshot at 390×844 shows usable Document/Review tabs, stacked row fields, and no overflow.
7. `Ctrl+S`, invalid focus movement, add/remove/undo, and confirm payload behavior work.

If the real extraction service is unavailable, use an existing extracted pending document or intercept only the extraction response with the full test fixture; do not bypass the review or confirm interaction.

- [ ] **Step 4: Fix every browser mismatch and rerun focused checks**

Keep a mismatch ledger for hierarchy, field density, source visibility, sticky regions, focus visibility, row actions, mobile stacking, dark mode, and overflow. Make the smallest component/CSS corrections, reload the same Browser tab, and repeat DOM, console, interaction, and screenshot checks until no material mismatch remains.

- [ ] **Step 5: Run final verification**

Run: `npm test -- --run __tests__/lib/bizfile-review-validation.test.ts __tests__/components/bizfile-review-primitives.test.tsx __tests__/components/bizfile-review-sections.test.tsx __tests__/components/bizfile-review-workspace.test.tsx __tests__/api/bizfile-confirm-route.test.ts __tests__/app/companies-upload-bizfile-review.test.tsx __tests__/services/bizfile.test.ts`

Expected: all tests PASS.

Run: `npm run test:browser -- __tests__/browser/bizfile-review.browser.test.tsx`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: exit 0.

Run: `npx eslint 'src/app/(dashboard)/companies/upload/page.tsx' 'src/app/api/documents/[documentId]/confirm/route.ts' src/components/companies/bizfile-review src/lib/validations/bizfile-review.ts`

Expected: exit 0.

- [ ] **Step 6: Commit QA polish**

```powershell
git add __tests__/browser/bizfile-review.browser.test.tsx src/components/companies/bizfile-review
git commit -m "test: verify BizFile review workflow"
```

---

## 2026-07-14 Review Workspace Enhancement

Tasks 1-7 document the implemented baseline review workspace. Tasks 8-10 are the authoritative plan for the approved enhancement and supersede earlier task examples that show the vertical desktop section rail, extraction-summary/AI metadata copy, the `aiMetadata` workspace prop, or the former `70vh` height contract.

### Task 8: Normalize Null Optional Dates

**Files:**
- Modify: `src/lib/validations/bizfile-review.ts`
- Test: `__tests__/lib/bizfile-review-validation.test.ts`

**Interfaces:**
- Consumes: extracted optional dates that may be `string`, `null`, blank, or absent.
- Produces: one shared `optionalDate` schema that omits null/blank values and validates populated ISO calendar dates.

- [x] **Step 1: Write failing regression tests**

Add tests that place `null` in officer cessation and a representative entity date, then require valid parsing and omission:

```ts
it('accepts and omits null optional dates from extraction', () => {
  const draft = createEmptyBizFileReviewDraft();
  draft.entityDetails = {
    uen: '202626103M', name: 'Example', entityType: 'PRIVATE_LIMITED', status: 'LIVE',
    incorporationDate: null,
  } as typeof draft.entityDetails;
  draft.officers = [{ name: 'Current Director', role: 'DIRECTOR', cessationDate: null }] as typeof draft.officers;

  expect(validateBizFileReview(draft).isValid).toBe(true);
  const normalized = normalizeBizFileReviewDraft(draft);
  expect(normalized.entityDetails).not.toHaveProperty('incorporationDate');
  expect(normalized.officers?.[0]).not.toHaveProperty('cessationDate');
});

it('still rejects a populated invalid optional date', () => {
  const draft = createEmptyBizFileReviewDraft();
  draft.entityDetails = { uen: '1', name: 'X', entityType: 'PRIVATE_LIMITED', status: 'LIVE' };
  draft.officers = [{ name: 'A', role: 'DIRECTOR', cessationDate: '2026-02-30' }];
  expect(validateBizFileReview(draft).issues.map((issue) => issue.path))
    .toContain('officers.0.cessationDate');
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run __tests__/lib/bizfile-review-validation.test.ts`

Expected: the null-date test fails with an `Expected string, received null` issue.

- [x] **Step 3: Implement one reusable optional-date preprocessor**

Replace `const optionalDate = isoDate.optional()` with:

```ts
const optionalDate = z.preprocess(
  (value) => value == null || (typeof value === 'string' && value.trim() === '') ? undefined : value,
  isoDate.optional(),
);
```

Ensure the draft's recursive review type can represent extraction-time `null` values without weakening normalized `ExtractedBizFileData` output.

- [x] **Step 4: Run focused validation tests and verify GREEN**

Run: `npm test -- --run __tests__/lib/bizfile-review-validation.test.ts`

Expected: all validation tests PASS.

---

### Task 9: Compact Accessible Section Tabs and Equal-Height Layout

**Files:**
- Modify: `src/components/companies/bizfile-review/bizfile-review-workspace.tsx`
- Modify: `src/components/companies/bizfile-review/bizfile-review-sections.tsx`
- Modify: `src/app/(dashboard)/companies/upload/page.tsx`
- Test: `__tests__/components/bizfile-review-workspace.test.tsx`
- Test: `__tests__/app/companies-upload-bizfile-review.test.tsx`

**Interfaces:**
- Consumes: `activeSection`, per-section issues, visited state, and the existing source panel.
- Produces: sticky `tablist` navigation, wrapped previous/next selection, `Ctrl + <` / `Ctrl + >`, roving Arrow navigation, and equal content panels sized `min(780px, 100dvh)` with the footer outside.

- [x] **Step 1: Write failing component tests for removed copy and tabs**

Update the existing metadata test to assert the removed text is absent, and add desktop tab assertions after matching `(min-width: 1024px)`:

```tsx
expect(screen.queryByText(/10 sections/i)).not.toBeInTheDocument();
expect(screen.queryByText(/AI-extracted data may be inaccurate/i)).not.toBeInTheDocument();
expect(screen.queryByText(/model.*provider/i)).not.toBeInTheDocument();

const tablist = screen.getByRole('tablist', { name: 'Review sections' });
expect(within(tablist).getByRole('tab', { name: /Entity.*selected/i })).toHaveAttribute('aria-selected', 'true');
await user.click(screen.getByRole('button', { name: /Next section.*Ctrl \+ >/i }));
expect(screen.getByRole('tab', { name: /Addresses.*selected/i })).toHaveAttribute('aria-selected', 'true');
```

Add tests that start at Entity, navigate previous to Document, navigate next back to Entity, dispatch `Ctrl + >`, and verify the shortcut does nothing when dispatched from the Company name input. Add tab-focused Left/Right Arrow assertions for roving selection.

- [x] **Step 2: Write failing structure tests for height and footer placement**

Require stable test ids and the exact viewport cap:

```tsx
const content = screen.getByTestId('review-content-region');
expect(content.className).toContain('h-[min(780px,100dvh)]');
expect(within(content).queryByRole('contentinfo')).not.toBeInTheDocument();
expect(screen.getByRole('contentinfo')).toBeVisible();
```

Update the upload-page test to require that the workspace invocation no longer receives or depends on `aiMetadata`.

- [x] **Step 3: Run focused component tests and verify RED**

Run: `npm test -- --run __tests__/components/bizfile-review-workspace.test.tsx __tests__/app/companies-upload-bizfile-review.test.tsx`

Expected: failures show the old vertical navigation, visible metadata copy, missing section controls, and old `70vh` container.

- [x] **Step 4: Implement section-selection helpers and shortcuts**

Add a wrapped selector based on `BIZFILE_REVIEW_SECTIONS`:

```ts
const moveSection = useCallback((direction: -1 | 1) => {
  const index = BIZFILE_REVIEW_SECTIONS.indexOf(activeSection);
  const next = (index + direction + BIZFILE_REVIEW_SECTIONS.length) % BIZFILE_REVIEW_SECTIONS.length;
  selectSection(BIZFILE_REVIEW_SECTIONS[next]);
}, [activeSection, selectSection]);
```

Extend the existing keydown handler to recognize `<`/`,` and `>`/`.` with Ctrl or Command, skip editable targets, and prevent default only when navigation is handled. On a focused tab, Left/Right Arrow calls the same wrapped selector and moves focus to the selected tab.

- [x] **Step 5: Replace the desktop sidebar with sticky semantic tabs**

Render previous/next icon buttons around an overflow-x-auto `role="tablist"` strip. Each tab uses `role="tab"`, `aria-selected`, `aria-controls`, roving `tabIndex`, a concise visible label, semantic status icon, issue count when nonzero, and a ref used to `scrollIntoView({ block: 'nearest', inline: 'nearest' })` after selection. Wrap the active section in `role="tabpanel"` with the matching id and label.

Keep the current mobile Document/Review switch and section `<select>` unchanged. Make officer and other dense section grids use a container-responsive one-column fallback before the fields become cramped.

- [x] **Step 6: Separate content height from the action footer**

Move the footer outside the desktop `ResizableSplitView` content region. Apply `h-[min(780px,100dvh)]` and `min-h-0` to `data-testid="review-content-region"`, with both split children filling that same height. Keep the footer immediately below the region and preserve its save-status behavior. Remove `aiMetadata` from `BizFileReviewWorkspaceProps`, its destructuring, and the upload-page invocation.

- [x] **Step 7: Run focused component tests and verify GREEN**

Run: `npm test -- --run __tests__/components/bizfile-review-workspace.test.tsx __tests__/components/bizfile-review-sections.test.tsx __tests__/app/companies-upload-bizfile-review.test.tsx`

Expected: all focused tests PASS with no React accessibility or state-update warnings.

---

### Task 10: Responsive Browser QA and Final Verification

**Files:**
- Modify: `__tests__/browser/bizfile-review.browser.test.tsx`
- Modify if a verified mismatch exists: `src/components/companies/bizfile-review/*.tsx`

**Interfaces:**
- Consumes: the completed compact-tab review workspace.
- Produces: rendered evidence for panel sizing, navigation, responsive overflow, and the preserved edit/save workflow.

- [x] **Step 1: Extend the browser test before layout polish**

At 1440x900, assert all desktop section tabs are reachable, click Officers, use previous/next and keyboard navigation, and compare panel rectangles:

```ts
const sourceBox = document.querySelector('[data-review-source]')!.getBoundingClientRect();
const editorBox = document.querySelector('[data-review-editor]')!.getBoundingClientRect();
expect(Math.abs(sourceBox.height - editorBox.height)).toBeLessThanOrEqual(1);
expect(sourceBox.height).toBeLessThanOrEqual(window.innerHeight);
expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
```

Retain the 390x844 Document/Review switch and overflow assertions.

- [x] **Step 2: Run browser tests and capture any RED mismatch**

Run: `npm run test:browser -- __tests__/browser/bizfile-review.browser.test.tsx`

Expected before final CSS adjustments: any remaining sizing, sticky, or overflow mismatch fails with a concrete assertion.

- [x] **Step 3: Fix only evidenced responsive mismatches and rerun**

Adjust container/grid utility classes without changing the approved copy or interaction model. Re-run the same browser test until desktop and mobile assertions PASS.

- [x] **Step 4: Run final verification**

Run: `npm test -- --run __tests__/lib/bizfile-review-validation.test.ts __tests__/components/bizfile-review-primitives.test.tsx __tests__/components/bizfile-review-sections.test.tsx __tests__/components/bizfile-review-workspace.test.tsx __tests__/app/companies-upload-bizfile-review.test.tsx __tests__/api/bizfile-confirm-route.test.ts __tests__/services/bizfile.test.ts`

Run: `npm run test:browser -- __tests__/browser/bizfile-review.browser.test.tsx`

Run: `npx tsc --noEmit`

Run: `npx eslint 'src/app/(dashboard)/companies/upload/page.tsx' src/components/companies/bizfile-review src/lib/validations/bizfile-review.ts __tests__/lib/bizfile-review-validation.test.ts __tests__/components/bizfile-review-workspace.test.tsx __tests__/browser/bizfile-review.browser.test.tsx`

Run: `npm run build`

Expected: every command exits 0, all tests pass, and the production build completes.

## Final Acceptance Checklist

- Every property in `ExtractedBizFileData` has a visible editable control.
- Blank optional singleton groups can be filled.
- Former names, share classes, officers, shareholders, and charges support add, duplicate, remove, and undo.
- Section navigation reports issues and invalid save focuses the first error.
- Desktop section navigation uses sticky semantic tabs, previous/next buttons, Arrow keys, and wrapped `Ctrl + <` / `Ctrl + >` shortcuts without intercepting field input.
- Null and blank optional dates do not block saving or survive normalized output; populated invalid dates still fail validation.
- The document and review content panels are equal-height at `min(780px, 100dvh)`, with the action footer outside the measured region.
- Review summary totals, AI model/provider/cost copy, and the generic AI warning are absent.
- Confirm persists and processes the corrected draft.
- Existing-company diff preview and selective update remain unchanged.
- Desktop split and narrow Document/Review tabs pass rendered QA in light and dark modes.
- No relevant console errors, framework overlays, horizontal overflow, clipped sticky regions, or inaccessible unlabeled controls remain.
