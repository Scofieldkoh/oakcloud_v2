# A4 Editor List Numbering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add flush-left lists, CSS-counter numbering (1. / 1.1 / a)), custom start values, li-level plain indent, a nested-list toolbar toggle, and a robust Enter-twice exit to the A4 editor.

**Architecture:** Ordered-list markers move from native `list-style-type` to CSS counters (`counter-reset`/`::before`), shared by the editor's inline styles and `buildA4PrintCss`. New formatting transactions (`applyListToSelection` alpha support, sink/lift, list start, indent-on-li) operate on the canonical HTML. Enter handling in `document-actions.ts` forwards a fast second Enter to the empty trailing item.

**Tech Stack:** React/Next.js, TypeScript, jsdom + Vitest, Vitest Browser (Playwright Chromium), CSS counters, DOMPurify.

**Spec:** `docs/superpowers/specs/2026-08-10-a4-editor-list-numbering-design.md`

## Global Constraints

- Canonical list structure stays `ol/ul > li > p`; flow ids stay on `ol` and `li`.
- `start` must be added to every DOMPurify `ALLOWED_ATTR` list that can carry list HTML.
- Both A4 CSS sources (editor inline `<style>` and `buildA4PrintCss`) must receive identical list rules.
- Plain indent stays a margin shift (no numbering change); indent target is the `li`.
- Nested list numbering renders 1.1 / 1.2 via `counters(item, ".") " "`.
- Alpha lists use class `list-alpha` and render `counter(item, lower-alpha) ") "`.
- No subagents without explicit user approval; execute inline with checkpoints at each task's test run.

---

## File Structure

- Modify `src/components/documents/a4-pagination/formatting.ts` — format state, alpha, sink/lift, list start, indent-on-li.
- Modify `src/components/documents/a4-pagination/document-actions.ts` — `start` sanitize allowlist, Enter-twice forwarding.
- Modify `src/components/documents/a4-page-editor.tsx` — inline list CSS, sanitizer allowlist, command wiring, `listStart` state initialization.
- Modify `src/components/documents/a4-editor-toolbar.tsx` — alpha button, nested-list button, Start-at input, command types.
- Modify `src/components/documents/a4-print-styles.ts` — counter CSS for print/export.
- Tests under `__tests__/components/...` and `__tests__/browser/...`.

---

### Task 1: Shared list CSS (counters, flush markers, alpha, nested)

**Files:**
- Modify: `src/components/documents/a4-print-styles.ts`
- Modify: `src/components/documents/a4-page-editor.tsx` (inline `<style>` block, list rules only)
- Test: `__tests__/components/a4-print-styles.test.ts`

**Interfaces:**
- Consumes: existing `buildA4PrintCss(layout)`.
- Produces: CSS string containing `counter-reset: item var(--list-start, 0)`, `ol > li::before`, `ol.list-alpha > li::before`, `ol ol`, and `list-style-position: inside` for `ul`.

- [ ] **Step 1:** Add tests asserting the built CSS contains the counter rules and that `ol`/`ul` have `padding-left: 0`, `ul` uses `disc inside`, nested lists use `padding-left: 1.5em`.
- [ ] **Step 2:** Run the test and confirm it fails.
- [ ] **Step 3:** Update `buildA4PrintCss` and the editor's inline `<style>` with the rules below.

```css
ul, ol { margin: 0 0 1em 0; padding-left: 0; }
ul { list-style: disc inside; }
ol { list-style: none; counter-reset: item var(--list-start, 0); }
ol > li { counter-increment: item; }
ol > li::before { content: counter(item) ". "; }
ol.list-alpha > li::before { content: counter(item, lower-alpha) ") "; }
ol ol, ol ul, ul ol, ul ul { padding-left: 1.5em; }
ol ol { counter-reset: item; }
ol ol > li::before { content: counters(item, ".") " "; }
```

Keep existing `li { display: list-item; margin: 0 0 0.25em 0; }` and `li::before` must not affect bullets (`ul` keeps native markers).

- [ ] **Step 4:** Run the print-styles test and the A4 jsdom suite; expect green.

---

### Task 2: Sanitizer allowlist for `start`

**Files:**
- Modify: `src/components/documents/a4-page-editor.tsx` (`sanitizeHtml` ALLOWED_ATTR)
- Modify: `src/components/documents/a4-pagination/document-actions.ts` (`sanitizeReplacementHtml` ALLOWED_ATTR)

**Interfaces:**
- Produces: `start` accepted in list HTML everywhere lists can enter the document.

- [ ] **Step 1:** Add `'start'` to both ALLOWED_ATTR arrays.
- [ ] **Step 2:** Add a unit test in `__tests__/components/a4-pagination/document-actions.test.ts` asserting `replaceLogicalSelection` preserves `<ol start="3">` through sanitization.
- [ ] **Step 3:** Run the document-actions tests.

---

### Task 3: Format state — alpha list and list start

**Files:**
- Modify: `src/components/documents/a4-pagination/formatting.ts`
- Test: `__tests__/components/a4-pagination/formatting.test.ts`

**Interfaces:**
- Produces: `EditorFormatState.list: 'none' | 'ordered' | 'unordered' | 'alpha'`; `EditorFormatState.listStart: number`; `readLogicalFormatState` returns `list: 'alpha'` for `ol.list-alpha` and `listStart` from `start` (default 1).

- [ ] **Step 1:** Extend the type and `defaultFormatState`; update `readFormatStateAtPoint` to detect `list-alpha` and read `start`.
- [ ] **Step 2:** Add tests for alpha detection and `listStart` (start=2 → 2, no attr → 1).
- [ ] **Step 3:** Update `src/components/documents/a4-page-editor.tsx` initial `activeFormats` state with `listStart: 1`.

---

### Task 4: `applyListToSelection` alpha support

**Files:**
- Modify: `src/components/documents/a4-pagination/formatting.ts`
- Test: `__tests__/components/a4-pagination/formatting.test.ts`

**Interfaces:**
- Produces: `applyListToSelection(html, selection, 'ordered' | 'unordered' | 'alpha')`.
- Semantics: `alpha` creates/keeps `ol.list-alpha`; clicking alpha on a decimal list converts it; clicking alpha on an alpha list toggles off; clicking numbered on an alpha list converts to decimal; clicking numbered on a decimal list toggles off; bullets convert both ways.

- [ ] **Step 1:** Add failing tests for the four transitions.
- [ ] **Step 2:** Implement `listMatchesType`/class handling in `applyListToSelection`.
- [ ] **Step 3:** Run formatting tests.

---

### Task 5: Sink and lift (nested-list toolbar toggle)

**Files:**
- Modify: `src/components/documents/a4-pagination/formatting.ts`
- Test: `__tests__/components/a4-pagination/formatting.test.ts`

**Interfaces:**
- Produces: `sinkSelectionToSubList(html, selection): DocumentTransactionResult` and `liftSelectionFromSubList(html, selection): DocumentTransactionResult`.
- Sink: selected `li` (not the first in its list) moves into a nested list of the same tag/class appended inside the previous `li` (reusing an existing trailing nested list of the same tag).
- Lift: selected `li` whose parent list is nested (parent `li`) moves back to the parent list after its owning `li`; empty nested lists are removed.
- Both preserve flow ids via `hydrateFlowContainer` + `normalizeEditedFlowIds` and return `changed: false` when nothing applies.

- [ ] **Step 1:** Add failing tests: sink second item → `li > ol > li`; second sink appends to same nested list; lift restores parent list and removes empty nested list; sink first item is a no-op; nested numbering structure renders 1.1 (CSS-level assertion deferred to browser tests).
- [ ] **Step 2:** Implement both functions in `formatting.ts` (export them).
- [ ] **Step 3:** Run formatting tests.

---

### Task 6: Plain indent on `li`

**Files:**
- Modify: `src/components/documents/a4-pagination/formatting.ts`
- Test: `__tests__/components/a4-page-editor.test.tsx` (VR2-02 assertions) and formatting tests

**Interfaces:**
- Produces: `applyIndentToSelection`/`applyOutdentToSelection` apply `margin-left` to the `li` when the block is inside a list, otherwise to the block itself. Steps remain 2em.

- [ ] **Step 1:** Update the VR2-02 test to expect `li.style.marginLeft` (2em/4em) instead of `ul > li > p`.
- [ ] **Step 2:** Implement target selection (block → `block.parentElement` when it is an `li`).
- [ ] **Step 3:** Run `a4-page-editor.test.tsx` and formatting tests.

---

### Task 7: List start transaction + toolbar Start-at input

**Files:**
- Modify: `src/components/documents/a4-pagination/formatting.ts`
- Modify: `src/components/documents/a4-editor-toolbar.tsx`
- Modify: `src/components/documents/a4-page-editor.tsx`
- Test: `__tests__/components/a4-pagination/formatting.test.ts`, `__tests__/components/a4-editor-toolbar.test.tsx`

**Interfaces:**
- Produces: `applyListStartToSelection(html, selection, start: number): DocumentTransactionResult`; editor command `{ type: 'list-start'; value: number }`; toolbar shows a numeric input when `activeFormats.list` is `'ordered'` or `'alpha'`.
- `start=1` removes `start` and `--list-start`; `start>1` sets `start` and inline `--list-start: N-1`.

- [ ] **Step 1:** Add unit tests for start set/remove.
- [ ] **Step 2:** Implement `applyListStartToSelection` and export it.
- [ ] **Step 3:** Add `list-start` to `EditorCommand` union, render the input in the toolbar, wire the editor command.
- [ ] **Step 4:** Add toolbar tests (input visible for ordered/alpha, hidden otherwise; changing value dispatches `list-start`).

---

### Task 8: Enter-twice forwarding in `insertParagraphAtSelection`

**Files:**
- Modify: `src/components/documents/a4-pagination/document-actions.ts`
- Test: `__tests__/components/a4-pagination/document-actions.test.ts`, browser test

**Interfaces:**
- Produces: when the collapsed caret is at the end of a non-empty `li` whose next sibling is an empty `li` that is the last item in its list, `insertParagraphAtSelection` exits the list (reusing `exitEmptyListItem`) instead of splitting.

- [ ] **Step 1:** Add unit tests: end-of-item + trailing empty item → exit; end-of-item + non-empty next item → split; caret not at end → split.
- [ ] **Step 2:** Implement the forwarding branch before the split path.
- [ ] **Step 3:** Run document-actions tests.

---

### Task 9: Browser end-to-end tests and toolbar wiring

**Files:**
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`
- Modify: `src/components/documents/a4-editor-toolbar.tsx`, `src/components/documents/a4-page-editor.tsx` (final wiring)

**Interfaces:**
- Consumes: all tasks above.
- Produces: browser tests for rapid double-Enter exit, alpha toggle (`b) ` marker), nested button (1.1 marker), Start-at 2 (`2. ` marker), indent moving marker.

- [ ] **Step 1:** Add browser tests using the existing harness (`waitForEditorIdle`, `pressEnter`, toolbar button lookup) and `getComputedStyle(el, '::before').content` for marker assertions.
- [ ] **Step 2:** Wire remaining toolbar buttons and commands; fix failures.
- [ ] **Step 3:** Run the full A4 jsdom suite and the browser suite; expect all green except the known pre-existing blank-page flake (GEN-006).

---

## Self-Review

- Spec coverage: flush markers (T1), sub-numbering 1.1 (T1 + T5), alpha (T1 + T4), indent moves number (T6), start at N (T2 + T3 + T7), Enter-twice exit (T8 + T9). Toolbar changes (T4/T5/T7/T9). Sanitizers (T2). Tests (all tasks).
- Placeholders: none; every task names exact files, interfaces, and verification commands.
- Type consistency: `applyListToSelection` listType extended in T4 and consumed by T9; `listStart` added in T3 and consumed by T7; sink/lift exported in T5 and wired in T9.
