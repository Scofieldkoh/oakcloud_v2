# Client Services and Signed Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert signed Service Agreement selections into editable, audited company Services records through an idempotent retryable activation workflow.

**Architecture:** Keep signed agreement selections immutable in the Service Agreement tables and copy only operational identity, cadence, dates, field values, and entity-specific fees into `ClientService`. E-sign completion queues activation without blocking signature completion; the existing scheduler claims pending agreements with a lease and retries safely under unique constraints.

**Tech Stack:** Prisma 7/PostgreSQL, TypeScript 5.7, Zod 3, existing e-signing and scheduler modules, Next.js route handlers, React 19, TanStack Query 5, Oakcloud audit/backup/RBAC services, Vitest 4, Playwright 1.61.

## Global Constraints

- Complete the catalog-foundation and agreement-generation plans first.
- Create exactly one `ClientService` for each Service Agreement item/entity pairing.
- Copy only operational data; never copy or expose the legal SOW clause as a Client Service field.
- Every `ClientServiceFeeLine` belongs to one company Service; group-total fees do not exist.
- Operational Services are fully editable after activation, with audit records for every mutation.
- Operational edits never update agreement snapshots or generated/signed document content.
- E-sign completion must succeed even if Service activation later fails.
- Activation is idempotent under duplicate completion events, process crashes, scheduler overlap, and manual retry.
- Use `company:read` to view Services and `company:update` to edit/archive them.
- Automatic activation uses system change source; manual activation records the actor, signed/effective dates, and reason.
- Soft-deleted companies remain referentially valid; their signed agreement may activate, but their Services tab is unavailable until the company is restored.
- Preserve all existing task e-signing preparation and PDF-generation scheduler behavior.

---

### Task 1: Add operational Service and activation schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260730110000_client_services_activation/migration.sql`
- Create: `__tests__/services/client-service-schema.test.ts`

**Interfaces:**
- Produces `ClientService`, `ClientServiceFeeLine`, activation enums, and claim/retry fields on `ServiceAgreement`.

- [ ] **Step 1: Write the failing schema contract test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('client service activation schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it('defines idempotent entity-level operational services', () => {
    expect(schema).toContain('enum ClientServiceStatus');
    expect(schema).toContain('enum ServiceAgreementActivationStatus');
    expect(schema).toContain('model ClientService');
    expect(schema).toContain('model ClientServiceFeeLine');
    expect(schema).toContain('@@unique([agreementItemId, companyId])');
    expect(schema).toContain('activationStatus ServiceAgreementActivationStatus');
  });
});
```

- [ ] **Step 2: Run the schema test**

```powershell
npx.cmd vitest run __tests__/services/client-service-schema.test.ts
```

Expected: FAIL because operational models and activation state are absent.

- [ ] **Step 3: Add exact Prisma contracts**

```prisma
enum ClientServiceStatus {
  ACTIVE
  PAUSED
  ENDED
}

enum ServiceAgreementActivationStatus {
  NOT_READY
  PENDING
  PROCESSING
  COMPLETED
  FAILED_RETRYABLE
  FAILED_PERMANENT
}

enum ServiceAgreementActivationSource {
  ESIGNING
  MANUAL
}

model ClientService {
  id                   String               @id @default(uuid())
  tenantId             String               @map("tenant_id")
  companyId            String               @map("company_id")
  agreementId          String               @map("agreement_id")
  agreementItemId      String               @map("agreement_item_id")
  serviceVariantId     String               @map("service_variant_id")
  familyName           String               @map("family_name") @db.VarChar(200)
  serviceName          String               @map("service_name") @db.VarChar(200)
  status               ClientServiceStatus  @default(ACTIVE)
  serviceCadence       ServiceCadence       @map("service_cadence")
  customCadenceLabel   String?              @map("custom_cadence_label") @db.VarChar(100)
  startDate            DateTime             @map("start_date") @db.Date
  endDate              DateTime?            @map("end_date") @db.Date
  fieldValues          Json                 @default("{}") @map("field_values")
  createdAt            DateTime             @default(now()) @map("created_at")
  updatedAt            DateTime             @updatedAt @map("updated_at")
  deletedAt            DateTime?            @map("deleted_at")
  deletedReason        String?              @map("deleted_reason")
  tenant               Workspace            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  company              Company              @relation(fields: [companyId], references: [id], onDelete: Restrict)
  agreement            ServiceAgreement     @relation(fields: [agreementId], references: [id], onDelete: Restrict)
  agreementItem        ServiceAgreementItem @relation(fields: [agreementItemId], references: [id], onDelete: Restrict)
  serviceVariant       ServiceVariant       @relation(fields: [serviceVariantId], references: [id], onDelete: Restrict)
  feeLines             ClientServiceFeeLine[]

  @@unique([agreementItemId, companyId])
  @@index([tenantId, companyId, status, deletedAt])
  @@index([tenantId, agreementId])
  @@index([serviceVariantId])
  @@map("client_services")
}

model ClientServiceFeeLine {
  id                       String                  @id @default(uuid())
  tenantId                 String                  @map("tenant_id")
  clientServiceId          String                  @map("client_service_id")
  sourceAgreementFeeLineId String?                 @map("source_agreement_fee_line_id")
  description              String                  @db.VarChar(500)
  amount                   Decimal                 @db.Decimal(18, 2)
  currency                 String                  @default("SGD") @db.VarChar(3)
  billingFrequency         BillingFrequency        @map("billing_frequency")
  customFrequencyLabel     String?                 @map("custom_frequency_label") @db.VarChar(100)
  billingStartDate         DateTime?               @map("billing_start_date") @db.Date
  displayOrder             Int                     @default(0) @map("display_order")
  createdAt                DateTime                @default(now()) @map("created_at")
  updatedAt                DateTime                @updatedAt @map("updated_at")
  tenant                   Workspace               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  clientService            ClientService           @relation(fields: [clientServiceId], references: [id], onDelete: Cascade)
  sourceAgreementFeeLine   ServiceAgreementFeeLine? @relation(fields: [sourceAgreementFeeLineId], references: [id], onDelete: SetNull)

  @@unique([clientServiceId, sourceAgreementFeeLineId])
  @@index([tenantId, clientServiceId, displayOrder])
  @@map("client_service_fee_lines")
}
```

Extend `ServiceAgreement`:

```prisma
activationStatus       ServiceAgreementActivationStatus @default(NOT_READY) @map("activation_status")
activationSource       ServiceAgreementActivationSource? @map("activation_source")
activationAttemptCount Int                              @default(0) @map("activation_attempt_count")
activationAvailableAt  DateTime?                        @map("activation_available_at")
activationClaimedAt    DateTime?                        @map("activation_claimed_at")
activationLeaseExpiresAt DateTime?                      @map("activation_lease_expires_at")
activationClaimToken   String?                          @map("activation_claim_token") @db.VarChar(36)
activationLastError    String?                          @map("activation_last_error")
activationRequestedById String?                         @map("activation_requested_by_id")
activationReason       String?                          @map("activation_reason") @db.VarChar(1000)
activationRequestedBy  User?                            @relation("ServiceAgreementActivationRequester", fields: [activationRequestedById], references: [id], onDelete: SetNull)
clientServices         ClientService[]

@@index([activationStatus, activationAvailableAt])
@@index([activationStatus, activationLeaseExpiresAt])
```

Add these exact inverse relations:

```prisma
// Workspace
clientServices         ClientService[]
clientServiceFeeLines  ClientServiceFeeLine[]

// Company
clientServices ClientService[]

// ServiceVariant
clientServices ClientService[]

// ServiceAgreementItem
clientServices ClientService[]

// ServiceAgreementFeeLine
clientServiceFeeLines ClientServiceFeeLine[]

// User
requestedServiceAgreementActivations ServiceAgreement[] @relation("ServiceAgreementActivationRequester")
```

Existing draft agreements receive `NOT_READY`.

- [ ] **Step 4: Generate Prisma and rerun the schema test**

```powershell
npm.cmd run db:generate
npx.cmd vitest run __tests__/services/client-service-schema.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit schema**

```powershell
git add prisma/schema.prisma prisma/migrations/20260730110000_client_services_activation/migration.sql src/generated/prisma __tests__/services/client-service-schema.test.ts
git commit -m "feat(services): add client service activation schema"
```

### Task 2: Define Client Service validation and DTOs

**Files:**
- Create: `src/lib/validations/client-service.ts`
- Create: `src/services/client-service/types.ts`
- Create: `src/services/client-service/index.ts`
- Test: `__tests__/lib/client-service-validation.test.ts`

**Interfaces:**
- Produces `ClientServiceDto`, list filters, update schema, archive schema, and manual activation schema.

- [ ] **Step 1: Write failing validation tests**

```ts
it('requires custom labels and valid date order', () => {
  expect(updateClientServiceSchema.safeParse({
    serviceCadence: 'CUSTOM',
    customCadenceLabel: null,
  }).success).toBe(false);

  expect(updateClientServiceSchema.safeParse({
    startDate: '2026-08-01',
    endDate: '2026-07-31',
  }).success).toBe(false);
});

it('requires an audit reason for manual activation', () => {
  expect(markServiceAgreementEffectiveSchema.safeParse({
    signedAt: '2026-07-30T00:00:00.000Z',
    effectiveDate: '2026-07-30',
    reason: 'External',
  }).success).toBe(false);
});
```

- [ ] **Step 2: Run validation tests**

```powershell
npx.cmd vitest run __tests__/lib/client-service-validation.test.ts
```

Expected: FAIL because the schemas do not exist.

- [ ] **Step 3: Implement exact validation**

```ts
export const clientServiceFeeLineInputSchema = z.object({
  id: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(500),
  amount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  billingFrequency: billingFrequencySchema,
  customFrequencyLabel: z.string().trim().min(1).max(100).nullable().optional(),
  billingStartDate: z.string().date().nullable().optional(),
  displayOrder: z.number().int().min(0),
});

export const updateClientServiceSchema = z.object({
  updatedAt: z.string().datetime(),
  familyName: z.string().trim().min(1).max(200).optional(),
  serviceName: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']).optional(),
  serviceCadence: serviceCadenceSchema.optional(),
  customCadenceLabel: z.string().trim().min(1).max(100).nullable().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().nullable().optional(),
  fieldValues: z.record(z.string().max(10_000)).optional(),
  feeLines: z.array(clientServiceFeeLineInputSchema).min(1).max(100).optional(),
}).superRefine(validateCadenceAndDates);

export const markServiceAgreementEffectiveSchema = z.object({
  signedAt: z.string().datetime(),
  effectiveDate: z.string().date(),
  reason: z.string().trim().min(10).max(1000),
});
```

`ClientServiceDto` includes service/agreement IDs, display names, dates, status, cadence, field values, fixed-point fee strings, agreement title/status/link, created/updated timestamps, and no SOW content.

- [ ] **Step 4: Run validation tests**

```powershell
npx.cmd vitest run __tests__/lib/client-service-validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit contracts**

```powershell
git add src/lib/validations/client-service.ts src/services/client-service/types.ts src/services/client-service/index.ts __tests__/lib/client-service-validation.test.ts
git commit -m "feat(services): define client service contracts"
```

### Task 3: Implement operational Client Service queries and editing

**Files:**
- Create: `src/services/client-service/service.ts`
- Modify: `src/services/client-service/index.ts`
- Test: `__tests__/services/client-service.service.test.ts`

**Interfaces:**
- Produces company-scoped list/get/update/archive functions.
- Does not create Services manually; activation is the only first-release creation path.

- [ ] **Step 1: Write failing service tests**

```ts
it('updates operational fees without mutating agreement fees', async () => {
  await updateClientService(service.id, {
    feeLines: [{
      id: fee.id,
      description: 'Revised annual fee',
      amount: '650.00',
      currency: 'SGD',
      billingFrequency: 'ANNUALLY',
      billingStartDate: '2026-07-30',
      displayOrder: 0,
    }],
  }, actor);

  expect(prismaMock.clientServiceFeeLine.deleteMany).toHaveBeenCalled();
  expect(prismaMock.serviceAgreementFeeLine.update).not.toHaveBeenCalled();
  expect(createAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
    entityType: 'ClientService',
    action: 'UPDATE',
  }));
});
```

Cover tenant filtering, company filtering, status/date validation against persisted values, fixed decimal serialization, soft archive reason, and no legal content in DTOs.

- [ ] **Step 2: Run service tests**

```powershell
npx.cmd vitest run __tests__/services/client-service.service.test.ts
```

Expected: FAIL because services do not exist.

- [ ] **Step 3: Implement exact service methods**

```ts
export async function listCompanyServices(
  companyId: string,
  input: SearchClientServicesInput,
  params: TenantAwareParams,
): Promise<{ services: ClientServiceDto[]; total: number }>;

export async function getClientService(
  id: string,
  params: TenantAwareParams,
): Promise<ClientServiceDto>;

export async function updateClientService(
  id: string,
  input: UpdateClientServiceInput,
  params: TenantAwareParams,
): Promise<ClientServiceDto>;

export async function archiveClientService(
  id: string,
  reason: string,
  params: TenantAwareParams,
): Promise<{ id: string; archived: true }>;
```

Use an interactive transaction to update the Service and replace submitted fee lines. Validate merged start/end and cadence/custom-label values, not only submitted fields. Audit tracked changes plus fee summaries; do not put `fieldValues` contents or signed wording in audit summaries.

- [ ] **Step 4: Run service tests**

```powershell
npx.cmd vitest run __tests__/services/client-service.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit operational services**

```powershell
git add src/services/client-service __tests__/services/client-service.service.test.ts
git commit -m "feat(services): manage operational client services"
```

### Task 4: Implement idempotent agreement activation

**Files:**
- Create: `src/services/service-agreement/activation.service.ts`
- Modify: `src/services/service-agreement/index.ts`
- Test: `__tests__/services/service-agreement-activation.service.test.ts`

**Interfaces:**
- Produces queue, claim, single-activation, batch-processing, manual request, and retry methods.

- [ ] **Step 1: Write failing activation tests**

```ts
it('creates one client service per item/entity and copies only matching fees', async () => {
  const result = await processServiceAgreementActivation(agreement.id);
  expect(result).toEqual({ status: 'completed', clientServiceCount: 2 });
  expect(prismaMock.clientService.upsert).toHaveBeenCalledTimes(2);
  expect(prismaMock.clientServiceFeeLine.createMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.arrayContaining([
      expect.objectContaining({ amount: new Prisma.Decimal('500.00') }),
    ]),
  }));
});

it('is idempotent after a repeated completion event', async () => {
  await processServiceAgreementActivation(agreement.id);
  await processServiceAgreementActivation(agreement.id);
  expect(await countClientServices()).toBe(expectedPairCount);
});
```

Cover stale lease recovery, retry backoff, max attempts, manual metadata, finalizing the generated document, and transaction rollback.

- [ ] **Step 2: Run activation tests**

```powershell
npx.cmd vitest run __tests__/services/service-agreement-activation.service.test.ts
```

Expected: FAIL because activation does not exist.

- [ ] **Step 3: Implement queue and manual request contracts**

```ts
export async function queueServiceAgreementActivationsForEnvelope(
  tx: Prisma.TransactionClient,
  envelopeId: string,
  completedAt: Date,
): Promise<number>;

export async function requestManualServiceAgreementActivation(
  agreementId: string,
  input: MarkServiceAgreementEffectiveInput,
  params: TenantAwareParams,
): Promise<ServiceAgreementActivationDto>;

export async function retryServiceAgreementActivation(
  agreementId: string,
  params: TenantAwareParams,
): Promise<ServiceAgreementActivationDto>;
```

Queue only DRAFT/NOT_READY agreements linked through `EsigningEnvelopeDocument.generatedDocumentId`. Set `activationStatus=PENDING`, `activationSource=ESIGNING`, `signedAt=completedAt`, `activationAvailableAt=now`, and clear previous claim/error fields. Preserve an existing effective date; when absent, derive the `Asia/Singapore` date from `completedAt`.

Manual request requires a DRAFT agreement, `document:update`, and update access to every included company. Save signed/effective dates and the reason, set source `MANUAL`, and queue once. If the generated document is still DRAFT and has no unresolved-template metadata, finalize it during successful activation.

- [ ] **Step 4: Implement claimed activation**

```ts
export async function processServiceAgreementActivation(
  agreementId: string,
): Promise<
  | { status: 'completed'; clientServiceCount: number }
  | { status: 'already-completed'; clientServiceCount: number }
  | { status: 'retryable-failure'; error: string }
>;

export async function processQueuedServiceAgreementActivations(options?: {
  limit?: number;
  concurrency?: number;
  leaseMs?: number;
}): Promise<{ claimed: number; completed: number; failed: number }>;
```

Follow `src/services/tasks/esigning-preparation.service.ts`:

- Claim `PENDING`, `FAILED_RETRYABLE`, or expired `PROCESSING` rows with `FOR UPDATE SKIP LOCKED`.
- Default batch limit 10, concurrency 2, lease 5 minutes.
- Backoff after failure: 1, 5, 15, 60 minutes.
- After five attempts, mark `FAILED_PERMANENT`.
- Store only stable public error messages with correlation references; keep detailed diagnostics in restricted server logs.
- Persist a unique claim token and compare `tenantId + PROCESSING + claimToken` on worker success/failure so expired workers cannot overwrite a reclaim.
- Add PostgreSQL partial indexes for available PENDING/FAILED_RETRYABLE rows and expired PROCESSING leases, and validate them with `EXPLAIN`.

Inside the activation transaction:

1. Reload the agreement/items/entities/fee lines under tenant scope.
2. For each unique item/entity link, upsert `ClientService` by `[agreementItemId, companyId]`.
3. Copy item snapshot identity/cadence/dates/fields and only fee lines for that agreement entity.
4. Upsert or replace source fee rows without deleting user-created operational changes on an already completed activation.
5. Mark agreement `EFFECTIVE`, set `effectiveDate` if manual input supplied, `activatedAt=now`, and `activationStatus=COMPLETED`.
6. Finalize the generated document if still DRAFT; never change already finalized content.
7. Write one agreement activation audit plus one create audit per new Client Service.

If activation status is already COMPLETED, return without modifying operational rows.

- [ ] **Step 5: Run activation tests**

```powershell
npx.cmd vitest run __tests__/services/service-agreement-activation.service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit activation domain**

```powershell
git add src/services/service-agreement/activation.service.ts src/services/service-agreement/index.ts __tests__/services/service-agreement-activation.service.test.ts
git commit -m "feat(services): activate signed service agreements"
```

### Task 5: Hook e-sign completion and scheduler retries

**Files:**
- Modify: `src/services/esigning-signing.service.ts`
- Create: `src/lib/scheduler/tasks/service-agreement-activation.task.ts`
- Modify: `src/lib/scheduler/tasks/index.ts`
- Modify: `src/lib/scheduler/index.ts`
- Test: `__tests__/services/esigning-service-agreement-activation.test.ts`
- Test: `__tests__/services/service-agreement-activation-scheduler.test.ts`

**Interfaces:**
- E-sign completion queues agreements in its existing transaction.
- Scheduler runs retry processing every minute when globally enabled.

- [ ] **Step 1: Write failing e-sign integration tests**

```ts
it('queues service agreements only when the envelope transitions to completed', async () => {
  await completeEsigningSigningSession(input);
  expect(queueServiceAgreementActivationsForEnvelopeMock).toHaveBeenCalledWith(
    expect.anything(),
    envelope.id,
    expect.any(Date),
  );
});

it('does not fail signature completion when post-commit processing fails', async () => {
  processQueuedServiceAgreementActivationsMock.mockRejectedValue(new Error('temporary'));
  await expect(completeEsigningSigningSession(input)).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run integration tests**

```powershell
npx.cmd vitest run __tests__/services/esigning-service-agreement-activation.test.ts __tests__/services/service-agreement-activation-scheduler.test.ts
```

Expected: FAIL before the hook/task exists.

- [ ] **Step 3: Queue inside the existing completion transaction**

Immediately after the successful envelope `COMPLETED` update and event creation:

```ts
if (completionUpdate.count > 0) {
  await queueServiceAgreementActivationsForEnvelope(tx, context.envelope.id, now);
}
```

After commit, attempt a bounded immediate batch process inside `try/catch`; log a correlation-keyed restricted diagnostic and continue returning the signing session if it fails. The activation task inherits `SCHEDULER_ENABLED`; `SCHEDULER_SERVICE_AGREEMENT_ACTIVATION_CRON` defaults to every minute.

- [ ] **Step 4: Register the scheduler task**

```ts
export const serviceAgreementActivationTask: TaskRegistration = {
  id: 'service-agreement-activation',
  name: 'Service agreement activation',
  cronPattern: '* * * * *',
  enabled: true,
  handler: async () => {
    const result = await processQueuedServiceAgreementActivations({
      limit: 10,
      concurrency: 2,
    });
    return { message: JSON.stringify(result) };
  },
};
```

Export and register it beside existing e-signing preparation/PDF tasks. Do not create a second scheduler instance.

- [ ] **Step 5: Run integration tests**

```powershell
npx.cmd vitest run __tests__/services/esigning-service-agreement-activation.test.ts __tests__/services/service-agreement-activation-scheduler.test.ts __tests__/services/esigning-signing.service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit e-sign/scheduler integration**

```powershell
git add src/services/esigning-signing.service.ts src/lib/scheduler/tasks/service-agreement-activation.task.ts src/lib/scheduler/tasks/index.ts src/lib/scheduler/index.ts __tests__/services/esigning-service-agreement-activation.test.ts __tests__/services/service-agreement-activation-scheduler.test.ts
git commit -m "feat(esigning): queue service activation on completion"
```

### Task 6: Expose Client Services and activation APIs

**Files:**
- Create: `src/app/api/companies/[id]/services/route.ts`
- Create: `src/app/api/client-services/[id]/route.ts`
- Create: `src/app/api/service-agreements/[id]/mark-effective/route.ts`
- Create: `src/app/api/service-agreements/[id]/retry-activation/route.ts`
- Test: `__tests__/api/client-services-routes.test.ts`

**Interfaces:**
- Company route lists Services.
- Client Service route updates/archives.
- Agreement routes request manual activation or retry.

- [ ] **Step 1: Write failing route tests**

```ts
it('uses company permissions for operational service access', async () => {
  await GET(companyRequest, { params: Promise.resolve({ id: companyId }) });
  expect(requirePermissionMock).toHaveBeenCalledWith(session, 'company', 'read', companyId);
});

it('requires document update and all-company update access for manual activation', async () => {
  await POST(markEffectiveRequest, { params: Promise.resolve({ id: agreementId }) });
  expect(requirePermissionMock).toHaveBeenCalledWith(session, 'document', 'update');
  expect(requestManualActivationMock).toHaveBeenCalled();
});
```

Cover Zod 400, permission 403, not found 404, optimistic conflict 409, and failed-permanent retry resetting to pending.

- [ ] **Step 2: Run route tests**

```powershell
npx.cmd vitest run __tests__/api/client-services-routes.test.ts
```

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement route methods**

- `GET /api/companies/:id/services?status=&query=&page=&limit=`
- `GET /api/client-services/:id`
- `PATCH /api/client-services/:id`
- `DELETE /api/client-services/:id` with `{ reason }`
- `POST /api/service-agreements/:id/mark-effective`
- `POST /api/service-agreements/:id/retry-activation`

Use `requireSessionWorkspaceId`, `requirePermission`, the validation schemas from Task 2, and `createErrorResponse`. Retry requires document update plus update access for all included companies.

- [ ] **Step 4: Run route/service tests**

```powershell
npx.cmd vitest run __tests__/api/client-services-routes.test.ts __tests__/services/client-service.service.test.ts __tests__/services/service-agreement-activation.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit APIs**

```powershell
git add src/app/api/companies/[id]/services src/app/api/client-services src/app/api/service-agreements/[id]/mark-effective src/app/api/service-agreements/[id]/retry-activation __tests__/api/client-services-routes.test.ts
git commit -m "feat(api): expose client services and activation"
```

### Task 7: Add the company Services tab

**Files:**
- Create: `src/components/companies/company-detail/company-services-tab.tsx`
- Create: `src/components/companies/company-detail/client-service-editor.tsx`
- Create: `src/hooks/use-client-services.ts`
- Modify: `src/components/companies/company-detail/company-tabs.tsx`
- Modify: `src/components/companies/company-detail/index.ts`
- Modify: `src/app/(dashboard)/companies/[id]/page.tsx`
- Test: `__tests__/components/company-services-tab.test.tsx`
- Test: `__tests__/browser/company-services.browser.test.tsx`

**Interfaces:**
- Adds `services` to `TabId`.
- Reads and edits APIs from Task 6.

- [ ] **Step 1: Write failing component tests**

```tsx
render(<CompanyServicesTab companyId={companyId} canEdit />);
expect(await screen.findByText('Corporate Secretarial Services')).toBeVisible();
expect(screen.getByText('S$500.00 annually')).toBeVisible();
expect(screen.getByRole('link', { name: /service agreement/i })).toHaveAttribute(
  'href',
  `/generated-documents/${generatedDocumentId}`,
);

await user.click(screen.getByRole('button', { name: 'Edit service' }));
expect(screen.queryByLabelText(/service clause/i)).not.toBeInTheDocument();
```

Also cover read-only mode, active/paused/ended filters, fee editing, archive confirmation/reason, activation pending/failed banners, and retry.

- [ ] **Step 2: Run component tests**

```powershell
npx.cmd vitest run __tests__/components/company-services-tab.test.tsx
```

Expected: FAIL before the UI exists.

- [ ] **Step 3: Implement compact Services workspace**

Add `{ id: 'services', label: 'Services', icon: BriefcaseBusiness }` to Company tabs. Remove the legacy URL remapping of `tab=services` to profile; continue remapping `contracts` and `deadlines`.

The tab provides:

- Search and status filters.
- Compact service rows/cards showing service/family, status, cadence, start/end, fee summary, and source agreement.
- Detail/editor drawer or modal with editable identity labels, status, cadence, dates, field values, and fee rows.
- No SOW/legal-clause field.
- Source agreement link and a visible note that operational edits do not change the signed agreement.
- Pending/failed activation status banner with Retry when authorized.
- Empty/loading/error states and mobile stacking.

Use query keys:

```ts
['client-services', companyId, filters]
['client-service', serviceId]
```

Invalidate both after mutation.

- [ ] **Step 4: Run component and browser tests**

```powershell
npx.cmd vitest run __tests__/components/company-services-tab.test.tsx
npx.cmd vitest run --config vitest.browser.config.ts __tests__/browser/company-services.browser.test.tsx
```

Expected: both suites pass.

- [ ] **Step 5: Commit Services UI**

```powershell
git add src/components/companies/company-detail/company-services-tab.tsx src/components/companies/company-detail/client-service-editor.tsx src/components/companies/company-detail/company-tabs.tsx src/components/companies/company-detail/index.ts src/hooks/use-client-services.ts 'src/app/(dashboard)/companies/[id]/page.tsx' __tests__/components/company-services-tab.test.tsx __tests__/browser/company-services.browser.test.tsx
git commit -m "feat(companies): add operational Services tab"
```

### Task 8: Extend backup, restore, and deletion ordering

**Files:**
- Modify: `src/services/backup.service.ts`
- Test: `__tests__/services/backup-service-agreement-data.test.ts`

**Interfaces:**
- Backup manifest data includes every Plan 1-3 service table.
- Restore order satisfies all foreign keys.

- [ ] **Step 1: Write failing backup contract tests**

```ts
for (const key of [
  'serviceFamilies',
  'serviceVariants',
  'serviceVariantFeeTemplates',
  'serviceAgreements',
  'serviceAgreementEntities',
  'serviceAgreementItems',
  'serviceAgreementItemEntities',
  'serviceAgreementFeeLines',
  'clientServices',
  'clientServiceFeeLines',
]) {
  expect(exported.data).toHaveProperty(key);
}
```

Also assert dry-run validation counts the records, restore calls parents before children, and tenant deletion removes children before parents.

- [ ] **Step 2: Run backup tests**

```powershell
npx.cmd vitest run __tests__/services/backup-service-agreement-data.test.ts
```

Expected: FAIL because the new models are not explicitly handled.

- [ ] **Step 3: Update all backup paths**

Add all new delegates to `MANUALLY_HANDLED_MODEL_DELEGATES`. Export under the exact camelCase keys in the test.

Restore order:

1. Template partials.
2. Service families.
3. Service variants.
4. Variant fee templates.
5. Generated documents.
6. Service agreements.
7. Agreement entities.
8. Agreement items.
9. Item-entity links.
10. Agreement fee lines.
11. Client Services.
12. Client Service fee lines.

Tenant deletion reverses child dependencies. Preserve current backup manifest versions unless the service’s compatibility rules require a new accepted literal; if incremented, accept older `1.1`/`1.2` backups with missing service arrays treated as empty.

- [ ] **Step 4: Run backup and safety tests**

```powershell
npx.cmd vitest run __tests__/services/backup-service-agreement-data.test.ts __tests__/services/backup-contact-merge-safety.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit backup support**

```powershell
git add src/services/backup.service.ts __tests__/services/backup-service-agreement-data.test.ts
git commit -m "feat(backup): preserve service agreement data"
```

### Task 9: Document and verify the first release

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/reference/DATABASE_SCHEMA.md`
- Modify: `docs/guides/SERVICE_PATTERNS.md`

**Interfaces:**
- Documents operational-versus-legal authority and activation recovery.

- [ ] **Step 1: Update existing documentation**

Document:

- One Client Service per agreement-item/entity.
- Entity-specific fee ownership.
- Full operational edit policy and immutable signed content.
- Activation status state machine, lease, backoff, max attempts, and retry.
- Automatic versus manual activation permissions and audit source.
- Backup/restore ordering.

- [ ] **Step 2: Run focused Plan 3 verification**

```powershell
npm.cmd run db:generate
npx.cmd vitest run __tests__/services/client-service-schema.test.ts __tests__/lib/client-service-validation.test.ts __tests__/services/client-service.service.test.ts __tests__/services/service-agreement-activation.service.test.ts __tests__/services/esigning-service-agreement-activation.test.ts __tests__/services/service-agreement-activation-scheduler.test.ts __tests__/services/backup-service-agreement-data.test.ts __tests__/api/client-services-routes.test.ts __tests__/components/company-services-tab.test.tsx
npx.cmd vitest run --config vitest.browser.config.ts __tests__/browser/company-services.browser.test.tsx
```

Expected: Prisma generation and all listed tests exit 0.

- [ ] **Step 3: Run regression and production checks**

```powershell
npm.cmd run test:run
npm.cmd run build
```

Expected: full tests and production build exit 0. Record exact unrelated pre-existing failures instead of weakening focused acceptance tests.

- [ ] **Step 4: Exercise activation manually**

In a development tenant:

1. Complete an Oakcloud e-sign envelope containing a generated Service Agreement.
2. Confirm signature completion returns even if the immediate worker is disabled.
3. Run the scheduler task and confirm one Service per item/entity with matching fees.
4. Re-run the task and confirm no duplicates.
5. Edit an operational fee and confirm the agreement HTML and agreement fee snapshot remain unchanged.
6. Use an externally signed draft with Mark effective and confirm reason/date audit data.
7. Force a retryable activation error, confirm banner/retry state, restore the dependency, retry, and confirm completion.

- [ ] **Step 5: Commit documentation**

```powershell
git add docs/ARCHITECTURE.md docs/reference/DATABASE_SCHEMA.md docs/guides/SERVICE_PATTERNS.md
git commit -m "docs(services): document client service activation"
```

---

## Second-review remediation (2026-08-01)

> **Design:** `docs/superpowers/specs/2026-08-01-client-services-activation-review-fixes-design.md`

The following tasks supersede any conflicting test or index instructions above. The Stage 3 implementation is currently uncommitted user work, so each task ends with a file-scoped diff checkpoint instead of committing or staging files that predate this remediation.

### Task 10: Make Client Service conflicts recoverable and the editor accessible

**Files:**
- Modify: `src/hooks/use-client-services.ts`
- Modify: `src/components/companies/company-detail/client-service-editor.tsx`
- Modify: `src/components/companies/company-detail/company-tabs.tsx`
- Modify: `__tests__/components/company-services-tab.test.tsx`
- Modify: `__tests__/browser/company-services.browser.test.tsx`

**Interfaces:**
- Produces: `HttpRequestError`, an `Error` subtype with numeric `status`.
- Produces: `isHttpRequestError(error: unknown, status?: number): error is HttpRequestError`.
- Consumes: `useClientService(serviceId)` to explicitly reload the current DTO after a conflict.
- Preserves: `UpdateClientServiceInput.updatedAt` as the only optimistic-concurrency token.

- [x] **Step 1: Write failing component tests for status-aware errors, conflict reload, and field-linked validation**

Add `useClientService` and a structural `isHttpRequestError` implementation to the hoisted hook mock, then assert that a 409 keeps the dialog open, exposes a `Reload latest service` action, and installs the refreshed DTO instead of silently retaining the stale token:

```tsx
const conflict = Object.assign(new Error('This service was updated by someone else.'), { status: 409 });
const refreshed = {
  ...service,
  serviceName: 'Server-updated service',
  updatedAt: '2026-08-01T01:00:00.000Z',
};
const mutateAsync = vi.fn()
  .mockRejectedValueOnce(conflict)
  .mockResolvedValueOnce(refreshed);
const refetch = vi.fn().mockResolvedValue({ data: refreshed });
hooksMock.useClientService.mockReturnValue({ refetch, isFetching: false });
hooksMock.isHttpRequestError.mockImplementation(
  (error: unknown, status?: number) => Boolean(
    error && typeof error === 'object' && 'status' in error
    && (status === undefined || error.status === status)
  ),
);
hooksMock.useUpdateClientService.mockReturnValue({ mutateAsync, isPending: false });

fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
expect(await screen.findByRole('button', { name: 'Reload latest service' })).toBeVisible();
fireEvent.click(screen.getByRole('button', { name: 'Reload latest service' }));
await waitFor(() => expect(screen.getByLabelText('Service name')).toHaveValue('Server-updated service'));
fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
expect(mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({
  data: expect.objectContaining({ updatedAt: refreshed.updatedAt }),
}));
```

Add a validation assertion that the empty Service name has `aria-invalid="true"` and `aria-describedby` pointing to visible field-specific error text. Add a Company tabs assertion for `role="tablist"`, `aria-selected`, horizontal overflow, and non-shrinking mobile touch targets.

- [x] **Step 2: Run the focused component test and verify the new assertions fail**

```powershell
npx.cmd vitest run __tests__/components/company-services-tab.test.tsx
```

Expected: FAIL because request errors have no status, the editor cannot reload, validation is form-global, and tabs lack the responsive accessibility contract.

- [x] **Step 3: Preserve HTTP status and implement explicit conflict reload**

In `use-client-services.ts`, use this exact error boundary:

```ts
export class HttpRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

export function isHttpRequestError(error: unknown, status?: number): error is HttpRequestError {
  return error instanceof HttpRequestError && (status === undefined || error.status === status);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new HttpRequestError(body.error ?? 'Request failed', response.status);
  return body as T;
}
```

In the editor, store `updatedAt` separately from the prop, call `useClientService(service.id)`, and centralize DTO hydration:

```ts
const [updatedAt, setUpdatedAt] = useState(service.updatedAt);
const [hasConflict, setHasConflict] = useState(false);
const latestService = useClientService(service.id);

const replaceForm = (next: ClientServiceDto) => {
  setServiceName(next.serviceName);
  setFamilyName(next.familyName);
  setStatus(next.status);
  setCadence(next.serviceCadence);
  setCustomCadenceLabel(next.customCadenceLabel ?? '');
  setStartDate(next.startDate);
  setEndDate(next.endDate ?? '');
  setFees(next.feeLines.map((fee) => ({ ...fee, uiId: uuid() })));
  setFieldValues(Object.entries(next.fieldValues).map(([key, value]) => ({ uiId: uuid(), key, value })));
  setUpdatedAt(next.updatedAt);
};

const reloadLatest = async () => {
  const result = await latestService.refetch();
  if (!result.data) throw new Error('Unable to reload the latest service.');
  replaceForm(result.data);
  setHasConflict(false);
  setFormError('');
};
```

Submit `updatedAt`, not `service.updatedAt`. On `isHttpRequestError(error, 409)`, keep the modal open, set `hasConflict`, and require reload before another save. Never combine stale form values with the refreshed token.

- [x] **Step 4: Apply the design system and accessible validation contract**

Use `FormInput` for text/date fields. Use stable explicit IDs for selects and dynamic fee fields. Each invalid control receives `aria-invalid="true"` and `aria-describedby="<field-id>-error"`; each corresponding message uses that ID. Labels use `text-xs font-medium text-text-secondary` and a separate `mb-1.5` association.

Change Company tabs to:

```tsx
<div role="tablist" aria-label="Company sections" className="mb-6 flex items-center overflow-x-auto border-b border-border-primary">
  <button
    role="tab"
    aria-selected={isActive}
    className="flex min-h-11 shrink-0 items-center gap-2 px-4 py-2.5 text-sm transition-colors sm:min-h-0"
  >
```

- [x] **Step 5: Make the browser test enforce real conflict semantics**

Route mocked requests by URL. Every PATCH containing the stale timestamp must return 409; the detail GET returns the refreshed DTO; only a PATCH containing the refreshed timestamp succeeds:

```ts
if (method === 'GET' && url.includes('/api/client-services/service-1')) return json(refreshedService);
if (method === 'GET') return json(fixture);
if (method === 'PATCH' && body.updatedAt === service.updatedAt) {
  return json({ error: 'This service was updated by someone else.' }, 409);
}
if (method === 'PATCH' && body.updatedAt === refreshedService.updatedAt) {
  return json({ ...refreshedService, ...body, updatedAt: '2026-08-01T02:00:00.000Z' });
}
return json({ error: 'Unexpected concurrency token' }, 500);
```

Click `Reload latest service`, assert the refreshed name is rendered, then save and assert the final PATCH contains `refreshedService.updatedAt`.

- [x] **Step 6: Run component and browser verification**

```powershell
npx.cmd vitest run __tests__/components/company-services-tab.test.tsx
npx.cmd vitest run --config vitest.browser.config.ts __tests__/browser/company-services.browser.test.tsx
```

Expected: both files pass; stale PATCHes can never succeed.

- [x] **Step 7: Check the task diff without staging user work**

```powershell
git diff --check -- src/hooks/use-client-services.ts src/components/companies/company-detail/client-service-editor.tsx src/components/companies/company-detail/company-tabs.tsx __tests__/components/company-services-tab.test.tsx __tests__/browser/company-services.browser.test.tsx
```

Expected: exit 0.

### Task 11: Complete manual activation auditing and align the index contract

**Files:**
- Modify: `src/services/service-agreement/activation.service.ts`
- Modify: `__tests__/services/service-agreement-activation.service.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `__tests__/services/client-service-schema.test.ts`
- Modify: `docs/reference/DATABASE_SCHEMA.md`

**Interfaces:**
- Consumes: `runSerializableTransaction(prisma, work)` from `src/lib/prisma-transaction.ts`.
- Produces: a manual activation audit whose `changes` includes `signedAt`, `effectiveDate`, `activationStatus`, and `activationSource`.
- Preserves: migration-managed partial index names `service_agreements_activation_available_claim_idx` and `service_agreements_activation_expired_lease_idx`.

- [x] **Step 1: Write failing audit and migration-contract tests**

Add a successful manual queue test:

```ts
prismaMock.serviceAgreement.findFirst.mockResolvedValue({
  ...agreement,
  signedAt: null,
  effectiveDate: null,
  activationStatus: 'NOT_READY',
  activationSource: null,
});
await requestManualServiceAgreementActivation(agreement.id, {
  signedAt: '2026-07-30T09:15:00.000Z',
  effectiveDate: '2026-07-31',
  reason: 'Externally signed by the client',
}, { tenantId: agreement.tenantId, userId: 'user-1' });
expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
  userId: 'user-1',
  reason: 'Externally signed by the client',
  changes: {
    signedAt: { old: null, new: '2026-07-30T09:15:00.000Z' },
    effectiveDate: { old: null, new: '2026-07-31' },
    activationStatus: { old: 'NOT_READY', new: 'PENDING' },
    activationSource: { old: null, new: 'MANUAL' },
  },
}), prismaMock);
```

Update the schema test to read the migration SQL and assert the exact partial indexes and predicates while asserting the two misleading Prisma `@@index` declarations are absent.

- [x] **Step 2: Run tests and verify both new contracts fail**

```powershell
npx.cmd vitest run __tests__/services/service-agreement-activation.service.test.ts __tests__/services/client-service-schema.test.ts
```

Expected: FAIL because the audit omits `changes` and the Prisma schema still declares full indexes.

- [x] **Step 3: Implement the audit changes and serializable retry wrapper**

Replace direct serializable `$transaction` calls in manual activation, retry, failure persistence, and single-claim processing with `runSerializableTransaction`. Add the audit payload:

```ts
changes: {
  signedAt: { old: agreement.signedAt?.toISOString() ?? null, new: input.signedAt },
  effectiveDate: {
    old: agreement.effectiveDate?.toISOString().slice(0, 10) ?? null,
    new: input.effectiveDate,
  },
  activationStatus: { old: agreement.activationStatus, new: 'PENDING' },
  activationSource: { old: agreement.activationSource, new: 'MANUAL' },
},
```

- [x] **Step 4: Remove contradictory Prisma indexes and document migration ownership**

Remove only:

```prisma
@@index([activationStatus, activationAvailableAt])
@@index([activationStatus, activationLeaseExpiresAt])
```

Do not change the migration SQL. Document that both activation queue indexes are partial, predicate-specific, and therefore migration-managed rather than represented by Prisma schema declarations.

- [x] **Step 5: Regenerate Prisma and run the focused tests**

```powershell
npm.cmd run db:generate
npx.cmd vitest run __tests__/services/service-agreement-activation.service.test.ts __tests__/services/client-service-schema.test.ts
```

Expected: generation succeeds and both files pass.

- [x] **Step 6: Check the task diff without staging user work**

```powershell
git diff --check -- src/services/service-agreement/activation.service.ts __tests__/services/service-agreement-activation.service.test.ts prisma/schema.prisma __tests__/services/client-service-schema.test.ts docs/reference/DATABASE_SCHEMA.md
```

Expected: exit 0.

### Task 12: Prove the activation lifecycle under retries and real PostgreSQL concurrency

**Files:**
- Modify: `__tests__/services/service-agreement-activation.service.test.ts`
- Modify: `__tests__/integration/service-agreement-activation.postgres.test.ts`
- Modify: `.env.example`
- Modify: `docs/reference/ENVIRONMENT_VARIABLES.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: `TEST_DATABASE_URL`, which must point to an isolated disposable PostgreSQL database.
- Produces: `npm run test:stage3:postgres`.
- CI contract: `CI=true` without `TEST_DATABASE_URL` is a test failure, not a skip.

- [x] **Step 1: Add failing retry-policy unit cases**

Use a fixed clock and sequential `findFirst` results to assert exact state transitions:

```ts
vi.useFakeTimers();
vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
prismaMock.serviceAgreement.findFirst
  .mockResolvedValueOnce(agreement)
  .mockResolvedValueOnce({ activationAttemptCount: 0 });
prismaMock.clientService.create.mockRejectedValueOnce(new Error('temporary'));
await expect(processServiceAgreementActivation(claim)).resolves.toMatchObject({ status: 'retryable-failure' });
expect(prismaMock.serviceAgreement.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    activationStatus: 'FAILED_RETRYABLE',
    activationAttemptCount: 1,
    activationAvailableAt: new Date('2026-08-01T00:01:00.000Z'),
  }),
}));
```

Repeat with `activationAttemptCount: 4` and assert `FAILED_PERMANENT` plus `activationAvailableAt: null`. Add a failure-path stale-worker case where the second `findFirst` returns `null` and assert no failure update occurs.

- [x] **Step 2: Add the CI/database preflight and lifecycle integration cases**

At module scope:

```ts
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('Stage 3 PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

const describePostgres = testDatabaseUrl ? describe : describe.skip;
```

Extend `seedAgreement` with `agreementStatus`, `activationStatus`, `activationAttemptCount`, `claimToken`, and `leaseExpiresAt`. Add real-database cases that prove:

```ts
// expired lease is reclaimed
expect(await processQueuedServiceAgreementActivations({ limit: 1, concurrency: 1, leaseMs: 60_000 }))
  .toMatchObject({ claimed: 1, completed: 1, failed: 0 });

// cancelled queued work is ignored
expect(await processQueuedServiceAgreementActivations({ limit: 1, concurrency: 1 }))
  .toMatchObject({ claimed: 0, completed: 0, failed: 0 });

// old claim cannot write
expect(await processServiceAgreementActivation(oldClaim)).toEqual({ status: 'stale-worker' });

// duplicate completion is idempotent
expect(await processServiceAgreementActivation(originalClaim)).toMatchObject({ status: 'already-completed' });
expect(await prisma.clientService.count({ where: { agreementId } })).toBe(1);

// retry overlap has exactly one success and one typed conflict
const results = await Promise.allSettled([
  retryServiceAgreementActivation(agreementId, actor),
  retryServiceAgreementActivation(agreementId, actor),
]);
expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
```

Retain the existing overlap, unique-row, transaction-rollback, and `EXPLAIN` assertions.

- [x] **Step 3: Add the dedicated command and environment documentation**

Add to `package.json`:

```json
"test:stage3:postgres": "vitest run __tests__/integration/service-agreement-activation.postgres.test.ts"
```

Add `TEST_DATABASE_URL` to `.env.example` and `docs/reference/ENVIRONMENT_VARIABLES.md` with an explicit warning that it must be isolated and disposable. Never fall back to `DATABASE_URL`.

- [x] **Step 4: Run unit coverage and the PostgreSQL preflight**

```powershell
npx.cmd vitest run __tests__/services/service-agreement-activation.service.test.ts
npm.cmd run test:stage3:postgres
```

Expected locally without `TEST_DATABASE_URL`: unit tests pass and PostgreSQL cases report skipped. Expected in CI or with the variable set: every PostgreSQL case must execute and pass; missing CI configuration fails with the explicit preflight message.

- [x] **Step 5: Check the task diff without staging user work**

```powershell
git diff --check -- __tests__/services/service-agreement-activation.service.test.ts __tests__/integration/service-agreement-activation.postgres.test.ts .env.example docs/reference/ENVIRONMENT_VARIABLES.md package.json
```

Expected: exit 0.

### Task 13: Exercise signing completion, API boundaries, and backup compatibility

**Files:**
- Modify: `src/services/esigning-signing.service.ts`
- Modify: `__tests__/services/esigning-service-agreement-activation.test.ts`
- Modify: `__tests__/api/client-services-routes.test.ts`
- Modify: `__tests__/services/backup-service-agreement-data.test.ts`

**Interfaces:**
- Produces: `finalizeEsigningEnvelopeCompletion(tx, input): Promise<boolean>` as the authoritative compare-and-set completion helper used by `completeEsigningSigningSession`.
- Preserves: completion succeeds even when post-commit activation processing fails.
- Preserves: backup manifest versions `1.1 | 1.2`; absent Stage 3 arrays restore as empty.

- [x] **Step 1: Replace the source-regex signing test with failing behavior tests**

Extract and test this interface:

```ts
export async function finalizeEsigningEnvelopeCompletion(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    envelopeId: string;
    currentStatus: EsigningEnvelopeStatus;
    remainingSignerCount: number;
    completedAt: Date;
  },
): Promise<boolean>;
```

The tests pass a transaction mock and assert:

```ts
tx.esigningEnvelope.updateMany.mockResolvedValue({ count: 1 });
await expect(finalizeEsigningEnvelopeCompletion(tx, finalSignerInput)).resolves.toBe(true);
expect(activationMock.queueServiceAgreementActivationsForEnvelope)
  .toHaveBeenCalledWith(tx, 'envelope-1', completedAt);

tx.esigningEnvelope.updateMany.mockResolvedValue({ count: 0 });
await expect(finalizeEsigningEnvelopeCompletion(tx, finalSignerInput)).resolves.toBe(false);
expect(activationMock.queueServiceAgreementActivationsForEnvelope).not.toHaveBeenCalled();
```

Add a non-final signer case that transitions `SENT` to `IN_PROGRESS` without queueing activation.

- [x] **Step 2: Implement and wire the completion helper**

Move the existing `remainingSignerCount` completion/in-progress branch into `finalizeEsigningEnvelopeCompletion`. Call it from `completeEsigningSigningSession` inside the existing transaction. Keep `safelyProcessServiceAgreementActivations` after commit and only invoke it when the helper reports an authoritative completion transition.

- [x] **Step 3: Add API authorization and not-found cases**

Add route tests using typed errors:

```ts
rbacMock.requirePermission.mockRejectedValueOnce(new ForbiddenError());
expect((await getService(request, context)).status).toBe(403);

serviceMock.getClientService.mockRejectedValueOnce(new NotFoundError('Service not found'));
expect((await getService(request, context)).status).toBe(404);
```

Cover list, detail/update/archive, manual activation, and retry permission denial at least once per distinct permission path. Assert the underlying mutation is not called after denial.

- [x] **Step 4: Add backup dry-run and legacy-data cases**

Replace the empty Prisma proxy with explicit `workspace`, `workspaceBackup`, `contactMergeOperation`, and `$transaction` mocks. Spy on `getBackupDetails` and `validateBackupIntegrity` to test:

```ts
await expect(service.restoreWorkspaceBackup('backup-1', 'user-1', { dryRun: true }))
  .resolves.toMatchObject({ success: true, message: expect.stringContaining('Dry run successful') });
expect(prismaMock.workspaceBackup.update).not.toHaveBeenCalled();
expect(prismaMock.$transaction).not.toHaveBeenCalled();
expect(storageMock.download).not.toHaveBeenCalled();
```

Call `restoreDatabaseData` with a legacy record that omits `clientServices` and `clientServiceFeeLines`; assert neither delegate is called and the restore completes. Keep the parent/child ordering checks for modern backups.

- [x] **Step 5: Run the signing, API, and backup tests**

```powershell
npx.cmd vitest run __tests__/services/esigning-service-agreement-activation.test.ts __tests__/api/client-services-routes.test.ts __tests__/services/backup-service-agreement-data.test.ts
```

Expected: all three files pass without source-text assertions.

- [x] **Step 6: Check the task diff without staging user work**

```powershell
git diff --check -- src/services/esigning-signing.service.ts __tests__/services/esigning-service-agreement-activation.test.ts __tests__/api/client-services-routes.test.ts __tests__/services/backup-service-agreement-data.test.ts
```

Expected: exit 0.

### Task 14: Repair every unrelated full-suite failure at its cause

**Files:**
- Modify: `__tests__/api/generated-documents-preview-route.test.ts`
- Modify: `__tests__/api/generated-documents-validation-route.test.ts`
- Modify: `__tests__/api/bizfile-confirm-route.test.ts`
- Diagnose only unless a repeatable defect remains: `__tests__/services/service-catalog.service.test.ts`

**Interfaces:**
- Preview renderer input includes `generatedDocumentId`, `serviceAgreementId`, and trusted `userId`.
- Validation input includes `draftId`, `serviceAgreementId`, and trusted user ID as the fourth argument.

- [x] **Step 1: Preserve the reproduced failures as exact contract updates**

Update the preview expectation with:

```ts
generatedDocumentId: undefined,
serviceAgreementId: undefined,
userId: 'user-1',
```

Update both validation expectations with `draftId: undefined`, `serviceAgreementId: undefined`, and the fourth argument `'user-1'`. Keep the assertion that client-supplied preparer identity is not trusted.

- [x] **Step 2: Remove repeated BizFile route module resets**

Import the route once after mocks:

```ts
import { POST } from '@/app/api/documents/[documentId]/confirm/route';

async function post(body?: unknown) {
  return POST(request(body) as never, { params: Promise.resolve({ documentId: 'doc-1' }) });
}
```

Remove `vi.resetModules()` and the dynamic import from every request. The isolated baseline shows the first dynamic import consumes about 4.8 seconds, while every route assertion itself completes in milliseconds; eliminating repeated module invalidation addresses full-suite contention without increasing timeouts.

- [x] **Step 3: Run the formerly failing set three times**

```powershell
1..3 | ForEach-Object { npx.cmd vitest run __tests__/api/generated-documents-preview-route.test.ts __tests__/api/generated-documents-validation-route.test.ts __tests__/api/bizfile-confirm-route.test.ts __tests__/services/service-catalog.service.test.ts }
```

Expected: all four files pass on all three runs within the existing timeout. Do not change the service-catalog timeout unless a deterministic production/test defect is reproduced after the BizFile setup fix.

- [x] **Step 4: Check the task diff without staging user work**

```powershell
git diff --check -- __tests__/api/generated-documents-preview-route.test.ts __tests__/api/generated-documents-validation-route.test.ts __tests__/api/bizfile-confirm-route.test.ts
```

Expected: exit 0.

### Task 15: Run release gates and close the final re-review

**Files:**
- Modify: `docs/superpowers/plans/2026-07-30-client-services-activation.md`
- Modify: `docs/superpowers/plans/2026-07-30-client-services-activation-review.md`
- Modify if evidence changed: `docs/ARCHITECTURE.md`
- Modify if evidence changed: `docs/guides/SERVICE_PATTERNS.md`

**Interfaces:**
- Consumes all production and test contracts from Tasks 10-14.
- Produces an evidence-backed final disposition for every `CSA-REV-*` finding.

- [x] **Step 1: Run Prisma and focused Stage 3 verification**

```powershell
npm.cmd run db:generate
npx.cmd vitest run __tests__/services/client-service-schema.test.ts __tests__/lib/client-service-validation.test.ts __tests__/services/client-service.service.test.ts __tests__/services/service-agreement-activation.service.test.ts __tests__/services/esigning-service-agreement-activation.test.ts __tests__/services/service-agreement-activation-scheduler.test.ts __tests__/services/backup-service-agreement-data.test.ts __tests__/api/client-services-routes.test.ts __tests__/components/company-services-tab.test.tsx __tests__/integration/service-agreement-activation.postgres.test.ts
```

Expected: all non-PostgreSQL tests pass. PostgreSQL tests execute and pass when `TEST_DATABASE_URL` is configured; otherwise local output explicitly reports them skipped and the review retains that external gate.

- [x] **Step 2: Run browser, build, and full-suite verification**

```powershell
npx.cmd vitest run --config vitest.browser.config.ts __tests__/browser/company-services.browser.test.tsx
npm.cmd run build
npm.cmd run test:run
git diff --check
```

Expected: browser tests, production build, full repository suite, and whitespace validation all exit 0.

- [x] **Step 3: Update the existing review report with exact evidence**

For every prior finding, record `Resolved`, `Partially resolved`, or `Blocked`, cite the changed code/test location, and include command totals. Do not mark the PostgreSQL gate complete if it was skipped. Record authenticated rendered QA as blocked if no development credentials are available rather than substituting unauthenticated `/login` output.

- [x] **Step 4: Self-review the documentation and working tree**

```powershell
rg -n "TBD|TODO|PLACEHOLDER" docs/superpowers/plans/2026-07-30-client-services-activation.md docs/superpowers/plans/2026-07-30-client-services-activation-review.md
git status --short
git diff --check
```

Expected: no placeholders introduced, no accidental files staged, and no whitespace errors.
