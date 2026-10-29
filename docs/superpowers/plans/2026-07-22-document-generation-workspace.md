# Document Generation Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five-step wizard with an accessible three-stage adaptive workspace.

**Architecture:** Keep `DocumentGenerationWizard` as the state/API orchestrator, extract selection components and pure stage mapping, and preserve current API and draft schemas.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-22-document-generation-creation-workspace-redesign.md` and `docs/guides/DESIGN_GUIDELINE.md`.
- Preserve payloads, validation, searches, draft save/restore, preview editing, letterhead, and unsaved-navigation behavior.
- Add no dependencies or API/database schema changes.
- Map persisted steps 0-4 into new stages 0-2.
- Use radio cards for singular parties and checkbox cards for general contacts.
- Use focused tests during implementation; run the full suite only after all implementation tasks are complete.
- Verify 320px, standard desktop, and 1920px-wide layouts.

---

## File Structure

- Create `src/components/documents/document-generation-stage.ts` for pure stage definitions and legacy mapping.
- Create `src/components/documents/document-party-choice-list.tsx` for searchable radio-card lists.
- Create `src/components/documents/document-contact-choice-list.tsx` for searchable checkbox-card lists.
- Modify `src/components/documents/document-generation-wizard.tsx` for three-stage orchestration and layout.
- Modify `src/app/(dashboard)/generated-documents/generate/page.tsx` for the responsive route shell.
- Add matching tests under `__tests__/components/`.

### Task 1: Add three-stage compatibility mapping

**Files:**
- Create: `src/components/documents/document-generation-stage.ts`
- Create: `__tests__/components/document-generation-stage.test.ts`

**Interfaces:** Produces `DOCUMENT_GENERATION_STAGES`, `DocumentGenerationStageIndex`, and `normalizeDocumentGenerationStage(step: number)`.

- [ ] **Step 1: Write the failing mapping test**

```ts
import { describe, expect, it } from 'vitest';
import { DOCUMENT_GENERATION_STAGES, normalizeDocumentGenerationStage } from '@/components/documents/document-generation-stage';

describe('document generation stages', () => {
  it('defines Setup, Details, and Review & Generate', () => {
    expect(DOCUMENT_GENERATION_STAGES.map((stage) => stage.label)).toEqual(['Setup', 'Details', 'Review & Generate']);
  });

  it.each([[0, 0], [1, 0], [2, 1], [3, 1], [4, 2], [-1, 0], [99, 2]])(
    'maps persisted step %s to stage %s',
    (persisted, expected) => expect(normalizeDocumentGenerationStage(persisted)).toBe(expected),
  );
});
```

- [ ] **Step 2: Run focused RED check**

Run: `npm.cmd run test:run -- __tests__/components/document-generation-stage.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the mapping**

```ts
import type { Step } from '@/components/ui/stepper';

export const DOCUMENT_GENERATION_STAGES = [
  { id: 'setup', label: 'Setup' },
  { id: 'details', label: 'Details' },
  { id: 'review', label: 'Review & Generate' },
] as const satisfies readonly Step[];

export type DocumentGenerationStageIndex = 0 | 1 | 2;

export function normalizeDocumentGenerationStage(step: number): DocumentGenerationStageIndex {
  if (!Number.isFinite(step) || step <= 1) return 0;
  if (step <= 3) return 1;
  return 2;
}
```

- [ ] **Step 4: Run focused GREEN check**

Run: `npm.cmd run test:run -- __tests__/components/document-generation-stage.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit stage compatibility**

Run: `git add src/components/documents/document-generation-stage.ts __tests__/components/document-generation-stage.test.ts` then `git commit -m "feat(documents): define streamlined generation stages"`.

### Task 2: Build the searchable party radio-card list

**Files:**
- Create: `src/components/documents/document-party-choice-list.tsx`
- Create: `__tests__/components/document-party-choice-list.test.tsx`

**Interfaces:** Consumes `DocumentParty`; produces `DocumentPartyChoiceList` with the current party selector's `id`, `label`, `options`, `value`, `onChange`, `isLoading`, `error`, `onRetry`, and `required` contract.

- [ ] **Step 1: Write failing radio semantics tests**

```tsx
const options = [
  { id: 'one', contactId: 'c1', name: 'Alice Tan', detail: 'Director', email: 'alice@example.com', phone: null, address: { full: null, letter: null } },
  { id: 'two', contactId: 'c2', name: 'Ben Lim', detail: 'Director', email: 'ben@example.com', phone: null, address: { full: null, letter: null } },
];

it('selects one party through native radio semantics', () => {
  const onChange = vi.fn();
  render(<DocumentPartyChoiceList id="director" label="Director" options={options} value="" onChange={onChange} isLoading={false} required />);
  fireEvent.click(screen.getByRole('radio', { name: /Alice Tan/ }));
  expect(onChange).toHaveBeenCalledWith('one');
});

it('retains the selected row while filtering', () => {
  render(<DocumentPartyChoiceList id="director" label="Director" options={options} value="one" onChange={vi.fn()} isLoading={false} />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search director' }), { target: { value: 'Ben' } });
  expect(screen.getByRole('radio', { name: /Alice Tan/ })).toBeVisible();
  expect(screen.getByRole('radio', { name: /Ben Lim/ })).toBeVisible();
});
```

- [ ] **Step 2: Run focused RED check**

Run: `npm.cmd run test:run -- __tests__/components/document-party-choice-list.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement native radio cards**

Use a labeled `fieldset`, explicit search label, loading/error/retry/empty/no-match states, and `<input type="radio">` rows. Show name plus available detail, email, and phone. Keep the selected option at the top when it does not match the query. Use Oak selection and `min-h-11` touch targets. Preserve the retry button name `Retry party options`.

- [ ] **Step 4: Run focused GREEN check**

Run: `npm.cmd run test:run -- __tests__/components/document-party-choice-list.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the party selector**

Run: `git add src/components/documents/document-party-choice-list.tsx __tests__/components/document-party-choice-list.test.tsx` then `git commit -m "feat(documents): add party radio card selector"`.

### Task 3: Build the searchable contact checkbox-card list

**Files:**
- Create: `src/components/documents/document-contact-choice-list.tsx`
- Create: `__tests__/components/document-contact-choice-list.test.tsx`

**Interfaces:** Move the shared `DocumentContact` interface into this file, re-export it from the wizard, and produce `DocumentContactChoiceList({ contacts, selected, onChange, onSearch, isLoading })`.

- [ ] **Step 1: Write failing checkbox behavior tests**

```tsx
const contacts = [
  { id: 'one', fullName: 'Jane Tan', email: 'jane@example.com', phone: null, designation: 'Manager' },
  { id: 'two', fullName: 'Ray Lim', email: 'ray@example.com', phone: null, designation: 'Secretary' },
];

it('adds and removes contacts through native checkboxes', () => {
  const onChange = vi.fn();
  const { rerender } = render(<DocumentContactChoiceList contacts={contacts} selected={[]} onChange={onChange} />);
  fireEvent.click(screen.getByRole('checkbox', { name: /Jane Tan/ }));
  expect(onChange).toHaveBeenCalledWith([contacts[0]]);
  rerender(<DocumentContactChoiceList contacts={contacts} selected={[contacts[0]]} onChange={onChange} />);
  fireEvent.click(screen.getByRole('checkbox', { name: /Jane Tan/ }));
  expect(onChange).toHaveBeenLastCalledWith([]);
});

it('shows selected count and clears all', () => {
  const onChange = vi.fn();
  render(<DocumentContactChoiceList contacts={contacts} selected={contacts} onChange={onChange} />);
  expect(screen.getByText('2 selected')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear all contacts' }));
  expect(onChange).toHaveBeenCalledWith([]);
});
```

- [ ] **Step 2: Run focused RED check**

Run: `npm.cmd run test:run -- __tests__/components/document-contact-choice-list.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement native checkbox cards**

Render search, selected count, Clear all, loading, empty, and no-match states. Keep selected contacts visible while filtering and call `onSearch` as the query changes. Show name, designation, email, and phone with Oak selected styling and 44px mobile targets.

- [ ] **Step 4: Run focused GREEN check**

Run: `npm.cmd run test:run -- __tests__/components/document-contact-choice-list.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the contact selector**

Run: `git add src/components/documents/document-contact-choice-list.tsx __tests__/components/document-contact-choice-list.test.tsx` then `git commit -m "feat(documents): add contact checkbox card selector"`.

### Task 4: Reshape the wizard into Setup, Details, and Review

**Files:**
- Modify: `src/components/documents/document-generation-wizard.tsx`
- Modify: `__tests__/components/document-generation-wizard.test.tsx`
- Modify: `__tests__/components/document-generation-wizard-source.test.ts`

**Interfaces:** Consume Tasks 1-3. Preserve `GenerationWizardProps`, `GenerateDocumentData`, `GeneratedDocumentResult`, `DocumentContact` re-export, callback signatures, and payloads.

- [ ] **Step 1: Add failing workflow tests**

```tsx
it('renders exactly the approved three stages', () => {
  render(<DocumentGenerationWizard templates={[template]} companies={[]} onGenerate={vi.fn()} />);
  expect(screen.getByRole('navigation', { name: 'Progress' })).toHaveTextContent('SetupDetailsReview & Generate');
  expect(screen.queryByText('People')).not.toBeInTheDocument();
  expect(screen.queryByText('Custom Fields')).not.toBeInTheDocument();
});

it('restores legacy edit drafts into Review & Generate', async () => {
  render(<DocumentGenerationWizard templates={[template]} companies={[]} initialSession={generationSession({ currentStep: 4, previewContent: '<p>Saved preview</p>' })} onGenerate={vi.fn()} />);
  expect(await screen.findByLabelText('Document content')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Generate Document' })).toBeVisible();
});

it('uses radio cards for singular parties and checkbox cards for contacts', async () => {
  mockPartyFetch();
  const selectedTemplate = { ...template, content: '{{selectedDirector.name}}{{contact.name}}', placeholders: [] };
  render(<DocumentGenerationWizard templates={[selectedTemplate]} companies={[company]} contacts={contacts} onGenerate={vi.fn()} />);
  fireEvent.click(screen.getAllByText('Resolution').at(-1)!);
  fireEvent.click(screen.getByText(company.name));
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Details' }));
  expect(await screen.findByRole('radio', { name: /Alice/ })).toBeVisible();
  expect(screen.getByRole('checkbox', { name: /Jane Tan/ })).toBeVisible();
});
```

Update existing tests so Setup makes template/company choices before one `Continue to Details`, Details completes party/contact/custom inputs before one `Continue to Review`, and generation remains in Review.

- [ ] **Step 2: Run focused RED check**

Run: `npm.cmd run test:run -- __tests__/components/document-generation-wizard.test.tsx __tests__/components/document-generation-wizard-source.test.ts`

Expected: FAIL because the five-stage flow and dropdown parties remain.

- [ ] **Step 3: Replace stage and restore logic**

Import `DOCUMENT_GENERATION_STAGES` and `normalizeDocumentGenerationStage`. Rename `currentStep` presentation state to `currentStage`, normalize restored indices, and save only 0-2. Retain the eligibility gate: unresolved restored party choices move Review drafts to Details and invalidate dependent preview/edit content.

- [ ] **Step 4: Compose Setup and Details**

Render Setup with bounded Template and Company sections. Render Details with only template-required singular parties/general contacts, then title, custom fields, and letterhead. Replace the inline party/contact selector implementations with Tasks 2-3 while preserving data loading, abort/race handling, validation messages, and selection clearing semantics.

- [ ] **Step 5: Compose Review and navigation**

Generate preview when leaving Details. Render `EditStep` as the primary Review canvas and summary/validation in a sibling `<aside>`. Add `Change setup` and `Change details` actions. Set primary labels exactly:

```ts
const primaryActionLabel = currentStage === 0
  ? 'Continue to Details'
  : currentStage === 1
    ? 'Continue to Review'
    : 'Generate Document';
```

Use a sticky bottom action bar, retain Save draft and Saved timestamp, and disable Back only on Setup.

- [ ] **Step 6: Add structural source guards**

```ts
expect(source).toContain('DocumentPartyChoiceList');
expect(source).toContain('DocumentContactChoiceList');
expect(source).toContain('sticky bottom-0');
expect(source).not.toContain("{ id: 'people', label: 'People' }");
```

- [ ] **Step 7: Run focused GREEN check**

Run: `npm.cmd run test:run -- __tests__/components/document-generation-wizard.test.tsx __tests__/components/document-generation-wizard-source.test.ts`

Expected: PASS. Do not run the full suite yet.

- [ ] **Step 8: Commit the workflow reshape**

Run: `git add src/components/documents/document-generation-wizard.tsx __tests__/components/document-generation-wizard.test.tsx __tests__/components/document-generation-wizard-source.test.ts` then `git commit -m "feat(documents): streamline document creation workspace"`.

### Task 5: Add the focused responsive route shell

**Files:**
- Modify: `src/app/(dashboard)/generated-documents/generate/page.tsx`
- Modify: `src/components/documents/document-generation-wizard.tsx`
- Modify: `__tests__/components/document-generation-wizard-source.test.ts`

**Interfaces:** Consume Task 4 and produce mobile, standard desktop, and extra-wide layouts.

- [ ] **Step 1: Add failing layout guards**

Read route and wizard source and assert:

```ts
expect(pageSource).toContain('Back to Documents');
expect(pageSource).toContain('Create document');
expect(pageSource).toContain('max-w-[1800px]');
expect(wizardSource).toContain('2xl:grid-cols');
expect(wizardSource).toContain('2xl:sticky');
expect(wizardSource).toContain('min-h-11');
```

- [ ] **Step 2: Run focused RED check**

Run: `npm.cmd run test:run -- __tests__/components/document-generation-wizard-source.test.ts`

Expected: FAIL because the focused shell and wide layout do not exist.

- [ ] **Step 3: Implement the route shell**

Use `mx-auto w-full max-w-[1800px] p-4 sm:p-6`, a compact Oak-tinted header matching Forms, a `Back to Documents` link, `Create document` title, and concise supporting copy. Keep loading/error/no-template states in the same shell.

- [ ] **Step 4: Implement responsive constraints**

Use mobile-first stacking. At `2xl`, allocate Review as `minmax(0,1fr)` plus a 320-384px sticky sidebar. Keep text/search fields at `max-w-xl`; avoid page-level horizontal scrolling; use `min-h-11` for custom mobile controls. Setup and Details may use wide contextual rails but must not stretch form fields.

- [ ] **Step 5: Run focused GREEN check**

Run: `npm.cmd run test:run -- __tests__/components/document-generation-wizard-source.test.ts __tests__/components/document-generation-wizard.test.tsx`

Expected: PASS. Do not run the full suite yet.

- [ ] **Step 6: Commit the responsive shell**

Run: `git add "src/app/(dashboard)/generated-documents/generate/page.tsx" src/components/documents/document-generation-wizard.tsx __tests__/components/document-generation-wizard-source.test.ts` then `git commit -m "feat(documents): add responsive generation workspace shell"`.

### Task 6: Run the single final full verification phase

**Files:** Modify only implementation files above when verification exposes a defect.

- [ ] **Step 1: Run the complete test suite once implementation is finished**

Run: `npm.cmd run test:run`

Expected: the full Vitest suite passes with no unhandled errors. This is the first full-suite run for this implementation.

- [ ] **Step 2: Run static checks**

Run: `npx.cmd tsc --noEmit --pretty false`

Expected: exit 0 with no TypeScript errors.

Run: `npx.cmd eslint "src/components/documents/document-generation-*.tsx" "src/components/documents/document-generation-stage.ts" "src/components/documents/document-*-choice-list.tsx" "src/app/(dashboard)/generated-documents/generate/page.tsx" --max-warnings=0`

Expected: exit 0 with no warnings.

- [ ] **Step 3: Run the production build**

Run: `npm.cmd run build`

Expected: Next.js production build completes successfully.

- [ ] **Step 4: Verify the core workflow in the in-app browser**

Verify template/company selection, singular radio selection, general-contact checkbox selection and Clear all, custom data, Review editing, revising prior stages without unrelated data loss, draft saving, generation, and legacy draft restoration. Confirm no relevant console errors.

- [ ] **Step 5: Verify responsive layouts**

Check 320x800, 1280x900, and 1920x1080. Capture mobile and extra-wide screenshots. Confirm no horizontal overflow, 44px mobile targets, bounded field widths, unobscured sticky actions, and Review's dedicated wide-screen sidebar.

- [ ] **Step 6: Perform final visual inspection**

Use `view_image` on both screenshots. Compare against the approved text spec and Forms/E-signing references for copy, hierarchy, typography, Oak palette, borders/radii, spacing, pane allocation, and control semantics. Fix every material mismatch, then rerun only the checks affected by the fix; if production code changed after the full suite, rerun the full suite once more before completion.
