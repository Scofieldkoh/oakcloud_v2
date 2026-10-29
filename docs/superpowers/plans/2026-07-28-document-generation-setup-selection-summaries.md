# Document Generation Setup Selection Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the document-generation header, keep the final step label on one line, and show the active template and company in compact Setup summaries.

**Architecture:** Preserve the existing page shell, wizard state, selectors, and payload behavior. Add presentation-only selected-value strips inside the two Setup panels, remove only the requested header copy, and make the shared step label container size to its content.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Lucide React, Vitest, Testing Library.

## Global Constraints

- Follow `docs/guides/DESIGN_GUIDELINE.md` and the existing Oakcloud token system.
- Preserve all current uncommitted work in the page, wizard, and tests.
- Do not change document-generation state, persistence, validation, or payload behavior.
- The task header contains only the back link and `Create document` title.
- `Review & Generate` remains on one line at supported viewport widths.
- Selected template and company summaries update immediately from existing wizard state.

---

### Task 1: Header and Stepper Copy Layout

**Files:**
- Modify: `src/app/(dashboard)/generated-documents/generate/page.tsx:327-350`
- Modify: `src/components/ui/stepper.tsx:46-58`

**Interfaces:**
- Consumes: Existing `GenerateDocumentPage` markup and `Stepper({ steps, currentStep, onStepClick, className })`.
- Produces: A header without the two requested subtext blocks and step labels rendered with `whitespace-nowrap`.

- [ ] **Step 1: Record the visual failing case**

Use the supplied 1432px-wide screenshot as the failing visual case: it shows
all three unwanted subtexts and wraps `Review & Generate` onto two lines.

- [ ] **Step 2: Implement the minimal header and stepper changes**

Remove the subtitle paragraph and right-side helper-copy container from the page header. Change the step label wrapper from fixed `w-16 sm:w-20` sizing to content-safe sizing:

```tsx
<div className="mt-2 min-w-16 px-1 text-center sm:min-w-20">
  <span className="block whitespace-nowrap text-2xs font-medium leading-tight sm:text-xs">
    {step.label}
  </span>
</div>
```

- [ ] **Step 3: Verify the rendered header and stepper**

At desktop and mobile widths, confirm that the unwanted copy is absent and
`Review & Generate` remains on one line without horizontal overflow.

### Task 2: Setup Selected-Value Strips

**Files:**
- Modify: `src/components/documents/document-generation-wizard.tsx:1304-1364`
- Test: `__tests__/components/document-generation-wizard.test.tsx`

**Interfaces:**
- Consumes: `state.selectedTemplate: DocumentTemplate | null` and `state.selectedCompany: Company | null`.
- Produces: Two presentation-only summary strips with accessible labels `Selected template` and `Selected company`.

- [ ] **Step 1: Write the failing component test**

```tsx
render(
  <DocumentGenerationWizard
    templates={[template]}
    companies={[company]}
    onGenerate={vi.fn()}
  />,
);

expect(screen.getByText('Selected template')).toBeVisible();
expect(screen.getByText('No template selected')).toBeVisible();
expect(screen.getByText('Selected company')).toBeVisible();
expect(screen.getAllByText('No company selected')).not.toHaveLength(0);

fireEvent.click(screen.getAllByText(template.name).at(-1)!);
fireEvent.click(screen.getByText(company.name));

expect(screen.queryByText('No template selected')).not.toBeInTheDocument();
expect(screen.getAllByText(template.name)).toHaveLength(2);
expect(screen.getAllByText(company.name)).toHaveLength(2);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx.cmd vitest run __tests__/components/document-generation-wizard.test.tsx`

Expected: FAIL because the selected-value labels and template empty state do not exist.

- [ ] **Step 3: Add the compact summaries**

Add matching strips below each Setup panel heading. Reuse `FileText` and `Building2`, existing background/border/text tokens, and `min-w-0` plus `truncate` for long names.

Template values:

```tsx
state.selectedTemplate?.name || 'No template selected'
state.selectedTemplate?.category || 'Choose a template below'
```

Company values:

```tsx
state.selectedCompany?.name || 'No company selected'
state.selectedCompany?.uen || 'Generate without company context'
```

- [ ] **Step 4: Run focused component tests**

Run: `npx.cmd vitest run __tests__/components/document-generation-wizard.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run static checks**

Run: `npx.cmd eslint src/app/(dashboard)/generated-documents/generate/page.tsx src/components/documents/document-generation-wizard.tsx src/components/ui/stepper.tsx`

Expected: PASS with no new warnings or errors.

- [ ] **Step 6: Verify the rendered screen**

Start the existing development server, open `/generated-documents/generate`, and verify:

- The three removed strings are absent.
- `Review & Generate` stays on one line.
- Both summary strips show empty values before selection.
- Both summaries update immediately after choosing a template and company.
- Long values truncate without horizontal overflow.
- The Setup layout remains usable at desktop and mobile widths.
