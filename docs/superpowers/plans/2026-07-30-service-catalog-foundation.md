# Service Catalog and Template Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the tenant-scoped service catalog, material versioning, service placeholders, and validated Service Agreement composition slots required by the generation plan.

**Architecture:** Keep catalog business logic in a focused `src/services/service-catalog/` module, expose Zod-validated tenant-scoped routes, and integrate catalog management into the existing `/template-partials` document setup surface. Extend existing template/partial records additively so all current templates and drafts keep their behavior.

**Tech Stack:** Prisma 7/PostgreSQL, TypeScript 5.7, Zod 3, Next.js route handlers, React 19, TanStack Query 5, Vitest 4, existing Oakcloud audit/RBAC patterns.

## Global Constraints

- Preserve unrelated A4 editor changes already present in the working tree.
- Existing `DocumentTemplate` rows migrate to `compositionType = STANDARD`.
- Existing `TemplatePartial` rows migrate to `version = 1`.
- Increment `TemplatePartial.version` only when `content` or `placeholders` changes.
- Increment `ServiceVariant.version` when name, partial link, cadence, custom cadence label, or fee templates change.
- Use `document:read/create/update/delete` permissions for catalog operations.
- Every catalog query includes `tenantId` and excludes `deletedAt != null`.
- Catalog deletes are soft deletes; referenced variants/partials remain readable through agreement snapshots in the next plan.
- Service Agreement fee defaults are entity-agnostic templates; Plan 2 copies them into entity-specific fee rows.
- Follow `docs/guides/DESIGN_GUIDELINE.md` for all UI.

---

### Task 1: Add catalog and composition schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260730090000_service_catalog_foundation/migration.sql`
- Create: `__tests__/services/service-catalog-schema.test.ts`

**Interfaces:**
- Produces Prisma enums `ServiceCadence`, `BillingFrequency`, and `DocumentTemplateCompositionType`.
- Produces models `ServiceFamily`, `ServiceVariant`, and `ServiceVariantFeeTemplate`.
- Extends `DocumentTemplate.compositionType` and `TemplatePartial.version`.

- [ ] **Step 1: Write the failing schema contract test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('service catalog Prisma schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it('defines additive catalog and composition contracts', () => {
    expect(schema).toContain('enum DocumentTemplateCompositionType');
    expect(schema).toContain('enum ServiceCadence');
    expect(schema).toContain('enum BillingFrequency');
    expect(schema).toContain('model ServiceFamily');
    expect(schema).toContain('model ServiceVariant');
    expect(schema).toContain('model ServiceVariantFeeTemplate');
    expect(schema).toContain('compositionType DocumentTemplateCompositionType @default(STANDARD)');
    expect(schema).toContain('version     Int       @default(1)');
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-schema failure**

Run:

```powershell
npx.cmd vitest run __tests__/services/service-catalog-schema.test.ts
```

Expected: FAIL because the new enums/models/fields are absent.

- [ ] **Step 3: Add the exact Prisma contracts**

Add:

```prisma
enum DocumentTemplateCompositionType {
  STANDARD
  SERVICE_AGREEMENT
}

enum ServiceCadence {
  MONTHLY
  QUARTERLY
  SEMI_ANNUALLY
  ANNUALLY
  ONE_TIME
  AD_HOC
  CUSTOM
}

enum BillingFrequency {
  MONTHLY
  QUARTERLY
  SEMI_ANNUALLY
  ANNUALLY
  ONE_TIME
  CUSTOM
}

model ServiceFamily {
  id           String           @id @default(uuid())
  tenantId     String           @map("tenant_id")
  code         String           @db.VarChar(100)
  name         String           @db.VarChar(200)
  description  String?
  displayOrder Int              @default(0) @map("display_order")
  isActive     Boolean          @default(true) @map("is_active")
  createdAt    DateTime         @default(now()) @map("created_at")
  updatedAt    DateTime         @updatedAt @map("updated_at")
  deletedAt    DateTime?        @map("deleted_at")
  tenant       Workspace        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  variants     ServiceVariant[]

  @@unique([tenantId, code])
  @@index([tenantId, deletedAt, isActive])
  @@index([tenantId, displayOrder])
  @@map("service_families")
}

model ServiceVariant {
  id                   String                      @id @default(uuid())
  tenantId             String                      @map("tenant_id")
  familyId             String                      @map("family_id")
  sowPartialId         String                      @map("sow_partial_id")
  code                 String                      @db.VarChar(100)
  name                 String                      @db.VarChar(200)
  description          String?
  serviceCadence       ServiceCadence              @map("service_cadence")
  customCadenceLabel   String?                     @map("custom_cadence_label") @db.VarChar(100)
  displayOrder         Int                         @default(0) @map("display_order")
  version              Int                         @default(1)
  isActive             Boolean                     @default(true) @map("is_active")
  createdAt            DateTime                    @default(now()) @map("created_at")
  updatedAt            DateTime                    @updatedAt @map("updated_at")
  deletedAt            DateTime?                   @map("deleted_at")
  tenant               Workspace                   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  family               ServiceFamily               @relation(fields: [familyId], references: [id], onDelete: Restrict)
  sowPartial           TemplatePartial             @relation(fields: [sowPartialId], references: [id], onDelete: Restrict)
  defaultFeeTemplates  ServiceVariantFeeTemplate[]

  @@unique([tenantId, code])
  @@index([tenantId, familyId, deletedAt, isActive])
  @@index([tenantId, displayOrder])
  @@index([sowPartialId])
  @@map("service_variants")
}

model ServiceVariantFeeTemplate {
  id                   String            @id @default(uuid())
  tenantId             String            @map("tenant_id")
  variantId            String            @map("variant_id")
  description          String            @db.VarChar(500)
  defaultAmount        Decimal?          @map("default_amount") @db.Decimal(18, 2)
  currency             String            @default("SGD") @db.VarChar(3)
  billingFrequency     BillingFrequency  @map("billing_frequency")
  customFrequencyLabel String?           @map("custom_frequency_label") @db.VarChar(100)
  displayOrder         Int               @default(0) @map("display_order")
  createdAt            DateTime          @default(now()) @map("created_at")
  updatedAt            DateTime          @updatedAt @map("updated_at")
  tenant               Workspace         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  variant              ServiceVariant    @relation(fields: [variantId], references: [id], onDelete: Cascade)

  @@index([tenantId, variantId, displayOrder])
  @@map("service_variant_fee_templates")
}
```

Add these exact inverse relations:

```prisma
// Workspace
serviceFamilies            ServiceFamily[]
serviceVariants            ServiceVariant[]
serviceVariantFeeTemplates ServiceVariantFeeTemplate[]

// TemplatePartial
serviceVariants ServiceVariant[]
```

Add:

```prisma
compositionType DocumentTemplateCompositionType @default(STANDARD) @map("composition_type")
```

to `DocumentTemplate`, and:

```prisma
version         Int              @default(1)
serviceVariants ServiceVariant[]
```

to `TemplatePartial`.

The SQL migration must create enums/tables/indexes/FKs and use additive defaults:

```sql
ALTER TABLE "document_templates"
  ADD COLUMN "composition_type" "DocumentTemplateCompositionType" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "template_partials"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
```

- [ ] **Step 4: Generate Prisma and rerun the schema test**

Run:

```powershell
npm.cmd run db:generate
npx.cmd vitest run __tests__/services/service-catalog-schema.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the schema**

```powershell
git add prisma/schema.prisma prisma/migrations/20260730090000_service_catalog_foundation/migration.sql __tests__/services/service-catalog-schema.test.ts src/generated/prisma
git commit -m "feat(services): add service catalog schema"
```

### Task 2: Define validation and public catalog types

**Files:**
- Create: `src/lib/validations/service-catalog.ts`
- Create: `src/services/service-catalog/types.ts`
- Create: `src/services/service-catalog/index.ts`
- Test: `__tests__/lib/service-catalog-validation.test.ts`

**Interfaces:**
- Produces `serviceCadenceSchema`, `billingFrequencySchema`, family/variant CRUD schemas, `ServiceCatalogDto`, and `ServiceVariantDto`.
- Plan 2 consumes `ServiceVariantDto` and fee-template shapes.

- [ ] **Step 1: Write failing Zod contract tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  createServiceFamilySchema,
  createServiceVariantSchema,
} from '@/lib/validations/service-catalog';

describe('service catalog validation', () => {
  it('normalizes codes and validates custom cadence labels', () => {
    expect(createServiceFamilySchema.parse({ code: ' corp-sec ', name: 'Corporate Secretarial' }).code)
      .toBe('CORP-SEC');
    expect(() => createServiceVariantSchema.parse({
      familyId: crypto.randomUUID(),
      sowPartialId: crypto.randomUUID(),
      code: 'CUSTOM',
      name: 'Custom',
      serviceCadence: 'CUSTOM',
      feeTemplates: [],
    })).toThrow(/custom cadence label/i);
  });
});
```

- [ ] **Step 2: Run the validation test**

Run:

```powershell
npx.cmd vitest run __tests__/lib/service-catalog-validation.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement exact validation rules**

Implement:

```ts
const codeSchema = z.string().trim().min(1).max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
  .transform((value) => value.toUpperCase());

export const serviceCadenceSchema = z.enum([
  'MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY',
  'ONE_TIME', 'AD_HOC', 'CUSTOM',
]);

export const billingFrequencySchema = z.enum([
  'MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY',
  'ONE_TIME', 'CUSTOM',
]);

export const serviceVariantFeeTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(500),
  defaultAmount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/).nullable().optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('SGD'),
  billingFrequency: billingFrequencySchema,
  customFrequencyLabel: z.string().trim().min(1).max(100).nullable().optional(),
  displayOrder: z.number().int().min(0),
}).superRefine((value, context) => {
  if (value.billingFrequency === 'CUSTOM' && !value.customFrequencyLabel) {
    context.addIssue({ code: 'custom', path: ['customFrequencyLabel'], message: 'Custom frequency label is required' });
  }
});
```

Family create/update/search and variant create/update/search schemas must enforce:

- Unique normalized codes at the service layer.
- `CUSTOM` cadence requires `customCadenceLabel`; other cadences clear it.
- Fee display orders are unique within the submitted list.
- At most 50 default fee rows per variant.
- Search limits use 1-100 and default ordering is `displayOrder asc, name asc`.

Define DTOs with string decimal values:

```ts
export interface ServiceVariantDto {
  id: string;
  familyId: string;
  code: string;
  name: string;
  description: string | null;
  serviceCadence: ServiceCadence;
  customCadenceLabel: string | null;
  displayOrder: number;
  version: number;
  isActive: boolean;
  sowPartial: {
    id: string;
    name: string;
    displayName: string | null;
    version: number;
    placeholders: unknown;
  };
  feeTemplates: Array<{
    id: string;
    description: string;
    defaultAmount: string | null;
    currency: string;
    billingFrequency: BillingFrequency;
    customFrequencyLabel: string | null;
    displayOrder: number;
  }>;
}
```

- [ ] **Step 4: Run validation tests**

Run:

```powershell
npx.cmd vitest run __tests__/lib/service-catalog-validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit validation and types**

```powershell
git add src/lib/validations/service-catalog.ts src/services/service-catalog/types.ts src/services/service-catalog/index.ts __tests__/lib/service-catalog-validation.test.ts
git commit -m "feat(services): define service catalog contracts"
```

### Task 3: Implement tenant-safe catalog services and versioning

**Files:**
- Create: `src/services/service-catalog/service.ts`
- Modify: `src/services/service-catalog/index.ts`
- Modify: `src/services/template-partial.service.ts`
- Test: `__tests__/services/service-catalog.service.test.ts`
- Test: `__tests__/services/template-partial-versioning.test.ts`

**Interfaces:**
- Produces `listServiceCatalog`, `getServiceVariant`, family/variant CRUD, and `getSelectableServiceVariants`.
- Produces material-version rules consumed by Plan 2.

- [ ] **Step 1: Write failing service tests**

```ts
it('increments a variant once when material fields or fee templates change', async () => {
  prismaMock.serviceVariant.findFirst.mockResolvedValue(existingVariant);
  await updateServiceVariant(existingVariant.id, {
    name: 'Quarterly Accounting',
    feeTemplates: [{ description: 'Accounting', defaultAmount: '300.00', currency: 'SGD', billingFrequency: 'QUARTERLY', displayOrder: 0 }],
  }, actor);
  expect(prismaMock.serviceVariant.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ version: { increment: 1 } }),
  }));
});

it('increments partial version only for content or placeholders', async () => {
  await updateTemplatePartial(partial.id, { displayName: 'Renamed' }, actor);
  expect(prismaMock.templatePartial.update).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ version: expect.anything() }),
  }));
});
```

- [ ] **Step 2: Run service tests**

Run:

```powershell
npx.cmd vitest run __tests__/services/service-catalog.service.test.ts __tests__/services/template-partial-versioning.test.ts
```

Expected: FAIL because catalog services and partial version behavior are absent.

- [ ] **Step 3: Implement catalog services**

Export:

```ts
export async function listServiceCatalog(
  input: SearchServiceCatalogInput,
  params: TenantAwareParams,
): Promise<{ families: ServiceFamilyDto[]; total: number }>;

export async function getSelectableServiceVariants(
  tenantId: string,
): Promise<ServiceVariantDto[]>;

export async function createServiceFamily(
  input: CreateServiceFamilyInput,
  params: TenantAwareParams,
): Promise<ServiceFamilyDto>;

export async function updateServiceFamily(
  id: string,
  input: UpdateServiceFamilyInput,
  params: TenantAwareParams,
): Promise<ServiceFamilyDto>;

export async function archiveServiceFamily(
  id: string,
  reason: string,
  params: TenantAwareParams,
): Promise<{ id: string; archived: true }>;

export async function createServiceVariant(
  input: CreateServiceVariantInput,
  params: TenantAwareParams,
): Promise<ServiceVariantDto>;

export async function updateServiceVariant(
  id: string,
  input: UpdateServiceVariantInput,
  params: TenantAwareParams,
): Promise<ServiceVariantDto>;

export async function archiveServiceVariant(
  id: string,
  reason: string,
  params: TenantAwareParams,
): Promise<{ id: string; archived: true }>;
```

Every family/variant/partial lookup must include tenant ownership. Validate that the linked partial is active in the same tenant. Update variants and replace fee templates in one Prisma transaction. Increment the variant once per material update, not once per fee row. Create Oakcloud audit records with entity types `ServiceFamily` and `ServiceVariant`.

In `updateTemplatePartial`, compare normalized `content` and serialized `placeholders` against the stored record. Add `version: { increment: 1 }` only when either differs; include old/new version in the audit metadata.

- [ ] **Step 4: Run service tests**

Run:

```powershell
npx.cmd vitest run __tests__/services/service-catalog.service.test.ts __tests__/services/template-partial-versioning.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit services**

```powershell
git add src/services/service-catalog src/services/template-partial.service.ts __tests__/services/service-catalog.service.test.ts __tests__/services/template-partial-versioning.test.ts
git commit -m "feat(services): implement service catalog management"
```

### Task 4: Add service placeholders and agreement-slot validation

**Files:**
- Modify: `src/lib/validations/document-template.ts`
- Modify: `src/components/documents/template-editor/template-validation.ts`
- Modify: `src/components/documents/template-editor/placeholder-panel.tsx`
- Modify: `src/components/documents/template-editor/template-builders.ts`
- Test: `__tests__/components/template-editor/template-validation.test.ts`
- Test: `__tests__/components/template-editor/placeholder-panel.test.tsx`

**Interfaces:**
- Produces `SERVICE_AGREEMENT_SLOTS`, `ServiceAgreementSlotName`, and `validateServiceAgreementSlots`.
- Extends `PlaceholderDefinition.source` with `service` and supports `textarea`.

- [ ] **Step 1: Add failing slot and placeholder tests**

```ts
expect(validateTemplate({
  compositionType: 'SERVICE_AGREEMENT',
  content: '<p>No composition slots</p>',
  placeholders: [],
})).toEqual(expect.arrayContaining([
  expect.objectContaining({ message: expect.stringMatching(/serviceSections/) }),
]));

expect(placeholderDefinitionSchema.parse({
  key: 'service.fields.software',
  label: 'Accounting software',
  type: 'textarea',
  source: 'service',
  required: false,
})).toMatchObject({ source: 'service', type: 'textarea' });
```

- [ ] **Step 2: Run focused template-editor tests**

Run:

```powershell
npx.cmd vitest run __tests__/components/template-editor/template-validation.test.ts __tests__/components/template-editor/placeholder-panel.test.tsx
```

Expected: FAIL for missing composition fields, slot helpers, and service placeholder support.

- [ ] **Step 3: Implement stable slot contracts**

Create in `template-validation.ts` or a focused exported helper:

```ts
export const SERVICE_AGREEMENT_SLOTS = {
  serviceSections: '{{@agreement.serviceSections}}',
  feeTable: '{{@agreement.feeTable}}',
  entityAppendix: '{{@agreement.entityAppendix}}',
} as const;

export function validateServiceAgreementSlots(content: string): TemplateValidationIssue[] {
  return Object.entries(SERVICE_AGREEMENT_SLOTS).flatMap(([name, token]) => {
    const count = content.split(token).length - 1;
    if (count === 1) return [];
    return [{
      severity: 'error',
      code: count === 0 ? 'missing-agreement-slot' : 'duplicate-agreement-slot',
      message: `Service Agreement template must contain exactly one ${name} slot.`,
    }];
  });
}
```

Run this validation only when `compositionType === 'SERVICE_AGREEMENT'`. Extend document-template create/update schemas with `compositionType` and the placeholder enums. Add a compact `Agreement blocks` group to the placeholder panel with Insert/Copy actions for all three tokens. Do not expose the tokens as editable custom field definitions.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npx.cmd vitest run __tests__/components/template-editor/template-validation.test.ts __tests__/components/template-editor/placeholder-panel.test.tsx __tests__/lib/service-catalog-validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit editor contracts**

```powershell
git add src/lib/validations/document-template.ts src/components/documents/template-editor/template-validation.ts src/components/documents/template-editor/placeholder-panel.tsx src/components/documents/template-editor/template-builders.ts __tests__/components/template-editor/template-validation.test.ts __tests__/components/template-editor/placeholder-panel.test.tsx
git commit -m "feat(documents): add service agreement template contracts"
```

### Task 5: Expose service catalog APIs

**Files:**
- Create: `src/app/api/service-catalog/route.ts`
- Create: `src/app/api/service-catalog/families/route.ts`
- Create: `src/app/api/service-catalog/families/[id]/route.ts`
- Create: `src/app/api/service-catalog/variants/route.ts`
- Create: `src/app/api/service-catalog/variants/[id]/route.ts`
- Test: `__tests__/api/service-catalog-routes.test.ts`

**Interfaces:**
- `GET /api/service-catalog?selectable=true` returns active families/variants for generation.
- CRUD routes return DTOs from Task 2 and use existing document permissions.

- [ ] **Step 1: Write failing route tests**

```ts
it('uses session workspace and document permissions', async () => {
  const response = await GET(new NextRequest('http://localhost/api/service-catalog?selectable=true'));
  expect(requirePermissionMock).toHaveBeenCalledWith(session, 'document', 'read');
  expect(getSelectableServiceVariantsMock).toHaveBeenCalledWith(session.tenantId);
  expect(response.status).toBe(200);
});
```

Cover `read/create/update/delete`, invalid Zod payloads as 400, missing rows as 404, duplicate codes as 409, and tenant mismatch as 404.

- [ ] **Step 2: Run the route suite**

Run:

```powershell
npx.cmd vitest run __tests__/api/service-catalog-routes.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement route handlers**

Use:

```ts
const session = await requireAuth();
await requirePermission(session, 'document', action);
const tenantId = requireSessionWorkspaceId(session);
```

Do not accept caller-supplied `tenantId` on generation-facing routes. Preserve existing SUPER_ADMIN workspace selection only on the setup UI by forwarding its active workspace through the established template-partials pattern and validating it with `resolveWorkspaceId`.

Use `createErrorResponse` for typed service errors, returning 409 explicitly for duplicate codes and referenced-archive attempts.

- [ ] **Step 4: Run route and service tests**

Run:

```powershell
npx.cmd vitest run __tests__/api/service-catalog-routes.test.ts __tests__/services/service-catalog.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit APIs**

```powershell
git add src/app/api/service-catalog __tests__/api/service-catalog-routes.test.ts
git commit -m "feat(api): expose service catalog routes"
```

### Task 6: Add the Service Catalog setup UI

**Files:**
- Create: `src/components/documents/service-catalog/service-catalog-panel.tsx`
- Create: `src/components/documents/service-catalog/service-family-form.tsx`
- Create: `src/components/documents/service-catalog/service-variant-form.tsx`
- Create: `src/hooks/use-service-catalog.ts`
- Modify: `src/app/(dashboard)/template-partials/page.tsx`
- Test: `__tests__/components/service-catalog.test.tsx`

**Interfaces:**
- Adds `services` to the local `TabType`.
- Uses APIs from Task 5 and links SOW editing to `/template-partials/editor?type=partial&id=<id>`.

- [ ] **Step 1: Write failing UI tests**

```tsx
render(<ServiceCatalogPanel canCreate canUpdate canDelete />);
expect(screen.getByRole('heading', { name: 'Service catalog' })).toBeVisible();
expect(screen.getByRole('button', { name: 'Add service family' })).toBeEnabled();

await user.click(screen.getByRole('button', { name: 'Add variant' }));
expect(screen.getByLabelText('SOW partial')).toBeVisible();
expect(screen.getByRole('button', { name: 'Add fee row' })).toBeVisible();
```

Also assert read-only permissions hide mutation actions and the `?tab=services` URL restores the Services tab.

- [ ] **Step 2: Run the component suite**

Run:

```powershell
npx.cmd vitest run __tests__/components/service-catalog.test.tsx
```

Expected: FAIL because the components/tab do not exist.

- [ ] **Step 3: Implement compact catalog management**

The panel must provide:

- Search plus active/inactive filter.
- Family rows with ordered variant children.
- Version, cadence, linked partial, active state, and default fee summaries.
- Create/edit/archive dialogs with explicit archive reason.
- Variant form with partial selector, cadence/custom cadence, and reorderable fee templates.
- `Edit wording` link to the partial editor.
- Empty/loading/error states and dark-mode-safe design tokens.

Use TanStack Query keys:

```ts
['service-catalog', workspaceId, filters]
['service-catalog-selectable', workspaceId]
```

Invalidate both keys after mutations. Update page description to “Manage document templates, reusable partials, and service offerings.”

- [ ] **Step 4: Run UI, route, and existing access tests**

Run:

```powershell
npx.cmd vitest run __tests__/components/service-catalog.test.tsx __tests__/api/service-catalog-routes.test.ts __tests__/app/template-partials-access.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the catalog UI**

```powershell
git add src/components/documents/service-catalog src/hooks/use-service-catalog.ts 'src/app/(dashboard)/template-partials/page.tsx' __tests__/components/service-catalog.test.tsx
git commit -m "feat(documents): add service catalog setup UI"
```

### Task 7: Final foundation verification and documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/reference/DATABASE_SCHEMA.md`
- Modify: `docs/guides/SERVICE_PATTERNS.md`

**Interfaces:**
- Documents catalog ownership, permissions, version rules, and Plan 2 handoff contracts.

- [ ] **Step 1: Update existing documentation**

Document:

- Catalog model relationships and soft-deletion policy.
- `STANDARD` versus `SERVICE_AGREEMENT`.
- Slot token names.
- Variant/partial material-version rules.
- Service placeholder paths and fee-template behavior.

- [ ] **Step 2: Run the complete Plan 1 verification**

```powershell
npm.cmd run db:generate
npx.cmd vitest run __tests__/services/service-catalog-schema.test.ts __tests__/lib/service-catalog-validation.test.ts __tests__/services/service-catalog.service.test.ts __tests__/services/template-partial-versioning.test.ts __tests__/api/service-catalog-routes.test.ts __tests__/components/service-catalog.test.tsx __tests__/components/template-editor/template-validation.test.ts __tests__/components/template-editor/placeholder-panel.test.tsx __tests__/app/template-partials-access.test.ts
```

Expected: Prisma generation and all listed suites exit 0.

- [ ] **Step 3: Inspect the diff for scope**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only Plan 1 files plus any explicitly preserved pre-existing changes appear.

- [ ] **Step 4: Commit documentation**

```powershell
git add docs/ARCHITECTURE.md docs/reference/DATABASE_SCHEMA.md docs/guides/SERVICE_PATTERNS.md
git commit -m "docs(services): document service catalog foundation"
```
