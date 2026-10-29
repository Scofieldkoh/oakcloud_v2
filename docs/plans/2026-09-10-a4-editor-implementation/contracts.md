# Shared A4Editor implementation contracts

Status: **proposed contract v1 for implementation**. These types/APIs do not yet exist. All agents read this document before writing production code. I owns contract changes; producers listed below own implementations. G0 may refine names or the codec only with fixture evidence and a published change to all consumers.

Read the [programme](README.md) and [review architecture/behavior](../2026-09-10-a4-editor-technical-ux-review.md). The central constraint is one canonical document with derived physical pages. HTML and existing service boundaries remain the integration format.

## C01 — Session identity, revision and immutable snapshot

**Producer:** CORE. **Consumers:** S, F, W. Proposed home: `src/components/documents/a4-pagination/editor-session.ts` (CORE-owned exception within this directory), or an equivalent module agreed at G0.

```ts
type EditorSessionKey = string; // stable for one document/draft; never a page ID
type EditorRevision = number;   // local monotonic edit revision, not DB version

interface A4EditorSnapshot {
  sessionKey: EditorSessionKey;
  revision: EditorRevision;
  content: string;                    // canonical persisted HTML, no view markup
  contentJson: Record<string, unknown>; // preserve unrelated existing keys
  fields?: readonly StoredFieldDefinition[]; // F exports this lossless type
}

type SnapshotResult =
  | { ok: true; snapshot: A4EditorSnapshot }
  | { ok: false; reason: 'composition-active' | 'unreconciled-input'; message: string };
```

The session owner holds canonical content with internal identities, current selection, typing marks, history and metadata as one revisioned state. `getSnapshot()` is synchronous when no composition/reconciliation is pending; it never waits for pagination. `prepareSnapshot()` may wait for an active composition to settle and otherwise returns a typed recoverable result. Do not claim incomplete composed text is saved.

Add explicit `sessionKey`, `initialContentJson`, field-definition initialization and `onSnapshotChange` integration hooks as needed. Preserve existing `value`, `onChange`, `layout`, `onLayoutChange` and ref callers through adapters during rollout. `getContent()` returns current canonical content; `setContent()` is implemented as explicit replace-document intent with a chosen history policy, not a second write path.

Controlled echoes never create edits or reset history. W supplies identity such as `template:<id>`, `partial:<id>`, `document:<id>` or `batch-item:<stable item key>`; unsaved entities use one stable ID for their editing lifetime. A server-assigned ID after creation must not discard that session's pending edits. Revision does not reset merely because the physical page count changes.

History entries contain before/after content, relevant metadata/fields, structural selection and typing marks. Selection-only moves and reflow do not increment content revision. Field/layout changes that affect output do increment it. History never crosses sessions. Typing groups may coalesce without coalescing distinct paste, field, break or structural commands.

## C02 — Structural positions and transaction result

**Producer:** S for position/commands; CORE for dispatch/history. **Consumers:** F and W via editor API.

```ts
type A4Position =
  | { kind: 'text'; nodeId: string; offset: number; affinity: 'before' | 'after' }
  | { kind: 'children'; nodeId: string; index: number; affinity: 'before' | 'after' };
interface A4Selection { anchor: A4Position; focus: A4Position; }

type A4TransactionResult =
  | { status: 'applied'; document: CanonicalEditorDocument;
      selection: A4Selection; changedNodeIds: readonly string[] }
  | { status: 'unchanged'; reason: string }
  | { status: 'rejected'; code: string; message: string };
```

`CanonicalEditorDocument` is an HTML-backed tree/snapshot abstraction with internal semantic IDs; it is not a proposal to persist a second rich-text JSON tree. S and CORE agree the adapter to existing `DocumentTransactionResult` during G0. All commands preserve unknown supported attributes according to C06.

Text offsets follow DOM UTF-16 conventions at the adapter boundary, but delete commands move over grapheme boundaries. Child positions distinguish before/after breaks, fields, `<br>`, empty blocks and cells. IDs distinguish real nodes; only view fragments share a mapping to one real node. Position mapping includes source revision and never silently falls back to the end of another page.

A transaction is checked against `(sessionKey, baseRevision)`. Stale commands are mapped using retained change maps when provably valid, otherwise rejected with content unchanged and selection recovery guidance. Pure commands must not inspect React pages, call focus, perform fetches or log document text.

## C03 — Manual breaks, list identity and format compatibility

**Producer:** S. **Consumers:** CORE, F content policy, W persistence/output. **Decision:** use a semantic hard-break marker inside the canonical HTML tree; retain the old top-level marker for compatible block boundaries.

Legacy block boundary remains:

```html
<div class="page-break" data-break-type="hard"></div>
```

Proposed v2 marker for a break inside a paragraph/list item is:

```html
<ol start="5"><li><p>Before<span data-a4-break="page"></span>After</p></li></ol>
```

This intentionally keeps **one logical list item**. It does not create two unrelated OL/LI trees or persist measured counter offsets. The empty span is structural, non-editable in the rendered editing projection, and its marker attribute is allowlisted explicitly. It contains no user text. Ordinary top-level breaks continue to serialize in v1 form when possible; the parser treats both forms as the same break intent at their respective logical positions.

S must prove at G0 that a tree-aware partition/projection algorithm preserves ancestor structure, numbering and source positions for this marker, including nested lists and inline marks. Never extend the old string splitter to cut invalid nested HTML. Between table rows, use an explicit break at a validated row boundary; arbitrary insertion inside a cell must either support a tested row-fragment contract or return a clear unsupported operation without modifying content. Do not promise split-row semantics in this milestone.

The canonical tree remains unsplit. Pagination produces display fragments with source-node/offset mapping, `hardBreakBefore` and continuation marker state. Removing the break removes one canonical marker and joins its projection; no duplicate IDs exist to confuse Backspace/Delete. A legacy pair of independent lists around a top-level break must **not** be guessed to be one list; preserve it unless the user explicitly continues numbering.

Detect v2 features from markup as well as optional `contentJson.a4Editor.schemaVersion = 2`. Keep outer `contentJson.version=1` and `layout.version=1` unchanged. `TemplatePartial` has no contentJson column, so feature detection cannot rely solely on metadata. If G0 disproves this codec, I records an alternative with the same one-item invariant before agents proceed; v2 writers remain disabled until all readers are compatible.

## C04 — Native input and pagination projection

**Producer:** CORE; S supplies projection/position mappings. **Consumers:** all editor surfaces.

Every native event is associated with the session and rendered revision at which its target range was captured. Normalize input intent before checking page location. Enter, Shift+Enter, deletion, paste, cut, formatting, field insertion and page breaks dispatch canonical transactions. Physical page IDs are view identities only.

For cancelable supported `beforeinput`, capture/map target ranges and prevent native mutation only after the intent is accepted for canonical processing. For composition and non-cancelable input, keep a bounded composition/native-edit session with the base document, affected logical range and latest DOM change; reconcile that delta into the current document. Never replace the whole document from stale page DOM. Do not repeatedly commit intermediate IME text as independent undo actions.

If a semantic transaction changes page structure before the next native event, the event adapter must still resolve against the last published projection plus change maps, or synchronously update the affected editable projection. G0/C1 must choose and prove this bridge; a two-frame delay or global read-only toggle is not acceptable.

A projection has `{sessionKey, documentRevision, layoutRevision, fontRevision, fragments, positionMap}`. Publish only if these revisions are still current. Pagination never changes canonical content/history. CORE exposes a deterministic final-test idle signal containing both current document and rendered revisions; `aria-busy` alone is not proof that the new document was rendered.

## C05 — Field identity, types, parsing and lifecycle

**Producer:** F. **Consumers:** CORE token decoration; W route/API/render integration; S position mapping.

Define a field by stable identity, owner scope, human label, immutable/default legacy key, resolver path, type, required/default rules, render mode and original stored metadata. Owner scope identifies template or partial ID; repeated uses of the same partial share its declared field unless an existing explicit binding says otherwise. Never form identity by concatenating names with underscores.

Legacy definitions without IDs receive a deterministic identity from their scoped key while loaded. Persist optional stable IDs only through a validator that preserves them. Duplicate labels may be allowed with source disambiguation; duplicate keys within a scope are not. Label rename never changes the key/path. Explicit key migration is one parsed transaction covering references, path, title-date field and linkings.

Parser output includes field/block/partial references, malformed syntax diagnostics, scope/binding and source locations. Client validation, generation and field discovery use the same supported grammar. Preserve supported loops, modifiers, attributes and service blocks. Spaces in simple syntax are either normalized by this parser or rejected consistently; formatting-split syntax must yield a diagnostic, not disappear from analysis.

Protected tokens are a **view decoration**: serialize their complete legacy expression, never chip label HTML, `contenteditable=false` wrappers or internal selection IDs. Token attributes are not a trusted way for pasted content to acquire access to a field. Formatting applies to the whole reference. Backspace/Delete at an adjacent token deletes it as one unit; Undo restores it.

Use a typed internal value union: text/multiline, ISO date, exact numeric/currency string, boolean, missing, and explicitly supported legacy structured types. Keep existing API string/unknown payloads through explicit adapters; do not globally coerce strings based on appearance. `false`, `0`, missing and empty are distinct. Unknown legacy types/metadata are preserved, with authoring restrictions if unsupported.

F exports lifecycle operations returning content + definitions + dependent metadata + diagnostic/usage changes as one transaction. CORE history records that complete change; W saves it atomically. W owns rendering typed batch forms but consumes F's input/validation descriptor contract.

## C06 — Supported content and resolved values

**Producer:** F for policy/parser; S for CSS/breaks; W and CORE for environment adapters. Proposed policy location: `src/lib/a4-content-policy.ts`; one implementation, no client/server copied lists.

Separate canonical schema, editor-only decoration and export projection schemas. Shared policy must preserve supported blockquote/caption/tfoot/scope/list-start structures and v2 breaks. Import preserves compatible legacy img/sup/sub or explicitly blocks a destructive save with a recovery path; it never silently removes meaningful content. Sanitization still rejects executable/unsafe markup. DOMPurify browser/server adapters may differ in setup, not document semantics.

Ordinary resolved field strings are inserted as text with HTML escaping. Intentional rich output is a distinct typed fragment produced only by canonical trusted builders/partials and sanitized through the shared policy. A client-supplied `renderMode` or token attribute cannot promote untrusted text to trusted HTML. Legacy HTML-valued fields require an inventoried, explicit compatibility mapping; unknown cases retain the original template/snapshot and block conversion rather than silently changing meaning.

Newline policy: multiline plain values retain line breaks in a canonical form understood by editor and print; no double conversion to `<br>` plus pre-wrapped newlines. Empty optional values do not remove neighboring authored text or whole paragraphs automatically. Required validation uses typed values and field labels.

## C07 — Save, revision conflict and draft contracts

**Producer:** W; CORE supplies C01 snapshot. A local editor revision and a database revision are different numbers.

Template/partial persistence uses their existing `version` for compare-and-swap. GeneratedDocument needs an explicit integer revision (proposed `revision Int @default(0)` with mapped column if conventions require); do not reuse `templateVersion`, which records generation provenance. Batch keeps its existing revision.

Add an `expectedRevision` API input and an additive acknowledged revision response without removing existing response fields. Write with a predicate containing ID, tenant, deleted state, expected revision and editable status where applicable. Increment revision in the same database write/transaction. On a mismatch, return a typed conflict using the application's error convention (HTTP409); never perform an unchecked second write. Every writer that can change content/layout/title/letterhead or editing status must be inventoried and participate, including background/service writers. Template existing version behavior is preserved.

W coordinates the additive migration/reader deployment before clients require the new contract. Once enforcement is enabled, missing preconditions receive a recoverable reload/upgrade response (HTTP428 or the repository's documented equivalent). Optional preconditions are transitional compatibility only, not a declaration that old clients are protected against lost updates.

Client save captures snapshot N and expected server revision R. Only that snapshot is acknowledged on success. If the user has moved to N+1, remain dirty and retain N+1; do not navigate away or replace local state with N. A subsequent save uses returned server revision R+1 with the newer snapshot. Keep one in-flight write per entity. A conflict must preserve a local copy and avoid automatic overwrite.

Draft metadata records base server revision, session identity and local snapshot revision using the existing draft model/API. Do not impose a new uniqueness constraint or delete all drafts as a shortcut. Recover/discard only the relevant user's/document's draft. Restore against a newer server revision requires reconciliation guidance, not silent overwrite. Finalized/archived content remains protected.

## C08 — Metadata merge and preview identity

**Producer:** W; F supplies fields/diagnostics; CORE supplies snapshot. Use `mergeA4DocumentLayout`, preserving unrelated keys. Content-only edits never send null metadata as an implicit reset. Active batch layout prefers `editedContentJson`, then template metadata/defaults.

Preview request carries the complete unsaved snapshot plus sample/context selection and a client request identity. Use the canonical render service through a thin adapter, including unsaved field definitions/defaults/composition as explicitly supported input; do not persist unsaved preview data merely to render it. Return content, typed diagnostics/source locations and the request/snapshot identity.

Display a result only when its session, content/layout/fields revision and context identity match the request still current. Keep batch server fingerprints authoritative for generation review; client preview IDs do not replace them. Manual edits invalidate review as today. Template preview visibly identifies sample values, missing values and stale/error states.

## C09 — Output and pagination success

**Producer:** W; S shared engine/CSS/font geometry; CORE local-print adapter.

All outputs consume canonical content through C06 and C03, then a revision-consistent pagination result. PDF font readiness precedes measurement. A successful result must retain all intended text/fields and explicit breaks; output failure cannot return a clipped fixed-height fallback as success. Preserve draft watermark/letterhead semantics and verify their reserved space.

Local print calls a shared page-assembly contract; it does not delete arbitrary elements with break CSS. Page numbers are a document setting only if persisted and honored everywhere. Proposed additive `contentJson.a4Editor.pageNumbers` defaults to current server behavior (true); expose it only after every output consumes it. Existing layout versions remain unchanged.

W regenerates the checked-in pagination bundle through the existing script after S changes are integrated. I adds a reproducible freshness check. Do not hand-edit the generated bundle. A reader-only rollout must include export workers, static assets and print adapters, not just the API server.

## C10 — Error and capability presentation

**Producer:** each domain owner; CORE/W/F render their surfaces. Errors carry stable code, human message, recoverable action and optional non-sensitive correlation ID. Diagnostics also carry scoped field/source position when known. No raw content, credentials or internal database identifiers in user-visible errors/logging.

Commands expose applicability, pressed/mixed state and reason when disabled. Unsupported operation leaves content unchanged. Busy reflow differs from unsupported command and from unsaved content. “Saved” means the current snapshot is acknowledged; “Draft saved” is distinct.

Introduce deployment capability negotiation through the existing route/read contract or existing feature configuration after W0 inventory: reader format level, allowed writer level, revision requirement. These capabilities are proposed, not existing flags. Both server validation and client writer obey them. Unsupported newer content opens read-only with a preservation/recovery action; an old writer must not silently sanitize and overwrite it.

## Contract freeze checklist (G0)

- [ ] CORE/S agree position, transaction, projection and native-event revision interfaces in executable fixtures.
- [ ] S proves the v2 nested-break codec without duplicate semantic nodes or list markers.
- [ ] F publishes parser/type/policy fixtures, including field scope and unknown metadata.
- [ ] W inventories all writers/readers and supplies a concrete capability/migration design.
- [ ] I records actual module names/signatures and one common baseline; all workers acknowledge it.
- [ ] No production v2 writer, strict new validation or changed escaping policy is enabled before its reader/compatibility gate.
