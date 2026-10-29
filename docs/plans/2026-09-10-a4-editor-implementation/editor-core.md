# CORE agent plan: document authority, input, history and editor controls

Status: **not started**. Owner: integrator/CORE. Read [README](README.md), [contracts](contracts.md), root `AGENTS.md`, and review tickets A4E-001–005, 011–012, 020–021, 023, 025–026, 029 before implementation.

## Context and objective

The actual editor is `src/components/documents/a4-page-editor.tsx`, a custom contenteditable surface. `parsePages` returns hard sections, while rendered state contains soft page fragments. `commitUserTransaction` replaces `pagesRef` immediately and defers DOM projection; native `commitDocumentSurface` then matches stale page elements against the new ref. A three-page single section can be overwritten with its first fragment. This is the primary data-loss defect.

Own the transition to one canonical, revisioned editor session. Make the next keystroke correct before worrying about where the next rendered page lands. Keep public callers working while W adopts the new snapshot/identity contract. Do not edit W-owned route or batch files directly.

## Inputs, outputs and owned files

**Read first:** `a4-page-editor.tsx` (`parsePages`, `scheduleReflow`, `commitDocumentSurface`, `commitUserTransaction`, `handleBeforeInput`, `handleKeyDown`, `splitActivePageAtSelection`, `handleUndo/Redo`, `handlePrint`); `a4-editor-toolbar.tsx`; `a4-pagination/{model,selection,document-actions,formatting}.ts`; existing A4 component/browser tests; the route integrations listed in review B.

**Own:** editor component, toolbar, proposed session/native-input/history modules and public session types, as assigned in README. Own existing core component tests and the leased main browser test. Add sequence tests under `__tests__/browser/a4-input-sequences.browser.test.tsx`; do not require S or Q to edit this same file concurrently.

**Consume:** S's C02 positions/transactions and C03/C04 projection mapping; F's C05 token descriptors/lifecycle operations and C06 policy; W's C09 print assembly. **Export:** C01 session/snapshot API, input dispatcher, history/capability state, field-decoration hooks, and editor diagnostics/idle signal. Publish a short usage example for W and F with each interface-producing commit.

## C0 — Contract and input-routing proof

Entry: plan only; runs beside S0/F0/W0. No new format writer enabled.

- [ ] Read the baseline code and run the smallest existing input/browser tests under Node24. Record actual results separately from the review's 307/52 baseline.
- [ ] Add the exact three-page list fixture and rapid Enter→typing regression. Initial readiness may be awaited; no wait between user actions. Assert final canonical HTML, all 30 original item labels, inserted text, parent save snapshot and item count31.
- [ ] Add cross-session A→B→Undo and selection-spanning-pages Enter regressions. Record the failing behavior before fixing.
- [ ] Inventory all mutation entry points: keyboard, beforeinput/input, composition, paste/cut/drop, toolbar/table resize, `setContent`, external value, field/AI insertion, layout and print. Assign each to command, native reconciliation, replace-document or non-mutating view operation.
- [ ] Agree C01/C02/C04 with S using a minimal executable fixture: command result publishes canonical revision immediately, while an intentionally delayed projection cannot overwrite it.
- [ ] Choose the native-input bridge described below and prove it for Enter→typing, rapid Delete, pointer movement on an old projection and composition. Publish actual module/type names before G0 closes.

**C0 output:** interface/types proposal, failing regressions, event routing table and a no-data-loss bridge proof. Interface agreement is a technical gate owned by I, not a request for user approval on routine implementation details.

## C1 — Canonical session, native input and per-document history

Entry: G0. May develop against S's frozen interfaces while S1 implementation proceeds. Do not duplicate S's position algorithms locally.

### Implementation approach

1. Extract session authority from page state. Hold canonical document with internal IDs, local revision, selection, typing marks, metadata and history. `PageData[]` remains a projection. `getContent/getSnapshot` serialize this authority, never the page list.
2. Implement one dispatch function that accepts session/base revision, intent and selection; calls S/F command adapters; commits a complete successful result once; emits one snapshot notification; schedules one latest projection. Unchanged/rejected commands do not push history or create dirty state.
3. For cancelable typing/editing intents, dispatch from `beforeinput`. If a keyboard structural command just committed and the DOM is behind, use the current canonical pending caret for the following uninterrupted keyboard sequence. A pointer/explicit selection change on the old view instead captures the old projection position and maps it through retained changes. Do not substitute whichever caret is easiest to resolve.
4. Prefer a canonical input path for plain text, paragraph/line breaks, deletions and paste so the browser cannot mutate a stale projection first. Keep the editable projection responsive. A small synchronous affected-range projection update is permissible if needed for browser caret behavior; it must be derived from the committed document and must not re-measure the entire document per character.
5. For non-cancelable/composition input, retain a base revision and affected logical range, allow the active composition DOM to operate, then reconcile its range delta. Defer incompatible structural commands until composition ends; retain the user's request or give an explicit recoverable result. Do not repeatedly replace the composing node, apply composition data twice or reconstruct unrelated pages.
6. Remove whole-surface persistence writes based on matching current ref IDs to old page IDs. Keep DOM reassembly only as a revision-qualified import/reconciliation helper where needed, with a test proving untouched canonical nodes are preserved.
7. Tag reflow by session/content/layout/font revisions. Only publish a matching result. Preserve selection/scroll as view effects after successful mapping, and announce recovery only if mapping cannot be made safely.
8. Implement per-session history. Group uninterrupted text edits with a bounded typing policy; separate structural/paste/field/layout actions. Undo/redo restores the complete snapshot and caret. Controlled value echoes acknowledge existing state without a second history entry.
9. Retain source-compatible legacy refs/props through adapters. Define explicit external-load, draft-restore and replace-document behavior instead of treating every `value` change alike. A session-key switch resets or retrieves only that session's history after W flushes its outgoing snapshot.

### C1 acceptance

- Rapid Enter→typing and repeated delete/format→typing preserve all untouched content under delayed reflow, including page2 onward. Parent snapshot equals canonical state before rendering finishes.
- A→B→Undo never injects A into B; the chosen A history-retention policy is documented and tested.
- One native input intent is committed once; cancelable and non-cancelable paths cannot both commit it. No duplicate paste or composition characters.
- Save can obtain the latest complete snapshot without waiting for pagination; active composition returns a typed wait/recovery result.
- Existing SSR, selected formatting, scroll and pagination tests remain passing. An initial server render does not read browser-only DOM APIs.

**Suggested commits:** failing sequence tests; session/snapshot compatibility adapter; native-input bridge and canonical authority; per-session history; reflow publication guards. Each production commit includes its regression, not an enormous extraction-only diff.

## C2 — Wire semantic editing and remove physical mutation paths

Entry: C1 + integrated S1. S2 may improve commands in parallel, but CORE is the only writer of the toolbar/editor file.

- [ ] Route Enter/Shift+Enter over one-page and cross-page selections through the same command dispatch. Remove the early cross-page branch that swallows `insertParagraph/insertLineBreak`.
- [ ] Replace `splitActivePageAtSelection` with S's canonical break command. Remove its page-end fallback and cloned-fragment persistence path.
- [ ] Route Backspace/Delete to semantic positions; distinguish manual break removal from soft continuation text deletion. Preserve native navigation and IME rules in C04.
- [ ] Wire Tab/Shift+Tab only in applicable list/table contexts; toolbar indent calls the same S operation. Do not trap focus globally.
- [ ] Replace the everyday destructive page action with remove-break/delete-empty-page behavior. If deliberate section deletion remains, label and preview its true multi-page scope and make it one undoable action.
- [ ] Consume S's mixed-format/capability state. Fix collapsed Clear by committing neutral typing marks rather than merely clearing visual state.
- [ ] Add C05 view-decoration and complete-snapshot transaction hooks for F; do not implement a second field parser. Keep raw syntax serialization until the field writer rollout is enabled.
- [ ] Move paste through F's import policy plus S's canonical insertion. Keep one undo transaction and a recoverable unsupported-content result.
- [ ] Export the integration example to W: stable `sessionKey`, current snapshot on save/switch, metadata/fields initialization and acknowledgement. W applies all route/batch edits.

### C2 acceptance and gate evidence

Pass every row in review H's cross-page behavior table, with native keyboard and pointer selection tests. For the manual break fixture, there is still one logical Item14, its number stays consistent, and Backspace removes the marker without deleting preceding text. For a cross-page selection, Enter performs replacement and a break inserts at the logical selection, not after Item26.

After W integrates the route adapter, verify template save/reopen and a two-item batch switch. A component-only fix does not close A4E-005/021. Q1 verifies the integrated commit before the D1 deployment gate.

## C3 — Controls, accessible editing and local print

Entry: C2 + S2. Basic toolbar/accessibility work can begin while F3/W3 finish; final field/print wiring consumes their stable exports.

- [ ] Group primary writing controls: Undo/Redo, paragraph style, common marks, alignment, lists/indent. Put rare numbering/font details in labeled menus and table actions in context.
- [ ] Remove duplicate page-action entry points with different semantics. Keep one obvious Page break and Insert field action; preserve sensible keyboard equivalents.
- [ ] Give the editor an accessible name and multiline semantics, navigation arrows labels, and grouped toolbar keyboard behavior. Preserve visible focus and selection through menus/color inputs.
- [ ] Test mouseDown/click handling: one action for pointer, keyboard and assistive activation; canceled or secondary-button clicks must not execute an unintended command. Correct the blank-page test only after distinguishing harness issues from real behavior.
- [ ] Separate command applicability from reflow busy state. Do not continuously announce repagination. Surface save/error state from W's actual revision state rather than a local timer.
- [ ] Consume W's shared print preparation. Remove broad CSS-substring element deletion; wait for readiness and clean up after print completion/cancel.
- [ ] Honor persisted page-number setting only after W/S output readers support it. Do not expose a control that only changes the screen while implying a document change.

**Acceptance:** common controls fit supported laptop layouts without horizontal hunting; keyboard-only staff can insert/format/delete/recover and return to writing; no selection loss; local print and PDF preserve the same content. Test real screen reader and supported IME/browser combinations through Q2.

## Tests and handoff

Use existing core component/toolbar/SSR/print tests, the main browser file and new sequence/session tests. New tests assert text/order, selection, item/break count and saved snapshots, not just page count. Run targeted lint/typecheck as appropriate; I runs integrated checks after all providers are merged. Report actual commands and known failures.

Return exported APIs with examples, deprecated mutation paths removed, all remaining fallback paths and their revision guards, test results, and what W/F must wire next. If C1 cannot safely reconcile an input type, list the exact type/browser and keep that release gate open; do not conceal it behind a catch or blanket `preventDefault`.

## Dispatch prompt

> Implement packet **C0** first using this plan, README ownership and contracts v1. Reproduce the rapid cross-page input and document-switch history defects. Agree the canonical snapshot/native-event/selection bridge with S0, publish executable interfaces and tests, and stop at G0 with a handoff. Do not enable v2 writers, alter W-owned routes or implement later packets until dispatched. Keep existing APIs compatible and preserve all unrelated changes.
