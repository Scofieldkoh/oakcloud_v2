# Background E-signing Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and maintain task-owned E-signing draft envelopes in the background as soon as their nearest generated document and all intervening task stages are ready.

**Architecture:** Add a tenant-scoped durable preparation queue keyed by E-signing task stage. Lifecycle callbacks enqueue lightweight reconciliation work, an immediately triggered and scheduler-backed worker claims independent jobs with PostgreSQL leases, and a focused service converges each job on one envelope and one managed generated-document attachment. Task navigation reads preparation state instead of creating a foreground envelope.

**Tech Stack:** Next.js 15, React 19, TypeScript, Prisma 7/PostgreSQL, Vitest, TanStack Query, existing scheduler and storage services.

## Global Constraints

- Use the nearest preceding Document Generation stage.
- Open the preparation gate only when every intervening stage is `COMPLETED` or `SKIPPED`.
- Preserve recipients and envelope settings when a generated document is detached.
- Remove document-bound fields with the detached managed document.
- Reattach the latest PDF to the same envelope after refinalization.
- Block generated-document unfinalization after the task-owned envelope leaves `DRAFT`.
- Use durable, idempotent, tenant-scoped queue processing with multi-instance-safe leases.
- Do not automatically add recipients, place fields, or send envelopes.
- Do not run the full test suite or production build until all implementation tasks are complete.

---

### Task 1: Durable Preparation Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260728010000_background_esigning_preparation/migration.sql`
- Test: `__tests__/services/task-schema-reset.test.ts`
- Test: `__tests__/services/task-module-integrations.test.ts`

**Interfaces:**
- Produces: Prisma model `TaskEsigningPreparation`
- Produces: enum `TaskEsigningPreparationStatus`
- Produces: nullable `EsigningEnvelopeDocument.generatedDocumentId`
- Produces: unique preparation ownership by `taskStageId`

- [ ] **Step 1: Write failing schema contract tests**

Add assertions that require:

```ts
expect(schema).toContain('model TaskEsigningPreparation');
expect(schema).toContain('enum TaskEsigningPreparationStatus');
expect(schema).toMatch(/taskStageId\s+String\s+@unique/);
expect(schema).toMatch(/generatedDocumentId\s+String\?/);
expect(schema).toContain('leaseExpiresAt');
expect(schema).toContain('FAILED_RETRYABLE');
expect(schema).toContain('FAILED_PERMANENT');
```

Also assert the migration creates the enum, table, tenant indexes, stage uniqueness, lease index, and generated-document source column.

- [ ] **Step 2: Run the focused schema tests and confirm contract failure**

Run:

```powershell
npx.cmd vitest run __tests__/services/task-schema-reset.test.ts __tests__/services/task-module-integrations.test.ts --exclude .worktrees/**
```

Expected: FAIL because the preparation model and migration do not exist.

- [ ] **Step 3: Add the Prisma model and migration**

Define a preparation record with:

```prisma
enum TaskEsigningPreparationStatus {
  WAITING
  QUEUED
  PROCESSING
  READY
  FAILED_RETRYABLE
  FAILED_PERMANENT
}
```

The model stores tenant/task/stage identifiers, source stage and generated-document identifiers, envelope and envelope-document identifiers, initiating user, status, attempt count, availability, claim/lease timestamps, last error, and timestamps. Add explicit relation names where `TaskStage` is referenced twice. Use `onDelete: Cascade` for the owned E-signing stage and `onDelete: SetNull` for authoritative source and envelope records.

Add `EsigningEnvelopeDocument.generatedDocumentId` with a relation to `GeneratedDocument` and `@@unique([envelopeId, generatedDocumentId])`.

- [ ] **Step 4: Generate Prisma types and rerun focused schema tests**

Run:

```powershell
npm.cmd run db:generate
npx.cmd vitest run __tests__/services/task-schema-reset.test.ts __tests__/services/task-module-integrations.test.ts --exclude .worktrees/**
```

Expected: PASS.

- [ ] **Step 5: Commit the schema slice**

```powershell
git add prisma/schema.prisma prisma/migrations/20260728010000_background_esigning_preparation/migration.sql __tests__/services/task-schema-reset.test.ts __tests__/services/task-module-integrations.test.ts
git commit -m "feat(tasks): add e-signing preparation queue schema"
```

### Task 2: Eligibility and Queue Service

**Files:**
- Create: `src/services/tasks/esigning-preparation.service.ts`
- Create: `src/services/tasks/__tests__/esigning-preparation.service.test.ts`
- Modify: `src/services/tasks/index.ts`

**Interfaces:**
- Produces:

```ts
export interface TaskEsigningPreparationSnapshot {
  id: string;
  taskId: string;
  taskStageId: string;
  status: TaskEsigningPreparationStatus;
  blockingStage: { id: string; name: string; status: TaskStageStatus } | null;
  generatedDocumentId: string | null;
  esigningEnvelopeId: string | null;
  lastError: string | null;
}

export function ensureTaskEsigningPreparation(input: {
  tenantId: string;
  taskId: string;
  taskStageId: string;
  initiatedById?: string;
}): Promise<TaskEsigningPreparationSnapshot>;

export function queueTaskEsigningPreparationsForTask(
  tenantId: string,
  taskId: string,
  initiatedById?: string,
): Promise<number>;

export function queueTaskEsigningPreparationsForGeneratedDocument(
  tenantId: string,
  generatedDocumentId: string,
  initiatedById?: string,
): Promise<number>;
```

- [ ] **Step 1: Write failing eligibility tests**

Cover literal pipelines for:

```ts
DOCUMENT_GENERATION -> ESIGNING
DOCUMENT_GENERATION -> MANUAL(COMPLETED) -> ESIGNING
DOCUMENT_GENERATION -> MANUAL(SKIPPED) -> ESIGNING
DOCUMENT_GENERATION -> MANUAL(IN_PROGRESS) -> ESIGNING
DOCUMENT_GENERATION A -> ESIGNING A -> DOCUMENT_GENERATION B -> ESIGNING B
```

Assert the nearest source stage, first blocking intervening stage, finalized generated-document requirement, tenant scoping, and unique queue upsert.

- [ ] **Step 2: Run the service test and confirm missing-module failure**

Run:

```powershell
npx.cmd vitest run src/services/tasks/__tests__/esigning-preparation.service.test.ts --exclude .worktrees/**
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement eligibility resolution and idempotent queue upsert**

Keep pipeline discovery and queue mutation separate:

```ts
async function resolvePreparationEligibility(
  tenantId: string,
  taskId: string,
  taskStageId: string,
): Promise<{
  sourceStageId: string | null;
  generatedDocumentId: string | null;
  blockingStage: TaskEsigningPreparationSnapshot['blockingStage'];
  ready: boolean;
}>;
```

Use ordered task-stage snapshots. Select the last `DOCUMENT_GENERATION` stage before the target E-signing stage. A later Document Generation stage replaces all earlier candidates. Queue upserts must retain an existing envelope and initiator, update the current source identifiers, and set `QUEUED` only when reconciliation is required.

- [ ] **Step 4: Run the focused service tests**

Run:

```powershell
npx.cmd vitest run src/services/tasks/__tests__/esigning-preparation.service.test.ts --exclude .worktrees/**
```

Expected: PASS.

- [ ] **Step 5: Commit the queue service**

```powershell
git add src/services/tasks/esigning-preparation.service.ts src/services/tasks/__tests__/esigning-preparation.service.test.ts src/services/tasks/index.ts
git commit -m "feat(tasks): queue e-signing preparation"
```

### Task 3: Managed Envelope and Document Operations

**Files:**
- Modify: `src/services/esigning-envelope.service.ts`
- Modify: `src/services/esigning-envelope.lib.ts`
- Test: `__tests__/services/task-module-integrations.test.ts`
- Test: `__tests__/services/esigning-preparation-envelope.test.ts`

**Interfaces:**
- Produces:

```ts
export function createTaskPreparedEsigningEnvelope(input: {
  tenantId: string;
  taskContext: TaskLaunchContext;
  createdById: string;
  title: string;
  companyId?: string | null;
  signingOrder?: EsigningSigningOrder;
  expiresAt?: Date | null;
}): Promise<{ id: string }>;

export function attachGeneratedDocumentToDraftEnvelope(input: {
  tenantId: string;
  envelopeId: string;
  generatedDocumentId: string;
  actorUserId: string;
}): Promise<{ envelopeDocumentId: string }>;

export function detachGeneratedDocumentFromDraftEnvelope(input: {
  tenantId: string;
  envelopeId: string;
  generatedDocumentId: string;
  actorUserId: string;
}): Promise<void>;
```

- [ ] **Step 1: Write failing managed-attachment behavior tests**

Assert:

- Draft envelope creation persists durable task context and actor attribution.
- Repeated creation for the same task stage returns the existing envelope.
- Attachment export stores `generatedDocumentId`.
- Reattaching the same finalized revision is a no-op.
- Replacement persists the new asset before deleting the old asset.
- Detach deletes only the managed document.
- Recipient records and envelope configuration are untouched.
- Cascading document-field deletion occurs through the real relation.
- Manual envelope documents remain.
- Non-draft mutation fails.

- [ ] **Step 2: Run the focused envelope tests**

Run:

```powershell
npx.cmd vitest run __tests__/services/esigning-preparation-envelope.test.ts __tests__/services/task-module-integrations.test.ts --exclude .worktrees/**
```

Expected: FAIL on missing managed-operation exports.

- [ ] **Step 3: Extract internal service operations**

Reuse the existing PDF export, PDF validation, storage key, hash, event, and audit behavior. Do not construct a synthetic `SessionUser`. Keep public foreground methods as permission-checking wrappers over shared internal operations.

The create operation must query existing E-signing outcome or envelope metadata for the same task stage before insertion. The managed attachment must be distinguishable through `generatedDocumentId`.

- [ ] **Step 4: Run the focused envelope tests**

Run:

```powershell
npx.cmd vitest run __tests__/services/esigning-preparation-envelope.test.ts __tests__/services/task-module-integrations.test.ts --exclude .worktrees/**
```

Expected: PASS.

- [ ] **Step 5: Commit managed envelope operations**

```powershell
git add src/services/esigning-envelope.service.ts src/services/esigning-envelope.lib.ts __tests__/services/esigning-preparation-envelope.test.ts __tests__/services/task-module-integrations.test.ts
git commit -m "feat(esigning): manage generated task documents"
```

### Task 4: Multi-instance Preparation Worker

**Files:**
- Modify: `src/services/tasks/esigning-preparation.service.ts`
- Modify: `src/services/tasks/__tests__/esigning-preparation.service.test.ts`

**Interfaces:**
- Produces:

```ts
export function processTaskEsigningPreparation(
  preparationId: string,
): Promise<TaskEsigningPreparationSnapshot>;

export function processQueuedTaskEsigningPreparations(options?: {
  limit?: number;
  concurrency?: number;
  leaseMs?: number;
}): Promise<{ claimed: number; processed: number; failed: number }>;

export function triggerQueuedTaskEsigningPreparationProcessing(): void;
```

- [ ] **Step 1: Write failing reconciliation and claim tests**

Assert:

- Claim SQL uses `FOR UPDATE SKIP LOCKED`.
- Claims only due `QUEUED`, due `FAILED_RETRYABLE`, and expired `PROCESSING` records.
- Separate workers receive disjoint preparation IDs.
- Closed gates converge to `WAITING`.
- Open gates create/reuse an envelope, link the outcome, and attach the source.
- Unfinalized sources detach and return to `WAITING`.
- Refinalized sources reattach to the same envelope.
- Retryable failures increment attempts and set backoff.
- Invalid pipeline relationships become `FAILED_PERMANENT`.
- A stale worker cannot overwrite a newer lease result.

- [ ] **Step 2: Run the worker tests**

Run:

```powershell
npx.cmd vitest run src/services/tasks/__tests__/esigning-preparation.service.test.ts --exclude .worktrees/**
```

Expected: FAIL on missing processing functions.

- [ ] **Step 3: Implement claim leasing and bounded processing**

Use a short transaction to claim IDs and set `PROCESSING`, `claimedAt`, and `leaseExpiresAt`. Process claimed IDs outside that transaction with a bounded promise pool. Before final status mutation, verify the current claim timestamp or lease token still matches.

Classify export, storage, and transient database failures as retryable. Classify missing stages, wrong target action, and impossible source relationships as permanent.

- [ ] **Step 4: Run focused worker tests**

Run:

```powershell
npx.cmd vitest run src/services/tasks/__tests__/esigning-preparation.service.test.ts --exclude .worktrees/**
```

Expected: PASS.

- [ ] **Step 5: Commit worker processing**

```powershell
git add src/services/tasks/esigning-preparation.service.ts src/services/tasks/__tests__/esigning-preparation.service.test.ts
git commit -m "feat(tasks): process e-signing preparation jobs"
```

### Task 5: Lifecycle Triggers and Immutable-envelope Guard

**Files:**
- Modify: `src/services/document-generator.service.ts`
- Modify: `src/services/tasks/stage.service.ts`
- Modify: `src/services/tasks/task.service.ts`
- Modify: `src/services/tasks/integration.service.ts`
- Test: `__tests__/services/document-generator.service.test.ts`
- Test: `__tests__/services/task-stage-registry.test.ts`
- Test: `__tests__/services/task-module-integrations.test.ts`

**Interfaces:**
- Consumes: queue functions from Task 2
- Produces:

```ts
export function assertGeneratedDocumentCanBeUnfinalized(
  tenantId: string,
  generatedDocumentId: string,
): Promise<void>;
```

- [ ] **Step 1: Write failing lifecycle tests**

Assert that finalization, unfinalization, generated-document outcome linking, intervening-stage completion, skip, reopen, and reconciliation queue affected preparation records and request immediate processing only after persistence succeeds.

Assert unfinalization:

```ts
await expect(unfinalizeDocument(id, params, reason))
  .rejects.toThrow('Void the active E-signing envelope before unfinalizing');
```

when a related prepared envelope is not `DRAFT`, while draft envelopes remain detachable.

- [ ] **Step 2: Run focused lifecycle tests**

Run:

```powershell
npx.cmd vitest run __tests__/services/document-generator.service.test.ts __tests__/services/task-stage-registry.test.ts __tests__/services/task-module-integrations.test.ts --exclude .worktrees/**
```

Expected: FAIL because lifecycle methods do not queue preparation or guard unfinalization.

- [ ] **Step 3: Add lifecycle queue callbacks and guard**

Queue by task after integrated stage changes. Queue by generated-document source after finalization and unfinalization. Keep these callbacks safe and observable: log failure without rolling back the authoritative user mutation, while the scheduler and launch recovery can recreate missing work.

Run the immutable-envelope guard before changing the generated document to `DRAFT`.

- [ ] **Step 4: Run focused lifecycle tests**

Run:

```powershell
npx.cmd vitest run __tests__/services/document-generator.service.test.ts __tests__/services/task-stage-registry.test.ts __tests__/services/task-module-integrations.test.ts --exclude .worktrees/**
```

Expected: PASS.

- [ ] **Step 5: Commit lifecycle integration**

```powershell
git add src/services/document-generator.service.ts src/services/tasks/stage.service.ts src/services/tasks/task.service.ts src/services/tasks/integration.service.ts __tests__/services/document-generator.service.test.ts __tests__/services/task-stage-registry.test.ts __tests__/services/task-module-integrations.test.ts
git commit -m "feat(tasks): trigger e-signing draft preparation"
```

### Task 6: Scheduler, Status API, and Permission Boundary

**Files:**
- Create: `src/lib/scheduler/tasks/esigning-preparation.task.ts`
- Modify: `src/lib/scheduler/tasks/index.ts`
- Modify: `src/lib/scheduler/index.ts`
- Create: `src/app/api/tasks/[taskId]/stages/[stageId]/esigning-preparation/route.ts`
- Create: `src/app/api/tasks/[taskId]/stages/[stageId]/esigning-preparation/retry/route.ts`
- Create: `src/app/api/tasks/__tests__/esigning-preparation-route.test.ts`
- Test: `__tests__/services/tasks-documentation.test.ts`

**Interfaces:**
- Produces:

```http
GET /api/tasks/:taskId/stages/:stageId/esigning-preparation
POST /api/tasks/:taskId/stages/:stageId/esigning-preparation
POST /api/tasks/:taskId/stages/:stageId/esigning-preparation/retry
```

All responses serialize `TaskEsigningPreparationSnapshot`.

- [ ] **Step 1: Write failing scheduler and route tests**

Assert scheduler registration, execution delegation, task/stage ownership validation, tenant scoping, task update permission, document read permission, E-signing create/read permission, retry-state validation, and consistent error responses.

- [ ] **Step 2: Run focused scheduler/API tests**

Run:

```powershell
npx.cmd vitest run src/app/api/tasks/__tests__/esigning-preparation-route.test.ts __tests__/services/tasks-documentation.test.ts --exclude .worktrees/**
```

Expected: FAIL because routes and scheduler task do not exist.

- [ ] **Step 3: Implement the scheduler and routes**

Register `esigning-preparation` with a one-minute default cron pattern. POST ensure must create/queue missing legacy state and request immediate processing. GET is read-only. Retry accepts only `FAILED_RETRYABLE` or an expired `PROCESSING` lease.

- [ ] **Step 4: Run focused scheduler/API tests**

Run:

```powershell
npx.cmd vitest run src/app/api/tasks/__tests__/esigning-preparation-route.test.ts __tests__/services/tasks-documentation.test.ts --exclude .worktrees/**
```

Expected: PASS.

- [ ] **Step 5: Commit scheduler and API**

```powershell
git add src/lib/scheduler/tasks/esigning-preparation.task.ts src/lib/scheduler/tasks/index.ts src/lib/scheduler/index.ts src/app/api/tasks/[taskId]/stages/[stageId]/esigning-preparation __tests__/services/tasks-documentation.test.ts
git commit -m "feat(tasks): expose e-signing preparation status"
```

### Task 7: Preparation-aware E-signing Navigation

**Files:**
- Modify: `src/hooks/use-tasks.ts`
- Modify: `src/components/esigning/esigning-list-page.tsx`
- Modify: `src/components/tasks/task-stage-modal.tsx`
- Modify: `src/services/tasks/action-registry.ts`
- Test: `__tests__/components/esigning-list-actions.test.tsx`
- Test: `src/components/tasks/__tests__/task-components.test.tsx`
- Test: `__tests__/hooks/task-hooks.test.tsx`

**Interfaces:**
- Produces:

```ts
export function useTaskEsigningPreparation(
  context: TaskLaunchContext | null,
): UseQueryResult<TaskEsigningPreparationSnapshot>;

export function useEnsureTaskEsigningPreparation(): UseMutationResult<
  TaskEsigningPreparationSnapshot,
  Error,
  TaskLaunchContext
>;

export function useRetryTaskEsigningPreparation(): UseMutationResult<
  TaskEsigningPreparationSnapshot,
  Error,
  TaskLaunchContext
>;
```

- [ ] **Step 1: Write failing navigation tests**

Assert:

- Task launch no longer calls the generic envelope-create mutation.
- Existing outcome links still open `/esigning/:id`.
- Missing legacy preparation is ensured once.
- `QUEUED` and `PROCESSING` show progress and poll.
- An available envelope navigates once.
- `WAITING` names its blocking stage or source condition.
- `FAILED_RETRYABLE` exposes Retry.
- `FAILED_PERMANENT` shows the permanent error without Retry.

- [ ] **Step 2: Run focused hook/component tests**

Run:

```powershell
npx.cmd vitest run __tests__/components/esigning-list-actions.test.tsx src/components/tasks/__tests__/task-components.test.tsx __tests__/hooks/task-hooks.test.tsx --exclude .worktrees/**
```

Expected: FAIL because task launch still auto-creates an envelope and no preparation hooks exist.

- [ ] **Step 3: Implement preparation-aware navigation**

Remove the task-context auto-start effect from `EsigningListPage`. On task launch, ensure preparation, poll status while nonterminal, render an accessible preparation panel, and navigate to the returned envelope. Keep the existing manual Start/upload workflow unchanged when no task context exists.

Keep direct authoritative outcome links in the stage adapter. Do not add a second envelope creation path.

- [ ] **Step 4: Run focused hook/component tests**

Run:

```powershell
npx.cmd vitest run __tests__/components/esigning-list-actions.test.tsx src/components/tasks/__tests__/task-components.test.tsx __tests__/hooks/task-hooks.test.tsx --exclude .worktrees/**
```

Expected: PASS.

- [ ] **Step 5: Commit navigation behavior**

```powershell
git add src/hooks/use-tasks.ts src/components/esigning/esigning-list-page.tsx src/components/tasks/task-stage-modal.tsx src/services/tasks/action-registry.ts __tests__/components/esigning-list-actions.test.tsx src/components/tasks/__tests__/task-components.test.tsx __tests__/hooks/task-hooks.test.tsx
git commit -m "feat(tasks): open prepared e-signing drafts"
```

### Task 8: Documentation and Final Verification

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/GETTING_STARTED.md`
- Modify: any source or test files required to resolve final-suite failures

**Interfaces:**
- Consumes: all prior tasks
- Produces: documented scheduler configuration and verified repository state

- [ ] **Step 1: Update existing documentation**

Document eligibility, detach/refinalize behavior, immutable sent-envelope guard, preparation statuses, immediate trigger plus scheduler fallback, `FOR UPDATE SKIP LOCKED`, lease recovery, and configuration variables.

- [ ] **Step 2: Run all focused feature tests together**

Run:

```powershell
npx.cmd vitest run src/services/tasks/__tests__/esigning-preparation.service.test.ts __tests__/services/esigning-preparation-envelope.test.ts src/app/api/tasks/__tests__/esigning-preparation-route.test.ts __tests__/services/document-generator.service.test.ts __tests__/services/task-stage-registry.test.ts __tests__/services/task-module-integrations.test.ts __tests__/components/esigning-list-actions.test.tsx src/components/tasks/__tests__/task-components.test.tsx __tests__/hooks/task-hooks.test.tsx --exclude .worktrees/**
```

Expected: PASS.

- [ ] **Step 3: Run the full suite once**

Run:

```powershell
npx.cmd vitest run --exclude .worktrees/**
```

Expected: PASS. Fix every failure or gap found by this run, including unrelated failures explicitly placed in scope by the user, and rerun only the failed files until they pass. Do not repeat the entire full suite.

- [ ] **Step 4: Run final static verification**

Run:

```powershell
npx.cmd tsc --noEmit --pretty false
npx.cmd eslint src
git diff --check
```

Expected: all commands exit successfully. Do not run a production build.

- [ ] **Step 5: Commit documentation and final fixes**

```powershell
git add -- docs/ARCHITECTURE.md docs/GETTING_STARTED.md
git add --patch
git commit -m "docs(tasks): document e-signing preparation"
```
