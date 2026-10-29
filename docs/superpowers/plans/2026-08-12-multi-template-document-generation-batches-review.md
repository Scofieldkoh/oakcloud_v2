# Multi-Template Document Generation Batches — Implementation Review

**Review date:** 2026-08-13

**Reviewed specification:** `docs/superpowers/specs/2026-08-12-multi-template-document-generation-batches-design.md`

**Reviewed plan:** `docs/superpowers/plans/2026-08-12-multi-template-document-generation-batches.md`

**Reviewed implementation:** current working tree on `main` at `6752063`, including the
uncommitted multi-template batch change set (schema migration, batch services/routes,
`generation-batch/` components, generate-page rewrite, legacy wizard retirement, and
documentation).

**Review scope:** page rendering and load, batch create/save/resume, master fields,
item configurators, preview/review/preflight/generate/retry, task-context propagation,
tenant scoping, the resumable-batches list, tests, and documentation.

**Disposition:** **Not ready to accept.** The `generated-documents/generate` page is
unusable (the reported "Something went wrong"), and new-batch save plus task-launch
context propagation are also broken. The green test gates mask all three because they
mock the page's real `searchParams` shape and the entire API boundary.

---

## Executive Summary

The redesign is structurally aligned with the design: the batch aggregate and ordered
items exist in Prisma, hidden child drafts are created, master fields/fingerprints are
server-derived, the four-stage workspace and queue are implemented, and the legacy
wizard is retired. The nominal component/browser suites pass.

However, the feature cannot be used end to end:

1. **The generate page crashes before any data loads.** Reproduced in the running app:
   `TypeError: y.get is not a function` thrown at the first `searchParams.get('batch')`
   call, surfacing Next.js's global "Something went wrong" boundary. The focused page
   test passes only because it supplies a non-production `Promise<URLSearchParams>` prop.
2. **The first explicit save of a new batch fails.** The client creates the batch, then
   builds the save payload from the pre-create local state, sending the template ID as
   `activeItemId` and no item IDs, which the schema rejects.
3. **Task-launch context never reaches generation.** The client omits `taskContext` on
   create, and the update path stores it in a shape the generation service does not read,
   so task outcomes are never linked and the durable recovery context is absent.

Three further P1 issues break core spec guarantees: item-only custom fields are not
rendered anywhere, partial batches disable the fields that failed items must edit
before retry, and `primaryCompanyId` is not tenant-verified on update (cross-tenant
company disclosure).

---

## Verification Evidence

| Check | Result | Evidence |
|---|---|---|
| Type check `npx tsc --noEmit` | Pass | exit 0 |
| Lint `npm run lint` | Pass (0 errors) | 9 pre-existing warnings in unrelated files |
| Focused batch suites (20 files, 86 tests) | Pass | services, lib, api, component tests all green |
| Chromium batch workflow `npm run test:browser -- __tests__/browser/document-generation-batch.browser.test.tsx` | Pass | 1 test — fully mocked, does not load the page |
| Full unit suite `npm run test:run` | Pass | 2096 passed, 31 skipped |
| PostgreSQL integration `__tests__/integration/document-generation-batch.postgres.test.ts` | Skipped | 5 tests skipped (no integration DB) |
| Production build `npm run build` | Not completed | aborted before completion |
| Manual reproduction `/generated-documents/generate` | **Fail** | "Something went wrong"; console `TypeError: y.get is not a function` |

The green gates do not exercise the deployed page, the real create→save contract, or
real task-context propagation, so they do not contradict the findings below.

---

## P0 Findings — Block the reported page and the core create/save path

### GEN-REV-001 — Generate page crashes reading search parameters

| Field | Value |
|---|---|
| **Priority** | **P0** |
| **Page load** | `src/app/(dashboard)/generated-documents/generate/page.tsx:168-192` |
| **Broken `.get` calls** | `src/app/(dashboard)/generated-documents/generate/page.tsx:189-192` |
| **Masking test** | `__tests__/components/document-generation-generate-page.test.tsx:163-164`, `:193-199` |

##### Evidence

The page is a `'use client'` component, so Next does not pass a `searchParams` prop to
it. The component nevertheless declares `searchParams?: Promise<URLSearchParams>` and
resolves the prop, then falls back to `useSearchParams()`:

```ts
const searchParams = propParams ?? hookParams;          // page.tsx:188
const requestedBatchId = searchParams.get('batch');     // page.tsx:189  ← throws
```

`useSearchParams()` is invoked without a `<Suspense>` boundary, and `propParams` stays
`null` because `propSearchParams` is `undefined` for a client page. At runtime
`searchParams` is therefore not a `URLSearchParams`, and the first `.get(...)` throws
`TypeError: y.get is not a function`, caught by the global error boundary and rendered
as "Something went wrong".

The focused test passes only because it renders the component with
`searchParams={Promise.resolve(new URLSearchParams({ draft }))}` — a shape the real
Next runtime never provides to a client page — and mocks `fetch` to return valid DTOs.

##### Impact

The entry point for the entire feature is unusable: new batch creation, resume
(`?batch=`), legacy adoption (`?draft=`), and template links (`?templateId=`) all die
before any fetch.

##### Required Action

Wrap the `useSearchParams()` consumer (or the page body) in `<Suspense>` and stop
treating `searchParams` as a `Promise<URLSearchParams>` prop. Add a page-level test
that renders the component without injecting the prop (mocking `useSearchParams`) so
the real runtime path is exercised.

---

### GEN-REV-002 — First save of a new batch is rejected (stale local identity)

| Field | Value |
|---|---|
| **Priority** | **P0** |
| **Create then save** | `src/components/documents/generation-batch/use-document-generation-batch.ts:124-151` |
| **Stale identity in payload** | `src/components/documents/generation-batch/use-document-generation-batch.ts:55-73` |
| **Local item has no `id`** | `src/components/documents/generation-batch/batch-workspace-state.ts:130-147` |
| **`activeItemId` is the template ID** | `src/components/documents/generation-batch/batch-workspace-state.ts:166`, `:296-300` |
| **Rejecting schema** | `src/lib/validations/document-generation-batch.ts:92-99` |

##### Evidence

`persist()` creates the batch, extracts only `id`/`revision` from the response, and
then builds the PUT payload from the pre-create local state:

```ts
const created = await createDocumentGenerationBatch({ items: [...] }); // server item ids assigned
batchId = created.id; revision = created.revision;
const updateInput = buildUpdateInput({ ...current, batch: { ...current.batch, id: batchId, revision } });
await saveDocumentGenerationBatch(batchId, updateInput);
```

The server-assigned item IDs are never reconciled into local state before the save.
`itemFromTemplate()` sets no `id`, and `template/add` sets `activeItemId` to
`items[0].key` (the template UUID). `buildUpdateInput()` therefore emits
`items[].id = undefined` and `activeItemId = <template UUID>`.

`updateDocumentGenerationBatchSchema` rejects this in `superRefine` ("Active item must
belong to the batch"), and even past that, `activeItemId` would violate its foreign key
to `document_generation_batch_items.id`.

##### Impact

A genuinely new batch (single or multi-template) cannot be saved at all. Save Draft,
Continue, and the save-before-preview/review/generate dance all depend on `persist()`.

##### Required Action

After `createDocumentGenerationBatch`, reconcile the created batch's item IDs and
`activeItemId` into local state (or derive the update input from the create response),
then save. Add a regression that drives the real `createDocumentGenerationBatch` →
`saveDocumentGenerationBatch` sequence with a stub asserting server IDs are echoed.

---

### GEN-REV-003 — Task-launch context is never propagated to generation

| Field | Value |
|---|---|
| **Priority** | **P0** |
| **Client omits context on create** | `src/components/documents/generation-batch/use-document-generation-batch.ts:134-141` |
| **Client sends context only on update** | `src/components/documents/generation-batch/use-document-generation-batch.ts:70-72` |
| **Update stores it unwrapped** | `src/services/document-generation-batch/lifecycle.service.ts:632-636` |
| **Generator expects a wrapper** | `src/services/document-generation-batch/generation.service.ts:62-73`, `:346`, `:469-476` |
| **Create-side wrapper (unused)** | `src/services/document-generation-batch/lifecycle.service.ts:48-58`, `:208` |

##### Evidence

The POST route validates and preflights `taskContext` (`src/app/api/document-generation-batches/route.ts:52-70`)
and `createDocumentGenerationBatch` stores it wrapped as `{ taskIntegrationContext: {...} }`
via `taskMetadata`. But the client never sends it on create — `createDocumentGenerationBatch`
is called with only `items` and `legacyDraftId`.

The context is sent later on the PUT (`buildUpdateInput`), but
`updateDocumentGenerationBatch` stores `input.taskContext` **raw** into `batch.taskContext`.
`taskLaunchContextFromBatch` then looks for a `taskIntegrationContext` wrapper that is
never produced on this path, so `taskContext` is `undefined` during generation and
`linkFirstGeneratedDocumentTaskOutcomeForBatch` never runs.

Compounding this, `updateDocumentGenerationBatch` writes child-document metadata as
`{ taskIntegrationContext: current.taskContext }` where `current.taskContext` is already
wrapped, producing a nested double-wrap (`lifecycle.service.ts:543`).

##### Impact

Generating from a task stage does not link the generated-document outcome back to the
task, and the durable `taskIntegrationContext` metadata that
`recoverTaskStageOutcomeFromDurableContext` relies on is absent — violating the spec's
"propagation of task-launch context to every generated output" requirement.

##### Required Action

Send the parsed `taskContext` on create; store one canonical shape (either raw or
wrapped) in `batch.taskContext` and child metadata consistently; and have
`taskLaunchContextFromBatch` read that same shape. Add a service test asserting a
generation with task context calls `linkFirstGeneratedDocumentTaskOutcomeForBatch`.

---

## P1 Findings — Break core spec guarantees

### GEN-REV-004 — Item-only custom fields are never rendered or editable

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Standard configurator** | `src/components/documents/generation-batch/batch-item-configurator.tsx:56` |
| **Service Agreement configurator** | `src/components/documents/generation-batch/service-agreement-config.tsx:146` |

`BatchItemConfigurator` passes `templateFields={[]}` and `ServiceAgreementConfig` passes
`fields={[]}`, so no template's own (non-master) custom fields are shown. The spec's
configure stage requires "item-only custom fields" for standard templates and "custom
fields" for Service Agreement templates. The template DTO already carries `placeholders`
(`page.tsx` `mapTemplate`), but the workspace never derives or threads per-template
fields into the configurators.

##### Impact

Documents whose templates require item-specific fields can never be completed, so
preview validation will permanently block generation for those templates.

##### Required Action

Derive per-item custom fields (from the template DTO's placeholders) and pass them to
`StandardDocumentConfig`/`ServiceAgreementConfig`, excluding master fields and
Service-Agreement structured data as specified.

---

### GEN-REV-005 — Partial batches disable the fields failed items must edit before retry

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Capability derivation** | `src/components/documents/generation-batch/batch-workspace-state.ts:210-218` |
| **Configurator disabled** | `src/components/documents/generation-batch/document-generation-batch-workspace.tsx:308` |

`deriveCapabilities` sets `canEditComposition: !hasGenerated`, and the workspace passes
`disabled={!state.capabilities.canEditComposition}` to `BatchItemConfigurator`. As soon
as one item is `GENERATED` (a PARTIAL batch), the entire configurator — including
item-specific fields and master-field overrides — becomes read-only.

The spec's Partial-Batch Editing Rules require that after the first success, only
composition/ordering/company/master values freeze, while "Failed and incomplete items
may still change item-specific fields and master-field overrides before retry."

##### Impact

A user with a partial batch cannot correct the failed item and retry, defeating the
partial-success/retry product decision.

##### Required Action

Split composition editing (templates/ordering) from per-item configuration. Keep the
configurator editable for non-`GENERATED` items regardless of batch status; freeze only
composition and shared setup.

---

### GEN-REV-006 — `primaryCompanyId` is not tenant-verified on update

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Unchecked write** | `src/services/document-generation-batch/lifecycle.service.ts:619-622` |
| **Company exposed in DTO** | `src/services/document-generation-batch/mapper.ts:111`, `types.ts:25-28` |

`updateDocumentGenerationBatch` stores `input.primaryCompanyId` without checking that the
company belongs to the tenant (contrast `resolveTemplates`, which verifies `tenantId`).
`batchInclude` then selects `primaryCompany` by relation and `mapBatchToDto` returns it,
and generation renders that company into documents.

##### Impact

A stale or forged `primaryCompanyId` for another tenant's company is accepted, and the
other tenant's company name/uen are disclosed through the batch DTO and rendered into
generated content — a cross-tenant isolation defect.

##### Required Action

Resolve and tenant-scope the company before persisting (and before rendering),
rejecting companies outside the tenant.

---

### GEN-REV-007 — Preflight ignores `expectedRevision` and does not claim the revision

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Preflight** | `src/services/document-generation-batch/generation.service.ts:206-230` |
| **Claim helper (generate/retry only)** | `src/services/document-generation-batch/generation.service.ts:252-267` |

The spec states "Every mutation accepts `expectedRevision`." `preflightDocumentGenerationBatch`
accepts the field but never uses it: it does not perform the optimistic
`updateMany(where revision = expectedRevision)` claim that generate/retry use. A
concurrent save can be silently overwritten by preflight's diagnostic writes.

##### Required Action

Apply the same revision claim in preflight, or document and enforce that preflight is
read-only (no `persistDiagnostics` writes) — currently it writes and therefore must
participate in optimistic concurrency.

---

## P2 Findings — Follow-up quality issues

### GEN-REV-008 — Dead branches in the preview service

- `src/services/document-generation-batch/preview.service.ts:231` assigns
  `status: diagnostics.errors.length > 0 ? 'NEEDS_INPUT' : 'NEEDS_INPUT'` — a dead
  ternary. It is benign (review is the step that promotes to `READY`) but misleading.
- `src/services/document-generation-batch/preview.service.ts:88-91` calls
  `loadMasterCatalogueForTemplateIds` and discards the result.

### GEN-REV-009 — Raw error messages are persisted and exposed

`generation.service.ts:47-60` (`safeFailure`) stores `error.message` verbatim in
`lastError`, which is returned in DTOs and rendered to users. `renderTemplateForGeneration`
throws raw `Error(...)` messages that can include internal context. Prefer stable
user-safe codes/messages with details kept in server logs.

### GEN-REV-010 — Child-document task metadata is double-wrapped

`lifecycle.service.ts:543` writes `taskIntegrationContext: current.taskContext` where
`current.taskContext` is already `{ taskIntegrationContext: {...} }`, producing a nested
wrapper. Fold into the GEN-REV-003 canonicalization.

---

## Coverage Gaps

| Gap | Detail |
|---|---|
| Nominal browser test never loads the page | `__tests__/browser/document-generation-batch.browser.test.tsx` mounts `DocumentGenerationBatchWorkspace` directly and mocks `@/lib/document-generation-batch-api`, so it does not exercise the Next page, the `searchParams` crash, or real route responses. |
| Page test uses a non-production prop shape | `__tests__/components/document-generation-generate-page.test.tsx` injects `searchParams={Promise.resolve(new URLSearchParams(...))}`, hiding GEN-REV-001 and GEN-REV-002. |
| Create→save contract untested end to end | No test drives `createDocumentGenerationBatch` followed by `saveDocumentGenerationBatch` with server-assigned IDs echoed into local state, so GEN-REV-002 is invisible. |
| Task-context propagation untested | `task-module-integrations.test.ts` covers the legacy single-document paths, not the batch create/save/generate context flow (GEN-REV-003). |
| PostgreSQL integration suite skipped | `__tests__/integration/document-generation-batch.postgres.test.ts` (5 tests) is skipped in the full run, leaving unique constraints, concurrent claims, stale-claim reclaim, and incomplete-child visibility unverified against a real database. |
| Production build not completed | `npm run build` was aborted before completion during this review; treat build as unverified. |

---

## Acceptance Recommendation

Do not accept the implementation as-is. The feature's entry page is unusable (GEN-REV-001),
new batches cannot be saved (GEN-REV-002), and task-context propagation is broken
(GEN-REV-003). Fix the three P0s and the four P1s, add the missing end-to-end and page-level
tests, and re-run the full gate (`db:generate`, `tsc`, `lint`, `test:run`, `build`) with the
PostgreSQL integration suite enabled before re-review.
