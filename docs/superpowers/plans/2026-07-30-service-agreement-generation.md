# Service Agreement Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a resumable four-step Service Agreement generator that pins service wording, supports repeated variants and multiple entities, renders entity-specific fees, and produces an editable generated document without reverse-syncing HTML edits.

**Architecture:** Persist structured agreement selections in relational tables attached one-to-one to the existing generated-document draft. Assemble reserved agreement slots on the server before running the existing master-template placeholder resolver; service partial snapshots resolve in isolated local contexts and never depend on current catalog wording unless the user explicitly refreshes them.

**Tech Stack:** Prisma 7/PostgreSQL, TypeScript 5.7, Zod 3, existing document generator/session/placeholder resolver, Next.js route handlers, React 19, TanStack Query 5, Tiptap 3, Vitest 4, Playwright 1.61, Puppeteer/PDF export already present in Oakcloud.

## Global Constraints

- Complete `2026-07-30-service-catalog-foundation.md` first.
- Preserve generic document generation and version 1 generation drafts.
- One primary company supplies cover address and client-party context.
- One selected company contact supplies PIC/authorised-representative context; store a snapshot so later contact edits do not rewrite the draft.
- Additional agreement entities must belong to the same tenant and remain unique.
- A service item may target one or more included entities, and the same variant may appear in multiple items.
- Every fee line belongs to exactly one targeted entity; group-total fees do not exist.
- Store Decimal amounts in the database and serialize them as fixed-point strings in APIs.
- Pin a fully expanded SOW partial snapshot, including nested partial dependencies, without resolving service placeholders.
- Never refresh a saved snapshot implicitly.
- Full-editor changes affect document HTML only; structured agreement records remain authoritative for Plan 3 activation.
- Use existing `document:*` permissions for agreement generation and company-access filtering for every selected entity.
- Do not activate operational Services in this plan; Plan 3 owns activation.

---

### Task 1: Add relational Service Agreement draft schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260730100000_service_agreement_drafts/migration.sql`
- Create: `__tests__/services/service-agreement-schema.test.ts`

**Interfaces:**
- Produces `ServiceAgreement`, entity/item/item-entity/fee-line tables and `ServiceAgreementStatus`.
- Plan 3 consumes these exact relations.

- [ ] **Step 1: Write the failing schema contract test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('service agreement draft schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it('stores normalized draft selections beside generated documents', () => {
    for (const model of [
      'ServiceAgreement',
      'ServiceAgreementEntity',
      'ServiceAgreementItem',
      'ServiceAgreementItemEntity',
      'ServiceAgreementFeeLine',
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
    expect(schema).toContain('generatedDocumentId String @unique');
    expect(schema).toContain('@@unique([itemId, agreementEntityId])');
  });
});
```

- [ ] **Step 2: Run the schema test**

```powershell
npx.cmd vitest run __tests__/services/service-agreement-schema.test.ts
```

Expected: FAIL because the draft schema is absent.

- [ ] **Step 3: Add the exact schema**

Add:

```prisma
enum ServiceAgreementStatus {
  DRAFT
  EFFECTIVE
  CANCELLED
}

model ServiceAgreement {
  id                               String                    @id @default(uuid())
  tenantId                         String                    @map("tenant_id")
  generatedDocumentId              String                    @unique @map("generated_document_id")
  primaryCompanyId                 String                    @map("primary_company_id")
  authorizedContactId              String?                   @map("authorized_contact_id")
  authorizedRepresentativeSnapshot Json                     @map("authorized_representative_snapshot")
  agreementDate                    DateTime                  @map("agreement_date") @db.Date
  effectiveDate                    DateTime?                 @map("effective_date") @db.Date
  termMonths                       Int                       @default(12) @map("term_months")
  status                           ServiceAgreementStatus    @default(DRAFT)
  signedAt                         DateTime?                 @map("signed_at")
  activatedAt                      DateTime?                 @map("activated_at")
  cancelledAt                      DateTime?                 @map("cancelled_at")
  createdAt                        DateTime                  @default(now()) @map("created_at")
  updatedAt                        DateTime                  @updatedAt @map("updated_at")
  tenant                           Workspace                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  generatedDocument                GeneratedDocument         @relation(fields: [generatedDocumentId], references: [id], onDelete: Cascade)
  primaryCompany                   Company                   @relation("ServiceAgreementPrimaryCompany", fields: [primaryCompanyId], references: [id], onDelete: Restrict)
  authorizedContact                Contact?                  @relation(fields: [authorizedContactId], references: [id], onDelete: SetNull)
  entities                         ServiceAgreementEntity[]
  items                            ServiceAgreementItem[]

  @@index([tenantId, status, updatedAt])
  @@index([tenantId, primaryCompanyId])
  @@map("service_agreements")
}

model ServiceAgreementEntity {
  id           String                       @id @default(uuid())
  tenantId     String                       @map("tenant_id")
  agreementId  String                       @map("agreement_id")
  companyId    String                       @map("company_id")
  nameSnapshot String                       @map("name_snapshot") @db.VarChar(255)
  uenSnapshot  String                       @map("uen_snapshot") @db.VarChar(50)
  displayOrder Int                          @default(0) @map("display_order")
  tenant       Workspace                    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  agreement    ServiceAgreement             @relation(fields: [agreementId], references: [id], onDelete: Cascade)
  company      Company                      @relation(fields: [companyId], references: [id], onDelete: Restrict)
  itemLinks    ServiceAgreementItemEntity[]
  feeLines     ServiceAgreementFeeLine[]

  @@unique([agreementId, companyId])
  @@index([tenantId, companyId])
  @@index([agreementId, displayOrder])
  @@map("service_agreement_entities")
}

model ServiceAgreementItem {
  id                         String                       @id @default(uuid())
  tenantId                   String                       @map("tenant_id")
  agreementId                String                       @map("agreement_id")
  serviceVariantId           String                       @map("service_variant_id")
  variantVersion             Int                          @map("variant_version")
  familyNameSnapshot         String                       @map("family_name_snapshot") @db.VarChar(200)
  variantNameSnapshot        String                       @map("variant_name_snapshot") @db.VarChar(200)
  serviceCadence             ServiceCadence               @map("service_cadence")
  customCadenceLabel         String?                      @map("custom_cadence_label") @db.VarChar(100)
  sowPartialId               String                       @map("sow_partial_id")
  partialVersion             Int                          @map("partial_version")
  partialContentSnapshot     String                       @map("partial_content_snapshot")
  partialPlaceholdersSnapshot Json                        @map("partial_placeholders_snapshot")
  partialDependencySnapshot  Json                         @map("partial_dependency_snapshot")
  startDate                  DateTime                     @map("start_date") @db.Date
  endDate                    DateTime?                    @map("end_date") @db.Date
  fieldValues                Json                         @default("{}") @map("field_values")
  displayOrder               Int                          @default(0) @map("display_order")
  createdAt                  DateTime                     @default(now()) @map("created_at")
  updatedAt                  DateTime                     @updatedAt @map("updated_at")
  tenant                     Workspace                    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  agreement                  ServiceAgreement             @relation(fields: [agreementId], references: [id], onDelete: Cascade)
  serviceVariant             ServiceVariant               @relation(fields: [serviceVariantId], references: [id], onDelete: Restrict)
  sowPartial                 TemplatePartial              @relation(fields: [sowPartialId], references: [id], onDelete: Restrict)
  entityLinks                ServiceAgreementItemEntity[]
  feeLines                   ServiceAgreementFeeLine[]

  @@index([tenantId, agreementId, displayOrder])
  @@index([serviceVariantId])
  @@map("service_agreement_items")
}

model ServiceAgreementItemEntity {
  id                String                  @id @default(uuid())
  tenantId          String                  @map("tenant_id")
  itemId            String                  @map("item_id")
  agreementEntityId String                  @map("agreement_entity_id")
  tenant            Workspace               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  item              ServiceAgreementItem    @relation(fields: [itemId], references: [id], onDelete: Cascade)
  agreementEntity   ServiceAgreementEntity  @relation(fields: [agreementEntityId], references: [id], onDelete: Cascade)

  @@unique([itemId, agreementEntityId])
  @@index([tenantId, agreementEntityId])
  @@map("service_agreement_item_entities")
}

model ServiceAgreementFeeLine {
  id                   String                  @id @default(uuid())
  tenantId             String                  @map("tenant_id")
  itemId               String                  @map("item_id")
  agreementEntityId    String                  @map("agreement_entity_id")
  description          String                  @db.VarChar(500)
  amount               Decimal                 @db.Decimal(18, 2)
  currency             String                  @default("SGD") @db.VarChar(3)
  billingFrequency     BillingFrequency        @map("billing_frequency")
  customFrequencyLabel String?                 @map("custom_frequency_label") @db.VarChar(100)
  billingStartDate     DateTime?               @map("billing_start_date") @db.Date
  displayOrder         Int                     @default(0) @map("display_order")
  createdAt            DateTime                @default(now()) @map("created_at")
  updatedAt            DateTime                @updatedAt @map("updated_at")
  tenant               Workspace               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  item                 ServiceAgreementItem    @relation(fields: [itemId], references: [id], onDelete: Cascade)
  agreementEntity      ServiceAgreementEntity  @relation(fields: [agreementEntityId], references: [id], onDelete: Cascade)

  @@index([tenantId, itemId, displayOrder])
  @@index([agreementEntityId])
  @@map("service_agreement_fee_lines")
}
```

Add these exact inverse relations:

```prisma
// Workspace
serviceAgreements          ServiceAgreement[]
serviceAgreementEntities  ServiceAgreementEntity[]
serviceAgreementItems     ServiceAgreementItem[]
serviceAgreementFeeLines  ServiceAgreementFeeLine[]

// GeneratedDocument
serviceAgreement ServiceAgreement?

// Company
primaryServiceAgreements ServiceAgreement[]       @relation("ServiceAgreementPrimaryCompany")
serviceAgreementEntities ServiceAgreementEntity[]

// Contact
authorizedServiceAgreements ServiceAgreement[]

// ServiceVariant
serviceAgreementItems ServiceAgreementItem[]

// TemplatePartial
serviceAgreementItems ServiceAgreementItem[]
```

The migration creates only additive tables/enums/relations and performs no legacy contract data migration.

- [ ] **Step 4: Generate Prisma and rerun the test**

```powershell
npm.cmd run db:generate
npx.cmd vitest run __tests__/services/service-agreement-schema.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit schema**

```powershell
git add prisma/schema.prisma prisma/migrations/20260730100000_service_agreement_drafts/migration.sql src/generated/prisma __tests__/services/service-agreement-schema.test.ts
git commit -m "feat(documents): add service agreement draft schema"
```

### Task 2: Define draft validation, DTOs, and snapshot semantics

**Files:**
- Create: `src/lib/validations/service-agreement.ts`
- Create: `src/services/service-agreement/types.ts`
- Create: `src/services/service-agreement/index.ts`
- Test: `__tests__/lib/service-agreement-validation.test.ts`

**Interfaces:**
- Produces `ServiceAgreementDraftInput`, `ServiceAgreementDraftDto`, item/fee inputs, and validation schemas.
- Fixes the request shape used by sessions, preview, generation, and Plan 3.

- [ ] **Step 1: Write failing validation tests**

```ts
it('rejects a fee for an entity not targeted by the service item', () => {
  const parsed = serviceAgreementDraftSchema.safeParse({
    primaryCompanyId,
    authorizedContactId,
    entityIds: [primaryCompanyId, secondCompanyId],
    agreementDate: '2026-07-30',
    effectiveDate: '2026-07-30',
    termMonths: 12,
    items: [{
      clientKey: 'item-1',
      variantId,
      entityIds: [primaryCompanyId],
      startDate: '2026-07-30',
      endDate: null,
      fieldValues: {},
      displayOrder: 0,
      feeLines: [{
        clientKey: 'fee-1',
        companyId: secondCompanyId,
        description: 'Annual fee',
        amount: '500.00',
        currency: 'SGD',
        billingFrequency: 'ANNUALLY',
        displayOrder: 0,
      }],
    }],
  });
  expect(parsed.success).toBe(false);
});
```

- [ ] **Step 2: Run the validation suite**

```powershell
npx.cmd vitest run __tests__/lib/service-agreement-validation.test.ts
```

Expected: FAIL because validation is absent.

- [ ] **Step 3: Implement exact public inputs**

```ts
export interface ServiceAgreementFeeLineInput {
  id?: string;
  clientKey: string;
  companyId: string;
  description: string;
  amount: string;
  currency: string;
  billingFrequency: BillingFrequency;
  customFrequencyLabel?: string | null;
  billingStartDate?: string | null;
  displayOrder: number;
}

export interface ServiceAgreementItemInput {
  id?: string;
  clientKey: string;
  variantId: string;
  entityIds: string[];
  startDate: string;
  endDate?: string | null;
  fieldValues: Record<string, string>;
  displayOrder: number;
  feeLines: ServiceAgreementFeeLineInput[];
}

export interface ServiceAgreementDraftInput {
  primaryCompanyId: string;
  authorizedContactId: string;
  entityIds: string[];
  agreementDate: string;
  effectiveDate?: string | null;
  termMonths: number;
  items: ServiceAgreementItemInput[];
}
```

Zod rules:

- UUIDs for persisted identifiers; `clientKey` is a non-empty max-100 stable browser key.
- `entityIds` contains 1-100 unique IDs and includes `primaryCompanyId`.
- `items` contains 1-50 entries with unique `clientKey` and unique `displayOrder`.
- Each item has 1-100 unique entity IDs, all drawn from the agreement entity list.
- `startDate`/`endDate` use `YYYY-MM-DD`; end cannot precede start.
- `fieldValues` has at most 100 keys and string values capped at 10,000 characters.
- Each item has 1-100 fee lines. Every fee company is targeted by the item.
- Amount format is `^\d{1,16}(\.\d{1,2})?$`; currency is three uppercase letters.
- Fee display order is unique per company within the item.
- `CUSTOM` frequency requires `customFrequencyLabel`; other frequencies normalize it to null.
- `billingStartDate` defaults to the item start date in the service layer.

DTOs include pinned variant/partial versions, snapshots, stale-version flags, and fixed-point string amounts. Do not return Prisma Decimal objects.

- [ ] **Step 4: Run validation tests**

```powershell
npx.cmd vitest run __tests__/lib/service-agreement-validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit contracts**

```powershell
git add src/lib/validations/service-agreement.ts src/services/service-agreement/types.ts src/services/service-agreement/index.ts __tests__/lib/service-agreement-validation.test.ts
git commit -m "feat(documents): define service agreement draft contracts"
```

### Task 3: Implement snapshot expansion and draft persistence

**Files:**
- Create: `src/services/service-agreement/snapshot.ts`
- Create: `src/services/service-agreement/draft.service.ts`
- Modify: `src/services/service-agreement/index.ts`
- Test: `__tests__/services/service-agreement-draft.service.test.ts`

**Interfaces:**
- Produces `snapshotServiceVariant`, `upsertServiceAgreementDraft`, `getServiceAgreementDraft`, and `refreshServiceAgreementItemWording`.

- [ ] **Step 1: Write failing persistence tests**

```ts
it('pins expanded nested partials and preserves entered data during refresh', async () => {
  const snapshot = await snapshotServiceVariant(variant.id, tenantId);
  expect(snapshot.partialContent).not.toContain('{{> nested-partial}}');
  expect(snapshot.dependencies).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'nested-partial', version: 2 }),
  ]));

  await refreshServiceAgreementItemWording(item.id, { expectedPartialVersion: 1 }, actor);
  expect(prismaMock.serviceAgreementItem.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.not.objectContaining({ fieldValues: expect.anything() }),
  }));
});
```

- [ ] **Step 2: Run the draft service suite**

```powershell
npx.cmd vitest run __tests__/services/service-agreement-draft.service.test.ts
```

Expected: FAIL because snapshot and draft services do not exist.

- [ ] **Step 3: Implement immutable snapshot creation**

Export:

```ts
export interface ServiceVariantSnapshot {
  variantId: string;
  variantVersion: number;
  familyName: string;
  variantName: string;
  serviceCadence: ServiceCadence;
  customCadenceLabel: string | null;
  partialId: string;
  partialVersion: number;
  partialContent: string;
  placeholders: PlaceholderDefinition[];
  dependencies: Array<{ id: string; name: string; version: number; updatedAt: string }>;
}

export async function snapshotServiceVariant(
  variantId: string,
  tenantId: string,
): Promise<ServiceVariantSnapshot>;
```

Load the active tenant-owned variant, family, linked partial, fee templates, and all recursively referenced partials. Expand nested `{{>name}}` tokens recursively while retaining ordinary/service placeholders. Reject missing or circular nested dependencies. Store dependency IDs/names/versions/update timestamps.

- [ ] **Step 4: Implement transactional draft upsert**

Export:

```ts
export async function upsertServiceAgreementDraft(
  generatedDocumentId: string,
  input: ServiceAgreementDraftInput,
  params: TenantAwareParams,
): Promise<ServiceAgreementDraftDto>;

export async function getServiceAgreementDraft(
  generatedDocumentId: string,
  tenantId: string,
): Promise<ServiceAgreementDraftDto | null>;

export async function refreshServiceAgreementItemWording(
  itemId: string,
  input: { expectedVariantVersion: number; expectedPartialVersion: number },
  params: TenantAwareParams,
): Promise<ServiceAgreementItemDto>;
```

Before mutation:

- Confirm the generated document is a tenant-owned active generation draft.
- Confirm all companies are tenant-owned, not deleted, and accessible to the actor through the same company-scope rules used by generation.
- Confirm the authorised contact is active and related to the primary company.
- Validate required service placeholders from the pinned partial definition.
- Confirm every fee entity is targeted by the item.

Within one transaction:

- Upsert the agreement and representative snapshot.
- Replace agreement entities from current company name/UEN snapshots.
- Match existing items by persisted `id`; create new items from a fresh variant snapshot; delete removed items.
- Replace item-entity links and fee lines.
- Retain existing item snapshots unless the variant changes or the explicit refresh function is called.
- Audit create/update with a structured summary that excludes full legal wording and sensitive contact values.

Refresh must enforce optimistic expected versions, fetch the current linked partial (including a changed partial link), replace only snapshot/version/dependency fields, preserve dates/entities/field values/fees, and return `409` semantics on a stale caller version.

- [ ] **Step 5: Run the persistence suite**

```powershell
npx.cmd vitest run __tests__/services/service-agreement-draft.service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit draft persistence**

```powershell
git add src/services/service-agreement __tests__/services/service-agreement-draft.service.test.ts
git commit -m "feat(documents): persist service agreement drafts"
```

### Task 4: Upgrade generation sessions with version 1 compatibility

**Files:**
- Modify: `src/lib/validations/generated-document.ts`
- Modify: `src/lib/document-generation-session.ts`
- Modify: `src/services/document-generation-session.service.ts`
- Modify: `src/app/api/generated-documents/generation-sessions/route.ts`
- Modify: `src/app/api/generated-documents/generation-sessions/[id]/route.ts`
- Test: `__tests__/services/document-generation-session.service.test.ts`
- Test: `__tests__/api/generated-document-generation-sessions-route.test.ts`

**Interfaces:**
- Produces generation session version 2 and `GenerationSessionEnvelope.agreement`.
- Reads version 1 metadata without mutating it until the next save.

- [ ] **Step 1: Add failing compatibility tests**

```ts
expect(readActiveGenerationSession({
  generationSession: {
    version: 1,
    currentStep: 4,
    templateId: null,
    companyId: null,
    contactIds: [],
    selectedDirectorId: null,
    selectedShareholderId: null,
    selectedContactId: null,
    title: '',
    customData: {},
    useLetterhead: true,
    previewContent: null,
    editedContent: null,
    editedContentJson: null,
  },
})).toMatchObject({ version: 2, currentStep: 2, serviceAgreementId: null });
```

Also assert a Service Agreement save and its relational upsert commit or roll back together.

- [ ] **Step 2: Run focused session tests**

```powershell
npx.cmd vitest run __tests__/services/document-generation-session.service.test.ts __tests__/api/generated-document-generation-sessions-route.test.ts
```

Expected: FAIL against version 1-only behavior.

- [ ] **Step 3: Implement versioned session schemas**

Keep the current schema as `generationSessionStateV1Schema`. Add:

```ts
export const GENERATION_SESSION_VERSION = 2 as const;

export const generationSessionStateV2Schema = z.object({
  version: z.literal(2),
  currentStep: z.number().int().min(0).max(3),
  templateId: nullableUuid,
  companyId: nullableUuid,
  contactIds: z.array(z.string().uuid()),
  selectedDirectorId: nullableUuid,
  selectedShareholderId: nullableUuid,
  selectedContactId: nullableUuid,
  title: z.string().max(300),
  customData: z.record(z.string()),
  useLetterhead: z.boolean(),
  previewContent: z.string().nullable(),
  editedContent: z.string().nullable(),
  editedContentJson: z.unknown().nullable(),
  serviceAgreementId: nullableUuid,
});
```

`readActiveGenerationSession` parses v2 first; on v1 success it returns a v2 in-memory state using `normalizeDocumentGenerationStage` and `serviceAgreementId: null`.

Extend:

```ts
export interface GenerationSessionEnvelope {
  id: string;
  savedAt: string;
  state: GenerationSessionState;
  agreement: ServiceAgreementDraftDto | null;
}
```

The save route accepts the existing flat state plus optional `serviceAgreement`. The service performs generated-document/session and agreement-draft writes inside the same interactive Prisma transaction. Standard templates reject a non-null agreement payload; Service Agreement templates require it once the user leaves Setup.

- [ ] **Step 4: Run session/API tests**

```powershell
npx.cmd vitest run __tests__/services/document-generation-session.service.test.ts __tests__/api/generated-document-generation-sessions-route.test.ts
```

Expected: PASS, including old draft resume.

- [ ] **Step 5: Commit session upgrade**

```powershell
git add src/lib/validations/generated-document.ts src/lib/document-generation-session.ts src/services/document-generation-session.service.ts src/app/api/generated-documents/generation-sessions __tests__/services/document-generation-session.service.test.ts __tests__/api/generated-document-generation-sessions-route.test.ts
git commit -m "feat(documents): persist service agreement generation sessions"
```

### Task 5: Build the deterministic agreement assembler

**Files:**
- Create: `src/services/service-agreement/renderer.ts`
- Modify: `src/lib/placeholder-resolver.ts`
- Modify: `src/services/service-agreement/index.ts`
- Test: `__tests__/services/service-agreement-renderer.test.ts`

**Interfaces:**
- Produces `assembleServiceAgreementTemplate`.
- Extends `PlaceholderContext` with `service`.

- [ ] **Step 1: Write failing renderer tests**

```ts
const result = assembleServiceAgreementTemplate({
  templateContent: [
    '<p>Cover {{company.name}}</p>',
    '{{@agreement.serviceSections}}',
    '{{@agreement.feeTable}}',
    '{{@agreement.entityAppendix}}',
  ].join(''),
  agreement,
});

expect(result.content).toContain('Statement of Work – Corporate Secretarial');
expect(result.content).toContain('Alpha Pte. Ltd. (UEN: 11111111A)');
expect(result.content).toContain('Beta Pte. Ltd. (UEN: 22222222B)');
expect(result.content).toContain('S$500.00 per year');
expect(result.content.indexOf('Monthly Accounting')).toBeLessThan(
  result.content.indexOf('Corporate Secretarial'),
);
expect(result.content).not.toContain('{{@agreement.');
```

Cover repeated variants, HTML escaping, required missing service fields, one fee per entity, single-entity table labels, custom frequencies, and empty/missing/duplicate slots.

- [ ] **Step 2: Run renderer tests**

```powershell
npx.cmd vitest run __tests__/services/service-agreement-renderer.test.ts
```

Expected: FAIL because the assembler and service context do not exist.

- [ ] **Step 3: Extend placeholder context**

Add:

```ts
export interface ServicePlaceholderData {
  itemId: string;
  familyName: string;
  variantName: string;
  cadence: string;
  startDate: Date;
  endDate?: Date | null;
  entities: Array<{ id: string; name: string; uen: string }>;
  fields: Record<string, string>;
}

export interface PlaceholderContext extends DocumentPartySelections {
  // existing members...
  service?: ServicePlaceholderData;
}
```

The existing path resolver already supports nested object paths; add tests proving `service.fields.software` and `{{#each service.entities}}` resolve correctly.

- [ ] **Step 4: Implement assembly order**

Export:

```ts
export function assembleServiceAgreementTemplate(input: {
  templateContent: string;
  agreement: ServiceAgreementDraftDto;
}): {
  content: string;
  itemDiagnostics: Array<{ itemId: string; missingPlaceholders: string[] }>;
};
```

Algorithm:

1. Validate every reserved slot occurs exactly once.
2. Sort items by `displayOrder`.
3. Resolve each `partialContentSnapshot` with a context containing only its local `service` object and deterministic date/currency formatting.
4. Wrap each rendered SOW in `<section data-service-agreement-item-id="...">`; add `break-before-page` from the second SOW onward using the existing pagination conventions.
5. Build one escaped fee table. Group rows by service item; when the agreement has multiple entities, include an `Entity` column. Format amounts with `Intl.NumberFormat('en-SG', { style: 'currency', currency })` and render frequency labels from enums/custom text.
6. Build the numbered Appendix 3 list from agreement-entity snapshots in `displayOrder`.
7. Replace the three reserved slots.
8. Return item-level missing required placeholder diagnostics. Do not query current variants or partials.

- [ ] **Step 5: Run renderer and resolver tests**

```powershell
npx.cmd vitest run __tests__/services/service-agreement-renderer.test.ts __tests__/services/document-generator-party-loops.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit renderer**

```powershell
git add src/services/service-agreement/renderer.ts src/services/service-agreement/index.ts src/lib/placeholder-resolver.ts __tests__/services/service-agreement-renderer.test.ts
git commit -m "feat(documents): assemble service agreement content"
```

### Task 6: Integrate preview, validation, generation, and refresh APIs

**Files:**
- Modify: `src/services/document-generator.service.ts`
- Modify: `src/services/document-validation.service.ts`
- Modify: `src/app/api/generated-documents/preview/route.ts`
- Modify: `src/app/api/generated-documents/validate/route.ts`
- Modify: `src/app/api/generated-documents/route.ts`
- Create: `src/app/api/service-agreements/[id]/items/[itemId]/refresh-wording/route.ts`
- Test: `__tests__/services/document-generator.service.test.ts`
- Test: `__tests__/api/service-agreement-generation-routes.test.ts`

**Interfaces:**
- Preview/validate/generate consume the persisted agreement related to `draftId`.
- Refresh endpoint updates only the pinned wording snapshot.

- [ ] **Step 1: Add failing integration tests**

```ts
it('assembles a service agreement before master placeholder resolution', async () => {
  const result = await renderTemplateForGeneration({
    templateId,
    tenantId,
    companyId,
    serviceAgreementId,
    mode: 'preview',
  });
  expect(assembleServiceAgreementTemplateMock).toHaveBeenCalled();
  expect(result.content).toContain(company.name);
});

it('does not use current catalog wording during generation', async () => {
  await createDocumentFromTemplate(input, actor);
  expect(getSelectableServiceVariantsMock).not.toHaveBeenCalled();
  expect(created.content).toContain('Pinned SOW wording');
});
```

- [ ] **Step 2: Run generation/API tests**

```powershell
npx.cmd vitest run __tests__/services/document-generator.service.test.ts __tests__/api/service-agreement-generation-routes.test.ts
```

Expected: FAIL before integration.

- [ ] **Step 3: Extend rendering interfaces**

Add `serviceAgreementId?: string` to `RenderTemplateForGenerationParams`. For `compositionType === SERVICE_AGREEMENT`:

- Require a saved tenant-owned agreement linked to the same draft/generated document.
- Confirm `primaryCompanyId === companyId`.
- Assemble the saved agreement into the master content before loading normal master-template partials and before `resolvePlaceholders`.
- Merge item diagnostics into blocking errors.
- Add agreement/variant/partial snapshot versions to `dependencySnapshot`.

For standard templates, reject `serviceAgreementId`.

Generation must write:

```ts
metadata: {
  ...existingMetadata,
  serviceAgreementId: agreement.id,
  serviceAgreementStructuredHash: sha256(canonicalAgreementDto),
  serviceAgreementContentEdited: Boolean(data.editedContent && data.editedContent !== rendered.content),
}
```

Use a stable canonical JSON function that sorts object keys and preserves item/fee display order.

- [ ] **Step 4: Implement route contracts**

Preview and validate accept:

```ts
{
  draftId: string;
  templateId: string;
  companyId: string;
  serviceAgreementId: string;
  customData?: Record<string, unknown>;
}
```

The generate route continues to accept `draftId`; the service loads the linked agreement and refuses a mismatched caller-supplied ID.

Refresh endpoint:

```ts
POST /api/service-agreements/:id/items/:itemId/refresh-wording
{
  "expectedVariantVersion": 1,
  "expectedPartialVersion": 3
}
```

It requires `document:update`, tenant ownership, and a DRAFT agreement, then returns the updated item DTO. Return 409 for optimistic version mismatch.

- [ ] **Step 5: Run generation/API tests**

```powershell
npx.cmd vitest run __tests__/services/document-generator.service.test.ts __tests__/api/service-agreement-generation-routes.test.ts __tests__/services/service-agreement-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit integration**

```powershell
git add src/services/document-generator.service.ts src/services/document-validation.service.ts src/app/api/generated-documents src/app/api/service-agreements __tests__/services/document-generator.service.test.ts __tests__/api/service-agreement-generation-routes.test.ts
git commit -m "feat(documents): integrate service agreement generation"
```

### Task 7: Build the four-step Service Agreement wizard

**Files:**
- Create: `src/components/documents/service-agreement/service-agreement-setup.tsx`
- Create: `src/components/documents/service-agreement/service-selection-step.tsx`
- Create: `src/components/documents/service-agreement/service-item-editor.tsx`
- Create: `src/components/documents/service-agreement/service-fee-editor.tsx`
- Create: `src/components/documents/service-agreement/service-agreement-warning.tsx`
- Modify: `src/components/documents/document-generation-wizard.tsx`
- Modify: `src/components/documents/document-generation-stage.ts`
- Modify: `src/app/(dashboard)/generated-documents/generate/page.tsx`
- Test: `__tests__/components/document-generation-wizard.test.tsx`
- Test: `__tests__/browser/service-agreement-generation.browser.test.tsx`

**Interfaces:**
- Standard templates retain `Setup`, `Details`, `Review & Generate`.
- Service Agreement templates use `Setup`, `Services`, `Agreement details`, `Review & Generate`.

- [ ] **Step 1: Write failing component tests**

```tsx
renderWizard({ template: serviceAgreementTemplate });
expect(screen.getByText('Services')).toBeVisible();
expect(screen.getByText('Agreement details')).toBeVisible();

await user.click(screen.getByRole('button', { name: 'Add service' }));
await user.selectOptions(screen.getByLabelText('Service variant'), variant.id);
expect(screen.getByLabelText('Applies to Alpha Pte. Ltd.')).toBeChecked();
expect(screen.getByRole('button', { name: 'Add another Corporate Secretarial service' })).toBeEnabled();
```

Assert fee defaults copy per selected entity, unassigning an entity asks before removing its fee rows, stale wording shows a refresh button, and full editor warning text is present.

- [ ] **Step 2: Run component tests**

```powershell
npx.cmd vitest run __tests__/components/document-generation-wizard.test.tsx
```

Expected: FAIL before Service Agreement components exist.

- [ ] **Step 3: Implement dynamic state and navigation**

Keep generic `WizardState` intact and add:

```ts
interface ServiceAgreementWizardState {
  primaryCompanyId: string;
  authorizedContactId: string;
  entityIds: string[];
  agreementDate: string;
  effectiveDate: string;
  termMonths: number;
  items: ServiceAgreementItemInput[];
}
```

Rules:

- Selecting a Service Agreement template makes company selection mandatory and removes “No company selected.”
- Primary company is always first and cannot be removed from Appendix 3.
- Additional company selector uses existing paginated options and company-access filtering.
- PIC options come from current primary-company contacts and show name, role, email, and phone.
- Add/reorder/copy/remove service items. Duplicate variants are permitted.
- Each service item selects one or more included entities and exposes required service placeholders from its pinned snapshot.
- Selecting an entity copies every default fee template into an entity-specific fee row; changing/removing entities never changes another entity’s fees.
- The Details step contains agreement/effective dates, term months, document title, master custom fields, and letterhead.
- Moving to Review first saves the draft, then previews by `serviceAgreementId`.
- Resume hydrates from `GenerationSessionEnvelope.agreement`.

- [ ] **Step 4: Add the no-sync editor warning**

Render above the A4 editor:

> This is a Service Agreement. Manual edits to service wording, dates, entities, or fees change this document only. Client Services will use the structured values from the Services step. Return to Services to change operational data.

The warning is persistent, uses warning semantic colors, and includes a `Back to Services` button. Do not block editing.

- [ ] **Step 5: Run component and browser tests**

```powershell
npx.cmd vitest run __tests__/components/document-generation-wizard.test.tsx
npx.cmd vitest run --config vitest.browser.config.ts __tests__/browser/service-agreement-generation.browser.test.tsx
```

Expected: both suites pass.

- [ ] **Step 6: Commit wizard**

```powershell
git add src/components/documents/service-agreement src/components/documents/document-generation-wizard.tsx src/components/documents/document-generation-stage.ts 'src/app/(dashboard)/generated-documents/generate/page.tsx' __tests__/components/document-generation-wizard.test.tsx __tests__/browser/service-agreement-generation.browser.test.tsx
git commit -m "feat(documents): add service agreement generation workflow"
```

### Task 8: Add the initial inactive Service Agreement content bundle

**Files:**
- Create: `src/content/service-agreement/oaktree-service-agreement-v1.ts`
- Create: `scripts/seed-service-agreement-template.ts`
- Modify: `package.json`
- Create: `__tests__/services/service-agreement-seed-content.test.ts`

**Interfaces:**
- Produces an idempotent explicit seed command for one tenant/user.
- Creates inactive catalog/template content; never runs during general migrations.

- [ ] **Step 1: Write failing content-contract tests**

```ts
expect(OAKTREE_SERVICE_AGREEMENT_V1.template.compositionType).toBe('SERVICE_AGREEMENT');
for (const token of Object.values(SERVICE_AGREEMENT_SLOTS)) {
  expect(OAKTREE_SERVICE_AGREEMENT_V1.template.content.split(token)).toHaveLength(2);
}
expect(OAKTREE_SERVICE_AGREEMENT_V1.template.content).not.toMatch(/OpenSign|DocumentId/);
expect(OAKTREE_SERVICE_AGREEMENT_V1.template.content).not.toContain('<img');
expect(OAKTREE_SERVICE_AGREEMENT_V1.variants).toHaveLength(2);
```

- [ ] **Step 2: Transcribe controlled content**

Use the exact source:

`C:\Users\Scotfield\Oaktree Accounting & Corporate Solutions Pte. Ltd\Operation - Documents\0. Client Documents\96 Fruit Avenue Pte. Ltd\0. Service Agreement\Service Agreement 96 Fruit Avenue 9 Jul 26.pdf`

Map:

- Pages 1-2: cover, appendix index, acceptance, and signature placeholders.
- Pages 3-7: Terms of Business.
- Page 8: shared SOW introduction.
- Page 9: Corporate Secretarial partial.
- Page 10: Unaudited Financial Statement Compilation and Corporate Tax partial.
- Page 11: replace the sample table with `{{@agreement.feeTable}}`.
- Page 12: instructions/term/signature placeholders.
- Page 13: replace the sample entity with `{{@agreement.entityAppendix}}`.

Remove both handwritten signatures, all `OpenSign` headers/footers/IDs, and the sample client values. Replace client/company/date/PIC values with existing primary-company/selected-contact/system placeholders. Use service-scoped fields only where the supplied wording requires an agreement-specific value.

Create exactly:

- Family `CORPORATE_SECRETARIAL`, variant `CORPORATE_SECRETARIAL_ANNUAL`.
- Family `FINANCIAL_STATEMENTS_TAX`, variant `UNAUDITED_FS_AND_CORPORATE_TAX_ANNUAL`.
- One SOW partial per supplied SOW.
- One `SERVICE_AGREEMENT` template.

Set every created family/variant/template `isActive = false`.

- [ ] **Step 3: Implement idempotent explicit seeding**

Add:

```json
"db:seed-service-agreement": "tsx scripts/seed-service-agreement-template.ts"
```

The script requires:

```powershell
npm.cmd run db:seed-service-agreement -- --tenantId <uuid> --userId <uuid>
```

It validates both IDs, confirms the user belongs to the tenant, upserts by tenant/code/name, never activates records, and prints created/updated IDs without printing legal content or personal data.

- [ ] **Step 4: Run content tests**

```powershell
npx.cmd vitest run __tests__/services/service-agreement-seed-content.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit content bundle**

```powershell
git add src/content/service-agreement/oaktree-service-agreement-v1.ts scripts/seed-service-agreement-template.ts package.json package-lock.json __tests__/services/service-agreement-seed-content.test.ts
git commit -m "feat(documents): add initial service agreement content"
```

### Task 9: Verify rendering and document the generator

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/guides/SERVICE_PATTERNS.md`
- Modify: `docs/reference/DATABASE_SCHEMA.md`

**Interfaces:**
- Documents draft authority, version pinning, assembly order, and manual-edit divergence.

- [ ] **Step 1: Update existing documentation**

Document:

- Service Agreement relational draft ownership.
- Session v1/v2 compatibility.
- Slot assembly order and local `service` context.
- Explicit refresh behavior.
- Structured-data versus edited-document authority.
- Initial content seed command and inactive-review gate.

- [ ] **Step 2: Run Plan 2 focused verification**

```powershell
npm.cmd run db:generate
npx.cmd vitest run __tests__/services/service-agreement-schema.test.ts __tests__/lib/service-agreement-validation.test.ts __tests__/services/service-agreement-draft.service.test.ts __tests__/services/service-agreement-renderer.test.ts __tests__/services/document-generation-session.service.test.ts __tests__/services/document-generator.service.test.ts __tests__/api/service-agreement-generation-routes.test.ts __tests__/components/document-generation-wizard.test.tsx __tests__/services/service-agreement-seed-content.test.ts
npx.cmd vitest run --config vitest.browser.config.ts __tests__/browser/service-agreement-generation.browser.test.tsx
```

Expected: Prisma generation and all listed suites exit 0.

- [ ] **Step 3: Perform PDF inspection**

Seed the inactive content into a development tenant, review and activate it manually, then generate a two-entity agreement with both service variants and different entity fees. Export PDF and inspect every page for:

- Primary-company/PIC correctness.
- Standard Terms of Business continuity.
- SOW ordering and page breaks.
- Entity-labelled fee rows and currency/frequency formatting.
- Instructions/signature placeholders.
- Appendix 3 numbering and UEN snapshots.
- No sample signatures, OpenSign IDs, unresolved placeholders, clipped tables, or overlapping text.

- [ ] **Step 4: Commit documentation**

```powershell
git add docs/ARCHITECTURE.md docs/guides/SERVICE_PATTERNS.md docs/reference/DATABASE_SCHEMA.md
git commit -m "docs(documents): document service agreement generation"
```
