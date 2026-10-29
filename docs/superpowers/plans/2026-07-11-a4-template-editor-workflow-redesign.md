# A4 Template Editor Workflow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a continuous, predictable A4 template editing workflow with forward Delete, native cross-page selection, atomic page actions, persisted per-template layout, and a guided toolbar and side panel.

**Architecture:** One canonical `contenteditable` document root owns content, selection, and history; A4 pages remain derived visual fragments inside that root. Versioned layout metadata is normalized by a focused pagination utility and saved in the existing `DocumentTemplate.contentJson`; extracted toolbar and template-panel components consume controlled editor state and guided syntax utilities.

**Tech Stack:** Next.js 15.5.6, React, TypeScript, DOMPurify, Zod, TanStack Query, Vitest 4.0.15, Testing Library, `@vitest/browser-playwright` 4.0.15, Playwright 1.61.1, Tailwind CSS, Lucide React.

## Global Constraints

- Do not introduce a new rich-text framework or database migration.
- Preserve continuous sanitized HTML and class-based hard page-break semantics.
- Preserve every existing `A4PageEditorProps` and `A4PageEditorRef` member; only optional controlled layout members may be added.
- Automatic pagination remains derived state and never creates its own history or `onChange` entry.
- Existing templates without layout metadata use current defaults.
- Preserve unrelated keys in `DocumentTemplate.contentJson` on save.
- Follow `docs/guides/DESIGN_GUIDELINE.md`: compact density, four-pixel spacing, 32-pixel compact controls, semantic colors, dark-mode support, accessible labels, and 150ms interaction transitions.
- Use the same paginator and saved layout in edit, preview, read-only, print, and export paths.
- Write each behavior test first, run it to observe the expected failure, implement the minimum production change, and rerun before committing.
- Do not stage or modify unrelated working-tree changes.

---

## File Structure

### Pagination and document state

- Create `src/components/documents/a4-pagination/layout.ts`: layout types, defaults, normalization, equality, and `contentJson` merge/extract helpers.
- Create `src/components/documents/a4-pagination/document-actions.ts`: canonical forward/backward deletion and hard-page insertion/deletion transactions.
- Modify `src/components/documents/a4-pagination/model.ts`: shared DOM point and logical offset helpers needed by document actions.
- Modify `src/components/documents/a4-pagination/selection.ts`: selection capture/restore for the single document root.
- Modify `src/components/documents/a4-pagination/engine.ts`: consume four-sided content dimensions without changing canonical content.
- Modify `src/components/documents/a4-page-editor.tsx`: controlled layout, one editable document surface, transaction scheduler, history, and orchestration.

### Editor interface

- Create `src/components/documents/a4-editor-toolbar.tsx`: grouped, accessible toolbar and settings popovers.
- Create `src/components/documents/template-editor/template-details-panel.tsx`: template metadata and synchronized layout controls.
- Create `src/components/documents/template-editor/placeholder-panel.tsx`: searchable catalog, recent items, custom fields, and insertion actions.
- Create `src/components/documents/template-editor/template-builders.ts`: pure guided loop and condition builders.
- Create `src/components/documents/template-editor/template-validation.ts`: pure template-syntax validation with flow-block references.
- Create `src/components/documents/template-editor/template-editor-panel.tsx`: collapsible/resizable three-tab panel composition.
- Modify `src/app/(dashboard)/admin/template-partials/editor/page.tsx`: form ownership, layout persistence, extracted panel composition, save/reload, and preview integration.

### Export and tests

- Modify `src/services/document-export.service.ts`: accept normalized saved layout for PDF/print CSS.
- Modify generated-document editor/preview callers that render `A4PageEditor` to pass template layout when available.
- Add focused tests under `__tests__/components/a4-pagination/`, `__tests__/components/template-editor/`, `__tests__/components/`, `__tests__/api/`, and `__tests__/browser/`.
- Update `docs/ARCHITECTURE.md` and `docs/guides/DESIGN_GUIDELINE.md` only where the final component contracts or reusable UI patterns require documentation.

---

### Task 1: Versioned A4 Layout Model

**Files:**
- Create: `src/components/documents/a4-pagination/layout.ts`
- Create: `__tests__/components/a4-pagination/layout.test.ts`

**Interfaces:**
- Produces: `A4MarginsMm`, `A4DocumentLayout`, `DEFAULT_A4_DOCUMENT_LAYOUT`, `normalizeA4DocumentLayout(value)`, `extractA4DocumentLayout(contentJson)`, `mergeA4DocumentLayout(contentJson, layout)`, and `a4LayoutsEqual(left, right)`.
- Consumes: no application state or DOM APIs.

- [ ] **Step 1: Write failing normalization and merge tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_A4_DOCUMENT_LAYOUT,
  extractA4DocumentLayout,
  mergeA4DocumentLayout,
  normalizeA4DocumentLayout,
} from '@/components/documents/a4-pagination/layout';

describe('A4 document layout', () => {
  it('normalizes four independent margins and clamps unsafe values', () => {
    expect(normalizeA4DocumentLayout({
      version: 1,
      lineHeight: 1.8,
      paragraphSpacing: '8px',
      marginsMm: { top: 12, right: 18, bottom: -2, left: 200 },
    })).toEqual({
      version: 1,
      lineHeight: 1.8,
      paragraphSpacing: '8px',
      marginsMm: { top: 12, right: 18, bottom: 5, left: 60 },
    });
  });

  it('falls back for absent or malformed legacy metadata', () => {
    expect(extractA4DocumentLayout(null)).toEqual(DEFAULT_A4_DOCUMENT_LAYOUT);
    expect(extractA4DocumentLayout({ layout: { version: 99 } }))
      .toEqual(DEFAULT_A4_DOCUMENT_LAYOUT);
  });

  it('merges layout without losing unrelated contentJson keys', () => {
    const merged = mergeA4DocumentLayout(
      { tiptap: { type: 'doc' }, customKey: true },
      { ...DEFAULT_A4_DOCUMENT_LAYOUT, lineHeight: 2 },
    );
    expect(merged).toMatchObject({
      tiptap: { type: 'doc' },
      customKey: true,
      version: 1,
      layout: { lineHeight: 2 },
    });
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npx.cmd vitest run __tests__/components/a4-pagination/layout.test.ts`

Expected: FAIL because `a4-pagination/layout` does not exist.

- [ ] **Step 3: Implement the DOM-free layout utility**

```ts
export interface A4MarginsMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface A4DocumentLayout {
  version: 1;
  lineHeight: number;
  paragraphSpacing: string;
  marginsMm: A4MarginsMm;
}

export const DEFAULT_A4_DOCUMENT_LAYOUT: A4DocumentLayout = {
  version: 1,
  lineHeight: 1.5,
  paragraphSpacing: '0.5em',
  marginsMm: { top: 20, right: 20, bottom: 20, left: 20 },
};

const clampMargin = (value: unknown) =>
  Math.min(60, Math.max(5, typeof value === 'number' ? value : 20));

export function normalizeA4DocumentLayout(value: unknown): A4DocumentLayout {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) {
    return structuredClone(DEFAULT_A4_DOCUMENT_LAYOUT);
  }
  const candidate = value as Partial<A4DocumentLayout>;
  const margins = candidate.marginsMm ?? DEFAULT_A4_DOCUMENT_LAYOUT.marginsMm;
  return {
    version: 1,
    lineHeight: Math.min(3, Math.max(1, Number(candidate.lineHeight) || 1.5)),
    paragraphSpacing: typeof candidate.paragraphSpacing === 'string'
      ? candidate.paragraphSpacing
      : DEFAULT_A4_DOCUMENT_LAYOUT.paragraphSpacing,
    marginsMm: {
      top: clampMargin(margins.top),
      right: clampMargin(margins.right),
      bottom: clampMargin(margins.bottom),
      left: clampMargin(margins.left),
    },
  };
}
```

Implement `extractA4DocumentLayout`, `mergeA4DocumentLayout`, and structural equality with plain JSON-safe objects. `mergeA4DocumentLayout` must copy rather than mutate its input and store `{ version: 1, layout }` at the root while preserving every other key.

- [ ] **Step 4: Run focused and existing paginator tests**

Run: `npx.cmd vitest run __tests__/components/a4-pagination/layout.test.ts __tests__/components/a4-pagination`

Expected: PASS with all layout and paginator tests green.

- [ ] **Step 5: Commit the layout model**

```powershell
git add src/components/documents/a4-pagination/layout.ts __tests__/components/a4-pagination/layout.test.ts
git commit -m "feat: add versioned A4 document layout"
```

---

### Task 2: Canonical Document Transactions

**Files:**
- Create: `src/components/documents/a4-pagination/document-actions.ts`
- Modify: `src/components/documents/a4-pagination/model.ts`
- Create: `__tests__/components/a4-pagination/document-actions.test.ts`

**Interfaces:**
- Consumes: `FlowSelectionBookmark`, `HARD_PAGE_BREAK_HTML`, hydrated canonical flow HTML.
- Produces: `applyLogicalDelete(html, selection, direction)`, `insertHardPageAtSelection(html, selection)`, `appendHardPage(html)`, and `deleteHardPageSection(html, sectionIndex)` returning `DocumentTransactionResult`.

```ts
export interface DocumentTransactionResult {
  html: string;
  selection: FlowSelectionBookmark | null;
  changed: boolean;
}
```

- [ ] **Step 1: Write failing tests for Delete and page transactions**

```ts
it('forward Delete removes the next character at a soft page boundary', () => {
  const result = applyLogicalDelete(
    '<p data-flow-id="a">One</p><p data-flow-id="b">Two</p>',
    collapsed('a', 3),
    'forward',
  );
  expect(stripFlowMetadata(result.html)).toBe('<p>One</p><p>wo</p>');
});

it('forward Delete immediately before a hard break joins sections', () => {
  const result = applyLogicalDelete(
    `<p data-flow-id="a">One</p>${HARD_PAGE_BREAK_HTML}<p data-flow-id="b">Two</p>`,
    collapsed('a', 3),
    'forward',
  );
  expect(stripFlowMetadata(result.html)).not.toContain('page-break');
});

it('appends one persistent hard blank page in one transaction', () => {
  const result = appendHardPage('<p data-flow-id="a">One</p>');
  expect(stripFlowMetadata(result.html)).toBe(
    `<p>One</p>${HARD_PAGE_BREAK_HTML}<p><br></p>`,
  );
});

it('deletes the requested hard page section and adjacent break once', () => {
  const result = deleteHardPageSection(
    `<p>A</p>${HARD_PAGE_BREAK_HTML}<p>B</p>${HARD_PAGE_BREAK_HTML}<p>C</p>`,
    1,
  );
  expect(stripFlowMetadata(result.html)).toBe(
    `<p>A</p>${HARD_PAGE_BREAK_HTML}<p>C</p>`,
  );
});
```

- [ ] **Step 2: Run the action tests and verify missing exports**

Run: `npx.cmd vitest run __tests__/components/a4-pagination/document-actions.test.ts`

Expected: FAIL because the transaction functions are not defined.

- [ ] **Step 3: Implement pure transaction orchestration over a detached DOM**

Use one detached container per action, reuse model helpers for flow-point to DOM-point conversion, and apply one `Range.deleteContents()` operation for non-collapsed selections. For collapsed selection, traverse text nodes in canonical order; when traversal meets a hard-break element, remove the break instead of a character. Always retain at least `<p><br></p>` when a transaction empties the document.

```ts
export function applyLogicalDelete(
  html: string,
  selection: FlowSelectionBookmark,
  direction: 'backward' | 'forward',
): DocumentTransactionResult {
  if (!selection.collapsed) return deleteSelectedRange(html, selection);
  return direction === 'forward'
    ? deleteNextLogicalUnit(html, selection.anchor)
    : deletePreviousLogicalUnit(html, selection.anchor);
}
```

`insertHardPageAtSelection` splits at a valid block boundary, inserts the hard-break element, and guarantees an empty paragraph in the new section. `appendHardPage` and `deleteHardPageSection` operate on `splitHardSections()` so they cannot leave duplicate adjacent breaks.

- [ ] **Step 4: Run actions, model, and selection tests**

Run: `npx.cmd vitest run __tests__/components/a4-pagination/document-actions.test.ts __tests__/components/a4-pagination/model.test.ts __tests__/components/a4-pagination/selection.test.ts`

Expected: PASS with no content loss or duplication assertions failing.

- [ ] **Step 5: Commit canonical transactions**

```powershell
git add src/components/documents/a4-pagination/document-actions.ts src/components/documents/a4-pagination/model.ts __tests__/components/a4-pagination/document-actions.test.ts
git commit -m "feat: add canonical A4 document transactions"
```

---

### Task 3: Single Continuous Editable Document Surface

**Files:**
- Modify: `src/components/documents/a4-page-editor.tsx`
- Modify: `src/components/documents/a4-pagination/selection.ts`
- Modify: `__tests__/components/a4-page-editor.test.tsx`
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Interfaces:**
- Consumes: Task 2 document transactions and existing derived `PageData[]`.
- Produces: one element with `data-testid="a4-document-surface"` and `contentEditable=true`; page contents expose `data-page-id` but are not separate editable roots.

- [ ] **Step 1: Add failing component and Chromium selection tests**

```tsx
it('renders one editable document root for every physical page', async () => {
  render(<A4PageEditor value={twoPageValue} />);
  await waitFor(() => expect(screen.getAllByTestId(/a4-page-content-/)).toHaveLength(2));
  expect(screen.getByTestId('a4-document-surface')).toHaveAttribute('contenteditable', 'true');
  screen.getAllByTestId(/a4-page-content-/).forEach((page) => {
    expect(page).not.toHaveAttribute('contenteditable', 'true');
  });
});

it('keeps a native range spanning two physical pages', async () => {
  const surface = screen.getByTestId('a4-document-surface');
  const pages = screen.getAllByTestId(/a4-page-content-/);
  const range = document.createRange();
  range.setStart(pages[0].querySelector('p')!.firstChild!, 1);
  range.setEnd(pages[1].querySelector('p')!.firstChild!, 2);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  expect(surface.contains(selection.anchorNode)).toBe(true);
  expect(surface.contains(selection.focusNode)).toBe(true);
  expect(selection.toString()).toContain('irst');
  expect(selection.toString()).toContain('Se');
});
```

The browser test must use `page.mouse` to drag from text on page one into text on page two and assert `window.getSelection()?.toString()` contains text from both blocks.

- [ ] **Step 2: Run tests and verify the multiple-editable-root failure**

Run: `npx.cmd vitest run __tests__/components/a4-page-editor.test.tsx`

Expected: FAIL because there is no `a4-document-surface` and each page is independently editable.

- [ ] **Step 3: Refactor Page into visual fragments under one editable root**

Move `contentEditable`, input, paste, keydown, and selection handlers from each `Page` content div to the common document surface. Keep page controls and page numbers `contentEditable={false}`. Resolve the active page using `event.target.closest('[data-page-id]')` and read all page fragment HTML from the surface in visual order before scheduling reflow.

```tsx
<div
  ref={documentSurfaceRef}
  data-testid="a4-document-surface"
  contentEditable={!effectivePreviewMode}
  suppressContentEditableWarning
  onBeforeInput={handleBeforeInput}
  onInput={handleDocumentInput}
  onKeyDown={handleDocumentKeyDown}
  onPaste={handleDocumentPaste}
  onMouseUp={syncFormattingFromSelection}
  onKeyUp={syncFormattingFromSelection}
>
  {displayPages.map((page, index) => (
    <PageFragment key={page.id} page={page} pageNumber={index + 1} />
  ))}
</div>
```

Update selection capture to query the one root and preserve flow ID plus logical text offset through continuations. Do not force focus to a physical page end after reflow.

- [ ] **Step 4: Run component and Chromium tests**

Run: `npx.cmd vitest run __tests__/components/a4-page-editor.test.tsx`

Run: `npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx`

Expected: PASS; the Chromium drag selection contains text from both pages and no React controlled-content warnings appear.

- [ ] **Step 5: Commit the continuous surface**

```powershell
git add src/components/documents/a4-page-editor.tsx src/components/documents/a4-pagination/selection.ts __tests__/components/a4-page-editor.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "refactor: use one continuous A4 editing surface"
```

---

### Task 4: Forward Delete and Atomic Page Actions

**Files:**
- Modify: `src/components/documents/a4-page-editor.tsx`
- Modify: `__tests__/components/a4-page-editor.test.tsx`
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Interfaces:**
- Consumes: `applyLogicalDelete`, `appendHardPage`, `insertHardPageAtSelection`, and `deleteHardPageSection` from Task 2.
- Produces: one `commitUserTransaction(result, historyLabel)` path for keyboard and page actions.

- [ ] **Step 1: Add failing regression tests for the reported defects**

```tsx
it('uses forward Delete to remove content across a soft boundary', async () => {
  const onChange = vi.fn();
  render(<A4PageEditor value={softTwoPageValue} onChange={onChange} />);
  placeCaretAtEndOfFirstFlowBlock();
  fireEvent.keyDown(screen.getByTestId('a4-document-surface'), { key: 'Delete' });
  await waitFor(() => expect(lastCanonicalChange(onChange)).not.toContain('T'));
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('keeps a hard blank page after the first Add Page click', async () => {
  render(<A4PageEditor value="<p>One</p>" />);
  fireEvent.click(screen.getByRole('button', { name: 'Add blank page' }));
  await waitFor(() => expect(screen.getAllByTestId(/a4-page-content-/)).toHaveLength(2));
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(screen.getAllByTestId(/a4-page-content-/)).toHaveLength(2);
});

it('deletes a hard page after the first confirmation action', async () => {
  render(<A4PageEditor value={hardTwoPageValue} />);
  activatePage(2);
  fireEvent.click(screen.getByRole('button', { name: 'Delete current page' }));
  await waitFor(() => expect(screen.getAllByTestId(/a4-page-content-/)).toHaveLength(1));
});
```

- [ ] **Step 2: Run the regression tests and verify Delete/page persistence failures**

Run: `npx.cmd vitest run __tests__/components/a4-page-editor.test.tsx -t "forward Delete|first Add Page|first confirmation"`

Expected: FAIL for missing forward behavior or page count reverting after reflow.

- [ ] **Step 3: Route all actions through one generation-safe transaction commit**

```ts
const commitUserTransaction = useCallback((result: DocumentTransactionResult) => {
  if (!result.changed) return;
  pushHistorySnapshot();
  pendingFlowSelectionRef.current = result.selection;
  const sourcePages = parsePages(result.html, pagesRef.current);
  reflowGenerationRef.current += 1;
  pagesRef.current = sourcePages;
  scheduleReflow(sourcePages, true, reflowGenerationRef.current);
}, [parsePages, pushHistorySnapshot, scheduleReflow]);
```

Intercept Backspace/Delete only when a non-collapsed logical range or page/hard-boundary behavior requires canonical handling; allow normal browser editing for an ordinary in-block character. Page controls call document actions directly rather than temporarily mutating derived `pages` state. Ensure the latest generation owns the one final commit and an intentionally blank hard section is not removed as an empty soft page.

- [ ] **Step 4: Run component, engine, and browser regression suites**

Run: `npx.cmd vitest run __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-pagination`

Run: `npm.cmd run test:browser`

Expected: PASS; one click persists, one `onChange` fires, and rapid add/delete converges.

- [ ] **Step 5: Commit keyboard and page actions**

```powershell
git add src/components/documents/a4-page-editor.tsx __tests__/components/a4-page-editor.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "fix: make A4 deletion and page actions atomic"
```

---

### Task 5: Controlled Layout and Template Persistence

**Files:**
- Modify: `src/components/documents/a4-page-editor.tsx`
- Modify: `src/components/documents/a4-pagination/engine.ts`
- Modify: `src/app/(dashboard)/admin/template-partials/editor/page.tsx`
- Modify: `src/lib/validations/document-template.ts`
- Modify: `__tests__/components/a4-page-editor.test.tsx`
- Create: `__tests__/api/document-template-layout.test.ts`

**Interfaces:**
- Consumes: Task 1 `A4DocumentLayout`, normalization, extraction, and merge helpers.
- Produces additions to `A4PageEditorProps`: `layout?: A4DocumentLayout` and `onLayoutChange?: (layout: A4DocumentLayout) => void`.
- Produces `TemplateFormData.layout: A4DocumentLayout` and `TemplateSaveData.contentJson: Record<string, unknown>`.

- [ ] **Step 1: Add failing layout control and API persistence tests**

```tsx
it('uses independent controlled margins for the measured content box', () => {
  render(<A4PageEditor value="<p>Hello</p>" layout={{
    version: 1,
    lineHeight: 2,
    paragraphSpacing: '8px',
    marginsMm: { top: 10, right: 15, bottom: 25, left: 30 },
  }} />);
  expect(screen.getByTestId('a4-page-content-1')).toHaveStyle({
    top: '38px',
    right: '57px',
    bottom: '94px',
    left: '113px',
    lineHeight: '2',
  });
});
```

API tests must POST and PUT `contentJson` containing layout, assert the Zod schema accepts it, and verify service arguments preserve layout and an unrelated key.

- [ ] **Step 2: Run focused tests and verify missing controlled layout behavior**

Run: `npx.cmd vitest run __tests__/components/a4-page-editor.test.tsx -t "independent controlled margins" __tests__/api/document-template-layout.test.ts`

Expected: FAIL because the editor only owns one `pageMarginMm` and the form omits `contentJson`.

- [ ] **Step 3: Implement controlled layout and save/reload wiring**

Replace separate layout state with one normalized layout value:

```ts
const effectiveLayout = useMemo(
  () => normalizeA4DocumentLayout(layout ?? internalLayout),
  [internalLayout, layout],
);

const updateLayout = useCallback((next: A4DocumentLayout) => {
  const normalized = normalizeA4DocumentLayout(next);
  if (layout === undefined) setInternalLayout(normalized);
  onLayoutChange?.(normalized);
  scheduleFullDocumentReflow(normalized);
}, [layout, onLayoutChange, scheduleFullDocumentReflow]);
```

Change `createPageLayout` to compute top/right/bottom/left pixel values, content width, and content height. Load `formData.layout` with `extractA4DocumentLayout(existingTemplate.contentJson)` and save `contentJson: mergeA4DocumentLayout(existingTemplate?.contentJson, formData.layout)` in the same mutation as HTML and placeholders. Extend Zod from `z.any()` to a permissive JSON-object schema that retains unknown keys while validating layout when present.

- [ ] **Step 4: Run layout, component, validation, and route tests**

Run: `npx.cmd vitest run __tests__/components/a4-pagination/layout.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/api/document-template-layout.test.ts __tests__/api/document-template-test-route.test.ts`

Expected: PASS; save/reload preserves line height and all margins.

- [ ] **Step 5: Commit layout persistence**

```powershell
git add src/components/documents/a4-page-editor.tsx src/components/documents/a4-pagination/engine.ts src/app/\(dashboard\)/admin/template-partials/editor/page.tsx src/lib/validations/document-template.ts __tests__/components/a4-page-editor.test.tsx __tests__/api/document-template-layout.test.ts
git commit -m "feat: persist A4 template layout settings"
```

---

### Task 6: Grouped Editor Toolbar and Four-Side Margin Popover

**Files:**
- Create: `src/components/documents/a4-editor-toolbar.tsx`
- Create: `__tests__/components/a4-editor-toolbar.test.tsx`
- Modify: `src/components/documents/a4-page-editor.tsx`

**Interfaces:**
- Consumes: `A4DocumentLayout`, command callbacks, active formatting state, page state, preview state.
- Produces: `A4EditorToolbarProps`, accessible action names, `data-testid="a4-margin-popover"`, and explicit page-action callbacks.

```ts
export interface A4EditorToolbarProps {
  disabled: boolean;
  layout: A4DocumentLayout;
  activeFormats: EditorFormatState;
  showPageNumbers: boolean;
  canDeletePage: boolean;
  onCommand(command: EditorCommand): void;
  onLayoutChange(layout: A4DocumentLayout): void;
  onInsertPageBreak(): void;
  onAddBlankPage(): void;
  onDeleteCurrentPage(): void;
  onTogglePageNumbers(value: boolean): void;
  onSaveSelection(): void;
}

export interface EditorFormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  alignment: 'left' | 'center' | 'right' | 'justify';
  list: 'none' | 'ordered' | 'unordered';
}

export type EditorCommand =
  | { type: 'undo' | 'redo' | 'bold' | 'italic' | 'underline' | 'clear-formatting' }
  | { type: 'align'; value: EditorFormatState['alignment'] }
  | { type: 'list'; value: EditorFormatState['list'] }
  | { type: 'indent' | 'outdent' | 'insert-table' };
```

- [ ] **Step 1: Add failing accessible toolbar tests**

```tsx
it('distinguishes all page actions by name and intent', () => {
  renderToolbar();
  expect(screen.getByRole('button', { name: 'Insert page break' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Add blank page' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Delete current page' })).toBeVisible();
});

it('edits one margin without changing the other sides when unlinked', () => {
  const onLayoutChange = vi.fn();
  renderToolbar({ onLayoutChange });
  fireEvent.click(screen.getByRole('button', { name: 'Page margins' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Same on all sides' }));
  fireEvent.change(screen.getByLabelText('Left margin'), { target: { value: '28' } });
  expect(onLayoutChange).toHaveBeenLastCalledWith(expect.objectContaining({
    marginsMm: { top: 20, right: 20, bottom: 20, left: 28 },
  }));
});
```

- [ ] **Step 2: Run toolbar tests and verify the missing component failure**

Run: `npx.cmd vitest run __tests__/components/a4-editor-toolbar.test.tsx`

Expected: FAIL because `A4EditorToolbar` does not exist.

- [ ] **Step 3: Extract and redesign the toolbar**

Build six compact groups: History, Text, Paragraph, Insert, Page, and View. Use semantic `<button>` elements with `aria-pressed`, visible focus rings, Lucide icons, `title`/tooltip shortcut hints, and 32-pixel control height. Preserve the saved selection on `pointerdown` before any popover command. Use an anchored panel for margins and a narrow-screen overflow menu for lower-frequency insert/view actions.

The margin popover keeps a local `sameOnAllSides` UI flag. When linked, changing any input emits the same value for all four sides; when unlinked, it emits only the changed side. Disable Delete Current Page when the active document has no removable hard section.

- [ ] **Step 4: Run toolbar and editor component tests**

Run: `npx.cmd vitest run __tests__/components/a4-editor-toolbar.test.tsx __tests__/components/a4-page-editor.test.tsx`

Expected: PASS with no duplicate accessible names or selection-loss regressions.

- [ ] **Step 5: Commit the toolbar redesign**

```powershell
git add src/components/documents/a4-editor-toolbar.tsx src/components/documents/a4-page-editor.tsx __tests__/components/a4-editor-toolbar.test.tsx
git commit -m "feat: redesign the A4 editor toolbar"
```

---

### Task 7: Guided Template Syntax Utilities

**Files:**
- Create: `src/components/documents/template-editor/template-builders.ts`
- Create: `src/components/documents/template-editor/template-validation.ts`
- Create: `__tests__/components/template-editor/template-builders.test.ts`
- Create: `__tests__/components/template-editor/template-validation.test.ts`

**Interfaces:**
- Produces: `buildEachBlock(input)`, `buildConditionBlock(input)`, `validateTemplateSyntax(html, knownKeys)`, `TemplateValidationIssue`, and field/collection option types.
- Consumes: canonical HTML strings and known placeholder keys; no React or browser layout state.

```ts
export interface EachBlockInput {
  collection: 'directors' | 'shareholders';
  fields: string[];
  layout: 'paragraphs' | 'bullets' | 'table';
}

export interface ConditionBlockInput {
  field: string;
  operator: 'truthy' | 'equals' | 'notEquals';
  value?: string;
  bodyHtml: string;
}

export interface TemplateValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  code: 'unmatched-block' | 'unknown-placeholder' | 'empty-loop' | 'unresolved-partial';
  message: string;
  flowId?: string;
}
```

- [ ] **Step 1: Write failing balanced-builder and validator tests**

```ts
it('builds a balanced directors table loop', () => {
  const result = buildEachBlock({
    collection: 'directors',
    fields: ['name', 'identificationNumber'],
    layout: 'table',
  });
  expect(result).toContain('{{#each directors}}');
  expect(result).toContain('{{this.name}}');
  expect(result).toContain('{{this.identificationNumber}}');
  expect(result).toContain('{{/each}}');
});

it('reports unmatched and unknown constructs with actionable messages', () => {
  const issues = validateTemplateSyntax(
    '<p>{{#each directors}}</p><p>{{company.missing}}</p>',
    new Set(['company.name']),
  );
  expect(issues.map((issue) => issue.code)).toEqual([
    'unmatched-block',
    'unknown-placeholder',
  ]);
});
```

- [ ] **Step 2: Run utility tests and verify missing exports**

Run: `npx.cmd vitest run __tests__/components/template-editor/template-builders.test.ts __tests__/components/template-editor/template-validation.test.ts`

Expected: FAIL because the builder and validator modules do not exist.

- [ ] **Step 3: Implement allowlisted builders and stack-based validation**

Escape field labels and values before HTML insertion. Generate fixed block structures from allowlisted collections, fields, layouts, and operators; never concatenate arbitrary tag names. Parse `{{#each ...}}`, `{{#if ...}}`, `{{/each}}`, and `{{/if}}` tokens with a stack that reports the first mismatched opener/closer and then continues to find independent unknown placeholders.

```ts
export function buildEachBlock(input: EachBlockInput): string {
  const cells = input.fields.map((field) => `{{this.${assertAllowedField(field)}}}`);
  const body = renderLoopLayout(input.layout, cells);
  return `<div>{{#each ${input.collection}}}</div>${body}<div>{{/each}}</div>`;
}
```

- [ ] **Step 4: Run builder and validation tests**

Run: `npx.cmd vitest run __tests__/components/template-editor/template-builders.test.ts __tests__/components/template-editor/template-validation.test.ts`

Expected: PASS for balanced output, escaping, deterministic issue ordering, and known-key handling.

- [ ] **Step 5: Commit guided syntax utilities**

```powershell
git add src/components/documents/template-editor/template-builders.ts src/components/documents/template-editor/template-validation.ts __tests__/components/template-editor/template-builders.test.ts __tests__/components/template-editor/template-validation.test.ts
git commit -m "feat: add guided template syntax builders"
```

---

### Task 8: Searchable Fields Panel and Guided Builders

**Files:**
- Create: `src/components/documents/template-editor/placeholder-panel.tsx`
- Create: `__tests__/components/template-editor/placeholder-panel.test.tsx`
- Modify: `src/app/(dashboard)/admin/template-partials/editor/page.tsx`

**Interfaces:**
- Consumes: Task 7 builders, existing `CustomPlaceholderDefinition`, `MergedPlaceholder`, placeholder categories, and `onInsert(html)`.
- Produces: search/category/recent UI, `GuidedLoopDialog`, `GuidedConditionDialog`, and validated custom-field form.

- [ ] **Step 1: Add failing panel workflow tests**

```tsx
it('searches labels and inserts the selected placeholder', () => {
  const onInsert = vi.fn();
  render(<PlaceholderPanel {...props} onInsert={onInsert} />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search fields' }), {
    target: { value: 'company name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Insert Company Name' }));
  expect(onInsert).toHaveBeenCalledWith('{{company.name}}');
});

it('inserts a complete loop from the guided builder', () => {
  const onInsert = vi.fn();
  render(<PlaceholderPanel {...props} onInsert={onInsert} />);
  fireEvent.click(screen.getByRole('button', { name: 'Build directors loop' }));
  fireEvent.click(screen.getByLabelText('Director name'));
  fireEvent.click(screen.getByRole('button', { name: 'Insert loop' }));
  expect(onInsert.mock.calls[0][0]).toMatch(/#each directors[\s\S]*this\.name[\s\S]*\/each/);
});

it('explains a duplicate custom placeholder key inline', () => {
  render(<PlaceholderPanel {...props} customPlaceholders={[existingField]} />);
  openCustomFieldForm();
  fillLabelAndKey('Duplicate', existingField.key);
  expect(screen.getByText('This placeholder key already exists.')).toBeVisible();
});
```

- [ ] **Step 2: Run panel tests and verify the missing component failure**

Run: `npx.cmd vitest run __tests__/components/template-editor/placeholder-panel.test.tsx`

Expected: FAIL because `PlaceholderPanel` and guided dialogs do not exist.

- [ ] **Step 3: Build the guided-first fields experience**

Extract placeholder constants and current custom-field logic from the route file. Render human labels first, syntax second, category count badges, Insert as the primary action, and Copy as an icon action. Search normalized label, key, category, and example strings. Store at most five recent keys in component state for the current editor session.

Use an accessible modal dialog for loop and condition builders. The advanced "View syntax" disclosure previews exact output but is collapsed initially. Keep existing partial placeholder linking below its source partial group and preserve all current storage conversions.

- [ ] **Step 4: Run panel and builder tests**

Run: `npx.cmd vitest run __tests__/components/template-editor/placeholder-panel.test.tsx __tests__/components/template-editor/template-builders.test.ts __tests__/components/template-editor/template-validation.test.ts`

Expected: PASS; search, copy, insert, custom validation, loop output, and partial linking remain functional.

- [ ] **Step 5: Commit the fields panel**

```powershell
git add src/components/documents/template-editor/placeholder-panel.tsx src/app/\(dashboard\)/admin/template-partials/editor/page.tsx __tests__/components/template-editor/placeholder-panel.test.tsx
git commit -m "feat: redesign template placeholder workflows"
```

---

### Task 9: Task-Oriented Side Panel and Validation Preview

**Files:**
- Create: `src/components/documents/template-editor/template-details-panel.tsx`
- Create: `src/components/documents/template-editor/template-editor-panel.tsx`
- Create: `__tests__/components/template-editor/template-editor-panel.test.tsx`
- Modify: `src/app/(dashboard)/admin/template-partials/editor/page.tsx`
- Create: `__tests__/components/template-editor-page.test.tsx`

**Interfaces:**
- Consumes: controlled template/partial form data, Task 1 layout, Task 8 placeholder panel, Task 7 validator, current mock data and preview actions.
- Produces: tabs named `Template`, `Fields`, and `Test & Preview`; `onFocusIssue(flowId)`; persisted collapse/width state through the existing `useResizablePanel` contract.

- [ ] **Step 1: Add failing information-architecture and synchronization tests**

```tsx
it('exposes the three task-oriented tabs for templates', () => {
  render(<TemplateEditorPanel {...props} mode="template" />);
  expect(screen.getByRole('tab', { name: 'Template' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Fields' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Test & Preview' })).toBeVisible();
});

it('keeps layout controls synchronized with the editor', () => {
  const onLayoutChange = vi.fn();
  render(<TemplateEditorPanel {...props} onLayoutChange={onLayoutChange} />);
  fireEvent.change(screen.getByLabelText('Top margin'), { target: { value: '24' } });
  expect(onLayoutChange).toHaveBeenCalledWith(expect.objectContaining({
    marginsMm: expect.objectContaining({ top: 24 }),
  }));
});

it('lists syntax issues and focuses their flow block', () => {
  const onFocusIssue = vi.fn();
  render(<TemplateEditorPanel {...props} validationIssues={[issue]} onFocusIssue={onFocusIssue} />);
  fireEvent.click(screen.getByRole('button', { name: issue.message }));
  expect(onFocusIssue).toHaveBeenCalledWith(issue.flowId);
});
```

- [ ] **Step 2: Run panel tests and verify missing components/tabs**

Run: `npx.cmd vitest run __tests__/components/template-editor/template-editor-panel.test.tsx`

Expected: FAIL because the route still owns Details/Placeholders/Test/AI tabs inline.

- [ ] **Step 3: Extract and compose the redesigned side panel**

Move template metadata and synchronized layout controls into `TemplateDetailsPanel`. Compose Template, Fields, and Test & Preview as accessible `role="tablist"`/`role="tabpanel"` UI. Keep AI as a clearly labeled secondary action within Test & Preview instead of a fourth primary workflow tab. Show unsaved status from a form-level dirty boolean. Preserve the existing resizer, bounds, collapse control, partial mode, mock data, partial linking, and preview mutation behavior.

Compute validation issues with `useMemo` from canonical form content and known keys. `onFocusIssue` asks `A4PageEditorRef` to focus the matching flow block, requiring an optional `focusFlowBlock(flowId: string)` ref method only if the block carries an internal flow ID; public existing methods remain unchanged.

- [ ] **Step 4: Run side-panel and editor-page tests**

Run: `npx.cmd vitest run __tests__/components/template-editor __tests__/components/a4-page-editor.test.tsx`

Expected: PASS for tabs, panel collapse/resize, layout synchronization, placeholder workflows, validation navigation, and partial mode.

- [ ] **Step 5: Commit the side-panel redesign**

```powershell
git add src/components/documents/template-editor/template-details-panel.tsx src/components/documents/template-editor/template-editor-panel.tsx src/app/\(dashboard\)/admin/template-partials/editor/page.tsx __tests__/components/template-editor/template-editor-panel.test.tsx __tests__/components/template-editor-page.test.tsx
git commit -m "feat: redesign the template editor side panel"
```

---

### Task 10: Preview, Generated Documents, Print, and Export Layout Parity

**Files:**
- Modify: `src/services/document-export.service.ts`
- Modify: `src/app/(dashboard)/generated-documents/[id]/edit/page.tsx`
- Modify: `src/app/(dashboard)/generated-documents/[id]/page.tsx`
- Modify: `src/components/documents/document-generation-wizard.tsx`
- Modify: `src/components/documents/template-selector.tsx`
- Modify: `src/services/document-generator.service.ts`
- Create: `__tests__/services/document-export-layout.test.ts`
- Create: `__tests__/components/generated-document-layout.test.tsx`

**Interfaces:**
- Consumes: normalized `A4DocumentLayout` from Task 1.
- Produces: exported `buildA4PrintCss(layout: A4DocumentLayout): string`; all A4 editor callers pass layout extracted from template or generated-document `contentJson`.

- [ ] **Step 1: Add failing export and generated-document parity tests**

```ts
it('prints four independent margins and saved line spacing', () => {
  const css = buildA4PrintCss({
    version: 1,
    lineHeight: 1.8,
    paragraphSpacing: '8px',
    marginsMm: { top: 10, right: 15, bottom: 20, left: 25 },
  });
  expect(css).toContain('@page { margin: 10mm 15mm 20mm 25mm; }');
  expect(css).toContain('line-height: 1.8');
});
```

Render the generated-document editor with generated-document `contentJson` and assert the rendered A4 content box uses the same layout object. Assert `generateDocument` copies template `contentJson.layout` into a new generated document when no edited JSON override is supplied.

- [ ] **Step 2: Run parity tests and verify default-only export behavior**

Run: `npx.cmd vitest run __tests__/services/document-export-layout.test.ts __tests__/components/generated-document-layout.test.tsx __tests__/services/document-generator.service.test.ts`

Expected: FAIL because export and generated-document callers do not consume saved layout.

- [ ] **Step 3: Thread normalized layout through every rendering path**

Centralize print CSS generation around `normalizeA4DocumentLayout`. Keep legacy comment boundaries soft and class-based page breaks hard. Ensure `[Remove Page]` filtering occurs before separator removal exactly as in the existing export contract. Generated documents without accessible template layout use `DEFAULT_A4_DOCUMENT_LAYOUT`.

- [ ] **Step 4: Run export, generated-document, and document-generation tests**

Run: `npx.cmd vitest run __tests__/services __tests__/components/generated-document-layout.test.tsx __tests__/api/generated-documents`

Expected: PASS with existing break-semantics assertions unchanged and new layout parity assertions green.

- [ ] **Step 5: Commit layout parity**

```powershell
git add src/services/document-export.service.ts src/services/document-generator.service.ts src/app/\(dashboard\)/generated-documents/\[id\]/page.tsx src/app/\(dashboard\)/generated-documents/\[id\]/edit/page.tsx src/components/documents/document-generation-wizard.tsx src/components/documents/template-selector.tsx __tests__/services/document-export-layout.test.ts __tests__/services/document-generator.service.test.ts __tests__/components/generated-document-layout.test.tsx
git commit -m "feat: apply saved A4 layout across rendering paths"
```

---

### Task 11: Chromium Workflow QA and Architecture Documentation

**Files:**
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`
- Create: `__tests__/browser/template-editor-workflow.browser.test.tsx`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/guides/DESIGN_GUIDELINE.md`

**Interfaces:**
- Consumes: completed editor, toolbar, panel, persistence, and export paths.
- Produces: end-to-end regression coverage and final architecture/design documentation.

- [ ] **Step 1: Add browser workflows that fail against the old UI**

Cover these exact Chromium interactions:

```ts
test('continuous selection and forward Delete cross physical pages', async ({ page }) => {
  await openOverflowingEditor(page);
  await dragSelectionFromPageOneToPageTwo(page);
  expect(await page.evaluate(() => getSelection()?.toString().length)).toBeGreaterThan(1);
  await page.keyboard.press('Delete');
  await expectCanonicalContentToHaveNoLossOrDuplication(page);
});

test('one click adds and removes a persistent blank page', async ({ page }) => {
  await page.getByRole('button', { name: 'Add blank page' }).click();
  await expect(page.getByTestId(/a4-page-content-/)).toHaveCount(2);
  await page.waitForTimeout(100);
  await expect(page.getByTestId(/a4-page-content-/)).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete current page' }).click();
  await expect(page.getByTestId(/a4-page-content-/)).toHaveCount(1);
});
```

Also cover save/reload layout, guided directors loop insertion, validation navigation, panel collapse/resize, and toolbar overflow at a narrow viewport.

- [ ] **Step 2: Run the browser suite and address only genuine integration gaps**

Run: `npm.cmd run test:browser`

Expected before final integration fixes: any failure must identify a concrete workflow mismatch, not a selector race. Fix selectors only when the accessible UI name intentionally changed.

- [ ] **Step 3: Document final ownership and reusable UI patterns**

Update `docs/ARCHITECTURE.md` with:

- Canonical editable root versus derived physical page fragments.
- Transaction and reflow generation sequence.
- Versioned `contentJson.layout` ownership and fallback.
- Shared edit/preview/export layout path.

Update `docs/guides/DESIGN_GUIDELINE.md` with the reusable grouped-toolbar and task-panel conventions, including control sizing, tab naming, resizer/collapse behavior, and guided advanced-syntax disclosure.

- [ ] **Step 4: Run the complete verification matrix**

Run these commands individually and record fresh exit codes:

```powershell
npx.cmd vitest run --testTimeout=15000
npm.cmd run test:browser
npx.cmd tsc --noEmit
npx.cmd eslint src/components/documents src/app/\(dashboard\)/admin/template-partials/editor/page.tsx src/services/document-export.service.ts
npm.cmd run build
git diff --check
docker compose up -d --build app
docker compose ps app
docker compose logs --since 5m --tail 200 app
```

Expected:

- All Vitest files and tests pass.
- All Chromium browser tests pass without application-origin console errors or warnings.
- TypeScript and ESLint exit 0.
- Next.js production build completes and generates all configured pages.
- `git diff --check` emits no output.
- `oakcloud-app` is Up and recent logs contain no `ReferenceError`, hydration error, or framework exception.

- [ ] **Step 5: Perform authenticated rendered QA with the Browser plugin**

The flow under test is: `/admin/template-partials/editor?type=template` -> create content spanning pages -> select/delete/add page/configure layout/insert guided loop/save -> reopen the template -> verify content and layout persist.

Verify page identity, non-blank content, no framework overlay, console health, desktop screenshot, narrow-viewport screenshot, and interaction state after every major action. If authenticated Browser state is unavailable, report that exact limitation and retain the Chromium component workflow as automated evidence.

- [ ] **Step 6: Commit tests and documentation**

```powershell
git add __tests__/browser docs/ARCHITECTURE.md docs/guides/DESIGN_GUIDELINE.md
git commit -m "test: verify redesigned A4 template workflow"
```

---

## Plan Self-Review Checklist

- Every approved defect and workflow request is assigned to at least one task.
- Continuous selection is implemented structurally with one editable root, not simulated highlights.
- Delete, Add Page, and Delete Page share canonical transactions and one generation-safe commit.
- Layout settings have one versioned type and are persisted without a migration.
- Toolbar and side panel consume controlled state rather than owning duplicate document settings.
- Guided builders are pure and allowlisted before they are connected to UI.
- Existing partials, placeholder linkings, preview, hard breaks, export filtering, and ref methods remain covered.
- Browser verification covers the actual reported interactions plus save/reload and responsive UI.
