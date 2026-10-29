# Manual Client Service Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorized company editor create a catalog-backed operational Client Service without a Service Agreement while preserving source lineage, flexible editing, duplicate warnings, atomic writes, and all existing agreement-backed behavior.

**Architecture:** Add a source-aware persistence model and a company-scoped catalog projection, then place manual creation behind a dedicated serializable transaction service and the existing company Services route. Keep the operational form controlled and shared between create and edit wrappers; let the create wrapper own catalog/default/dirty/duplicate state and let the edit wrapper retain optimistic concurrency and archive behavior. Return both sources through one nullable-agreement DTO mapper so list, detail, update, archive, backup, restore, and cleanup stay common.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma 7/PostgreSQL, Zod 3, TanStack Query 5, Vitest, Testing Library, Vitest Browser/Playwright, Tailwind CSS

## Global Constraints

- Start implementation in an isolated worktree by invoking `superpowers:using-git-worktrees`; the current working tree contains unrelated user changes that must remain untouched.
- Follow test-driven development: add the focused failing test, run it and observe the expected failure, implement only the behavior under test, then rerun it before moving on.
- Run `npm.cmd run db:generate` after every Prisma schema change. Never hand-edit generated Prisma files.
- Require `company:update` for catalog options and manual creation. Do not require or probe `document:read`.
- Derive `tenantId` and actor identity from the authenticated session. Never accept either value from the request.
- Keep `source`, `serviceVariantId`, `agreementId`, and `agreementItemId` immutable by excluding them from the update schema and update data.
- Keep SOW field definitions advisory for manual creation: ignore `required`, accept missing catalog fields, and accept additional operational fields within the shared limits.
- Keep all duplicate checks, service/fee writes, audit creation, and DTO reload in one bounded serializable transaction.
- Never include operational `fieldValues` in audit changes or summaries.
- Preserve the existing agreement activation idempotency key `(agreementItemId, companyId)` and create a separate agreement-backed service when a later agreement matches a manual service.
- Preserve current Services-tab search, status filtering, pagination, optimistic edit conflicts, fixed-point fee serialization, archive reasons, activation retry notices, and responsive/accessibility patterns.
- Update existing documentation only, in accordance with `AGENTS.md`, and follow `docs/guides/DESIGN_GUIDELINE.md` for UI work.

---

## Target File Structure

### Persistence and domain

- Modify `prisma/schema.prisma`: add `ClientServiceSource`, source/default, nullable agreement relationships, and the duplicate lookup index.
- Create `prisma/migrations/20260809010000_manual_client_service_creation/migration.sql`: backfill source, relax agreement nullability, add the source/reference check, and add the lookup index.
- Regenerate `src/generated/prisma/enums.ts`, `src/generated/prisma/models/ClientService.ts`, `src/generated/prisma/internal/prismaNamespace.ts`, `src/generated/prisma/internal/prismaNamespaceBrowser.ts`, and related generator-owned exports through `npm.cmd run db:generate`.
- Create `src/services/client-service/mapper.ts`: one include and one mapper for agreement and manual DTOs.
- Create `src/services/client-service/fee-summary.ts`: fixed-point audit fee totals shared by create and update.
- Create `src/services/client-service/errors.ts`: stable duplicate and retry-exhaustion errors.
- Create `src/services/client-service/manual-create.ts`: the atomic manual creation use case.
- Create `src/services/client-service/catalog-options.ts`: the minimal company-scoped catalog projection.
- Modify `src/services/client-service/types.ts`, `src/services/client-service/service.ts`, and `src/services/client-service/index.ts`: publish the new contracts and use the common mapper/helpers.
- Modify `src/services/service-agreement/activation.service.ts`: write `source: 'AGREEMENT'` explicitly.
- Modify `src/services/service-agreement/snapshot.ts`: export pure partial-graph composition for reuse without exposing legal content.
- Modify `src/lib/prisma-transaction.ts`: export serialization-conflict detection for exhaustion mapping.

### Validation, HTTP, and hooks

- Modify `src/lib/validations/client-service.ts`: add the normalized create schema while preserving update rules.
- Modify `src/lib/errors.ts` and `src/lib/api-helpers.ts`: retain stable codes/details across the generic API boundary.
- Create `src/app/api/companies/[id]/services/route-utils.ts`: serialize field-addressable Zod failures and the duplicate top-level body.
- Modify `src/app/api/companies/[id]/services/route.ts`: add `POST` without changing `GET` authorization.
- Create `src/app/api/companies/[id]/services/catalog-options/route.ts`: add the `company:update`-scoped catalog endpoint.
- Modify `src/hooks/use-client-services.ts`: retain structured error bodies and add catalog/create hooks.

### UI

- Create `src/components/companies/company-detail/client-service-form-state.ts`: shared controlled values, catalog defaults, comparison, validation, and payload conversion.
- Create `src/components/companies/company-detail/operational-service-form.tsx`: common cadence/status/date/field/fee controls.
- Create `src/components/companies/company-detail/client-service-creator.tsx`: create-only catalog, dirty-close, variant-switch, duplicate, and submit workflow.
- Modify `src/components/companies/company-detail/client-service-editor.tsx`: consume the shared operational form and render source-aware edit/archive copy.
- Modify `src/components/companies/company-detail/company-services-tab.tsx`: permission-gated entry points, source labels, creation success notice, and direct View-service behavior.

### Tests and documentation

- Modify `__tests__/services/client-service-schema.test.ts`.
- Modify `__tests__/lib/client-service-validation.test.ts` and `__tests__/lib/api-helpers.test.ts`.
- Create `__tests__/services/client-service-catalog-options.test.ts`.
- Create `__tests__/services/client-service-manual-create.test.ts`.
- Create `__tests__/api/manual-client-services-routes.test.ts`.
- Modify `__tests__/services/client-service.service.test.ts`, `__tests__/services/service-agreement-activation.service.test.ts`, and `__tests__/api/client-services-routes.test.ts`.
- Create `__tests__/components/operational-service-form.test.tsx` and `__tests__/components/client-service-creator.test.tsx`.
- Modify `__tests__/components/company-services-tab.test.tsx` and `__tests__/browser/company-services.browser.test.tsx`.
- Create `__tests__/integration/client-service-manual-creation.postgres.test.ts` and modify `package.json` with its focused script.
- Modify `__tests__/services/backup-service-agreement-data.test.ts` for manual/null-lineage fixtures.
- Modify `docs/ARCHITECTURE.md`, `docs/guides/SERVICE_PATTERNS.md`, and `docs/reference/DATABASE_SCHEMA.md`.

---

### Task 1: Make Client Service Persistence and Reads Source-Aware

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260809010000_manual_client_service_creation/migration.sql`
- Regenerate: `src/generated/prisma/enums.ts`
- Regenerate: `src/generated/prisma/models/ClientService.ts`
- Regenerate: `src/generated/prisma/internal/prismaNamespace.ts`
- Regenerate: `src/generated/prisma/internal/prismaNamespaceBrowser.ts`
- Create: `src/services/client-service/mapper.ts`
- Modify: `src/services/client-service/types.ts`
- Modify: `src/services/client-service/service.ts`
- Modify: `src/services/service-agreement/activation.service.ts`
- Modify: `src/components/companies/company-detail/company-services-tab.tsx`
- Modify: `__tests__/services/client-service-schema.test.ts`
- Modify: `__tests__/services/client-service.service.test.ts`
- Modify: `__tests__/services/service-agreement-activation.service.test.ts`
- Modify: `__tests__/components/company-services-tab.test.tsx`

**Interfaces:**
- Consumes: existing agreement-backed `ClientService` rows and `(agreementItemId, companyId)` activation idempotency.
- Produces: immutable `ClientService.source`, nullable agreement lineage, `ClientServiceDto.source`, nullable DTO agreement fields, and one no-N+1 mapper for both sources.

- [ ] **Step 1: Add failing schema, mapper, activation, and card tests**

Assert all of the following before changing production code:

```ts
expect(schema).toContain('enum ClientServiceSource');
expect(schema).toContain('source               ClientServiceSource  @default(AGREEMENT)');
expect(schema).toContain('agreementId          String?');
expect(schema).toContain('agreementItemId      String?');
expect(migration).toContain('CHECK');
expect(migration).toContain('source_reference_consistency');
expect(migration).toContain('client_services_tenant_id_company_id_service_variant_id_start_date_deleted_at_idx');
expect(manualDto).toMatchObject({ source: 'MANUAL', agreementId: null, agreementItemId: null, agreement: null });
expect(agreementDto.agreement?.href).toBe('/generated-documents/document-1');
expect(clientServiceCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ source: 'AGREEMENT' }) }));
```

In the Services-tab test, render one `MANUAL` DTO and one `AGREEMENT` DTO. Assert `Added manually` is plain metadata, only the agreement service has a document link, and neither render path dereferences a null agreement.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```powershell
npm.cmd run test:run -- __tests__/services/client-service-schema.test.ts __tests__/services/client-service.service.test.ts __tests__/services/service-agreement-activation.service.test.ts __tests__/components/company-services-tab.test.tsx
```

Expected: FAIL because the enum/source field, nullable mapper behavior, explicit activation source, and manual card label do not exist.

- [ ] **Step 3: Add the Prisma model and enum**

Change the relevant model fields to:

```prisma
model ClientService {
  id                   String               @id @default(uuid())
  tenantId             String               @map("tenant_id")
  companyId            String               @map("company_id")
  source               ClientServiceSource  @default(AGREEMENT)
  agreementId          String?              @map("agreement_id")
  agreementItemId      String?              @map("agreement_item_id")
  serviceVariantId     String               @map("service_variant_id")
  agreement            ServiceAgreement?    @relation(fields: [agreementId], references: [id], onDelete: Restrict)
  agreementItem        ServiceAgreementItem? @relation(fields: [agreementItemId], references: [id], onDelete: Restrict)

  @@unique([agreementItemId, companyId])
  @@index([tenantId, companyId, status, deletedAt])
  @@index([tenantId, agreementId])
  @@index([serviceVariantId])
  @@index([tenantId, companyId, serviceVariantId, startDate, deletedAt])
  @@map("client_services")
}

enum ClientServiceSource {
  AGREEMENT
  MANUAL
}
```

Retain every unshown existing scalar, relation, and index in `ClientService` unchanged.

- [ ] **Step 4: Write the authoritative migration**

Use this SQL, adjusting only pre-existing generated constraint names if inspection shows a different repository name:

```sql
CREATE TYPE "ClientServiceSource" AS ENUM ('AGREEMENT', 'MANUAL');

ALTER TABLE "client_services"
  ADD COLUMN "source" "ClientServiceSource" NOT NULL DEFAULT 'AGREEMENT';

UPDATE "client_services" SET "source" = 'AGREEMENT';

ALTER TABLE "client_services"
  ALTER COLUMN "agreement_id" DROP NOT NULL,
  ALTER COLUMN "agreement_item_id" DROP NOT NULL;

ALTER TABLE "client_services"
  ADD CONSTRAINT "client_services_source_reference_consistency"
  CHECK (
    ("source" = 'AGREEMENT' AND "agreement_id" IS NOT NULL AND "agreement_item_id" IS NOT NULL)
    OR
    ("source" = 'MANUAL' AND "agreement_id" IS NULL AND "agreement_item_id" IS NULL)
  );

CREATE INDEX "client_services_tenant_id_company_id_service_variant_id_start_date_deleted_at_idx"
  ON "client_services"("tenant_id", "company_id", "service_variant_id", "start_date", "deleted_at");
```

Confirm the migration does not drop `client_services_agreement_item_id_company_id_key`.

- [ ] **Step 5: Generate Prisma artifacts**

Run:

```powershell
npm.cmd run db:generate
```

Expected: PASS; generated enum and nullable relation types reflect the schema.

- [ ] **Step 6: Extract the common include and mapper**

Create `mapper.ts` with an optional agreement include and nullable mapping:

```ts
export const clientServiceInclude = {
  feeLines: { orderBy: [{ displayOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  agreement: {
    select: {
      status: true,
      activationStatus: true,
      generatedDocument: { select: { id: true, title: true } },
    },
  },
} satisfies Prisma.ClientServiceInclude;

export type ClientServiceRecord = Prisma.ClientServiceGetPayload<{
  include: typeof clientServiceInclude;
}>;

export const dateOnly = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

export function toClientServiceDto(service: ClientServiceRecord): ClientServiceDto {
  return {
    id: service.id,
    companyId: service.companyId,
    source: service.source,
    agreementId: service.agreementId,
    agreementItemId: service.agreementItemId,
    serviceVariantId: service.serviceVariantId,
    familyName: service.familyName,
    serviceName: service.serviceName,
    status: service.status,
    serviceCadence: service.serviceCadence,
    customCadenceLabel: service.customCadenceLabel,
    startDate: dateOnly(service.startDate)!,
    endDate: dateOnly(service.endDate),
    fieldValues: (service.fieldValues ?? {}) as Record<string, string>,
    feeLines: service.feeLines.map((fee) => ({
      id: fee.id,
      description: fee.description,
      amount: fee.amount.toFixed(2),
      currency: fee.currency,
      billingFrequency: fee.billingFrequency,
      customFrequencyLabel: fee.customFrequencyLabel,
      billingStartDate: dateOnly(fee.billingStartDate),
      displayOrder: fee.displayOrder,
    })),
    agreement: service.agreement ? {
      title: service.agreement.generatedDocument.title,
      status: service.agreement.status,
      activationStatus: service.agreement.activationStatus,
      generatedDocumentId: service.agreement.generatedDocument.id,
      href: `/generated-documents/${service.agreement.generatedDocument.id}`,
    } : null,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}
```

Update `ClientServiceDto` to import `ClientServiceSource` and declare `source`, `agreementId: string | null`, `agreementItemId: string | null`, and `agreement: AgreementSummary | null`. Replace the private include/record/mapper in `service.ts` with these exports.

- [ ] **Step 7: Make agreement writes and card rendering explicit**

Add `source: 'AGREEMENT'` to the activation `clientService.create` data. In the Services card metadata, use:

```tsx
{service.source === 'MANUAL' ? (
  <span className="mt-2 inline-flex text-sm text-text-muted">Added manually</span>
) : service.agreement ? (
  <Link className="mt-2 inline-flex text-sm text-oak-light hover:underline" href={service.agreement.href}>
    {service.agreement.title || 'Service Agreement'}
  </Link>
) : null}
```

- [ ] **Step 8: Rerun focused tests and type-bearing generation**

Run the Step 2 test command again, followed by:

```powershell
npm.cmd run db:generate
```

Expected: PASS; agreement behavior remains idempotent and manual DTOs map without secondary queries.

- [ ] **Step 9: Commit Task 1**

```powershell
git add -- prisma/schema.prisma prisma/migrations/20260809010000_manual_client_service_creation/migration.sql src/generated/prisma src/services/client-service/mapper.ts src/services/client-service/types.ts src/services/client-service/service.ts src/services/service-agreement/activation.service.ts src/components/companies/company-detail/company-services-tab.tsx __tests__/services/client-service-schema.test.ts __tests__/services/client-service.service.test.ts __tests__/services/service-agreement-activation.service.test.ts __tests__/components/company-services-tab.test.tsx
git commit -m "feat(services): add client service source lineage"
```

---

### Task 2: Add Creation Validation and Structured Error Transport

**Files:**
- Modify: `src/lib/validations/client-service.ts`
- Modify: `src/lib/errors.ts`
- Modify: `src/lib/api-helpers.ts`
- Modify: `src/hooks/use-client-services.ts`
- Modify: `src/services/client-service/types.ts`
- Modify: `__tests__/lib/client-service-validation.test.ts`
- Modify: `__tests__/lib/api-helpers.test.ts`
- Create: `__tests__/hooks/use-client-services.test.ts`

**Interfaces:**
- Consumes: raw manual-create JSON and existing `ApiError`/`HttpRequestError` boundaries.
- Produces: normalized `CreateManualClientServiceInput`, stable `VALIDATION_ERROR`/duplicate/write-conflict codes, field-addressable details, and client-visible response bodies.

- [ ] **Step 1: Add failing validation and error-transport tests**

Cover server defaults, required variant/cadence/start date, end-date order, custom cadence, flexible missing/additional service fields, 100-key/10,000-character limits, one-to-100 fees, explicit frequency, custom frequency, uppercase currency, blank/negative amount rejection, and `0.00` acceptance. Assert the create schema rejects client-owned `source`, agreement references, names, fee IDs, fee source IDs, and display order. Assert the update schema rejects `source`, `serviceVariantId`, and agreement references rather than silently stripping them. Also assert:

```ts
expect(createManualClientServiceSchema.parse(validInput)).toMatchObject({
  status: 'ACTIVE',
  fieldValues: {},
  confirmDuplicate: false,
  customCadenceLabel: null,
  endDate: null,
});

expect(await response.json()).toEqual({
  error: 'Invalid request',
  code: 'VALIDATION_ERROR',
  details: { fieldErrors: { 'feeLines.0.amount': 'Enter a non-negative amount with at most two decimals.' } },
});

expect(caught).toMatchObject({
  status: 409,
  code: 'DUPLICATE_CLIENT_SERVICE',
  body: { duplicates: { total: 1 } },
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/lib/client-service-validation.test.ts __tests__/lib/api-helpers.test.ts __tests__/hooks/use-client-services.test.ts
```

Expected: FAIL because no create schema exists and both error layers currently discard structured fields.

- [ ] **Step 3: Implement the normalized create schema**

Add a create-only fee schema with no client-owned ID, display order, or agreement fee source:

```ts
const manualFeeLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/, 'Enter a non-negative amount with at most two decimals.'),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  billingFrequency: billingFrequencySchema,
  customFrequencyLabel: z.string().trim().min(1).max(100).nullable().optional(),
  billingStartDate: z.string().date().nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.billingFrequency === 'CUSTOM' && !value.customFrequencyLabel?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customFrequencyLabel'], message: 'Custom frequency label is required' });
  }
});

export const createManualClientServiceSchema = z.object({
  serviceVariantId: z.string().uuid(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']).default('ACTIVE'),
  serviceCadence: serviceCadenceSchema,
  customCadenceLabel: z.string().trim().min(1).max(100).nullable().optional(),
  startDate: z.string().date(),
  endDate: z.string().date().nullable().optional(),
  fieldValues: z.record(z.string(), z.string().max(10_000)).default({}),
  feeLines: z.array(manualFeeLineSchema).min(1).max(100),
  confirmDuplicate: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  validateCadenceAndDates(value, ctx);
  if (Object.keys(value.fieldValues).length > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fieldValues'], message: 'At most 100 service fields are allowed' });
  }
}).transform((value) => ({
  ...value,
  customCadenceLabel: value.serviceCadence === 'CUSTOM' ? value.customCadenceLabel ?? null : null,
  endDate: value.endDate ?? null,
  feeLines: value.feeLines.map((fee) => ({
    ...fee,
    customFrequencyLabel: fee.billingFrequency === 'CUSTOM' ? fee.customFrequencyLabel ?? null : null,
    billingStartDate: fee.billingStartDate ?? null,
  })),
}));

export type CreateManualClientServiceRequest = z.input<typeof createManualClientServiceSchema>;
export type CreateManualClientServiceInput = z.output<typeof createManualClientServiceSchema>;
```

Make the existing `updateClientServiceSchema` strict as well, and retain the exact `fieldValues` path and message in the test.

- [ ] **Step 4: Preserve stable error metadata on the server and client**

Add `DUPLICATE_CLIENT_SERVICE` and `CLIENT_SERVICE_WRITE_CONFLICT` to `ErrorCodes`. Make generic `ApiError` serialization additive:

```ts
if (error instanceof ApiError) {
  return NextResponse.json({
    error: error.message,
    code: error.code,
    ...(error.details === undefined ? {} : { details: error.details }),
  }, { status: error.statusCode });
}
```

Update old exact-body tests to expect `code` on typed `ApiError` responses while leaving legacy untyped branches unchanged. Extend the client error boundary:

```ts
export interface ErrorResponseBody {
  error?: string;
  code?: string;
  details?: unknown;
  duplicates?: DuplicateClientServiceMatches;
}

export class HttpRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly details: unknown,
    public readonly body: ErrorResponseBody,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

const body = await response.json().catch(() => ({})) as ErrorResponseBody;
if (!response.ok) throw new HttpRequestError(body.error ?? 'Request failed', response.status, body.code, body.details, body);
```

Define `DuplicateClientServiceSummary` and `DuplicateClientServiceMatches` in `src/services/client-service/types.ts` using generated `ClientServiceStatus` and `ClientServiceSource`, so the server error, route response, hook body, and creator warning share one contract.

- [ ] **Step 5: Rerun focused tests**

Run the Step 2 command again.

Expected: PASS; invalid amounts remain addressable, `0.00` parses, and structured bodies survive the hook boundary.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- src/lib/validations/client-service.ts src/lib/errors.ts src/lib/api-helpers.ts src/hooks/use-client-services.ts src/services/client-service/types.ts __tests__/lib/client-service-validation.test.ts __tests__/lib/api-helpers.test.ts __tests__/hooks/use-client-services.test.ts
git commit -m "feat(services): define manual creation contracts"
```

---

### Task 3: Project Minimal Company-Scoped Catalog Options

**Files:**
- Modify: `src/services/service-agreement/snapshot.ts`
- Create: `src/services/client-service/catalog-options.ts`
- Modify: `src/services/client-service/types.ts`
- Modify: `src/services/client-service/index.ts`
- Create: `src/app/api/companies/[id]/services/catalog-options/route.ts`
- Create: `__tests__/services/client-service-catalog-options.test.ts`
- Create: `__tests__/api/manual-client-services-routes.test.ts`

**Interfaces:**
- Consumes: active Service Catalog variants, families, SOW partial graphs, placeholder definitions, fee templates, authenticated workspace, and target company.
- Produces: `ManualClientServiceCatalogOptionsResponse` with operational fields only and a GET route requiring `company:update` alone.

- [ ] **Step 1: Add failing projection and GET-route tests**

Seed or mock a root SOW partial and nested dependency with duplicate `service.fields.*` keys plus document-only placeholders. Assert root-first composition wins, nested unique service fields remain, required metadata and legal content are absent, and inactive/archived variant/family/partial rows are excluded. Route tests must prove a user with `company:update` and no `document:read` receives `200`, while cross-workspace/unavailable companies receive the repository's non-revealing not-found response.

Use an exact response assertion:

```ts
expect(result).toEqual({
  variants: [{
    id: 'variant-1',
    name: 'Corporate Secretarial',
    family: { id: 'family-1', name: 'Corporate Services' },
    serviceCadence: 'ANNUALLY',
    customCadenceLabel: null,
    fields: [{ key: 'software', label: 'Software', type: 'text', defaultValue: 'Xero' }],
    feeTemplates: [{
      description: 'Annual service fee',
      defaultAmount: '1200.00',
      currency: 'SGD',
      billingFrequency: 'ANNUALLY',
      customFrequencyLabel: null,
      displayOrder: 0,
    }],
  }],
});
expect(JSON.stringify(result)).not.toContain('partialContent');
expect(JSON.stringify(result)).not.toContain('required');
expect(JSON.stringify(result)).not.toContain('document.');
```

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/services/client-service-catalog-options.test.ts __tests__/api/manual-client-services-routes.test.ts
```

Expected: FAIL because the reusable graph composer, projection, exports, and endpoint are absent.

- [ ] **Step 3: Extract pure partial-graph composition**

Refactor the existing snapshot traversal without changing its semantics:

```ts
export interface ComposablePartial {
  id: string;
  name: string;
  version: number;
  content: string;
  placeholders: unknown;
  updatedAt: Date;
}

export function composeServicePartialGraph(root: ComposablePartial, candidates: ComposablePartial[]) {
  const partialByName = new Map(candidates.map((partial) => [partial.name, partial]));
  const dependencies = new Map<string, ComposablePartial>();
  const placeholders = new Map(
    placeholderDefinitions(root.placeholders).map((definition) => [definition.key, definition]),
  );
  const expand = (content: string, stack: string[]): string =>
    content.replace(PARTIAL_TOKEN, (_token, name: string) => {
      if (stack.includes(name)) throw new ValidationError(`Circular partial reference detected: ${[...stack, name].join(' -> ')}`);
      const nested = partialByName.get(name);
      if (!nested) throw new ValidationError(`Template partial not found: ${name}`);
      dependencies.set(nested.id, nested);
      for (const definition of placeholderDefinitions(nested.placeholders)) {
        if (!placeholders.has(definition.key)) placeholders.set(definition.key, definition);
      }
      return expand(nested.content, [...stack, name]);
    });
  return { content: expand(root.content, [root.name]), placeholders: [...placeholders.values()], dependencies: [...dependencies.values()] };
}
```

Call this function from `snapshotServiceVariant` so signed snapshot content and dependency ordering remain unchanged.

- [ ] **Step 4: Implement one-query catalog projection plus one partial preload**

Define the response interfaces exactly as approved in `types.ts`. In `catalog-options.ts`, first verify the company with `{ id: companyId, tenantId, deletedAt: null }`, then load all eligible variants with family/SOW/fee data and all non-archived workspace partials. Do not issue per-variant dependency queries. Use all parent predicates in the variant query:

```ts
where: {
  tenantId,
  deletedAt: null,
  isActive: true,
  family: { tenantId, deletedAt: null, isActive: true },
  sowPartial: { tenantId, deletedAt: null },
},
```

Project only service fields:

```ts
const FIELD_PREFIX = 'service.fields.';
const FIELD_TYPES = new Set(['text', 'date', 'number', 'currency', 'boolean', 'textarea']);

function toOperationalField(definition: PlaceholderDefinition): ManualClientServiceCatalogField | null {
  if (!definition.key.startsWith(FIELD_PREFIX)) return null;
  const stored = definition as PlaceholderDefinition & { label?: unknown; type?: unknown; defaultValue?: unknown };
  const key = definition.key.slice(FIELD_PREFIX.length);
  if (!key) return null;
  return {
    key,
    label: typeof stored.label === 'string' && stored.label.trim() ? stored.label.trim() : key.replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase()),
    type: typeof stored.type === 'string' && FIELD_TYPES.has(stored.type) ? stored.type as ManualClientServiceCatalogField['type'] : 'text',
    defaultValue: typeof stored.defaultValue === 'string' ? stored.defaultValue : null,
  };
}
```

Order families and variants by display order then name/ID, preserve composed field order, and serialize Decimal fee defaults with `toFixed(2)`.

- [ ] **Step 5: Add the permission-scoped route**

Implement:

```ts
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'company', 'update', id);
    const tenantId = requireSessionWorkspaceId(session);
    return NextResponse.json(await getManualClientServiceCatalogOptions(id, { tenantId, userId: session.id }));
  } catch (error) {
    return createErrorResponse(error);
  }
}
```

Do not import `hasPermission` for documents and do not call the general selectable catalog route.

- [ ] **Step 6: Rerun focused and snapshot-regression tests**

```powershell
npm.cmd run test:run -- __tests__/services/client-service-catalog-options.test.ts __tests__/api/manual-client-services-routes.test.ts __tests__/services/service-agreement-draft.service.test.ts
```

Expected: PASS; nested fields are preserved and signed agreement snapshot composition is unchanged.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- src/services/service-agreement/snapshot.ts src/services/client-service/catalog-options.ts src/services/client-service/types.ts src/services/client-service/index.ts 'src/app/api/companies/[id]/services/catalog-options/route.ts' __tests__/services/client-service-catalog-options.test.ts __tests__/api/manual-client-services-routes.test.ts
git commit -m "feat(services): expose company catalog options"
```

---

### Task 4: Implement Atomic Manual Creation and Duplicate Detection

**Files:**
- Modify: `src/lib/prisma-transaction.ts`
- Create: `src/services/client-service/errors.ts`
- Create: `src/services/client-service/fee-summary.ts`
- Create: `src/services/client-service/manual-create.ts`
- Modify: `src/services/client-service/types.ts`
- Modify: `src/services/client-service/service.ts`
- Modify: `src/services/client-service/index.ts`
- Create: `__tests__/services/client-service-manual-create.test.ts`
- Modify: `__tests__/services/service-agreement-activation.service.test.ts`

**Interfaces:**
- Consumes: normalized `CreateManualClientServiceInput`, authenticated tenant/actor/company, current active catalog identity, `runSerializableTransaction`, and audit writer.
- Produces: a complete `ClientServiceDto`, `DuplicateClientServiceError` with capped summaries and total, or retriable `ClientServiceWriteConflictError` after exhausted P2034 retries.

- [ ] **Step 1: Add failing service tests**

Cover current server-owned family/variant names, submitted operational cadence/fields/fees after catalog edits, inactive catalog rejection, `MANUAL` plus null agreement references, fee display order from array position, null `sourceAgreementFeeLineId`, audit metadata without field values, rollback on fee/audit failure, duplicate exact-key behavior across every status/source, archived exclusion, newest-five plus ID tie-break, confirmed override, and P2034 exhaustion mapping.

Also add an activation regression where a matching manual row exists with `agreementItemId: null`; assert activation creates a separate `AGREEMENT` row and does not update the manual row.

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/services/client-service-manual-create.test.ts __tests__/services/service-agreement-activation.service.test.ts
```

Expected: FAIL because the manual creation transaction and typed errors do not exist.

- [ ] **Step 3: Export retry-conflict detection and define typed errors**

Export the existing `isSerializationConflict` function without changing `runSerializableTransaction`. Add:

```ts
export class DuplicateClientServiceError extends ApiError {
  constructor(public readonly duplicates: DuplicateClientServiceMatches) {
    super(ErrorCodes.DUPLICATE_CLIENT_SERVICE, 'A matching client service already exists.', 409);
    this.name = 'DuplicateClientServiceError';
  }
}

export class ClientServiceWriteConflictError extends ApiError {
  constructor() {
    super(
      ErrorCodes.CLIENT_SERVICE_WRITE_CONFLICT,
      'Service creation conflicted with another write. Try again.',
      409,
      { retriable: true },
    );
    this.name = 'ClientServiceWriteConflictError';
  }
}
```

- [ ] **Step 4: Share fixed-point fee audit summaries**

Move the existing update helper into `fee-summary.ts` and keep Decimal arithmetic:

```ts
export function summarizeClientServiceFees(fees: Array<{ amount: Prisma.Decimal | string; currency: string }>) {
  const totals = new Map<string, Prisma.Decimal>();
  for (const fee of fees) {
    totals.set(fee.currency, (totals.get(fee.currency) ?? new Prisma.Decimal(0)).add(fee.amount.toString()));
  }
  return {
    count: fees.length,
    totals: Object.fromEntries([...totals].sort(([left], [right]) => left.localeCompare(right)).map(([currency, total]) => [currency, total.toFixed(2)])),
  };
}
```

Use it from both existing update audits and the new create audit.

- [ ] **Step 5: Implement the serializable creation use case**

Inside `createManualClientService`, use the exact duplicate predicate and stable ordering:

```ts
const parseDateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const duplicateWhere: Prisma.ClientServiceWhereInput = {
  tenantId: params.tenantId,
  companyId,
  serviceVariantId: input.serviceVariantId,
  startDate: parseDateOnly(input.startDate),
  deletedAt: null,
};

if (!input.confirmDuplicate) {
  const [total, matches] = await Promise.all([
    tx.clientService.count({ where: duplicateWhere }),
    tx.clientService.findMany({
      where: duplicateWhere,
      select: { id: true, serviceName: true, startDate: true, status: true, source: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
    }),
  ]);
  if (total > 0) {
    throw new DuplicateClientServiceError({
      total,
      items: matches.map((match) => ({ ...match, startDate: dateOnly(match.startDate)! })),
    });
  }
}
```

Before this read, validate the company and catalog variant inside the transaction. The company predicate is `{ id: companyId, tenantId: params.tenantId, deletedAt: null }`; the variant predicate is:

```ts
{
  id: input.serviceVariantId,
  tenantId: params.tenantId,
  deletedAt: null,
  isActive: true,
  family: { tenantId: params.tenantId, deletedAt: null, isActive: true },
  sowPartial: { tenantId: params.tenantId, deletedAt: null },
}
```

Throw `NotFoundError` when either record is unavailable. Then create the service using current names and explicit lineage:

```ts
const service = await tx.clientService.create({
  data: {
    tenantId: params.tenantId,
    companyId,
    source: 'MANUAL',
    agreementId: null,
    agreementItemId: null,
    serviceVariantId: variant.id,
    familyName: variant.family.name,
    serviceName: variant.name,
    status: input.status,
    serviceCadence: input.serviceCadence,
    customCadenceLabel: input.customCadenceLabel,
    startDate: parseDateOnly(input.startDate),
    endDate: input.endDate ? parseDateOnly(input.endDate) : null,
    fieldValues: input.fieldValues as Prisma.InputJsonValue,
  },
});

await tx.clientServiceFeeLine.createMany({
  data: input.feeLines.map((fee, displayOrder) => ({
    tenantId: params.tenantId,
    clientServiceId: service.id,
    sourceAgreementFeeLineId: null,
    description: fee.description,
    amount: new Prisma.Decimal(fee.amount),
    currency: fee.currency,
    billingFrequency: fee.billingFrequency,
    customFrequencyLabel: fee.customFrequencyLabel,
    billingStartDate: fee.billingStartDate ? parseDateOnly(fee.billingStartDate) : null,
    displayOrder,
  })),
});
```

Create the audit with `changeSource: 'MANUAL'`, actor/company columns, source, `serviceVariantId`, fee summary, and `duplicateConfirmed`:

```ts
const feeSummary = summarizeClientServiceFees(input.feeLines);
await createAuditLog({
  tenantId: params.tenantId,
  userId: params.userId,
  companyId,
  entityType: 'ClientService',
  entityId: service.id,
  entityName: variant.name,
  action: 'CREATE',
  changeSource: 'MANUAL',
  changes: {
    source: { old: null, new: 'MANUAL' },
    serviceVariantId: { old: null, new: variant.id },
    feeLines: { old: { count: 0, totals: {} }, new: feeSummary },
    duplicateConfirmed: { old: false, new: input.confirmDuplicate },
  },
  summary: `Added manual operational service with ${feeSummary.count} fee line(s)`,
}, tx);
```

Do not pass `fieldValues` in `changes`, `metadata`, or `summary`. Reload using `clientServiceInclude`, map with `toClientServiceDto`, and return from the transaction.

Wrap the whole callback with `runSerializableTransaction(prisma, work)`. Outside the helper, convert only an exhausted `P2034` to `ClientServiceWriteConflictError`; allow duplicate/not-found/audit/database errors to retain their own handling.

- [ ] **Step 6: Rerun focused tests**

Run the Step 2 command again.

Expected: PASS; unconfirmed duplicates create no service/fee/audit, confirmed duplicates do, and all write failures are atomic at the mocked transaction boundary.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- src/lib/prisma-transaction.ts src/services/client-service/errors.ts src/services/client-service/fee-summary.ts src/services/client-service/manual-create.ts src/services/client-service/types.ts src/services/client-service/service.ts src/services/client-service/index.ts __tests__/services/client-service-manual-create.test.ts __tests__/services/service-agreement-activation.service.test.ts
git commit -m "feat(services): create manual services atomically"
```

---

### Task 5: Add the POST Route and Client Hooks

**Files:**
- Create: `src/app/api/companies/[id]/services/route-utils.ts`
- Modify: `src/app/api/companies/[id]/services/route.ts`
- Modify: `src/hooks/use-client-services.ts`
- Modify: `__tests__/api/manual-client-services-routes.test.ts`
- Modify: `__tests__/api/client-services-routes.test.ts`
- Modify: `__tests__/hooks/use-client-services.test.ts`

**Interfaces:**
- Consumes: POST JSON, session workspace/actor, `company:update`, create schema, manual creation service, and structured service errors.
- Produces: HTTP `201` DTO, field-addressable `400`, duplicate top-level `409`, write-conflict `409`, plus dedicated catalog/create Query hooks.

- [ ] **Step 1: Add failing route and hook tests**

Test authorization before mutation, no document permission call, cross-workspace non-revealing behavior, `201`, schema error field paths, exact duplicate body, retry-exhaustion body, and safe rollback error forwarding. Hook tests must assert catalog URL/query keys, create payload, list/detail invalidation, and preservation of `code`, `details`, and `duplicates`.

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/api/manual-client-services-routes.test.ts __tests__/api/client-services-routes.test.ts __tests__/hooks/use-client-services.test.ts
```

Expected: FAIL because POST serialization and the new hooks are absent.

- [ ] **Step 3: Add route-specific error serialization**

Create a Zod path flattener that keeps the first message per dot path, then handle the duplicate error before the generic helper:

```ts
export function createManualClientServiceErrorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    const fieldErrors = Object.fromEntries(error.issues.map((issue) => [issue.path.join('.'), issue.message]));
    return NextResponse.json({
      error: 'The service could not be created.',
      code: ErrorCodes.VALIDATION_ERROR,
      details: { fieldErrors },
    }, { status: 400 });
  }
  if (error instanceof DuplicateClientServiceError) {
    return NextResponse.json({
      error: error.message,
      code: error.code,
      duplicates: error.duplicates,
    }, { status: 409 });
  }
  return createErrorResponse(error);
}
```

Use an explicit reducer instead of `Object.fromEntries` if multiple issues can target one path, so the first actionable message remains deterministic.

- [ ] **Step 4: Add `POST` without changing the existing `GET` contract**

```ts
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'company', 'update', id);
    const tenantId = requireSessionWorkspaceId(session);
    const input = createManualClientServiceSchema.parse(await request.json());
    const service = await createManualClientService(id, input, { tenantId, userId: session.id });
    return NextResponse.json(service, { status: 201 });
  } catch (error) {
    return createManualClientServiceErrorResponse(error);
  }
}
```

- [ ] **Step 5: Add catalog and creation hooks**

```ts
export function useManualClientServiceCatalogOptions(companyId: string, enabled = true) {
  return useQuery({
    queryKey: ['client-service-catalog-options', companyId],
    queryFn: () => requestJson<ManualClientServiceCatalogOptionsResponse>(`/api/companies/${companyId}/services/catalog-options`),
    enabled: enabled && Boolean(companyId),
  });
}

export function useCreateManualClientService() {
  const invalidate = useInvalidateClientServices();
  return useMutation({
    mutationFn: ({ companyId, data }: { companyId: string; data: CreateManualClientServiceRequest }) =>
      requestJson<ClientServiceDto>(`/api/companies/${companyId}/services`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (service, variables) => invalidate(variables.companyId, service.id),
  });
}
```

- [ ] **Step 6: Rerun focused tests**

Run the Step 2 command again.

Expected: PASS with exact `201`, `400`, duplicate `409`, and retryable conflict shapes.

- [ ] **Step 7: Commit Task 5**

```powershell
git add -- 'src/app/api/companies/[id]/services/route-utils.ts' 'src/app/api/companies/[id]/services/route.ts' src/hooks/use-client-services.ts __tests__/api/manual-client-services-routes.test.ts __tests__/api/client-services-routes.test.ts __tests__/hooks/use-client-services.test.ts
git commit -m "feat(services): add manual creation endpoint"
```

---

### Task 6: Extract the Shared Controlled Operational Form

**Files:**
- Create: `src/components/companies/company-detail/client-service-form-state.ts`
- Create: `src/components/companies/company-detail/operational-service-form.tsx`
- Modify: `src/components/companies/company-detail/client-service-editor.tsx`
- Create: `__tests__/components/operational-service-form.test.tsx`
- Modify: `__tests__/components/company-services-tab.test.tsx`

**Interfaces:**
- Consumes: common operational values and optional field errors.
- Produces: controlled status/cadence/date/field/fee UI and pure conversion/validation helpers shared by create and edit, while edit retains names, `updatedAt`, reload, and archive state.

- [ ] **Step 1: Add failing shared-form and editor regression tests**

Test status/cadence/date changes, custom cadence visibility, optional/removeable/additional fields, fee addition/removal with the last row protected, blank frequency invalidity, `0.00` validity, custom frequency, and field-addressable errors. Rerun existing editor conflict/reload/archive tests and add source-aware copy expectations for both sources.

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/components/operational-service-form.test.tsx __tests__/components/company-services-tab.test.tsx
```

Expected: FAIL because common form/state modules and source-aware editor copy are absent.

- [ ] **Step 3: Define controlled values and pure helpers**

Use UI-only IDs and permit a blank frequency only until validation succeeds:

```ts
export interface OperationalFieldRow {
  uiId: string;
  key: string;
  label: string;
  type: ManualClientServiceCatalogField['type'];
  value: string;
  catalogDerived: boolean;
}

export interface OperationalFeeRow {
  uiId: string;
  id?: string;
  description: string;
  amount: string;
  currency: string;
  billingFrequency: BillingFrequency | '';
  customFrequencyLabel: string;
  billingStartDate: string;
  catalogDerived: boolean;
}

export interface OperationalServiceValues {
  status: ClientServiceStatus;
  serviceCadence: ServiceCadence;
  customCadenceLabel: string;
  startDate: string;
  endDate: string;
  fields: OperationalFieldRow[];
  fees: OperationalFeeRow[];
}
```

Export `validateOperationalServiceValues`, `operationalFieldValues`, `manualCreateFeeLines`, `updateFeeLines`, `valuesFromClientService`, `emptyManualOperationalValues`, `catalogReplacementForVariant`, `replacementValuesChanged`, `createManualPayload`, and `manualFormIsDirty`. `manualCreateFeeLines` must omit fee IDs/display orders, while `updateFeeLines` must preserve optional stored IDs and assign array-order `displayOrder`. Both helpers normalize currencies and reject blank frequency before narrowing to `BillingFrequency`.

For a variant with no fee templates, `catalogReplacementForVariant` must create exactly:

```ts
{
  uiId: crypto.randomUUID(),
  description: variant.name,
  amount: '',
  currency: 'SGD',
  billingFrequency: '',
  customFrequencyLabel: '',
  billingStartDate: '',
  catalogDerived: true,
}
```

- [ ] **Step 4: Build the controlled form body**

Give the common component no catalog, duplicate, archive, or optimistic-conflict props:

```ts
export interface OperationalServiceFormProps {
  values: OperationalServiceValues;
  onChange: (next: OperationalServiceValues) => void;
  errors: Record<string, string | undefined>;
  disabled?: boolean;
  sectionsDisabled?: boolean;
}
```

Render the existing compact responsive grid and accessible error associations. Disable cadence/field/fee sections until create selects a variant through `sectionsDisabled`; edit passes `false`. Every field and fee edit updates only controlled values. Keep `fees.length === 1` as the remove-button disable rule.

- [ ] **Step 5: Refactor the editor wrapper**

Keep `serviceName`, `familyName`, `updatedAt`, conflict reload, archive reason/error, and mutations in `ClientServiceEditor`. Replace common control state/rendering with `OperationalServiceForm`. Use source-aware copy:

```ts
const agreementBacked = service.source === 'AGREEMENT';
const editDescription = agreementBacked
  ? 'Operational edits do not change the signed agreement.'
  : 'This service was added manually. Operational changes are recorded in the audit history.';
const archiveDescription = agreementBacked
  ? 'Archiving removes this operational service without changing the signed agreement.'
  : 'Archiving removes this manually added service from the active company view.';
```

Keep name snapshots editable in the editor; do not add source, catalog identity, or agreement controls.

- [ ] **Step 6: Rerun focused tests**

Run the Step 2 command again.

Expected: PASS; edit behavior remains intact for both sources and the shared form accepts explicit zero fees while rejecting blanks.

- [ ] **Step 7: Commit Task 6**

```powershell
git add -- src/components/companies/company-detail/client-service-form-state.ts src/components/companies/company-detail/operational-service-form.tsx src/components/companies/company-detail/client-service-editor.tsx __tests__/components/operational-service-form.test.tsx __tests__/components/company-services-tab.test.tsx
git commit -m "refactor(services): share operational service form"
```

---

### Task 7: Build the Manual Creation Modal Workflow

**Files:**
- Create: `src/components/companies/company-detail/client-service-creator.tsx`
- Modify: `src/components/companies/company-detail/client-service-form-state.ts`
- Create: `__tests__/components/client-service-creator.test.tsx`

**Interfaces:**
- Consumes: company ID, catalog/create hooks, grouped `SearchableSelect`, shared form, structured `HttpRequestError`, and `ConfirmDialog`.
- Produces: a single scrollable create modal with catalog defaults, protected switching/closing, preserved duplicate draft, and `onCreated(ClientServiceDto)`.

- [ ] **Step 1: Add failing creator tests**

Cover loading/empty catalog, family grouping and search, sections unavailable before selection, default cadence/fields/fee templates, blank dates, no-template incomplete fee row, status default, catalog variant switching with and without modified replacement values, status/date preservation across switches, dirty close through Cancel/header/Escape/backdrop, untouched immediate close, duplicate summary retention, warning-only Cancel, Add-anyway unchanged resubmit, pending disable, network failure draft retention, selector error on inactive catalog, and `onCreated` with the returned DTO.

- [ ] **Step 2: Run the creator test and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/components/client-service-creator.test.tsx
```

Expected: FAIL because the creator does not exist.

- [ ] **Step 3: Implement catalog selection and replacement snapshots**

Build grouped options from the minimal response:

```ts
const selectOptions = options.variants.map((variant) => ({
  value: variant.id,
  label: variant.name,
  group: variant.family.name,
  description: variant.customCadenceLabel ?? variant.serviceCadence.replaceAll('_', ' '),
}));
```

Pass `groupBy="group"` to `SearchableSelect`. Store the last applied catalog replacement separately from the current controlled values. On a requested variant change:

1. Compare only current cadence/custom cadence/fields/fees with the stored replacement.
2. If changed, open a confirmation and do not update the selector yet.
3. On confirmation, apply the next replacement while preserving `status`, `startDate`, and `endDate`.
4. Set the new replacement snapshot for future comparisons.

- [ ] **Step 4: Implement dirty close and submission**

Use one `requestClose` callback for the modal `onClose` and footer Cancel. Because `Modal` funnels the header button, Escape, and backdrop through `onClose`, all exit paths receive the same behavior. While submission is pending, `requestClose` returns without closing and the modal receives `closeOnEscape={false}` and `closeOnOverlayClick={false}`. `manualFormIsDirty(selectedVariantId, values)` must treat any selected variant as dirty relative to the initial empty form.

On submit, run common validation, then send the current payload with `confirmDuplicate: false`. On `DUPLICATE_CLIENT_SERVICE`, store `error.body.duplicates` and do not mutate any form values. On catalog `NOT_FOUND`, attach the message to `serviceVariantId`. Leave all network/server failures inside the modal.

- [ ] **Step 5: Render the duplicate warning and exact resubmission**

Render the total plus at most five server items in `role="alert"`. The warning Cancel only sets duplicate state to null. Add anyway calls the same submit helper with `confirmDuplicate: true` and the current values:

```ts
const submit = async (confirmDuplicate: boolean) => {
  const data = createManualPayload(selectedVariantId, values, confirmDuplicate);
  const created = await createService.mutateAsync({ companyId, data });
  onCreated(created);
};
```

Disable selector, form controls, footer submit, warning Cancel, and Add anyway while the mutation is pending. No reason field is rendered.

- [ ] **Step 6: Rerun the creator test**

Run the Step 2 command again.

Expected: PASS; every draft-preservation and confirmation path is covered.

- [ ] **Step 7: Commit Task 7**

```powershell
git add -- src/components/companies/company-detail/client-service-creator.tsx src/components/companies/company-detail/client-service-form-state.ts __tests__/components/client-service-creator.test.tsx
git commit -m "feat(services): add manual service creator"
```

---

### Task 8: Integrate Creation, Success Navigation, and Source Labels

**Files:**
- Modify: `src/components/companies/company-detail/company-services-tab.tsx`
- Modify: `__tests__/components/company-services-tab.test.tsx`
- Modify: `__tests__/browser/company-services.browser.test.tsx`

**Interfaces:**
- Consumes: `canEdit`, current Services-tab filters/pagination, creator result DTO, and editor.
- Produces: permission-gated Add service actions, true/filtered empty states, source metadata, inline success notice, and reliable direct View-service behavior.

- [ ] **Step 1: Add failing integration and browser assertions**

Test that read-only users see no action; editors see one action by controls; true empty shows the additional empty-state action; filtered empty does not duplicate it; manual cards say `Added manually`; agreement cards keep the link; no source filter exists. Test success closes creator, leaves current filters/page size/page intact, and shows View service. Test View opens the returned DTO directly, clears only search/status when each excludes the DTO, resets page only when needed, and leaves non-excluding filters/pagination unchanged.

- [ ] **Step 2: Run focused component and browser tests and confirm failure**

```powershell
npm.cmd run test:run -- __tests__/components/company-services-tab.test.tsx
npm.cmd run test:browser -- __tests__/browser/company-services.browser.test.tsx
```

Expected: FAIL because creation entry points, success notice, and direct view behavior are not integrated.

- [ ] **Step 3: Add permission-gated creator entry points and empty-state copy**

Place Add service beside the existing list controls. In the empty renderer, treat `!query && !status` as the true empty state; show the second action there only. Use filtered copy when either filter is active. Do not add a source filter or document administration link.

- [ ] **Step 4: Store the returned DTO for success and direct View**

Add `creating` and `createdService` state. The creator callback must close the modal and retain the DTO for the notice; query invalidation already occurs in the creation hook.

Implement filter-aware viewing without waiting for list refetch:

```ts
const viewCreatedService = () => {
  if (!createdService) return;
  const queryExcludes = Boolean(query.trim()) && ![createdService.serviceName, createdService.familyName]
    .some((value) => value.toLowerCase().includes(query.trim().toLowerCase()));
  const statusExcludes = Boolean(status) && status !== createdService.status;
  if (queryExcludes) setQuery('');
  if (statusExcludes) setStatus(undefined);
  if (queryExcludes || statusExcludes) setPage(1);
  setEditing(createdService);
};
```

Render an inline success notice with a View service button and keep it independent of the current page's sorted records.

- [ ] **Step 5: Rerun focused component and browser tests**

Run both Step 2 commands again.

Expected: PASS at component and browser levels, including keyboard/modal and mobile touch-target behavior.

- [ ] **Step 6: Commit Task 8**

```powershell
git add -- src/components/companies/company-detail/company-services-tab.tsx __tests__/components/company-services-tab.test.tsx __tests__/browser/company-services.browser.test.tsx
git commit -m "feat(services): integrate manual creation workflow"
```

---

### Task 9: Prove Concurrency and Operational Compatibility, Then Document

**Files:**
- Create: `__tests__/integration/client-service-manual-creation.postgres.test.ts`
- Modify: `package.json`
- Modify: `__tests__/services/backup-service-agreement-data.test.ts`
- Modify: `__tests__/integration/service-agreement-activation.postgres.test.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/guides/SERVICE_PATTERNS.md`
- Modify: `docs/reference/DATABASE_SCHEMA.md`

**Interfaces:**
- Consumes: a real PostgreSQL `TEST_DATABASE_URL`, migration/schema, concurrent create service calls, backup/restore/cleanup services, and the final user-facing behavior.
- Produces: database-backed proof that one simultaneous unconfirmed request succeeds and the serialization loser returns a duplicate, plus documented source/constraint/API/UI behavior.

- [ ] **Step 1: Add failing PostgreSQL and backup compatibility cases**

Following the existing activation integration harness, seed one tenant/company/partial/family/variant and call `createManualClientService` twice concurrently with the same variant/start date and `confirmDuplicate: false`. Assert exactly one fulfilled DTO, one `DuplicateClientServiceError`, one persisted service, the expected fee count, and one CREATE audit. Add cases proving confirmed duplicates persist, archived rows do not warn, and a later agreement activation creates an independent `AGREEMENT` record.

In backup tests, add a `MANUAL` fixture with null agreement references and fee source, then assert export, restore, and tenant cleanup retain/remove it in the existing dependency order.

- [ ] **Step 2: Add and run the focused PostgreSQL script**

Add:

```json
"test:client-services:postgres": "vitest run __tests__/integration/client-service-manual-creation.postgres.test.ts"
```

Run:

```powershell
npm.cmd run test:client-services:postgres
```

Expected: FAIL against a configured test database if predicate retry, migration constraints, or cleanup are incomplete. If `TEST_DATABASE_URL` is absent, the test must report a deliberate skip using the same pattern as the existing activation integration suite; CI with PostgreSQL is the required execution environment.

- [ ] **Step 3: Fix only evidence-backed integration gaps**

Keep the duplicate predicate inside `runSerializableTransaction`; do not replace it with a preflight API check or a uniqueness constraint that would forbid confirmed duplicates. Ensure test teardown deletes audit/fees/services before catalog/company/tenant parents. Extend production backup code only if the new test proves the existing generic table export/restore/cleanup path does not already handle nullable lineage/source.

- [ ] **Step 4: Update the three existing documentation references**

Document:

- `docs/ARCHITECTURE.md`: two operational-service origins, company-scoped creation flow, common DTO/editor, and serializable boundary.
- `docs/guides/SERVICE_PATTERNS.md`: immutable source/catalog identity, flexible field semantics, duplicate warning/override, source-aware UI, error codes, and later agreement independence.
- `docs/reference/DATABASE_SCHEMA.md`: `ClientServiceSource`, nullable FKs/relations, `client_services_source_reference_consistency`, preserved nullable compound unique, and the five-column duplicate index.

Include the exact check invariant:

```text
AGREEMENT => agreement_id IS NOT NULL AND agreement_item_id IS NOT NULL
MANUAL    => agreement_id IS NULL AND agreement_item_id IS NULL
```

- [ ] **Step 5: Run focused regression suites**

```powershell
npm.cmd run test:run -- __tests__/services/client-service-schema.test.ts __tests__/lib/client-service-validation.test.ts __tests__/services/client-service-catalog-options.test.ts __tests__/services/client-service-manual-create.test.ts __tests__/api/manual-client-services-routes.test.ts __tests__/services/client-service.service.test.ts __tests__/services/service-agreement-activation.service.test.ts __tests__/services/backup-service-agreement-data.test.ts __tests__/components/operational-service-form.test.tsx __tests__/components/client-service-creator.test.tsx __tests__/components/company-services-tab.test.tsx
npm.cmd run test:stage3:postgres
npm.cmd run test:client-services:postgres
npm.cmd run test:browser -- __tests__/browser/company-services.browser.test.tsx
```

Expected: PASS for all configured suites; PostgreSQL suites deliberately skip only when their documented test database variable is absent.

- [ ] **Step 6: Run full static and application verification**

```powershell
npm.cmd run db:generate
npm.cmd run lint
npm.cmd run test:run
npm.cmd run test:browser
npm.cmd run build
git diff --check
```

Expected: all commands PASS. Inspect the focused diff to confirm no source filter, document permission dependency, synthetic agreement, client-owned fee IDs/order, field-value audit content, or unrelated refactor was introduced.

- [ ] **Step 7: Commit Task 9**

```powershell
git add -- __tests__/integration/client-service-manual-creation.postgres.test.ts __tests__/integration/service-agreement-activation.postgres.test.ts __tests__/services/backup-service-agreement-data.test.ts package.json docs/ARCHITECTURE.md docs/guides/SERVICE_PATTERNS.md docs/reference/DATABASE_SCHEMA.md
git commit -m "test(services): verify manual creation lifecycle"
```

---

## Final Acceptance Checklist

- [ ] `company:update` alone can load active minimal options and create a manual service; no `document:read` requirement is introduced.
- [ ] Manual rows store `source = MANUAL`, required catalog identity, current name snapshots, null agreement lineage, and null fee source lineage.
- [ ] Agreement activation writes `source = AGREEMENT` explicitly and keeps its nullable compound idempotency key.
- [ ] Database check constraints reject every impossible source/reference combination.
- [ ] Catalog SOW required flags never block manual creation; custom fields remain accepted and all names/operational values remain editable as specified.
- [ ] Blank/negative fee amounts and blank frequencies fail, while explicit `0.00` succeeds.
- [ ] Duplicate summaries cover all non-archived sources/statuses, cap items at five with deterministic ordering, and report the full total.
- [ ] Unconfirmed duplicate and failed writes leave no service, fee, or audit rows; confirmed duplicates require no reason and record the override.
- [ ] Real PostgreSQL concurrency proves simultaneous unconfirmed writes cannot both silently succeed.
- [ ] Dirty-close and modified-variant replacement confirmations cover every exit/change path without losing dates/status unexpectedly.
- [ ] Success preserves list state and View service opens the returned DTO even when the current page or filters exclude it.
- [ ] Manual cards and editor/archive copy never refer to a nonexistent agreement; agreement cards keep their link.
- [ ] List/detail/edit/archive/audit/backup/restore/cleanup behavior supports both sources without N+1 agreement lookups.
- [ ] Focused tests, full Vitest, browser tests, lint, Prisma generation, build, and `git diff --check` pass.
