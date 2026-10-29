# A4 Editor Reliability Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the A4 editor safe and predictable for everyday drafting by eliminating content duplication, caret reversal, unsafe page deletion, stale formatting selections, misleading layout feedback, and editor/print pagination drift.

**Architecture:** Keep the approved continuous-document architecture: canonical sanitized HTML and logical flow selections are authoritative, while physical A4 pages remain derived fragments. Route every user mutation through one canonical `DocumentTransactionResult`, derive page-section actions from hard breaks rather than soft pages, and share field and print-style registries so the editor, validator, preview, print, and export paths cannot diverge.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.7, DOMPurify, Vitest 4, Testing Library, Vitest Browser with Playwright/Chromium, and the existing A4 pagination modules.

## Global Constraints

- Do not introduce a new rich-text framework or database migration.
- Canonical continuous HTML remains the sole persisted content representation; soft page boundaries must never be serialized.
- Every typing, paste, formatting, page, or delete interaction creates at most one history entry, one content callback, and one latest-generation reflow.
- Hard page breaks remain the only persisted definition of an explicit page section.
- Existing `A4PageEditorProps` and `A4PageEditorRef` callers remain source-compatible.
- Existing templates without layout metadata continue to use `DEFAULT_A4_DOCUMENT_LAYOUT`.
- Preserve unrelated keys in `contentJson` when saving layout or inferred custom-placeholder definitions.
- Editor, preview, browser print, HTML export, and PDF export use the same typography, spacing, margins, and line-break semantics.
- Do not silently discard or relocate content when a selection cannot be restored; keep the canonical document unchanged and surface a recoverable editor state.
- Follow `docs/guides/DESIGN_GUIDELINE.md`, including compact controls, accessible status/error text, keyboard operation, and narrow-viewport overflow behavior.

---

## Review Findings

| Priority | Finding | Reproduced evidence | Impact |
|---|---|---|---|
| P1 | A normal collapsed-selection paste can be committed twice. | Pasting 120 plain-text lines into a blank template duplicated the later lines and produced 15,357 characters instead of roughly 8,900. `handleDocumentPaste` performs `execCommand('insertHTML')` and schedules `commitDocumentSurface`, while the emitted input event commits immediately. | Template content is silently duplicated and pagination becomes nondeterministic. |
| P1 | First-line typing and Enter are unstable in an empty document. | Typing `Alpha`, Enter, `Beta` produced either `Beta`, blank, `Alpha` or a blank paragraph followed by `BetaAlpha`. | Basic drafting can reverse or merge text before the user has entered meaningful content. |
| P1 | Delete Current Page and page-chrome delete can remove a soft pagination fragment. | The toolbar is enabled when any page has a hard break, and the page-chrome delete control is rendered on every derived page. Deleting page 1 of the live agreement removed its opening content. | A user can destroy flowing document content while believing they are deleting an explicit blank page or section. |
| P1 | Backspace at a soft boundary does not delete the preceding logical character. | The handler joins the two page fragments without deleting text, and the current unit test explicitly expects that incorrect behavior. | Backspace and forward Delete are asymmetric and violate the approved editor specification. |
| P1 | The validation catalog rejects fields that the Fields panel offers. | The existing agreement reported blocking errors for `company.address.letter` and `selectedContact.*`; legacy `custom.*` references also had no definitions. Save Template remained disabled. | Existing supported templates can be edited but not saved. |
| P1 | Formatting commands preserve raw DOM nodes across repagination. | `savedSelectionRef` stores `Node` references, while page effects replace `innerHTML`. | Font, font size, text colour, highlight, and insert-at-cursor commands can no-op or target the wrong place after reflow. |
| P2 | Font and colour controls are uncontrolled and formatting markup grows excessively. | The controls use `defaultValue`, do not reflect the current cursor, and whole-document font/size changes produced 477 spans and about 62,000 HTML characters. | The toolbar presents stale values and repeated formatting progressively slows pagination and complicates later editing. |
| P2 | Global layout status is false and reflow has no stable busy state. | A 60mm top margin repaginated the agreement from 15 to 17 pages while the footer continued to show `20mm margins`; the footer also rendered `794×1123px`. Large changes produced multi-second unstable re-render windows. | Users cannot tell which layout is active or whether repagination has completed before continuing to edit. |
| P2 | Oversized unsplittable content is silently clipped. | The pagination engine sets `oversized`, but `Page` ignores it and applies `overflow: hidden`. | Tall table rows and other unsplittable blocks can disappear without an explanation or editable recovery path. |
| P2 | The editor's “What you see = What prints” statement is inaccurate. | Browser print adds `0.5em` to every `<br>`, uses different page-number positioning, and has different page-height/overflow rules. | Line breaks and page content can move between edit, preview, print, and PDF output. |
| P2 test gap | The pagination suite is timing-sensitive and misses the live workflows above. | The combined review run had one soft-page deletion failure; the same test passed in isolation and on three reruns. The browser suite has no blank-document Enter, collapsed paste, selection-after-reflow, save/reopen, or print-media parity workflow. | Green isolated runs do not reliably protect the user-facing route. |

## Verification Baseline

- Related unit/component run: 128 passed and one timing-dependent soft-page deletion test failed.
- `__tests__/components/a4-page-editor.test.tsx` subsequently passed 44/44 in isolation.
- A4 Chromium browser tests passed 10/10.
- Layout/API/panel tests passed 19/19.
- `npx.cmd tsc --noEmit --pretty false`: passed.
- Targeted ESLint for the editor, route, and pagination modules: passed.
- No application-origin console errors or framework error overlays appeared during the authenticated live review.

---

## Fix Implementation Review — 2026-08-09

**Reviewed revision:** `a58b97f` (`fix(documents): remediate A4 editor reliability`)

**Review outcome:** The implementation resolves most of the original high-risk failures, including duplicate plain-text paste, empty-document typing order, logical Backspace/Delete at soft page boundaries, hard-section deletion, validation catalog drift, selection restoration across reflow, truthful global layout feedback, oversized-content visibility, and shared print CSS. The editor is not ready to close as fully remediated because eight residual or newly exposed issues remain in core drafting, formatting, and production-rendering paths.

### Confirmed Resolved Scope

| Area | Review result | Evidence |
|---|---|---|
| Plain-text paste duplication | Resolved for the covered collapsed paste path. | Focused and Chromium suites pass the 120-line one-copy regression. |
| Empty-document typing and collapsed Enter | Resolved for the covered caret split path. | Browser tests preserve `Alpha`, Enter, `Beta` in document order. |
| Backspace and forward Delete across soft pages | Resolved for the covered boundary paths. | Pure transaction and component tests pass in both directions. |
| Physical-page versus hard-section deletion | Resolved. | Soft-only pagination exposes no delete action; explicit Add/Delete returned the live document from 28 → 29 → 28 pages. |
| Template field validation | Resolved for standard and inferred legacy custom fields. | The shared catalog is consumed by insertion and validation, and save/reopen tests preserve inferred definitions. |
| Selection restoration and latest-generation reflow | Resolved for the covered logical bookmarks. | Reversed selection, controlled-layout rerender, and latest-generation tests pass. |
| Global typography, spacing, and margins | Resolved in the reviewed route. | Authenticated QA applied Georgia, 14pt, 2× line spacing, 1em paragraph spacing, 30mm top and 25mm left margins; computed page styles reflected the final values. |
| Oversized content and print styling | Resolved for the tested path. | Accessible warning, editable overflow, shared CSS, line-break parity, and print marker tests pass. |
| Narrow layout containment | Resolved for 1024×720 and 768×720. | The application body did not overflow; the A4 canvas and toolbar retained independent horizontal scrolling. |

### Residual and New Findings

| ID | Priority | Finding | Confirmed evidence | Impact |
|---|---|---|---|---|
| IR-01 | P1 | Enter does not replace a non-collapsed selection. | `insertParagraphAtSelection` resolves only `selection.anchor` and immediately splits that block. A direct transaction probe with `SELCASE` and `CASE` selected returned `<p>SELCASE</p><p><br></p>` instead of deleting `CASE` before splitting. | A routine select-and-Enter action preserves text the user intended to replace and places the new paragraph at the wrong logical boundary, including for reversed selections. |
| IR-02 | P1 | Rich HTML paste can create invalid nested blocks and duplicate logical flow IDs. | `sanitizeReplacementHtml` permits `data-flow-*`; `replaceLogicalSelection` inserts block nodes directly into a range inside the current paragraph and only hydrates missing IDs. A direct probe produced `<p data-flow-id="f1">ABC<p data-flow-id="f1">One</p><p data-flow-id="f2">Two</p>DEF</p>` with duplicate `f1`. | Invalid canonical structure and ambiguous flow identity can corrupt later caret restoration, formatting, deletion, and pagination after copying formatted editor content. |
| IR-03 | P1 | Placeholder, guided-builder, AI, and table insertion still bypass the canonical transaction model and can relocate content to the document end. | `insertAtCursor` and `insertHtmlAtCursor` still use `document.execCommand`. If logical restoration fails, both select the entire surface, collapse at the end, and insert there. `insertHtmlIntoEditor` has the same end fallback for table insertion. | A stale or invalid bookmark can silently place generated clauses or placeholders at the end of a long template, contradicting the remediation constraint that failed restoration must leave canonical content unchanged. |
| IR-04 | P1 | Inline formatting does not implement normal toggle or caret typing semantics. | `applyInlineFormat` returns `changed: false` for every collapsed bookmark. Bold, italic, and underline commands always apply their positive value and never send `null` when the active format is already on. | Users cannot choose a font/size/colour before typing at a caret, and Bold/Italic/Underline cannot be reliably toggled off with their toolbar buttons. |
| IR-05 | P2 | Clear formatting is a no-op for a partial selection inside a styled element. | `unwrapElementsInRange` unwraps an element only when the whole element is inside the range. Clearing characters 3–4 of `<span style="font-weight:bold">abcdef</span>` returned the original fully bold HTML unchanged. | Users cannot clear formatting from a word or substring unless the selection happens to contain the entire formatting wrapper. |
| IR-06 | P2 | Selected text and highlight colours are not normalized for controlled colour inputs. | `readLogicalFormatState` returns CSS serialization such as `rgb(255, 0, 0)`. Assigning that value to `<input type="color">` normalizes to `#000000`, so the toolbar can display black for red selected text. | The control presents a false active value and the next colour action starts from the wrong visual state. |
| IR-07 | P2 | Paragraph-style changes do not preserve multi-block selection semantics, and the verification harness is not warning-clean. | `applyBlockTagToSelection` replaces only the block containing `range.startContainer` and then selects the entire replacement. The focused component and Chromium runs pass but emit repeated React `act(...)` warnings; the browser formatting test uses programmatic `button.click()` and direct `change` dispatch rather than real focus movement. | Multi-paragraph style changes are partial and the original caret/range is lost. Test passes can also complete while reflow-driven state updates are still pending, weakening regression confidence. |
| IR-08 | P1 | The production template-editor route performs DOM work during server rendering and falls back to client rendering. | The rebuilt Docker container repeatedly logged `ReferenceError: document is not defined` with digest `2292164445` from `.next/server/chunks/265.js`. The minified frame resolves to `reassemblePageFragments`, which calls `document.createElement`; render-time `hardSectionCount` invokes it through `canonicalPagesHtml(pages)`. Each clean direct load also logged React production error `#419`: the server could not finish the Suspense boundary and switched to client rendering ([React error reference](https://react.dev/errors/419)). | Direct loads do not complete their intended server render and depend on client recovery before the editor becomes usable. This increases time-to-interactive and makes the route vulnerable to a blank or incomplete editor when hydration or JavaScript delivery is disrupted. |

### Follow-up Fix Implementation Plan

#### Task A: Make Enter and rich paste structurally selection-safe

**Files:**

- `src/components/documents/a4-pagination/document-actions.ts`
- `src/components/documents/a4-pagination/model.ts`
- `__tests__/components/a4-pagination/document-actions.test.ts`
- `__tests__/browser/a4-page-editor.browser.test.tsx`

- [ ] Order the anchor and focus points before an Enter transaction. Delete a non-collapsed range first, then split at the resulting logical start and return a collapsed bookmark in the new block.
- [ ] Strip all incoming `data-flow-id`, `data-flow-continuation`, and `data-flow-oversized` attributes from clipboard HTML. Flow metadata is editor-owned and must never be trusted from pasted content.
- [ ] Insert block-level clipboard nodes at block boundaries: retain the current block's leading inline fragment, insert the pasted sibling blocks, then retain the trailing inline fragment as a valid sibling block. Never leave `p`, headings, lists, blockquotes, or tables inside a `p`.
- [ ] Run `normalizeEditedFlowIds` before finalizing every replacement transaction and assert that every persisted flow ID is unique.
- [ ] Add forward and reversed select-and-Enter tests, mid-paragraph two-block paste, copy-from-editor paste, invalid nested-block assertions, and flow-ID uniqueness assertions.

**Acceptance:** Enter removes the selection once and splits at its logical start; rich paste produces valid sibling blocks, one content copy, and globally unique flow IDs.

#### Task B: Complete formatting semantics

**Files:**

- `src/components/documents/a4-pagination/formatting.ts`
- `src/components/documents/a4-page-editor.tsx`
- `src/components/documents/a4-editor-toolbar.tsx`
- `__tests__/components/a4-pagination/formatting.test.ts`
- `__tests__/components/a4-page-editor.test.tsx`
- `__tests__/browser/a4-page-editor.browser.test.tsx`

- [ ] Represent a collapsed-caret typing format separately from persisted document markup. Apply that state to subsequent `insertText`, composition, Enter, and paste transactions, and clear or inherit it when the caret moves.
- [ ] Derive Bold/Italic/Underline commands from the current uniform selection state: send `null` when active and the positive value when inactive. Cover mixed selections explicitly.
- [ ] Split formatting wrappers at the exact logical selection boundaries before clearing styles, then normalize adjacent spans. Preserve formatting outside the selected substring.
- [ ] Convert `rgb(...)`, named colours, and shorthand hex to lowercase `#rrggbb` before assigning controlled colour and highlight values. Use a safe fallback only when conversion genuinely fails.
- [ ] Replace `applyBlockTagToSelection` with a pure logical transaction over every intersected block. Preserve flow IDs, block attributes where valid, selection direction, and offsets.
- [ ] Add tests for collapsed future typing, toggling each inline format on and off, partial clear formatting, selected-colour toolbar synchronization, reversed selections, and multi-paragraph style changes.

**Acceptance:** Formatting behaves like a conventional document editor at both a caret and a range; toolbar state always matches the selected content after reflow.

#### Task C: Remove end-of-document insertion fallbacks

**Files:**

- `src/components/documents/a4-page-editor.tsx`
- `src/components/documents/template-editor/template-insertion.ts`
- `src/app/(dashboard)/template-partials/editor/page.tsx`
- `__tests__/components/a4-page-editor.test.tsx`
- `__tests__/components/template-editor-page.test.tsx`

- [ ] Route placeholder, guided-builder, AI text, table, row, and column insertion through explicit `DocumentTransactionResult` helpers and `commitUserTransaction`.
- [ ] Require a valid logical bookmark or an explicitly chosen current block. If restoration fails, do not mutate content; surface the existing recoverable selection message and require reselection.
- [ ] Remove `document.execCommand` and every `selectNodeContents(editor); collapse(false)` recovery path from insertion and formatting orchestration.
- [ ] Add tests that invalidate the saved flow ID before each insertion API call and assert unchanged canonical HTML, unchanged history, no `onChange`, and visible recovery status.

**Acceptance:** No insertion can silently append to the document end, and all insertions produce one canonical transaction, one history entry, and one reflow.

#### Task D: Make verification warning-clean and cover real pointer/focus behavior

**Files:**

- `__tests__/helpers/a4-editor-test-utils.ts`
- `__tests__/components/template-editor-page.test.tsx`
- `__tests__/browser/a4-page-editor.browser.test.tsx`
- `__tests__/browser/a4-page-editor-controls.browser.test.tsx`

- [ ] Wrap every reflow-driven update in `act`, await the final `aria-busy="false"` generation, and fail the suite on unexpected console warnings or errors.
- [ ] Replace programmatic toolbar `button.click()` and direct value mutation in browser regressions with pointer/focus interactions that preserve or intentionally restore a native selection.
- [ ] Add the missing IR-01 through IR-07 regressions and run the focused unit matrix five times plus the Chromium matrix three times with identical results and no warnings.
- [ ] Complete a production build to exit code 0. The review build compiled successfully but the available command window ended during `Collecting page data`, so the build result is not yet closure evidence.

**Acceptance:** All focused runs pass repeatedly without `act(...)`, console, framework-overlay, or application-origin errors; TypeScript, scoped ESLint, production build, and `git diff --check` all exit zero.

#### Task E: Remove DOM access from the server-render path

**Files:**

- `src/components/documents/a4-page-editor.tsx`
- `src/components/documents/a4-pagination/model.ts`
- `__tests__/components/a4-page-editor.test.tsx`
- `__tests__/components/template-editor-page.test.tsx`

- [ ] Replace render-time `splitHardSections(canonicalPagesHtml(pages)).length` with a DOM-free hard-section count derived from `PageData.hardBreakBefore`, with one section for every non-empty page list plus each explicit hard boundary.
- [ ] Audit every render-time initializer, `useMemo`, and called helper in `A4PageEditor` for `document`, `window`, `Node`, `Range`, `DOMParser`, and DOMPurify usage. Keep those APIs inside effects, event handlers, or explicitly client-only transaction calls.
- [ ] Add a `renderToString` regression for blank, populated, read-only, and preview editor states and assert no browser global is installed in the test environment.
- [ ] Add a production-route smoke test that directly requests `/template-partials/editor` and an existing-template URL, then fails on any server log containing `document is not defined`, React server-render digest, React `#419`, or an HTTP 5xx response.
- [ ] Rebuild and restart the Docker image, repeat direct-load and authenticated client navigation, and confirm both browser and container logs stay error-free.

**Acceptance:** The editor server-renders without browser globals or a client-render fallback; direct route loads are reliable; browser and production-container logs contain no editor-origin error before, during, or after hydration.

### Review Verification Evidence

- Focused Vitest matrix: 17 files, 150 tests passed; repeated unwrapped React update warnings remain.
- Chromium component matrix: 2 files, 17 tests passed; repeated unwrapped React update warnings remain.
- `npx.cmd tsc --noEmit --pretty false`: passed.
- Scoped editor/route/export ESLint: passed.
- Production build: Prisma generation and Next.js compilation completed successfully in 49 seconds; the local command window ended while collecting page data. The subsequently rebuilt Docker image started the current revision successfully, but IR-08 prevents treating the production route as clean closure evidence.
- Authenticated Docker route QA: the editor recovered and displayed 15 editable pages with no framework overlay, but each clean direct load logged React production error `#419`. React defines this as an incomplete server-rendered Suspense boundary that switched to client rendering. The app container concurrently emitted repeated `document is not defined` exceptions with digest `2292164445`.
- Direct transaction probes confirmed IR-01, IR-02, IR-04, IR-05, and IR-06 without modifying application source.
- Live Docker QA confirmed global typography, spacing, effective margins, explicit-page add/delete and Undo/Redo, generated preview, initial table insertion, panel collapse/expand, and 1024px/768px containment. No test data was saved.

## File Ownership Map

- `src/components/documents/a4-pagination/model.ts`: canonical HTML normalization and flow metadata.
- `src/components/documents/a4-pagination/selection.ts`: logical selection capture, restoration, and document offsets.
- `src/components/documents/a4-pagination/document-actions.ts`: pure canonical edit, delete, and hard-section transactions.
- `src/components/documents/a4-pagination/formatting.ts`: new logical-selection formatting and span normalization; it must not know about React state or physical page wrappers.
- `src/components/documents/a4-pagination/layout.ts`: normalized layout values and truthful human-readable layout status.
- `src/components/documents/a4-print-styles.ts`: new shared A4 print CSS used by the client editor and server export service.
- `src/components/documents/a4-page-editor.tsx`: React orchestration, native event capture, history, latest-generation reflow, page rendering, and print iframe creation.
- `src/components/documents/a4-editor-toolbar.tsx`: controlled formatting/layout controls only; it does not own canonical document state.
- `src/components/documents/template-editor/template-field-catalog.ts`: new single source of truth for insertable standard fields and legacy custom-field inference.
- `src/components/documents/template-editor/placeholder-panel.tsx`: renders the shared catalog.
- `src/app/(dashboard)/template-partials/editor/page.tsx`: route form state, validation, persistence, and save gating.
- `src/services/document-export.service.ts`: consumes shared A4 print CSS and retains its existing public export API.

---

### Task 1: Make Paste and Empty-Document Input Atomic

**Files:**
- Modify: `src/components/documents/a4-pagination/model.ts`
- Modify: `src/components/documents/a4-pagination/selection.ts`
- Modify: `src/components/documents/a4-pagination/document-actions.ts`
- Modify: `src/components/documents/a4-page-editor.tsx`
- Modify: `__tests__/components/a4-pagination/document-actions.test.ts`
- Modify: `__tests__/components/a4-page-editor.test.tsx`
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Interfaces:**
- Produces: `ensureEditableCanonicalHtml(input: string): string`.
- Produces: `replaceLogicalSelection(html: string, selection: FlowSelectionBookmark, replacementHtml: string): DocumentTransactionResult`.
- Produces: `insertParagraphAtSelection(html: string, selection: FlowSelectionBookmark): DocumentTransactionResult`.
- Consumes: the existing `commitUserTransaction(result)` path; paste and Enter must not call `execCommand`, dispatch a synthetic input, or schedule a second surface commit.

- [ ] **Step 1: Add failing pure transaction tests**

Add these cases to `__tests__/components/a4-pagination/document-actions.test.ts`:

```ts
it('replaces a collapsed selection with clipboard HTML exactly once', () => {
  const html = hydrateFlowHtml('<p>Alpha</p>');
  const flowId = new DOMParser()
    .parseFromString(html, 'text/html')
    .body.querySelector<HTMLElement>('[data-flow-id]')!.dataset.flowId!;

  const result = replaceLogicalSelection(
    html,
    {
      anchor: { flowId, offset: 5 },
      focus: { flowId, offset: 5 },
      collapsed: true,
    },
    '<p>One</p><p>Two</p>',
  );

  expect(result.changed).toBe(true);
  expect(result.html.match(/One/g)).toHaveLength(1);
  expect(result.html.match(/Two/g)).toHaveLength(1);
  expect(result.selection?.collapsed).toBe(true);
});

it('creates a stable editable paragraph for an empty canonical document', () => {
  expect(ensureEditableCanonicalHtml('')).toBe('<p><br></p>');
});

it('splits the first paragraph at the logical caret', () => {
  const html = hydrateFlowHtml('<p>AlphaBeta</p>');
  const flowId = new DOMParser()
    .parseFromString(html, 'text/html')
    .body.querySelector<HTMLElement>('[data-flow-id]')!.dataset.flowId!;

  const result = insertParagraphAtSelection(html, {
    anchor: { flowId, offset: 5 },
    focus: { flowId, offset: 5 },
    collapsed: true,
  });

  const body = new DOMParser().parseFromString(result.html, 'text/html').body;
  expect(Array.from(body.querySelectorAll('p'), (p) => p.textContent)).toEqual([
    'Alpha',
    'Beta',
  ]);
  expect(result.selection?.anchor.offset).toBe(0);
});
```

- [ ] **Step 2: Run the transaction tests and confirm the new exports are missing**

```powershell
npm.cmd run test:run -- __tests__/components/a4-pagination/document-actions.test.ts
```

Expected: FAIL because the three transaction helpers are not exported.

- [ ] **Step 3: Implement editable normalization and logical replacement**

In `model.ts`, export one blank-document normalizer:

```ts
export const EMPTY_EDITABLE_PARAGRAPH_HTML = '<p><br></p>';

export function ensureEditableCanonicalHtml(input: string): string {
  const normalized = normalizeCanonicalHtml(input);
  const root = document.createElement('div');
  root.innerHTML = normalized;
  const hasContent = Boolean(
    root.textContent?.length ||
    root.querySelector('audio,canvas,embed,hr,iframe,img,input,object,svg,table,textarea,video,.page-break'),
  );
  return hasContent ? root.innerHTML : EMPTY_EDITABLE_PARAGRAPH_HTML;
}
```

Move `documentTextOffsetForFlowPoint` and `flowPointAtDocumentTextOffset` from `a4-page-editor.tsx` into `selection.ts` and export them. In `document-actions.ts`, implement `replaceLogicalSelection` by resolving the logical range against a hydrated canonical container, deleting the range, inserting a sanitized `DocumentFragment`, rehydrating flow IDs, and returning a collapsed caret at `replacementStartOffset + replacementTextLength`. Reuse that range machinery for `insertParagraphAtSelection`; split the nearest `p`, heading, list item, or blockquote without wrapping block nodes in spans.

- [ ] **Step 4: Add browser regressions for the exact live failures**

Add these cases to `__tests__/browser/a4-page-editor.browser.test.tsx` using the file's existing `host`, `root`, `cdp`, and `flushLayoutFrames` helpers:

```tsx
it('types the first two lines in document order', async () => {
  const editorRef = createRef<A4PageEditorRef>();
  await act(async () => root.render(<A4PageEditor ref={editorRef} value="" />));
  await act(flushLayoutFrames);

  const paragraph = host.querySelector<HTMLParagraphElement>(
    '[data-testid="a4-page-content-1"] p',
  )!;
  paragraph.focus();
  const range = document.createRange();
  range.setStart(paragraph, 0);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);

  await cdp().send('Input.insertText', { text: 'Alpha' });
  await pressEnter();
  await cdp().send('Input.insertText', { text: 'Beta' });
  await act(flushLayoutFrames);

  const canonical = new DOMParser().parseFromString(
    editorRef.current!.getContent(),
    'text/html',
  );
  expect(Array.from(canonical.body.querySelectorAll('p'), (p) => p.textContent))
    .toEqual(['Alpha', 'Beta']);
});

it('pastes a long plain-text draft once', async () => {
  const editorRef = createRef<A4PageEditorRef>();
  const onChange = vi.fn();
  await act(async () => root.render(
    <A4PageEditor ref={editorRef} value="<p>Start</p>" onChange={onChange} />,
  ));
  await act(flushLayoutFrames);

  const lines = Array.from({ length: 120 }, (_, index) => `Draft line ${index + 1}`);
  const pageContent = host.querySelector<HTMLElement>('[data-testid="a4-page-content-1"]')!;
  const text = pageContent.querySelector('p')!.firstChild!;
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.setStart(text, text.textContent!.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', lines.join('\n'));
  await act(async () => {
    pageContent.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  });
  await act(flushLayoutFrames);

  const textContent = new DOMParser()
    .parseFromString(editorRef.current!.getContent(), 'text/html')
    .body.textContent ?? '';
  expect(textContent.match(/Draft line 34/g)).toHaveLength(1);
  expect(textContent.match(/Draft line 120/g)).toHaveLength(1);
  expect(onChange).toHaveBeenCalledTimes(1);
});
```

Do not use clipboard automation that bypasses the React paste handler.

- [ ] **Step 5: Route paste and Enter through one transaction**

Replace the current paste body with:

```ts
const bookmark = captureFlowSelection(surface);
if (!bookmark) return;
commitUserTransaction(
  replaceLogicalSelection(
    canonicalPagesHtml(pagesRef.current),
    bookmark,
    clipboardHtml(event.clipboardData),
  ),
);
```

Handle cancelable `beforeinput` with `inputType === 'insertParagraph'` by preventing the native mutation and committing `insertParagraphAtSelection`. Delete `document.execCommand('insertHTML')` and `setTimeout(commitDocumentSurface, 0)` from the paste path. Keep `commitDocumentSurface` only for native mutations that are not already represented by a canonical transaction.

- [ ] **Step 6: Run the focused input suites**

```powershell
npm.cmd run test:run -- __tests__/components/a4-pagination/document-actions.test.ts __tests__/components/a4-page-editor.test.tsx
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx
```

Expected: PASS; each paste/input operation emits one change, and `Alpha`, Enter, `Beta` remains in that order.

- [ ] **Step 7: Commit Task 1**

```powershell
git add -- src/components/documents/a4-pagination/model.ts src/components/documents/a4-pagination/selection.ts src/components/documents/a4-pagination/document-actions.ts src/components/documents/a4-page-editor.tsx __tests__/components/a4-pagination/document-actions.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "fix(documents): make A4 input transactions atomic"
```

---

### Task 2: Preserve Logical Selection and Normalize Inline Formatting

**Files:**
- Create: `src/components/documents/a4-pagination/formatting.ts`
- Create: `__tests__/components/a4-pagination/formatting.test.ts`
- Modify: `src/components/documents/a4-pagination/selection.ts`
- Modify: `src/components/documents/a4-page-editor.tsx`
- Modify: `src/components/documents/a4-editor-toolbar.tsx`
- Modify: `__tests__/components/a4-page-editor.test.tsx`
- Modify: `__tests__/components/a4-editor-toolbar.test.tsx`
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Interfaces:**
- Replaces raw DOM selection storage with `FlowSelectionBookmark | null`.
- Extends `EditorFormatState` with `fontFamily`, `fontSize`, `paragraphStyle`, `textColor`, and `highlightColor`.
- Produces: `applyInlineFormat(html, selection, patch): DocumentTransactionResult`.
- Produces: `readLogicalFormatState(root, bookmark, fallbackLayout): EditorFormatState`.
- Produces: `normalizeFormattingSpans(root: HTMLElement): void`.

```ts
export interface InlineFormatPatch {
  fontFamily?: string | null;
  fontSize?: string | null;
  color?: string | null;
  backgroundColor?: string | null;
  fontWeight?: 'bold' | null;
  fontStyle?: 'italic' | null;
  textDecoration?: 'underline' | null;
}
```

- [ ] **Step 1: Add failing formatting tests**

Cover these exact behaviors in `formatting.test.ts`:

```ts
it('colours text across two flow blocks without wrapping block elements', () => {
  const html = hydrateFlowHtml('<p>Alpha</p><p>Beta</p>');
  const [first, second] = flowIds(html);
  const result = applyInlineFormat(html, {
    anchor: { flowId: first, offset: 2 },
    focus: { flowId: second, offset: 2 },
    collapsed: false,
  }, { color: '#ff0000' });

  const body = parseBody(result.html);
  expect(body.querySelector('span > p')).toBeNull();
  expect(body.querySelectorAll('span[style*="color"]')).toHaveLength(2);
  expect(body.textContent).toBe('AlphaBeta');
});

it('merges adjacent spans with the same normalized style', () => {
  const root = document.createElement('div');
  root.innerHTML = '<p><span style="font-size: 14pt">A</span><span style="font-size:14pt">B</span></p>';
  normalizeFormattingSpans(root);
  expect(root.querySelectorAll('span')).toHaveLength(1);
  expect(root.textContent).toBe('AB');
});
```

In `a4-page-editor.test.tsx`, add a controlled layout rerender test that selects `Beta`, changes the layout, waits for pagination, invokes text colour, and asserts only `Beta` is red. In `a4-editor-toolbar.test.tsx`, rerender with two different `activeFormats` objects and assert every select/colour input reflects the new values.

- [ ] **Step 2: Run the formatting and toolbar tests and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/components/a4-pagination/formatting.test.ts __tests__/components/a4-editor-toolbar.test.tsx __tests__/components/a4-page-editor.test.tsx
```

Expected: FAIL because formatting is DOM-command based, selection storage uses raw nodes, and toolbar values are uncontrolled.

- [ ] **Step 3: Implement block-safe formatting**

In `formatting.ts`, resolve the logical selection in a detached hydrated canonical root. Use a `TreeWalker` over text nodes intersecting the resolved `Range`; wrap only the selected text slices, never `p`, `div`, headings, lists, table rows, or page wrappers. Apply the patch to each text wrapper, remove empty style attributes, unwrap styleless spans, flatten spans with identical computed inline style text, and merge adjacent equal spans.

Return the original logical bookmark so `commitUserTransaction` restores the selection after reflow. For a collapsed selection, return `{ html, selection, changed: false }`; future typing-style state is outside this remediation.

- [ ] **Step 4: Replace raw selection storage**

Replace `savedSelectionRef` with:

```ts
const savedSelectionRef = useRef<FlowSelectionBookmark | null>(null);

const saveCursorPosition = useCallback(() => {
  const surface = documentSurfaceRef.current;
  if (surface) savedSelectionRef.current = captureFlowSelection(surface);
}, []);

const restoreSelection = useCallback(() => {
  const surface = documentSurfaceRef.current;
  const bookmark = savedSelectionRef.current;
  return Boolean(surface && bookmark && restoreFlowSelection(surface, bookmark));
}, []);
```

After each successful mouse, keyboard, focus, or reflow restoration, synchronize `savedSelectionRef.current` from the live logical selection. If restoration fails, keep content unchanged, focus the first valid flow block, and show the non-blocking editor status `Selection moved after repagination; choose the text again.` Do not fall back to appending at the document end.

- [ ] **Step 5: Make formatting controls controlled**

Extend `EditorFormatState` and replace all `defaultValue` properties in `A4EditorToolbar`:

```tsx
<select
  aria-label="Font family"
  value={activeFormats.fontFamily}
  disabled={disabled}
  onPointerDown={onSaveSelection}
  onChange={(event) => onLegacyCommand?.('fontName', event.target.value)}
>
  {DOCUMENT_FONT_OPTIONS.map((font) => (
    <option key={font.value} value={font.value}>{font.label}</option>
  ))}
</select>
<select
  aria-label="Font size"
  value={activeFormats.fontSize}
  disabled={disabled}
  onPointerDown={onSaveSelection}
  onChange={(event) => onLegacyCommand?.('customFontSize', event.target.value)}
>
  {DOCUMENT_FONT_SIZE_OPTIONS.map((size) => (
    <option key={size} value={size}>{size.replace('pt', '')}</option>
  ))}
</select>
<select
  aria-label="Paragraph style"
  value={activeFormats.paragraphStyle}
  disabled={disabled}
  onPointerDown={onSaveSelection}
  onChange={(event) => onLegacyCommand?.('paragraphStyle', event.target.value)}
>
  <option value="p">Normal</option>
  <option value="h1">Heading 1</option>
  <option value="h2">Heading 2</option>
  <option value="h3">Heading 3</option>
  <option value="blockquote">Quote</option>
</select>
<input
  aria-label="Text color"
  type="color"
  value={activeFormats.textColor}
  disabled={disabled}
  onPointerDown={onSaveSelection}
  onChange={(event) => onLegacyCommand?.('textColor', event.target.value)}
/>
<input
  aria-label="Highlight color"
  type="color"
  value={activeFormats.highlightColor}
  disabled={disabled}
  onPointerDown={onSaveSelection}
  onChange={(event) => onLegacyCommand?.('highlightColor', event.target.value)}
/>
```

Route `fontName`, `customFontSize`, `textColor`, and `highlightColor` to `applyInlineFormat` plus `commitUserTransaction`. Remove the temporary `<font>` conversion and `applyInlineStyleToSelection`. Bold, italic, underline, and clear-formatting must also use the same logical bookmark and normalization path so they cannot invalidate the selection before a subsequent colour or size change.

- [ ] **Step 6: Add a markup-growth browser regression**

Format the same full-document selection with 14pt and Georgia twice. Assert visible text is unchanged, there is no `span > p`, and the second pass does not increase the span count:

```ts
const afterFirst = host.querySelectorAll('span[style]').length;
await applySameFormattingAgain();
expect(host.querySelectorAll('span[style]')).toHaveLength(afterFirst);
expect(editorRef.current!.getContent().length).toBeLessThan(30_000);
```

Use a fixture whose initial canonical HTML is below 10,000 characters so the 30,000-character ceiling detects runaway nesting without coupling the test to the live agreement.

- [ ] **Step 7: Run focused formatting verification**

```powershell
npm.cmd run test:run -- __tests__/components/a4-pagination/formatting.test.ts __tests__/components/a4-editor-toolbar.test.tsx __tests__/components/a4-page-editor.test.tsx
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx
```

Expected: PASS; selection survives layout changes, cross-block colour is valid HTML, toolbar values track the cursor, and repeat formatting is idempotent.

- [ ] **Step 8: Commit Task 2**

```powershell
git add -- src/components/documents/a4-pagination/formatting.ts src/components/documents/a4-pagination/selection.ts src/components/documents/a4-page-editor.tsx src/components/documents/a4-editor-toolbar.tsx __tests__/components/a4-pagination/formatting.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-editor-toolbar.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "fix(documents): preserve A4 formatting selections"
```

---

### Task 3: Correct Backspace and Explicit-Page Deletion

**Files:**
- Modify: `src/components/documents/a4-pagination/document-actions.ts`
- Modify: `src/components/documents/a4-page-editor.tsx`
- Modify: `src/components/documents/a4-editor-toolbar.tsx`
- Modify: `__tests__/components/a4-pagination/document-actions.test.ts`
- Modify: `__tests__/components/a4-page-editor.test.tsx`
- Modify: `__tests__/browser/a4-page-editor-controls.browser.test.tsx`
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Interfaces:**
- Produces: `hardSectionIndexForFragment(fragments: PageFragment[], fragmentIndex: number): number | null`.
- Consumes: existing `applyLogicalDelete(html, selection, 'backward' | 'forward')` and `deleteHardPageSection(html, sectionIndex)`.
- Page-chrome deletion is available only on the first fragment of a hard section when the canonical document contains at least two hard sections.

- [ ] **Step 1: Replace the incorrect Backspace expectation and add page-deletion failures**

Change the existing test named `joins content without deleting the preceding character at a soft page boundary` to:

```tsx
it('deletes the preceding logical character at a soft page boundary', async () => {
  fireEvent.keyDown(pageTwoContent, { key: 'Backspace' });
  await waitFor(() => {
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringContaining('12345678012345'),
    );
  });
  expect(onChange).toHaveBeenLastCalledWith(
    expect.not.stringContaining('123456789012345'),
  );
  expect(onChange).toHaveBeenCalledTimes(1);
});
```

Keep the existing deterministic `scrollHeight` fixture and caret placement, renaming `secondPage` to `pageTwoContent`. Add these additional behavioral cases:

- An automatically paginated document with no hard break has no enabled Delete Current Page and no page-chrome delete controls.
- Clicking a hard section's first chrome control removes the whole section, including all its soft fragments, and leaves surrounding sections intact.
- Clicking Delete Current Page while the caret is in a later soft fragment removes that fragment's owning hard section, not just the fragment.
- Undo restores the deleted section and redo removes it again with one history entry per action.

- [ ] **Step 2: Run the delete suites and confirm the current behavior fails**

```powershell
npm.cmd run test:run -- __tests__/components/a4-pagination/document-actions.test.ts __tests__/components/a4-page-editor.test.tsx
npm.cmd run test:browser -- __tests__/browser/a4-page-editor-controls.browser.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx
```

Expected: FAIL because Backspace joins without deleting and delete controls target physical fragments.

- [ ] **Step 3: Route both boundary delete directions through the logical transaction**

At a page-content start, capture the logical bookmark and call:

```ts
event.preventDefault();
commitUserTransaction(
  applyLogicalDelete(
    canonicalPagesHtml(pagesRef.current),
    captureFlowSelection(surface)!,
    'backward',
  ),
);
```

Retain the existing forward path with `'forward'`. Delete `handleBackspaceAtPageStart`, `pendingBoundaryFocusRef`, and the old fragment-splice path after their remaining references reach zero.

- [ ] **Step 4: Derive page deletion from hard sections**

Implement:

```ts
export function hardSectionIndexForFragment(
  fragments: PageFragment[],
  fragmentIndex: number,
): number | null {
  if (!Number.isInteger(fragmentIndex) || fragmentIndex < 0 || fragmentIndex >= fragments.length) {
    return null;
  }
  return fragments
    .slice(0, fragmentIndex + 1)
    .reduce((section, fragment) => section + (fragment.hardBreakBefore ? 1 : 0), 0);
}
```

In the editor, compute `hardSectionCount = splitHardSections(canonicalPagesHtml(pages)).length`. The toolbar can delete only when `hardSectionCount > 1`. `handleDeletePage(id)` resolves the clicked fragment index, maps it to a section index, and commits `deleteHardPageSection(canonical, sectionIndex)`.

Render a page-chrome delete control only when `hardSectionCount > 1` and `(index === 0 || page.hardBreakBefore)`. Rename its accessible label to `Delete explicit page section starting at page ${pageNumber}` and its title to `Delete explicit page section`.

- [ ] **Step 5: Run focused deletion verification**

Run the Step 2 commands again.

Expected: PASS; Backspace and Delete are symmetric, soft-only pages cannot be deleted as pages, and section deletion is atomic and undoable.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- src/components/documents/a4-pagination/document-actions.ts src/components/documents/a4-page-editor.tsx src/components/documents/a4-editor-toolbar.tsx __tests__/components/a4-pagination/document-actions.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/browser/a4-page-editor-controls.browser.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "fix(documents): make A4 page deletion logical"
```

---

### Task 4: Unify the Fields Panel and Validation Catalog

**Files:**
- Create: `src/components/documents/template-editor/template-field-catalog.ts`
- Create: `__tests__/components/template-editor/template-field-catalog.test.ts`
- Modify: `src/components/documents/template-editor/placeholder-panel.tsx`
- Modify: `src/components/documents/template-editor/template-validation.ts`
- Modify: `src/app/(dashboard)/template-partials/editor/page.tsx`
- Modify: `__tests__/components/template-editor/placeholder-panel.test.tsx`
- Modify: `__tests__/components/template-editor/template-validation.test.ts`
- Modify: `__tests__/components/template-editor-page.test.tsx`

**Interfaces:**
- Produces: `TEMPLATE_FIELD_CATEGORIES: readonly TemplateFieldCategory[]`.
- Produces: `standardTemplateKeys(): ReadonlySet<string>`.
- Produces: `inferLegacyCustomPlaceholders(content: string, existing: CustomPlaceholderDefinition[]): CustomPlaceholderDefinition[]`.
- The Fields panel and route validator consume the same exported category list; neither keeps a second manually maintained key array.

- [ ] **Step 1: Add catalog-consistency and legacy-template tests**

```ts
it('accepts every ordinary field offered by the Fields panel', () => {
  const keys = standardTemplateKeys();
  const insertableKeys = TEMPLATE_FIELD_CATEGORIES
    .flatMap((category) => category.fields)
    .filter((field) => !field.builder && !field.key.includes('{{'))
    .map((field) => field.key);

  for (const key of insertableKeys) {
    expect(validateTemplateSyntax(`<p>{{${key}}}</p>`, keys)).toEqual([]);
  }
});

it('infers missing custom definitions from an existing template', () => {
  const inferred = inferLegacyCustomPlaceholders(
    '<p>{{custom.agreementDate}}</p><p>{{custom.termMonths}}</p>',
    [],
  );
  expect(inferred.map((field) => field.key)).toEqual([
    'agreementDate',
    'termMonths',
  ]);
  expect(inferred.every((field) => field.type === 'text')).toBe(true);
});
```

Add a route component case using the agreement's standard and legacy custom keys. Assert Test & Preview has no `company.address.letter` or `selectedContact.name` error and Save Template is not disabled by those keys.

- [ ] **Step 2: Run catalog, validation, panel, and route tests**

```powershell
npm.cmd run test:run -- __tests__/components/template-editor/template-field-catalog.test.ts __tests__/components/template-editor/template-validation.test.ts __tests__/components/template-editor/placeholder-panel.test.tsx __tests__/components/template-editor-page.test.tsx
```

Expected: FAIL because the panel-local `CATEGORIES` and route-local `STANDARD_TEMPLATE_KEYS` disagree and missing legacy custom definitions are not inferred.

- [ ] **Step 3: Extract the shared catalog**

Move the existing `Field`, `Category`, and `CATEGORIES` declarations from `placeholder-panel.tsx` into `template-field-catalog.ts` as immutable exported values. Include all Company, Selected Director, Selected Shareholder, Selected Contact, System, loop, condition, modifier, and agreement-slot entries already displayed by the panel.

Implement `standardTemplateKeys` by flattening actual placeholder keys and excluding builder-only entries, modifiers containing nested syntax, and agreement slots beginning with `@` because the syntax validator already treats those as structured generator tokens.

- [ ] **Step 4: Infer legacy custom definitions without creating dirty state on load**

Implement a deterministic scanner for tokens matching `{{custom.<identifier>}}`. Merge only missing keys after stored definitions, preserve stored order and metadata, and create inferred definitions with:

```ts
{
  id: `legacy-custom-${key}`,
  key,
  label: key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' '),
  type: 'text',
  required: false,
  description: 'Recovered from existing template content.',
}
```

Hydrate these definitions into the route's initial form baseline before dirty-state comparison. Persist them when the user later saves any template change. Newly typed unknown `custom.*` tokens remain blocking until created through the Fields panel; only references present in loaded legacy content are inferred automatically.

- [ ] **Step 5: Replace the duplicate route key list**

Delete `STANDARD_TEMPLATE_KEYS`. Initialize validation with `new Set(standardTemplateKeys())`, then add editor custom fields, merged partial fields, and partial names exactly as today. Make `PlaceholderPanel` render `TEMPLATE_FIELD_CATEGORIES` from the shared module.

- [ ] **Step 6: Run focused validation verification**

Run the Step 2 command again.

Expected: PASS; every listed standard field validates, legacy custom references are editable and persistable, and genuinely new unknown keys remain actionable errors.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- src/components/documents/template-editor/template-field-catalog.ts src/components/documents/template-editor/placeholder-panel.tsx src/components/documents/template-editor/template-validation.ts "src/app/(dashboard)/template-partials/editor/page.tsx" __tests__/components/template-editor/template-field-catalog.test.ts __tests__/components/template-editor/placeholder-panel.test.tsx __tests__/components/template-editor/template-validation.test.ts __tests__/components/template-editor-page.test.tsx
git commit -m "fix(documents): unify template field validation"
```

---

### Task 5: Make Global Layout Reflow and Status Truthful

**Files:**
- Modify: `src/components/documents/a4-pagination/layout.ts`
- Modify: `src/components/documents/a4-page-editor.tsx`
- Modify: `src/components/documents/a4-editor-toolbar.tsx`
- Modify: `src/components/documents/template-editor/template-details-panel.tsx`
- Modify: `__tests__/components/a4-pagination/layout.test.ts`
- Modify: `__tests__/components/a4-page-editor.test.tsx`
- Modify: `__tests__/components/a4-editor-toolbar.test.tsx`
- Modify: `__tests__/components/template-editor/template-editor-panel.test.tsx`
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Interfaces:**
- Produces: `formatA4LayoutStatus(layout: A4DocumentLayout): string`.
- Produces an editor `isReflowing` state exposed through `aria-busy`, a visible `role="status"`, and disabled destructive/formatting actions until the latest generation is committed.
- Adds optional `mutationDisabled?: boolean` to `A4EditorToolbarProps`; layout inputs use `disabled`, while document formatting and page mutations use `disabled || mutationDisabled`.
- Rapid layout changes remain coalesced; only the highest `reflowGenerationRef` value may clear the busy state or publish pages.

- [ ] **Step 1: Add failing status and latest-generation tests**

```ts
it('formats all four effective margins without mojibake', () => {
  expect(formatA4LayoutStatus({
    ...DEFAULT_A4_DOCUMENT_LAYOUT,
    marginsMm: { top: 60, right: 20, bottom: 15, left: 10 },
  })).toBe('A4 210 × 297 mm · margins T60 R20 B15 L10 mm');
});
```

In the editor test, rerender layout values `14pt`, `20pt`, and `11pt` before flushing animation frames. Assert the final page styles and status use `11pt`, only the final derived page set remains, canonical text is unchanged, and no content `onChange` is emitted for controlled layout changes.

Add a browser assertion that `aria-busy="true"` and `Repaginating…` appear after a margin change, then disappear when the page counter stabilizes.

- [ ] **Step 2: Run layout/editor tests and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/components/a4-pagination/layout.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-editor-toolbar.test.tsx __tests__/components/template-editor/template-editor-panel.test.tsx
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx
```

Expected: FAIL because the footer is hard-coded and no reflow state is exposed.

- [ ] **Step 3: Implement truthful status formatting**

Add `formatA4LayoutStatus` to `layout.ts` and replace the current footer with:

```tsx
<span>{formatA4LayoutStatus(effectiveLayout)}</span>
<span role="status" aria-live="polite">
  {isReflowing
    ? 'Repaginating…'
    : readOnly
      ? 'Viewing document'
      : effectivePreviewMode
        ? 'Viewing preview'
        : 'Editing'}
</span>
```

Remove the hard-coded `A4.MARGIN_MM`, the corrupted multiplication sequence, and the absolute `What you see = What prints` claim. Task 6 establishes and tests parity before equivalent copy may be restored.

- [ ] **Step 4: Publish a stable reflow lifecycle**

Set `isReflowing` before scheduling measurement. Use a paint frame before the measurement frame so the busy state is visible for long documents. In every completion, cancellation, and unmount branch, clear the state only when the finishing generation equals `reflowGenerationRef.current`.

Apply `aria-busy={isReflowing}` to the document surface and pass the state separately from preview/read-only disablement:

```tsx
<A4EditorToolbar
  disabled={effectivePreviewMode}
  mutationDisabled={isReflowing}
  layout={effectiveLayout}
  activeFormats={activeFormats}
  onLayoutChange={updateLayout}
  showPageNumbers={showPageNumbers}
  canDeletePage={canDeleteHardSection}
  onCommand={handleToolbarCommand}
  onInsertPageBreak={splitActivePageAtSelection}
  onAddBlankPage={handleAddPage}
  onDeleteCurrentPage={handleDeleteCurrentSection}
  onTogglePageNumbers={setShowPageNumbers}
  onSaveSelection={saveCursorPosition}
  onLegacyCommand={handleCommand}
/>
```

Disable Delete Current Page and inline formatting while reflow is pending; keep layout controls enabled so rapid global-setting changes can coalesce to the newest value. Add toolbar tests proving `mutationDisabled` blocks document commands but not the global font, size, spacing, or margin controls.

- [ ] **Step 5: Add narrow-viewport coverage**

At a 1024×720 viewport, assert the browser body does not gain horizontal overflow, the editor scroll container can reach both A4 edges, and the Formats, Add Page, and panel-collapse controls remain keyboard reachable. Horizontal canvas scrolling is acceptable; clipping with no reachable scrollbar is not.

- [ ] **Step 6: Run focused layout verification**

Run the Step 2 commands again.

Expected: PASS; effective margins are shown accurately, no mojibake remains, latest-generation layout wins, and the user receives stable repagination feedback.

- [ ] **Step 7: Commit Task 5**

```powershell
git add -- src/components/documents/a4-pagination/layout.ts src/components/documents/a4-page-editor.tsx src/components/documents/a4-editor-toolbar.tsx src/components/documents/template-editor/template-details-panel.tsx __tests__/components/a4-pagination/layout.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-editor-toolbar.test.tsx __tests__/components/template-editor/template-editor-panel.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "fix(documents): expose stable A4 layout reflow"
```

---

### Task 6: Surface Oversized Content and Share Print Semantics

**Files:**
- Create: `src/components/documents/a4-print-styles.ts`
- Create: `__tests__/components/a4-print-styles.test.ts`
- Modify: `src/components/documents/a4-page-editor.tsx`
- Modify: `src/services/document-export.service.ts`
- Modify: `__tests__/components/a4-page-editor.test.tsx`
- Modify: `__tests__/components/a4-pagination/engine.test.ts`
- Modify: `__tests__/services/document-export-layout.test.ts`
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`

**Interfaces:**
- Produces: `buildA4PrintCss(layout: A4DocumentLayout): string` in a client/server-safe module with no Prisma, JSDOM, or React dependency.
- `document-export.service.ts` re-exports `buildA4PrintCss` to retain its current public import contract.
- `Page` consumes `page.oversized` and renders an accessible recovery affordance rather than silently clipping.

- [ ] **Step 1: Add failing shared-style and oversized-page tests**

```ts
it('does not add print-only spacing to br elements', () => {
  const css = buildA4PrintCss(DEFAULT_A4_DOCUMENT_LAYOUT);
  expect(css).not.toContain('br { display: block');
  expect(css).toContain('br { margin: 0; }');
});

it('uses the saved margins, typography, and paragraph spacing', () => {
  const css = buildA4PrintCss({
    ...DEFAULT_A4_DOCUMENT_LAYOUT,
    fontFamily: 'Georgia, serif',
    fontSize: '14pt',
    lineHeight: 1.8,
    paragraphSpacing: '8px',
    marginsMm: { top: 10, right: 15, bottom: 20, left: 25 },
  });
  expect(css).toContain('margin: 10mm 15mm 20mm 25mm');
  expect(css).toContain('font-family: Georgia, serif');
  expect(css).toContain('font-size: 14pt');
  expect(css).toContain('line-height: 1.8');
  expect(css).toContain('margin: 0 0 8px 0');
});
```

Render an unsplittable tall one-row table with a deterministic measurer. Assert the engine returns one `oversized` page and the editor renders `role="alert"` with `This block is taller than the printable A4 area.` Assert the oversized page content is vertically scrollable in edit mode.

- [ ] **Step 2: Run print and oversized tests and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/components/a4-print-styles.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-pagination/engine.test.ts __tests__/services/document-export-layout.test.ts
```

Expected: FAIL because print CSS is duplicated and oversized metadata is not rendered.

- [ ] **Step 3: Extract one print stylesheet**

Move the A4-safe portion of `DOCUMENT_STYLES` and the layout substitution logic into `a4-print-styles.ts`. Generate values directly from normalized layout rather than chained string replacements. Include identical rules for headings, paragraphs, lists, blockquotes, tables, whitespace, word breaking, and page content height.

Use `br { margin: 0; }`; do not synthesize line spacing with pseudo block margins. Use a fixed content height of `calc(297mm - top - bottom)` and the same paragraph spacing used by the editor measurer.

Import this function in `A4PageEditor.handlePrint`. In `document-export.service.ts`, import and re-export it:

```ts
import { buildA4PrintCss } from '@/components/documents/a4-print-styles';
export { buildA4PrintCss } from '@/components/documents/a4-print-styles';
```

- [ ] **Step 4: Render oversized pages explicitly**

Pass `oversized` into `Page`. In edit mode, set `overflowY: page.oversized ? 'auto' : 'hidden'` and add a page overlay outside the editable content:

```tsx
{page.oversized ? (
  <div role="alert" className="absolute inset-x-4 bottom-2 z-20 rounded bg-status-warning/10 px-2 py-1 text-xs text-status-warning">
    This block is taller than the printable A4 area. Split the content or reduce its size.
  </div>
) : null}
```

Preview and print must render the oversized block once. Do not duplicate it across pages. Include `data-oversized="true"` on the print section so browser/PDF regression tests can assert the exceptional path.

- [ ] **Step 5: Align page-number placement**

Place the editor page number halfway into the effective bottom margin using `bottom: pageLayout.bottomPx / 2`. In shared print CSS, place `.print-page-number` at `bottom: calc(-1 * bottomMargin / 2)` relative to the printable content box. Test 10mm and 20mm bottom margins so the position remains layout-derived.

- [ ] **Step 6: Add Chromium print-media verification**

In the browser suite, render content containing ordinary `<br>` elements and a near-page-bottom marker. Capture the edit page count, emulate print media, and assert the marker remains in the same numbered `.print-page`. Also assert no application console error occurs while creating and removing the hidden print iframe.

- [ ] **Step 7: Run print/export verification**

```powershell
npm.cmd run test:run -- __tests__/components/a4-print-styles.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-pagination/engine.test.ts __tests__/services/document-export-layout.test.ts
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx
```

Expected: PASS; print and export share layout rules, ordinary line breaks do not repaginate, and oversized blocks are visible, editable, and represented once.

- [ ] **Step 8: Commit Task 6**

```powershell
git add -- src/components/documents/a4-print-styles.ts src/components/documents/a4-page-editor.tsx src/services/document-export.service.ts __tests__/components/a4-print-styles.test.ts __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-pagination/engine.test.ts __tests__/services/document-export-layout.test.ts __tests__/browser/a4-page-editor.browser.test.tsx
git commit -m "fix(documents): align A4 editor and print layout"
```

---

### Task 7: Make Pagination Tests Deterministic and Cover the Real Route

**Files:**
- Create: `__tests__/helpers/a4-editor-test-utils.ts`
- Modify: `__tests__/components/a4-page-editor.test.tsx`
- Modify: `__tests__/browser/a4-page-editor.browser.test.tsx`
- Modify: `__tests__/browser/a4-page-editor-controls.browser.test.tsx`
- Modify: `__tests__/components/template-editor-page.test.tsx`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Produces test helpers `installDeterministicA4Measurement(options)` and `flushA4Reflow()`.
- The helper returns a cleanup callback and must restore every patched DOM descriptor after each test.
- Route tests exercise the template editor with mocked data hooks but real `A4PageEditor`, `TemplateEditorPanel`, validation, and form persistence logic.

- [ ] **Step 1: Add deterministic measurement helpers**

```ts
export function installDeterministicA4Measurement(
  { pixelsPerCharacter = 2, blockHeight = 24 } = {},
): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      if (!(this instanceof HTMLElement) || this.style.position !== 'fixed') return 0;
      const blocks = Math.max(1, this.querySelectorAll('p,li,tr,h1,h2,h3,blockquote').length);
      return blocks * blockHeight + (this.textContent?.length ?? 0) * pixelsPerCharacter;
    },
  });
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', original);
    else delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
  };
}

export async function flushA4Reflow(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
```

Use it only in jsdom suites that assert exact page distribution. Real Chromium pagination tests continue using actual browser layout.

- [ ] **Step 2: Rewrite the flaky soft-page deletion setup**

Install the deterministic measurer in the existing `deletes only the clicked soft-paginated page` test and await `flushA4Reflow` plus an explicit expected page count before clicking. Remove arbitrary `setTimeout` waits and assertions that race an outstanding generation.

- [ ] **Step 3: Add a route-level drafting and save/reopen test**

In `template-editor-page.test.tsx`, use a stored template fixture containing standard and inferred custom fields. Exercise this sequence:

1. Load the template and wait for the first stable page counter.
2. Type a new paragraph and paste a multi-line block.
3. Select text and change font size, family, and colour.
4. Change top and left margins.
5. Insert and remove an explicit page section.
6. Save once and capture the mutation payload.
7. Rerender from that payload as the loaded template.
8. Assert canonical text, inline formatting, hard breaks, custom definitions, and `contentJson.layout` are preserved.

The mutation assertion must verify one content copy only and preserve unrelated `contentJson` keys:

```ts
expect(updateMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
  content: expect.stringContaining('Draft line 120'),
  contentJson: expect.objectContaining({
    existingMetadata: { keep: true },
    layout: expect.objectContaining({
      marginsMm: expect.objectContaining({ top: 30, left: 25 }),
    }),
  }),
}));
expect(updateMutation.mutateAsync.mock.calls[0][0].content.match(/Draft line 120/g))
  .toHaveLength(1);
```

- [ ] **Step 4: Run the focused suites repeatedly**

```powershell
1..5 | ForEach-Object {
  npm.cmd run test:run -- __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-pagination __tests__/components/template-editor-page.test.tsx
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
1..3 | ForEach-Object {
  npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx __tests__/browser/a4-page-editor-controls.browser.test.tsx
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: every iteration passes with identical page-count assertions and no timeout-only retry masking.

- [ ] **Step 5: Document the transaction and reflow ownership**

Update `docs/ARCHITECTURE.md` with:

- Native event → logical bookmark → pure document transaction → one history snapshot → latest-generation reflow → logical selection restoration.
- Canonical hard sections versus derived soft page fragments.
- Shared standard-field catalog ownership.
- Shared layout and print-style ownership.
- Oversized-block behavior and why it is represented once.

- [ ] **Step 6: Commit Task 7**

```powershell
git add -- __tests__/helpers/a4-editor-test-utils.ts __tests__/components/a4-page-editor.test.tsx __tests__/browser/a4-page-editor.browser.test.tsx __tests__/browser/a4-page-editor-controls.browser.test.tsx __tests__/components/template-editor-page.test.tsx docs/ARCHITECTURE.md
git commit -m "test(documents): stabilize A4 drafting workflows"
```

---

### Task 8: Complete Authenticated QA and the Full Verification Matrix

**Files:**
- Modify only if verification exposes a scoped regression in files already listed by Tasks 1–7.
- Update: `docs/guides/DESIGN_GUIDELINE.md` only if the final controlled-format, reflow-status, or oversized-content pattern is reusable outside the A4 editor.

**Interfaces:**
- Consumes the completed editor, validation, layout, print, and route workflows.
- Produces fresh automated and authenticated rendered evidence; it does not broaden feature scope.

- [ ] **Step 1: Run the complete automated matrix**

```powershell
npm.cmd run test:run -- __tests__/components/a4-page-editor.test.tsx __tests__/components/a4-editor-toolbar.test.tsx __tests__/components/a4-pagination __tests__/components/template-editor __tests__/components/template-editor-page.test.tsx __tests__/services/document-export-layout.test.ts
npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx __tests__/browser/a4-page-editor-controls.browser.test.tsx
npx.cmd tsc --noEmit --pretty false
npx.cmd eslint src/components/documents "src/app/(dashboard)/template-partials/editor/page.tsx" src/services/document-export.service.ts
npm.cmd run build
git diff --check
```

Expected:

- Every focused Vitest suite passes with no skipped A4 regression.
- Every Chromium browser test passes with no application-origin console error.
- TypeScript, ESLint, production build, and `git diff --check` exit zero.

- [ ] **Step 2: Perform authenticated desktop drafting QA**

Use the local route `/template-partials/editor` and an existing long template. Do not save destructive trials to the shared template. Verify this exact sequence with unique marker text:

1. Type, Enter, Backspace, forward Delete, select, cut, copy, and collapsed paste.
2. Undo and redo every content mutation.
3. Change selected font, size, colour, highlight, bold, italic, underline, alignment, list, and paragraph style.
4. Change global font, size, line spacing, paragraph spacing, and all four margins rapidly.
5. Insert a hard page break, add a blank page, delete the current explicit section, undo, and redo.
6. Preview and print, then compare page count and the marker's page position.
7. Save a disposable template, reopen it, and verify content, layout, formatting, page breaks, and validation state.

After every step, verify canonical text occurrence counts, page counter stability, selection/caret location, Save enabled state, lack of framework overlay, and console health.

- [ ] **Step 3: Perform narrow-viewport QA**

At 1024×720 and 768×720:

- Confirm the A4 canvas can be scrolled to both horizontal edges.
- Confirm toolbar overflow does not trap History, Page, or Formats actions.
- Collapse and expand the editor tools panel with keyboard and pointer input.
- Confirm margin inputs, colour inputs, page controls, and status remain reachable.
- Confirm no horizontal overflow is added to the application body.

- [ ] **Step 4: Verify generated-document parity**

Open a generated document that uses the saved template layout. Verify read-only view, generated-document edit, preview, browser print, HTML export, and PDF export use the same font defaults, line spacing, paragraph spacing, margins, hard-page boundaries, and ordinary `<br>` behavior.

- [ ] **Step 5: Record the final evidence in the implementation PR description**

Include:

- Exact automated commands and pass counts.
- The five-run unit stability result and three-run browser stability result.
- Desktop and narrow authenticated routes tested.
- A before/after note for paste occurrence count, blank Enter order, Backspace boundary character, explicit-section deletion, margin status, validation errors, and print page count.
- Any unrelated observation under a clearly labeled follow-up section without changing it in this remediation.

- [ ] **Step 6: Commit reusable documentation changes, if required**

```powershell
git add -- docs/ARCHITECTURE.md docs/guides/DESIGN_GUIDELINE.md
git commit -m "docs: document reliable A4 editing patterns"
```

Skip this commit when Task 7's architecture update is sufficient and no reusable design-guideline rule changed.

---

## Finding-to-Task Coverage

| Finding | Implemented by | Primary regression evidence |
|---|---|---|
| Duplicate paste | Task 1 | One occurrence of lines 34 and 120; one `onChange`. |
| Blank typing/Enter reversal | Task 1 | `Alpha`, `Beta` remain two paragraphs in order. |
| Unsafe page deletion | Task 3 | Soft-only pages expose no page delete; hard section is removed atomically. |
| Incorrect Backspace boundary | Task 3 | Preceding logical character is deleted; forward/backward symmetry. |
| Validation catalog mismatch | Task 4 | Every displayed field validates; legacy custom definitions are recovered. |
| Stale DOM selection | Task 2 | Logical selection survives layout rerender and targets the same text. |
| Stale controls and markup bloat | Task 2 | Controlled values follow the cursor; repeat formatting is idempotent. |
| False layout status and unstable feedback | Task 5 | Effective margins shown; latest generation wins; busy state is accessible. |
| Oversized clipping | Task 6 | Warning and editable overflow appear; block occurs once. |
| Editor/print mismatch | Task 6 | Shared CSS and Chromium print-media marker/page assertions. |
| Flaky and missing route tests | Tasks 7–8 | Five repeated unit passes, three browser passes, save/reopen, and authenticated QA. |

## Plan Self-Review Checklist

- Every finding in the review table maps to an implementation task and a named regression test.
- Paste, Enter, delete, page, and formatting mutations all converge on `DocumentTransactionResult` and `commitUserTransaction`.
- No planned path serializes soft page boundaries or deletes a physical fragment directly.
- Selection types remain `FlowSelectionBookmark` from capture through reflow restoration.
- Formatting interfaces and controlled toolbar fields use the same property names in Tasks 2 and 8.
- The field catalog is defined once and consumed by both insertion and validation.
- Existing export imports remain compatible through a re-export of `buildA4PrintCss`.
- Oversized content is represented once and gains an explicit recovery path.
- Test steps include the exact commands, expected failures before implementation, and expected passing behavior afterward.
- No implementation step requires a new dependency, database migration, or rich-text framework.
