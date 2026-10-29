# OakDoc replacement specification and A4 retirement readiness

> **Status (29 September 2026): historical record.** The replacement shipped in PRs #62-#66: OakDoc is the only editor and the A4 editor is retired (A4 content is read-only). Current behaviour is described in [ARCHITECTURE.md](./ARCHITECTURE.md#document-editor-oakdoc). Gap, packet and gate tables below record the plan as written on 26 September and are not a live defect list.

Reviewed: **26 September 2026**. Source baseline: `6aa660a9` (`Show generated OakDoc inline`), reconciled after the initial review of `abaa5589`. Status: **replacement approved; implementation specification; release gates not yet met**.

The user completed the OakDoc POC and selected it to completely replace A4Editor. This document owns target behavior, the gap register, contracts and acceptance requirements. The [parallel implementation handover](plans/2026-09-26-oakdoc-replacement-implementation.md) owns task order, file ownership and sub-agent dispatch.

This review inspected repository code, tests and installed `@docx-editor.dev/core` / `react` **2.21.1**. It did not run application tests, inspect production tenant inventories or independently repeat the user's POC. Findings are static observations, not newly reproduced production incidents. Existing suites are starting evidence, not claims of passing results. The workspace was initially clean; Node reported `v24.21.0`.

## 1. Decisions and scope

| ID | Decision | Status / consequence |
| --- | --- | --- |
| D01 | OakDoc is the sole editor for new templates, reusable document blocks and generated documents. | User confirmed. Do not resume the September A4 editor rewrite. |
| D02 | Reuse Microsoft 365 Word-to-PDF conversion. | User confirmed on 26 September. Extend the existing Graph converter; no new provider. A usable SharePoint/OneDrive connector is a workspace PDF/signing release prerequisite. |
| D03 | Preserve finalized, signed and archived records and original provenance. | Required preservation invariant. Replacement does not authorize rewriting historical business records. |
| D04 | Existing A4 drafts become reviewed OakDoc copies on next edit, retaining the original snapshot. | Confirmed by the owner on 2026-09-26. See section 8.4. P8/M2 own conversion; U1/L1/I2 must coordinate routing and relationship contracts if policy changes. |
| D05 | Preserve fields, explicit parties, conditions/repeaters, partials, Service Agreements, task launches, comments, AI-assisted authoring, recovery, PDF, signing and filing. | Default scope of complete replacement; no silent omission of live features absent from the POC. |
| D06 | DOCX is canonical for OakDoc; HTML export remains historical-A4-only. | Planned contract: explicit unsupported-capability response for OakDoc HTML requests, with DOCX/PDF alternatives. |
| D07 | Native section layout and headers/footers are authoritative; Oakcloud letterhead is an explicit generation option. | Planned contract in section 6.2; no duplicate PDF overlay. |

Complete replacement means all operational authoring/generation uses OakDoc and no route mounts or imports A4PageEditor. Historical A4 content may retain a narrowly scoped read-only renderer/exporter until verified archives cover those records. This compatibility code is not an alternative editor and needs an explicit import allowlist. Do not delete every `a4`-named file: fonts, XML helpers and historical output utilities still have consumers.

Out of scope: rebuilding the editor engine, universal lossless HTML-to-Word conversion, new collaboration/track-changes features, redesigning signing/billing, changing retention policy, new Business Assistant capabilities, and replacing unrelated rich-text inputs. Preserve the template workflow's direct `AISidebar` integration. The separately exported `DocumentEditorWithAI` has no live caller found here and need not become a second native host.

## 2. Implemented baseline and remaining work

The previous Stage 7 document predates server generation and batch editing. Extend these capabilities instead of reimplementing them.

| Area | Existing foundation | Remaining work |
| --- | --- | --- |
| Editor | [oakdoc-editor.tsx](../src/components/documents/oakdoc-editor.tsx): import/edit/save/download, fields/conditions/repeaters, section-delete guard | Shared host, revision-safe save/recovery, metadata/field parity, canonical preview/navigation |
| Template assets | [oakdoc-template.service.ts](../src/services/oakdoc-template.service.ts): immutable assets, hashes, multipart CRUD, expected versions | Full metadata writes, server manifest, duplicate authority reset, package validation |
| Semantics | `src/lib/document-editor/oakdoc-{fields,context,schema,conditions,block-conditions,repeaters,generic-repeaters,signatures}.ts` | One supported schema/resolver across authoring, preview, generation and migration |
| Generation | [oakdoc-generation.service.ts](../src/services/oakdoc-generation.service.ts), native dispatch in `document-generation-batch/generation.service.ts` | Complete context/composition, standalone create dispatch, diagnostics, exact source-version reads |
| Batch review | `document-generation-batch/{preview.service,oakdoc-draft.service,generation.service}.ts`; `generation-batch/{oakdoc-review-editor,batch-review-workspace}.tsx` | Shared guarded host, concurrency/recovery, completeness and standalone reuse |
| Standalone native view/save | `oakdoc-generated-document-editor.tsx`, generated detail page, `saveGeneratedOakDocDocument`, `PUT /api/generated-documents/:id?format=docx` added in `6aa660a9` | Consolidate third host; save acknowledgement, recovery, direct edit route and complete lifecycle |
| Service Agreement | [oakdoc-renderer.ts](../src/services/service-agreement/oakdoc-renderer.ts), native seed master | Production caller, native clauses/partials, agreement snapshots and signer semantics |
| Engine | [document-engine.ts](../src/lib/document-editor/document-engine.ts) | Invalid-metadata state; operation/status/workspace-aware capabilities |
| Output | DOCX download; [Graph converter](../src/services/microsoft-graph-document-conversion.service.ts) used for Word signing uploads | Native PDF service, rendition provenance, bulk/signing/filing integration |
| Migration | `oakdoc-{migration,template-migration,consolidated-migration}.service.ts`, semantic/package diagnostics | Trusted evidence, deterministic routing, full inventory, scoped dry-run/apply/rollback |

### Gap register

Blocker means required before the affected cutover gate. Packet IDs are defined in the handover.

| ID | Static finding and effect | Owner / priority | Required evidence |
| --- | --- | --- | --- |
| G01 | Template editor reloads submitted bytes/clears dirty after save while editing remains possible. Batch and new standalone hosts also clear dirty on save and lack the section-delete guard. | E1, blocker | Later edits survive save; all three hosts pass delete/undo/reopen tests. |
| G02 | POC lacks composition type, custom fields/linking, title-date/folder settings, blank creation and full test UI. Multipart API exposes reduced metadata. | S1/E2/L1, blocker | Full manifest/settings round-trip; old links route to native authoring. |
| G03 | Client Generate copy has separate context/allowlist. Offered repeaters may receive absent arrays; server generation omits Stage 4 inputs. `oakdoc-schema.ts` excludes arbitrary `custom.*`. | S1/L2, blocker | Canonical context; unavailable required data cannot silently remove content. |
| G04 | Native agreement renderer has no production caller; it bridges HTML SOW snapshots through a limited converter. | S2/L2, blocker | Real generation preserves clauses, fees, entity associations and signer roles. |
| G05 | Detail now has native inline view/save, but the separate edit URL still mounts A4 for a draft. Capability helper still reports inline edit false. Recovery and shared-host lifecycle remain incomplete. | U1, blocker | Direct-link/native view/edit and lifecycle parity; reuse the new implementation. |
| G06 | HTTP PDF route rejects OakDoc, but `exportToPDF` treats all documents as HTML. Bulk/e-sign service callers can consume sentinel HTML. HTML export lacks the same boundary. | O1, blocker | No placeholder output from any caller. |
| G07 | Finalization checks legacy arrays, not nested `oakDocGenerated.unresolvedTags`; native batch blockers are narrower. | L2, blocker | Invalid actual reviewed bytes block finalize/signing. |
| G08 | Generic updates accept metadata/contentJson controlling asset/engine authority; invalid OakDoc falls back to A4. Clone copies an asset scoped to the old ID. | C0/L1, blocker | No forged/demoted engine; independent valid clone assets. |
| G09 | Materialization, preview, batch save and new standalone `saveGeneratedOakDocDocument` catch scopes include post-commit work; audit/catalogue failure can delete the committed asset. | L1, blocker | Fault injection for each writer preserves committed bytes and retry/readback. |
| G10 | Migration validation accepts caller `passed/issueCodes/checkedAt`; generic JSON can carry migration authority. | C0/M1, blocker | Only server-run evidence promotes a pair. |
| G11 | Missing versions bypass readiness; preference rollback rebases stale evidence; inactive/duplicate targets lack blockers. Deactivation increments the parity version. | M1, blocker | Invalid/stale pairs fail closed; metadata changes never revive stale passes. |
| G12 | Preferred resolver has no production caller. Task/pipeline/seed IDs remain legacy. CLI seeds a small set across workspaces without targeting/dry run. | M2/L2/I2, blocker | Full inventory, retained-ID routing and safe seed reruns. |
| G13 | No native partial storage/authoring contract; XML concatenation/plain text cannot preserve rich composition. | S2/E2, blocker | Partial version/style/numbering/media/dependency preservation. |
| G14 | Upload bounds selected XML; draft/transform paths unzip broadly. Limits and derived-tag trust differ. | C0/L1, blocker | Bounded validation before every untrusted transform/conversion. |
| G15 | No complete native browser/output/race/cutover evidence found. Parity is substring-based; empty requirements pass; agreement tests construct both sides from common lines. | Q1/Q2/M1, blocker | Real renderer and adversarial comparisons on integrated commits. |

## 3. Required user workflows

### 3.1 Templates and partials

Use existing management entry points. Preserve `?editor=oakdoc` and old editor deep links through routing during transition. The final UI has no engine selector. Support blank, import, duplicate, native partial and explicitly selected legacy migration sources. Preserve current activation defaults; invalid templates cannot generate. Migration targets remain excluded from primary routing until their separate readiness gate passes.

Retain name, description, category, active state, `compositionType`, `documentTitleDateFieldKey`, `placeholders`, SharePoint folder and unknown non-authoritative metadata. The server owns asset references/hashes, inspected tags, migration authority and validation evidence. Metadata-only saves must not replace bytes/drop settings; mutations use expected revisions.

One scoped manifest supplies fields, conditions, repeaters and signature controls. Reuse stable typed-field IDs, defaults, required/format/options/linking semantics and existing block-condition/repeater helpers. Preserve unsupported definitions for round-trip but block generation when used. Never derive trusted rich-content authority from client JSON. Multi-paragraph/row conditions use the existing block API.

Keep `AISidebar` through native insertion/replacement adapters with explicit user action and captured selection/revision. Safely translate supported HTML responses or use plain text; never paste raw OOXML or replace stale selections/protected controls. Preserve provider/permission boundaries; no autonomous AI mutations.

Save, import, switch workspace/template, refetch and internal navigation preserve work or offer save/discard/cancel. Tab close uses the browser's leave/stay warning plus recovery, not a custom three-button prompt. Reuse unsaved-navigation guards. Failed saves retain recoverable content; stale responses cannot reset another document. Reuse searchable/paginated company selection rather than the first-50 POC list. Follow the [Design Guideline](guides/DESIGN_GUIDELINE.md) for labels/status/focus/keyboard/responsiveness.

### 3.2 Generate, review and resume

The batch workspace remains canonical. Single generation, task launch, template test and Generate copy call one server render boundary. Select explicit company/directors/shareholder/contact/signers, typed values and agreement configuration, preview, edit DOCX, save/recover and finalize.

Preview identifies exact template version/hash and generation fingerprint. Missing required data, unknown controls, invalid repeaters/composition block continuation. Explicitly empty optional collections may render empty; unavailable required context cannot silently become `[]`.

Configuration changes invalidate edited preview and require explicit regeneration/discard handling. Finalize verified reviewed bytes, not freshly rendered template output. Batch switch/back/refresh/resume retains each item's revision/dirty/recovery state. Existing batches stay bound to recorded templates/assets; preference changes cannot silently replace their source.

### 3.3 Generated documents and downstream

Detail renders read-only OakDoc or verified PDF with native downloads; edit uses the shared host. Blank native documents may have no template. Engine checks apply to direct URLs too. Save/recovery/clone/finalize/unfinalize/archive/delete/comments/task links remain in existing services and preserve finalized/signed locks.

Clone creates a DRAFT with a new owned asset/source provenance and clears finalization/signature/recovery authority. Do not guess old offset comments onto new ranges: retain source revision/quote and show unanchored historical comments when needed.

Reuse envelope preparation, recipient checks, manual field placement, delivery, certificate/completion and filing. Pin placement PDF to DOCX revision/hash; edits invalidate stale preparation. Replacement introduces no automatic send, service activation or filing-policy changes.

## 4. Shared contracts before parallel implementation

These are proposed contracts, not APIs already implemented. Extend current readers/services; do not build another document repository.

### C01: engine and capabilities

Extend `document-engine.ts` to discriminate legacy A4, valid OakDoc and declared-but-invalid/unsupported native metadata. Missing all native markers may mean legacy; malformed native markers never fall back to A4. Retain v1 readers and additive versioned metadata.

Capabilities depend on engine, status, permission, converter readiness and rollout mode. UI describes availability; services enforce it. Server-reserved namespaces include `oakDoc`, `documentEngine`, `oakDocGenerated`, `oakDocReviewDraft`, `oakDocMigration`, seed provenance and new PDF/validation/provenance records. Generic JSON writes reject alterations to these while allowing authorized user metadata. A raw storage key/hash or client boolean is not ownership/readiness proof.

### C02: editor snapshot and acknowledgement

One host wraps `DocxEditor` for templates, partials and generated drafts. Inputs identify workspace, entity ID, persisted revision, asset hash, mode and manifest. Snapshot returns DOCX, `sessionKey`, `writerInstanceId`, monotonic `localRevision` and base persisted revision; finish IME composition before capturing a complete snapshot.

Save acknowledges only submitted bytes and form revision. Later edits stay visible/dirty; update known server revision without reloading old bytes. Ignore old-session responses. Ambiguous retries use operation identity to avoid duplicate saves/creation. New remote revisions present conflict/recovery instead of replacing dirty local state.

Extract the narrow POC section guard into this host; retain the [normal-delete investigation](debug/oakdoc-normal-delete-layout.md) behavior. Do not broadly intercept native editing. Commands use captured selection/native history. A new entity/session resets history; switching items never leaks undo state.

### C03: canonical render and manifest

Extend `generateOakDocBytes` with exact template ID/version/hash, composition, explicit party IDs, typed values and optional canonical agreement draft ID/revision. Trusted caller supplies tenant. Reuse `buildDocumentContext` and agreement normalization/resolution, adapting into existing native transforms.

Return bytes, actual template identity, context/partial/letterhead fingerprints, structured diagnostics, resolved counts, signature roles and preview fingerprint. Rendering does not persist/finalize/sign/send. Preview/test/materialize consume this result through established workflows.

One registry describes scalar fields, custom types, condition operands, repeater scopes, partial slots and signatures. Reconcile uploaded manifest against server inspection of supported Word parts, including headers/footers. Intended signature markers differ from unresolved merge controls.

Freeze tested transform order: exact immutable master/pinned partials; trusted context; structural composition; scoped conditions/repeaters with defined nesting; scalar resolution; letterhead composition; package/business validation. Fixtures cover nesting; agents cannot independently reorder transforms.

Preview freshness policy: freeze resolved context/dependencies in a server-owned preview snapshot; manual edits/finalization use it until explicit refresh. Source-data changes show freshness information and offer refresh, never silently re-resolve edits. Template, agreement or user configuration changes to the current batch invalidate preview. Finalization revalidates document/preview identity and business eligibility without overwriting frozen content.

### C04: persistence, revision and recovery

Continue template `contentJson.oakDoc`, generated `metadata.oakDocGenerated` and private storage. Sentinel `content` is never output. Downloads validate tenant/document prefix and SHA-256. Templates are immutable assets; duplicates may share a master until edited, but clear migration/link/evidence authority unless explicitly relinked.

Save sequence: authorize/validate; validate package; upload immutable asset; transactionally claim expected document/template and relevant batch revisions; persist metadata/domain links; commit; acknowledge. Pre-commit failure cleans only its unreferenced upload. After commit, no generic catch deletes the referenced asset. Audit is transactional or durably retriable; ambiguous failures support readback/idempotent retry.

Extend sequenced `DocumentDraft` recovery with native asset references, base revision, session/writer/local revision. Autosave does not advance canonical revision. Reject stale writes; old cleanup cannot delete newer recovery; preserve recovery when server revision changes. Define abandoned upload/recovery retention while retaining referenced history/finalized/signed assets. Audit current successful-replacement asset deletion against these rules.

Avoid the template two-read race: load/recheck an exact asset/version pair and record the identity actually rendered. Client fingerprint edits cannot make stale assets acceptable. Keep template version, document revision, batch revision and local revision distinct.

Use existing `ApiError` conventions. Freeze response DTOs in C0: stale preview/revision = 409; bad package/manifest/context = validation error; permission = 403; absent/cross-tenant = existing not-found contract; unavailable converter = 503 or existing capability-conflict contract. Safe detail reason codes identify recovery actions without exposing content or credentials.

### C05: package trust boundary

One validator runs before template import, edited draft save, migration, transformation and conversion. Enforce request-body limits before buffering entire uploads. Preserve compressed limits initially: masters 10 MiB, drafts 50 MiB. Proposed limits to freeze/test in C0: 100 MiB expanded total, 20 MiB/XML part, 5,000 entries, 100:1 expansion ratio and bounded XML depth/elements. Adjust with corpus evidence, not bypasses.

Reject encrypted/non-DOCX, ambiguous duplicate/path-traversal entries, broken required relationships, DTD/external entities, macro/executable embedded payloads and malformed XML. Supported hyperlinks require scheme checks; never fetch external data/image/template relationships. Unsupported meaningful content needs explicit repair, not silent stripping. Editor-core limits do not protect Oakcloud's pre-engine ZIP/XML transforms.

### C06: native reusable partials

Reuse `TemplatePartial` identity/version/tenancy and service-variant links. Add optional versioned native asset/manifest metadata through a forward Prisma migration; keep legacy `content` for reading/migration. Define native agreement clause snapshots in that schema decision. No separate fragment database.

Insert tagged partial references with stable ID/version and authoring preview. Generation pins dependency versions/hashes and expands into snapshots; later partial edits affect future generation only after the template explicitly updates its pinned reference. Existing generated documents never change. Detect missing/wrong-tenant/cyclic references and bound depth/expanded size.

Pinned versions must remain retrievable: `TemplatePartial.version` alone only identifies the current record. Store the server-verified immutable native asset/manifest reference in the template's dependency snapshot and the agreement item's native clause snapshot, including partial ID/version/hash. Retain those assets while referenced. Updating the current partial must not force old pinned templates to load the newest bytes. C0 freezes additive snapshot fields; clients cannot forge snapshot asset authority.

Merge styles, numbering, media, relationship IDs and OOXML IDs safely. Do not transplant document-level section properties from fragments. The existing HTML SOW bridge is a limited migration adapter, not general fidelity proof; rich clauses need native conversion/re-authoring and review. Operational unmigrated partials/variants block full cutover.

## 5. Generation and business parity

Preserve explicit parties (including multiple directors), contact lists, dates and typed custom values. Never substitute the company's first contact. Company-independent blank documents remain valid; company-required templates report the requirement before preview.

Wire `renderServiceAgreementOakDoc` through canonical generation with normalized draft/catalogue data. Preserve ordered services, negotiated overrides, fee/currency/rounding/tax terms, dates, entity associations, appendix and signers. Reuse snapshots/linking/finalization/completion activation. Document editing must not silently change billing/service activation data.

Fingerprints include template bytes/manifest, partial versions, frozen resolved context, explicit selections, agreement revision, custom values and letterhead identity/policy. Validate reviewed bytes at finalization; required fields/roles block even with nonempty sentinel content. Define structural requirements so allowed signatures do not appear as unresolved merge controls.

Template test (`/api/document-templates/:id/test`, `/render-test`) and generated preview/validate routes become engine-aware with native identity/diagnostics. Preserve HTML responses for legacy compatibility only; sentinel HTML is never an OakDoc preview.

## 6. PDF, print and downstream artifacts

### 6.1 Canonical output

`exportToPDF` is the single boundary for download, mixed bulk ZIP, envelope attachment and task preparation. Load by tenant, discriminate, verify bytes, then use `convertOfficeDocumentToPdfWithMicrosoftGraph`. Service guards precede PDF UI enablement. Keep isolated historical A4 output during compatibility.

Pin usable PDF artifacts to document ID/revision, DOCX SHA-256, provider/connector, output policy version, PDF SHA-256, page count and time. Cache by that identity, never across tenant/revision. Validate PDF pages with existing PDF tools, not just `%PDF`. Conversion does not finalize; recheck source revision/hash before envelope attachment.

Capability probe and actual connector selection must agree when SharePoint is unusable but OneDrive works. Add bounded timeout/abort, transient/throttling retry behavior, isolated temporary names and durable cleanup/reconciliation. Cleanup failures are observable without destroying local committed output or masking the primary error.

Microsoft 365 temporarily receives bytes in the configured workspace library as existing Word conversion does. This confirmed dependency needs no extra per-document prompt. Missing/unhealthy connector blocks PDF/signing; DOCX editing/download can remain available. No silent provider fallback or placeholder PDF.

### 6.2 Layout, letterhead and signatures

Native section page size/orientation/margins are authoritative. Reject incompatible legacy PDF query overrides instead of unreviewed reflow. `useLetterhead=false` preserves authored headers/footers. For true, generation composes a pinned Oakcloud letterhead; conflicting imported headers/footers require explicit template setup resolution. Bake policy into DOCX/fingerprint; never add A4 headers again during export. Unsupported letterhead configuration blocks instead of being ignored.

Retain existing manual signing-field placement. Structured controls preserve role/context; validate required roles/readable signing areas. Automatic marker-to-PDF-coordinate placement is not a proven existing capability and is not a replacement prerequisite unless separately requested. If implemented, prove repeated-name/wrapping/multiple-signer cases against final PDF. Machine markers must not leak into signed output.

Browser and Graph layout may differ. Final PDF review, signing preparation and print use canonical converted PDF. Verify pages, columns, tables/merged cells/repeated headers, images, lists, fonts, orientation and signer blocks; missing/clipped content blocks release. Preserve folder snapshots, signed PDF/certificate filing and idempotent retries. Conversion temporary upload is distinct from final filing.

## 7. Migration authority, inventory and routing

### 7.1 Inventory

Scope workspaces explicitly. Inventory all templates (active/inactive/deleted), partials/dependencies, agreement variants/overrides, assets/versions/hashes, generated drafts/finalized/archived records, recovery drafts, pending sessions/batches, task/published-pipeline IDs and converter readiness. Include custom templates, duplicate names and missing assets. Two seeded templates are not a complete inventory.

Each operational source needs a disposition: migrate/re-author with evidence; superseded by an identified approved native template; or explicitly no longer required. Inactive does not mean unused. Match stable tenant/source IDs, never names alone. Reports retain counts and unresolved blockers.

### 7.2 Evidence and state

Keep compatible labels: `NOT_MIGRATED`, `OAKDOC_DRAFT`, `PARITY_CHECK_FAILED`, `READY_FOR_SWITCHOVER`, `OAKDOC_PRIMARY`. Add blockers for missing/deleted source, inactive target, ambiguous pair, stale evidence, missing asset and pending disposition. Missing metadata never passes.

Replace self-reported passes with server-run validation of exact source/target assets and shared context. Evidence records run/checker/scenario IDs/hashes, definition identities, actor/time, diagnostics and artifact references. Visual/PDF/signing review is separate. Existing v1 asserted passes require revalidation.

Bind evidence to definition fingerprints: source HTML/fields/layout/partials and target DOCX/manifest/dependencies. Record versions still provide CAS/audit. Metadata-only changes retain evidence only when server recomputation proves unchanged definition. Content/partial/resolver changes invalidate. Preference toggles never refresh stale evidence. Output evidence also binds provider/policy/fixture version.

Strengthen substring checks: nonempty requirements, expected/forbidden content, order, multiplicity and field-to-entity/fee association. Use actual source renderers, not one helper constructing both sides. Correct amounts assigned to wrong entities, a missing duplicate signer and an extra clause must fail.

Authority stays server-reserved, with one target per `(tenantId, legacyTemplateId)`. Serialize link/preference changes per source and enforce uniqueness transactionally; duplicate claims block. If a dedicated constrained mapping table is necessary, C0 owns/justifies the migration; workers do not invent separate lookups.

### 7.3 Routing and rollout

Call `resolvePreferredMigratedTemplate` at new-generation selection, batch planning, direct-ID requests and task launch validation. Record requested source and actual target/version/hash; generated records reference the actual native template. Published task/pipeline snapshots remain immutable and resolve through mappings; new versions/seeds choose native IDs. Do not silently rebind existing batches.

Proposed workspace modes in the existing settings mechanism: `compatibility`, `oakdoc-primary`, `oakdoc-only`. Compatibility allows explicit legacy operation while migration is evaluated. Primary routes approved sources to valid targets; stale/broken mappings block rather than silently generate new A4. Oakdoc-only rejects legacy create/content-edit/generate at services, including old clients/scripts/restores/duplicates. Historical read/export remains allowed.

Implemented (PR #62, 2026-09-26): the owner chose to retire A4 for every workspace at once, so there is no per-workspace mode. Every service that would write A4 content refuses with reason `A4_EDITOR_RETIRED` (`src/lib/document-editor/a4-retirement.ts`); reading and exporting A4 records still works. Rollback is the previous application release, per 8.3.

Retain legacy records through rollback. Do not simply deactivate after validation: current version checks/task validation break. Redirect operational use first; final deactivation is fingerprint-aware/audited. C0 freezes settings/transaction semantics.

## 8. Operations, history and rollback

### 8.1 Operator contract

Migration is dry-run by default with explicit workspace/source selection or reviewed manifest, explicit operator/report path and `--apply` against exact manifest hash/expected revisions. These are proposed CLI capabilities. Reject implicit earliest-user attribution and all-workspace mutation.

Implemented commands (PR #62), one workspace at a time. Each prints JSON with IDs, revisions, hashes and dispositions only:

- `npm run oakdoc:rollout -- --workspace <id>` is a dry run. It lists template mapping status, every A4 generated document with its disposition (`CONVERT`, `CONVERTED_PENDING_REVIEW`, `CONVERTED_ACCEPTED`, `HISTORICAL`, `BLOCKED_IN_SIGNING`, `BLOCKED_RELATION`), unfinished batch items on A4 templates, and the draft-conversion manifest with its hash. It makes no writes.
- `npm run oakdoc:rollout -- --workspace <id> --apply-draft-conversions --operator <user id> --manifest <hash>` converts the drafts in that manifest. It refuses if the manifest no longer hashes to the approved value. Each item is idempotent and reports `created`, `reused` or `failed` with a reason. To resume after a failure, run the dry run again and approve the new manifest. Run it only with the owner's approval of that run.
- `npm run db:migrate-oakdoc-templates -- --workspace <id> --operator <user id> [--apply]` requires an explicit workspace and operator. Without `--apply` it makes no changes.

Report old/new IDs/hashes, per-item results, validation state, changes and safe issue codes. Apply is additive/resumable/idempotent and protects edited targets. Stale items fail without overwrite; partial success is reported; retries never duplicate pairs. No reset/destructive rewrite/purge. Audit mapping/validation/preference/mode changes. Older agreement seed and current scripts share preservation rules; reruns cannot reset customized bytes or activation.

### 8.2 Historical records

Keep template IDs/versions, content, revisions, comments, signing artifacts, task/agreement links and filing snapshots. Signed downloads use existing signed PDFs. Historical A4 viewing uses sanitized static output/verified archive PDF, never A4PageEditor. Retain isolated original exporter until archive coverage/equivalence is proved; no regeneration from current company data/templates.

### 8.3 Rollback

Record previous mode/mappings and prove the rollback release reads new native records. Rollback changes future routing, never converts DOCX to HTML or deletes assets. During compatibility, restore legacy preference through checked audited changes; never bless stale evidence. Stop writes if integrity/provenance is in doubt.

After editor removal, use a tested compatibility application release plus preserved settings, not hidden A4 fallback. Keep additive schema/native data readable. Rehearse partial migration, connector outage and release rollback in disposable environments. Define window/operator before launch.

### 8.4 Existing A4 draft disposition (D04)

Confirmed by the owner 2026-09-26. The per-draft path is implemented (`convertA4DraftToOakDoc`, `POST /api/generated-documents/[id]/oakdoc-conversion`); drafts linked to tasks, batches or Service Agreements are held as `BLOCKED_RELATION` until relation transfer exists. Policy: next edit creates a linked native DRAFT from current saved legacy content including manual edits; preserve original. Record source ID/revision/hash, target/hash, conversion method and warnings. Do not regenerate from current company/template values and call it the same draft.

No universal converter is proved here. P8 first proves bounded conversion of inventoried constructs using canonical HTML readers; unsupported content requires native reauthor/import-and-compare. Never flatten/drop silently. Review precedes acceptance. Transfer pending task/batch links through canonical services with CAS/provenance and no duplicate outcomes/envelopes. Already-in-signing documents cannot take this path.

Read-only-history policy removes automatic conversion but keeps clear old-draft routing and explicit native-copy creation. Pre-cutover migration uses the same converter/evidence through M2. Final cutover needs the chosen policy and dispositions for every resumable legacy session.

## 9. Acceptance matrix

Every row is a release requirement. Existing suites are starting points; add regressions for uncovered behavior. The handover owns commands/dispatch.

| ID | Scenarios | Starting coverage / packets |
| --- | --- | --- |
| A01 | Section range/caret Delete/Backspace, undo/redo, IME/Unicode, lists/tables/images/headers, save/reopen, input during save/refetch, item isolation | `oakdoc-section-compatibility.test.ts`; new shared-host browser tests; E1/Q1 |
| A02 | Typed/default/required/options/date fields, parties, conditions/repeaters, metadata-only save, duplicate authority reset, bad import/CAS | Fields/conditions/generic-repeaters/template isolation/duplicate suites; S1/E2/L1 |
| A03 | Partial style/numbering/media, cycles/tenant, agreement overrides/fees/entities/signatures through actual production renderer | Native renderer/master/parity suites; S2/L2 |
| A04 | Batch/standalone edit/recover/clone/finalize/unfinalize, reviewed bytes, stale preview, blank creation, comments | Native draft/reviewed-asset/batch lifecycle/browser suites; L1/L2/U1 |
| A05 | Permission/tenant, malformed engine/metadata, two writers, edit-v-finalize, stale template, post-commit failure, upload failure, ambiguous retry, autosave ordering | New service/Postgres tests; existing batch Postgres suite; C0/L1/Q1 |
| A06 | Direct-service/PDF/bulk; connector missing/403/429/timeout/cleanup; letterhead/hash; envelope completion/certificate/filing retry | Graph/export/esigning-preparation/sharepoint/completion suites; O1/I2/Q2 |
| A07 | Forged pass, stale preference toggle, missing/inactive/duplicate pair, copied authority, validation/edit race, dry-run/partial apply/resume/rollback | Migration helpers/consolidated/template suites; new service/API/Postgres/CLI tests; M1/M2 |
| A08 | Full inventory, old pipeline/task IDs, seed rerun, stale clients, pending sessions, history exports, zero A4PageEditor mounts | Routes/import allowlist; M2/U1/I2/Q2 |

Synthetic corpus: letters, multi-page resolutions, multiple parties, long multilingual names/addresses, nested lists, merged cells/repeated table headers, unequal columns/mixed orientation, embedded logos/images, native/Oakcloud letterheads, zero/one/many repeaters, both condition branches, agreements with multiple entities/services/signers/negotiated clauses. Reproduce the section-delete fixture's shape without committing client content.

Retain sanitized page renders/screenshots and source/output hashes. Compare required values/order/cardinality/entity association, not just text. Missing/clipped content, misplaced signing fields, duplicate letterhead or changed parties/fees block release. Cosmetic differences require recorded review.

Proposed performance targets to freeze against reference hardware at C0: 10-page/1 MiB fixture editable within 3 seconds after asset load; 50-page/5 MiB within 10 seconds; editing p95 under 100 ms once ready; ordinary snapshot under 2 seconds; conversion timeout 60 seconds with visible retry. These are unmeasured targets. Record hardware/fonts/cold-warm state/provider latency and adjust with evidence before cutover.

## 10. Completion gates

- Every operational template/partial/variant/pending workflow has a disposition/current trustworthy evidence.
- Native CRUD/preview/batch/standalone/output/signing share boundaries; tenant/revision regressions pass.
- Real Microsoft 365 conversion/signing/filing smoke evidence exists per rollout environment; mocks alone do not pass release.
- New generation uses native templates through seeds and retained task/pipeline IDs.
- No active route imports/mounts A4PageEditor; services reject legacy writes/generation in oakdoc-only; historical compatibility imports are allowlisted.
- Historical records/exports survive; rollback is rehearsed; cleanup respects referenced assets.
- Node 24 lint/typecheck/relevant unit/Postgres/browser/build checks pass on integrated commit or remain explicit blockers. No untested gate is complete.

Track implementation/evidence in the single [handover](plans/2026-09-26-oakdoc-replacement-implementation.md), not competing plans.
