# Multi-Template Document Generation Batches Design

## Status

Approved in conversation on 2026-08-12.

## Objective

Replace the one-template-at-a-time document-generation wizard with a unified,
resumable batch workspace that can configure, review, and generate up to 20
separate documents for one primary company. A batch may mix standard templates
and Service Agreement templates, may reuse shared custom-field values, and
preserves each output as an independent `GeneratedDocument`.

The work includes a full document-generation UI revamp. Batch behavior must not
be layered into the existing 2,196-line wizard as additional conditional state.

## Product Decisions

- Each selected template produces a separate generated document; outputs are
  never merged into one file.
- Every item uses one batch-level primary company. A Service Agreement may add
  related entities through its existing agreement-specific configuration.
- Contacts, selected parties, document titles, letterhead choices, custom-field
  overrides, previews, and edits remain item-specific.
- Users review and may edit every rendered preview before generation.
- The workflow uses one four-stage layout for every template composition type.
  Service Agreement configuration is embedded in the active item's panel and
  does not introduce a second stepper.
- The desktop workspace uses a persistent document work queue. The mobile queue
  stacks above the active panel and may collapse.
- One explicit Save Draft action persists the entire batch and all child state.
- Generation preflight is all-or-nothing, but execution-time results are
  independent: successful outputs remain generated when another item fails.
- Failed items can be corrected and retried without duplicating completed
  outputs.
- Custom fields shared by multiple compatible templates appear as master
  fields. An item may explicitly override a master value.

## Scope

This design covers:

- multi-template selection, ordering, and removal;
- a first-class batch aggregate and ordered batch items;
- server-derived master fields and item-level overrides;
- shared company setup and per-item party/contact requirements;
- embedded Service Agreement entity, service, fee, term, and agreement setup;
- per-item preview generation, edit persistence, review acknowledgement, and
  stale-preview detection;
- explicit whole-batch save, resume, discard, and unsaved-navigation protection;
- preflight, bounded concurrent generation, partial success, and targeted retry;
- first-class batch visibility in the existing Generated Documents experience;
- adoption of existing single-document generation sessions;
- propagation of task-launch context to every generated output;
- responsive, accessible, light/dark document-generation UI replacement;
- affected architecture, API, database, and work-tracking documentation.

## Non-Goals

- Combining multiple templates into one generated document or PDF.
- Selecting a different primary company per item in one batch.
- Fuzzy matching master fields by label, description, or spelling similarity.
- Sharing Service Agreement services, fee lines, terms, or entities with
  standard documents.
- Automatic background generation, a general-purpose job queue, or scheduled
  generation.
- Real-time collaborative editing of one batch in multiple browser sessions.
- A separate batch-management dashboard outside the existing Generated
  Documents experience.
- Automatic server saves; Save Draft remains an explicit user action.

## Architecture

Use a first-class batch aggregate while preserving the existing
`GeneratedDocument` and Service Agreement lifecycles.

```text
DocumentGenerationBatch
  ├── shared primary company
  ├── shared master-field values
  ├── stage, revision, status, task context
  └── DocumentGenerationBatchItem[] (ordered)
        ├── template and version
        ├── parties, contacts, title, options
        ├── item-only fields and master-field overrides
        ├── preview, edit, review, validation, claim, error
        ├── one hidden GeneratedDocument draft
        └── optional ServiceAgreement through that GeneratedDocument
```

The batch is the resume and orchestration boundary. A batch item is the
configuration and execution boundary. The generated document remains the
individual output, so editing, finalization, export, e-signing, comments, task
outcomes, audit history, and Service Agreement activation continue to operate on
existing domain records.

### Why a First-Class Aggregate

A metadata-only grouping would duplicate shared state across generated-document
drafts and make optimistic locking, querying, partial recovery, and discard
semantics unreliable. Browser-only orchestration would not provide durable
batch resume or idempotent retry. Dedicated relational batch records provide
one authoritative owner for shared state without replacing the established
document lifecycle.

## Persistence Model

### DocumentGenerationBatch

Add a relational model with:

- `id`, `tenantId`, and `createdById`;
- `primaryCompanyId`;
- `currentStage`, constrained by validation to `0..3`;
- optional `activeItemId`, validated as an item in the same batch;
- `revision`, incremented for every successful mutation;
- `status`: `DRAFT`, `PARTIAL`, or `COMPLETED`;
- `masterFieldValues` as validated JSON keyed by server-derived master field ID;
- optional versioned `taskContext` JSON;
- `createdAt`, `updatedAt`, and `deletedAt`.

`DRAFT` means no item has completed or the batch has not yet attempted
generation. `PARTIAL` means at least one item is generated and at least one is
not. `COMPLETED` means every item is generated. Discard uses `deletedAt` rather
than a separate status.

### DocumentGenerationBatchItem

Add an ordered relational model with:

- `id`, `tenantId`, `batchId`, and unique `generatedDocumentId`;
- `templateId`, the last configured `templateVersion`, and `displayOrder`;
- `status`: `NOT_STARTED`, `NEEDS_INPUT`, `READY`, `GENERATING`, `GENERATED`,
  `FAILED`, or `BLOCKED`;
- a versioned, schema-validated configuration JSON value containing title,
  contact IDs, selected parties, item-only custom values, master overrides,
  letterhead choice, and composition-specific scalar options that do not
  duplicate relational Service Agreement entities, services, or fees;
- `previewContent`, `editedContent`, and optional structured editor content;
- `previewFingerprint` and `reviewedFingerprint`;
- validation diagnostics JSON and the last structured generation error;
- `generationAttemptId` and `generationClaimedAt` for atomic claims;
- `createdAt` and `updatedAt`.

The database has unique constraints for `(batchId, templateId)` and
`generatedDocumentId`, and an index for `(batchId, displayOrder)`. A batch may
contain 1–20 distinct active templates.

### Hidden Child Drafts

The first successful batch save transaction creates the batch, its ordered
items, and one `GeneratedDocument` in `DRAFT` status for every item. An item
reuses that record when it generates; generation updates the existing child
rather than creating a new output.

Before generation begins, later saves transactionally synchronize newly added,
removed, and reordered items with their hidden child drafts. Item identity is
preserved for unchanged templates so previews, edits, and Service Agreement
drafts are not recreated during reordering.

Incomplete child documents are excluded from ordinary generated-document
searches through the relational batch-item state. A child becomes visible as a
normal document only when its item becomes `GENERATED`. This avoids leaking
implementation drafts into the document list and makes duplicate output
creation structurally difficult.

A Service Agreement draft keeps its existing one-to-one relationship with the
item's hidden generated-document draft. Every Service Agreement item therefore
owns a separate agreement draft.

### Generated Documents Page

The existing Generated Documents page shows active `DRAFT` and `PARTIAL`
batches in a compact resumable-batches section above the normal documents list.
Each entry shows the primary company, document count, ready/generated/failed
counts, last update time, Resume, and Discard. Completed batches leave this
section; their individual outputs remain in the normal list. Incomplete child
drafts never appear as independent rows.

## Master Fields

### Discovery

The server derives the master-field catalogue from the current metadata of all
selected templates. The client never declares which fields are shared.

A custom field becomes a master field when:

1. its canonical placeholder key appears in at least two selected templates;
2. those occurrences have the same canonical field type; and
3. the field is not built-in company/contact context or structured Service
   Agreement data.

The stable master field ID is the canonical key plus canonical type. Similar
labels do not match. If one key appears with different types, each compatible
key/type group remains separate and the UI shows a type-conflict warning.

Built-in company and contact values are already shared through the rendering
context and do not appear again as editable master custom fields. Service
Agreement entities, services, fee lines, dates, and terms remain specific to
the agreement item.

### Values and Overrides

The batch stores one value per master field. An item stores only explicit
overrides. Presence of an override key is significant, so an explicit empty
value remains distinguishable from no override.

Effective resolution order is:

1. item override, when present;
2. batch master value, when present;
3. that template field's default value;
4. unresolved.

The UI exposes `Using shared value` and `Override` states per applicable item.
Removing an override immediately returns the item to the current shared value.
Required-field validation operates on the effective value.

Changing a master value invalidates previews only for ungenerated items that
consume that master field. Adding, removing, or changing selected templates
re-derives the catalogue and preserves still-compatible values by stable master
field ID.

## Unified Workflow

The batch uses exactly four stages for standard and Service Agreement
templates.

### 1. Documents

- Search and select multiple active templates.
- Show composition type, category, description, version, field count, and
  preview access.
- Maintain an ordered selected pack with drag/keyboard reordering and Remove.
- Prevent duplicates and enforce the 20-template maximum.
- Removing a configured item requires confirmation and removes its incomplete
  child draft and draft Service Agreement transactionally.

### 2. Shared Setup

- Select the one primary company.
- Display server-derived master fields, affected document count, defaults,
  required state, and type conflicts.
- Explain that Service Agreements may add related entities later.
- A company or master-value change invalidates only affected ungenerated
  previews.

### 3. Configure

Desktop uses a persistent 280–320px document work queue beside a focused active
item panel. Queue rows show `Not started`, `Needs input`, `Ready`, `Generated`,
`Failed`, or `Blocked`, plus concise outstanding-field counts.

For a standard template, the panel contains:

- title;
- required director, shareholder, company-contact, and general-contact inputs;
- item-only custom fields;
- shared-field values with per-item override controls;
- letterhead and other output options.

For a Service Agreement template, the same panel contains collapsible sections
for:

- authorised representative and related entities;
- services, assignments, and fee lines;
- agreement and effective dates, term, custom fields, and shared overrides;
- letterhead and other output options.

These sections reuse focused Service Agreement components without rendering the
current Service Agreement stepper.

### 4. Review & Generate

The work queue controls one editable preview at a time. The active preview has
an A4 editor and a validation/context rail. Users can switch items without
losing edits.

An item is `READY` only when its preview fingerprint is current, server
validation passes, and the user approves the exact persisted preview and edits
for generation. The review action records a content-bound hash derived from the
current `previewFingerprint`, edited HTML, and structured editor content as
`reviewedFingerprint`. Any later editor or render-input change clears that
approval. Generated items are read-only and link to their output.

A stale preview is not silently regenerated. The item exposes Refresh preview;
if the saved preview contains manual edits, refreshing requires confirmation
that the new render will replace those edits. Until the user confirms, the stale
content remains recoverable in the saved batch but cannot be approved or
generated.

Generate All is enabled only when every remaining item is ready. Failed items
show their structured error and targeted Retry action.

### Partial-Batch Editing Rules

Before the first successful output, templates, ordering, primary company,
master values, and every item configuration remain editable. After the first
successful output, batch composition, ordering, primary company, and master
values are frozen so completed outputs cannot silently diverge from shared
setup. Failed and incomplete items may still change item-specific fields and
master-field overrides before retry.

## UI Revamp and Component Boundaries

Replace the current monolithic wizard with focused units:

- `document-generation-batch-workspace.tsx`: unified shell, stage navigation,
  save state, and navigation guard;
- `batch-template-picker.tsx`: search, multi-selection, preview, ordering, and
  removal;
- `batch-shared-setup.tsx`: primary company, master fields, and conflicts;
- `batch-document-queue.tsx`: active item, readiness, statuses, reordering, and
  retry;
- `batch-item-configurator.tsx`: composition-type dispatch;
- `standard-document-config.tsx`: standard item fields and options;
- `service-agreement-config.tsx`: embedded Service Agreement sections;
- `batch-review-workspace.tsx`: A4 editor, item navigation, approval, and
  validation context;
- `batch-generation-results.tsx`: successes, failures, links, and retry;
- focused reducer, selectors, API client, fingerprint helpers, and legacy
  adoption modules outside React components.

The final implementation retires `document-generation-wizard.tsx`. Existing
single-session state is transformed by a small legacy adapter and displayed in
the new workspace; no legacy visual wizard remains.

### Visual and Responsive Rules

- Follow `docs/guides/DESIGN_GUIDELINE.md` and the compact Oakcloud visual
  language.
- Use a compact task header and one four-stage stepper.
- Use Oak green for selection/focus and semantic status colors for success,
  warning, error, and blocked states; always pair color with text or icons.
- Prefer subtle borders and restrained Oak-tinted headers over decorative
  gradients or excessive shadows.
- Bound form widths rather than stretching controls on wide monitors.
- At extra-wide review widths, use queue, A4 canvas, and a 320–384px sticky
  validation/context rail.
- At 320–639px, stack the queue above the active panel, allow it to collapse,
  use 44px touch targets, and prevent horizontal traps.
- Keep Back, Save Draft, Continue, and Generate All in a sticky action region.
- Provide complete loading, empty, no-match, saving, conflict, stale preview,
  validation, blocked, generating, partial-success, retry, and fatal-error
  states in light and dark themes.
- Preserve semantic radio/checkbox behavior, keyboard item selection,
  keyboard-accessible reordering, announced status changes, and focus routing
  from errors to the relevant field or document.

## Batch API

Add tenant-scoped, permission-checked endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/document-generation-batches` | List active resumable batches for the Generated Documents page. |
| `POST /api/document-generation-batches` | Create a persisted batch, ordered items, and hidden child drafts. |
| `GET /api/document-generation-batches/[id]` | Resume one batch with derived master catalogue and item summaries. |
| `PUT /api/document-generation-batches/[id]` | Save full shared and item state using an expected revision. |
| `DELETE /api/document-generation-batches/[id]` | Discard the aggregate and incomplete children. |
| `POST /api/document-generation-batches/[id]/items/[itemId]/preview` | Render and persist one item's current preview and fingerprint. |
| `POST /api/document-generation-batches/[id]/items/[itemId]/review` | Approve the exact current preview fingerprint. |
| `POST /api/document-generation-batches/[id]/preflight` | Revalidate every remaining item without creating outputs. |
| `POST /api/document-generation-batches/[id]/generate` | Generate all ready, ungenerated items with bounded concurrency. |
| `POST /api/document-generation-batches/[id]/items/[itemId]/retry` | Revalidate and retry one failed item. |

Every mutation accepts `expectedRevision`. A stale value returns `409 Conflict`
with the current revision and no mutation. Validation failures use structured
item and field errors; batch preflight failures return `422` and create no
outputs.

Preview, review, preflight, generate, and retry use persisted server state. The
client saves dirty changes first instead of sending an unpersisted alternate
configuration to execution endpoints.

## Preview Fingerprints

The server computes a deterministic hash from canonical render-affecting input:

- template ID and version;
- resolved partial and Service Agreement service dependency versions;
- primary company;
- contacts and selected parties;
- effective master values, item-only values, and item overrides;
- letterhead and other render options;
- Service Agreement representative, entities, services, assignments, fee
  lines, dates, and terms.

Changing any included value makes a mismatched preview and review stale. A
template, partial, or service-catalog dependency update also makes the affected
item stale. Separately, the review endpoint hashes the current
`previewFingerprint` together with the persisted edited HTML and structured
editor content. Editing the document clears review approval without requiring a
new render; approval stores that content-bound hash as `reviewedFingerprint`.
Preflight refuses stale, missing, invalid, or never-approved previews and rejects
content whose current content-bound hash differs from `reviewedFingerprint`.

## Generation Execution

Generate All follows this sequence:

1. The client saves the current batch state with its expected revision.
2. The server performs tenant-scoped preflight for every ungenerated item.
3. If any item fails, the endpoint returns all structured errors and generates
   nothing.
4. If all pass, the service atomically claims eligible items and processes at
   most three concurrently.
5. Each item renders and commits its existing child document in an independent
   transaction.
6. Each successful item becomes `GENERATED`; each execution-time failure becomes
   `FAILED` with a safe structured error.
7. The batch becomes `COMPLETED` when all succeed or `PARTIAL` when generated and
   unfinished items coexist.
8. The response returns successful document IDs and all item failures.

Item claiming uses a conditional database update from `READY` or retryable
`FAILED` to `GENERATING`, with a unique attempt ID and claim time. A claim older
than 15 minutes is treated as abandoned and becomes retryable during resume,
preflight, or explicit retry.

Generation is idempotent. `GENERATED` items are skipped, the unique child
document is reused, and concurrent requests cannot claim the same item. A lost
HTTP response does not create another output on retry because committed item
and child-document state remain authoritative.

Successful Service Agreements continue through the existing signing and
activation lifecycle. Existing task integration is invoked separately for each
successful generated document.

## Save, Resume, and Discard

Save Draft is available at every stage. The first save creates the aggregate;
later saves update it. Successful saves reset the whole-batch dirty baseline.
Failed saves leave local state dirty and display an actionable error.

The saved batch includes:

- selected templates and order;
- shared company and master values;
- current stage and active item;
- every item configuration and override;
- each Service Agreement draft;
- preview, structured editor content, edits, fingerprints, review state,
  validation, status, and safe error details;
- task-launch context and revision.

Native `beforeunload` and the existing in-app unsaved-navigation guard protect
changes since the last successful save. Internal stage and item navigation do
not trigger a leave warning.

Discard soft-deletes the batch and all incomplete child generated documents.
Because `ServiceAgreement` has no soft-delete field, the same transaction first
hard-deletes only attached agreements whose status is still `DRAFT`, cascading
their draft entities, items, and fees, and then soft-deletes the incomplete
generated-document children. Generated documents and their Service Agreements
are never deleted by batch discard. Discarding a partial batch therefore removes
only the unfinished remainder.

## Compatibility and Migration

- `/generated-documents/generate` opens a clean new batch workspace.
- Existing `?templateId=` and `?companyId=` links preselect a one-item batch and
  its primary company.
- New resume links use `?batch=<batchId>`.
- Existing `?draft=<generatedDocumentId>` links and version 1/2 generation
  sessions remain readable.
- The legacy adapter maps one saved session, including preview, edits, parties,
  custom fields, and Service Agreement draft, into one local batch item.
- The first Save Draft transaction creates a batch and item around the existing
  generated-document draft, removes the active legacy session marker only after
  the new aggregate succeeds, and preserves the same Service Agreement link.
- Existing legacy endpoints remain available for read/adopt compatibility, but
  the new UI creates and updates only batch sessions.
- No bulk backfill is required; legacy sessions migrate on use.

Single-template generation is not a separate product path. It is a valid batch
with one item and uses the same UI, APIs, validation, and output behavior.

## Validation, Authorization, and Audit

All endpoints require the existing document-generation permissions. Every
batch, item, template, company, contact, selected party, generated document,
Service Agreement, and service-catalog reference is resolved within the active
tenant. Authorization failures do not reveal whether a cross-tenant record
exists.

The server validates:

- batch size, distinct active templates, order, and template composition type;
- one tenant-owned primary company;
- current eligible contacts and party selections;
- server-derived field catalogues, field types, and required effective values;
- Service Agreement ownership, representative, entity, service, assignment,
  fee, date, and term rules;
- preview/review fingerprints and template/dependency versions;
- legal item status transitions and revision/claim ownership.

Unavailable or inactive references preserve unaffected saved data and mark the
specific item `BLOCKED`. The UI explains the missing reference and routes focus
to the required correction. The system never silently substitutes another
template, company, contact, party, service, or field value.

Audit entries cover batch creation, update where materially relevant, discard,
generation start, completion, partial completion, abandoned-claim recovery, and
targeted retry. Existing generated-document and Service Agreement audit behavior
remains in force.

## Error and Recovery Behavior

- Batch creation and whole-batch saves are transactional.
- Each final item generation is independently transactional.
- Revision conflicts overwrite neither version.
- Preflight failure creates no outputs.
- Execution-time failure preserves successful outputs and all failed-item state.
- Resuming after an interrupted request reads authoritative item state and
  recovers claims older than 15 minutes.
- A generated item is never made editable inside the batch or regenerated.
- Switching an ungenerated Service Agreement item to a standard template or
  removing it requires confirmation before its agreement draft is deleted.
- Removing a template or changing company, parties, fields, dependencies, or
  agreement data invalidates only affected ungenerated previews.
- Safe user-facing errors omit stack traces and sensitive tenant data; full
  diagnostics use existing structured server logging.

## Testing and Verification

### Domain Coverage

- master-field discovery, canonical key/type grouping, type conflicts, and
  catalogue changes;
- effective-value precedence and explicit empty overrides;
- affected-item preview invalidation and deterministic fingerprints;
- review approval and stale-review clearing;
- item and batch status transitions, composition locking, and stale claims;
- legacy session mapping and one-item adoption.

### Service and Database Coverage

- transactional batch/item/hidden-child creation and updates;
- optimistic revision conflicts;
- tenant isolation and reference eligibility;
- distinct templates and the 1–20 item limit;
- Service Agreement ownership per child draft;
- exclusion of incomplete children from document searches;
- idempotent claims, bounded execution, independent commits, partial success,
  retry, interrupted-response recovery, and stale-claim recovery;
- partial-batch discard preserving generated outputs;
- propagation of task context to every output.

### API Coverage

- authentication and permissions for every new route;
- create, list, resume, save, discard, preview, review, preflight, generate, and
  retry contracts;
- `409` revision conflicts and `422` preflight responses;
- structured item/field errors and partial-result responses;
- cross-tenant IDs returning non-disclosing failures;
- existing single-template links and legacy draft adoption.

### Component Coverage

- template multi-selection, duplicate prevention, limit, ordering, and removal;
- shared company and master fields;
- override activation, clearing, and conflict messaging;
- unified four-stage navigation for mixed standard/Service Agreement batches;
- queue readiness, active selection, blocked/generated/failed states, and retry;
- embedded Service Agreement sections without a nested stepper;
- dirty tracking, explicit save, revision conflict, and navigation guards;
- per-item preview/edit persistence, review approval, stale previews, and focus
  routing;
- partial-success result handling.

### Browser and Visual Verification

Exercise a batch containing a standard template, a Service Agreement, and
another custom-field template at:

- 320px mobile;
- standard desktop;
- extra-wide desktop.

Verify selection, reorder, shared/master fields, per-item overrides, Service
Agreement setup, save/resume, preview/edit/approve, separate outputs, a forced
single-item execution failure, correction and retry, sticky actions, keyboard
operation, light/dark themes, no horizontal overflow, and readable bounded form
widths.

### Final Verification

Run focused tests throughout implementation, then the complete affected
document-generation and Service Agreement suites, TypeScript checks, ESLint,
the production build, and browser visual verification. Existing export,
e-signing preparation, Service Agreement activation, generated-document list,
legacy draft, and task-outcome integrations receive regression coverage.

## Documentation Updates

Update the existing sources of truth:

- `docs/ARCHITECTURE.md` for batch ownership, generation, and legacy adoption;
- `docs/reference/API_REFERENCE.md` for all batch endpoints and responses;
- `docs/reference/DATABASE_SCHEMA.md` for batch models, relations, statuses, and
  hidden child behavior;
- `docs/TODO.md` for the document-generation capability status;
- this design and its implementation plan under `docs/superpowers/`.

## Acceptance Criteria

- Users can select and order 1–20 distinct active templates, including a
  Service Agreement and standard templates together.
- One batch primary company applies to every output; Service Agreements may add
  related entities.
- Compatible custom fields used by at least two templates appear once as master
  fields, and any item can override its effective value.
- Every selected template creates exactly one separate generated document.
- The visible workflow has exactly Documents, Shared setup, Configure, and
  Review & generate for all composition types.
- The selected document work queue exposes actionable readiness and failure
  state without a nested Service Agreement stepper.
- Users can save and resume the complete batch, including agreements, previews,
  edits, approvals, errors, and partial results.
- Generate All produces nothing when preflight fails.
- Execution-time failure preserves successful outputs and allows idempotent
  targeted retry of failed items.
- Incomplete child drafts are hidden; active batches appear once in the existing
  Generated Documents experience.
- Existing one-template links and legacy generation sessions open in the new UI
  without data loss and adopt on save.
- The new workspace is usable at 320px, standard desktop, and extra-wide desktop
  in light and dark themes with keyboard and screen-reader semantics.
- Affected tests, TypeScript, ESLint, production build, and browser verification
  pass.

## Implementation Notes

Reconciled implementation decisions that refine the approved design:

- **Nullable draft company:** a stage-one batch may persist with
  `primaryCompanyId = null`; Shared setup enforces a company before Configure
  can be completed and before preflight/generation can run.
- **Incomplete Service Agreement synchronization:** the resumable workspace
  state is always persisted in item configuration. Only when the workspace
  passes `serviceAgreementDraftSchema` is it synchronized into the relational
  agreement inside the same save transaction; otherwise the item stays
  `NEEDS_INPUT` with diagnostics and preflight refuses it.
- **First-success task outcome:** because `TaskStageOutcome.taskStageId` is
  unique, the first successful item by `displayOrder` is linked once per
  task stage; retries never overwrite an already-linked outcome.
- **Preview editor surface:** the batch review workspace keeps the A4 editor
  contract (`value`/`onChange`/`readOnly`) and adds an explicit Refresh
  preview action with a replace-manual-edits confirmation; stale content is
  never silently regenerated.
