# A4 Editor Cross-Page List Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve list structure and numbering when bulleted, numbered, or nested-numbered items span multiple soft A4 pages.

**Architecture:** Keep canonical HTML and editor commands unchanged. The pagination engine will mark all mid-item list continuations and advance ordered counters only for genuine logical items; fragment reassembly will recursively merge nested list containers only when matching boundary item flow IDs prove they are continuations of one list.

**Tech Stack:** TypeScript, DOM Range/HTML APIs, React 19, Vitest with jsdom, Vitest Browser with Playwright Chromium.

**Spec:** `docs/superpowers/specs/2026-08-10-a4-editor-cross-page-list-continuation-design.md`

## Global Constraints

- Execute inline in the current workspace; do not use subagents or a separate worktree.
- Preserve canonical list structure and all existing editor command behavior.
- A marker appears only on the first fragment of a logical list item.
- Continuation fragments do not increment ordered-list counters.
- The following logical nested item advances normally, such as `3.2` after a multi-page `3.1`.
- Merge nested lists only when boundary list items have the same non-empty `data-flow-id` and the list tags match.
- Do not change persisted schemas, sanitizer allowlists, toolbar commands, hard-page-break behavior, or dependencies.
- Keep flow metadata derived and removable through `stripFlowMetadata`.

---

## File Structure

- Modify `src/components/documents/a4-pagination/engine.ts` — own list split metadata and counter progression.
- Modify `src/components/documents/a4-pagination/model.ts` — own recursive reassembly of proven list continuations.
- Modify `__tests__/components/a4-pagination/engine.test.ts` — cover multi-page counter state, bullet continuation marking, structural round trips, and repagination stability.
- Modify `__tests__/components/a4-pagination/model.test.ts` — cover precise recursive merge and the non-merge safety boundary.
- Modify `__tests__/browser/a4-page-editor.browser.test.tsx` — verify the behavior with real wrapped A4 layout in Chromium.

---

### Task 1: Continuation-Aware List Splitting

**Files:**
- Modify: `__tests__/components/a4-pagination/engine.test.ts`
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`
- Modify: `src/components/documents/a4-pagination/engine.ts`

**Interfaces:**
- Consumes: `paginateFlowHtml(input: string, measurer: HtmlMeasurer, maxHeight: number): PageFragment[]`.
- Produces: private `countLogicalListItems(items: HTMLElement[]): number`, generalized recursive list-continuation marking for both `OL` and `UL`, and a real-layout counter-state regression.

- [ ] **Step 1: Add a failing bullet-continuation test**

Extend the existing unordered-list split test so the second page must contain a continuation item:

```ts
expect(pages[1].content).toContain(
  'data-flow-continuation-item="true"',
);
```

This catches reverting the generalized `OL`/`UL` continuation branch to ordered lists only.

- [ ] **Step 2: Add a failing multi-page nested-counter test**

Use literal sequential tokens so each fragment is distinguishable and append a real following sub-item:

```ts
it('keeps nested counter state stable when one item spans several pages', () => {
  const longText = Array.from(
    { length: 80 },
    (_, index) => `w${String(index + 1).padStart(3, '0')}`,
  ).join(' ');
  const canonical = hydrateFlowHtml(
    `<ol start="3"><li><p>Confidentiality</p><ol>` +
      `<li><p>${longText}</p></li>` +
      '<li><p>Next sub-item</p></li></ol></li></ol>',
  );
  const pages = paginateFlowHtml(canonical, characterMeasurer, 80);

  expect(pages.length).toBeGreaterThan(2);
  const continuationPages = pages.slice(1);
  continuationPages.forEach((page) => {
    const root = document.createElement('div');
    root.innerHTML = page.content;
    const outer = root.querySelector<HTMLElement>(':scope > ol');
    const nested = outer?.querySelector<HTMLElement>('ol');
    expect(outer?.style.getPropertyValue('--flow-list-start')).toBe('3');
    expect(nested?.style.getPropertyValue('--flow-list-start')).toBe('1');
  });

  const last = document.createElement('div');
  last.innerHTML = pages.at(-1)!.content;
  const next = Array.from(last.querySelectorAll('li')).find(
    (item) => item.textContent === 'Next sub-item',
  );
  expect(next).toBeDefined();
  expect(next?.hasAttribute('data-flow-continuation-item')).toBe(false);
  expect(next?.parentElement?.style.getPropertyValue('--flow-list-start'))
    .toBe('1');
});
```

The production mutation this catches is counting a continuation `li` as a new numbered item.

- [ ] **Step 3: Add a failing real-layout counter-state regression**

Change the existing browser fixture to use outer start `3`, retain one long nested item, and assert every continuation page keeps outer start `3` and nested start `1`:

```tsx
value={
  `<ol start="3"><li><p>Parent</p><ol>` +
  `<li><p>${longText}</p></li></ol></li></ol>`
}
```

```ts
const pageContents = Array.from(
  host.querySelectorAll<HTMLElement>(
    '[data-testid^="a4-page-content-"]',
  ),
);
pageContents.slice(1).forEach((page) => {
  const outer = page.querySelector<HTMLElement>(':scope > ol');
  const nested = outer?.querySelector<HTMLElement>('ol');
  expect(outer?.style.getPropertyValue('--flow-list-start')).toBe('3');
  expect(nested?.style.getPropertyValue('--flow-list-start')).toBe('1');
});
```

- [ ] **Step 4: Run the focused unit and browser tests and verify RED**

Run:

```powershell
npm.cmd run test:run -- --run __tests__/components/a4-pagination/engine.test.ts
npm.cmd run test:browser -- --run __tests__/browser/a4-page-editor.browser.test.tsx -t "does not repeat the marker when a nested list item splits across pages"
```

Expected: the bullet assertion fails because `UL` continuations are not marked, and both unit and browser continuation pages after page 2 report drifting list starts instead of outer `3` and nested `1`.

- [ ] **Step 5: Generalize mid-item continuation marking**

In `splitTextElement`, call the recursive marker for both list tags:

```ts
if (element.tagName === 'OL' || element.tagName === 'UL') {
  markListContinuation(element, fit, overflow);
}
```

Rename `markOrderedListContinuation` to `markListContinuation`; keep `markListContinuationLevel` recursive so nested ordered/unordered combinations inherit marker suppression.

- [ ] **Step 6: Count only logical items**

Add one private helper and use it in both `splitListBetweenItems` and `markListContinuationLevel`:

```ts
function countLogicalListItems(items: HTMLElement[]): number {
  return items.filter(
    (item) => !item.hasAttribute('data-flow-continuation-item'),
  ).length;
}
```

Replace `fitItems.length` in the recursive counter calculation with:

```ts
const countedFitItems = countLogicalListItems(fitItems);
overflowList.style.setProperty(
  '--flow-list-start',
  String(runningStart + countedFitItems),
);
```

Use `directListItems(element)` rather than an untyped child filter at item-boundary splits, and reuse `countLogicalListItems(items.slice(0, best))` there.

- [ ] **Step 7: Run the focused unit and browser tests and verify GREEN**

Run both Step 4 commands. Expected: all focused tests pass with stable counter start metadata and bullet continuation marking.

- [ ] **Step 8: Commit Task 1**

```powershell
git add -- src/components/documents/a4-pagination/engine.ts __tests__/components/a4-pagination/engine.test.ts __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "fix(editor): stabilize list counters across page continuations"
```

---

### Task 2: Recursive Nested-List Reassembly

**Files:**
- Modify: `__tests__/components/a4-pagination/model.test.ts`
- Modify: `__tests__/components/a4-pagination/engine.test.ts`
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`
- Modify: `src/components/documents/a4-pagination/model.ts`

**Interfaces:**
- Consumes: existing private `appendContinuation(target: HTMLElement, source: HTMLElement): void` and public `reassemblePageFragments(pages: PageFragment[]): string`.
- Produces: private `mergeBoundaryListContinuation(targetItem: HTMLElement, sourceItem: HTMLElement): void`, which recursively consumes only a proven source boundary list.

- [ ] **Step 1: Add a failing model regression for a proven nested continuation**

Construct two literal physical fragments with stable IDs. The target outer item ends with an `ol`; the source continuation item begins with an `ol`; their boundary nested items share `data-flow-id="nested-item"`:

```ts
it('recursively merges a proven nested-list continuation', () => {
  const reassembled = reassemblePageFragments([
    {
      hardBreakBefore: false,
      content:
        '<ol data-flow-id="outer-list"><li data-flow-id="outer-item">' +
        '<p>Parent</p><ol><li data-flow-id="nested-item"><p>First</p></li></ol>' +
        '</li></ol>',
    },
    {
      hardBreakBefore: false,
      content:
        '<ol data-flow-id="outer-list" data-flow-continuation="end">' +
        '<li data-flow-id="outer-item" data-flow-continuation-item="true">' +
        '<ol style="--flow-list-start: 1">' +
        '<li data-flow-id="nested-item" data-flow-continuation-item="true"><p>Second</p></li>' +
        '<li data-flow-id="next-item"><p>Next</p></li>' +
        '</ol></li></ol>',
    },
  ]);
  const root = document.createElement('div');
  root.innerHTML = reassembled;

  expect(root.querySelectorAll('ol')).toHaveLength(2);
  expect(root.querySelectorAll('ol ol')).toHaveLength(1);
  expect(root.querySelectorAll('ol ol > li')).toHaveLength(2);
  expect(root.querySelector('ol ol')?.textContent).toBe('FirstSecondNext');
});
```

The production mutation this catches is appending the source nested `ol` to the outer `li` instead of recursively merging it.

- [ ] **Step 2: Add a failing non-merge safety test**

Use the same two-fragment shape but give the source boundary item `data-flow-id="different-item"`. Assert `root.querySelectorAll('ol ol')` has length `2`. This prevents a broad tag-adjacency merge from collapsing intentionally separate nested lists.

- [ ] **Step 3: Add a failing real-pagination structural round-trip test**

In `engine.test.ts`, paginate the multi-page nested fixture from Task 1, reassemble it, and assert:

```ts
const reassembledRoot = document.createElement('div');
reassembledRoot.innerHTML = reassemblePageFragments(pages);
expect(reassembledRoot.querySelectorAll(':scope > ol')).toHaveLength(1);
expect(reassembledRoot.querySelectorAll('ol ol')).toHaveLength(1);
expect(reassembledRoot.querySelectorAll('ol ol > li')).toHaveLength(2);

const repaginated = paginateFlowHtml(
  reassemblePageFragments(pages),
  characterMeasurer,
  80,
);
const secondRoot = document.createElement('div');
secondRoot.innerHTML = reassemblePageFragments(repaginated);
expect(secondRoot.querySelectorAll('ol ol')).toHaveLength(1);
expect(secondRoot.querySelectorAll('ol ol > li')).toHaveLength(2);
```

This catches list/list-item proliferation across repeated repagination.

- [ ] **Step 4: Extend the browser fixture with the following logical item**

Append a real following sub-item to the fixture introduced in Task 1:

```tsx
value={
  `<ol start="3"><li><p>Parent</p><ol>` +
  `<li><p>${longText}</p></li>` +
  '<li><p>Next sub-item</p></li></ol></li></ol>'
}
```

Assert the following item shares one continued nested list with the continuation item:

```ts
const nextParagraph = Array.from(host.querySelectorAll('p')).find(
  (paragraph) => paragraph.textContent === 'Next sub-item',
)!;
const continuedNestedList = nextParagraph.closest('ol') as HTMLElement;
const directItems = Array.from(continuedNestedList.children).filter(
  (child) => child.tagName === 'LI',
);
expect(continuedNestedList.style.getPropertyValue('--flow-list-start'))
  .toBe('1');
expect(directItems).toHaveLength(2);
expect(directItems[0].hasAttribute('data-flow-continuation-item')).toBe(true);
expect(directItems[1].hasAttribute('data-flow-continuation-item')).toBe(false);
```

- [ ] **Step 5: Run focused model, engine, and browser tests and verify RED**

Run:

```powershell
npm.cmd run test:run -- --run __tests__/components/a4-pagination/model.test.ts __tests__/components/a4-pagination/engine.test.ts
npm.cmd run test:browser -- --run __tests__/browser/a4-page-editor.browser.test.tsx -t "does not repeat the marker when a nested list item splits across pages"
```

Expected: the proven-continuation, real-pagination structure, and browser direct-item assertions fail because each page fragment becomes a sibling nested list; the different-ID safety test already passes.

- [ ] **Step 6: Implement the boundary-proof helper**

Add private helpers to `model.ts`:

```ts
function isListElement(element: Element | null): element is HTMLElement {
  return element?.tagName === 'OL' || element?.tagName === 'UL';
}

function mergeBoundaryListContinuation(
  targetItem: HTMLElement,
  sourceItem: HTMLElement,
): void {
  const targetList = targetItem.lastElementChild;
  const sourceList = sourceItem.firstElementChild;
  if (
    !isListElement(targetList) ||
    !isListElement(sourceList) ||
    targetList.tagName !== sourceList.tagName
  ) {
    return;
  }

  const targetBoundary = targetList.lastElementChild as HTMLElement | null;
  const sourceBoundary = sourceList.firstElementChild as HTMLElement | null;
  if (!targetBoundary || !sourceBoundary) return;

  const boundaryFlowId = targetBoundary.dataset.flowId;
  if (
    !boundaryFlowId ||
    sourceBoundary.dataset.flowId !== boundaryFlowId ||
    targetBoundary.tagName !== sourceBoundary.tagName
  ) {
    return;
  }

  appendContinuation(targetList, sourceList);
  sourceList.remove();
}
```

At the start of the matching-list-item branch inside `appendContinuation`, call:

```ts
mergeBoundaryListContinuation(targetItem, sourceItem);
appendContinuation(targetItem, sourceItem);
sourceItem.remove();
```

Because the helper removes only the proven boundary source list, the existing generic item merge appends any remaining independent children unchanged. Recursive calls handle deeper `ol`/`ul` combinations.

- [ ] **Step 7: Run focused model, engine, and browser tests and verify GREEN**

Run both Step 5 commands. Expected: all tests pass, including the different-flow-ID non-merge case.

- [ ] **Step 8: Run the A4 pagination component group**

Run:

```powershell
npm.cmd run test:run -- --run __tests__/components/a4-pagination __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-page-editor-ssr.test.tsx __tests__/components/a4-print-styles.test.ts
```

Expected: all selected suites pass with no new warnings.

- [ ] **Step 9: Commit Task 2**

```powershell
git add -- src/components/documents/a4-pagination/model.ts __tests__/components/a4-pagination/model.test.ts __tests__/components/a4-pagination/engine.test.ts __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "fix(editor): reassemble nested list continuations"
```

---

### Task 3: Final Verification

**Files:**
- Verify only; production and regression-test edits are complete in Tasks 1 and 2.

**Interfaces:**
- Consumes: the focused jsdom and Chromium regressions added in Tasks 1 and 2.
- Produces: final test, static-analysis, rendered-QA, and repository-state evidence.

- [ ] **Step 1: Run the focused browser regression**

Run:

```powershell
npm.cmd run test:browser -- --run __tests__/browser/a4-page-editor.browser.test.tsx -t "does not repeat the marker when a nested list item splits across pages"
```

Expected: PASS after Tasks 1 and 2. If the test fails for an unrelated browser harness issue, record the exact output and do not weaken the behavior assertions.

- [ ] **Step 2: Run the full A4 browser editor suite**

Run:

```powershell
npm.cmd run test:browser -- --run __tests__/browser/a4-page-editor.browser.test.tsx
```

Expected: all tests pass except the documented pre-existing blank-page flake `GEN-006`, if it reproduces. Rerun only that known flaky case once to distinguish the documented flake from the list change.

- [ ] **Step 3: Run formatting and type checks for changed files**

Run:

```powershell
npx.cmd eslint src/components/documents/a4-pagination/engine.ts src/components/documents/a4-pagination/model.ts __tests__/components/a4-pagination/engine.test.ts __tests__/components/a4-pagination/model.test.ts __tests__/browser/a4-page-editor.browser.test.tsx
npx.cmd tsc --noEmit --pretty false
git diff --check
```

Expected: exit code `0` for all commands and no whitespace errors.

- [ ] **Step 4: Perform rendered browser QA**

The flow under test is: A4 template editor loads a nested `3.1` item long enough to span several soft pages -> continuation pages suppress repeated markers -> the next nested item appears in the same continued list with stable outer `3` and inner start `1`, rendering as `3.2`.

Use the in-app Browser when a runnable authenticated local editor route is available. Verify page identity, non-blank content, no framework overlay, console health, a screenshot of the boundary page, and the target interaction/state. If no authenticated local route is available, retain the Vitest Browser Chromium result as the rendered proof and report that live route QA remains untested.

- [ ] **Step 5: Verify repository state and summarize evidence**

Run:

```powershell
git status --short
git log -4 --oneline
```

Expected: clean status, with the plan/design documentation and the two focused implementation commits visible.

---

## Self-Review

- Spec coverage: Task 1 covers continuation marker and counter state; Task 2 covers canonical structural reassembly and non-merge safety; Task 3 covers real Chromium layout and final verification.
- Scope: no editor command, sanitizer, schema, dependency, toolbar, or hard-page-break changes.
- Type consistency: `countLogicalListItems(items: HTMLElement[])` is private to `engine.ts`; `mergeBoundaryListContinuation(targetItem: HTMLElement, sourceItem: HTMLElement)` is private to `model.ts`; public pagination interfaces stay unchanged.
- Mutation checks: removing UL continuation marking, counting continuation items, always merging adjacent lists, or removing recursive boundary merge each causes a named regression test to fail.
