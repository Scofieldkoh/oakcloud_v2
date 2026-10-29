# Template Editor Enter and Address Preview Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Enter-created paragraphs and caret position stable in the paginated template editor, resolve the company letter address in test preview, and wrap long placeholder examples.

**Architecture:** Preserve native browser editing and normalize duplicated flow IDs at the editor boundary before canonical serialization. Enrich resolver context with a derived company letter address when structured address fields exist, and adjust only the example text presentation in the placeholder catalog.

**Tech Stack:** React 19, TypeScript, Next.js, Vitest, Testing Library, Vitest Browser with Chromium, Tailwind CSS.

## Global Constraints

- Preserve existing uncommitted changes in `__tests__/components/template-editor/template-editor-panel.test.tsx` and `src/components/documents/template-editor/template-details-panel.tsx`.
- Do not introduce a custom Enter handler or rewrite the editing engine.
- Reuse `formatLetterAddress` for letter-address formatting.
- Follow `docs/guides/DESIGN_GUIDELINE.md` compact UI and wrapping conventions.

---

### Task 1: Stabilize Enter-created flow blocks and selection

**Files:**
- Modify: `src/components/documents/a4-pagination/model.ts`
- Modify: `src/components/documents/a4-page-editor.tsx`
- Test: `__tests__/components/a4-pagination/model.test.ts`
- Test: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Interfaces:**
- Produces: `normalizeEditedFlowIds(root: HTMLElement): void`, which assigns a fresh flow ID to every repeated `data-flow-id` within one rendered page while leaving the first occurrence unchanged.
- Consumes: `commitDocumentSurface()` calls the normalizer on each rendered page before capturing the flow selection and serializing page HTML.

- [ ] **Step 1: Write the failing model test**

Add a test that creates a page root containing two adjacent paragraphs with the same `data-flow-id`, calls `normalizeEditedFlowIds(root)`, and asserts the first ID remains `paragraph-1` while the second is present and different.

- [ ] **Step 2: Run the model test to verify RED**

Run: `npx.cmd vitest run __tests__/components/a4-pagination/model.test.ts`

Expected: FAIL because `normalizeEditedFlowIds` is not exported.

- [ ] **Step 3: Implement the flow-ID normalizer**

Add to `model.ts`:

```ts
export function normalizeEditedFlowIds(root: HTMLElement): void {
  const seen = new Set<string>();
  root.querySelectorAll<HTMLElement>('[data-flow-id]').forEach((element) => {
    const flowId = element.dataset.flowId;
    if (!flowId) return;
    if (seen.has(flowId)) element.dataset.flowId = nextFlowId();
    seen.add(element.dataset.flowId!);
  });
}
```

- [ ] **Step 4: Run the model test to verify GREEN**

Run: `npx.cmd vitest run __tests__/components/a4-pagination/model.test.ts`

Expected: all model tests PASS, including continuation reassembly.

- [ ] **Step 5: Write Chromium regression tests for Enter**

Add browser tests that focus a paragraph, place the caret in its text, dispatch a real Enter key through the browser, wait for reflow, and assert:

```ts
expect(editorRef.current?.getContent()).toContain('<p>');
expect(pageContents.map((page) => page.textContent).join('')).toContain(expectedText);
expect(window.getSelection()?.isCollapsed).toBe(true);
expect(logicalCaretOffset()).toBe(expectedOffset);
expect(scrollContainer.scrollTop).toBe(previousScrollTop);
```

Cover both an ordinary paragraph and the last visible paragraph near the page bottom; assert two logical paragraphs remain after Enter.

- [ ] **Step 6: Run the browser tests to verify RED**

Run: `npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx`

Expected: the new Enter tests FAIL because the newline is merged away and/or selection is restored to the wrong position.

- [ ] **Step 7: Normalize IDs before selection capture and serialization**

Import `normalizeEditedFlowIds` into `a4-page-editor.tsx`. In `commitDocumentSurface`, call it for every rendered page element before building `renderedPages`, then capture `pendingFlowSelectionRef.current` from the live normalized DOM before state replacement.

- [ ] **Step 8: Run focused editor tests to verify GREEN**

Run: `npx.cmd vitest run __tests__/components/a4-pagination/model.test.ts __tests__/components/a4-page-editor.test.tsx`

Run: `npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx`

Expected: focused DOM and Chromium editor suites PASS.

### Task 2: Derive the company letter address for preview resolution

**Files:**
- Modify: `src/lib/placeholder-resolver.ts`
- Test: `__tests__/lib/placeholder-resolver.test.ts`

**Interfaces:**
- Produces: internal `withCompanyLetterAddress(company: CompanyData | null | undefined): CompanyData | null | undefined`.
- Consumes: `resolvePlaceholders()` uses the enriched company when building `fullContext`.

- [ ] **Step 1: Write the failing resolver test**

Resolve `{{company.address.letter}}` using a company whose address has block, street, level, unit, building, and postal code but no `letter`. Assert the result is:

```html
Sample Building<br>123 Sample Street, #01-01<br>Singapore&nbsp;&nbsp;123456
```

Use the formatter's exact spacing output if it represents spaces literally instead of `&nbsp;`.

- [ ] **Step 2: Run the resolver test to verify RED**

Run: `npx.cmd vitest run __tests__/lib/placeholder-resolver.test.ts -t "derives company letter address"`

Expected: FAIL with a missing placeholder marker.

- [ ] **Step 3: Add resolver context enrichment**

Extend `CompanyData` with `registeredAddress?: string | null`. Add a helper that returns the original company when `address.letter` already exists, otherwise calls:

```ts
formatLetterAddress({
  fullAddress: company.registeredAddress,
  block: company.address.block,
  street: company.address.street,
  level: company.address.level,
  unit: company.address.unit,
  building: company.address.building,
  postalCode: company.address.postalCode,
}).letter
```

Store the derived value at `company.address.letter` without mutating caller data, and use the enriched company in `fullContext`.

- [ ] **Step 4: Run resolver tests to verify GREEN**

Run: `npx.cmd vitest run __tests__/lib/placeholder-resolver.test.ts __tests__/services/document-generator.service.test.ts __tests__/api/document-template-test-route.test.ts`

Expected: all related placeholder and preview-rendering tests PASS.

### Task 3: Wrap multiline placeholder examples and complete verification

**Files:**
- Modify: `src/components/documents/template-editor/placeholder-panel.tsx`
- Test: `__tests__/components/template-editor/placeholder-panel.test.tsx`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- No new public interface. Example text uses `whitespace-pre-line break-words` and no `truncate` class.

- [ ] **Step 1: Write the failing wrapping test**

Render `PlaceholderPanel`, locate the example containing `Sample Building`, and assert:

```ts
expect(example).toHaveClass('whitespace-pre-line', 'break-words');
expect(example).not.toHaveClass('truncate');
```

- [ ] **Step 2: Run the component test to verify RED**

Run: `npx.cmd vitest run __tests__/components/template-editor/placeholder-panel.test.tsx -t "wraps multiline placeholder examples"`

Expected: FAIL because the example currently has `truncate`.

- [ ] **Step 3: Apply the wrapping classes**

Change only the example element from:

```tsx
<div className="truncate text-[11px] text-text-muted">Example: {field.example}</div>
```

to:

```tsx
<div className="whitespace-pre-line break-words text-[11px] text-text-muted">Example: {field.example}</div>
```

- [ ] **Step 4: Document the editor invariant**

Update the existing document-generation editor section of `docs/ARCHITECTURE.md` to state that native browser block splits are assigned distinct flow IDs before pagination reassembly, and structured company addresses derive the letter-format preview value.

- [ ] **Step 5: Run final verification**

Run: `npx.cmd vitest run __tests__/components/a4-pagination/model.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/components/template-editor/placeholder-panel.test.tsx __tests__/lib/placeholder-resolver.test.ts __tests__/services/document-generator.service.test.ts __tests__/api/document-template-test-route.test.ts`

Run: `npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx`

Run: `npm.cmd run typecheck`

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 6: Review the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only task files plus the two preserved pre-existing modified files appear.
