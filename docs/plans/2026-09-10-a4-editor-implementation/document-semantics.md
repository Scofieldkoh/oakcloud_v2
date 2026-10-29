# SEMANTICS agent plan: selections, page breaks, lists and pagination

Status: **not started**. Owner: S. Read [README](README.md), [contracts](contracts.md), review A4E-002–004, 006–012, 018–020, 028–029 and its H/J behavior/test sections.

## Context and objective

### 14 September 2026 — empty-line regression follow-up

Direct user-reported follow-up to A4E-009/010/011: Backspace after `{{/each}}` and Delete before `{{company.name}}` skipped empty paragraphs and deleted field braces. Repeated Enter in a blank document also collapsed the document back to one paragraph, invalidating the caret. Trailing `<br>` lines were absent from pagination split candidates, allowing signature text to split or move instead of its empty continuation.

The fix preserves existing empty blocks and runtime identities during canonical normalization; consumes adjacent paragraph/line boundaries before deleting text; retains an optional runtime line-break identity in `FlowPoint` across capture, semantic commands, insertion and restoration; and includes line breaks in measured pagination split positions. The PDF pagination bundle is regenerated from the same engine. Saved HTML syntax and public persistence contracts are unchanged; runtime IDs remain stripped on serialization.

Regression coverage: `__tests__/browser/a4-empty-lines.browser.test.tsx` covers both deletion directions, inline blank lines, undo, signature placement and 65 consecutive Enter presses followed immediately by typing. Model/selection unit tests cover blank-block identity preservation and restoration after a line moves to another physical page. Interactive Chromium validation uses synthetic content in the actual editor with controlled parent state; parent HTML equals the canonical snapshot after editing.

Validation on this follow-up: seven new native browser regressions pass. The affected model/selection/command/session/editor suites pass (284 tests). The broader browser run passes 73 of 74 tests; the existing mouse-drag replacement test expects `AlXta` but obtains `AlXa`, reproduced identically using the original committed modules. The export-layout suite passes six of seven tests; its existing initial static HTML page-count assertion also fails identically with the original modules and generated bundle. These two baseline failures are not suppressed or counted as fixed. TypeScript passes with an 8 GiB Node heap; lint has zero errors and 12 existing warnings. The full `npm run build` passes under Node 24. This follow-up does not certify Firefox/WebKit, real customer document save/reopen or production deployment.

The current pagination model correctly avoids persisting automatic page breaks, but text-only positions and physical-page break insertion lose semantic identity. A manual break inside Item14 produces two items with the same flow ID; Backspace on the new page resolves to the preceding text. List conversion also reverses prepended paragraphs, indentation changes margins instead of list level, and imported numbering is not normalized across CSS/output.

Make each command operate on a logical document and return a valid structural selection. Make automatic and manual page projection preserve list/paragraph identity. Supply stable APIs to CORE; do not patch the editor component to bypass the agreed interface.

## Scope and contracts

Own the S files listed in README: model, selection, actions, formatting, engine, measurement/layout/CSS/font contract and break helpers. `editor-session.ts` and input/history modules are CORE exceptions even if located in the pagination directory. W owns the generated pagination bundle and its build script.

Produce C02 positions/commands and C03 break representation; co-produce C04 projection mapping and C09 geometry. Consume C01 session/revision context and C06 sanitizer policy. Tests: existing `__tests__/components/a4-pagination/*`, break/print-style tests where assigned, and proposed `__tests__/browser/a4-boundary-semantics.browser.test.tsx`. Request a lease before editing a test also used by CORE/W.

Read existing `hydrateFlowContainer`, `reassemblePageFragments`, `normalizeEditedFlowIds`, `capture/restoreFlowSelection`, `applyLogicalDelete`, `insertParagraphAtSelection`, `insertHardPageAtSelection`, `applyListToSelection`, sink/lift, `applyListStartToSelection` and engine continuation/table logic. Existing passing nested-list/word-boundary/table regressions are invariants, not code to replace casually.

## S0 — Prove positions and nested break representation

Entry: this plan; runs beside C0/F0/W0. Do not enable production format writers.

- [ ] Add fixtures for old top-level hard breaks; a long single item across soft pages; nested mixed lists; the v2 inline marker from C03; tables/captions/footers; explicit blank paragraphs; `<br>`; adjacent fields.
- [ ] Reproduce after-`<br>` capture/restore returning before the break. Define `text` versus `children` positions and affinity with source-node identities; demonstrate reverse selection and empty-cell distinctions.
- [ ] Implement a bounded codec/projection proof that traverses the canonical tree and partitions at a nested hard-break marker while preserving ancestors. Keep the canonical OL/LI unsplit. Assign view-fragment maps to source positions rather than cloning new canonical items.
- [ ] Prove `read old → serialize compatible` and `read v2 → project → edit logical break → serialize v2`; automatic continuation attributes/counter offsets never appear in persisted content.
- [ ] Show CORE how a position on a later-page fragment maps to the same logical item without summing unrelated duplicate IDs. Show W how export consumes the canonical content and projection.
- [ ] Publish the exact schema/command interfaces and any limitations (especially table row/cell breaks) for G0. If the proposed inline marker cannot satisfy the invariants, provide a tested alternative before any dependent agent implements it.

**Exit G0:** a valid one-item manual-break fixture, unambiguous structural positions and agreed consumer adapters. Passing HTML-string shape alone is insufficient: inspect rendered marker/numbering and delete the break through the logical command.

## S1 — Structural positions, commands and versioned break readers

Entry: G0; develop alongside CORE C1 against the frozen interfaces.

### Ordered implementation

1. Expand runtime identity hydration to the semantic nodes required by positions, including cells, nested paragraphs, atomic references and explicit breaks. Keep internal IDs out of ordinary stored HTML. Distinguish runtime node identity from C05 durable field identity.
2. Implement position validation, comparison, source-range mapping and change maps. Replace text-offset-only assumptions through an adapter so old command callers remain supported while CORE migrates. Zero-text boundaries and before/after affinity must remain distinct.
3. Implement semantic break insertion/removal on the unsplit canonical tree. The v2 span lives inside a paragraph/list item; legacy top-level markers remain accepted. No duplicated canonical LI or measured numbering metadata is stored.
4. Replace string hard-section splitting for nested markers with a tree-aware partitioning visitor. It clones only **projection** ancestry, records source ranges/continuation state, and emits correct `hardBreakBefore`. It must not parse each half of an invalid HTML string as an independent document.
5. Update the pagination engine entry point to consume the new partition/position contract. Keep old `paginateFlowHtml` callers through a compatible adapter; W integrates server consumers and bundle generation.
6. Update deletion to remove a hard marker first at its boundary and otherwise delete the preceding/following grapheme or the appropriate structural boundary. Selection deletion trims only the selected range and preserves unselected ancestors/siblings.
7. Make Enter/line break return one canonical transaction for collapsed or forward/reverse selections. Do not branch on physical pages. Map caret into the next logical position and emit changed-node information for CORE.
8. Supply capability functions for insert/remove break, delete blank page, list level and table context. Do not infer destructive scope from visual page count.

### Required semantics

| Case | Contract |
| --- | --- |
| Break in middle of paragraph | One logical paragraph with an explicit internal break; split display only. Removing it retains surrounding text/marks. |
| Break in middle of numbered item | Same list/item and number on both sides; continuation has no repeated marker. Nested descendants remain attached in original order. |
| Independent old lists around a top-level break | Preserve as independent lists; do not invent a link or renumber them from heuristic adjacency. |
| Delete adjacent to a manual break | Remove exactly the break in one action. Later ordinary deletion follows normal paragraph/item rules. |
| Delete at a soft continuation | Operate on the underlying text/item; no “delete page” mutation exists. |
| Selected range crossing hard/soft pages | Remove only selected content, preserving unselected edges and valid list/table structure. |
| Unsupported break position inside a table cell | Leave content unchanged and return a contextual unsupported result unless a tested split-row implementation exists. Between-row support must preserve table/caption/footer semantics. |
| Invalid/stale position | Return a typed rejection/map result; never fall back to an arbitrary visual page end. |

### S1 acceptance

All C02/C03 round-trips pass; Unicode deletion does not split graphemes; after-`<br>` and empty-cell placement survives reflow. CORE can run break→Backspace and cross-page Enter with no physical DOM manipulation. W's reader fixture accepts both marker forms and exports the same list numbering. Keep new marker writing behind the rollout capability until W signs off every reader.

## S2 — Lists, Enter, indentation and formatting

Entry: S1; CORE C2 wires these operations. Pure fixes can land in focused commits before final UI integration.

- [ ] Fix paragraph→adjacent-list conversion by building inserted items in reading order and inserting a fragment once. Test previous/next/both adjacency, UL/OL and backward selections.
- [ ] Give list type conversion explicit range semantics: selected whole items convert together; split unselected surrounding list segments when necessary. Preserve attributes meaningful to the new type, paragraph indents and nested children; remove incompatible numbering attributes deliberately.
- [ ] Implement sink/lift for contiguous selected items, preserving sibling order. One Increase/Decrease indent intent maps to list level in lists and margin indent in ordinary paragraphs. Impossible first-item sink and outermost lift return capability state rather than malformed structure.
- [ ] Define nested-list Enter using canonical positions. Mid-item split partitions the before/after content in DOM order; descendants wholly after the split move with the new item's after content, without duplication. End-of-item Enter creates a sibling; empty nested-item Enter lifts one level, then an empty top-level item exits to body text.
- [ ] Preserve applicable paragraph alignment/indent/spacing when splitting; never copy identity or transient projection attributes. End-of-heading Enter becomes body paragraph; a mid-heading split preserves heading semantics on both pieces unless an existing documented policy requires otherwise.
- [ ] Preserve authored blank paragraphs even when there is no text. Only an absent document receives the single default caret paragraph. Keep blank hard sections recoverable.
- [ ] Normalize indent units explicitly. Do not let `/em$/` consume `rem`; use measured layout/font context for conversion. Outdent stops at zero; further indent must not move all text beyond usable width. Preserve unsupported legacy styles until an explicit normalization/import decision.
- [ ] Introduce semantic start/continue numbering. Normalize `ol[start]` into the same counter behavior as toolbar-created numbering. “Restart here” splits the sequence at the selected item; “Continue numbering” links to the eligible preceding list while preserving independent lists otherwise.
- [ ] Preserve alpha/bold marker styles and nested numbering through type changes where meaningful. Generate runtime `--flow-list-start` from semantic intent, never the reverse.
- [ ] Export uniform/mixed formatting state and a neutral typing-format patch for CORE's collapsed Clear operation. Keep selected bold-off preserving italic/color and marks outside the range.

**Acceptance:** all 30 original list labels remain in order through edits; user-visible item count changes only as intended; Tab and toolbar are equivalent; restart at a middle item affects the named segment; start5 displays as5 in editor and PDF. Run Enter/Delete/indent/break combinations on first, middle and last pages, with fields and mixed formatting. One undo reverses each action once CORE integrates.

**Suggested commits:** order regression/fix; structural Enter and empty content; semantic indent/level commands; numbering/import/CSS; mixed formatting/capability exports. Avoid mixing all list changes into a cosmetic CSS patch.

## S3 — Geometry, font readiness and performance

Entry: C2 + S2 + W1; coordinate output parity with W3. This is after correctness, not a prerequisite for fixing content loss.

- [ ] Consolidate the duplicate editor/shared measurer around one content/layout/font setup; retain browser/server sanitizer adapters from C06. Give CORE the replacement factory; CORE changes its own caller.
- [ ] Make font readiness explicit and versioned. Cold and warm font loads must converge to the same final projection; changed fonts invalidate measurement cache/projection.
- [ ] Preserve default A4 geometry and legacy layout version1. Add page-number space only through the agreed output contract; do not silently change all templates' margins to compensate for a print bug.
- [ ] Test heading keep-with-next and oversized rows/blocks. Improve only the defined policy: no clipping; clear oversized status/remedy; preserve table row/caption/footer structure. Do not implement sophisticated widow/orphan rules before core parity is proven.
- [ ] Measure canonical input-to-paint separately from pagination on representative 1/10/30-page documents. The review's ~18/~128ms samples are not a performance budget.
- [ ] Optimize changed-node measurements/pagination only with cache keys covering content, available width, layout and font revision. Compare every optimized result to full pagination in tests.
- [ ] Defer viewport virtualization unless a measured bottleneck justifies it and cross-page selection/accessibility remain correct. DOM measurement cannot simply move to a worker.
- [ ] Notify W of engine/CSS changes requiring bundle regeneration; never edit generated bundle content yourself.

**Acceptance:** content and numbering survive slow reflow; final editor/PDF breaks agree under cold fonts and configured margins; oversized content remains present; any incremental path produces equivalent content order and break intent to full pagination. Publish traces, test environment and actual improvement before claiming a performance win.

## Boundary with other agents and delivery

### 15 September correction: typing into signature continuation pages

The blank-overflow-only exception described below was insufficient: typing on the last continuation made that overflow substantive and reactivated the oversized-group warning. Superseding that exception, keep-together now moves a group whole only when it can fit on a full page. Larger editable groups use normal pagination, with continuation fragments free to flow; blocks that cannot be split still use the oversized fallback. The canonical grouping attribute remains intact. The focused Chromium regression now types on the final page and checks unchanged page count, retained text/caret, printable-height bounds, and absence of the warning. It passed along with three focused keep-together unit cases. The PDF pagination bundle was regenerated.

### 15 September follow-up: transient caret jump during Enter

Page content replacement runs in child layout effects, but pending selection restoration previously ran in a passive effect. That allowed a paint with the browser's temporary page-start caret before the logical caret was restored. Restoration now runs in the parent layout effect, after child HTML replacement and before paint, and skips redundant focus calls when the editor is already focused. One focused Chromium regression passed: repeated Enter on a later soft page retains the expected paragraphs and mutation observers see no page-root or outside-page selection fallback. No broad suite was run.

### 15 September follow-up: Backspace leaves an orphan list number

Collapsed backward deletion now handles the beginning of a list item before ordinary character deletion. It joins a subsequent item into its preceding sibling, removes the consumed LI, and restores the caret at the join. At the first item it removes the list level while preserving content and remaining items. This covers direct LI text as well as paragraph-wrapped list content and makes empty numbered items removable. Three focused Chromium cases passed: empty-item deletion followed by typing for both markup forms, and first-item removal followed by undo. No broad test suite was run.

### 15 September follow-up: oversized signature with trailing blank lines

Keep-together signature wrappers previously forced all trailing blank lines onto one oversized, internally scrolling page. The paginator now permits a split when the overflow contains only blank space (and no image, table, rule, or noneditable content). The signature text remains together; blank continuation fragments can paginate normally. Canonical content is unchanged. Genuinely oversized substantive groups retain the existing warning. The export pagination bundle was regenerated. Focused validation passed: one Chromium case with a signature and 100 trailing blank paragraphs checks multiple pages, printable-height bounds, no oversized warning, and paragraph preservation; three existing keep-together unit cases also passed.

### 15 September follow-up: list text below its marker

Inline insertion into an empty block could resolve the caret after its sole editable-placeholder `<br>`, leaving that break before newly typed text. In an empty list item this placed the text one line below the marker. `insertReplacementNodes` now consumes a sole direct placeholder break when inserting text into an editable block. Multiple breaks remain intact as intentional blank lines; list spacing and marker CSS are unchanged. Three focused document-action regression cases passed under Node 24 (numbered list, bulleted list, and preservation of intentional blank lines). No broader suite or browser verification was run for this follow-up, keeping validation limited as requested. This prevents newly introduced placeholder breaks; it does not rewrite existing document line breaks.

### 15 September follow-up: later-page flicker during controlled typing

The value synchronization effect reparsed the canonical document into hard-break-only pages on every parent `onChange` echo, temporarily removing soft pages before asynchronous measurement restored them. This could consume the pending selection against the temporary first-page view. Synchronization now replaces rendered pages only when activating a session or accepting a different external document. Controlled echoes retain the measured projection; the edit transaction still schedules reflow, and layout changes retain their separate reflow effect. One focused Node 24 Chromium regression passed: a controlled editor spanning soft pages retains the later page DOM and caret through successive native keystrokes, with no page removal observed and all typed text preserved. No broad suite was run for this follow-up.

CORE applies all command/key/toolbar/editor wiring. F owns shared policy and token parsing; S only needs atomic-node descriptors/source positions. W applies persistence/output readers and regenerates bundle. Request contract changes through I; do not add an independent resolver, sanitizer list or page-break parser in another layer.

Return command signatures, legacy adapter removals/deprecations, behavior tables, codec examples, new-format feature detection, test commands/results and generated-bundle requirements. Mark v2 writer enablement as blocked until W's reader gate passes even if S unit tests are green.

## Dispatch prompt

> Implement packet **S0** using this plan and contracts v1. Prove structural positions and the proposed nested manual-break marker with executable legacy/nested-list fixtures. Preserve one logical item through break→projection→delete and show the mapping to CORE and W. Stay within S-owned files, do not enable new-format writes, and return a contract/compatibility handoff for G0 before implementing S1.
