# SEMANTICS handoff log

## SEMANTICS-S0-20260911-01

Dispatch ID: `SEMANTICS-S0-20260911-01`
Role and packet: SEMANTICS / S0 — structural positions and nested manual-break proof
Starting state: DISPATCHED
Ending state: READY FOR INTEGRATION — S0 ONLY
Dispatched baseline commit: `63aa75b6170766a3e3d1728feb5e5417f5632f20`
Remote branch integration base: `80056fb7ab6e410ef2d2ddc17a830b068d263671` (CORE C0 merge)
Branch / PR: `codex/a4-editor-semantics-s0` / `#34`
Contract consumed: proposed v1 C02/C03/C04/C09; G0 remains OPEN

### Scope and ownership

- This correction pass resumes only the existing S0 packet after CORE review. S1/S2/S3 were not started.
- Writable scope remains the original SEMANTICS lease. The correction changes only `structural-position.ts`, `semantic-page-breaks.ts`, the leased `a4-boundary-semantics.browser.test.tsx`, and this handoff.
- No CORE/FIELDS/WORKFLOW production or test file was edited. `editor-session.ts` / `CanonicalInputBridge` is imported only by the S-owned proof fixture to demonstrate the contract boundary.
- No editor/session/toolbar wiring, active v2 command, migration, package/lock/config change, generated pagination bundle, version bump, deployment, or merge to `main` is included.

### CORE G0 review corrections completed

1. **Structural selection affinity**
   - Collapsed DOM anchor/focus capture is performed once and reused, so a logically collapsed DOM selection cannot become two A4 positions merely because the endpoints were assigned different fallback affinities.
   - Non-collapsed anchor/focus direction remains represented by anchor/focus ordering; endpoint role no longer injects `after` for anchor and `before` for focus.
   - Child-boundary capture canonicalizes the side of a single adjacent structural node: before `<br>` captures `affinity: 'before'`; after it captures `affinity: 'after'`.
   - `resolveA4Position` now uses affinity when a text offset coincides with a zero-text structural boundary and when a text offset lies exactly between text nodes.
   - The browser fixture performs capture -> resolve -> capture regressions for immediately before/after `<br>`, blank paragraph, empty cell, adjacent atomic field-like elements, collapsed selection, forward non-collapsed selection, and reverse non-collapsed selection.

2. **Multiple semantic breaks in one logical list item**
   - Added the ordered-list fixture `Before [break1] Middle [break2] After` with `start="5"` and a following item 6.
   - Projection still produces one canonical OL/LI/P chain; all three projected fragments retain the source `list` -> `item-5` -> `paragraph` ancestry. When a between-break DOM Range has a common ancestor below the canonical root, the proof reconstructs that shallow ancestor chain around the cloned contents.
   - Source-range constraints now intersect. The middle paragraph/item range is exactly `[7,14]` for `Middle ` rather than being overwritten to `[0,14]` or `[7,end]`.
   - Continuation metadata composes across adjacent break boundaries. A fragment that is after break 1 and before break 2 receives `data-flow-continuation="both"`; its ordered-list counter is not reset back to the canonical list base.
   - Removing either `break-1` or `break-2` leaves one logical item 5, retains all `Before Middle After` text, retains the other break, and preserves `start="5"`.

3. **C02/C04 contract boundary completed**
   - Exact S1 transaction/document and projection mapping contracts are published below and exported by the proof modules.
   - The projection mapping is tagged with the `sessionKey` and `documentRevision` copied from CORE C0. The S map never allocates or advances a revision.
   - A proof fixture instantiates CORE's existing `createCanonicalInputBridge<A4Selection>()`, creates a revision-tagged S projection from its snapshot, maps a pointer selection, commits an `A4TransactionResult` through `bridge.commitCanonical`, and proves the old position map remains revision 0 and is rejected by CORE after revision 1 exists.

4. **Rendered ordered-list evidence strengthened**
   - The proof now derives concrete marker labels using the same counter rules as `a4-page-content-css.ts`: `--flow-list-start` initializes the list counter, ordinary LI increments and displays it, and `data-flow-continuation-item` suppresses both increment and marker.
   - For the single-break `start="5"` fixture the displayed sequence is: first fragment `5.`, continuation item no marker, following item `6.`.
   - For the two-break fixture the displayed sequence is: fragment 1 `5.`, fragment 2 continuation/no marker, fragment 3 continuation/no marker followed by `6.`.
   - Existing nested-list, legacy top-level break, `start="5"`, soft-pagination, serialization, and deletion evidence remains covered.

## Frozen S0 interface proposal for G0

### C02 — structural positions and pure transaction result

Proposed home: `src/components/documents/a4-pagination/structural-position.ts`.

```ts
type A4Position =
  | { kind: 'text'; nodeId: string; offset: number; affinity: 'before' | 'after' }
  | { kind: 'children'; nodeId: string; index: number; affinity: 'before' | 'after' };

interface A4Selection {
  anchor: A4Position;
  focus: A4Position;
}

interface CanonicalEditorDocument {
  readonly internalHtml: string;
}

type A4TransactionResult =
  | {
      status: 'applied';
      document: CanonicalEditorDocument;
      selection: A4Selection;
      changedNodeIds: readonly string[];
    }
  | { status: 'unchanged'; reason: string }
  | { status: 'rejected'; code: string; message: string };
```

`CanonicalEditorDocument` deliberately has **no session key and no revision field**. It is the S-owned HTML-backed canonical tree/snapshot value with internal semantic IDs. A pure S1 command will receive the current canonical document + structural selection and return the union above; it will not increment session revision or publish rendered state.

The G0 adapter to today's `DocumentTransactionResult` is therefore explicit and one-way during rollout:

```text
A4TransactionResult.applied.document.internalHtml
    -> serialize canonical HTML according to the agreed persistence/view boundary
A4TransactionResult.applied.selection
    -> structural selection retained by CORE
A4TransactionResult.applied.changedNodeIds
    -> CORE history/change-map invalidation input

unchanged/rejected
    -> no canonical content commit
```

S1 may implement this adapter only after G0. S0 does not alter `document-actions.ts` or activate this command surface.

### C04 — exact projection-position map supplied to CORE

Proposed home: `src/components/documents/a4-pagination/semantic-page-breaks.ts`.

```ts
interface A4ProjectionSourceRevision {
  sessionKey: EditorSessionKey;      // imported from CORE editor-session.ts
  documentRevision: EditorRevision;  // imported from CORE editor-session.ts
}

interface A4SourceRangeBinding {
  sourceNodeId: string;
  startTextOffset: number;
  endTextOffset: number;
}

interface A4ProjectionFragmentPositionMap {
  fragmentIndex: number;
  sourceRanges: readonly A4SourceRangeBinding[];
}

interface A4ProjectionPositionMap extends A4ProjectionSourceRevision {
  fragments: readonly A4ProjectionFragmentPositionMap[];
}

interface A4ProjectedTextPoint {
  fragmentIndex: number;
  sourceNodeId: string;
  projectedOffset: number;
  affinity?: A4Position['affinity'];
}

interface A4MappedSourcePosition extends A4ProjectionSourceRevision {
  position: A4Position;
}
```

`mapProjectedTextOffsetToSource(positionMap, point)` returns the revision association together with the canonical `A4Position`. The projected offset is relative to that fragment's bound source range; e.g. the two-break middle range `[7,14]` maps projected offset `2` to canonical offset `9`.

### Binding to C0 `CanonicalInputBridge` — one revision authority

CORE C0 already owns:

```ts
interface CanonicalInputBridge<TSelection> {
  getSnapshot(): SnapshotResult;
  commitCanonical(content: string, selection: TSelection): EditorRevision;
  publishProjection(revision: EditorRevision): boolean;
  resolveNativeInputTarget(input: {
    renderedRevision: EditorRevision;
    origin: NativeInputOrigin;
    renderedSelection: TSelection;
  }): NativeInputTarget<TSelection>;
  // ...other C0 members unchanged
}
```

The G0 composition is exactly:

```text
1. CORE bridge.getSnapshot() yields { sessionKey, revision, content }.
2. S projection receives { sessionKey, documentRevision: revision } as immutable source metadata.
3. S returns fragments + A4ProjectionPositionMap tagged with those copied values.
4. A rendered point is mapped to { sessionKey, documentRevision, position: A4Position }.
5. CORE verifies/uses that same rendered revision through resolveNativeInputTarget(...).
6. If an S transaction is applied, CORE calls commitCanonical(serializedContent, result.selection).
7. commitCanonical alone allocates the next EditorRevision. The old S position map does not mutate; it remains tagged with the old revision and becomes stale.
```

There is therefore no S revision counter, no projection-owned revision increment, no alternate stale-selection authority, and no database version conflation. S1 must preserve this boundary.

## C03 nested-break representation and compatibility

Canonical v2 nested break remains:

```html
<ol start="5">
  <li><p>Before<span data-a4-break="page"></span>After</p></li>
</ol>
```

The canonical tree is unsplit. `Range.cloneContents()` is used only to derive view fragments. For each inline break, every split ancestor carries its source semantic ID into the projected fragment. Multiple range constraints for the same source node are intersected so a fragment between two breaks maps only to its true source slice.

Legacy top-level compatibility remains:

```html
<div class="page-break" data-break-type="hard"></div>
```

Legacy boundaries are read/projected without inferring that independent lists on opposite sides form one logical list. Blank paragraphs, table caption/tfoot content, nested mixed lists and serialization stripping of runtime `data-flow-*` / `--flow-list-start` metadata remain covered.

A manual page break inside `td`/`th` remains explicitly unsupported by S0 and returns `table-cell-interior-unsupported` without changing content. No split-cell/row promise is introduced.

## Validation evidence

### Supported Node 24 repository CI

PR #34 code/test head after the final S0 logic review: `91b215415b440f394326d4ac4c120f2a6526f0c5`.
GitHub Actions run: `Node 24 compatibility` run `#139` (`34571059005`).

At the time this handoff text was prepared, the supported runner had already recorded:

```text
Set up Node 24                  PASS
Verify runtime major           PASS
Lint                           PASS
Typecheck                      PASS
```

The final PR review must use the latest run attached to the eventual handoff commit, because updating this file creates a new PR head and therefore a fresh workflow run.

### Required targeted S0 commands

CORE requested these exact Node 24 commands:

```text
npx vitest run --config vitest.browser.config.ts \
  __tests__/browser/a4-boundary-semantics.browser.test.tsx

npx vitest run __tests__/components/a4-pagination
```

Result in this execution environment:

```text
NOT EXECUTED — environment/ownership block, not a test failure.
```

Reason: the available working container is Node `v22.16.0`, has no repository checkout/dependencies and cannot resolve `github.com`/`nodejs.org`. The repository's only GitHub workflow correctly provisions Node 24 but does not expose arbitrary/ad-hoc commands and does not run either command above. S0 does not have a lease to edit `.github/workflows`, `package.json`, shared config, or another owner's test to inject these commands. Those files were intentionally left untouched.

Local proof-only compile performed after the correction draft:

```text
tsc --noEmit -p isolated-s0-tsconfig.json
PASS — TypeScript 5.8.3 / Node v22.16.0
```

This local compile is supplemental only and is **not** represented as the requested Node 24 Vitest evidence. G0 must not treat the two targeted commands as passed until they are executed verbatim in an authorized Node 24 checkout/runner.

## Acceptance mapping after CORE correction

- **A4E-002 / C03:** single and multiple inline breaks retain one canonical ordered-list item, list-start intent, concrete projected numbering, and logical deletion semantics.
- **A4E-011 / C02:** structural positions distinguish before/after `<br>`, blank blocks/cells and adjacent atomics; capture/resolve round-trips cover collapsed, forward and reverse selections.
- **C04:** position maps carry CORE's session/document revision association and stale maps cannot advance themselves.
- **A4E-008/018:** durable `ol[start]` remains canonical; projection counter offsets remain runtime-only.
- **A4E-028:** existing one-item soft-pagination/reassembly invariant remains covered.
- **A4E-029:** S0 boundary fixture is expanded without enabling production writer behavior.

## Remaining dependency and stop boundary

Implementation corrections requested by CORE are authored within S0 and the proof interfaces are published. **G0 remains OPEN.** The two requested targeted Node 24 Vitest invocations still require an authorized runner that can execute ad-hoc commands without violating the Wave-0 ownership lease. No result is fabricated here.

SEMANTICS stops at **READY FOR INTEGRATION — S0 only**. Do not begin S1 until CORE explicitly freezes/publishes G0 and dispatches a new S1 assignment.

---

## SEMANTICS-S1-20260911-01

Dispatch ID: `SEMANTICS-S1-20260911-01`
Role and packet: SEMANTICS / S1 — structural positions, commands and versioned break readers
Starting state: DISPATCHED
Ending state: READY FOR RE-REVIEW — S1 ONLY
Frozen Stage-1 common baseline: `bfdc4f95594b73ce4d20bff45f320bdb53837c37`
Implementation branch / PR: `codex/a4-editor-semantics-s1` / `#36`
Initial S1 handoff code head: `f8b228f32637dcfab93e5d2c6be3b73cc7d84803`
C02/C04 correction code/test head before this handoff: `44d8b3718fd14e0a57a93298dbdce6b54c07adb2`
Contract consumed: frozen G0 C02/C03/C04/C09 and Stage-1 CORE dispatch; no contract widening.

### Scope completed

- Expanded runtime semantic identity hydration across paragraph/heading/block nodes, ordered/unordered lists and items, nested structures, table/table-section/row/cell nodes, empty blocks/cells, `<br>`, explicit old/new page-break nodes and atomic field/reference-like nodes. These `data-flow-id` values remain runtime flow identity only and are stripped at persistence.
- Promoted structural positions from S0 proof to production validation/comparison/range APIs. `text` and `children` positions and `before`/`after` affinity are retained; zero-text boundaries remain distinguishable. Missing, ambiguous, stale, deleted-node, cross-session and invalid-offset cases return typed rejection rather than falling back to a physical page boundary.
- Added revision-qualified retained change maps. SEMANTICS records how retained semantic nodes changed but does not allocate document revisions; `sessionKey`, `fromRevision` and `toRevision` are supplied by CORE.
- Added pure S1 semantic commands for manual break insertion/removal, logical deletion, paragraph break and line break. Commands consume `CanonicalEditorDocument + A4Selection`, operate on the unsplit logical tree and return the frozen `A4TransactionResult` union with resulting structural selection and `changedNodeIds`.
- Canonical nested manual-break writing is exactly `<span data-a4-break="page"></span>` internally (with removable runtime identity only). Legacy top-level `<div class="page-break" data-break-type="hard"></div>` remains readable/removable. A break inside an OL item does not create another canonical LI.
- Collapsed Backspace/Delete first removes one adjacent explicit manual break. Ordinary character deletion is grapheme-safe through `Intl.Segmenter` with a code-point fallback. Range deletion acts only on the logical selection and preserves unrelated siblings/ancestors.
- Added tree-aware production break readers/projection by promoting the S0 range-based visitor behind production APIs. Projection clones ancestry only in fragments, preserves the canonical unsplit tree, emits fragment content/source ranges/continuation information/`hardBreakBefore`, and retains the C04 `sessionKey + documentRevision` map. Multiple breaks in one logical block preserve the exact intermediate source ranges proven by S0.
- Updated the source pagination entry so `paginateFlowHtml` now routes explicit hard-break partitioning through the semantic tree-aware projection before existing soft measurement. Existing `paginateFlowHtml(input, measurer, maxHeight)` callers remain functional through a synthetic compatibility revision; revision-aware CORE/WORKFLOW callers receive a native position map from `paginateA4FlowHtml` / `paginateA4StructuralHtml`.
- Exported applicability/capability functions for insert/remove manual break, delete blank page/break, list-level context and table/break support. Arbitrary manual-break insertion inside `td`/`th` returns typed `table-cell-interior-unsupported` and does not mutate content. Soft page continuation deliberately exposes no physical delete-page mutation.
- Added S1 regression coverage for after-`<br>` position, empty paragraph/cell, adjacent atomics, reverse selection, stale positions, change mapping, multiple nested breaks, nested lists, `start=5`, Unicode grapheme deletion, old/new hard-break insertion/removal, selected-range Enter/Delete, unsupported table-cell break insertion, soft-continuation capability and persistence metadata stripping.
- No editor key/event wiring, FIELDS parsing/identity logic, WORKFLOW persistence/output adapter, v2 writer activation, generated pagination bundle, package/config/version change, deployment or merge is included.

### Exact production APIs exported to CORE / WORKFLOW

`structural-position.ts`:

- `hydrateA4RuntimeIdentity(root)`
- `hydrateA4RuntimeHtml(input)`
- `createCanonicalEditorDocument(input)`
- `captureA4Position(root, node, offset, affinity)`
- `captureA4SelectionFromDomPoints(root, anchor, focus)`
- `captureA4Selection(root)`
- `resolveA4Position(root, position)`
- `validateA4Position(root, position)`
- `validateA4DocumentPosition(canonical, position)`
- `compareA4Positions(canonical, left, right)`
- `normalizeA4SelectionRange(canonical, selection)`
- `compareA4StructuralRanges(canonical, left, right)`
- `createA4ChangeMap(before, after, identity)`
- `mapA4PositionThroughChangeMap(changeMap, source)`
- frozen structural/result types plus `A4RevisionedPosition`, `A4ChangeMapIdentity`, `A4ChangeMap`, `A4ChangeMapResult`.

`structural-commands.ts`:

- `createA4CommandDocument(html)`
- `insertA4ManualPageBreak(canonical, selection)`
- `removeA4ManualPageBreak(canonical, selection)`
- `deleteA4Selection(canonical, selection, direction)`
- `insertA4ParagraphBreak(canonical, selection)`
- `insertA4LineBreak(canonical, selection)`
- `getInsertManualBreakCapability(canonical, selection)`
- `getRemoveManualBreakCapability(canonical, selection)`
- `getDeleteBlankPageOrBreakCapability(canonical, selection)`
- `getA4ListLevelContext(canonical, position)`
- `getTableBreakCapability(canonical, selection)`
- `A4CommandCapability`, `A4CommandCapabilityCode`, `A4BlankPageCapability`, `A4ListLevelContext`.

`semantic-break-projection.ts`:

- `detectA4BreakFormatLevel(input)`
- `readA4BreakDocument(input)`
- `partitionA4SemanticBreaks(input, source)`
- `mapA4ProjectedTextPoint(positionMap, point)`
- `mapA4ProjectedStructuralPoint(canonical, projection, point)`
- `serializeA4CanonicalBreakDocument(canonical)`
- `A4BreakFormatLevel`, `A4BreakReaderResult`, `A4ProjectedStructuralPoint`, `A4ProjectedStructuralMapResult`.
- C02/C04 correction exports `A4ProjectedChildBoundaryBinding`, `A4StructuralProjectionFragmentPositionMap`, `A4StructuralProjectionPositionMap`, and `A4StructuralBreakProjectionProof`; these extend the existing revision-qualified projection map with structural child-boundary bindings without introducing another revision authority.

`engine.ts` / `structural-pagination.ts`:

- `paginateA4FlowHtml(input, source, measurer, maxHeight)` returns pages + projected source fragments + revision-qualified position map.
- `paginateA4StructuralHtml(...)` is the SEMANTICS-facing stable alias.
- Existing `paginateFlowHtml(input, measurer, maxHeight)` remains available.

### Compatibility adapters retained

- `a4PositionFromFlowPoint`, `flowPointFromA4Position`, `a4SelectionFromFlowBookmark` and `flowBookmarkFromA4Selection` bridge existing text-offset selection callers while CORE migrates. The adapter does not pretend legacy text offsets can distinguish every zero-text boundary; native C02 callers must use `A4Position` for that precision.
- `paginateFlowHtml` remains source-compatible and delegates to the structural partition entry with a synthetic legacy session/revision. `paginateFlowHtmlStructuralCompat` is an explicit alias for staged consumers.
- S0 proof exports in `semantic-page-breaks.ts` remain intact; S1 production wrappers call the proven tree-aware visitor rather than duplicating its logic.
- Legacy top-level hard breaks remain readable and removable. New semantic break writing is implemented only as a pure command; no user-visible v2 writer gate is enabled in this packet.

### WORKFLOW W1 generated-bundle regeneration requirement

S1 intentionally did **not** modify `scripts/build-pagination-bundle.mts` or `src/components/documents/a4-pagination/pagination-bundle.generated.ts`, because the generated output is WORKFLOW-owned. After S1 is integrated, W1 must run exactly:

```text
npm run generate:pagination-bundle
```

and commit the regenerated:

```text
src/components/documents/a4-pagination/pagination-bundle.generated.ts
```

The regeneration is required because `paginate-in-browser.entry.ts` imports `paginateFlowHtml` and S1 changes `engine.ts` plus its transitive semantic-partition dependencies. Until W1 regenerates the bundle, the committed generated browser pagination artifact will still reflect the pre-S1 engine.

### Validation and test results

Required Node 24 commands from the S1 dispatch:

```text
npx vitest run --config vitest.browser.config.ts \
  __tests__/browser/a4-boundary-semantics.browser.test.tsx

npx vitest run __tests__/components/a4-pagination
```

Result in this execution environment:

```text
NOT EXECUTED — environment/tooling block, not represented as a pass or a test failure.
```

Reason: the available working container is Node `v22.16.0`, has no repository checkout/dependencies and cannot resolve GitHub. The authenticated GitHub connector can mutate/read the repository but cannot execute arbitrary workflow commands. The repository's `Node 24 compatibility` workflow provisions Node 24 but does not expose the two required ad-hoc Vitest invocations. No workflow/config/package file was modified to bypass the SEMANTICS ownership boundary.

The original S1 regressions remain in `__tests__/components/a4-pagination/structural-commands.test.ts`; the existing S0 browser proof was not weakened or modified. For the C02/C04 re-review correction, focused direct regressions were added in `__tests__/components/a4-pagination/semantic-break-projection.test.ts` as recorded below.

C02/C04 correction implementation/test head `44d8b3718fd14e0a57a93298dbdce6b54c07adb2` triggered `Node 24 compatibility` run `#210` (`34600726399`). Before this documentation handoff commit, that run had actually completed Node 24 setup, dependency install, runtime-major verification, lint, registry freshness, Prisma generation, typecheck, P16 evidence, Chromium path, and Business Assistant/BizFile contract checks successfully; the application build was still in progress. The independent PostgreSQL recovery/authorization job completed successfully. The final PR-head workflow created by this handoff must be used for the final CI status. No targeted Vitest result is fabricated.

### CORE Stage-1 re-review correction — C02/C04 structural child mapping

**Defect confirmed:** the original `mapA4ProjectedStructuralPoint()` converted `children` positions to `Range.toString().length`, mapped that text offset through `mapProjectedTextOffsetToSource()`, and then recaptured a structural position. Distinct zero-text child boundaries therefore could alias whenever adjacent `<br>`, atomic/reference nodes, empty structural owners, or semantic-break neighbors shared the same text offset.

**Correction implemented:**

- `partitionA4SemanticBreaks()` now augments each revision-qualified projection fragment with exact `childBoundaries` entries mapping `{ projectedNodeId, projectedIndex }` to `{ sourceNodeId, sourceIndex }`.
- Direct runtime `data-flow-id` identity is used for semantic element children wherever available. Text/non-runtime children are matched only when uniquely identifiable within the fragment's source interval.
- Source intervals are bounded by the nearest authored semantic breaks for the same structural owner, including nested/multiple-break cases; this prevents a projected fragment from mapping through unrelated removed break boundaries.
- Empty canonical owners retain exact child index `0`. Empty projected fragments created at an authored break map only when the break bounds identify one exact canonical boundary.
- `mapA4ProjectedStructuralPoint()` consumes the recorded structural binding directly for `children` positions. Older S0 proof-shaped objects can use the same bounded structural matcher on demand for compatibility; there is no text-offset fallback for `children` positions.
- `before` / `after` affinity is preserved unchanged. Ambiguous/invalid structural mapping returns `null` rather than redirecting a caret to a text-equivalent visual location.
- `text` positions continue through the existing `mapProjectedTextOffsetToSource()` path unchanged.
- The map continues to copy CORE's `sessionKey` and `documentRevision`; SEMANTICS allocates no revision and introduces no second revision system.

**Exact focused regressions added in `semantic-break-projection.test.ts`:**

1. `A<br><br>B`: directly exercises `mapA4ProjectedStructuralPoint()` for the boundary before BR1, between BR1/BR2, and after BR2 and asserts exact canonical child index plus affinity.
2. Two adjacent zero-text field/reference atomics: asserts the boundary between them remains index `1` and does not collapse before or after both.
3. `<br><span data-a4-break="page"></span><span data-field-id="x" contenteditable="false"></span>`: asserts both emitted `childBoundaries` and direct mapper results on each side of the semantic break, including exact canonical indices and affinity.
4. Empty paragraph plus empty table cell: asserts `children` index `0` remains exact through projection without inventing text offsets.
5. `Hello[semantic break]World`: asserts the existing text projection path still maps fragment text offset `2` to canonical text offset `7`.

The existing multiple nested-break / `start=5` / list-continuation proof remains unchanged and continues to cover the original S1 semantics. Legacy hard-break reading, nested C03 break representation, one canonical LI across a nested break, grapheme-safe deletion, stale-position rejection, `paginateFlowHtml` compatibility, runtime metadata stripping, and non-mutating unsupported cell-interior break insertion were not changed by this correction.

### Unsupported cases / explicit no-op boundaries

- Arbitrary page-break insertion inside a table cell is unsupported and returns typed `table-cell-interior-unsupported` with unchanged content.
- S1 does not promise split-cell or between-row manual-break authoring UI. Table row/cell runtime identity exists for structural mapping and soft pagination support only.
- Paragraph-break behavior inside `td`/`th` is left unchanged/browser-native until a table command contract is assigned.
- Full list Enter/backspace/indent/outdent/conversion/numbering command semantics are S2 scope and are not implemented here.
- No command infers destructive scope from rendered page count. A soft continuation is a projection and has no `delete page` mutation.
- The semantic v2 break command exists but activation remains behind the later CORE/WORKFLOW reader/writer capability gate.

### Remaining integration dependencies

- CORE C1/C2 must wire native editor input/key handling and commit the pure `A4TransactionResult` through CORE's single revision authority. SEMANTICS does not allocate revisions or wire DOM events.
- WORKFLOW W1 must consume the reader/pagination APIs, apply its persistence/output capability gate and regenerate the generated browser pagination bundle after S1 integration.
- FIELDS remains owner of durable C05 field identity/parser/registry behavior. S1 only treats field/reference-like DOM nodes as atomic runtime structural nodes; runtime flow IDs are not durable field IDs.
- The C04 structural projection map now retains exact child-boundary bindings as well as the existing source text ranges, with the same CORE-owned session/revision identity.

### Stop boundary

The narrow CORE C02/C04 correction is complete within the SEMANTICS S1 lease. No CORE, FIELDS, WORKFLOW or generated-bundle file was edited by this correction. S2 and S3 have **not started**. PR #36 remains unmerged for CORE re-review.

SEMANTICS state: **READY FOR RE-REVIEW — S1 only**

---

## SEMANTICS-S1-G1-CORRECTION-20260912-01

Role and packet: SEMANTICS / S1 corrective owner for blocked G1 only
Integrated G1 baseline: `603f3a25d168435b56709ef9c2c2e8cdda9af737`
Contract: **v1 frozen at G0**; no contract widening
Branch: `codex/a4-editor-semantics-s1-g1-correction`
PR: `#40`
Correction code head before this handoff update: `12e105e72861ecfd371c340fef90e7a8f8a76995`
Scope boundary: **S1 G1 correction only; no S2 / Stage-2 work**

### Corrective scope and root cause

1. **Reverse selected-range deletion**
   - The C02 normalization logic already ordered forward and reverse selections correctly. The defect occurred after the normalized DOM `Range` was deleted: `deleteA4Selection()` and the shared selected-range collapse helper used the browser-mutated `Range.startContainer/startOffset` as the resulting caret.
   - Cross-block deletion can detach or relocate that DOM boundary even though the original normalized logical start remains valid. `finishApplied()` then correctly failed closed because it could not capture the detached point, which surfaced as `status: "rejected"` for the reverse regression.
   - The correction retains the normalized `A4Position` start in `ResolvedSelection`, deletes only the normalized range, and resolves that logical start against the mutated canonical root before producing the collapsed result selection. If that logical position is genuinely no longer resolvable, the command still rejects. No stale/session/revision validation was weakened.

2. **List-item Enter `<br>` metadata discrepancy**
   - S1 had widened generic `hydrateFlowContainer()` runtime identity assignment to include nested `<br>` elements. Legacy/public `document-actions` uses that generic hydrator, so the empty list-item placeholder created as canonical `<p><br></p>` was returned as `<p><br data-flow-id="…"></p>`.
   - `data-flow-id` on a `<br>` is required for exact zero-text C02 structural/runtime mapping, but it is projection/editor identity rather than persisted/public canonical authority. The correct boundary is to keep `<br>` identity in `hydrateA4RuntimeIdentity()` / `STRUCTURAL_IDENTITY_SELECTOR`, which is the structural runtime path, and stop assigning it from the generic legacy/public flow hydrator.
   - `stripFlowMetadata()` remains unchanged and still strips all runtime flow metadata at persistence. Structural `<br>` identity, child-boundary distinction, semantic break mapping and runtime affinity remain available because the S-owned structural hydrator still explicitly includes `br`.

### Files changed

- `src/components/documents/a4-pagination/structural-commands.ts` — retain normalized logical range start and restore the result caret from it after selected-range deletion.
- `src/components/documents/a4-pagination/model.ts` — remove only `br` from the generic runtime identity selector; structural runtime hydration continues to own BR identity.
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/semantics.md` — this corrective evidence and CORE handoff.

No CORE editor/session/history file, FIELDS file, WORKFLOW file, generated bundle, package/configuration, migration, deployment file or version was changed.

### G1 regression baseline and validation commands

Integrated G1 S1 result supplied by CORE for baseline `603f3a25d168435b56709ef9c2c2e8cdda9af737`:

```text
__tests__/components/a4-pagination
171 tests total
169 passed
2 failed
```

The two reported failures are the existing regressions:

```text
__tests__/components/a4-pagination/structural-commands.test.ts
A4 S1 structural commands > deletes only a reverse selected range and preserves unselected siblings

__tests__/components/a4-pagination/document-actions.test.ts
A4 canonical document actions > Enter inside list items > creates an empty second item when Enter is pressed at the end
```

Required Node 24 commands:

```text
npx vitest run __tests__/components/a4-pagination --reporter=verbose

npx vitest run --config vitest.browser.config.ts \
  __tests__/browser/a4-boundary-semantics.browser.test.tsx \
  --reporter=verbose
```

Result in this execution environment:

```text
NOT EXECUTED — environment/tooling limitation, not represented as a pass.
```

The available execution container is Node `v22.16.0`, has no executable repository checkout/dependencies, and cannot resolve `github.com`. The authenticated GitHub connector can read/write the repository but cannot execute arbitrary repository commands. The existing `Node 24 compatibility` workflow provisions Node 24 but does not run either mandatory S1 Vitest command and exposes no ad-hoc command input. SEMANTICS ownership excludes changing workflow/package/configuration files merely to manufacture this evidence, so no such change was made.

PR #40 triggers the repository's existing Node 24 static/build workflow. Those checks are supplemental and are not substituted for the two required G1 test commands. CORE must execute the exact commands above when re-integrating/re-running G1.

### Preservation review

Static review of the correction confirms:

- forward/reverse selection ordering remains entirely in `normalizeA4SelectionRange()`; the correction consumes its normalized `start` and does not introduce direction-specific deletion logic;
- stale/session/change-map rejection paths are unchanged;
- manual semantic break insertion/removal and nested v2 mapping code are unchanged;
- `STRUCTURAL_IDENTITY_SELECTOR` and `STRUCTURAL_BOUNDARY_SELECTOR` still explicitly include `br`, preserving zero-text child positions and before/after affinity in C02 runtime mapping;
- legacy/v2 readers, grapheme deletion, structural pagination and persistence metadata stripping are unchanged;
- SEMANTICS still consumes CORE `sessionKey` / `documentRevision` and introduces no revision counter, session authority, editor history ownership or database revision logic.

### Remaining risks / untested evidence

- The two mandatory Node 24 Vitest commands have not been executable from this environment. Their final pass/fail counts remain required CORE re-integration evidence; no pass is claimed here.
- The existing repository Node 24 workflow does not cover the S1 component directory or the boundary-semantics browser file. A green workflow therefore cannot by itself close G1.
- `coordination/g1.md` was requested by the corrective prompt but is not present at the integrated baseline/current `main` through the available repository API; the exact two G1 failures supplied by CORE in the corrective assignment were used as the blocker record. No replacement G1 authority file was invented by SEMANTICS.

### Handoff to CORE

PR #40 contains only the S1 corrections above and must not be merged by SEMANTICS. CORE should re-integrate the PR head, run the exact Node 24 S1 component and boundary browser commands, then decide whether G1 is cleared. SEMANTICS does not mark G1 passed or frozen.

**READY FOR CORE RE-INTEGRATION — S1 G1 CORRECTION ONLY**

---

## SEMANTICS-S2-20260912-01

Role / packet: **SEMANTICS / S2 — list, Enter, indent, numbering and formatting correctness**
Assignment: `SEMANTICS-S2-20260912-01`
Starting merged-main SHA: `6f1ab8d3cb90056c556771936f4c763d9596efdf`
Programme-recorded G1 source baseline consumed as historical reference: `ad7285ace280f0b4002f119f923a8e2166b9475f`
Working branch / PR: `codex/a4-editor-semantics-s2` / `#43`
Frozen contract consumed: **v1 frozen at G0 — unchanged**
Gate prerequisite: **G1 FROZEN/PASSED**
Scope boundary: **S2 only; no C2/F2/W2/S3, deployment, version bump, or merge to main**

### S2 implementation completed

- Added pure `s2-semantics.ts` transactions on `CanonicalEditorDocument + A4Selection`; no React state, event listener, history stack, focus side effect, revision allocation or physical-page canonical state is introduced.
- Enter semantics now split ordinary/list blocks in logical DOM order, retain paragraph formatting, change a heading-end Enter to body text, preserve a mid-heading split, retain nested descendants exactly once, preserve authored blank paragraphs, lift an empty nested item one list level and exit an empty top-level item without corrupting ordered values.
- Enter rejects a split inside a Unicode grapheme cluster and keeps S1 semantic hard-break nodes on the correct logical side of the split.
- List indent/outdent changes semantic nesting level instead of `margin-left`; impossible first-item indent and outermost outdent are reported as capabilities/no-ops. Multi-item operations retain document order.
- Explicit list-type conversion operates on selected whole logical items, keeps nested descendants attached, preserves meaningful ordered/alpha marker attributes and right-side ordered starts, and deliberately removes incompatible `li[value]` state when the converted target is unordered.
- Paragraph-to-list conversion joins a compatible previous list, next list, or both without reversing selected paragraphs. Ordered bridging preserves start/continuation compatibility rather than treating visual adjacency as authority.
- Ordered restart can split at a selected item and intentionally override a selected `li[value]`. Explicit Continue numbering searches the previous compatible ordered sequence at the same structural level, sets the current list's semantic start and preserves intervening paragraphs / hard-break nodes rather than merging independent canonical lists.
- Paragraph indent normalization correctly distinguishes `rem`, `em` and `px`, uses supplied measured font/root-size context, preserves unsupported legacy expressions unchanged, and rejects an indent step past the measured usable width.
- Mixed formatting state is exported per property so a mixed bold state does not erase uniform italic/color state. Existing selected-range formatting is regression-covered for turning bold off while preserving italic/color and unselected outside bold.
- Collapsed Clear formatting is represented by `getA4S2NeutralTypingFormatPatch()`. CORE owns the typing-mark store and must consume this neutral patch rather than asking SEMANTICS to fake a zero-width DOM clear.

### Exact S2 production exports for CORE C2

`src/components/documents/a4-pagination/s2-semantics.ts`:

- `insertA4S2ParagraphBreak(canonical, selection)`
- `getA4S2ListIndentCapability(canonical, selection, direction)`
- `indentA4S2ListItems(canonical, selection)`
- `outdentA4S2ListItems(canonical, selection)`
- `applyA4S2Indent(canonical, selection, direction, metrics)`
- `setA4S2ListType(canonical, selection, type)`
- `restartA4S2OrderedListAtSelection(canonical, selection, start)`
- `getA4S2ContinueNumberingCapability(canonical, selection)`
- `continueA4S2OrderedList(canonical, selection)`
- `normalizeA4S2IndentValue(current, direction, metrics)`
- `readA4S2FormattingState(canonical, selection)`
- `getA4S2NeutralTypingFormatPatch()`
- `A4S2ListType`, `A4S2IndentDirection`, `A4S2Capability`, `A4S2IndentMetrics`, `A4S2IndentValueResult`, `A4S2UniformValue`, `A4S2FormattingState`.

### Required CORE C2 adapter/wiring

CORE remains the only native input/revision/history authority. C2 should wire the exports above as follows without duplicating them:

1. Map the current native rendered selection through the existing C1/S1 structural position bridge and validate the current CORE revision before invoking an S2 transaction.
2. Route Enter on assigned non-table paragraph/list contexts to `insertA4S2ParagraphBreak` and commit an applied result exactly once through CORE's canonical commit/history path.
3. Route Tab / Shift+Tab and toolbar indent/outdent through the same `applyA4S2Indent` transaction. For ordinary paragraphs, supply measured `emPx`, root `remPx` and current usable text width; list selections use semantic level changes through the same API.
4. Route explicit OL/UL/alpha toolbar conversion to `setA4S2ListType`, restart-numbering UI to `restartA4S2OrderedListAtSelection`, and Continue numbering only when `getA4S2ContinueNumberingCapability().applicable` is true.
5. Use `readA4S2FormattingState` for per-property mixed/uniform toolbar state. For collapsed Clear, apply `getA4S2NeutralTypingFormatPatch()` to CORE's existing typing-mark state. For a selected range, retain the existing S-owned range-formatting transaction; do not convert collapsed Clear into a DOM mutation.
6. One native user action must create one CORE history entry/revision commit. S2 returns pure `A4TransactionResult` only and must never allocate its own revision.

### Regression coverage authored

New component suites:

```text
__tests__/components/a4-pagination/s2-semantics.test.ts
24 S2 cases

__tests__/components/a4-pagination/s2-list-formatting-regressions.test.ts
4 S2 cases
```

Existing S-owned native browser suite extended in place:

```text
__tests__/browser/a4-boundary-semantics.browser.test.tsx
5 new S2 browser cases
```

The native cases use actual `window.getSelection()` capture and cover backward paragraph-to-list conversion, Enter splitting, adjacent multi-item indent, explicit numbering continuation across an authored hard break, and per-property mixed formatting state.

### Exact validation commands

Required focused Node 24 commands:

```text
npx vitest run \
  __tests__/components/a4-pagination/s2-semantics.test.ts \
  __tests__/components/a4-pagination/s2-list-formatting-regressions.test.ts \
  __tests__/components/a4-pagination/structural-position.test.ts \
  __tests__/components/a4-pagination/structural-commands.test.ts \
  __tests__/components/a4-pagination/semantic-break-projection.test.ts \
  __tests__/components/a4-pagination/formatting.test.ts \
  --reporter=verbose

npx vitest run --config vitest.browser.config.ts \
  __tests__/browser/a4-boundary-semantics.browser.test.tsx \
  --reporter=verbose

npm run lint
npm run typecheck
npm run build
```

Direct focused Vitest execution from this worker environment is **BLOCKED, not claimed as pass or failure**: the available container is Node `v22.16.0`, has no repository checkout/dependencies, cannot resolve GitHub, and the authenticated repository connector cannot execute arbitrary commands. SEMANTICS did not edit I-owned workflow/package/configuration files to bypass that lease. The existing `Node 24 compatibility` PR workflow is supplemental static/build/production-Chromium evidence only; it does not execute the focused S2 component/browser commands above.

### Compatibility impact

- Frozen v1 C02/C03/C04/C09 semantics remain unchanged; `CanonicalEditorDocument` still has no revision/session field.
- No CORE, FIELDS or WORKFLOW production file was edited.
- No package/lock/configuration, database, generated pagination bundle, application version, deployment or feature-gate change is included.
- Legacy independent ordered lists remain independent until the explicit Continue numbering command is applied. An authored hard break remains semantic document content and is preserved by Continue numbering.
- Existing S1 runtime IDs and hard-break representation are consumed; new S2 commands operate on the unsplit canonical tree and do not promote physical page fragments into canonical state.
- Table-cell paragraph splitting remains outside the S2 list contract and returns unchanged from the new Enter command; S1 table/break support boundaries remain intact.

### Blocked evidence / remaining risks

- The two mandatory focused Node 24 Vitest invocations require an authorized Node 24 checkout/runner. A green repository compatibility workflow must not be misreported as those tests having run.
- CORE C2 wiring is still required for Enter/Tab/Shift+Tab/toolbar dispatch, one-history-entry semantics, measured indent metrics and collapsed typing-mark Clear behavior. SEMANTICS intentionally did not edit CORE files.
- WORKFLOW output remains responsible for final HTML/PDF compatibility. S2 preserves semantic `ol[start]` plus the existing `--list-start` mirror; final PDF rendering evidence belongs to the W2/integration output gate.
- Browser-native regressions are authored in the existing S-owned browser suite, but no browser pass count is claimed until that exact suite executes on Node 24/Playwright Chromium.

### Stop boundary

Implementation is complete within the SEMANTICS S2 lease and PR #43 remains unmerged. No S3 work has started.

**READY FOR INTEGRATION — S2 ONLY, with focused Node 24/browser execution evidence explicitly pending the authorized integration runner.**
