# Template Global Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted global font-family and font-size defaults to templates and apply them consistently to editor pagination, partial content, generated documents, preview, print, and PDF export.

**Architecture:** Extend the existing normalized `A4DocumentLayout` model with allowlisted typography values. Put the font catalog in one shared module used by the toolbar, template panel, and layout normalization; all renderers consume the normalized layout so unformatted partial HTML inherits defaults without being rewritten.

**Tech Stack:** TypeScript 5.7, React 19, Next.js 15, Vitest 4, Testing Library, CSS inheritance, existing `DocumentTemplate.contentJson` persistence.

## Global Constraints

- Global typography is a default; explicit inline `font-family` and `font-size` formatting remains authoritative.
- Reuse exactly the toolbar's existing seven font options and twelve font-size options from 8pt through 36pt.
- Existing templates and generated documents without typography metadata remain Arial 11pt.
- Keep `A4DocumentLayout.version` at `1`; no database migration or custom font upload support.
- A partial owns no page-layout metadata and inherits the containing template's typography, spacing, and margins.
- Update existing documentation under `docs/`; do not create unrelated documentation.
- Preserve unrelated working-tree changes and stage only files belonging to each task.

---

## File Structure

- Create `src/components/documents/document-typography.ts`: shared immutable font and size option catalogs plus defaults.
- Modify `src/components/documents/a4-editor-toolbar.tsx`: consume the shared catalogs for local formatting menus.
- Modify `src/components/documents/a4-pagination/layout.ts`: extend, normalize, merge, and compare global typography.
- Modify `src/components/documents/template-editor/template-details-panel.tsx`: render controlled Global font and Font size selectors.
- Modify `src/components/documents/a4-page-editor.tsx`: apply typography to the measurer, pages, placeholders, headings, and browser print output.
- Modify `src/services/document-export.service.ts`: apply typography to server-side print/PDF CSS.
- Modify `docs/ARCHITECTURE.md`: document typography in the canonical layout model and partial inheritance.
- Modify focused tests under `__tests__/components`, `__tests__/services`, and `__tests__/api` to cover behavior and update typed fixtures.

---

### Task 1: Shared Typography Catalog and Normalized Layout

**Files:**
- Create: `src/components/documents/document-typography.ts`
- Modify: `src/components/documents/a4-editor-toolbar.tsx`
- Modify: `src/components/documents/a4-pagination/layout.ts`
- Test: `__tests__/components/a4-pagination/layout.test.ts`
- Test: `__tests__/components/a4-editor-toolbar.test.tsx`

**Interfaces:**
- Produces: `DOCUMENT_FONT_OPTIONS`, `DOCUMENT_FONT_SIZE_OPTIONS`, `DEFAULT_DOCUMENT_FONT_FAMILY`, and `DEFAULT_DOCUMENT_FONT_SIZE`.
- Produces: required `A4DocumentLayout.fontFamily: string` and `A4DocumentLayout.fontSize: string` on normalized layouts.

- [ ] **Step 1: Write failing normalization tests**

Add to `layout.test.ts`:

```ts
it('normalizes allowlisted typography and falls back independently', () => {
  expect(normalizeA4DocumentLayout({
    version: 1,
    fontFamily: 'Georgia, serif',
    fontSize: '14pt',
    lineHeight: 1.8,
    paragraphSpacing: '8px',
    marginsMm: { top: 12, right: 18, bottom: 20, left: 20 },
  })).toMatchObject({ fontFamily: 'Georgia, serif', fontSize: '14pt' });
  expect(normalizeA4DocumentLayout({
    version: 1,
    fontFamily: 'url(javascript:bad)',
    fontSize: '999px',
  })).toMatchObject({
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '11pt',
  });
});

it('treats typography as part of layout equality', () => {
  expect(a4LayoutsEqual(
    DEFAULT_A4_DOCUMENT_LAYOUT,
    { ...DEFAULT_A4_DOCUMENT_LAYOUT, fontSize: '12pt' },
  )).toBe(false);
});
```

In `a4-editor-toolbar.test.tsx`, import the shared catalogs and assert every option remains available through the Formats popover. It must fail because the shared module does not exist.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- --run __tests__/components/a4-pagination/layout.test.ts __tests__/components/a4-editor-toolbar.test.tsx
```

Expected: FAIL for the missing module and layout properties.

- [ ] **Step 3: Create the catalog and reuse it in the toolbar**

Create `document-typography.ts`:

```ts
export const DOCUMENT_FONT_OPTIONS = [
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
  { value: "'Courier New', Courier, monospace", label: 'Courier New' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS' },
  { value: "'Lucida Console', Monaco, monospace", label: 'Lucida Console' },
] as const;

export const DOCUMENT_FONT_SIZE_OPTIONS = [
  '8pt', '9pt', '10pt', '11pt', '12pt', '14pt',
  '16pt', '18pt', '20pt', '24pt', '28pt', '36pt',
] as const;

export const DEFAULT_DOCUMENT_FONT_FAMILY = DOCUMENT_FONT_OPTIONS[0].value;
export const DEFAULT_DOCUMENT_FONT_SIZE = '11pt';
```

Delete the toolbar's private option constants and map over these imports instead.

- [ ] **Step 4: Extend layout normalization and equality**

Add both properties to `A4DocumentLayout` and `DEFAULT_A4_DOCUMENT_LAYOUT`. Normalize through allowlist membership:

```ts
const allowedFontFamilies = new Set<string>(
  DOCUMENT_FONT_OPTIONS.map((option) => option.value),
);
const allowedFontSizes = new Set<string>(DOCUMENT_FONT_SIZE_OPTIONS);

fontFamily: typeof candidate.fontFamily === 'string'
  && allowedFontFamilies.has(candidate.fontFamily)
  ? candidate.fontFamily
  : DEFAULT_DOCUMENT_FONT_FAMILY,
fontSize: typeof candidate.fontSize === 'string'
  && allowedFontSizes.has(candidate.fontSize)
  ? candidate.fontSize
  : DEFAULT_DOCUMENT_FONT_SIZE,
```

Compare both fields in `a4LayoutsEqual` and update existing literal expectations to include Arial 11pt.

- [ ] **Step 5: Run tests and verify GREEN**

Run the Step 2 command. Expected: PASS with zero failed tests.

- [ ] **Step 6: Commit**

```powershell
git add -- src/components/documents/document-typography.ts src/components/documents/a4-editor-toolbar.tsx src/components/documents/a4-pagination/layout.ts __tests__/components/a4-pagination/layout.test.ts __tests__/components/a4-editor-toolbar.test.tsx
git commit -m "feat(documents): add global typography layout model"
```

---

### Task 2: Template Panel Selectors and Persistence

**Files:**
- Modify: `src/components/documents/template-editor/template-details-panel.tsx`
- Test: `__tests__/components/template-editor/template-editor-panel.test.tsx`
- Test: `__tests__/components/template-editor-page.test.tsx`
- Test: `__tests__/api/document-template-layout.test.ts`

**Interfaces:**
- Consumes: Task 1's normalized layout and shared catalogs.
- Produces: controlled changes through existing `onTemplateChange({ layout })`; no new route API.

- [ ] **Step 1: Write failing selector and persistence tests**

Add to `template-editor-panel.test.tsx`:

```tsx
it('updates global font and font size through the template layout', () => {
  const onTemplateChange = vi.fn();
  render(<TemplateEditorPanel {...defaultProps} onTemplateChange={onTemplateChange} />);
  fireEvent.change(screen.getByLabelText('Global font'), {
    target: { value: 'Georgia, serif' },
  });
  expect(onTemplateChange).toHaveBeenLastCalledWith({
    layout: { ...DEFAULT_A4_DOCUMENT_LAYOUT, fontFamily: 'Georgia, serif' },
  });
  fireEvent.change(screen.getByLabelText('Font size'), {
    target: { value: '14pt' },
  });
  expect(onTemplateChange).toHaveBeenLastCalledWith({
    layout: { ...DEFAULT_A4_DOCUMENT_LAYOUT, fontSize: '14pt' },
  });
});
```

Extend `template-editor-page.test.tsx` to assert a layout change marks the form dirty. Add `fontFamily: 'Georgia, serif'` and `fontSize: '14pt'` to `document-template-layout.test.ts`'s persisted layout fixture and POST/PUT assertions.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- --run __tests__/components/template-editor/template-editor-panel.test.tsx __tests__/components/template-editor-page.test.tsx __tests__/api/document-template-layout.test.ts
```

Expected: FAIL because the selectors are absent.

- [ ] **Step 3: Render the two controlled selectors**

Above the spacing row in the Page layout card, map `DOCUMENT_FONT_OPTIONS` into an accessible `select` labeled `Global font` and `DOCUMENT_FONT_SIZE_OPTIONS` into a select labeled `Font size`. Each handler uses:

```ts
onTemplateChange({
  layout: { ...templateForm.layout, fontFamily: event.target.value },
});
```

or the equivalent `fontSize` property. Reuse the existing two-column grid and compact select classes. Do not render either selector in partial mode. Existing route state and `mergeA4DocumentLayout` perform dirty tracking and persistence.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/components/documents/template-editor/template-details-panel.tsx __tests__/components/template-editor/template-editor-panel.test.tsx __tests__/components/template-editor-page.test.tsx __tests__/api/document-template-layout.test.ts
git commit -m "feat(templates): add global typography selectors"
```

---

### Task 3: Editor Pagination, Partials, and Browser Print

**Files:**
- Modify: `src/components/documents/a4-page-editor.tsx`
- Test: `__tests__/components/a4-page-editor.test.tsx`
- Test: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Interfaces:**
- Consumes: `effectiveLayout.fontFamily` and `.fontSize`.
- Produces: identical typography for the visible surface, hidden measurer, preview pages, placeholder, and print iframe.

- [ ] **Step 1: Write failing editor and partial-inheritance tests**

```tsx
it('applies global typography while preserving explicit partial formatting', () => {
  render(<A4PageEditor
    value={'<p>Inherited partial text</p><p style="font-family: Verdana, Geneva, sans-serif; font-size: 9pt;">Explicit partial text</p>'}
    layout={{
      ...DEFAULT_A4_DOCUMENT_LAYOUT,
      fontFamily: 'Georgia, serif',
      fontSize: '14pt',
    }}
  />);
  const page = screen.getByTestId('a4-page-content-1');
  expect(page).toHaveStyle({ fontFamily: 'Georgia, serif', fontSize: '14pt' });
  expect(page.querySelectorAll('p')[0]).not.toHaveAttribute('style');
  expect(page.querySelectorAll('p')[1]).toHaveStyle({
    fontFamily: 'Verdana, Geneva, sans-serif',
    fontSize: '9pt',
  });
});
```

Add a test with a temporary `HTMLElement.prototype.scrollHeight` getter that records font styles when `this.style.position === 'fixed'`, then assert the hidden measurer uses Georgia 14pt. Add a browser test that rerenders Arial 11pt to Georgia 14pt and confirms reflow preserves all text.

- [ ] **Step 2: Run the component test and verify RED**

```powershell
npm.cmd test -- --run __tests__/components/a4-page-editor.test.tsx
```

Expected: FAIL because page and measurer typography is hardcoded.

- [ ] **Step 3: Thread typography through rendering and measurement**

Add `fontFamily` and `fontSize` parameters to `createPageMeasurer`, `Page`, and `PageChrome`; pass the normalized layout values at each call. Replace visible-page and measurer literals with:

```ts
fontFamily: effectiveLayout.fontFamily,
fontSize: effectiveLayout.fontSize,
```

Use `font-family: inherit` for headings while retaining heading sizes. Let placeholder text inherit document typography; keep page numbers at their independent 10pt size. Add both fields to dependencies for measurement, pagination, preview, and print callbacks so either change triggers reflow.

- [ ] **Step 4: Apply normalized typography to browser print**

Use:

```css
html, body {
  font-family: ${effectiveLayout.fontFamily};
  font-size: ${effectiveLayout.fontSize};
  line-height: ${lineHeight};
}
h1, h2, h3 { font-family: inherit; }
```

Do not use `!important`, ensuring inline partial formatting remains authoritative.

- [ ] **Step 5: Run component and browser tests**

```powershell
npm.cmd test -- --run __tests__/components/a4-page-editor.test.tsx
npm.cmd run test:browser -- --run __tests__/browser/a4-page-editor.browser.test.tsx
```

Expected: both PASS without browser console errors.

- [ ] **Step 6: Commit**

```powershell
git add -- src/components/documents/a4-page-editor.tsx __tests__/components/a4-page-editor.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "feat(documents): apply global typography to editor"
```

---

### Task 4: Export, Generation Compatibility, and Documentation

**Files:**
- Modify: `src/services/document-export.service.ts`
- Modify: `docs/ARCHITECTURE.md`
- Test: `__tests__/services/document-export-layout.test.ts`
- Test: `__tests__/components/generated-document-layout.test.tsx`
- Test: `__tests__/services/document-generator.service.test.ts`
- Modify typed fixtures: `__tests__/components/a4-page-editor.test.tsx`

**Interfaces:**
- Consumes: `normalizeA4DocumentLayout(layout)`.
- Produces: `buildA4PrintCss(layout)` with normalized typography.
- Preserves: generated documents copy the template's complete `contentJson`.

- [ ] **Step 1: Write failing export and generation tests**

```ts
it('prints normalized global typography without overriding inline styles', () => {
  const css = buildA4PrintCss({
    ...DEFAULT_A4_DOCUMENT_LAYOUT,
    fontFamily: 'Georgia, serif',
    fontSize: '14pt',
  });
  expect(css).toContain('font-family: Georgia, serif;');
  expect(css).toContain('font-size: 14pt;');
  expect(css).not.toContain('font-family: Georgia, serif !important');
});
```

Update the generated-document mock to expose `layout.fontFamily` and `.fontSize` and assert Georgia 14pt is passed. Extend the generator service's layout-copy test to assert both properties remain in generated `contentJson`.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm.cmd test -- --run __tests__/services/document-export-layout.test.ts __tests__/components/generated-document-layout.test.tsx __tests__/services/document-generator.service.test.ts
```

Expected: FAIL because export CSS remains hardcoded.

- [ ] **Step 3: Update server export CSS**

After normalization, replace only `.document-content` inherited defaults:

```ts
.replace(
  'font-family: Arial, Helvetica, sans-serif;',
  `font-family: ${normalized.fontFamily};`,
)
.replace('font-size: 11pt;', `font-size: ${normalized.fontSize};`)
```

Keep heading sizes and inline precedence unchanged.

- [ ] **Step 4: Update fixtures and architecture docs**

Convert raw typed layout literals in the focused tests to `{ ...DEFAULT_A4_DOCUMENT_LAYOUT, ...overrides }`. Update the Document Generation paragraph in `docs/ARCHITECTURE.md` to name global font, base size, spacing, and four margins, plus parent-layout inheritance for partials and preservation of inline typography.

- [ ] **Step 5: Run focused tests, TypeScript, and ESLint**

```powershell
npm.cmd test -- --run __tests__/components/a4-pagination/layout.test.ts __tests__/components/template-editor/template-editor-panel.test.tsx __tests__/components/template-editor-page.test.tsx __tests__/components/a4-page-editor.test.tsx __tests__/components/generated-document-layout.test.tsx __tests__/api/document-template-layout.test.ts __tests__/services/document-export-layout.test.ts __tests__/services/document-generator.service.test.ts
npx.cmd tsc --noEmit
npx.cmd eslint src/components/documents/document-typography.ts src/components/documents/a4-editor-toolbar.tsx src/components/documents/a4-pagination/layout.ts src/components/documents/template-editor/template-details-panel.tsx src/components/documents/a4-page-editor.tsx src/services/document-export.service.ts
```

Expected: all commands exit 0 with zero failures or errors.

- [ ] **Step 6: Commit**

```powershell
git add -- src/services/document-export.service.ts docs/ARCHITECTURE.md __tests__/services/document-export-layout.test.ts __tests__/components/generated-document-layout.test.tsx __tests__/services/document-generator.service.test.ts __tests__/components/a4-page-editor.test.tsx
git commit -m "feat(documents): carry typography through export"
```

---

### Task 5: Full Verification

**Files:**
- No production changes expected. Any discovered feature defect requires a failing regression test before correction.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: fresh repository-wide verification evidence.

- [ ] **Step 1: Run the complete test suite**

```powershell
npm.cmd run test:run
```

Expected: exit 0 with zero failed tests.

- [ ] **Step 2: Run TypeScript, lint, and production build**

```powershell
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
```

Expected: all commands exit 0 with zero errors.

- [ ] **Step 3: Inspect the final scoped diff**

```powershell
git status --short
git diff --check
git log -5 --oneline
```

Expected: no whitespace errors; unrelated pre-existing changes remain unstaged and unmodified; feature commits are visible.

If verification exposes a feature defect, return to the affected task, add a
failing regression test, make it pass, rerun that task's complete verification,
and commit only the explicitly listed files from that task. Do not create an
empty verification commit.
