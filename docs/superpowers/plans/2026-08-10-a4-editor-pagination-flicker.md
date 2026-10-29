# A4 Editor Pagination Flicker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep A4 pages visually and logically stable while Enter and related canonical transactions repaginate.

**Architecture:** Keep the current physical `pages` state mounted until the asynchronous paginator has produced a complete replacement. Reuse IDs from the currently rendered physical pages and install page HTML during the layout phase so one committed pagination result corresponds to one browser paint.

**Tech Stack:** React 19, TypeScript, Vitest Browser Mode, Playwright-backed browser tests

## Global Constraints

- Work inline in the current workspace without subagents or a separate worktree.
- Do not run a full build or full test suite.
- Preserve canonical HTML, hard-page breaks, history, scroll, and logical selection behavior.
- Limit production changes to the A4 editor pagination/render lifecycle.

---

### Task 1: Atomic A4 pagination publication

**Files:**
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`
- Modify: `src/components/documents/a4-page-editor.tsx`

**Interfaces:**
- Consumes: `scheduleReflow(sourcePages: PageData[], emitChange: boolean)` and `insertParagraphAtSelection(...)`
- Produces: an atomic reflow lifecycle in which `pages` contains only committed physical fragments and retained physical pages keep their `data-page-id`

- [ ] **Step 1: Write the failing browser regression**

Add a test beside the existing Enter pagination cases. After a long document reaches multiple pages, save the physical page elements and page IDs, replace `requestAnimationFrame` with a controlled callback queue, and dispatch a cancelable `beforeinput` event with `inputType: 'insertParagraph'`. Before releasing the queued callbacks, assert that the page count and page element identities equal the committed layout and that `aria-busy` is `true`. Release both reflow frames, then assert retained page IDs and nodes remain stable, the canonical paragraphs contain both sides of the split, and the caret is restored to the new paragraph.

- [ ] **Step 2: Run the regression and verify RED**

Run:

```powershell
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx -t "keeps committed pages mounted while Enter repaginates"
```

Expected: FAIL before queued frames are released because the current logical transaction publishes hard-section-only pages and collapses the physical page list.

- [ ] **Step 3: Implement atomic publication**

In `a4-page-editor.tsx`:

```tsx
const renderedPagesRef = useRef<PageData[]>(pages);
renderedPagesRef.current = pages;
```

Capture the currently rendered pages when `scheduleReflow` starts and use their IDs when mapping final fragments. Keep `pagesRef` as the latest canonical reflow source, but remove the intermediate `setPages(nextPages)` from `commitUserTransaction`; only the completed paginator publishes `setPages(nextPages)`. Change the page-content synchronization from `useEffect` to `useLayoutEffect` so newly committed content is installed before paint.

- [ ] **Step 4: Run the focused regression and verify GREEN**

Run the command from Step 2. Expected: PASS with the physical page list mounted throughout the gated reflow.

- [ ] **Step 5: Run narrow related regression tests**

Run:

```powershell
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx -t "Enter|page bottom|next page|word across page boundaries"
npm.cmd run test:run -- __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-pagination/engine.test.ts __tests__/components/a4-pagination/document-actions.test.ts
```

Expected: all selected tests pass with no relevant warnings or console errors.

- [ ] **Step 6: Perform live rendered QA**

Reload `http://localhost:3000/template-partials/editor`, create a multi-page draft, press Enter near and across a page boundary, and verify the URL/title, non-blank editor, absence of framework overlays and relevant console warnings, stable page rendering, caret movement, and screenshot evidence.

- [ ] **Step 7: Review the final diff**

Run `git diff --check`, inspect `git diff -- src/components/documents/a4-page-editor.tsx __tests__/browser/a4-page-editor.browser.test.tsx`, and confirm there are no unrelated edits.

