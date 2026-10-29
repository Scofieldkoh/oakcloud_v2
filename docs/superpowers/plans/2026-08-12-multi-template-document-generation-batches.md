# Multi-Template Document Generation Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-template generation with a resumable, unified batch workspace that creates separate documents from mixed standard and Service Agreement templates, including server-derived master fields, per-document overrides, editable review, partial success, and targeted retry.

**Architecture:** Add first-class `DocumentGenerationBatch` and ordered `DocumentGenerationBatchItem` records around the existing `GeneratedDocument` lifecycle. Keep rendering and Service Agreement persistence authoritative on the server, split the UI into a reducer-backed four-stage workspace, and execute only persisted, reviewed items through idempotent per-item claims with a concurrency limit of three.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.7, Prisma 7/PostgreSQL, Zod 3, Vitest 4, Testing Library, Vitest Browser/Playwright, Tailwind CSS, dnd-kit.

## Global Constraints

- The approved specification is `docs/superpowers/specs/2026-08-12-multi-template-document-generation-batches-design.md`.
- A batch contains 1–20 distinct active templates and produces one separate `GeneratedDocument` per template.
- One nullable-at-draft-time primary company becomes mandatory before Configure can complete and applies to every item; Service Agreements may add related entities.
- The visible stages are exactly Documents, Shared setup, Configure, and Review & generate for every composition type.
- Master fields match only normalized custom placeholder key plus canonical type; item override wins over master value, which wins over the template default.
- Service Agreement services, fees, terms, representative, and entities remain item-specific and persist transactionally with the batch.
- Save Draft is explicit; Continue, Preview, Review, Generate All, and Retry may persist as part of the user-triggered action, but no timer or background auto-save is added.
- Preflight generates no outputs when any remaining item is invalid; execution-time success is preserved independently.
- Generation runs at a maximum concurrency of three, and a `GENERATING` claim older than 15 minutes is retryable.
- Generated items are immutable inside the batch and are never generated twice.
- Incomplete batch child documents remain hidden from ordinary document search and direct document detail access.
- Existing task context is copied into every generated document's metadata; because `TaskStageOutcome.taskStageId` is currently unique, the first successful item by `displayOrder` is the one authoritative task-stage outcome.
- Use existing dependencies and Oakcloud components; add no package dependency.
- Follow `docs/guides/DESIGN_GUIDELINE.md`: compact four-pixel-grid layouts, subtle borders, light/dark themes, semantic status colors, and 44px mobile touch targets.
- Preserve unrelated working-tree changes and update existing documentation under `docs/` rather than creating parallel reference files.

---

## File Structure

### Database and contracts

- Modify `prisma/schema.prisma` for batch models, enums, and relations.
- Create `prisma/migrations/20260812010000_document_generation_batches/migration.sql` for the relational schema.
- Create `src/types/document-generation.ts` for shared template/company/contact/partial option types previously owned by the wizard.
- Create `src/types/document-generation-batch.ts` for API DTOs, master fields, item diagnostics, and generation results.
- Create `src/lib/validations/document-generation-batch.ts` for every batch route payload.
- Create `src/lib/document-generation-master-fields.ts` for pure catalogue and effective-value logic.
- Create `src/lib/document-generation-fingerprint.ts` for canonical hashing.

### Server domain

- Create `src/services/document-generation-batch/types.ts` for internal includes and render inputs.
- Create `src/services/document-generation-batch/mapper.ts` for JSON parsing and DTO mapping.
- Create `src/services/document-generation-batch/lifecycle.service.ts` for create/list/get/save/discard/adopt.
- Create `src/services/document-generation-batch/preview.service.ts` for preview, review, fingerprint, and stale detection.
- Create `src/services/document-generation-batch/generation.service.ts` for preflight, claims, bounded execution, and retry.
- Create `src/services/document-generation-batch/index.ts` as the public server export.
- Modify `src/services/document-generator.service.ts` to materialize a template into an authorized existing child document and to hide incomplete batch children.
- Modify `src/services/service-agreement/draft.service.ts` only where a transaction-safe batch synchronization helper is required.

### API routes

- Create `src/app/api/document-generation-batches/route.ts`.
- Create `src/app/api/document-generation-batches/[id]/route.ts`.
- Create `src/app/api/document-generation-batches/[id]/preflight/route.ts`.
- Create `src/app/api/document-generation-batches/[id]/generate/route.ts`.
- Create `src/app/api/document-generation-batches/[id]/items/[itemId]/preview/route.ts`.
- Create `src/app/api/document-generation-batches/[id]/items/[itemId]/review/route.ts`.
- Create `src/app/api/document-generation-batches/[id]/items/[itemId]/retry/route.ts`.

### Frontend domain and UI

- Create `src/lib/document-generation-batch-api.ts` for typed fetch calls.
- Create `src/components/documents/generation-batch/batch-workspace-state.ts` for reducer state, actions, dirty snapshots, and selectors.
- Create `src/components/documents/generation-batch/use-document-generation-batch.ts` for orchestration.
- Create `src/components/documents/generation-batch/batch-template-picker.tsx`.
- Create `src/components/documents/generation-batch/batch-shared-setup.tsx`.
- Create `src/components/documents/generation-batch/batch-document-queue.tsx`.
- Create `src/components/documents/generation-batch/batch-custom-field-form.tsx`.
- Create `src/components/documents/generation-batch/standard-document-config.tsx`.
- Create `src/components/documents/generation-batch/service-agreement-config.tsx`.
- Create `src/components/documents/generation-batch/batch-item-configurator.tsx`.
- Create `src/components/documents/generation-batch/batch-review-workspace.tsx`.
- Create `src/components/documents/generation-batch/batch-generation-results.tsx`.
- Create `src/components/documents/generation-batch/document-generation-batch-workspace.tsx`.
- Create `src/components/documents/generation-batch/generation-batch-list.tsx`.
- Create `src/components/documents/generation-batch/index.ts`.
- Create `src/hooks/use-document-party-options.ts` by extracting tenant-safe party loading from the old wizard.
- Modify `src/app/(dashboard)/generated-documents/generate/page.tsx`, `src/app/(dashboard)/generated-documents/page.tsx`, and `src/components/documents/index.ts`.
- Modify Service Agreement components to import shared types from `src/types/document-generation.ts`.
- Delete `src/components/documents/document-generation-wizard.tsx`, `src/components/documents/document-generation-stage.ts`, and `src/components/documents/template-selector.tsx` only after the new route and legacy adapter tests pass.

---

### Task 1: Add the Batch Relational Schema

**Files:**
- Create: `prisma/migrations/20260812010000_document_generation_batches/migration.sql`
- Modify: `prisma/schema.prisma`
- Generate: `src/generated/prisma/**`
- Test: `__tests__/services/document-generation-batch-schema.test.ts`

**Interfaces:**
- Produces: Prisma models `DocumentGenerationBatch`, `DocumentGenerationBatchItem`.
- Produces: enums `DocumentGenerationBatchStatus` and `DocumentGenerationBatchItemStatus`.
- Produces: optional one-to-one `GeneratedDocument.batchItem`.

- [ ] **Step 1: Write the failing schema contract test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync(
  'prisma/migrations/20260812010000_document_generation_batches/migration.sql',
  'utf8',
);

describe('document generation batch schema', () => {
  it('defines aggregate, item, status, ordering, and unique output ownership', () => {
    expect(schema).toContain('model DocumentGenerationBatch {');
    expect(schema).toContain('model DocumentGenerationBatchItem {');
    expect(schema).toContain('@@unique([batchId, templateId])');
    expect(schema).toContain('generatedDocumentId String');
    expect(schema).toContain('@unique @map("generated_document_id")');
    expect(schema).toContain('enum DocumentGenerationBatchItemStatus');
    expect(migration).toContain('CREATE TABLE "document_generation_batches"');
    expect(migration).toContain('CREATE TABLE "document_generation_batch_items"');
  });
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `npm.cmd run test:run -- __tests__/services/document-generation-batch-schema.test.ts`

Expected: FAIL because the migration and models do not exist.

- [ ] **Step 3: Add the Prisma models and relations**

Add these model shapes, including inverse relations on `Workspace`, `User`, `Company`, `DocumentTemplate`, and `GeneratedDocument`:

```prisma
model DocumentGenerationBatch {
  id                  String                        @id @default(uuid())
  tenantId            String                        @map("tenant_id")
  primaryCompanyId    String?                       @map("primary_company_id")
  createdById         String                        @map("created_by_id")
  activeItemId        String?                       @map("active_item_id")
  currentStage        Int                           @default(0) @map("current_stage")
  revision            Int                           @default(0)
  status              DocumentGenerationBatchStatus @default(DRAFT)
  masterFieldValues   Json                          @default("{}") @map("master_field_values")
  taskContext         Json?                         @map("task_context")
  createdAt           DateTime                      @default(now()) @map("created_at")
  updatedAt           DateTime                      @updatedAt @map("updated_at")
  deletedAt           DateTime?                     @map("deleted_at")
  tenant              Workspace                     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  primaryCompany      Company?                      @relation("DocumentGenerationBatchPrimaryCompany", fields: [primaryCompanyId], references: [id], onDelete: Restrict)
  createdBy           User                          @relation("DocumentGenerationBatchCreator", fields: [createdById], references: [id], onDelete: Restrict)
  items               DocumentGenerationBatchItem[] @relation("DocumentGenerationBatchItems")
  activeItem          DocumentGenerationBatchItem?  @relation("ActiveDocumentGenerationBatchItem", fields: [activeItemId], references: [id], onDelete: SetNull)

  @@index([tenantId, status, updatedAt])
  @@index([tenantId, primaryCompanyId])
  @@index([tenantId, deletedAt])
  @@map("document_generation_batches")
}

model DocumentGenerationBatchItem {
  id                    String                               @id @default(uuid())
  tenantId              String                               @map("tenant_id")
  batchId               String                               @map("batch_id")
  templateId            String                               @map("template_id")
  generatedDocumentId   String                               @unique @map("generated_document_id")
  templateVersion       Int                                  @map("template_version")
  displayOrder          Int                                  @map("display_order")
  status                DocumentGenerationBatchItemStatus    @default(NOT_STARTED)
  configuration         Json                                 @default("{}")
  previewContent        String?                              @map("preview_content")
  editedContent         String?                              @map("edited_content")
  editedContentJson     Json?                                @map("edited_content_json")
  previewFingerprint    String?                              @map("preview_fingerprint") @db.VarChar(64)
  reviewedFingerprint   String?                              @map("reviewed_fingerprint") @db.VarChar(64)
  validationDiagnostics Json?                                @map("validation_diagnostics")
  lastError             Json?                                @map("last_error")
  generationAttemptId   String?                              @map("generation_attempt_id") @db.VarChar(36)
  generationClaimedAt   DateTime?                            @map("generation_claimed_at")
  createdAt             DateTime                             @default(now()) @map("created_at")
  updatedAt             DateTime                             @updatedAt @map("updated_at")
  tenant                Workspace                            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  batch                 DocumentGenerationBatch             @relation("DocumentGenerationBatchItems", fields: [batchId], references: [id], onDelete: Cascade)
  template              DocumentTemplate                    @relation(fields: [templateId], references: [id], onDelete: Restrict)
  generatedDocument     GeneratedDocument                   @relation(fields: [generatedDocumentId], references: [id], onDelete: Cascade)
  activeForBatches      DocumentGenerationBatch[]            @relation("ActiveDocumentGenerationBatchItem")

  @@unique([batchId, templateId])
  @@unique([batchId, displayOrder])
  @@index([tenantId, batchId, displayOrder])
  @@index([tenantId, status, generationClaimedAt])
  @@map("document_generation_batch_items")
}

enum DocumentGenerationBatchStatus {
  DRAFT
  PARTIAL
  COMPLETED
}

enum DocumentGenerationBatchItemStatus {
  NOT_STARTED
  NEEDS_INPUT
  READY
  GENERATING
  GENERATED
  FAILED
  BLOCKED
}
```

- [ ] **Step 4: Write the SQL migration with matching enums, indexes, unique constraints, and foreign keys**

Create the batch table first without the active-item foreign key, create the item table, add all other foreign keys, then add `document_generation_batches_active_item_id_fkey`. Use `ON DELETE SET NULL` for the active item, `ON DELETE CASCADE` for tenant/batch/generated-document ownership, and `ON DELETE RESTRICT` for selected templates, primary company, and creator.

- [ ] **Step 5: Generate Prisma output and run the schema test**

Run: `npm.cmd run db:generate`

Run: `npm.cmd run test:run -- __tests__/services/document-generation-batch-schema.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the schema slice**

```powershell
git add prisma/schema.prisma prisma/migrations/20260812010000_document_generation_batches src/generated/prisma __tests__/services/document-generation-batch-schema.test.ts
git commit -m "feat(document-generation): add batch persistence schema"
```

---

### Task 2: Define Batch Contracts, Master Fields, and Fingerprints

**Files:**
- Create: `src/types/document-generation.ts`
- Create: `src/types/document-generation-batch.ts`
- Create: `src/lib/validations/document-generation-batch.ts`
- Create: `src/lib/document-generation-master-fields.ts`
- Create: `src/lib/document-generation-fingerprint.ts`
- Modify: `src/lib/errors.ts`
- Test: `__tests__/lib/document-generation-batch-validation.test.ts`
- Test: `__tests__/lib/document-generation-master-fields.test.ts`
- Test: `__tests__/lib/document-generation-fingerprint.test.ts`

**Interfaces:**
- Produces: `BatchItemConfiguration`, `DocumentGenerationBatchDto`, `DocumentGenerationBatchItemDto`, `MasterFieldCatalogue`, `BatchGenerationResult`.
- Produces: `createDocumentGenerationBatchSchema`, `updateDocumentGenerationBatchSchema`, `batchItemMutationSchema`, `batchPreviewSchema`, `batchReviewSchema`, `batchExecutionSchema`.
- Produces: `deriveMasterFieldCatalogue()`, `resolveEffectiveCustomData()`, `createPreviewFingerprint()`, `createReviewedFingerprint()`.

- [ ] **Step 1: Write validation and master-field tests**

```ts
it('accepts 1 to 20 distinct ordered templates and rejects duplicates', () => {
  expect(createDocumentGenerationBatchSchema.safeParse(validBatchInput()).success).toBe(true);
  expect(createDocumentGenerationBatchSchema.safeParse({
    ...validBatchInput(),
    items: [validItem(templateA), validItem(templateA)],
  }).success).toBe(false);
});

it('groups only matching normalized key and canonical type', () => {
  const catalogue = deriveMasterFieldCatalogue([
    templateFields('template-a', [{ key: 'custom.engagement_date', type: 'date', label: 'Date' }]),
    templateFields('template-b', [{ key: 'engagement_date', type: 'date', label: 'Engagement date' }]),
    templateFields('template-c', [{ key: 'engagement_date', type: 'text', label: 'Date text' }]),
  ]);

  expect(catalogue.fields).toEqual([
    expect.objectContaining({ id: 'engagement_date::date', templateIds: ['template-a', 'template-b'] }),
  ]);
  expect(catalogue.conflicts).toEqual([
    { key: 'engagement_date', types: ['date', 'text'] },
  ]);
});

it('resolves override, master value, template default, then unresolved', () => {
  expect(resolveEffectiveCustomData({
    templateFields: definitions,
    masterValues: { 'engagement_date::date': '2026-08-12' },
    overrides: { 'engagement_date::date': '' },
    itemValues: {},
  }).engagement_date).toBe('');
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/lib/document-generation-batch-validation.test.ts __tests__/lib/document-generation-master-fields.test.ts __tests__/lib/document-generation-fingerprint.test.ts`

Expected: FAIL because the contracts and helpers do not exist.

- [ ] **Step 3: Add shared option and batch DTO types**

Define these stable shapes in `src/types/document-generation-batch.ts`:

```ts
export type BatchItemStatus =
  | 'NOT_STARTED' | 'NEEDS_INPUT' | 'READY' | 'GENERATING'
  | 'GENERATED' | 'FAILED' | 'BLOCKED';

export interface ServiceAgreementWorkspaceState {
  authorizedContactId: string | null;
  entityIds: string[];
  agreementDate: string;
  effectiveDate: string | null;
  termMonths: number;
  items: ServiceAgreementItemInput[];
}

export interface BatchItemConfiguration {
  version: 1;
  title: string;
  contactIds: string[];
  selectedDirectorId: string | null;
  selectedShareholderId: string | null;
  selectedContactId: string | null;
  itemValues: Record<string, string>;
  masterOverrides: Record<string, string>;
  useLetterhead: boolean;
  serviceAgreement: ServiceAgreementWorkspaceState | null;
}

export interface MasterFieldDefinition {
  id: string;
  key: string;
  type: PlaceholderValueType;
  label: string;
  templateIds: string[];
  requiredTemplateIds: string[];
  defaultsByTemplateId: Record<string, string>;
}

export interface MasterFieldCatalogue {
  fields: MasterFieldDefinition[];
  conflicts: Array<{ key: string; types: PlaceholderValueType[] }>;
}
```

The `ServiceAgreementWorkspaceState` is the resumable editor value. On save, the server validates and synchronizes it into the relational agreement when complete; when incomplete, it remains persisted in item configuration and blocks preflight without losing user input.

- [ ] **Step 4: Implement strict Zod route contracts**

Use `.strict()`, UUID validation, maximum string lengths, 1–20 item limits, unique template IDs, unique display orders, and a shared `expectedRevision: z.number().int().min(0)`. The create schema accepts an optional `legacyDraftId`; when present it requires exactly one item and is routed to idempotent adoption. Reuse `serviceAgreementItemSchema` for entered items while allowing an empty item array and nullable authorised contact in `serviceAgreementWorkspaceSchema`.

```ts
export const batchItemConfigurationSchema = z.object({
  version: z.literal(1),
  title: z.string().max(300),
  contactIds: z.array(uuid).max(100),
  selectedDirectorId: uuid.nullable(),
  selectedShareholderId: uuid.nullable(),
  selectedContactId: uuid.nullable(),
  itemValues: z.record(z.string().max(10_000)),
  masterOverrides: z.record(z.string().max(10_000)),
  useLetterhead: z.boolean(),
  serviceAgreement: serviceAgreementWorkspaceSchema.nullable(),
}).strict();

export const batchExecutionSchema = z.object({
  expectedRevision: z.number().int().min(0),
}).strict();
```

- [ ] **Step 5: Implement pure master-field discovery and value resolution**

Normalize keys with `normalizePlaceholderKey()`, normalize types through the existing placeholder normalization rules, sort IDs and conflict types deterministically, include only key/type groups spanning at least two templates, and use property presence rather than truthiness for overrides. Exclude built-in company/contact context and structured Service Agreement fields. When the selected-template set changes, preserve values only for stable master IDs still present in the newly derived server catalogue.

- [ ] **Step 6: Implement canonical SHA-256 fingerprints**

```ts
export function createPreviewFingerprint(input: PreviewFingerprintInput): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

export function createReviewedFingerprint(input: {
  previewFingerprint: string;
  editedContent: string;
  editedContentJson: unknown;
}): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}
```

`canonicalJson()` must sort object keys recursively and retain array order.

- [ ] **Step 7: Add a 422 error type and run the tests**

```ts
export class UnprocessableEntityError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(ErrorCodes.VALIDATION_ERROR, message, 422, details);
    this.name = 'UnprocessableEntityError';
  }
}
```

Run: `npm.cmd run test:run -- __tests__/lib/document-generation-batch-validation.test.ts __tests__/lib/document-generation-master-fields.test.ts __tests__/lib/document-generation-fingerprint.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the contracts slice**

```powershell
git add src/types/document-generation.ts src/types/document-generation-batch.ts src/lib/validations/document-generation-batch.ts src/lib/document-generation-master-fields.ts src/lib/document-generation-fingerprint.ts src/lib/errors.ts __tests__/lib/document-generation-batch-validation.test.ts __tests__/lib/document-generation-master-fields.test.ts __tests__/lib/document-generation-fingerprint.test.ts
git commit -m "feat(document-generation): define batch contracts and master fields"
```

---

### Task 3: Create, List, Resume, and Hide Batch Drafts

**Files:**
- Create: `src/services/document-generation-batch/types.ts`
- Create: `src/services/document-generation-batch/mapper.ts`
- Create: `src/services/document-generation-batch/lifecycle.service.ts`
- Create: `src/services/document-generation-batch/index.ts`
- Modify: `src/services/document-generator.service.ts`
- Test: `__tests__/services/document-generation-batch-lifecycle.service.test.ts`
- Test: `__tests__/services/document-generator.service.test.ts`

**Interfaces:**
- Produces: `createDocumentGenerationBatch(input, params, taskContext?)`.
- Produces: `listDocumentGenerationBatches(params)` and `getDocumentGenerationBatch(id, params)`.
- Produces: `mapBatchToDto()` returning server-derived master fields and ordered items.
- Changes: ordinary generated-document reads exclude children whose batch-item status is not `GENERATED`.

- [ ] **Step 1: Write failing lifecycle and visibility tests**

```ts
it('creates one hidden generated-document child per ordered item', async () => {
  const result = await createDocumentGenerationBatch(input, actor);
  expect(prismaMock.generatedDocument.create).toHaveBeenCalledTimes(3);
  expect(result.items.map((item) => item.displayOrder)).toEqual([0, 1, 2]);
});

it('lists only active draft and partial batches in tenant scope', async () => {
  await listDocumentGenerationBatches({ tenantId, userId });
  expect(prismaMock.documentGenerationBatch.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { tenantId, deletedAt: null, status: { in: ['DRAFT', 'PARTIAL'] } },
    }),
  );
});

it('excludes incomplete batch children from document search', async () => {
  await searchGeneratedDocuments(searchInput, tenantId);
  expect(prismaMock.generatedDocument.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { OR: [{ batchItem: null }, { batchItem: { status: 'GENERATED' } }] },
        ]),
      }),
    }),
  );
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/services/document-generation-batch-lifecycle.service.test.ts __tests__/services/document-generator.service.test.ts`

Expected: FAIL because batch lifecycle functions do not exist.

- [ ] **Step 3: Implement one authoritative include and mapper**

Use one ordered include for batch, company, creator, items, template, generated document, and optional Service Agreement. Parse every JSON column through its Zod schema; corrupted data must throw a safe `ValidationError` rather than leaking an unchecked cast.

```ts
export function mapBatchToDto(
  batch: BatchWithRelations,
  catalogue: MasterFieldCatalogue,
): DocumentGenerationBatchDto;
```

- [ ] **Step 4: Implement transactional creation**

Within one Prisma transaction:

1. resolve distinct active tenant templates;
2. resolve the optional tenant company;
3. create the batch at revision `0`;
4. create one empty `GeneratedDocument` child per item;
5. create each batch item with the child ID and template version;
6. set `activeItemId` to the first item;
7. write one batch CREATE audit record.

An empty title uses `Untitled - [Template Name]`; a stage-one batch may have `primaryCompanyId = null`.

- [ ] **Step 5: Implement list/resume and master catalogue derivation**

Load current template and partial metadata in tenant scope, normalize custom placeholders with existing template-analysis helpers, derive the catalogue, and preserve saved master values only for still-present catalogue IDs.

- [ ] **Step 6: Hide incomplete children from document list and detail**

Add the visibility predicate to both `searchGeneratedDocuments()` and `getGeneratedDocumentById()`. Keep batch services on direct tenant-scoped Prisma queries so they can access hidden children internally.

- [ ] **Step 7: Run lifecycle and existing generated-document tests**

Run: `npm.cmd run test:run -- __tests__/services/document-generation-batch-lifecycle.service.test.ts __tests__/services/document-generator.service.test.ts __tests__/api/generated-documents-workspace.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the lifecycle slice**

```powershell
git add src/services/document-generation-batch src/services/document-generator.service.ts __tests__/services/document-generation-batch-lifecycle.service.test.ts __tests__/services/document-generator.service.test.ts
git commit -m "feat(document-generation): add batch draft lifecycle"
```

---

### Task 4: Save, Synchronize, Discard, and Adopt Legacy Sessions

**Files:**
- Modify: `src/services/document-generation-batch/lifecycle.service.ts`
- Modify: `src/services/document-generation-batch/mapper.ts`
- Modify: `src/services/service-agreement/draft.service.ts`
- Modify: `src/lib/document-generation-session.ts`
- Test: `__tests__/services/document-generation-batch-lifecycle.service.test.ts`
- Test: `__tests__/services/document-generation-session.service.test.ts`

**Interfaces:**
- Produces: `updateDocumentGenerationBatch(id, input, params)`.
- Produces: `discardDocumentGenerationBatch(id, input, params)`.
- Produces: `adoptLegacyGenerationSession(draftId, input, params, taskContext?)`.
- Consumes: `expectedRevision` from Task 2.

- [ ] **Step 1: Add failing revision, sync, discard, and adoption tests**

```ts
it('rejects stale revisions without mutating children', async () => {
  prismaMock.documentGenerationBatch.updateMany.mockResolvedValue({ count: 0 });
  await expect(updateDocumentGenerationBatch(batchId, update, actor))
    .rejects.toMatchObject({ statusCode: 409, details: { currentRevision: 4 } });
  expect(prismaMock.documentGenerationBatchItem.update).not.toHaveBeenCalled();
});

it('preserves incomplete Service Agreement workspace state', async () => {
  const saved = await updateDocumentGenerationBatch(batchId, updateWithNoAgreementItems, actor);
  expect(saved.items[0].configuration.serviceAgreement?.items).toEqual([]);
  expect(upsertServiceAgreementDraft).not.toHaveBeenCalled();
});

it('adopts the existing child and agreement instead of creating another output', async () => {
  const adopted = await adoptLegacyGenerationSession(legacyDraftId, adoptionInput, actor);
  expect(adopted.items[0].generatedDocumentId).toBe(legacyDraftId);
  expect(prismaMock.generatedDocument.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the lifecycle tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/services/document-generation-batch-lifecycle.service.test.ts __tests__/services/document-generation-session.service.test.ts`

Expected: FAIL on missing update, discard, and adopt behavior.

- [ ] **Step 3: Implement optimistic whole-batch save**

Start the transaction with:

```ts
const claimed = await tx.documentGenerationBatch.updateMany({
  where: { id, tenantId, deletedAt: null, revision: input.expectedRevision },
  data: { revision: { increment: 1 } },
});
if (claimed.count !== 1) throw await revisionConflict(id, tenantId);
```

Then validate the stage, company, template set, active item, item order, and generated-item immutability. Preserve item IDs for unchanged templates; create/remove hidden children only before any item is generated. Reordering changes `displayOrder` through temporary negative values inside the same transaction so the unique `(batchId, displayOrder)` constraint is never violated.

If any item is already `GENERATED`, reject changes to the selected-template set, order, primary company, and master values. Permit configuration changes only on ungenerated items; generated item configurations and content remain immutable.

Any configuration change to a `FAILED` or `READY` ungenerated item clears its preview/review state as appropriate and moves it to `NEEDS_INPUT`; it must pass preview and review again before retry.

Resolve every submitted company, contact, party, template, and Service Agreement catalogue reference inside `tenantId`. When a previously saved reference is now inactive or unavailable, preserve unaffected configuration, set that item to `BLOCKED`, and return a field-level diagnostic; never substitute another record. Write materially relevant update audit entries without storing full document content.

- [ ] **Step 4: Synchronize Service Agreement workspace state**

Always persist the validated workspace state in item configuration. When `serviceAgreementDraftSchema.safeParse({ primaryCompanyId, ...workspaceState })` succeeds, call `upsertServiceAgreementDraft(generatedDocumentId, parsed.data, params, { tx, skipDocumentCheck: true })`. When it fails, keep the workspace value, retain any previous relational draft for recovery, set the item to `NEEDS_INPUT`, and block preview/preflight from using stale relational data.

- [ ] **Step 5: Implement partial-safe discard**

For every ungenerated item, delete an attached Service Agreement only when its status is `DRAFT`, soft-delete its child document, then soft-delete the batch. Preserve every `GENERATED` child and agreement. Audit the counts of removed and preserved items.

- [ ] **Step 6: Implement one-item legacy adoption**

Read version 1/2 `metadata.generationSession`, preserve preview, edited content, title, contacts, parties, custom fields, letterhead, template layout JSON, and the existing Service Agreement relation. Create the batch and item around the same document ID, then remove only `metadata.generationSession` after the relational aggregate succeeds. Adoption is invoked by the first explicit Save Draft or Continue action, not by merely opening the URL. It is idempotent: if the draft already has a batch item, return its batch.

- [ ] **Step 7: Run the lifecycle/session tests**

Run: `npm.cmd run test:run -- __tests__/services/document-generation-batch-lifecycle.service.test.ts __tests__/services/document-generation-session.service.test.ts __tests__/api/generated-document-generation-sessions-route.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the save/adoption slice**

```powershell
git add src/services/document-generation-batch src/services/service-agreement/draft.service.ts src/lib/document-generation-session.ts __tests__/services/document-generation-batch-lifecycle.service.test.ts __tests__/services/document-generation-session.service.test.ts
git commit -m "feat(document-generation): persist and adopt batch drafts"
```

---

### Task 5: Persist Preview, Manual Edits, Review, and Staleness

**Files:**
- Create: `src/services/document-generation-batch/preview.service.ts`
- Modify: `src/services/document-generation-batch/index.ts`
- Modify: `src/services/document-generation-batch/lifecycle.service.ts`
- Test: `__tests__/services/document-generation-batch-preview.service.test.ts`

**Interfaces:**
- Produces: `previewDocumentGenerationBatchItem(batchId, itemId, input, params)`.
- Produces: `reviewDocumentGenerationBatchItem(batchId, itemId, input, params)`.
- Produces: `buildBatchItemRenderInput()` and `evaluateBatchItemPreview()` for preflight reuse.

- [ ] **Step 1: Write failing preview and review tests**

```ts
it('renders with effective master values and item overrides', async () => {
  await previewDocumentGenerationBatchItem(batchId, itemId, previewInput, actor);
  expect(renderTemplateForGeneration).toHaveBeenCalledWith(
    expect.objectContaining({
      customData: { engagement_date: '2026-09-01', reference: 'MASTER-1' },
      generatedDocumentId,
    }),
  );
});

it('requires explicit replacement before overwriting manual edits', async () => {
  await expect(previewDocumentGenerationBatchItem(
    batchId,
    itemId,
    { expectedRevision: 3, replaceEditedContent: false },
    actor,
  )).rejects.toMatchObject({ statusCode: 409 });
});

it('binds review to preview inputs and persisted editor content', async () => {
  const result = await reviewDocumentGenerationBatchItem(batchId, itemId, reviewInput, actor);
  expect(result.reviewedFingerprint).toBe(createReviewedFingerprint(expectedContent));
  expect(result.status).toBe('READY');
});
```

- [ ] **Step 2: Run the preview tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/services/document-generation-batch-preview.service.test.ts`

Expected: FAIL because preview/review services do not exist.

- [ ] **Step 3: Build tenant-safe render input from persisted state**

Resolve current template, partials, company, contacts, selected parties, effective custom data, current Service Agreement synchronization, actor name, and child document ID. Do not accept these values from preview/review route bodies.

- [ ] **Step 4: Compute and persist preview state**

Render with `mode: 'preview'`, compute a fingerprint from template/dependency versions and canonical inputs, and save content, diagnostics, fingerprint, template version, and cleared review state in one revision-checked transaction. Reject replacement when old edited content differs from old preview content unless `replaceEditedContent` is true.

- [ ] **Step 5: Persist editor changes through whole-batch save**

When `editedContent` or `editedContentJson` changes, clear `reviewedFingerprint` and move `READY` back to `NEEDS_INPUT`. Preserve `previewFingerprint`; editing content does not require rerendering unchanged inputs.

- [ ] **Step 6: Approve the exact persisted content**

Review recalculates the content-bound fingerprint, requires the current preview fingerprint to match current render inputs, requires no blocking errors, stores `reviewedFingerprint`, and changes the item to `READY`.

- [ ] **Step 7: Run preview tests**

Run: `npm.cmd run test:run -- __tests__/services/document-generation-batch-preview.service.test.ts __tests__/services/document-generator.service.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the preview slice**

```powershell
git add src/services/document-generation-batch __tests__/services/document-generation-batch-preview.service.test.ts
git commit -m "feat(document-generation): persist batch preview review state"
```

---

### Task 6: Preflight, Claim, Generate, and Retry Items

**Files:**
- Create: `src/services/document-generation-batch/generation.service.ts`
- Modify: `src/services/document-generation-batch/index.ts`
- Modify: `src/services/document-generator.service.ts`
- Modify: `src/services/tasks/integration.service.ts`
- Test: `__tests__/services/document-generation-batch-generation.service.test.ts`
- Test: `__tests__/services/document-generator.service.test.ts`
- Test: `__tests__/services/task-module-integrations.test.ts`

**Interfaces:**
- Produces: `preflightDocumentGenerationBatch(id, input, params)`.
- Produces: `generateDocumentGenerationBatch(id, input, params, session?)`.
- Produces: `retryDocumentGenerationBatchItem(batchId, itemId, input, params, session?)`.
- Produces: `materializeDocumentFromTemplate(data, params, target)` in `document-generator.service.ts`.

- [ ] **Step 1: Write failing execution tests**

```ts
it('creates no output when any item fails preflight', async () => {
  await expect(preflightDocumentGenerationBatch(batchId, request, actor))
    .rejects.toMatchObject({ statusCode: 422 });
  expect(materializeDocumentFromTemplate).not.toHaveBeenCalled();
});

it('preserves successes and records one execution-time failure', async () => {
  materializeDocumentFromTemplate
    .mockResolvedValueOnce(documentA)
    .mockRejectedValueOnce(new Error('conversion failed'))
    .mockResolvedValueOnce(documentC);

  const result = await generateDocumentGenerationBatch(batchId, request, actor);
  expect(result.successes.map((entry) => entry.documentId)).toEqual([documentA.id, documentC.id]);
  expect(result.failures).toEqual([
    expect.objectContaining({ itemId: itemB, code: 'GENERATION_FAILED' }),
  ]);
  expect(result.batchStatus).toBe('PARTIAL');
});

it('skips generated items and reclaims attempts older than fifteen minutes', async () => {
  const result = await retryDocumentGenerationBatchItem(batchId, failedItemId, retry, actor);
  expect(result.status).toBe('GENERATED');
  expect(materializeDocumentFromTemplate).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run execution tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/services/document-generation-batch-generation.service.test.ts __tests__/services/document-generator.service.test.ts`

Expected: FAIL because execution services and materialization do not exist.

- [ ] **Step 3: Extract authorized existing-document materialization**

Refactor the current create-from-template code so public single-document creation and batch generation share rendering and update logic:

```ts
export interface MaterializeDocumentTarget {
  generatedDocumentId: string;
  expectedBatchItemId?: string;
  serviceAgreementId?: string;
}

export async function materializeDocumentFromTemplate(
  data: CreateDocumentFromTemplateInput,
  params: TenantAwareParams,
  target: MaterializeDocumentTarget,
  taskContext?: TaskLaunchContext,
): Promise<GeneratedDocument>;
```

The function verifies tenant ownership and, for batch targets, exact item/child ownership before updating. `createDocumentFromTemplate()` remains backward compatible and delegates after validating a legacy generation-session draft.

- [ ] **Step 4: Implement exhaustive preflight**

For every ungenerated item, re-render current inputs, recompute preview and reviewed fingerprints, validate parties/custom fields/Service Agreement state, and collect all item/field errors. Persist diagnostics. Throw `UnprocessableEntityError` with `{ items: BatchItemDiagnostics[] }` when any item is not ready; do not claim any item.

- [ ] **Step 5: Implement atomic claims and bounded concurrency**

Claim with `updateMany` on the item ID, batch ID, tenant ID, eligible status, and either no claim or `generationClaimedAt < now - 15 minutes`. Set a UUID attempt ID, `GENERATING`, and claim time. Execute a small worker pool:

```ts
async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await worker(values[index]);
    }
  }));
  return results;
}
```

Call it with limit `3`.

- [ ] **Step 6: Commit each result independently and recompute batch status**

On success, update the child, set item `GENERATED`, clear claim/error, and audit. On failure, set `FAILED`, clear claim, store `{ code, message, occurredAt }`, and audit without a stack trace. Recompute `COMPLETED`, `PARTIAL`, or `DRAFT` from item statuses. Audit generation start, completion/partial completion, targeted retry, and abandoned-claim recovery in addition to the existing per-document and Service Agreement entries.

- [ ] **Step 7: Preserve task integration without overwriting multiple outcomes**

Write `taskIntegrationContext` metadata into every child through materialization. After successes are ordered by `displayOrder`, call `safelyLinkGeneratedDocumentTaskOutcome()` once for the first successful item when no outcome was already linked for the batch. Add a helper that checks the stage's existing generated-document outcome before linking.

- [ ] **Step 8: Implement targeted retry**

Retry one failed or stale-claimed item: validate current revision, run item-only preflight, claim, materialize, record result, recompute batch status, and skip a `GENERATED` item by returning its existing document ID. Reuse one stale-claim helper during resume, batch preflight, and explicit retry so a `GENERATING` item older than 15 minutes is consistently surfaced as retryable.

- [ ] **Step 9: Run execution and task integration tests**

Run: `npm.cmd run test:run -- __tests__/services/document-generation-batch-generation.service.test.ts __tests__/services/document-generator.service.test.ts __tests__/services/task-module-integrations.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit the execution slice**

```powershell
git add src/services/document-generation-batch src/services/document-generator.service.ts src/services/tasks/integration.service.ts __tests__/services/document-generation-batch-generation.service.test.ts __tests__/services/document-generator.service.test.ts __tests__/services/task-module-integrations.test.ts
git commit -m "feat(document-generation): execute batches with partial retry"
```

---

### Task 7: Expose Tenant-Scoped Batch APIs

**Files:**
- Create: `src/app/api/document-generation-batches/route.ts`
- Create: `src/app/api/document-generation-batches/[id]/route.ts`
- Create: `src/app/api/document-generation-batches/[id]/preflight/route.ts`
- Create: `src/app/api/document-generation-batches/[id]/generate/route.ts`
- Create: `src/app/api/document-generation-batches/[id]/items/[itemId]/preview/route.ts`
- Create: `src/app/api/document-generation-batches/[id]/items/[itemId]/review/route.ts`
- Create: `src/app/api/document-generation-batches/[id]/items/[itemId]/retry/route.ts`
- Test: `__tests__/api/document-generation-batch-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 schemas and Task 3–6 services.
- Produces: the exact endpoints approved in the design.

- [ ] **Step 1: Write failing route contract tests**

```ts
it('rejects client-owned tenant IDs and never forwards them', async () => {
  const response = await createBatch(requestWith({ ...payload, tenantId: attackerTenant }));
  expect(response.status).toBe(400);
  expect(createDocumentGenerationBatch).not.toHaveBeenCalled();
});

it('returns conflict details from a stale PUT', async () => {
  updateDocumentGenerationBatch.mockRejectedValue(
    new ConflictError('Batch changed', { currentRevision: 8 }),
  );
  const response = await updateBatch(requestWith(update), routeParams(batchId));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ details: { currentRevision: 8 } });
});

it('returns 422 item diagnostics from preflight', async () => {
  preflightDocumentGenerationBatch.mockRejectedValue(
    new UnprocessableEntityError('Batch is not ready', { items: diagnostics }),
  );
  expect((await preflightBatch(requestWith(execution), routeParams(batchId))).status).toBe(422);
});
```

- [ ] **Step 2: Run route tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/api/document-generation-batch-routes.test.ts`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement thin authenticated handlers**

Use `requireAuth()`, `requireSessionWorkspaceId()`, `requirePermission()`, Zod `.parse()`, and `createErrorResponse()` consistently. `POST /api/document-generation-batches` calls `adoptLegacyGenerationSession()` instead of normal creation when the validated body contains `legacyDraftId`:

- GET list/detail: `document:read`.
- POST create: `document:create`; parse and preflight task context.
- PUT save and preview/review/preflight: `document:update`.
- POST generate/retry: `document:create` and `document:update`.
- DELETE discard: `document:delete`.

Never accept tenant ID, user ID, status, fingerprint, generated-document ID, claim ID, or diagnostics from the client.

- [ ] **Step 4: Cover all routes and non-disclosing tenant failures**

Use a shared test request helper and mock services at the route boundary. Assert UUID param validation, permission calls, session workspace use, task-context preflight, create status `201`, success status `200`, discard status `200`, and safe 404 behavior.

- [ ] **Step 5: Run route and legacy API tests**

Run: `npm.cmd run test:run -- __tests__/api/document-generation-batch-routes.test.ts __tests__/api/generated-documents-workspace.test.ts __tests__/api/generated-document-generation-sessions-route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the API slice**

```powershell
git add src/app/api/document-generation-batches __tests__/api/document-generation-batch-routes.test.ts
git commit -m "feat(document-generation): expose batch generation APIs"
```

---

### Task 8: Add the Typed Client, Reducer, and Workspace Orchestrator

**Files:**
- Create: `src/lib/document-generation-batch-api.ts`
- Create: `src/components/documents/generation-batch/batch-workspace-state.ts`
- Create: `src/components/documents/generation-batch/use-document-generation-batch.ts`
- Test: `__tests__/lib/document-generation-batch-api.test.ts`
- Test: `__tests__/components/document-generation-batch-state.test.ts`
- Test: `__tests__/components/use-document-generation-batch.test.tsx`

**Interfaces:**
- Consumes: the DTOs and route contracts from Tasks 2 and 7.
- Produces: `EditableDocumentGenerationBatch`, `DocumentGenerationBatchAction`, reducer selectors, and `useDocumentGenerationBatch()`.
- Guarantees: explicit persistence, item-scoped invalidation, partial-batch freezing, and revision-conflict recovery.

- [ ] **Step 1: Write failing reducer and client tests**

```ts
import {
  createInitialBatchWorkspaceState,
  documentGenerationBatchReducer,
  selectCanEnterConfigure,
  selectCanRequestPreflight,
} from '@/components/documents/generation-batch/batch-workspace-state';

it('invalidates only the changed item after an item override', () => {
  const state = reviewedStateWithTwoItems();
  const next = documentGenerationBatchReducer(state, {
    type: 'item/patch',
    itemId: state.batch.items[1].id,
    patch: { overrides: { billing_address: 'New address' } },
  });

  expect(next.batch.items[0].reviewedAt).toBe(state.batch.items[0].reviewedAt);
  expect(next.batch.items[1]).toMatchObject({ reviewedAt: null, previewFingerprint: null });
  expect(next.dirty).toBe(true);
});

it('freezes composition and shared setup after one output succeeds', () => {
  const state = createInitialBatchWorkspaceState(partialBatch());
  expect(state.capabilities.canEditComposition).toBe(false);
  expect(state.capabilities.canEditSharedSetup).toBe(false);
});

it('requires a company and valid items before advancing', () => {
  expect(selectCanEnterConfigure(draftWithoutCompany())).toBe(false);
  expect(selectCanRequestPreflight(draftWithNeedsInputItem())).toBe(false);
});
```

Also test the API client with a mocked `fetch`: it must send `revision` on every mutation, omit server-owned fields, preserve structured `409` and `422` details, and support `AbortSignal` for previews.

- [ ] **Step 2: Run the client-state tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/lib/document-generation-batch-api.test.ts __tests__/components/document-generation-batch-state.test.ts __tests__/components/use-document-generation-batch.test.tsx`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the typed API boundary**

Export one function per Task 7 endpoint and a shared error type:

```ts
export class DocumentGenerationBatchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) { super(message); }
}

export function createDocumentGenerationBatch(
  input: CreateDocumentGenerationBatchInput,
  signal?: AbortSignal,
): Promise<DocumentGenerationBatchDto>;

export function saveDocumentGenerationBatch(
  id: string,
  input: UpdateDocumentGenerationBatchInput,
  signal?: AbortSignal,
): Promise<DocumentGenerationBatchDto>;
```

Implement matching list, get, discard, preview, review, preflight, generate, and retry calls. Parse response bodies once, throw `DocumentGenerationBatchApiError`, and never silently turn a failed response into an empty result.

- [ ] **Step 4: Implement deterministic reducer state**

Keep server DTOs separate from ephemeral UI state:

```ts
export interface BatchWorkspaceState {
  batch: EditableDocumentGenerationBatch;
  stage: 'documents' | 'shared-setup' | 'configure' | 'review-generate';
  activeItemId: string | null;
  savedSnapshot: string;
  dirty: boolean;
  pending: null | 'save' | 'preview' | 'review' | 'preflight' | 'generate' | 'retry';
  conflict: { currentRevision: number } | null;
  capabilities: BatchWorkspaceCapabilities;
}
```

`EditableDocumentGenerationBatch` mirrors the editable DTO fields but allows `id`, `revision`, and server timestamps to be absent before the first explicit persistence action. Use pure actions for template add/remove/reorder, primary company, master values, item patches, active item, stage navigation, request lifecycle, conflict, and server replacement. Canonically serialize only user-editable state for `savedSnapshot`. A master-field change invalidates previews/reviews only for items that consume that field without an override; an item change invalidates only that item. Any `GENERATED` item makes composition and shared values read-only.

- [ ] **Step 5: Implement the orchestration hook**

`useDocumentGenerationBatch(initialBatchOrLocalDraft)` owns the reducer and async commands. It must:

- call create on the first Save Draft or Continue when the local draft has no batch ID, then replace local item keys with authoritative item IDs;
- abort an older preview request when the same item is previewed again;
- explicitly save before Continue, Preview, Review, Generate All, and Retry;
- keep a navigation blocked while `dirty` is true using `useUnsavedNavigationGuard`;
- replace state with each authoritative server response;
- on `409`, keep local edits, expose the current revision, and offer reload rather than overwriting silently;
- on `422`, retain item diagnostics and focus the first invalid queue item;
- keep successful results visible after partial execution.

- [ ] **Step 6: Run the client-state tests**

Run: `npm.cmd run test:run -- __tests__/lib/document-generation-batch-api.test.ts __tests__/components/document-generation-batch-state.test.ts __tests__/components/use-document-generation-batch.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit the client domain slice**

```powershell
git add src/lib/document-generation-batch-api.ts src/components/documents/generation-batch/batch-workspace-state.ts src/components/documents/generation-batch/use-document-generation-batch.ts __tests__/lib/document-generation-batch-api.test.ts __tests__/components/document-generation-batch-state.test.ts __tests__/components/use-document-generation-batch.test.tsx
git commit -m "feat(document-generation): add batch workspace state"
```

---

### Task 9: Build Documents and Shared Setup Stages

**Files:**
- Create: `src/components/documents/generation-batch/batch-template-picker.tsx`
- Create: `src/components/documents/generation-batch/batch-shared-setup.tsx`
- Test: `__tests__/components/batch-template-picker.test.tsx`
- Test: `__tests__/components/batch-shared-setup.test.tsx`

**Interfaces:**
- Consumes: active template summaries, master-field catalogue, reducer actions, and batch capabilities.
- Produces: accessible stage-one template composition and stage-two company/master-field editing.
- Guarantees: 1-20 distinct templates, keyboard-accessible ordering, and visible override provenance.

- [ ] **Step 1: Write failing stage component tests**

```tsx
it('adds distinct templates, enforces the limit, and supports keyboard reorder', async () => {
  render(<BatchTemplatePicker {...pickerProps({ selectedCount: 19 })} />);
  await user.click(screen.getByRole('button', { name: /add service agreement/i }));
  expect(onAdd).toHaveBeenCalledWith(serviceAgreementTemplate.id);
  expect(screen.getByText(/20 document maximum/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add another template/i })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: /move service agreement up/i }));
  expect(onReorder).toHaveBeenCalled();
});

it('shows only compatible shared fields used by at least two templates', () => {
  render(<BatchSharedSetup {...sharedSetupProps()} />);
  expect(screen.getByLabelText('Client legal name')).toBeInTheDocument();
  expect(screen.queryByLabelText('Service fee')).not.toBeInTheDocument();
  expect(screen.getByText(/used by 2 documents/i)).toBeInTheDocument();
});
```

Test compact and narrow layouts, duplicate prevention, inactive-template exclusion, primary-company requirement, disabled controls for partial batches, validation summaries, and an override-count link that selects the affected queue item.

- [ ] **Step 2: Run the stage tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/components/batch-template-picker.test.tsx __tests__/components/batch-shared-setup.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the Documents stage**

Use the existing template-card visual language, but switch to multi-select composition. The component receives controlled selection and dispatch callbacks; it does not call APIs. Include:

- template search and category filters;
- composition type, category, description, version, field count, and a non-selecting preview action on every result;
- selected document count and the 20-document limit;
- one selected card per template with remove and drag handle;
- dnd-kit pointer and keyboard sensors, plus explicit Move up/Move down buttons;
- `aria-live` announcements for add, remove, and reorder;
- read-only generated rows and disabled composition controls for partial batches.

Do not allow the final selected template to be removed without selecting a replacement. Removing an item with configuration, preview, edits, or an attached draft Service Agreement requires a confirmation naming the document and the draft data that will be removed.

- [ ] **Step 4: Implement the Shared setup stage**

Render a single primary-company selector and one field control per server-derived master definition. Show its canonical type, consuming document count, per-template defaults, required consumers, item overrides, and conflicts. If same-key placeholders have incompatible types, keep them item-specific and show a compact explanation rather than coercing them into a master field.

Use the value precedence label `Document override -> Shared value -> Template default` and expose a button that selects each overridden document in the persistent queue.

- [ ] **Step 5: Run stage tests and focused accessibility checks**

Run: `npm.cmd run test:run -- __tests__/components/batch-template-picker.test.tsx __tests__/components/batch-shared-setup.test.tsx`

Expected: PASS with no Testing Library accessibility-role warnings.

- [ ] **Step 6: Commit the first two stages**

```powershell
git add src/components/documents/generation-batch/batch-template-picker.tsx src/components/documents/generation-batch/batch-shared-setup.tsx __tests__/components/batch-template-picker.test.tsx __tests__/components/batch-shared-setup.test.tsx
git commit -m "feat(document-generation): build batch selection and shared setup"
```

---

### Task 10: Build the Persistent Queue and Unified Configurators

**Files:**
- Create: `src/components/documents/generation-batch/batch-document-queue.tsx`
- Create: `src/components/documents/generation-batch/batch-custom-field-form.tsx`
- Create: `src/components/documents/generation-batch/standard-document-config.tsx`
- Create: `src/components/documents/generation-batch/service-agreement-config.tsx`
- Create: `src/components/documents/generation-batch/batch-item-configurator.tsx`
- Create: `src/hooks/use-document-party-options.ts`
- Modify: `src/components/documents/service-agreement/service-agreement-setup.tsx`
- Modify: `src/components/documents/service-agreement/service-selection-step.tsx`
- Modify: `src/components/documents/service-agreement/service-item-editor.tsx`
- Test: `__tests__/components/batch-document-queue.test.tsx`
- Test: `__tests__/components/batch-item-configurator.test.tsx`
- Test: `__tests__/components/service-agreement-batch-config.test.tsx`

**Interfaces:**
- Consumes: the active item, effective master values, party options, item diagnostics, and reducer callbacks.
- Produces: a persistent work queue and one configuration surface for standard and Service Agreement templates.
- Guarantees: per-document overrides remain explicit and Service Agreement state is never shared accidentally.

- [ ] **Step 1: Write failing queue and configurator tests**

```tsx
it.each([
  ['needs input', 'Needs input'],
  ['ready', 'Ready'],
  ['reviewed', 'Reviewed'],
  ['generating', 'Generating'],
  ['generated', 'Generated'],
  ['failed', 'Failed'],
])('renders the %s queue status and activates the selected document', async (_, label) => {
  render(<BatchDocumentQueue {...queueProps(label)} />);
  expect(screen.getByText(label)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /configure document/i }));
  expect(onSelect).toHaveBeenCalledWith(itemId);
});

it('shows effective shared values and records an explicit local override', async () => {
  render(<BatchItemConfigurator {...standardItemProps()} />);
  expect(screen.getByLabelText('Client legal name')).toHaveValue('Acme Pte. Ltd.');
  await user.click(screen.getByRole('button', { name: /override client legal name/i }));
  await user.clear(screen.getByLabelText('Client legal name'));
  await user.type(screen.getByLabelText('Client legal name'), 'Acme Holdings');
  expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ overrides: expect.any(Object) }));
});

it('keeps service agreement services, fees, terms, entities, and representative item-specific', () => {
  render(<BatchItemConfigurator {...serviceAgreementItemProps()} />);
  expect(screen.getByRole('heading', { name: /services and fees/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /related entities/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /representative/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the configurator tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/components/batch-document-queue.test.tsx __tests__/components/batch-item-configurator.test.tsx __tests__/components/service-agreement-batch-config.test.tsx`

Expected: FAIL because the unified components do not exist.

- [ ] **Step 3: Extract shared party types and loading**

Move `Company`, `DocumentContact`, and partial party option contracts into `src/types/document-generation.ts`. Implement `useDocumentPartyOptions(primaryCompanyId)` using the existing tenant-scoped endpoints and loading/error conventions. Update Service Agreement selectors to consume the shared types, with no import from the old wizard.

- [ ] **Step 4: Implement the persistent document queue**

The queue remains visible in Configure and Review & generate. Each row includes document title, type, compact status badge, error count, and retry state. Selecting a row updates `activeItemId`; on narrow screens the queue becomes a full-width selector/drawer while preserving a 44px target. Generated rows stay visible and are read-only.

- [ ] **Step 5: Implement standard and Service Agreement configuration**

`BatchItemConfigurator` dispatches by the server-provided template kind, not by template name:

```tsx
return item.templateKind === 'SERVICE_AGREEMENT'
  ? <ServiceAgreementConfig item={item} shared={effectiveValues} onPatch={onPatch} />
  : <StandardDocumentConfig item={item} shared={effectiveValues} onPatch={onPatch} />;
```

For standard templates, render typed custom fields, document title, contact and party selectors, effective-value provenance, and Set override/Clear override actions. For Service Agreements, adapt the existing services, fee, terms, related-entity, and representative editors into a controlled item configuration. Do not write relational Service Agreement rows from the browser; the save service from Task 4 handles transactional synchronization.

- [ ] **Step 6: Run configurator and existing Service Agreement tests**

Run: `npm.cmd run test:run -- __tests__/components/batch-document-queue.test.tsx __tests__/components/batch-item-configurator.test.tsx __tests__/components/service-agreement-batch-config.test.tsx __tests__/services/service-agreement-draft.service.test.ts __tests__/api/service-agreement-generation-routes.test.ts`

Expected: PASS; existing Service Agreement editors retain their behavior under the new controlled wrapper.

- [ ] **Step 7: Commit unified configuration**

```powershell
git add src/types/document-generation.ts src/hooks/use-document-party-options.ts src/components/documents/generation-batch/batch-document-queue.tsx src/components/documents/generation-batch/batch-custom-field-form.tsx src/components/documents/generation-batch/standard-document-config.tsx src/components/documents/generation-batch/service-agreement-config.tsx src/components/documents/generation-batch/batch-item-configurator.tsx src/components/documents/service-agreement __tests__/components/batch-document-queue.test.tsx __tests__/components/batch-item-configurator.test.tsx __tests__/components/service-agreement-batch-config.test.tsx
git commit -m "feat(document-generation): unify per-document configuration"
```

---

### Task 11: Build Review, Editing, Generation Results, and Retry

**Files:**
- Create: `src/components/documents/generation-batch/batch-review-workspace.tsx`
- Create: `src/components/documents/generation-batch/batch-generation-results.tsx`
- Test: `__tests__/components/batch-review-workspace.test.tsx`
- Test: `__tests__/components/batch-generation-results.test.tsx`

**Interfaces:**
- Consumes: persisted previews, edited content, diagnostics, review fingerprints, and execution results.
- Produces: item-by-item preview approval, edited-content persistence, Generate All, and failed-item retry controls.
- Guarantees: review is bound to exact persisted content and stale edits are never overwritten without confirmation.

- [ ] **Step 1: Write failing review and results tests**

```tsx
it('requires every remaining item to be reviewed before Generate All', () => {
  render(<BatchReviewWorkspace {...reviewProps({ secondItemReviewed: false })} />);
  expect(screen.getByRole('button', { name: /generate all/i })).toBeDisabled();
  expect(screen.getByText(/1 document still needs review/i)).toBeInTheDocument();
});

it('does not overwrite edited content when a preview becomes stale', async () => {
  render(<BatchReviewWorkspace {...reviewProps({ manuallyEdited: true, stale: true })} />);
  await user.click(screen.getByRole('button', { name: /refresh preview/i }));
  expect(screen.getByRole('dialog', { name: /replace manual edits/i })).toBeInTheDocument();
  expect(onRefresh).not.toHaveBeenCalled();
});

it('preserves successful links and retries only a failed item', async () => {
  render(<BatchGenerationResults {...partialResultProps()} />);
  expect(screen.getByRole('link', { name: /open engagement letter/i })).toHaveAttribute('href', expect.stringContaining('/generated-documents/'));
  await user.click(screen.getByRole('button', { name: /retry service agreement/i }));
  expect(onRetry).toHaveBeenCalledWith(failedItemId);
});
```

Also test that editing clears approval, saving edited HTML/JSON precedes review approval, generated rows are read-only, validation messages link to the correct queue item/field, and a stale server response cannot mark an older preview reviewed.

- [ ] **Step 2: Run review tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/components/batch-review-workspace.test.tsx __tests__/components/batch-generation-results.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the review workspace**

Keep `BatchDocumentQueue` visible beside the active preview. Reuse `A4PageEditor` and its existing toolbar in controlled mode. The component must:

- load or refresh the active item's server preview;
- show source provenance and effective master/override values;
- persist edited HTML and editor JSON before approving;
- display stale status when render inputs or persisted content change;
- require an explicit confirmation before refreshing over manual edits;
- call the review endpoint only after the saved preview and editor fingerprint are current;
- show both item-level diagnostics and a batch validation rail;
- focus the first actionable error when preflight returns `422`.

Use queue, canvas, and validation/context rail as three columns at extra-wide widths: a 280–320px queue, flexible paper canvas, and 320–384px sticky rail. At standard desktop widths collapse the diagnostics beneath or beside the active panel without hiding errors. On small screens, put document selection and diagnostics above the editor without horizontal page chrome overflow.

- [ ] **Step 4: Implement results and retry**

Render one result row for every batch item. Generated rows link to the individual document. Failed rows show the persisted safe error message, Retry, and Back to configuration. Blocked or untouched rows explain why they did not run. Retry only the named item after re-save, preview, and re-review; it never re-runs generated siblings.

When all items are generated, show a completed summary and a return link to Generated documents. For partial batches, keep the workspace resumable and visibly freeze Documents and Shared setup.

- [ ] **Step 5: Run review and A4 editor regression tests**

Run: `npm.cmd run test:run -- __tests__/components/batch-review-workspace.test.tsx __tests__/components/batch-generation-results.test.tsx`

Run: `npm.cmd run test:browser -- __tests__/browser/a4-page-editor.browser.test.tsx __tests__/browser/a4-page-editor-controls.browser.test.tsx`

Expected: PASS; editor behavior outside the batch workspace remains unchanged.

- [ ] **Step 6: Commit review and results**

```powershell
git add src/components/documents/generation-batch/batch-review-workspace.tsx src/components/documents/generation-batch/batch-generation-results.tsx __tests__/components/batch-review-workspace.test.tsx __tests__/components/batch-generation-results.test.tsx
git commit -m "feat(document-generation): add batch review and retry UI"
```

---

### Task 12: Assemble the Redesigned Four-Stage Workspace and Migrate Entry Points

**Files:**
- Create: `src/components/documents/generation-batch/document-generation-batch-workspace.tsx`
- Create: `src/components/documents/generation-batch/index.ts`
- Modify: `src/app/(dashboard)/generated-documents/generate/page.tsx`
- Modify: `src/components/documents/index.ts`
- Delete after replacement tests pass: `src/components/documents/document-generation-wizard.tsx`
- Delete after replacement tests pass: `src/components/documents/document-generation-stage.ts`
- Delete after replacement tests pass: `src/components/documents/template-selector.tsx`
- Replace: `__tests__/components/document-generation-wizard.test.tsx`
- Replace: `__tests__/components/document-generation-wizard-source.test.ts`
- Replace: `__tests__/components/document-generation-stage.test.ts`
- Test: `__tests__/components/document-generation-batch-workspace.test.tsx`
- Test: `__tests__/components/document-generation-generate-page.test.tsx`

**Interfaces:**
- Consumes: server-fetched templates, companies, contacts, task context, optional batch/session/template query parameters, and `useDocumentGenerationBatch()`.
- Produces: the only document-generation shell, with four consistent stages for every template mix.
- Guarantees: existing deep links continue to work and single-template sessions upgrade without creating duplicate child documents.

- [ ] **Step 1: Write failing workspace and route-adapter tests**

```tsx
it('uses exactly the same four stages for standard, service agreement, and mixed batches', () => {
  for (const batch of [standardBatch(), serviceAgreementBatch(), mixedBatch()]) {
    const { unmount } = render(<DocumentGenerationBatchWorkspace initialBatch={batch} {...lookups} />);
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      expect.stringContaining('Documents'),
      expect.stringContaining('Shared setup'),
      expect.stringContaining('Configure'),
      expect.stringContaining('Review & generate'),
    ]);
    unmount();
  }
});

it('loads an old draft locally and adopts it on the first explicit save', async () => {
  render(await GeneratePage({ searchParams: Promise.resolve({ draft: legacyDocumentId }) }));
  expect(screen.getByTestId('document-generation-batch-workspace')).toBeInTheDocument();
  expect(adoptLegacyGenerationSession).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /save draft/i }));
  expect(createDocumentGenerationBatch).toHaveBeenCalledWith(
    expect.objectContaining({ legacyDraftId: legacyDocumentId }),
  );
});
```

Cover `?batch=`, existing `?draft=`, `?templateId=`, `?companyId=`, and task-context entry points; server lookup failures; partial-batch stage locking; unsaved navigation; loading states; and mobile stage navigation.

- [ ] **Step 2: Run workspace tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/components/document-generation-batch-workspace.test.tsx __tests__/components/document-generation-generate-page.test.tsx`

Expected: FAIL because the new shell does not exist.

- [ ] **Step 3: Implement the redesigned shell**

Compose one stable page frame:

1. compact header with document-count/company context, Save Draft state, and Exit;
2. one four-stage horizontal stepper on desktop and compact stage selector on mobile;
3. persistent document queue from Configure onward;
4. stage canvas with one primary action and concise validation summary;
5. sticky footer containing Back, Save Draft, and the context-specific Continue/Review/Generate action.

Use shared spacing, surfaces, typography, focus states, and status colors from `docs/guides/DESIGN_GUIDELINE.md`. Avoid nested cards around every field; group sections with headings and subtle dividers. Ensure both light and dark themes, 320px width support, reduced-motion compatibility, and no status conveyed by color alone.

- [ ] **Step 4: Migrate the generate page and legacy query contracts**

The server page resolves authorized lookup data and chooses one path:

- `?batch=<id>`: resume the batch;
- `?draft=<generatedDocumentId>`: load and map the authorized legacy session into a local one-item draft, then send `legacyDraftId` through batch creation on the first explicit Continue or Save Draft;
- `?templateId=<id>`: seed a local one-item draft, optionally with authorized `companyId` and task context, and create it only on explicit Continue or Save Draft;
- no identifier: render the empty Documents stage, creating the batch on its first explicit Continue or Save Draft.

Validate UUIDs and company/template visibility server-side. Preserve the existing task query contract, but do not let client query values set tenant, user, status, or output identifiers.

- [ ] **Step 5: Remove split steppers and update exports**

After all replacement tests pass, delete the old wizard, stage helper, and single-select template selector. Update the barrel export and every Service Agreement import to shared types. Replace source-string tests with behavior tests; do not retain duplicate old and new workflow implementations.

- [ ] **Step 6: Run workspace, page, and legacy session tests**

Run: `npm.cmd run test:run -- __tests__/components/document-generation-batch-workspace.test.tsx __tests__/components/document-generation-generate-page.test.tsx __tests__/services/document-generation-session.service.test.ts __tests__/api/generated-document-generation-sessions-route.test.ts`

Expected: PASS, including one-item legacy adoption.

- [ ] **Step 7: Commit the unified shell**

```powershell
git add 'src/app/(dashboard)/generated-documents/generate/page.tsx' src/components/documents/generation-batch src/components/documents/index.ts src/components/documents/service-agreement src/types/document-generation.ts __tests__/components/document-generation-batch-workspace.test.tsx __tests__/components/document-generation-generate-page.test.tsx __tests__/components/document-generation-wizard.test.tsx __tests__/components/document-generation-wizard-source.test.ts __tests__/components/document-generation-stage.test.ts
git commit -m "feat(document-generation): launch unified batch workspace"
```

---

### Task 13: Add First-Class Batch Drafts to Generated Documents

**Files:**
- Create: `src/components/documents/generation-batch/generation-batch-list.tsx`
- Modify: `src/app/(dashboard)/generated-documents/page.tsx`
- Modify: `src/components/documents/generation-batch/index.ts`
- Modify: `__tests__/components/document-generation-list-drafts.test.tsx`
- Test: `__tests__/components/generation-batch-list.test.tsx`

**Interfaces:**
- Consumes: `listDocumentGenerationBatches()` and ordinary generated-document results.
- Produces: a batch section above the document list with Resume and Discard actions.
- Guarantees: incomplete child documents never appear as ordinary documents or inflate document counts.

- [ ] **Step 1: Write failing batch-list tests**

```tsx
it('renders one aggregate row instead of incomplete child documents', () => {
  render(<GenerationBatchList batches={[draftBatchWithThreeItems()]} />);
  expect(screen.getByText('Acme Pte. Ltd.')).toBeInTheDocument();
  expect(screen.getByText('2 of 3 ready')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /resume/i })).toHaveLength(1);
  expect(screen.queryByText('Hidden child document')).not.toBeInTheDocument();
});

it('shows partial progress and preserves generated outputs when discarding', async () => {
  render(<GenerationBatchList batches={[partialBatch()]} />);
  expect(screen.getByText('2 generated, 1 failed')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /discard unfinished work/i }));
  expect(screen.getByText(/generated documents will be kept/i)).toBeInTheDocument();
});
```

Update the existing draft-list test so a legacy generation session is shown only until adoption and an incomplete `GeneratedDocument` with a batch item is excluded from the ordinary list.

- [ ] **Step 2: Run list tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/components/generation-batch-list.test.tsx __tests__/components/document-generation-list-drafts.test.tsx`

Expected: FAIL because the batch aggregate is not rendered.

- [ ] **Step 3: Implement the aggregate list**

Each row shows primary company when selected, a fallback `Company not selected` label, document count, progress summary, updated time, status, Resume, and Discard unfinished work. The discard confirmation text differs by state:

- draft with no outputs: all incomplete batch work will be removed;
- partial: generated documents remain in the normal list and only unfinished draft state is removed.

Completed batches do not appear in the draft section. Use semantic buttons, action labels containing the company or document-count context, and existing compact list patterns.

- [ ] **Step 4: Fetch batches and documents independently**

In the server page, fetch authorized active batches and ordinary documents concurrently. Render batches above the normal document table without combining their pagination. If the batch query fails, show an inline retryable error for that section while keeping the ordinary document list usable.

- [ ] **Step 5: Run list and search-service regression tests**

Run: `npm.cmd run test:run -- __tests__/components/generation-batch-list.test.tsx __tests__/components/document-generation-list-drafts.test.tsx __tests__/services/document-generator.service.test.ts`

Expected: PASS; incomplete batch children remain absent from normal search and direct access.

- [ ] **Step 6: Commit batch discoverability**

```powershell
git add 'src/app/(dashboard)/generated-documents/page.tsx' src/components/documents/generation-batch/generation-batch-list.tsx src/components/documents/generation-batch/index.ts __tests__/components/generation-batch-list.test.tsx __tests__/components/document-generation-list-drafts.test.tsx
git commit -m "feat(document-generation): list resumable generation batches"
```

---

### Task 14: Verify the Complete Workflow, Update Documentation, and Prepare Rollout

**Files:**
- Create: `__tests__/browser/document-generation-batch.browser.test.tsx`
- Replace: `__tests__/browser/service-agreement-generation.browser.test.tsx`
- Create: `__tests__/integration/document-generation-batch.postgres.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/reference/DATABASE_SCHEMA.md`
- Modify: `docs/reference/API_REFERENCE.md`
- Modify: `docs/TODO.md`
- Modify if implementation details changed: `docs/superpowers/specs/2026-08-12-multi-template-document-generation-batches-design.md`

**Interfaces:**
- Exercises: mixed-template creation, shared fields, overrides, save/resume, preview/edit/review, partial failure, targeted retry, and legacy adoption.
- Documents: aggregate boundaries, route contracts, status transitions, visibility rules, and rollout/recovery behavior.
- Produces: final evidence that the redesign works at service, route, component, and browser levels.

- [ ] **Step 1: Write the failing end-to-end browser scenario**

Use the existing Vitest Browser network-mocking style to cover one standard template, one Service Agreement template, and one custom-field template in the same batch:

```tsx
test('creates, resumes, reviews, partially generates, and retries a mixed batch', async () => {
  await openGenerationWorkspace();
  await selectTemplates(['Engagement Letter', 'Service Agreement', 'KYC Checklist']);
  await reorderTemplate('Service Agreement', 0);
  await continueToSharedSetup();
  await choosePrimaryCompany('Acme Pte. Ltd.');
  await setMasterField('Client legal name', 'Acme Pte. Ltd.');
  await overrideFieldFor('KYC Checklist', 'Client legal name', 'Acme Holdings');
  await saveAndReloadBatch();
  await configureServiceAgreement(validServiceAgreementInput());
  await reviewAndEditEveryDocument();
  await generateAll();

  await expectBatchResults({ generated: 2, failed: 1 });
  await retryFailedDocument('Service Agreement');
  await expectBatchResults({ generated: 3, failed: 0 });
});
```

Assert the same four stage labels throughout, persisted queue order, master/override provenance, manual-edit confirmation, successful document links after partial failure, and no second generation request for successful items.

- [ ] **Step 2: Write the failing PostgreSQL integration scenario**

Gate it with the repository's existing integration-test environment convention. Verify with real constraints and transactions that:

- batch creation owns distinct ordered child documents;
- an outdated revision affects zero rows and returns conflict;
- two concurrent claims can materialize an item only once;
- a stale 15-minute claim can be reclaimed;
- incomplete children are absent from ordinary search;
- incomplete Service Agreement relations are deleted on draft discard;
- generated children survive partial-batch discard;
- legacy adoption is idempotent.

- [ ] **Step 3: Run the focused browser and integration tests and verify initial failures**

Run: `npm.cmd run test:browser -- __tests__/browser/document-generation-batch.browser.test.tsx`

Run when the integration database is available: `npm.cmd run test:run -- __tests__/integration/document-generation-batch.postgres.test.ts`

Expected before the final wiring fixes: at least one assertion fails; retain the failing output as the acceptance checklist and fix production behavior, not the assertions.

- [ ] **Step 4: Complete responsive and theme QA**

Exercise the browser scenario at 1440x900, 1024x768, 768x1024, and 320x700 in light and dark themes. Verify no horizontal shell overflow, a usable A4 editor viewport, 44px mobile targets, keyboard-only template reorder, visible focus, screen-reader stage/status labels, reduced motion, and non-color status indicators. Capture screenshots only as temporary test artifacts; do not add unreviewed binaries to Git.

- [ ] **Step 5: Update existing documentation**

Document these exact contracts:

- `docs/ARCHITECTURE.md`: first-class batch aggregate, separate output documents, server-authoritative render/review/generation, and one authoritative task-stage outcome;
- `docs/reference/DATABASE_SCHEMA.md`: tables, enums, unique constraints, revisions, claims, status transitions, and child visibility;
- `docs/reference/API_REFERENCE.md`: every Task 7 endpoint, permissions, `409` revision response, `422` diagnostics, and idempotent retry behavior;
- `docs/TODO.md`: mark the one-document-at-a-time limitation and split stepper as completed, while preserving unrelated entries;
- approved design spec: reconcile only real implementation decisions, especially nullable draft company, incomplete Service Agreement configuration synchronization, and first-success task outcome selection.

- [ ] **Step 6: Run affected unit and browser suites**

Run:

```powershell
npm.cmd run test:run -- __tests__/services/document-generation-batch-schema.test.ts __tests__/lib/document-generation-master-fields.test.ts __tests__/lib/document-generation-fingerprint.test.ts __tests__/lib/document-generation-batch-validation.test.ts __tests__/services/document-generation-batch-lifecycle.service.test.ts __tests__/services/document-generation-batch-preview.service.test.ts __tests__/services/document-generation-batch-generation.service.test.ts __tests__/api/document-generation-batch-routes.test.ts __tests__/components/document-generation-batch-state.test.ts __tests__/components/use-document-generation-batch.test.tsx __tests__/components/batch-template-picker.test.tsx __tests__/components/batch-shared-setup.test.tsx __tests__/components/batch-document-queue.test.tsx __tests__/components/batch-item-configurator.test.tsx __tests__/components/service-agreement-batch-config.test.tsx __tests__/components/batch-review-workspace.test.tsx __tests__/components/batch-generation-results.test.tsx __tests__/components/document-generation-batch-workspace.test.tsx __tests__/components/document-generation-generate-page.test.tsx __tests__/components/generation-batch-list.test.tsx
npm.cmd run test:browser -- __tests__/browser/document-generation-batch.browser.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run full static and regression verification**

Run:

```powershell
npm.cmd run db:generate
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run test:run
npm.cmd run build
```

Expected: all commands exit `0`. If a pre-existing unrelated failure remains, record its exact command and output separately; do not weaken, skip, or delete a relevant batch test.

- [ ] **Step 8: Review the migration and deployment order**

Confirm the migration is additive and deployable before the application code. Verify the new list predicate treats `batchItem = null` as a normal document and `batchItem.status = GENERATED` as visible, so old rows remain unaffected. Confirm lazy adoption leaves existing draft URLs functional and rollback can leave the new nullable tables unused without altering generated outputs.

- [ ] **Step 9: Commit tests and documentation**

```powershell
git add __tests__/browser/document-generation-batch.browser.test.tsx __tests__/browser/service-agreement-generation.browser.test.tsx __tests__/integration/document-generation-batch.postgres.test.ts docs/ARCHITECTURE.md docs/reference/DATABASE_SCHEMA.md docs/reference/API_REFERENCE.md docs/TODO.md docs/superpowers/specs/2026-08-12-multi-template-document-generation-batches-design.md
git commit -m "test(document-generation): verify batch workflow end to end"
```

---

## Completion Criteria

- One user action can generate 1-20 separate documents from a mixed set of standard, Service Agreement, and custom-field templates.
- All template types use one four-stage layout with a persistent document work queue.
- Compatible repeated fields are derived into server-owned master fields, while per-document overrides remain explicit and deterministic.
- Every document is previewed, optionally edited, saved, and reviewed against exact content before generation.
- Batch drafts resume as one aggregate; legacy single-template sessions adopt safely to one-item batches.
- Preflight is all-or-nothing, execution preserves partial success, and retry never re-generates successful items.
- Incomplete child documents remain internal; generated outputs appear as normal independent documents.
- Service Agreement item data persists transactionally without forcing incomplete configuration into relational rows.
- Tenant scope, optimistic revisions, atomic claims, idempotency, task linkage, responsive layout, accessibility, documentation, and full regression checks are verified.
