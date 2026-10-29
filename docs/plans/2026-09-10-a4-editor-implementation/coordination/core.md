# CORE handoff log

## CORE-C1-G1-CORRECTION-20260912-01

Dispatch ID: `CORE-C1-G1-CORRECTION-20260912-01`
Role and packet: CORE / C1 corrective owner — integrated G1 canonical integrity blockers only
Starting state: **G1 BLOCKED — CORRECTION REQUIRED**
Ending state: **READY FOR INTEGRATION — G1 remains blocked pending separate SEMANTICS correction integration and integrated G1 rerun**
Frozen contract consumed: **v1 frozen at G0 — unchanged**
Integrated baseline: `603f3a25d168435b56709ef9c2c2e8cdda9af737`
Branch: `codex/a4-editor-core-c1-g1-correction`
Corrective PR: **#41** — `C1 G1 corrective: restore projection and native selection integrity`
Validated production-source commit: `7dff3958f0c70a54378fa3eea2c17f72ede6e60a`
Validation workflow run: `34634080485` — **SUCCESS**
Validation environment: Node `24.20.0`; Playwright Chromium `149.0.7827.55`
Validation completed: `2026-09-11T18:40:05Z` source commit; handoff recorded `2026-09-12T07:19:00+08:00`

### Corrective scope and decisions

- C1 remains the sole canonical session/revision authority. No second canonical document, revision counter, or rendered-page authority was introduced.
- Ordinary canonical edits no longer replace the mounted `PageData[]` projection before revision-qualified reflow publishes. The most recent committed projection remains mounted while a newer canonical revision is being paginated.
- A collapsed native text transaction is repaired only when the S1 transaction returns changed canonical content but a collapsed logical caret that did not advance. The repair is derived from the canonical transaction result and available logical-flow text; SEMANTICS command ownership is unchanged.
- A cancelable canonical `beforeinput` transaction records a revision-bound pairing so the matching post-input event is consumed exactly once rather than being mistaken for a second DOM mutation.
- For an unpaired same-revision native `input` repair, C1 first bookmarks the valid logical selection and then repairs the rendered surface from canonical state; stale rendered DOM never replaces canonical content.
- Native cross-page mouse selection keeps the browser's valid anchor. A collapsed cross-page drag may be reconstructed from localized pointer endpoints only when both endpoints resolve to different rendered page contents. Focus refinement advances by one adjacent glyph only when pointer geometry proves that glyph was reached.
- Parsed pages may publish immediately only when a canonical replacement changes **hard-section topology**. Ordinary soft pagination remains asynchronous and revision-qualified.
- No SEMANTICS-owned algorithm, FIELDS/WORKFLOW production behavior, database schema, deployment setting, version, or frozen contract was changed.

### Validation evidence

The final corrective workflow ran from the integrated Stage-1 baseline with the temporary transform applied in CI and committed production source only after every gate passed.

```text
npx vitest run --config vitest.browser.config.ts \
  __tests__/browser/a4-input-sequences.browser.test.tsx \
  __tests__/browser/a4-boundary-semantics.browser.test.tsx \
  __tests__/browser/a4-page-editor.browser.test.tsx \
  --reporter=verbose
PASS — 3 files, 58/58 tests

npx vitest run \
  __tests__/components/a4-editor-session.test.ts \
  __tests__/components/a4-page-editor.test.tsx \
  __tests__/components/a4-editor-toolbar.test.tsx \
  __tests__/components/a4-page-editor-ssr.test.tsx \
  --reporter=verbose
PASS — 4 files, 94/94 tests

npm run db:generate
PASS

npm run typecheck
PASS

npx tsc -b
PASS

npm run build
PASS

git diff --check
PASS
```

The browser proof covers the blocked CORE regressions together with rapid Enter -> typing, document-order typing, native cross-page selection and replacement, hard-page behavior, caret preservation, committed-projection retention, and per-document history isolation.

### Net files and cleanup

- Production correction: `src/components/documents/a4-page-editor.tsx`.
- Coordination evidence: this `coordination/core.md` handoff entry.
- Temporary validation workflows/scripts and accidental placeholder files were removed before handoff and have **no net PR file diff**.
- The branch intentionally remains unmerged. `main` was rechecked at the integrated baseline `603f3a25d168435b56709ef9c2c2e8cdda9af737` before PR handoff.

### Integration disposition

PR #41 is **READY FOR CORE INTEGRATION REVIEW** but must remain unmerged until the user gives the merge call. This correction alone does **not** declare G1 passed: integrate the separately owned SEMANTICS G1 correction first (or together in the integrator's controlled order), then rerun the canonical G1 gate against the resulting immutable integrated commit. Do not begin C2, S2, F2, W2, deployment, or any Stage-2 work from this handoff.

## CORE-C1-20260911-01

Dispatch ID: `CORE-C1-20260911-01`
Role and packet: CORE / C1 — canonical session, native input and per-document history
Starting state: DISPATCHED
Ending state: **READY FOR INTEGRATION**
Baseline commit: `bfdc4f95594b73ce4d20bff45f320bdb53837c37`
Branch: `codex/a4-editor-core-c1`
Contract consumed: **v1 frozen at G0**
Validated production commit: `c66daf8d2f5feff2fa829abfa792518aa56801a3`
Validation workflow: `A4 C1 review fix validation` run `34587301343` — SUCCESS
Validation completed: `2026-09-11T10:06:28Z`

### C1 implementation and legacy resolution

- The canonical revisioned editor session is the authority for editor content, selection, history, layout metadata and revision-qualified projections. `PageData[]` remains a render/pagination projection.
- Cancelable text, paragraph, line-break, delete, paste and related editor mutations enter through canonical transactions; uninterrupted keyboard input can continue from the pending canonical selection while an older projection is still rendered.
- Stale whole-surface/page DOM can no longer silently replace canonical content. Stale Backspace/Delete boundary paths now fail closed and rebuild the projection from the canonical session.
- Async reflow publication is qualified by the active session plus document/layout/font revisions, so work started for Document A cannot publish into Document B.
- Per-document history remains isolated by `sessionKey`. Undo/redo restores complete editor state, including C1-owned layout metadata, while layout no-ops do not create history entries.
- Controlled external `value` loads and imperative `setContent` replacements are explicit external state transitions and no longer echo through legacy `onChange` as user mutations. Complete C1 snapshots remain available through the snapshot callback.
- Non-cancelable and IME paths retain bounded repair/composition state. Out-of-flow native mutations are repair-only and are discarded in favor of canonical state; active composition does not persist intermediate DOM and reconciles exactly once at `compositionend`.
- The old C0 expected-failure browser proofs were promoted to required passing regressions. Legacy component tests that directly mutated `innerHTML`/styles and then treated native `input` as a persistence API were replaced with canonical `beforeinput`, toolbar-command or explicit stale-projection repair assertions.
- Reversed selections are asserted by logical direction/endpoints across formatted nodes rather than unstable post-format DOM text-node identity.
- Temporary review-fix workflows/scripts were removed by the validated production commit; no temporary validation helper remains in the C1 code diff.

### Validation evidence

Executed in GitHub Actions with Node `24.20.0` and a provisioned Playwright Chromium runtime:

```text
npx vitest run __tests__/components/a4-editor-session.test.ts
PASS — 14/14

npx vitest run __tests__/components/a4-page-editor.test.tsx
PASS — 59/59

npx vitest run __tests__/components/a4-editor-toolbar.test.tsx
PASS — 17/17

npx vitest run __tests__/components/a4-page-editor-ssr.test.tsx
PASS — 4/4

npx vitest run --config vitest.browser.config.ts __tests__/browser/a4-input-sequences.browser.test.tsx
PASS — 3/3 browser sequences

npm run typecheck
PASS

static stale-authority review
PASS
```

The browser run executes the previously expected-failure cases as normal tests: rapid Enter followed immediately by typing without a reflow wait, cross-page Enter over a selection, and Document A -> Document B -> Undo isolation.

### Compatibility and ownership

- Existing public editor refs/props remain compatible; `sessionKey` is an additive identity input with a backward-compatible default.
- No C2 structural-command integration, S1/F1/W1 production implementation, schema migration, deployment or version bump is included in C1.
- SEMANTICS S1, FIELDS F1 and WORKFLOW W1 remain independent Stage-1 producers under their published ownership leases.
- C1 stops here at **READY FOR INTEGRATION**. CORE must not begin C2 until the user resumes it and the required S1 producer evidence is integrated.

## CORE-C0-20260911-01

Dispatch ID: CORE-C0-20260911-01
Role and packet: CORE / C0 — contract and input-routing proof
Starting state: RUNNING
Ending state: READY FOR INTEGRATION
Baseline commit: `63aa75b6170766a3e3d1728feb5e5417f5632f20`
Branch: `codex/a4-editor-core-c0`
Contract consumed: proposed v1; G0 remains open

### Workspace and environment evidence

- GitHub `main` was rechecked before branch creation and pointed to `63aa75b6170766a3e3d1728feb5e5417f5632f20`.
- The CORE branch was created directly from that commit. No reset, stash, force update, deployment or merge was performed.
- Root `AGENTS.md` applies; no nearer `AGENTS.md` was found under the CORE source or browser-test directories.
- The GitHub connector exposes the remote repository, not the user's local shared checkout, so local uncommitted/untracked changes in `C:\Users\Scofieldkoh\Documents\oakcloud` cannot be inventoried from this execution environment. The branch therefore preserves remote `main` exactly but does not claim knowledge of local-only edits.
- A container clone was attempted only to obtain an executable Node 24 checkout, but the container could not resolve `github.com`; therefore Node-version verification and test execution are BLOCKED in this environment. No test is reported as passed here.

### Files changed by C0

- `src/components/documents/a4-pagination/editor-session.ts` — bounded executable C01/C04 revision/native-input bridge proof; not wired to production editor behavior.
- `__tests__/components/a4-editor-session.test.ts` — proof cases for stale-DOM rejection, pending canonical keyboard selection, stale-pointer rejection, projection publication, composition and rapid delete revisions.
- `__tests__/browser/a4-input-sequences.browser.test.tsx` — expected-failure baseline regressions for rapid Enter→typing, cross-page Enter and cross-document Undo contamination.
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/dispatch.md` — Wave 0 assignments, leases and resource reservations.
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/{semantics,fields,workflow,verify}.md` — single-writer handoff stubs only; CORE did not start those instances.
- This file — C0 evidence and handoff.

### C0 native sequence regression inventory

The new browser regression file uses the review's 30-item long ordered-list fixture and locates the first paragraph of visual page 2 dynamically. The critical sequence sends `{Enter}NEW` as one native keyboard sequence with no layout/reflow wait between Enter and the first typed character. It asserts all original Item 1–30 labels remain, `NEW` is present, the logical list contains 31 items and the controlled parent value equals `getContent()` after settling.

The same file captures two additional baseline defects requested by C0:

1. Enter over a selection spanning visual pages must change the canonical document, collapse the resulting selection and retain later content.
2. After editing Document A and loading Document B in the same editor instance, Undo must never restore A content into B.

These are deliberately marked as expected-failure regressions while C0 records the broken baseline; C1/C2 must convert them into ordinary passing regressions when the production fix is integrated. They were not executed in this environment, so their current runtime result is not restated as fresh evidence.

### Mutation entry-point routing inventory

| Entry point | Current active behavior | C01/C04 target class | C0 decision / owner boundary |
| --- | --- | --- | --- |
| `beforeinput: insertParagraph` | Captures flow bookmark and calls `insertParagraphAtSelection` | canonical command | CORE dispatches; S owns structural command/position semantics. |
| Cross-page `beforeinput` | Prevents default; delete/text replacement handled, paragraph/line-break falls through to no-op | canonical command | C2 removes physical-page branch after S1. C0 regression records defect. |
| Plain cancelable text input | Usually browser DOM mutation followed by `input`/`commitDocumentSurface` | canonical native-input intent | C1 migrates supported input to revisioned canonical path. |
| Non-cancelable input | Snapshot/repair bookkeeping then DOM reconciliation | bounded native reconciliation | C1 must associate base rendered revision/range; never whole-surface stale replacement. |
| IME composition | Composition-end repair path | bounded composition session | C0 bridge proves one commit and snapshot blocking; real browser/IME remains a later gate. |
| Backspace/Delete at structural boundaries | Keydown/cross-page handlers call logical delete in several branches | canonical command | CORE dispatch + S command/position semantics. |
| Ordinary native Backspace/Delete | Browser DOM then `input` surface commit | canonical native-input intent | C1 revision bridge; rapid-delete proof added. |
| Paste | Prevented; sanitized HTML sent through logical replacement | canonical command/import | CORE dispatch; F owns import/content policy in later packet. |
| Cut/drop and other native mutations | No complete dedicated canonical path located; can reach DOM input commit | native reconciliation until canonicalized | C1 inventory gap remains explicit; do not invent S/F behavior in C0. |
| Inline/block/list/table toolbar commands | Logical formatting/document transactions | canonical command | CORE dispatch; S owns command semantics. |
| Table column resize | Mutates linked rendered tables then `commitDocumentSurface` | bounded native reconciliation or explicit table transaction | C1 must revision-qualify; S owns structural table semantics if extracted. |
| `setContent` | Parses/replaces page state explicitly | replace-document intent | C1 defines history/session policy; must not masquerade as user input. |
| Controlled external `value` | Rehydrates and schedules reflow unless treated as internal echo | controlled echo or replace-document intent | C1 distinguishes acknowledgement/echo from genuine external replacement. |
| Field / HTML insertion through ref | `replaceLogicalSelection` + `commitUserTransaction` | canonical command | CORE owns dispatch; F supplies lifecycle/token transactions later. |
| Layout changes | Updates controlled/internal layout independently of content history | output-affecting metadata transaction | C1 snapshot/history must carry layout revision; W later persists it. |
| Reflow/pagination | Derives pages and publishes React state | non-mutating projection | Must never increment canonical history/revision; publication must match current revisions. |
| Print/preview display | Reads rendered/canonical output paths | non-mutating view/output | C3/W own later shared print/output integration. |

### C01/C04 executable interface proposal

C0 publishes `src/components/documents/a4-pagination/editor-session.ts` as the proposed CORE-owned implementation location, matching contracts v1. Its proof deliberately remains generic over the selection type until SEMANTICS S0 returns the final C02 structural position adapter.

The proof establishes these invariants:

- A canonical command increments local revision immediately; pagination may still be rendering the older revision.
- A DOM commit tagged with an older rendered revision is rejected and cannot replace newer canonical content.
- An uninterrupted keyboard event arriving before the new projection is published may use the latest canonical pending selection.
- An explicit pointer move on an older projection is not silently redirected to that pending keyboard caret; it is rejected pending S0's retained position/change-map solution.
- A projection publishes only when its revision equals the current canonical revision.
- Composition is a bounded session: complete snapshots are unavailable while active, intermediate native DOM writes are not committed independently, and composition completion produces one canonical revision.

This is a **bounded design/executable proof, not a production fix**. `A4PageEditor` is intentionally unchanged during C0; no new writer or behavior is enabled.

### Interface proposals for other Wave 0 owners

**SEMANTICS S0:** bind C02's final `A4Selection`/position representation to the generic bridge selection parameter. Return enough source-revision mapping/change-map evidence for an explicit pointer selection made on a stale projection to map safely or reject without arbitrary fallback. The current text-only `FlowSelectionBookmark` is only a compatibility adapter.

**FIELDS F0:** no C0 field parser or lifecycle behavior is implemented. C01 snapshot generics reserve a lossless fields payload; F0 should publish the actual stored field definition type and C06 policy before CORE wires field history/decorations.

**WORKFLOW W0:** consume the proposed synchronous snapshot semantics only as an interface inventory. Do not require the proof module from routes yet. W0 should return stable session-key sources and writer/save consumers that will later call the production C01 snapshot adapter.

### Validation evidence

Commands actually attempted in this execution environment:

```text
git clone --depth 1 https://github.com/Scofieldkoh/oakcloud.git /tmp/oakcloud-c0
```

Result: BLOCKED — `Could not resolve host: github.com` inside the container. Because an executable checkout could not be obtained, Node 24, Vitest browser/component tests, lint, typecheck and build were not run. The remote GitHub connector was used for source inspection, focused branch writes and diff review only.

Required next validation when CORE is resumed in the real shared checkout or an executable CI environment:

```text
node --version                              # must be >=24 <25
npx vitest run __tests__/components/a4-editor-session.test.ts
npx vitest run --config vitest.browser.config.ts __tests__/browser/a4-input-sequences.browser.test.tsx
```

The browser file is baseline evidence and uses expected-failure cases intentionally; do not count those expected failures as repaired. C1/C2 must remove the expected-failure markers only when the production implementation makes the assertions pass.

### Compatibility and rollout

- Existing editor APIs and production mutation paths are unchanged.
- No v2 hard-break writer is enabled.
- No schema/migration, sanitizer/escaping, revision enforcement or deployment change is included.
- The proof module is additive and has no runtime consumer yet.
- G0 remains **OPEN** pending S0/F0/W0 handoffs, executable validation and CORE integration review.

### Remaining dependencies and next action

Start/resume only the three released Wave 0 worker packets:

- SEMANTICS — `SEMANTICS-S0-20260911-01`
- FIELDS — `FIELDS-F0-20260911-01`
- WORKFLOW — `WORKFLOW-W0-20260911-01`

CORE should remain idle after this C0 handoff until their files contain READY FOR INTEGRATION/BLOCKED evidence and the user resumes CORE. VERIFY must remain idle; no Q1/Q2 assignment exists. Do not advance any worker to S1/F1/W1 or freeze G0 yet.

## 2026-09-12 — C2 handoff — CORE-C2-20260912-01

Status: **READY FOR INTEGRATION — C2 ONLY**

### Scope and frozen baseline

- Packet: `CORE-C2-20260912-01`
- Branch: `codex/a4-editor-core-c2-20260912`
- Actual branch start: `6f1ab8d3cb90056c556771936f4c763d9596efdf` (current merged main with final G1 coordination records and Wave-2 dispatch).
- Programme-recorded G1-validated Stage-2 source baseline: `ad7285ace280f0b4002f119f923a8e2166b9475f` (reference only; branch was **not** reset to it).
- Frozen contract consumed: **v1 frozen at G0 — unchanged**.
- G1 state consumed: **G1 FROZEN/PASSED**.
- Validated C2 production/test code commit before this handoff-only coordination commit: `e825d900b3fdc19e9fa9f0ae69c0fe8d878ebbd7`.
- No application version bump, deployment work, C3 work, or merge to `main` was performed.

### C2 implementation completed

1. `A4PageEditor` now routes canonical native structural editing through the C1 session authority and SEMANTICS-owned transactions instead of persisting physical-page DOM fragments.
   - cross-page Backspace/Delete and selected deletion use S1 `deleteA4Selection`;
   - Shift+Enter uses S1 `insertA4LineBreak`;
   - manual page break insertion uses S1 `insertA4ManualPageBreak` and canonical semantic break markers;
   - hard-page-start Backspace maps the rendered page-start position to the semantic boundary and supplies explicit S1 affinity;
   - cut uses the same canonical semantic deletion route;
   - no new revision/session/history authority was introduced.
2. The old `splitActivePageAtSelection` physical fragment writer was removed. Manual breaks are canonical semantic transactions; projection derives physical pages afterward.
3. Reflow now consumes `paginateA4FlowHtml` and the S1 revision-qualified `A4ProjectionPositionMap`. CORE verifies the map session/document revision against the C1 projection revision before publication. C1 remains the only authority that decides whether a projection can publish.
4. Latest canonical state remains authoritative while pagination/reflow is behind; stale rendered selections continue through C1 `resolveNativeInputTarget` rejection/mapping rules rather than replacing canonical content.
5. F1 is consumed instead of duplicated:
   - editor sanitization uses `getA4SanitizerPolicy()` plus the approved editor decoration attributes;
   - optional stable `fieldScope` and `onFieldAnalysis` hooks expose F1 `parseTemplateFields` output from canonical C1 snapshots;
   - CORE does not create field grammar, identity, resolution, escaping, or field mutation semantics.
6. Collapsed Clear Formatting now records neutral pending typing marks so the next typed run is actually cleared rather than merely changing toolbar state.
7. Focused C2 browser coverage was added for semantic page-break insertion/removal inside a later-page list item and for a native cross-page selection replaced by one semantic line break.
8. The obsolete component expectation that the page-break toolbar must synchronously create a second physical page was replaced by a canonical semantic-break assertion. Physical pagination is projection only.

### Deliberate compatibility boundary retained pending S2

S1 does not yet provide the complete list-item Enter/exit semantics required by the frozen G1 browser contract. Directly routing Enter through the current S1 paragraph primitive regressed list-item split/exit and caret-follow cases during C2 validation. CORE therefore centralizes a temporary compatibility path in `a4-editor-semantic-bridge.ts` that calls the existing **SEMANTICS-owned canonical** `insertParagraphAtSelection` transaction for Enter only. CORE does not duplicate that implementation. Delete, Shift+Enter, manual breaks, position mapping and projection mapping use the S1 contracts directly.

Exact S2 integration request: provide the finalized structural paragraph/list Enter/exit command (including ordered/unordered list continuity, empty-item exit and selection/caret result) so CORE can replace this compatibility call without changing C1 authority or G1 behavior.

### Additional owner integration requests

- **SEMANTICS / S2:** provide one canonical indent/outdent capability for Tab/Shift+Tab and toolbar equivalence, constrained to valid list/table contexts. CORE must not invent list/table structural rules. Also provide a semantic table-column-resize transaction when that behavior is assigned; the existing table resize remains bounded native reconciliation through C1 and is not a page-state writer.
- **FIELDS / F2:** provide the canonical field insertion/edit/import lifecycle transactions. CORE currently consumes F1 parsing/content policy only and intentionally does not implement field-domain mutation behavior.
- **WORKFLOW / W2:** pass the stable field owner scope/session identity from the workflow/template owner and consume the resulting canonical C1 snapshot in persistence/output. CORE did not edit WORKFLOW-owned routes or persistence files.

### Exact focused validation executed under Node 24

Validation run: `https://github.com/Scofieldkoh/oakcloud/actions/runs/34667643792`

```text
node -e "if (Number(process.versions.node.split('.')[0]) !== 24) process.exit(1)"
npm ci
npx playwright install --with-deps chromium

npx vitest run \
  __tests__/components/a4-editor-c2-bridge.test.ts \
  __tests__/components/a4-editor-session.test.ts \
  __tests__/components/a4-page-editor.test.tsx \
  __tests__/components/a4-editor-toolbar.test.tsx \
  __tests__/components/a4-page-editor-ssr.test.tsx \
  --reporter=verbose
PASS — 5 files, 98/98 tests

npx vitest run __tests__/components/a4-pagination --reporter=verbose
PASS — 8 files, 171/171 tests

npx vitest run \
  __tests__/lib/template-field-contract.test.ts \
  __tests__/lib/template-field-f0-compatibility.test.ts \
  __tests__/lib/template-field-f1.test.ts \
  __tests__/lib/a4-content-policy-f1.test.ts \
  --reporter=verbose
PASS — 4 files, 63/63 tests

npx vitest run --config vitest.browser.config.ts \
  __tests__/browser/a4-input-sequences.browser.test.tsx \
  __tests__/browser/a4-boundary-semantics.browser.test.tsx \
  __tests__/browser/a4-page-editor.browser.test.tsx \
  --reporter=verbose
PASS — 3 real-Chromium files, 60/60 tests

npx eslint \
  src/components/documents/a4-page-editor.tsx \
  src/components/documents/a4-editor-semantic-bridge.ts \
  __tests__/components/a4-editor-c2-bridge.test.ts \
  __tests__/components/a4-page-editor.test.tsx \
  __tests__/browser/a4-input-sequences.browser.test.tsx
PASS — exit 0, 0 errors, 8 warnings

DATABASE_URL=postgresql://localhost:5432/oakcloud npm run db:generate
PASS

npm run typecheck
PASS

npx tsc -b
PASS
```

Focused C2 total: **20 test files, 392 tests passed, 0 failed** across the four explicitly executed Vitest/browser groups. The Chromium evidence is actual browser execution and includes the two new C2 cross-page/semantic-break cases plus all frozen G1 Enter/list/caret regressions.

The full production `npm run build` is intentionally not claimed from this focused run. It is executed by the repository's existing `Node 24 compatibility` pull-request workflow after the C2 PR is opened; that PR evidence must be reported separately rather than inferred.

### Review/correction evidence

C2 was reviewed and corrected against fresh Node 24 runs rather than weakening the frozen contract:

- initial component validation exposed the obsolete physical-page page-break assertion and the hard-page/leading-empty-block Backspace boundary;
- the hard-page boundary was corrected by semantic position/affinity mapping, not physical-page mutation;
- an unchanged rerun distinguished one transient selection assertion from a reproducible C2 defect;
- real Chromium then exposed that the current S1 paragraph primitive does not yet implement the frozen list Enter/exit semantics; CORE restored the existing SEMANTICS-owned canonical paragraph transaction as the bounded S2 compatibility path;
- final run `34667643792` is green for all focused component, S1, F1, Chromium, lint, Prisma, typecheck and `tsc -b` gates above.

### Compatibility impact / remaining risks

- Canonical C1 revision/session/history authority is unchanged.
- No reconstruction of canonical state from physical page DOM was introduced; the page-break writer that did persist cloned physical fragments is removed.
- Existing v1 semantic hard-break compatibility is preserved; no v2 writer is enabled.
- G1 browser behavior is preserved by the final 60/60 Chromium run.
- Existing explicit Add Blank Page/Delete Current Page controls still call SEMANTICS-owned canonical hard-section helpers (`appendHardPage` / `deleteHardPageSection`) selected from derived page metadata. They do not persist page DOM, but a future SEMANTICS packet should replace them with the final semantic page/break capability if the frozen model removes those helpers.
- Existing table column resize remains bounded rendered-table reconciliation through C1 until SEMANTICS supplies a canonical table-resize transaction.
- Complete field lifecycle remains dependent on F2; workflow persistence/output remains dependent on W2.
- Production Next build and repository-wide PR checks are not claimed here until the PR workflow executes them.

**READY FOR INTEGRATION — C2 ONLY**


## Wave-2 CORE integration closeout — 2026-09-12

Status: **G2 CANDIDATE BLOCKED — CORRECTION REQUIRED**

CORE integrated Wave-2 on `codex/a4-editor-wave2-g2-integration-20260912` from current merged main `6f1ab8d3cb90056c556771936f4c763d9596efdf`. The historical G1-validated source baseline remains `ad7285ace280f0b4002f119f923a8e2166b9475f`; it was not used as the integration branch base. The frozen contract remains **v1 frozen at G0 — unchanged** and G1 remains **G1 FROZEN/PASSED**.

Integrated reviewed packets, in dependency order, without merging any packet PR to main:
- S2 — PR #43 — `4b025bec4f256169a32b2216b0fd54cd4a083349` — `SEMANTICS-S2-20260912-01`
- F2 — PR #45 — `df56185328d20784ad870adf0750b0d0315996f8` — `FIELDS-F2-20260912-01`
- W2 — PR #44 — `d5a98dd48d1b3196706cc41bd000b9f8f9f9b03f` — `WORKFLOW-W2-20260912-01`
- C2 — PR #46 — `b154630a3227646a4cf8d562902566720c532fec` — `CORE-C2-20260912-01`

The single integration PR is **#47**. The final product-code checkpoint before coordination closeout is `a5e86d01e3906d3ec72ed6ce3fcb8f5a3d15d2d4`. The immutable candidate checksum is the PR #47 head containing this closeout record and is validated directly by the final candidate matrix.

### CORE-owned C2 ↔ S2 wiring completed

- Enter now consumes `insertA4S2ParagraphBreak`; the temporary C2 compatibility Enter path is no longer authoritative.
- Native Tab/Shift+Tab and toolbar indent/outdent consume S2 indentation semantics through the C1 adapter.
- OL/UL conversion, restart numbering and continue numbering consume S2 APIs where S2 exposes the operation.
- CORE consumes S2 mixed/uniform formatting state and the S2 neutral typing-format patch for collapsed Clear Formatting.
- C1 remains the sole canonical session, editor history and document-revision authority. One S2 transaction becomes one C1 action/history/revision commit.
- Semantic nesting/lift and native Tab/Shift+Tab integration regressions were corrected in CORE.
- Two CORE attempts to restore Enter-driven caret viewport following did not satisfy the required real-Chromium proof; no test or contract was weakened.

### F2 / W2 integration implications

F2 remains the owner of parser/registry identity, scoped resolution, escaping/trust and atomic field lifecycle transactions. CORE does not recreate those rules. Full lifecycle activation is not silently expanded into C2; that producer/consumer boundary remains for a later authorized packet.

W2 consumes C1 snapshots/revisions and does not introduce another editor history/session authority. W2's server expected-revision/CAS token remains separate from C1's local editor revision. W2 focused and PostgreSQL behavior is healthy, but two W1 source-contract tests still inspect the pre-W2 editor-page source after extraction; that compatibility repair belongs to WORKFLOW/W2.

### Blocking evidence

- S2 focused: 5 files / 106 tests — **104 passed, 2 failed**: indent-limit normalization and mixed bold state.
- Full A4 pagination: 10 files / 199 tests — **197 passed, 2 failed**, same S2 failures.
- F1/F2: 12 files / **133/133 passed**.
- W2 focused: 3 files / **28/28 passed**.
- W1/W2 source compatibility: 6 files / 42 tests passed; 2 W1 source-contract files fail during loading after W2 extraction.
- Exact S2 Chromium boundary: 1 file / 13 tests — **12 passed, 1 failed**, same mixed-formatting-state defect.
- CORE component recheck: 5 files / 100 tests — **99 passed, 1 failed**. Remaining list toggle-off requires semantic unlist; S2 exposes `ordered | unordered | alpha` but no `none`/unlist transaction.
- CORE Chromium recheck: 2 files / 53 tests — **51 passed, 2 failed**: active-list toggle-off and viewport-follow.
- Targeted Chromium at `a5e86d01e3906d3ec72ed6ce3fcb8f5a3d15d2d4`: selected empty paragraph restored, but viewport `scrollTop` remained `200`; required assertion is `> 200`.
- Disposable PostgreSQL 16: all 71 migrations replayed; W2 draft sequencing **5/5 passed**; W2/W1 PostgreSQL compatibility **13/13 passed**.
- Bundle freshness, lint, typecheck, `npx tsc -b`, and production build passed at the integrated code checkpoint. Final candidate matrix reruns them on the immutable closeout head.

Unresolved owners:
1. **SEMANTICS/S2** — indent-limit normalization defect.
2. **SEMANTICS/S2** — mixed formatting-state defect.
3. **SEMANTICS/S2** — no semantic unlist/`none` operation for active-list toggle-off.
4. **WORKFLOW/W2** — two W1 source-contract checks were not migrated after source extraction.
5. **CORE integration** — Enter restores semantic caret after repagination but real-Chromium viewport-follow remains broken after two targeted corrections.

Q1 — G2 boundary and reader compatibility: **WITHHELD**. No Q1 run is released while the candidate is blocked.

Stop boundary remains in force: no C3, S3, F3, W3, D1 deployment or version bump.

## Corrected Wave-2 CORE closeout / Q1 release — 2026-09-12

Status: **G2 CORE CANDIDATE FROZEN — Q1 RELEASED**

The earlier blocked Wave-2 closeout above is retained as chronology. CORE corrected all five blocking findings without changing the frozen v1 contract and froze production candidate `6e8d4426c0d57043d85a830045dee465f6ff9a47` for independent VERIFY/Q1.

Corrections are limited to the integrated Wave-2 boundary: S2 indent/mixed-format/unlist semantics, CORE semantic list-toggle and caret-viewport integration, and W1/W2 source-contract proof alignment. No new database schema/migration, deployment, version bump, C3, S3, F3 or W3 work was introduced.

Immutable corrected-candidate evidence against exact `6e8d4426c0d57043d85a830045dee465f6ff9a47`:

- corrected S2 focused lane: **107/107 passed**;
- corrected CORE focused lane: **100/100 passed**;
- real Chromium integrated matrix: **66/66 passed**;
- disposable PostgreSQL 16 after **71 migrations**: **31/31 passed** (W1 CAS/batch 13/13; W2 drafts 5/5; W2/W1 compatibility 13/13);
- complete required component/static lanes: **PASS** including full pagination, FIELDS F1/F2, W1, W2 non-PostgreSQL, pagination-bundle freshness, lint, typecheck, `npx tsc -b`, and production build;
- lint completed with no errors; repository warnings remain non-blocking and did not change the gate outcome;
- production build required a larger validation-runner Node heap and synthetic required environment values only; the application candidate was unchanged.

The first immutable PostgreSQL lane used `postgres` instead of the W2 suite-required synthetic username `assistant_test`; its guard failure was corrected in the harness. The exact candidate then passed the complete 31-test PostgreSQL matrix on the required disposable database. No production data was used.

CORE does **not** mark G2 passed from its own matrix and does **not** execute Q1. Production edits are frozen at `6e8d4426c0d57043d85a830045dee465f6ff9a47`. `VERIFY-Q1-20260912-01` is released in `coordination/dispatch.md` for independent evidence. Any production-code change requires a new immutable candidate and fresh Q1 dispatch.

Stop boundary remains: no C3, S3, F3, W3, D1 deployment or version bump.

## CORE-C3 / Wave-4 integration closeout — 2026-09-13

Status: **WAVE-4 PRODUCT CANDIDATE FROZEN FOR INDEPENDENT VERIFY — NO MAIN MERGE / NO DEPLOYMENT**

- Wave-4 common baseline: `140cb7aa421c8856a6b5b6ef961618e8780fb1a9`.
- Dispatch-only merged `main` at integration start: `bf2d864541f608095da81acdd3c804c7247a85e7`.
- Integration branch: `codex/a4-editor-wave4-integration-20260913`.
- Frozen clean product candidate for independent verification: `b522cf50f61f18b75f2cae62b42cd142bef4cf2d`.
- Frozen contract: **v1 frozen at G0 — unchanged**.
- Deployment and application-version bump: **not authorized**.

### Integrated producer packets

- SEMANTICS / S3 — PR #53 — integration merge `0fb4e299fcaa0a82472ba924624fb3290ae8e262`.
- FIELDS / F3 — PR #54 — integration merge `ec201e79218c687c5e88f0fc83b50e12d87d528b`.
- CORE / C3 — PR #51 — integration merge `69878bef05bc8b3d99ff7202f56a651519b91145`.
- WORKFLOW / W3 — PR #52 — integration merge `ecfa66dd4ef5f7eed6407fa04fb6ee062cc66b86`.
- Final C3 producer-consumer wiring commit: `d40d231faa99c2f9af9e56eb89ee296171edfdec`.
- Temporary integration scaffolding cleanup: `123f44a900bfbc96d8d93a782cc624bb26cf3441`.

C3 now consumes W3 output preparation/page assembly and workflow status, and S3 page measurement/font-readiness producers rather than maintaining duplicate output/measurement authority. Local print uses the shared canonical output-preparation path and cleanup lifecycle. Page-number authoring/display remains capability-gated. Command applicability remains independent of repagination busy state. The F3/W3 typed-field rendezvous preserves exact false/zero/date/multiline behavior and scoped identities without moving ownership into CORE.

### Final integrated validation evidence

Authoritative final integration workflow: `A4 Wave 4 final integration validation`, run `34746728698` — **SUCCESS** on validation head `c63e569f787412f05ed4b1fbe4b2f69f7ec1252e`.

The frozen candidate `b522cf50f61f18b75f2cae62b42cd142bef4cf2d` differs from that validated head only by deleting the validation-only workflow and its trigger; application, test, generated bundle and coordination source used by the validation are otherwise unchanged.

Node `24.20.0`, npm `11.19.0`, Ubuntu 24.04:

- pagination bundle regeneration + checked-in bundle diff: **PASS**;
- `npm run lint`: **PASS — 0 errors / 12 warnings**;
- `npm run typecheck`: **PASS**;
- `npx tsc -b`: **PASS**;
- CORE C3 component matrix: **3 files / 78 tests passed**;
- S3 pagination matrix: **11 files / 209 tests passed**;
- F3 authoring/discovery: **2 files / 34 tests passed**;
- F1/F2/F3 contract/resolver compatibility: **4 files / 75 tests passed**;
- W3/output compatibility: **4 files / 21 tests passed**;
- production `npm run build`: **PASS**, including 171 static pages generated;
- real Chromium CORE/Q1 preservation: **2 files / 53 tests passed**;
- real Chromium S3 performance/boundary: **2 files / 15 tests passed**.

The JSDOM CORE lane emits expected `Window.focus` / `Window.print` not-implemented logs and existing React `act(...)` warnings; these did not fail tests. The lint lane has warnings only and no errors.

### G3 assessment / Q2 boundary

CORE's integration assessment is **G3 implementation-complete and ready for independent acceptance**, covering F2/F3 + W2/W3 + C02/C05 integration, typed/scoped fields, lossless field metadata, plain-text/trusted-rich policy, revision/draft/preview behavior and common output preparation. CORE does **not** self-certify the remaining real-output/user-interaction acceptance as a G3/G4 pass.

Independent VERIFY must use exact candidate `b522cf50f61f18b75f2cae62b42cd142bef4cf2d`, first close any remaining G3 acceptance evidence on that immutable target, and only then record G4/Q2. Required real PDF/HTML/local-print, clipboard, IME/accessibility, staff-journey, failure/cleanup and rollback evidence remains a VERIFY responsibility under `verification-and-rollout.md`.

No Q2/G4 execution was performed by CORE. Any production defect found by VERIFY returns to the owning packet and requires a new immutable candidate plus repetition of affected dependent checks.
