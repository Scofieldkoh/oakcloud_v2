# A4 Editor Second-Round Fix Verification and Follow-up Plan

**Review date:** 2026-08-10  
**Reviewed baseline:** `a58b97f` plus the second-round working-tree implementation  
**Previous review:** `docs/superpowers/plans/2026-08-09-a4-editor-reliability-remediation.md`  
**Scope:** Document Generation and Templates A4 editor drafting, typing, selection replacement, Backspace/Delete, font controls, inline and paragraph formatting, colour, paste, tables, lists, page layout, pagination, history, preview, responsive layout, production rendering, and verification gates.

## Second-Round Outcome

The second-round implementation materially improves the editor and removes the production server-render failure. Five of the eight prior findings are fully resolved. Three are only partially resolved, and two user-facing regressions plus one release-verification blocker remain.

The implementation is not ready to close as fully remediated.

### Status Summary

| Status | Count | Items |
|---|---:|---|
| Fully resolved | 5 | IR-01, IR-03, IR-05, IR-06, IR-08 |
| Partially resolved | 3 | IR-02, IR-04, IR-07 |
| New user-facing regression | 1 | VR2-02 list editing |
| Verification/release blocker | 1 | VR2-04 default test and lint gates |

## Prior-Finding Closure Matrix

| Prior ID | Second-round result | Evidence |
|---|---|---|
| IR-01: Enter over a selection | **Resolved.** | Forward and reversed selection transactions delete the range before splitting. Focused and real-Chromium regressions pass. |
| IR-02: rich paste structure and flow IDs | **Partially resolved.** | Clipboard flow metadata is stripped and paragraph-block paste is normalized. The shared block classifier still excludes `ul`, `ol`, `table`, and `hr`, so the transaction can emit invalid block-inside-paragraph HTML before the component reparses it. See VR2-03. |
| IR-03: insertion fallback to document end | **Resolved.** | Placeholder, HTML, generated-content, table, row, and column insertions now use logical transactions. A stale bookmark leaves content and history unchanged and surfaces a recoverable status. |
| IR-04: inline toggle and caret typing | **Partially resolved.** | Positive caret typing and end-of-wrapper cancellation work. Selected Bold/Italic/Underline remain one-way, pending formats cannot be toggled reliably before typing, and cancellation in the middle of a wrapper inserts at the wrong position. See VR2-01. |
| IR-05: partial clear formatting | **Resolved for the covered path.** | A selected substring is split out of its formatting wrapper while surrounding formatting is preserved. Focused and Chromium regressions pass. |
| IR-06: controlled colour synchronization | **Resolved.** | RGB, named, and shorthand colours normalize to `#rrggbb`; the selected red-text control reports `#ff0000`. |
| IR-07: multi-block paragraph styles and warning-clean tests | **Partially resolved.** | Multi-block paragraph styling now preserves the logical bookmark and passes Chromium. The Chromium suite is warning-clean, but the save/reopen integration test is timing-sensitive and the scoped lint gate fails. See VR2-04. |
| IR-08: DOM access during production server rendering | **Resolved.** | Hard-section counting is DOM-free. Four `renderToString` cases pass without browser globals; the Docker route smoke passes 2/2; direct authenticated loads have no React `#419`; browser and container logs are clean. |

## Residual and New Findings

### VR2-01 — P1: inline-format toggling is still incomplete and can move typed text

**User-visible behavior**

- Selecting `Toggle`, clicking Bold, selecting it again, and clicking Bold a second time leaves the text bold.
- Cancelling Bold at a caret in the middle of bold text can place the next character before the whole bold span instead of at the caret.
- A property-specific null patch such as `{ fontWeight: null }` is treated as a request to clear every inline format from the selection, so colour and italic styling are also removed from the selected substring.

**Confirmed evidence**

- Authenticated Docker QA produced one bold span after the first click and the same one bold span after the second click.
- A direct transaction probe for `<span style="font-weight:bold">abc</span>` at offset 1 with `X` and `{ fontWeight: null }` returned `X<span style="font-weight:bold">abc</span>` (`Xabc`) instead of bold `a`, plain `X`, bold `bc` (`aXbc`).
- A direct selection probe over text carrying bold, red, and italic styles with `{ fontWeight: null }` left the selected substring completely unformatted rather than preserving red and italic.

**Root cause**

- `applyFormattingTransaction` derives toggle state only for collapsed bookmarks. Non-collapsed selections always send the positive patch to `applyInlineFormat`.
- Toggle derivation reads persisted markup and does not treat the pending typing patch as the active state, so a format selected before typing cannot be toggled back off reliably.
- `isClearPatch` treats any patch containing only null values as full clear-formatting instead of removing only the requested properties.
- `prepareCaretForPatch` inserts a cloned leading wrapper before the original but returns the old parent index. The insertion point is therefore before the clone; the middle case must return the boundary between the leading clone and trailing wrapper.

**Impact**

Core formatting controls disagree with conventional editor behavior. Text can be inserted at the wrong logical position, and fixing the one-way toggle without property-aware removal would introduce collateral formatting loss.

### VR2-02 — P1: list conversion produces content that later paragraph commands cannot edit

**User-visible behavior**

- Converting `Item` to a bulleted list works once.
- Clicking Bulleted list again does not toggle the list off.
- Align center, Increase indent, Decrease indent, paragraph style, and list-type switching are no-ops while the caret or selection is in the generated list item.
- Selecting two paragraphs and applying a list creates two one-item lists instead of one list with two items.

**Confirmed evidence**

- Live Docker QA kept the same `<ul><li>Item</li></ul>` after the second Bulleted list click; Align center added no `text-align` style.
- Direct transactions returned `changed: false` for list toggle and alignment after conversion.
- A two-paragraph probe returned two sibling `ul` elements rather than one `ul` with two `li` children.

**Root cause**

- `intersectedBlocks` searches only `p`, headings, and `blockquote`; it excludes `li`.
- `applyListToSelection` moves a paragraph's children directly into `li`, so no searchable paragraph block remains inside the list item.
- The toggle-off branch expects a block inside each `li`, which the conversion branch never creates.
- Each selected source block creates its own list wrapper rather than grouping adjacent selected blocks.

**Impact**

Lists become a formatting dead end after creation. Users cannot correct list type, alignment, indentation, or paragraph style without manually deleting and reconstructing content.

### VR2-03 — P2: rich replacement still has an incomplete block classifier

**User-visible behavior**

The rendered component currently reparses and usually normalizes table/list paste before display, but the underlying transaction can emit invalid canonical HTML and can add unexpected blank paragraphs around the pasted block.

**Confirmed evidence**

- `BLOCK_REPLACEMENT_TAGS` and `CONTAINING_BLOCK_TAGS` cover paragraphs, headings, `div`, and `blockquote`, but not `ul`, `ol`, `table`, or `hr` despite the helper contract explicitly mentioning lists and tables.
- A direct mid-paragraph table probe returned `<p>Alpha<table>...</table>Beta</p>`.
- A direct list probe returned a serialized `ul` inside the paragraph transaction. Reparsing moved the list out of the paragraph and left trailing content requiring later flow hydration.
- Live table paste ultimately rendered a top-level table, but also retained empty boundary paragraphs. Flow metadata stripping itself worked.

**Impact**

The pure transaction no longer guarantees canonical structure. Caret offsets and flow hydration depend on a later component reparse, and any direct consumer of the transaction can persist malformed structure.

### VR2-04 — P1 release blocker: the default verification gates are not green

**Confirmed evidence**

- Focused matrix: 19 files; 167 tests passed, one failed, and two production-smoke tests were skipped because `A4_SMOKE_URL` was not set.
- `template-editor-page.test.tsx` exceeded the normal 30-second per-test timeout in both the combined run and an isolated default run (30.251 seconds).
- With a temporary 60-second limit, the same test passed in 27.966 seconds, confirming a borderline timing-sensitive harness rather than a deterministic behavior assertion failure.
- Scoped ESLint fails at `__tests__/components/template-editor-page.test.tsx:277`: `pageCount` is never reassigned and must be `const`.
- The local production build compiled successfully in 2.7 minutes but the five-minute command window ended during lint/type validation, so it did not exit zero. The standalone lint error means it cannot be accepted as a clean build gate.
- TypeScript passes. The rebuilt Docker image runs and the environment-enabled production smoke passes 2/2.

**Impact**

The patch cannot satisfy a normal merge or release gate consistently. A green Chromium suite and running Docker image do not replace a repeatable default test, lint, and build result.

## Confirmed Working in Live Docker QA

| Area | Result |
|---|---|
| Direct existing-template load | 15 pages rendered, one editable surface, no framework overlay, no browser error/warning, and no React `#419`. |
| Global font and size | Georgia and 14pt applied to the rendered pages. |
| Line and paragraph spacing | 2× line spacing and 1em paragraph spacing applied. |
| Margins | Top 30mm and left 25mm applied; footer and computed offsets matched the effective layout. |
| Pagination | Existing agreement reflowed from 15 to 28 pages under the changed layout. |
| Explicit page history | Add blank page 28 → 29, Delete current page 29 → 28, Undo → 29, Redo → 28. |
| Preview | 28 preview pages, zero editable roots, resolved preview content, and `Viewing preview` status. |
| Responsive containment | At 768×720 the body remained 768px wide; the editor canvas and 852px toolbar were contained by their own horizontal scrolling regions. |
| Table insertion | Insert Table produced one top-level two-row, four-cell table with no nested table inside a paragraph. |
| SSR/container diagnostics | Docker production smoke 2/2 and final container scan contained no `document is not defined`, digest `2292164445`, React `#419`, `ReferenceError`, or `TypeError`. |

Table row/column actions pass component coverage, but the in-app automation could not place a reliable native caret in a specific live table cell. They remain covered by automated tests rather than conclusive authenticated pointer QA in this round.

No QA content or layout changes were saved.

## Follow-up Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended when delegation is explicitly authorized) or `superpowers:executing-plans` to implement this plan task-by-task. Every checkbox is an execution step and every task ends with its own verification gate.

**Goal:** Resolve VR2-01 through VR2-04 without regressing the five closed findings, then produce repeatable unit, Chromium, lint, type, build, Docker, and live-QA evidence that the A4 editor is safe to close.

**Architecture:** Keep canonical HTML and logical `FlowSelectionBookmark` transactions in the pagination modules. Keep toolbar intent, pending typing state, history commits, and reflow scheduling in `A4PageEditor`. Formatting transactions must return valid canonical HTML directly; browser reparsing and native editing behavior are verification layers, not repair mechanisms.

**Tech stack:** React 19, Next.js 15, TypeScript, Vitest/JSDOM, Vitest Browser with Playwright/Chromium, Testing Library, ESLint, Docker Compose.

### Global Constraints

- Preserve one canonical content copy, stable selection direction, deterministic caret placement, globally unique flow IDs, and one history entry per user command.
- Treat `li` and `tr` flow IDs as editor-owned metadata. Strip clipboard flow metadata and rehydrate it exactly once after structural transactions.
- Keep global font, font size, spacing, margins, page numbering, and pagination as layout state; do not stamp global values into unrelated inline spans.
- Do not reintroduce `document.execCommand`, mutation fallback at document end, browser-global access during server rendering, or a parser-repair dependency.
- A null inline property removes only that property. Full Clear formatting must use an explicit transaction rather than an inferred all-null shortcut.
- Preserve unrelated formatting and semantic wrappers whenever a single property is toggled.
- Automated tests must fail on unexpected React warnings and console errors. Do not hide instability by increasing timeouts.
- Do not save QA edits to a production-like document or template.
- Preserve unrelated working-tree changes and stage only the files named by the active task.

### Implementation File and Interface Map

| File | Responsibility after remediation | Planned interface/change |
|---|---|---|
| `src/components/documents/a4-pagination/formatting.ts` | Pure inline, caret, block, list, alignment, indent, and outdent transactions | Add explicit `clearInlineFormatting`; make `applyInlineFormat` null values property-aware; add a uniform/mixed toggle-state reader; retain one paragraph-style block per `li`; group adjacent list items. |
| `src/components/documents/a4-pagination/document-actions.ts` | Canonical deletion, Enter, page actions, and selection replacement | Centralize the allowed block classifier and make block-rich replacement structurally valid before serialization. |
| `src/components/documents/a4-page-editor.tsx` | Toolbar orchestration, pending typing formats, history, selection restoration, and reflow | Route selected toggles through the uniform/mixed state; merge/cancel pending properties; call the explicit full-clear transaction. |
| `__tests__/components/a4-pagination/formatting.test.ts` | Pure formatting and list transaction contract | Add property-preservation, caret split, list grouping/toggle/switch/alignment/indent tests. |
| `__tests__/components/a4-pagination/document-actions.test.ts` | Pure canonical replacement contract | Add list, table, horizontal-rule, boundary, reversed-selection, and structural reparse cases. |
| `__tests__/components/a4-page-editor.test.tsx` | JSDOM editor orchestration and history contract | Add selected and pending toolbar-toggle coverage plus list command integration. |
| `__tests__/browser/a4-page-editor.browser.test.tsx` | Native focus, pointer, selection, DOM layout, and reflow verification | Add real-browser selected-toggle, mid-wrapper typing, list editing, and block-rich paste regressions. |
| `__tests__/helpers/a4-editor-test-utils.ts` | Deterministic pagination test synchronization | Add one condition-based settle helper shared by the slow integration test. |
| `__tests__/components/template-editor-page.test.tsx` | Full draft/save/reopen integration | Remove redundant flushing, reduce fixture cost without losing multipage coverage, and fix the lint error. |
| `__tests__/app/a4-editor-route-smoke.test.ts`, `scripts/run-a4-editor-smoke.mjs`, and `package.json` | Production-route closure gate | Add a dedicated required smoke command that cannot silently skip when invoked for closure. |

### Task 1 — Separate property toggles from full Clear formatting

**Priority:** P1  
**Depends on:** None  
**Files:**

- Modify: `src/components/documents/a4-pagination/formatting.ts`
- Modify: `src/components/documents/a4-page-editor.tsx`
- Test: `__tests__/components/a4-pagination/formatting.test.ts`
- Test: `__tests__/components/a4-page-editor.test.tsx`
- Test: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Interfaces produced:**

```ts
export type InlineToggleState = 'on' | 'off' | 'mixed';

export function readInlineToggleState(
  root: HTMLElement,
  selection: FlowSelectionBookmark,
  field: 'bold' | 'italic' | 'underline',
): InlineToggleState;

export function clearInlineFormatting(
  html: string,
  selection: FlowSelectionBookmark,
): DocumentTransactionResult;
```

`applyInlineFormat(html, selection, patch)` remains the property-patch API. A value of `null` removes only the named property. `clearInlineFormatting` owns the current split-and-unwrap behavior for the full Clear formatting command.

- [ ] Add a failing pure transaction test proving that a bold-off patch preserves colour and italic:

```ts
it('removes only the requested inline property', () => {
  const html = hydrateFlowHtml(
    '<p><span style="font-weight:bold;color:red;font-style:italic">abcdef</span></p>',
  );
  const flowId = parseBody(html).querySelector<HTMLElement>('[data-flow-id]')!
    .dataset.flowId!;
  const result = applyInlineFormat(
    html,
    {
      anchor: { flowId, offset: 2 },
      focus: { flowId, offset: 4 },
      collapsed: false,
    },
    { fontWeight: null },
  );
  const selected = Array.from(parseBody(result.html).querySelectorAll('span'))
    .find((span) => span.textContent === 'cd')!;
  expect(selected.style.fontWeight).toBe('');
  expect(selected.style.fontStyle).toBe('italic');
  expect(normalizeColorValue(selected.style.color)).toBe('#ff0000');
});
```

- [ ] Run the focused test and confirm it fails because `isClearPatch` unwraps all formatting:

```powershell
npx.cmd vitest run __tests__/components/a4-pagination/formatting.test.ts -t "removes only the requested inline property"
```

- [ ] Move full-clear behavior into `clearInlineFormatting`. Refactor `applyInlineFormat` so it splits at the logical selection boundaries, applies null and positive properties to the selected slice, removes empty `style` attributes/wrappers, normalizes adjacent spans, and hydrates flow IDs once.
- [ ] Add one test for each null property (`fontFamily`, `fontSize`, `color`, `backgroundColor`, `fontWeight`, `fontStyle`, and `textDecoration`) and retain the existing all-format partial-clear test against `clearInlineFormatting`.
- [ ] Add `readInlineToggleState` tests for uniform on, uniform off, and mixed ranges. The command policy is explicit: uniform `on` toggles off; `off` or `mixed` applies the property to the whole range.
- [ ] Update `applyFormattingTransaction` to call `readInlineToggleState` for non-collapsed Bold/Italic/Underline selections and send the correct positive or property-null patch.
- [ ] Route `removeFormat` directly to `clearInlineFormatting`; do not represent full Clear as seven null values at the editor layer.
- [ ] Add JSDOM and Chromium regressions that select styled text with real selection restoration, click Bold twice, and assert text, selection, history count, colour, and italic are preserved.
- [ ] Run the task suite and require zero failures and zero unexpected console output:

```powershell
npx.cmd vitest run __tests__/components/a4-pagination/formatting.test.ts __tests__/components/a4-page-editor.test.tsx
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx
```

- [ ] Commit only Task 1 files after review:

```powershell
git add src/components/documents/a4-pagination/formatting.ts src/components/documents/a4-page-editor.tsx __tests__/components/a4-pagination/formatting.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "fix(editor): make inline toggles property-aware"
```

**Acceptance gate:** The second click toggles Bold, Italic, or Underline off for a uniformly active selection; a mixed range becomes uniformly active; and no orthogonal inline property or selection direction changes.

### Task 2 — Make pending caret formats cancelable at the exact insertion point

**Priority:** P1  
**Depends on:** Task 1  
**Files:**

- Modify: `src/components/documents/a4-pagination/formatting.ts`
- Modify: `src/components/documents/a4-page-editor.tsx`
- Test: `__tests__/components/a4-pagination/formatting.test.ts`
- Test: `__tests__/components/a4-page-editor.test.tsx`
- Test: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Interfaces consumed:** `InlineFormatPatch`, `insertTextWithFormat`, `readLogicalFormatState`, and the Task 1 property semantics. No second pending-format source of truth is allowed.

- [ ] Add a failing middle-wrapper transaction test:

```ts
it('inserts cancelled bold text at the middle caret boundary', () => {
  const html = hydrateFlowHtml(
    '<p><span style="font-weight:bold">abc</span></p>',
  );
  const point = collapsedPoint(html, 1);
  const result = insertTextWithFormat(
    html,
    { anchor: point, focus: point, collapsed: true },
    'X',
    { fontWeight: null },
  );
  const body = parseBody(result.html);
  expect(body.textContent).toBe('aXbc');
  expect(Array.from(body.querySelectorAll('span'), (span) => span.textContent))
    .toEqual(['a', 'bc']);
});
```

- [ ] Run the focused test and confirm the current result is `Xabc`:

```powershell
npx.cmd vitest run __tests__/components/a4-pagination/formatting.test.ts -t "middle caret boundary"
```

- [ ] Fix `prepareCaretForPatch` so the split-middle branch returns the parent boundary after the inserted leading clone and before the original trailing wrapper. Recompute the offset from the live DOM after insertion rather than reusing the pre-insertion index.
- [ ] Add start, middle, and end cases for semantic wrappers (`strong`, `em`, and `u`) and styled spans. Include nested colour/italic wrappers to prove only the cancelled property is escaped.
- [ ] Refactor `setPendingTypingFormat` so the toolbar state is the merge of persisted caret formatting and `pendingTypingFormatRef.current`. A second click on a pending property must replace its positive value with `null`, while leaving other pending keys intact.
- [ ] When all pending keys are semantically neutral relative to the persisted caret state, clear both pending refs. Preserve the pending point only while it still equals the saved collapsed bookmark.
- [ ] Add an editor test for Bold on → Italic on → Bold off → type. Assert the typed text is italic, not bold, appears at the caret, and Undo removes the insertion in one step.
- [ ] Add a real-pointer Chromium case for toggle-on/toggle-off before typing inside the middle of a wrapper. Assert DOM order and restored collapsed selection after reflow.
- [ ] Run the focused task suite:

```powershell
npx.cmd vitest run __tests__/components/a4-pagination/formatting.test.ts __tests__/components/a4-page-editor.test.tsx
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx
```

- [ ] Commit only Task 2 files:

```powershell
git add src/components/documents/a4-pagination/formatting.ts src/components/documents/a4-page-editor.tsx __tests__/components/a4-pagination/formatting.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "fix(editor): preserve caret position when cancelling formats"
```

**Acceptance gate:** Pending formats can be independently toggled on and off before typing; start, middle, and end insertion remain at the logical caret; and unrelated pending or persisted styling survives.

### Task 3 — Retain one editable block inside every list item

**Priority:** P1  
**Depends on:** Task 2 only for the full regression run; list implementation can be developed independently  
**Files:**

- Modify: `src/components/documents/a4-pagination/formatting.ts`
- Modify if orchestration assertions require it: `src/components/documents/a4-page-editor.tsx`
- Test: `__tests__/components/a4-pagination/formatting.test.ts`
- Test: `__tests__/components/a4-page-editor.test.tsx`
- Test: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Representation decision:** Use `<ul|ol><li data-flow-id><p|h1|h2|h3|h4|h5|h6|blockquote>…</…></li></ul|ol>`. The `li` owns the flow ID used by selection and pagination; its single block child owns paragraph tag, class, and style. This matches the existing toggle-off algorithm and lets paragraph style, alignment, indent, and outdent reuse one block transaction model. Legacy direct-text list items must be normalized to a `p` child before mutation.

**Interfaces retained:**

```ts
export function applyListToSelection(
  html: string,
  selection: FlowSelectionBookmark,
  listType: 'ordered' | 'unordered',
): DocumentTransactionResult;
```

`applyBlockFormatToSelection`, `applyBlockAlignmentToSelection`, `applyIndentToSelection`, and `applyOutdentToSelection` continue to share one paragraph-style block collector. The collector must resolve the block child of every intersected `li`, including after a legacy direct-text item is normalized.

- [ ] Add a failing grouping-and-toggle test:

```ts
it('groups adjacent blocks into one editable list and toggles it off', () => {
  const html = hydrateFlowHtml('<p>One</p><p>Two</p>');
  const ids = parseBody(html).querySelectorAll<HTMLElement>('[data-flow-id]');
  const selection = {
    anchor: { flowId: ids[0].dataset.flowId!, offset: 0 },
    focus: { flowId: ids[1].dataset.flowId!, offset: 3 },
    collapsed: false,
  };
  const listed = applyListToSelection(html, selection, 'unordered');
  const listedBody = parseBody(listed.html);
  expect(listedBody.querySelectorAll(':scope > ul')).toHaveLength(1);
  expect(Array.from(listedBody.querySelectorAll('ul > li'), (li) => li.textContent))
    .toEqual(['One', 'Two']);
  expect(listedBody.querySelectorAll('ul > li > p')).toHaveLength(2);

  const unlisted = applyListToSelection(
    listed.html,
    listed.selection!,
    'unordered',
  );
  expect(Array.from(parseBody(unlisted.html).children, (node) => node.tagName))
    .toEqual(['P', 'P']);
});
```

- [ ] Run the focused test and confirm the current implementation creates two lists and cannot toggle them off:

```powershell
npx.cmd vitest run __tests__/components/a4-pagination/formatting.test.ts -t "groups adjacent blocks"
```

- [ ] Add `ensureListItemBlock(li)` and run it for intersected list items before collecting blocks. It wraps legacy direct child nodes in a `p`, leaves an existing single paragraph-style child unchanged, and moves any flow ID from the nested block to the owning `li` so only the selection owner carries it.
- [ ] Keep one ordered editable-block collector using `p,h1,h2,h3,h4,h5,h6,blockquote`. Deduplicate matches, preserve DOM order, and resolve collapsed selections whose bookmark belongs to the parent `li`.
- [ ] In list creation, group consecutive selected non-list blocks by common parent and adjacency. Create one list per consecutive group, create one `li` per source block, transfer the source flow ID to the `li`, and append the original block as the item’s only block child without duplicating text or style.
- [ ] In toggle-off, group selected block children by their direct list parent. Move each child block out at the list position in original order, transfer its owning `li` flow ID back to the block, preserve unselected leading/trailing items, and remove only empty list wrappers.
- [ ] In list-type switching, replace the matching list wrapper (`ul` ↔ `ol`) while retaining the existing `li` nodes, attributes, nested inline markup, flow IDs, and order.
- [ ] Apply alignment, paragraph style, indent, and outdent to the block child without replacing its owning `li`. Clear formatting removes inline properties from selected text and paragraph properties from the block child while leaving the list structure intact.
- [ ] Add reversed selection, collapsed caret, partial-list, mixed paragraph/list, inline-formatted content, and repeated indent/outdent tests. Assert `changed: false` when a command is already at its target state.
- [ ] Add editor-level history checks: list creation, type switch, alignment, indent, and toggle-off each create exactly one undoable transaction and preserve page text through reflow.
- [ ] Add Chromium pointer/focus coverage for two selected paragraphs becoming one list, then center alignment, indent, type switch, and toggle-off. Assert no nested lists or duplicate text.
- [ ] Run all list-related suites:

```powershell
npx.cmd vitest run __tests__/components/a4-pagination/formatting.test.ts __tests__/components/a4-page-editor.test.tsx
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx
```

- [ ] Commit only Task 3 files:

```powershell
git add src/components/documents/a4-pagination/formatting.ts src/components/documents/a4-page-editor.tsx __tests__/components/a4-pagination/formatting.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "fix(editor): keep list items fully editable"
```

**Acceptance gate:** Adjacent paragraphs become one ordered/unordered list with one paragraph-style child per item; legacy direct-text items are normalized; every paragraph command remains available; and type switching/toggle-off preserve content order, flow IDs, selection, pagination, and history.

### Task 4 — Return valid canonical HTML for every block-rich replacement

**Priority:** P2  
**Depends on:** Task 3 for list-flow regression coverage  
**Files:**

- Modify: `src/components/documents/a4-pagination/document-actions.ts`
- Modify only if formatted replacement shares structure logic: `src/components/documents/a4-pagination/formatting.ts`
- Test: `__tests__/components/a4-pagination/document-actions.test.ts`
- Test: `__tests__/components/a4-pagination/formatting.test.ts`
- Test: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Classifier contract:** A root replacement node is block-rich when its tag is `p`, `div`, `h1`–`h6`, `blockquote`, `ul`, `ol`, `hr`, or `table`. Table internals remain children of `table`; list items remain children of `ul`/`ol`. The sanitizer and classifier must be reviewed together whenever allowed structural tags change.

- [ ] Add failing list and table replacement tests at a mid-paragraph caret:

```ts
it.each([
  ['<ul><li>One</li><li>Two</li></ul>', 'UL'],
  ['<table><tbody><tr><td>Cell</td></tr></tbody></table>', 'TABLE'],
  ['<hr>', 'HR'],
])('splits the containing paragraph for %s', (replacement, tagName) => {
  const html = hydrateFlowHtml('<p>AlphaBeta</p>');
  const flowId = new DOMParser()
    .parseFromString(html, 'text/html')
    .body.querySelector<HTMLElement>('[data-flow-id]')!.dataset.flowId!;
  const result = replaceLogicalSelection(html, collapsed(flowId, 5), replacement);
  const body = new DOMParser().parseFromString(result.html, 'text/html').body;
  expect(Array.from(body.children, (node) => node.tagName)).toEqual([
    'P',
    tagName,
    'P',
  ]);
  expect(body.children[0].textContent).toBe('Alpha');
  expect(body.children[2].textContent).toBe('Beta');
  expect(result.html).toBe(body.innerHTML);
});
```

- [ ] Run the focused test and confirm table/list cases fail because the fragment is inserted inside the paragraph transaction:

```powershell
npx.cmd vitest run __tests__/components/a4-pagination/document-actions.test.ts -t "splits the containing paragraph"
```

- [ ] Replace `BLOCK_REPLACEMENT_TAGS` and the duplicated containing-block set with named helpers whose contracts distinguish insertable root blocks from splittable containing text blocks.
- [ ] Before inserting a block-rich fragment, resolve and split the nearest splittable containing block. Keep non-empty leading and trailing inline content in sibling blocks with copied safe attributes. Retain a `<br>` boundary block only when an empty editable boundary is intentionally required.
- [ ] Insert the sanitized fragment between the split siblings exactly once. Calculate the returned collapsed bookmark from canonical document offsets after the final structure is present, then call flow hydration and uniqueness normalization once.
- [ ] Make formatted paste use the same insertion path. Positive pending inline formatting may wrap replacement text descendants, but must never wrap `ul`, `ol`, `table`, `hr`, rows, or cells in an inline span.
- [ ] Add start, middle, end, forward selection, reversed selection, list, table, horizontal rule, mixed inline/block, and stale-bookmark cases. For every changed result, assert `result.html === reparsedBody.innerHTML`, unique flow IDs, one replacement copy, and deterministic selection offsets.
- [ ] Add browser coverage that pastes a list and a table into paragraph text, then immediately types, undoes, and redoes. Assert there are no empty boundary blocks except intentional editable start/end boundaries and no duplicate content after pagination.
- [ ] Run the replacement suites:

```powershell
npx.cmd vitest run __tests__/components/a4-pagination/document-actions.test.ts __tests__/components/a4-pagination/formatting.test.ts
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx
```

- [ ] Commit only Task 4 files:

```powershell
git add src/components/documents/a4-pagination/document-actions.ts src/components/documents/a4-pagination/formatting.ts __tests__/components/a4-pagination/document-actions.test.ts __tests__/components/a4-pagination/formatting.test.ts __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "fix(editor): canonicalize block-rich replacements"
```

**Acceptance gate:** The transaction output is already valid and structurally stable before `parsePages`; list/table/HR paste preserves leading and trailing content, unique flow IDs, a deterministic caret, one replacement copy, and one history entry.

### Task 5 — Make the closure workflow deterministic and non-skipping

**Priority:** P1 release blocker  
**Depends on:** Tasks 1–4  
**Files:**

- Modify: `__tests__/helpers/a4-editor-test-utils.ts`
- Modify: `__tests__/components/template-editor-page.test.tsx`
- Modify: `__tests__/app/a4-editor-route-smoke.test.ts`
- Create: `scripts/run-a4-editor-smoke.mjs`
- Modify: `package.json`

**Interfaces produced:**

```ts
export async function waitForA4EditorIdle(
  surface: HTMLElement,
  maxReflows?: number,
): Promise<void>;
```

```json
{
  "scripts": {
    "test:a4:smoke": "node scripts/run-a4-editor-smoke.mjs"
  }
}
```

- [ ] Record the current isolated default-limit failure before changing the harness:

```powershell
npx.cmd vitest run __tests__/components/template-editor-page.test.tsx -t "drafts, saves, and reopens"
```

Expected baseline: the test reaches the 30-second timeout or remains too close to it to provide release headroom.

- [ ] Add `waitForA4EditorIdle` to the shared helper. It must flush one deterministic reflow generation at a time inside `act`, return immediately once `aria-busy="false"`, and throw a diagnostic error after the bounded generation count. Do not add zero-delay timers.
- [ ] Replace the local `flush` and `waitForIdle` loops with the shared helper plus command-specific `waitFor` assertions. Wait for both the requested state change and the final idle state after paste, formatting, margin, page, save, and reopen actions.
- [ ] Change `let pageCount` to `const pageCount`.
- [ ] Reduce the 120-line fixture to the smallest deterministic fixture that still creates at least two physical pages. Compensate through deterministic measurement inputs, then assert `pageCount > 1` so the integration test cannot silently lose pagination coverage.
- [ ] Keep the test’s standard 30-second timeout and require the body to complete below 20 seconds in five consecutive isolated runs on the same environment.
- [ ] Add a required smoke launcher using the local Vitest CLI without shell-specific command chaining:

```js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const required = ['A4_SMOKE_URL', 'A4_SMOKE_EXISTING_URL'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required smoke environment: ${missing.join(', ')}`);
  process.exit(1);
}

const vitestCli = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [vitestCli, 'run', '__tests__/app/a4-editor-route-smoke.test.ts'],
  {
    stdio: 'inherit',
    env: { ...process.env, A4_SMOKE_REQUIRED: '1' },
  },
);
process.exit(result.status ?? 1);
```

- [ ] Update the smoke test so `A4_SMOKE_REQUIRED=1` plus a missing URL throws instead of skipping. Fetch both `A4_SMOKE_URL + '/template-partials/editor'` and the complete existing-template editor URL supplied in `A4_SMOKE_EXISTING_URL`. Retain the container log assertions for browser globals, digest `2292164445`, React `#419`, `ReferenceError`, and `TypeError`; authenticated interaction remains part of the later live-QA gate.
- [ ] Run the isolated save/reopen test five separate times. Each invocation must pass under the unchanged 30-second limit; record wall time and retain the slowest result.
- [ ] Run this focused unit/SSR matrix five separate times with identical counts and no warnings:

```powershell
npm.cmd run test:run -- __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-editor-toolbar.test.tsx __tests__/components/a4-pagination __tests__/components/template-editor __tests__/components/template-editor-page.test.tsx __tests__/components/a4-page-editor-ssr.test.tsx __tests__/services/document-export-layout.test.ts
```

- [ ] Run the real-Chromium matrix three separate times with identical counts and clean console output:

```powershell
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx __tests__/browser/a4-page-editor-controls.browser.test.tsx
```

- [ ] Run static and build gates, each to a confirmed zero exit code:

```powershell
npx.cmd tsc --noEmit --pretty false
npx.cmd eslint src/components/documents/a4-page-editor.tsx src/components/documents/a4-pagination __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-pagination __tests__/components/template-editor-page.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx __tests__/browser/a4-page-editor-controls.browser.test.tsx __tests__/app/a4-editor-route-smoke.test.ts scripts/run-a4-editor-smoke.mjs
npm.cmd run build
git diff --check
git diff --cached --check
```

- [ ] With the rebuilt Docker stack running, discover a real existing-template editor URL during authenticated QA, export it as `A4_SMOKE_EXISTING_URL`, and execute the required smoke command. The launcher must stop before Vitest if either URL is absent:

```powershell
docker compose ps
$env:A4_SMOKE_URL='http://localhost:3000'
npm.cmd run test:a4:smoke
docker compose logs --no-color --tail 500 app
```

- [ ] Repeat authenticated manual QA in this order: type; replace selection; Backspace/Delete at normal, soft-page, and hard-page boundaries; Enter; font family/size/colour/highlight; Bold/Italic/Underline on/off; Clear formatting; lists; table row/column actions; margins/spacing/page numbers; add/delete/page break; Undo/Redo; preview; responsive containment. Check browser and container logs after the run and do not save.
- [ ] Commit only Task 5 files:

```powershell
git add __tests__/helpers/a4-editor-test-utils.ts __tests__/components/template-editor-page.test.tsx __tests__/app/a4-editor-route-smoke.test.ts scripts/run-a4-editor-smoke.mjs package.json
git commit -m "test(editor): make A4 release gates deterministic"
```

**Acceptance gate:** The default save/reopen test passes with at least 10 seconds of timeout headroom; the required smoke cannot skip; five unit runs, three Chromium runs, TypeScript, scoped ESLint, build, Docker smoke, live QA, log scans, and `git diff --check` all finish cleanly.

### Implementation Order and Review Gates

| Order | Task | Required review before proceeding |
|---:|---|---|
| 1 | Property-aware selected toggles and explicit Clear formatting | Pure transaction semantics and orthogonal-style preservation reviewed; focused tests green. |
| 2 | Pending caret cancellation and exact insertion | Start/middle/end DOM order and pending-state merge reviewed; JSDOM and Chromium green. |
| 3 | First-class list editing | Canonical one-block-per-`li` representation, legacy normalization, grouping, partial toggle-off, selection, and history reviewed. |
| 4 | Block-rich canonical replacement | Serialized HTML equals reparsed HTML for every structural fixture; paste regressions green. |
| 5 | Deterministic closure gates | Repeated evidence recorded; no skipped required smoke, timeout override, warning, lint failure, build timeout, or log signature. |

Do not combine Tasks 1–4 into one unreviewed patch. After each task, review the exact diff, run its focused gate, and confirm that closed findings IR-01, IR-03, IR-05, IR-06, and IR-08 remain green before starting the next task.

### Finding-to-Implementation Coverage

| Finding | Implemented by | Required proof |
|---|---|---|
| VR2-01 selected-toggle property loss | Task 1 | Per-property pure tests, uniform/mixed state policy, JSDOM selection/history test, and real-pointer Chromium toggle. |
| VR2-01 pending toggle and moved caret | Task 2 | Start/middle/end wrapper tests, multi-property pending merge, one-step Undo, and Chromium DOM-order/caret assertion. |
| VR2-02 frozen and fragmented lists | Task 3 | One-block-per-item contract, legacy normalization, one-list grouping, partial/full toggle-off, type switch, paragraph commands, selection/history, and Chromium QA. |
| VR2-03 malformed block-rich replacement | Task 4 | List/table/HR boundary matrix, forward/reversed selection, serialized/reparsed equivalence, unique flow IDs, one-copy assertion, and paste Undo/Redo. |
| VR2-04 unreliable closure gates | Task 5 | Five default unit runs, three Chromium runs, sub-20-second save/reopen runtime, required two-route smoke, TypeScript, ESLint, build, Docker/log scan, and live QA. |
| Regression protection for IR-01, IR-03, IR-05, IR-06, IR-08 | Every task’s focused suite plus Task 5 | Previously passing focused tests remain green at every review gate and in the repeated closure matrix. |

## Verification Evidence

| Check | Result |
|---|---|
| Focused Vitest matrix | **Failed:** 167 passed, 1 timed out, 2 smoke tests skipped. |
| Isolated save/reopen test, default limit | **Failed:** 30.251-second timeout. |
| Isolated save/reopen test, temporary 60-second limit | **Passed:** test body 27.966 seconds; demonstrates insufficient timing headroom. |
| Chromium component matrix | **Passed:** 2 files, 24 tests, no `act(...)` warnings. |
| A4 SSR render tests | **Passed:** 4 tests without browser globals. |
| Docker route smoke with `A4_SMOKE_URL` | **Passed:** 2 tests. |
| TypeScript | **Passed:** `npx.cmd tsc --noEmit --pretty false`. |
| Scoped ESLint | **Failed:** one `prefer-const` error at template-editor-page test line 277. |
| Local production build | Compiled successfully in 2.7 minutes; command timed out at five minutes during lint/type validation and did not exit zero. |
| Rebuilt Docker image | Running current second-round implementation; route and logs clean. |
| Direct transaction probes | Confirmed VR2-01, VR2-02, and VR2-03 without changing application source. |
| Authenticated live QA | Confirmed layout, pagination, page history, preview, responsive containment, table insertion, selected Bold failure, list failure, and clean client logs. |
| Final container scan | Clean for A4 SSR/runtime error signatures. |

## Closure Criteria

Do not close the A4 editor remediation until all of the following are true:

1. VR2-01 through VR2-04 acceptance criteria are implemented and covered by focused and real-Chromium regressions.
2. IR-02, IR-04, and IR-07 can be moved from partial to resolved with direct evidence.
3. The complete default verification workflow exits zero without skipped production smoke, timeout overrides, `act(...)` warnings, lint errors, or build timeouts.
4. Authenticated Docker QA repeats typing, Enter, paste, formatting toggle, clear formatting, list creation/editing, table editing, pagination, Undo/Redo, preview, global layout, and responsive containment with clean browser and container logs.
5. No QA data is saved to production-like templates or documents.

## Reviewer Change Scope

This review did not modify application or test source. The only reviewer-created artifact is this follow-up document.
