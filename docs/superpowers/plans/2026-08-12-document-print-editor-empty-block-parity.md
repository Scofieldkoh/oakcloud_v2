# Document Print and Editor Empty-Block Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated-document print, HTML, and PDF layout collapse empty paragraphs and divs exactly as the A4 editor does.

**Architecture:** Keep `buildA4PrintCss` as the single print/export stylesheet source. Remove only its print-specific empty-block minimum height, then exercise the emitted CSS in Chromium to prove empty blocks match the editor without changing ordered-list counters, marker columns, or continuation rules.

**Tech Stack:** TypeScript, React 19, Vitest, Vitest Browser with Playwright/Chromium, CSS paged media.

## Global Constraints

- Empty paragraphs and divs that collapse in the editor must not acquire print-only height.
- Preserve the existing `<br>` behavior for intentional blank lines.
- Do not change ordered-list counters, markers, hanging indents, continuation rules, or nested-list rules.
- Update existing documentation under `docs/`.
- Do not add dependencies or refactor unrelated editor code.

---

### Task 1: Enforce shared empty-block layout parity

**Files:**
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`
- Modify: `__tests__/components/a4-print-styles.test.ts`
- Modify: `src/components/documents/a4-print-styles.ts`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: `buildA4PrintCss(layout: A4DocumentLayout): string` and `DEFAULT_A4_DOCUMENT_LAYOUT`.
- Produces: Shared print CSS whose empty `p` and `div` elements have the same zero content-box height as the A4 editor while `<br>` and list CSS stay unchanged.

- [ ] **Step 1: Add the failing Chromium layout regression**

Add a browser test that injects `buildA4PrintCss(DEFAULT_A4_DOCUMENT_LAYOUT)` into a temporary document fixture containing an empty paragraph, an empty div, and an intentional `<p><br></p>`. Assert that the empty paragraph and div have zero content-box height while the `<br>` paragraph retains positive height. This catches the production mutation that restores `min-height: 1em` for empty blocks.

```tsx
it('matches editor empty-block height while preserving explicit line breaks', () => {
  const fixture = document.createElement('div');
  fixture.innerHTML = `
    <style>${buildA4PrintCss(DEFAULT_A4_DOCUMENT_LAYOUT)}</style>
    <div class="document-content">
      <p data-testid="empty-paragraph"></p>
      <div data-testid="empty-div"></div>
      <p data-testid="explicit-line"><br></p>
    </div>
  `;
  document.body.appendChild(fixture);

  const contentHeight = (selector: string) => {
    const element = fixture.querySelector<HTMLElement>(selector)!;
    const style = getComputedStyle(element);
    return element.getBoundingClientRect().height
      - Number.parseFloat(style.paddingTop)
      - Number.parseFloat(style.paddingBottom)
      - Number.parseFloat(style.borderTopWidth)
      - Number.parseFloat(style.borderBottomWidth);
  };

  expect(contentHeight('[data-testid="empty-paragraph"]')).toBe(0);
  expect(contentHeight('[data-testid="empty-div"]')).toBe(0);
  expect(contentHeight('[data-testid="explicit-line"]')).toBeGreaterThan(0);

  fixture.remove();
});
```

- [ ] **Step 2: Run the browser regression and verify RED**

Run:

```powershell
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx -t "matches editor empty-block height"
```

Expected: FAIL because the shared print CSS currently gives the empty paragraph and div a `1em` minimum height.

- [ ] **Step 3: Add the focused print-builder regression**

Extend `__tests__/components/a4-print-styles.test.ts` with a narrow builder-contract test confirming the output preserves `br { margin: 0; }` but emits no `p:empty` or `div:empty` minimum-height selector.

```ts
it('does not add print-only height to empty blocks', () => {
  const css = buildA4PrintCss(DEFAULT_A4_DOCUMENT_LAYOUT);
  expect(css).not.toContain('p:empty');
  expect(css).not.toContain('div:empty');
  expect(css).toContain('br { margin: 0; }');
});
```

- [ ] **Step 4: Implement the minimal shared CSS fix**

Delete only this rule from `src/components/documents/a4-print-styles.ts`:

```css
p:empty, div:empty { min-height: 1em; }
```

Do not alter the adjacent paragraph, line-height, `<br>`, list counter, marker, or continuation rules.

- [ ] **Step 5: Document the shared layout contract**

Update the A4 Editor Reliability Architecture section in `docs/ARCHITECTURE.md` to state that editor, preview, browser print, HTML export, and PDF export collapse empty paragraphs and divs identically, while `<br>` represents intentional blank lines.

- [ ] **Step 6: Verify GREEN with focused suites**

Run:

```powershell
npm.cmd run test:run -- __tests__/components/a4-print-styles.test.ts
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx -t "matches editor empty-block height"
```

Expected: both commands PASS with no failures.

- [ ] **Step 7: Run the relevant A4 regression suites**

Run:

```powershell
npm.cmd run test:run -- __tests__/components/a4-print-styles.test.ts __tests__/components/a4-pagination/engine.test.ts __tests__/components/generated-document-layout.test.tsx
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx
npm.cmd exec tsc -- --noEmit
git diff --check
```

Expected: all tests and TypeScript compilation PASS; `git diff --check` emits no output.

- [ ] **Step 8: Review the final diff and commit the implementation**

Review that only the planned test, shared CSS rule, and architecture documentation changed, then commit:

```powershell
git add __tests__/browser/a4-page-editor.browser.test.tsx __tests__/components/a4-print-styles.test.ts src/components/documents/a4-print-styles.ts docs/ARCHITECTURE.md docs/superpowers/plans/2026-08-12-document-print-editor-empty-block-parity.md
git commit -m "fix(documents): align print list pagination with editor"
```
