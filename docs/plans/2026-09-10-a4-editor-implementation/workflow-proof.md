# WORKFLOW W0 — Persistence, Field Boundary and Output Proof

Status: **READY FOR INTEGRATION — W0 only**  
Dispatch: `WORKFLOW-W0-20260911-01`  
Branch: `workflow/w0-a4-editor-persistence-proof`  
Existing PR: #33 — https://github.com/Scofieldkoh/oakcloud/pull/33  
Scope: Wave-0 proof/inventory/design only. W0 does not implement W1/W2/W3 or Stage 1 behavior.

## 0. Evidence classification and execution boundary

W0 uses three explicit result classes in this packet:

- **SATISFIED** — design/inventory evidence is complete, or a compatibility assertion describes behavior that exists today.
- **EXPECTED-FAILURE BASELINE CAPTURED** — the desired frozen contract is represented with `it.fails(...)` because current production behavior is intentionally not changed in W0.
- **BLOCKED FOR CORE INTEGRATION VALIDATION** — the required executable evidence cannot be produced by this session's runtime and is not claimed as passed.

The local execution host available to this session exposes Node `22.16.0`, has no Node 24 binary and has no dependency-capable Oakcloud checkout. `package.json` requires `node >=24 <25`. Therefore the exact W0 Vitest commands, `npx tsc -b`, and real Puppeteer PDF-byte generation were **not executed locally**. Running them under Node 22 would not satisfy the acceptance contract.

The repository does contain `.github/workflows/node24-compatibility.yml`, which checks out the PR under Node 24 and runs general lint/typecheck/build and Chromium-path checks. That workflow is independent Node-24 evidence after a PR push, but it does **not** run the exact focused W0 Vitest commands and therefore is not substituted for them here.

No production resolver, Zod/API schema, Prisma schema/migration, capability endpoint, pagination bundle, version, deployment or main-branch state is changed by W0.

## 1. Writer / reader / consumer inventory

### 1.1 `DocumentTemplate`

Current storage/revision source: `DocumentTemplate.version Int @default(1)`.

Writers and mutation semantics found in `src/services/document-template.service.ts` and its API/editor callers:

| Writer | Current mutation | Current guards | Revision/audit/side effects | W1 participation |
| --- | --- | --- | --- | --- |
| `createDocumentTemplate` | creates name/description/category/composition/content/contentJson/placeholders/folder/isActive | tenant-scoped duplicate-name check; composition validation | starts database `version`; audit `DOCUMENT_TEMPLATE_CREATED` | new resource; acknowledge public revision |
| `updateDocumentTemplate` | can change name/description/category/composition/content/contentJson/placeholders/folder/isActive | pre-read by `id + tenantId + deletedAt:null`; duplicate-name/composition validation | increments `version`, but final update predicate is `id` only; audit `DOCUMENT_TEMPLATE_UPDATED` | accept `expectedRevision`, atomically compare to existing `version`, increment once |
| `deleteDocumentTemplate` | sets `deletedAt`, `isActive:false` | tenant read; already-deleted guard | currently no revision precondition; audit `DOCUMENT_TEMPLATE_DELETED` | lifecycle CAS + increment |
| `restoreDocumentTemplate` | clears `deletedAt`, reactivates | tenant read; deleted-state and name-conflict guards | currently no revision precondition; audit `RESTORE` | lifecycle CAS + increment |
| `duplicateDocumentTemplate` | creates independent copy of content/contentJson/placeholders/folder | source is tenant/non-deleted; unique-name loop | new row starts `version:1`; audit duplication | source read only; new row acknowledges its own revision |

Readers/consumers include `getDocumentTemplateById`, search/stats/health readers, template editor load/save, template test preview, render-for-generation, batch generation/review, partial analysis/expansion, service-agreement composition, generated-document materialization, task-launched generation, and downstream HTML/PDF/local-print paths after a generated snapshot is produced.

### 1.2 `TemplatePartial`

Current storage/revision source: `TemplatePartial.version Int @default(1)`.

`src/app/api/template-partials/route.ts` parses requests before the service boundary. `src/lib/validations/template-partial.ts` reuses `placeholderDefinitionSchema` for its `placeholders` array. `src/services/template-partial.service.ts` persists exactly the parsed placeholder JSON it receives.

| Writer | Current mutation | Current guards | Revision/audit/side effects | W1 participation |
| --- | --- | --- | --- | --- |
| `createTemplatePartial` | name/displayName/description/content/placeholders | tenant duplicate-name check and name validation | new row; CREATE audit | new resource; acknowledge public revision |
| `updateTemplatePartial` | same mutable fields | serializable transaction; `id + tenantId + deletedAt:null` pre-read; duplicate-name guard | increments `version` only for material content/placeholders change; final update predicate is `id`; UPDATE audit | accept `expectedRevision`; atomic CAS; every writer relevant to editable state must acknowledge the accepted revision |
| `deleteTemplatePartial` | sets `deletedAt` | tenant/non-deleted read; blocks deletion while templates/service variants use it | DELETE audit | lifecycle CAS + increment when strict revision semantics are active |

Readers/consumers include `getTemplatePartial`, `getTemplatePartialByName`, search/list/all readers, usage analysis, `getPartialsUsedInTemplate`, recursive nested-partial discovery, `resolvePlaceholders` partial expansion, template preview/test paths, service-agreement composition and generated-document rendering.

### 1.3 `GeneratedDocument`

Current model has `templateVersion Int? @map("template_version")`; that value is generation provenance and is **not** an edit revision.

Writers in `src/services/document-generator.service.ts` and their downstream routes/workflows include:

- materialize-from-template: creates a new generated row or updates an existing target draft;
- create/clone paths: create a new independent generated row;
- `updateGeneratedDocument`: content/title/contentJson/use-letterhead/metadata edits as permitted by the current input contract;
- finalize and unfinalize lifecycle writers;
- archive lifecycle writer;
- soft-delete and bulk-delete writers;
- batch-generation materialization into an existing draft target;
- service-agreement/task-launched materialization when they target/create generated documents;
- draft-save paths, which write `DocumentDraft` rather than mutating the canonical `GeneratedDocument` row directly.

Current mutation functions use tenant/deleted/status pre-reads as applicable, but canonical updates are not protected by a dedicated GeneratedDocument revision CAS. Finalize guards unresolved template data; unfinalize has its own eligibility check; archive/delete have lifecycle guards. Existing successful mutations create audit records where implemented. External output/e-signing/SharePoint effects are downstream consumers and must never be triggered from a rejected stale write.

Readers/consumers include generated-document detail/edit/search/statistics, read-only generated-document views, drafts, comments/revisions/validation, batch review/generation, e-signing preparation/completion, SharePoint filing/upload, service-agreement/task integration, HTML export, PDF export, local print, server/static pagination bundle, and any output path consuming stored canonical content/contentJson.

### 1.4 Draft, preview, batch and output boundaries

- `DocumentDraft` stores `content`, optional `contentJson` and metadata separately from canonical generated-document storage. Future W integration must bind a draft to the canonical base revision without using draft creation as a canonical revision increment.
- Batch state already has an `expectedRevision` concept; the W0 batch tests capture contentJson replacement/nulling and stale-race hazards without changing production behavior.
- Preview must be tied to one complete unsaved snapshot; a delayed response cannot replace a newer local snapshot.
- The checked-in pagination bundle is a reader/output consumer and is intentionally not regenerated in W0.
- C03 reader compatibility must precede any C03/v2 writer activation in editor, preview, HTML/PDF export and local print.

## 2. Frozen C07 public concurrency contract

The public mutation precondition name is **`expectedRevision`** for all editable A4 resources.

Internal mapping is frozen as:

| Public resource | Public request precondition | Internal storage revision |
| --- | --- | --- |
| `DocumentTemplate` | `expectedRevision` | existing `DocumentTemplate.version` |
| `TemplatePartial` | `expectedRevision` | existing `TemplatePartial.version` |
| `GeneratedDocument` | `expectedRevision` | future dedicated `GeneratedDocument.revision` |
| batch/session resource | existing `expectedRevision` | existing batch revision |

`updatedAt` is not a revision token. `GeneratedDocument.templateVersion` remains provenance and must never be reused for edit concurrency.

### 2.1 Proposed additive TypeScript contract for G0

```ts
export type RevisionPreconditionMode = 'optional' | 'required';

export interface A4EditorCapabilities {
  readerFormatLevel: 1 | 2;
  allowedWriterFormatLevel: 1 | 2;
  revisionPrecondition: RevisionPreconditionMode;
}

export interface A4RevisionMutationInput {
  expectedRevision?: number;
}

export interface A4RevisionAcknowledgement {
  revision: number;
}
```

`expectedRevision` is optional in the TypeScript transition shape only because an old client may omit it while the server publishes `revisionPrecondition: 'optional'`. Once the capability is `required`, omission is a recoverable precondition error; clients should send the field whenever the reader supplies a revision even during the optional transition.

### 2.2 Exact wire examples

Mutation request during transition or strict mode:

```json
{
  "content": "<p>Canonical snapshot N</p>",
  "contentJson": { "version": 1 },
  "expectedRevision": 7
}
```

Accepted mutation acknowledgement:

```json
{
  "data": {
    "id": "resource-id",
    "revision": 8
  }
}
```

Stale conflict — HTTP `409`:

```json
{
  "error": "This document changed since you opened it. Reload or reconcile before saving.",
  "code": "VERSION_CONFLICT",
  "details": {
    "resourceType": "GeneratedDocument",
    "expectedRevision": 7,
    "currentRevision": 8,
    "action": "reload-or-reconcile"
  }
}
```

Missing precondition after strict activation — proposed HTTP `428` using the shared recoverable error convention:

```json
{
  "error": "expectedRevision is required for this mutation.",
  "code": "REVISION_PRECONDITION_REQUIRED",
  "details": {
    "resourceType": "GeneratedDocument",
    "action": "reload-and-retry"
  }
}
```

W0 does not add either error path. Existing unchecked writers remain unchanged until a later authorized WORKFLOW packet.

### 2.3 Atomic acknowledgement rule

A save of local snapshot N against server revision R may clear dirty state only when the response acknowledges that same snapshot/request and returns R+1. If local state advances to N+1 while N is in flight, the N acknowledgement updates the server-revision baseline but must not mark N+1 clean. A stale writer never falls back to an unchecked update after its CAS affects zero rows.

## 3. Exact A4 capability propagation contract

### 3.1 Repository search result

Repository inspection found no generic, central document-editor capability/config endpoint. `src/app/api/settings` currently contains domain-specific settings (for example SharePoint filing), not an application capability document. The existing central **authenticated page read/bootstrap pattern** is `src/app/api/page-bootstrap/*/route.ts`; for example `src/app/api/page-bootstrap/processing/route.ts` authenticates, composes server-owned read data, and returns one bootstrap payload.

Because no existing A4/document-editor bootstrap endpoint exists, W0 proposes one exact additive endpoint **within that established central pattern** rather than scattering flags across editor routes:

- server module: `src/lib/document-editor/a4-editor-capabilities.ts`
- authenticated producer route: `src/app/api/page-bootstrap/document-editor/route.ts`
- method: `GET`
- request body: none
- response contract:

```json
{
  "a4EditorCapabilities": {
    "readerFormatLevel": 1,
    "allowedWriterFormatLevel": 1,
    "revisionPrecondition": "optional"
  }
}
```

This endpoint/module is **design-only in W0** and is not created by PR #33.

### 3.2 Producer and consumers

The future server module is the single source of truth for the three capability values. The page-bootstrap route is the only browser propagation point. Expected browser consumers are:

- `src/app/(dashboard)/template-partials/editor/page.tsx`;
- `src/app/(dashboard)/generated-documents/[id]/edit/page.tsx`;
- document generation/batch workspace and review components/hooks;
- preview/test actions that choose writer/request behavior.

Server-side output readers (render, local-print server preparation, HTML/PDF export and pagination) must use the same module directly rather than copy constants or trust client capability claims.

### 3.3 Old-deployment/default behavior

If a new client receives `404`, an older bootstrap response, or a payload with no `a4EditorCapabilities`, it must use the conservative fallback:

```ts
const OLD_DEPLOYMENT_A4_CAPABILITIES: A4EditorCapabilities = {
  readerFormatLevel: 1,
  allowedWriterFormatLevel: 1,
  revisionPrecondition: 'optional',
};
```

Absence must never imply reader/writer level 2. A new client should still send `expectedRevision` whenever a resource response contains a revision; `optional` means only that the transitional server still accepts a missing precondition.

### 3.4 Rollout order

1. Add the GeneratedDocument revision column and reader/acknowledgement plumbing while publishing `1 / 1 / optional`.
2. Deploy compatible readers across editor reopen, preview/test, batch, local print, HTML/PDF export and server/static pagination consumers.
3. Deploy clients that send `expectedRevision` whenever a revision is available; keep server acceptance transitional.
4. Observe mixed old/new clients and ensure stale conflicts/recovery work without v2 writes.
5. Flip `revisionPrecondition` to `required` only after client coverage is sufficient.
6. Raise `readerFormatLevel` before any corresponding writer level.
7. Raise `allowedWriterFormatLevel` to 2 only after G0/later integration explicitly authorizes v2/C03 writing.

### 3.5 Rollback order

1. Lower `allowedWriterFormatLevel` first so no new higher-format content is produced.
2. Change `revisionPrecondition` from `required` back to `optional` before rolling back clients or strict server handlers.
3. Keep `readerFormatLevel` at the highest format that may still exist in stored content; do not strand persisted newer content.
4. Roll back client/server writer behavior.
5. Retain the additive revision column while any deployed code references it; dropping it is the final schema rollback step only after all consumers are rolled back.

## 4. GeneratedDocument revision migration specification — design only

### 4.1 Exact Prisma addition

The current model uses `@@map("generated_documents")`; multi-word columns such as `templateVersion` use snake-case `@map`, while a single-word scalar does not require a mapping. The exact proposed additive field is therefore:

```prisma
model GeneratedDocument {
  id              String @id @default(uuid())
  tenantId        String @map("tenant_id")
  templateId      String? @map("template_id")
  templateVersion Int? @map("template_version")
  revision        Int @default(0)
  // existing fields unchanged

  @@map("generated_documents")
}
```

Proposed forward SQL shape:

```sql
ALTER TABLE "generated_documents"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
```

No `@map` is required for `revision` because the physical column is also `revision`.

### 4.2 Initial and increment semantics

- all existing rows receive revision `0` from the non-null default;
- newly created generated documents start at `0`;
- every accepted mutation to an existing canonical generated document that can race with editor/lifecycle state compares `expectedRevision` to `revision` and atomically increments exactly once;
- a rejected stale/missing-precondition mutation does not increment, audit as success, or trigger downstream external effects;
- clone/create operations create a new row at revision `0`; reading a source for clone does not increment the source;
- `DocumentDraft` writes do not increment canonical revision; they carry/bind to a base canonical revision for later reconciliation;
- `templateVersion` is left unchanged as template provenance.

### 4.3 GeneratedDocument writers that must participate

When later authorized, revision participation is required for:

- update of an existing target inside template materialization/batch generation;
- `updateGeneratedDocument` content/title/contentJson/use-letterhead/metadata edits;
- finalize;
- unfinalize;
- archive;
- soft delete;
- each canonical row mutated by bulk delete;
- any service-agreement/task/e-signing workflow that updates an existing generated-document row rather than creating a new one.

Create/clone paths return revision `0` for their new row. Draft-only writes retain their own draft semantics but must remember the canonical base revision they were derived from.

### 4.4 Reader and transition contract

All edit-capable GeneratedDocument reads expose public `revision`. Template and partial edit reads expose a public revision derived from their existing `version`. Mutation success acknowledges the new public `revision` regardless of which internal column backs it.

Transition sequence is: schema first -> readers/response plumbing -> capability `1/1/optional` -> clients send `expectedRevision` -> writer CAS support -> strict diagnostics -> capability `required`. Strict enforcement is never enabled before old clients have a recovery path.

### 4.5 Forward/deploy and rollback ordering

Forward:

1. apply the additive database migration only in the later shared migration window;
2. regenerate/deploy Prisma clients that can read the new field;
3. publish reader/acknowledgement responses and the conservative capability;
4. deploy CAS-aware writers/clients while missing preconditions remain transitional;
5. validate stale races and acknowledgement behavior;
6. activate strict preconditions;
7. only later allow a higher writer-format level.

Rollback:

1. disable writer level 2 if enabled;
2. make revision preconditions optional;
3. roll back strict clients/writers while retaining the column;
4. roll back reader plumbing only when no deployed code depends on it;
5. drop `generated_documents.revision` last, and only if a full schema rollback is actually required.

W0 does **not** add the field or a migration.

## 5. Actual field API/Zod boundary evidence

`tests/services/document-template-editor-fields.test.ts` no longer uses a local `StoredField` plus `JSON.stringify/parse` as a stand-in for persistence.

The fixture now exercises the actual repository schemas:

- `placeholderDefinitionSchema`;
- `createDocumentTemplateSchema`;
- `updateDocumentTemplateSchema`;
- `createTemplatePartialSchema`;
- `updateTemplatePartialSchema`.

The synthetic definition includes `id`, `key`, `label`, `type`, `source`, `category`, `path`, explicit/omitted `required`, `defaultValue`, `format`, `options`, `linkedTo`, `sourcePartial`, and `futureMetadata`.

Current baseline captured by normal passing assertions:

- schema-supported fields such as key/label/type/source/category/path/defaultValue/format/linkedTo/sourcePartial survive parsing;
- `id` is currently stripped;
- `options` is currently stripped;
- arbitrary `futureMetadata` is currently stripped;
- omitted `required` becomes an own property with value `false` because the current schema applies a default;
- all current type values are recognized, including legacy `list` and `conditional`.

Future F0 lossless requirements are intentionally `it.fails`:

- `W-FIELD-01F` requires the full definition, including stable `id`, `options` and unknown forward metadata, to survive the server definition boundary;
- `W-FIELD-01G` requires presence semantics to preserve an omitted `required` rather than materializing a default.

The TemplatePartial API parses request bodies before `createTemplatePartial`/`updateTemplatePartial` persist the parsed placeholders. Therefore this is the actual current loss point at the server boundary; W0 does not change the schema or service.

## 6. C06 resolver escaping baseline correction

Current production `resolvePlaceholders()` ultimately interpolates ordinary values without HTML escaping, except special formatting paths such as letter-address handling. W0 must not claim F2 escaping is already active.

The corrected fixture is split deliberately:

- `W-FIELD-05A` — **passing current baseline**: `<b>not trusted markup</b>` supplied as an ordinary custom value is presently observable as markup in resolved HTML; missing-placeholder diagnostics remain observable.
- `W-FIELD-05B` — **`it.fails` future C06 contract**: once F2/W integration is explicitly authorized, ordinary untrusted values must be escaped at the interpolation boundary so the same input becomes `&lt;b&gt;not trusted markup&lt;/b&gt;`.

`src/lib/placeholder-resolver.ts` is unchanged in W0.

## 7. Synthetic output baseline and real-PDF gate

`tests/document-output/document-template-editor-output.test.ts` now defines one deterministic output candidate containing all G0-required elements:

- heading with first unique sentinel `W0-PDF-FIRST-SENTINEL`;
- ordered list starting at `5`;
- nested ordered list;
- block quote;
- table caption and table footer;
- synthetic field/reference marker;
- exact inline C03 break `<span data-a4-break="page"></span>`;
- legacy top-level hard break `<div class="page-break" data-break-type="hard"></div>`;
- 120 deterministic filler paragraphs to force a multi-page candidate;
- last unique sentinel `W0-PDF-LAST-SENTINEL`.

A corresponding `buildPDFHtml` assertion keeps both text sentinels observable and ordered. Existing expected-failure fixtures continue to expose sanitizer/attribute/fallback gaps instead of claiming they are fixed.

The real path exists in `src/services/document-export.service.ts`: `exportToPDF()` builds HTML and calls exported `generatePDF()` using `puppeteer-core`, the repository Chrome resolver and the checked-in pagination bundle, and reports a PDF page count. This session cannot execute it because no Node 24 Oakcloud checkout/Chromium dependency environment is available locally.

Therefore the following required byte-level assertions are **BLOCKED FOR CORE INTEGRATION VALIDATION**, not replaced by HTML claims:

- actual PDF bytes created;
- page count >= 2;
- first sentinel retained;
- last sentinel retained;
- text order retained;
- explicit break respected;
- no clipped-success result;
- corresponding HTML retained alongside the PDF evidence.

## 8. Existing W0 persistence/race fixtures

The other W0 files remain proof-only and continue to separate broken current behavior from compatibility evidence:

- `document-template-editor-save.test.ts`: delayed editor/onChange snapshot risk, stale client revision/CAS gaps and revision acknowledgement contract use expected failures where production lacks the behavior.
- `document-template-editor-drafts.test.ts`: draft base-metadata/reconciliation and late acknowledgement hazards are captured without changing generated-document persistence.
- `document-template-editor-batch.test.ts`: body/layout contentJson preservation, active layout source, selected ordering and same-revision race behavior remain baseline evidence.

No expected-future behavior is converted into a normal passing test merely to satisfy G0 paperwork.

## 9. W0 G0 requirement status

| G0 requirement | Status | W0 evidence |
| --- | --- | --- |
| Correct W-FIELD-05 current behavior | **EXPECTED-FAILURE BASELINE CAPTURED** | W-FIELD-05A passes current raw-markup behavior; W-FIELD-05B is future escaping `it.fails` |
| Actual field API/Zod boundary evidence | **SATISFIED** | real document-template + TemplatePartial schemas replace fake JSON round-trip |
| Future F0 lossless field preservation | **EXPECTED-FAILURE BASELINE CAPTURED** | W-FIELD-01F/01G |
| Legacy `list` / `conditional` recognition | **SATISFIED** | W-FIELD-01E |
| Exact capability contract and propagation point | **SATISFIED** | typed 1/2 reader+writer levels, optional/required revision precondition, exact proposed page-bootstrap endpoint/module, fallback/rollout/rollback |
| GeneratedDocument dedicated revision migration specification | **SATISFIED** | exact `revision Int @default(0)`, physical SQL, writers/readers/transition/rollback; migration not applied |
| C03 exact inline + legacy output candidate | **SATISFIED** | deterministic source fixture plus existing recursive partial/output baselines |
| Real two-page Puppeteer PDF-byte proof | **BLOCKED FOR CORE INTEGRATION VALIDATION** | local runner lacks Node 24 checkout/dependencies; no HTML-only substitution |
| Exact focused W0 Vitest execution under Node 24 | **BLOCKED FOR CORE INTEGRATION VALIDATION** | not executed locally |
| `npx tsc -b` under Node 24 | **BLOCKED FOR CORE INTEGRATION VALIDATION** | not executed locally; generic Node24 CI typecheck is separate evidence |
| Production behavior/schema untouched | **SATISFIED** | W0 changes tests/docs only |

## 10. Exact integration validation commands

These commands remain the required focused executable gate on a Node 24 Oakcloud checkout:

```bash
npx vitest run \
  tests/services/document-template-editor-save.test.ts \
  tests/services/document-template-editor-batch.test.ts \
  tests/services/document-template-editor-drafts.test.ts \
  tests/services/document-template-editor-fields.test.ts

npx vitest run \
  tests/document-output/document-template-editor-output.test.ts

npx tsc -b
```

Any future lossless/escaping/concurrency contract that is still broken in production must remain `it.fails`; a normal passing assertion is reserved for behavior that exists today.

## 11. Stop point

W0 stops here. No W1/W2/W3/Stage-1 implementation, resolver escaping, Zod/API change, GeneratedDocument migration, capability negotiation implementation, revision enforcement, v2 writer, pagination-bundle regeneration, version bump, deployment or merge is authorized by this packet.

CORE owns the final G0 decision and integration validation.

**READY FOR INTEGRATION — W0 only**
