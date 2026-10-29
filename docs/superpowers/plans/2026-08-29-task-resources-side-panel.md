# Task Resources Side Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, live-updating resources panel to the task-stage modal that shows the task, every stage, linked company details, generated documents, e-signing files, signers, and permissioned signer-link actions.

**Architecture:** A dedicated `GET /api/tasks/:taskId/resources` route delegates to a tenant-scoped projection service and leaves the existing task-list DTO unchanged. A focused React Query hook loads and polls the projection only while the modal is open, while a standalone panel component renders task/stage resources and reuses the existing audited signer-link action.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma, TanStack Query, Tailwind CSS, Vitest, Testing Library, Vitest Browser/Playwright

**Spec:** `docs/superpowers/specs/2026-08-29-task-resources-side-panel-design.md`

## Global Constraints

- Keep `GET /api/tasks/:taskId/resources` read-only; it must not generate signer tokens or reconcile/mutate task stages.
- Keep the task list and existing `TaskListItem` response lightweight.
- Scope every database lookup by `tenantId` and require existing task access before returning resources.
- Do not expose raw signing URLs in the aggregate response. Generate them only through the existing audited POST action.
- Return resource-specific `unavailable` states instead of failing the entire response when a linked record is deleted, inaccessible, or temporarily unavailable.
- Display the persisted generated-document title and a PDF filename produced by the same shared helper used by the export route.
- Keep original and signed PDF links for readable e-signing files synchronized while envelope artifacts are processing.
- Poll every 10 seconds only while at least one resource is pending; use a 15-second stale time and stop polling when the modal closes, the request fails, or all resources are terminal.
- Preserve existing stage actions and footer navigation. Stage rows in the panel remain informational.
- Use a 22rem panel at the large breakpoint and stack it below the stage content below that breakpoint.
- Preserve all unrelated working-tree edits. `src/components/tasks/task-workspace.tsx`, `src/components/tasks/__tests__/task-components.test.tsx`, and `src/components/tasks/__tests__/task-workspace.test.tsx` are already modified; stage only feature-specific hunks from those three files or leave them unstaged if isolation is unsafe.
- Follow `docs/guides/DESIGN_GUIDELINE.md` and update documentation only under `docs/`.

---

### Task 1: Define the resource contract and share generated-document filename logic

**Files:**
- Create: `src/lib/generated-document-filename.ts`
- Create: `__tests__/lib/generated-document-filename.test.ts`
- Modify: `src/services/document-export.service.ts`
- Modify: `src/services/tasks/types.ts`

**Interfaces:**
- Produces: `generatedDocumentPdfFileName(title: string, date?: Date): string`
- Produces: `TaskResourcesResponse`, `TaskResourceStage`, and the `TaskResource` discriminated union
- Consumes: existing `TaskStatus`, `TaskStageStatus`, and `StageActionBlocker` task types

- [ ] **Step 1: Write the failing filename-helper test**

Create `__tests__/lib/generated-document-filename.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generatedDocumentPdfFileName } from '@/lib/generated-document-filename';

describe('generatedDocumentPdfFileName', () => {
  it('uses the same safe title and UTC date format as generated-document PDF exports', () => {
    expect(generatedDocumentPdfFileName(
      'Board Resolution / FY 2026',
      new Date('2026-08-29T01:00:00.000Z'),
    )).toBe('board-resolution-fy-2026-2026-08-29.pdf');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd run test:run -- __tests__/lib/generated-document-filename.test.ts --reporter=dot
```

Expected: FAIL because `src/lib/generated-document-filename.ts` does not exist.

- [ ] **Step 3: Implement and adopt the shared filename helper**

Create `src/lib/generated-document-filename.ts`:

```ts
export function generatedDocumentPdfFileName(
  title: string,
  date: Date = new Date(),
): string {
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  const dateStamp = date.toISOString().split('T')[0];
  return `${safeTitle}-${dateStamp}.pdf`;
}
```

In `src/services/document-export.service.ts`, import the helper, replace the default PDF filename expression with:

```ts
const exportFilename = filename || generatedDocumentPdfFileName(document.title);
```

Remove the now-unused private `generateFilename` function.

- [ ] **Step 4: Add the exact task-resource types**

Append these contracts to `src/services/tasks/types.ts`:

```ts
export type TaskResourceState = 'available' | 'pending' | 'unavailable';

interface TaskResourceBase {
  id: string | null;
  state: TaskResourceState;
  label: string;
  reason: string | null;
}

export interface TaskCompanyResource extends TaskResourceBase {
  kind: 'company';
  name: string | null;
  uen: string | null;
  href: string | null;
}

export interface TaskGeneratedDocumentResource extends TaskResourceBase {
  kind: 'generatedDocument';
  title: string | null;
  status: string | null;
  downloadFileName: string | null;
  href: string | null;
  pdfHref: string | null;
}

export interface TaskEsigningDocumentResource {
  id: string;
  fileName: string;
  originalPdfHref: string;
  signedPdfHref: string | null;
}

export type TaskSignerLinkState = 'available' | 'waiting' | 'finished';

export interface TaskEsigningSignerResource {
  id: string;
  name: string;
  email: string;
  status: string;
  signingOrder: number | null;
  linkState: TaskSignerLinkState;
}

export interface TaskEsigningEnvelopeResource extends TaskResourceBase {
  kind: 'esigningEnvelope';
  title: string | null;
  status: string | null;
  pdfGenerationStatus: string | null;
  expiresAt: string | null;
  completedSignatures: number;
  requiredSignatures: number;
  href: string | null;
  canGenerateSignerLink: boolean;
  documents: TaskEsigningDocumentResource[];
  signers: TaskEsigningSignerResource[];
}

export type TaskResource =
  | TaskCompanyResource
  | TaskGeneratedDocumentResource
  | TaskEsigningEnvelopeResource;

export interface TaskResourceStage {
  id: string;
  name: string;
  position: number;
  actionType: TaskStageActionType;
  status: TaskStageStatus;
  description: string | null;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  assignee: { id: string; name: string; email: string } | null;
  checklist: Array<{ id: string; label: string; isCompleted: boolean }>;
  blockers: StageActionBlocker[];
  resources: TaskResource[];
}

export interface TaskResourcesResponse {
  task: {
    id: string;
    title: string;
    status: TaskStatus;
    dueDate: string | null;
    company: { id: string; name: string; uen: string; href: string } | null;
    owner: { id: string; name: string; email: string } | null;
    pipelineName: string;
  };
  stages: TaskResourceStage[];
  hasPendingResources: boolean;
}
```

- [ ] **Step 5: Run helper tests and type checking**

Run:

```powershell
npm.cmd run test:run -- __tests__/lib/generated-document-filename.test.ts --reporter=dot
npx.cmd tsc --noEmit
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit the isolated contract/helper change**

Run `git diff --check` and inspect the four paths. Stage only these paths if they contain no unrelated edits:

```powershell
git add -- src/lib/generated-document-filename.ts __tests__/lib/generated-document-filename.test.ts src/services/document-export.service.ts src/services/tasks/types.ts
git commit -m "feat(tasks): define task resource contracts"
```

---

### Task 2: Build the tenant-scoped task resources projection service

**Files:**
- Create: `src/services/tasks/resources.service.ts`
- Create: `__tests__/services/task-resources.service.test.ts`
- Modify: `src/services/tasks/index.ts`

**Interfaces:**
- Consumes: `generatedDocumentPdfFileName`, `getStageActionAdapter`, `resolveEsigningActorScope`, `canReadEnvelope`, `hasPermission`, and `canAccessCompany`
- Produces: `getTaskResources(session: SessionUser, tenantId: string, taskId: string): Promise<TaskResourcesResponse>`

- [ ] **Step 1: Write failing service tests for complete, pending, inaccessible, and missing resources**

Create `__tests__/services/task-resources.service.test.ts` with hoisted mocks for Prisma, RBAC, company access, and e-signing scope. The complete-resource fixture must include:

```ts
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-29T08:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});
```

```ts
const completeTask = {
  id: 'task-1',
  title: 'Client onboarding',
  status: 'IN_PROGRESS',
  dueDate: new Date('2026-09-30T00:00:00.000Z'),
  company: { id: 'company-1', name: 'Oak Pte. Ltd.', uen: '202600001A' },
  owner: { id: 'user-2', firstName: 'Ava', lastName: 'Tan', email: 'ava@example.com' },
  pipelineVersion: { pipeline: { name: 'Client onboarding' } },
  stages: [
    {
      id: 'stage-company',
      name: 'Company profile',
      position: 0,
      actionType: 'COMPANY_PROFILE',
      actionConfig: {},
      status: 'COMPLETED',
      description: null,
      notes: 'Company verified',
      startedAt: new Date('2026-08-28T01:00:00.000Z'),
      completedAt: new Date('2026-08-28T02:00:00.000Z'),
      assignee: null,
      checklistItems: [],
      outcome: { type: 'COMPANY', companyId: 'company-1', company: { id: 'company-1', name: 'Oak Pte. Ltd.', uen: '202600001A', deletedAt: null } },
      esigningPreparation: null,
    },
    {
      id: 'stage-document',
      name: 'Generate agreement',
      position: 1,
      actionType: 'DOCUMENT_GENERATION',
      actionConfig: {},
      status: 'COMPLETED',
      description: null,
      notes: null,
      startedAt: null,
      completedAt: new Date('2026-08-29T02:00:00.000Z'),
      assignee: null,
      checklistItems: [],
      outcome: { type: 'GENERATED_DOCUMENT', generatedDocumentId: 'doc-1', generatedDocument: { id: 'doc-1', title: 'Service Agreement', status: 'FINALIZED', companyId: 'company-1', deletedAt: null } },
      esigningPreparation: null,
    },
    {
      id: 'stage-sign',
      name: 'Obtain signatures',
      position: 2,
      actionType: 'ESIGNING',
      actionConfig: {},
      status: 'IN_PROGRESS',
      description: null,
      notes: null,
      startedAt: new Date('2026-08-29T03:00:00.000Z'),
      completedAt: null,
      assignee: null,
      checklistItems: [],
      outcome: {
        type: 'ESIGNING_ENVELOPE',
        esigningEnvelopeId: 'envelope-1',
        esigningEnvelope: {
          id: 'envelope-1',
          title: 'Service Agreement',
          status: 'IN_PROGRESS',
          pdfGenerationStatus: 'COMPLETED',
          expiresAt: new Date('2026-09-15T00:00:00.000Z'),
          companyId: 'company-1',
          createdById: 'user-1',
          deletedAt: null,
          documents: [{ id: 'esign-doc-1', fileName: 'service-agreement.pdf', signedStoragePath: null, sortOrder: 0 }],
          recipients: [{ id: 'recipient-1', type: 'SIGNER', name: 'Alex Lim', email: 'alex@example.com', status: 'NOTIFIED', signingOrder: 1 }],
        },
      },
      esigningPreparation: { status: 'READY', lastError: null },
    },
  ],
};
```

Assert the service:

```ts
expect(result.task.company).toEqual({
  id: 'company-1',
  name: 'Oak Pte. Ltd.',
  uen: '202600001A',
  href: '/companies/company-1',
});
expect(result.stages.map((stage) => stage.id)).toEqual([
  'stage-company',
  'stage-document',
  'stage-sign',
]);
expect(result.stages[1].resources[0]).toMatchObject({
  kind: 'generatedDocument',
  state: 'available',
  href: expect.stringContaining('/generated-documents/doc-1?taskId=task-1'),
  pdfHref: '/api/generated-documents/doc-1/export/pdf',
  downloadFileName: 'service-agreement-2026-08-29.pdf',
});
expect(result.stages[2].resources[0]).toMatchObject({
  kind: 'esigningEnvelope',
  state: 'available',
  pdfGenerationStatus: 'COMPLETED',
  canGenerateSignerLink: true,
  documents: [{
    id: 'esign-doc-1',
    fileName: 'service-agreement.pdf',
    originalPdfHref: '/api/esigning/envelopes/envelope-1/documents/esign-doc-1/pdf',
    signedPdfHref: null,
  }],
  signers: [{ linkState: 'available' }],
});
expect(result.hasPendingResources).toBe(true);
```

Add separate cases asserting:

```ts
expect(pendingResult.hasPendingResources).toBe(true);
expect(pendingResult.stages[0].resources[0]).toMatchObject({
  state: 'pending',
  reason: 'This resource will appear when the stage creates or links it.',
});
expect(forbiddenResult.stages[0].resources[0]).toMatchObject({
  state: 'unavailable',
  id: null,
  href: null,
  reason: 'You do not have permission to view this resource.',
});
expect(missingResult.stages[0].resources[0]).toMatchObject({
  state: 'unavailable',
  reason: 'The linked resource is no longer available.',
});
expect(terminalResult.hasPendingResources).toBe(false);
expect(readOnlyOwnerResult.stages[0].resources[0]).toMatchObject({
  kind: 'esigningEnvelope',
  state: 'available',
  canGenerateSignerLink: false,
});
```

Build `terminalResult` from finalized generated documents plus envelopes in `COMPLETED`, `VOIDED`, `DECLINED`, or `EXPIRED` status with non-pending PDF generation. This guards the polling stop condition. Build `readOnlyOwnerResult` with an envelope created by the current user but an actor scope whose `canUpdateAny` is false; ownership must not bypass the route’s update permission.

- [ ] **Step 2: Run the service tests and verify RED**

Run:

```powershell
npm.cmd run test:run -- __tests__/services/task-resources.service.test.ts --reporter=dot
```

Expected: FAIL because `getTaskResources` is not implemented.

- [ ] **Step 3: Implement the resource projection query and serializers**

In `src/services/tasks/resources.service.ts`, define one task query ordered by stage position. Select only the fields represented by the public contract, plus `actionConfig`, outcome ownership/access fields, `deletedAt`, e-sign preparation status, e-signing documents, and signer recipients.

Use these exact helper boundaries:

```ts
function taskResourceHref(path: string, taskId: string, stageId: string): string {
  const params = new URLSearchParams({
    taskId,
    taskStageId: stageId,
    returnTo: '/tasks',
  });
  return `${path}${path.includes('?') ? '&' : '?'}${params}`;
}

function signerLinkState(status: string): TaskSignerLinkState {
  if (status === 'NOTIFIED' || status === 'VIEWED') return 'available';
  if (status === 'SIGNED' || status === 'DECLINED') return 'finished';
  return 'waiting';
}

function pendingReason(): string {
  return 'This resource will appear when the stage creates or links it.';
}

function missingReason(): string {
  return 'The linked resource is no longer available.';
}

function forbiddenReason(): string {
  return 'You do not have permission to view this resource.';
}

function isLiveResource(resource: TaskResource): boolean {
  if (resource.state === 'pending') return true;
  if (resource.state !== 'available') return false;
  if (resource.kind === 'generatedDocument') {
    return resource.status === 'DRAFT';
  }
  if (resource.kind === 'esigningEnvelope') {
    return (
      resource.status === 'DRAFT'
      || resource.status === 'SENT'
      || resource.status === 'IN_PROGRESS'
      || resource.pdfGenerationStatus === 'PENDING'
      || resource.pdfGenerationStatus === 'PROCESSING'
    );
  }
  return false;
}

function safeStageBlockers(stage: StageActionRecord): StageActionBlocker[] {
  try {
    return getStageActionAdapter(stage.actionType).blockers({
      tenantId: stage.tenantId,
      stage,
    });
  } catch {
    return [{
      code: 'STAGE_CONFIGURATION_UNAVAILABLE',
      message: 'Stage configuration is unavailable.',
    }];
  }
}
```

The exported service must have this signature and terminal calculation:

```ts
export async function getTaskResources(
  session: SessionUser,
  tenantId: string,
  taskId: string,
): Promise<TaskResourcesResponse> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, tenantId, deletedAt: null },
    select: taskResourcesSelect,
  });
  if (!task) throw new NotFoundError('Task not found');

  const esigningScope = await resolveEsigningActorScope(session, tenantId)
    .catch(() => null);
  const stages = await Promise.all(task.stages.map((stage) => (
    serializeResourceStage({ session, tenantId, task, stage, esigningScope })
  )));

  return {
    task: serializeTaskSummary(task),
    stages,
    hasPendingResources: stages.some((stage) => (
      stage.resources.some(isLiveResource)
    )),
  };
}
```

Apply these projection rules in `serializeResourceStage`:

- `MANUAL` returns no resources.
- `COMPANY_PROFILE` returns the outcome company or task company. A missing company is pending unless the stage is `FAILED`, `SKIPPED`, or `COMPLETED`, in which case it is unavailable.
- `DOCUMENT_GENERATION` returns the linked generated document only when `hasPermission(session.id, 'document', 'read', companyId)` and `canAccessCompany` allow it. Deleted links are unavailable; absent links are pending unless terminal.
- `ESIGNING` returns preparation status as a pending/unavailable explanation until an envelope exists. Read access requires `scope.canReadAll`, `canReadEnvelope(scope, session, createdById)`, and company access, matching the existing route-plus-service checks. Signer-link capability requires `scope.canUpdateAny`, matching the existing manual-link route’s `esigning:update` permission; envelope ownership by itself must not enable the button.
- Original e-signing PDF links are always returned for readable envelope documents. Signed PDF links are returned only when `signedStoragePath` is non-null.
- Select and return `pdfGenerationStatus`. Active envelope statuses and `PENDING`/`PROCESSING` PDF generation keep `hasPendingResources` true so signer statuses and signed PDF links refresh without a page reload.
- Signer link state comes only from signer/envelope status. `canGenerateSignerLink` is actor capability; the UI requires both capability and `linkState === 'available'`.
- Blockers are calculated through `safeStageBlockers`; malformed snapshot configuration becomes a stage-local blocker and must not fail the aggregate. Do not call `getTaskStageDetail` from this read service.
- Never return `lastError`, storage paths, recipient access hashes, session versions, or signing tokens.

Export the service from `src/services/tasks/index.ts`:

```ts
export * from './resources.service';
```

- [ ] **Step 4: Run service tests and related task security tests**

Run:

```powershell
npm.cmd run test:run -- __tests__/services/task-resources.service.test.ts __tests__/services/task-access.test.ts __tests__/services/task-final-review-regressions.test.ts --reporter=dot
```

Expected: PASS. The task resources suite proves tenant scoping and that inaccessible resources are redacted without failing the aggregate.

- [ ] **Step 5: Commit the service**

Run:

```powershell
git diff --check -- src/services/tasks/resources.service.ts src/services/tasks/index.ts __tests__/services/task-resources.service.test.ts
git add -- src/services/tasks/resources.service.ts src/services/tasks/index.ts __tests__/services/task-resources.service.test.ts
git commit -m "feat(tasks): aggregate linked task resources"
```

---

### Task 3: Expose the authenticated task resources endpoint

**Files:**
- Create: `src/app/api/tasks/[taskId]/resources/route.ts`
- Modify: `__tests__/api/tasks-api.test.ts`

**Interfaces:**
- Consumes: `getTaskResources(session, tenantId, taskId)` and `requireTaskAccess(session, tenantId, taskId, 'read')`
- Produces: `GET /api/tasks/:taskId/resources`

- [ ] **Step 1: Write the failing API route test**

Extend the `@/services/tasks` mock with `getTaskResources: vi.fn()`, import the new route, and add:

```ts
it('returns task resources from the authenticated workspace after task access', async () => {
  vi.mocked(getTaskResources).mockResolvedValue({
    task: { id: taskId },
    stages: [],
    hasPendingResources: false,
  } as never);

  const response = await getTaskResourcesRoute(
    request(`http://localhost/api/tasks/${taskId}/resources?tenantId=${otherWorkspaceId}`),
    routeParams({ taskId }),
  );

  expect(response.status).toBe(200);
  expect(requireTaskAccess).toHaveBeenCalledWith(session, workspaceId, taskId, 'read');
  expect(getTaskResources).toHaveBeenCalledWith(session, workspaceId, taskId);
});
```

Import `requireTaskAccess` from its mocked module so the access assertion is explicit.

- [ ] **Step 2: Run the API test and verify RED**

Run:

```powershell
npm.cmd run test:run -- __tests__/api/tasks-api.test.ts --reporter=dot
```

Expected: FAIL because the resources route does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/tasks/[taskId]/resources/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { taskRouteParamsSchema } from '@/lib/validations/task-api';
import { getTaskResources } from '@/services/tasks';
import { requireTaskAccess } from '@/services/tasks/access';

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { taskId } = await params;
    const { id } = taskRouteParamsSchema.parse({ id: taskId });
    const tenantId = requireSessionWorkspaceId(session);
    await requireTaskAccess(session, tenantId, id, 'read');
    return NextResponse.json(await getTaskResources(session, tenantId, id));
  } catch (error) {
    return createErrorResponse(error);
  }
}
```

- [ ] **Step 4: Run API and route-segment tests**

Run:

```powershell
npm.cmd run test:run -- __tests__/api/tasks-api.test.ts src/app/api/tasks/__tests__/route-segments.test.ts --reporter=dot
```

Expected: PASS with the resources route using the session workspace rather than query input.

- [ ] **Step 5: Commit the route**

Because `__tests__/api/tasks-api.test.ts` may contain unrelated edits, inspect and stage only the resources-route hunk if necessary:

```powershell
git diff --check -- src/app/api/tasks/[taskId]/resources/route.ts __tests__/api/tasks-api.test.ts
git add -- src/app/api/tasks/[taskId]/resources/route.ts
git add -p -- __tests__/api/tasks-api.test.ts
git commit -m "feat(tasks): expose task resources endpoint"
```

---

### Task 4: Add live task-resource querying and mutation invalidation

**Files:**
- Create: `src/hooks/use-task-resources.ts`
- Create: `__tests__/hooks/task-resources-hook.test.tsx`
- Modify: `src/hooks/use-tasks.ts`
- Modify: `__tests__/hooks/task-hooks.test.tsx`

**Interfaces:**
- Produces: `useTaskResources(taskId: string, isModalOpen: boolean)`
- Produces: `taskKeys.resources(taskId: string)`
- Consumes: `TaskResourcesResponse`

- [ ] **Step 1: Write failing hook tests for enablement and polling**

Create `__tests__/hooks/task-resources-hook.test.tsx` using the existing QueryClient harness pattern. Add:

```ts
it('fetches only while the modal is open', async () => {
  vi.mocked(fetch).mockResolvedValue(jsonResponse({
    task: { id: 'task-1' },
    stages: [],
    hasPendingResources: false,
  }));
  const { wrapper } = createHarness();

  const { rerender } = renderHook(
    ({ open }) => useTaskResources('task-1', open),
    { wrapper, initialProps: { open: false } },
  );
  expect(fetch).not.toHaveBeenCalled();

  rerender({ open: true });
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/tasks/task-1/resources'));
});

it('polls pending resources every ten seconds and stops after they become terminal', async () => {
  vi.useFakeTimers();
  vi.mocked(fetch)
    .mockResolvedValueOnce(jsonResponse({ task: { id: 'task-1' }, stages: [], hasPendingResources: true }))
    .mockResolvedValueOnce(jsonResponse({ task: { id: 'task-1' }, stages: [], hasPendingResources: false }));
  const { wrapper } = createHarness();
  renderHook(() => useTaskResources('task-1', true), { wrapper });

  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(10_000);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Add failing invalidation assertions to existing mutation tests**

Add `taskKeys.resources('task-1')` expectations after task metadata updates, stage metadata updates, transitions, and e-sign preparation mutations:

```ts
expect(invalidate).toHaveBeenCalledWith({
  queryKey: taskKeys.resources('task-1'),
});
```

- [ ] **Step 3: Run hook tests and verify RED**

Run:

```powershell
npm.cmd run test:run -- __tests__/hooks/task-resources-hook.test.tsx __tests__/hooks/task-hooks.test.tsx --reporter=dot
```

Expected: FAIL because the resources key/hook and invalidations do not exist.

- [ ] **Step 4: Implement the resources hook and invalidations**

Add to `taskKeys` in `src/hooks/use-tasks.ts`:

```ts
resources: (taskId: string) => (
  [...taskKeys.detail(taskId), 'resources'] as const
),
```

Create `src/hooks/use-task-resources.ts`:

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { taskKeys } from '@/hooks/use-tasks';
import type { TaskResourcesResponse } from '@/services/tasks/types';

async function fetchTaskResources(taskId: string): Promise<TaskResourcesResponse> {
  const response = await fetch(`/api/tasks/${taskId}/resources`);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'Task resources request failed');
  }
  return response.json() as Promise<TaskResourcesResponse>;
}

export function useTaskResources(taskId: string, isModalOpen: boolean) {
  return useQuery({
    queryKey: taskKeys.resources(taskId),
    queryFn: () => fetchTaskResources(taskId),
    enabled: Boolean(taskId && isModalOpen),
    staleTime: 15_000,
    refetchInterval: (query) => (
      query.state.status !== 'error' && query.state.data?.hasPendingResources
        ? 10_000
        : false
    ),
  });
}
```

Invalidate `taskKeys.resources(taskId)` in the success handlers of `useUpdateTask`, `useUpdateTaskStage`, `useTaskStageTransition`, `useEnsureTaskEsigningPreparation`, and `useRetryTaskEsigningPreparation`. Include the resources invalidation in each existing `Promise.all` rather than starting unawaited work.

- [ ] **Step 5: Run hook tests**

Run:

```powershell
npm.cmd run test:run -- __tests__/hooks/task-resources-hook.test.tsx __tests__/hooks/task-hooks.test.tsx --reporter=dot
```

Expected: PASS with exactly one 10-second refetch while the fixture changes from pending to terminal.

- [ ] **Step 6: Commit the query layer**

The hook and hook-test files are clean at planning time, so stage the four exact paths and inspect the cached diff before committing:

```powershell
git add -- src/hooks/use-task-resources.ts __tests__/hooks/task-resources-hook.test.tsx src/hooks/use-tasks.ts __tests__/hooks/task-hooks.test.tsx
git diff --cached --check
git commit -m "feat(tasks): query live task resources"
```

---

### Task 5: Build the standalone task resources panel

**Files:**
- Create: `src/components/tasks/task-resources-panel.tsx`
- Create: `src/components/tasks/__tests__/task-resources-panel.test.tsx`

**Interfaces:**
- Consumes: `TaskResourcesResponse`, active stage ID, loading/error states, retry callback
- Consumes: `useEsigningRecipientManualLink(envelopeId, recipientId)` and `copyTextToClipboard`
- Produces: `TaskResourcesPanel`

- [ ] **Step 1: Write failing panel rendering tests**

Mock `useEsigningRecipientManualLink` and `copyTextToClipboard`. Render a response with three stages and assert:

```ts
expect(screen.getByRole('heading', { name: 'Task resources' })).toBeVisible();
expect(screen.getByRole('link', { name: 'Oak Pte. Ltd.' })).toHaveAttribute('href', '/companies/company-1');
expect(screen.getByText('UEN 202600001A')).toBeVisible();
expect(screen.getByRole('link', { name: 'Service Agreement' })).toHaveAttribute(
  'href',
  expect.stringContaining('/generated-documents/doc-1'),
);
expect(screen.getByRole('link', { name: 'service-agreement.pdf' })).toHaveAttribute(
  'href',
  '/api/esigning/envelopes/envelope-1/documents/esign-doc-1/pdf',
);
expect(screen.getByText('Alex Lim')).toBeVisible();
expect(screen.getByTestId('task-resource-stage-stage-sign')).toHaveAttribute('data-active', 'true');
```

Add loading, aggregate-error/retry, pending, unavailable, and empty-manual-stage cases.

Also render an envelope with `pdfGenerationStatus: 'PROCESSING'` and assert the card says “Signed PDFs are processing”. When the status is `COMPLETED`, assert that message disappears and the signed PDF link is shown when `signedPdfHref` is non-null.

- [ ] **Step 2: Write the failing signer-link interaction test**

Configure the mocked mutation to return a signing URL and assert local behavior:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Get signing link for Alex Lim' }));

await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
expect(copyTextToClipboard).toHaveBeenCalledWith('https://app.example.com/sign/token');
expect(screen.getByRole('link', { name: 'Open signing link for Alex Lim' })).toHaveAttribute(
  'href',
  'https://app.example.com/sign/token',
);
expect(screen.queryByText('https://app.example.com/sign/token')).not.toBeInTheDocument();
```

The final assertion prevents raw signer URLs from being printed into the panel even after generation.

- [ ] **Step 3: Run panel tests and verify RED**

Run:

```powershell
npm.cmd run test:run -- src/components/tasks/__tests__/task-resources-panel.test.tsx --reporter=dot
```

Expected: FAIL because `TaskResourcesPanel` does not exist.

- [ ] **Step 4: Implement the panel and signer row**

Use this public component boundary:

```ts
interface TaskResourcesPanelProps {
  data?: TaskResourcesResponse;
  activeStageId?: string;
  isLoading: boolean;
  error?: Error | null;
  onRetry: () => void;
}

export function TaskResourcesPanel(props: TaskResourcesPanelProps) {
  const { data, activeStageId, isLoading, error, onRetry } = props;
  if (isLoading) {
    return <section data-testid="task-resources-panel" aria-busy="true">Loading task resources…</section>;
  }
  if (error) {
    return (
      <section data-testid="task-resources-panel">
        <p role="alert">{error.message}</p>
        <button type="button" onClick={onRetry}>Retry</button>
      </section>
    );
  }
  if (!data) {
    return <section data-testid="task-resources-panel">No task resources available.</section>;
  }
  return (
    <section data-testid="task-resources-panel">
      <h2>Task resources</h2>
      <TaskResourceSummary task={data.task} />
      {data.stages.map((stage) => (
        <TaskResourceStageSection
          key={stage.id}
          stage={stage}
          isActive={stage.id === activeStageId}
        />
      ))}
    </section>
  );
}
```

Define `TaskResourceSummary`, `TaskResourceStageSection`, and `TaskResourceCard` as private components in the same file. Their exact inputs are `TaskResourcesResponse['task']`, `TaskResourceStage` plus `isActive`, and `TaskResource` respectively. `TaskResourceCard` uses the `kind` discriminator and delegates each signer to `TaskSignerResourceRow`.

Implement a child component so each signer can legally own its mutation hook:

```ts
function TaskSignerResourceRow({
  envelopeId,
  canGenerateSignerLink,
  signer,
}: {
  envelopeId: string;
  canGenerateSignerLink: boolean;
  signer: TaskEsigningSignerResource;
}) {
  const manualLink = useEsigningRecipientManualLink(envelopeId, signer.id);
  const [signingUrl, setSigningUrl] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const requestLink = async () => {
    setCopyError(null);
    try {
      const result = await manualLink.mutateAsync();
      setSigningUrl(result.signingUrl);
      const copied = await copyTextToClipboard(result.signingUrl);
      if (!copied) setCopyError('Signing link created, but it could not be copied.');
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : 'Could not create the signing link.');
    }
  };

  const canRequest = canGenerateSignerLink && signer.linkState === 'available';
  return (
    <div>
      <div>{signer.name}</div>
      <div>{signer.email}</div>
      <div>{signer.status}</div>
      {canRequest ? (
        <button
          type="button"
          onClick={() => void requestLink()}
          disabled={manualLink.isPending}
          aria-label={`Get signing link for ${signer.name}`}
        >
          Get signing link
        </button>
      ) : null}
      {signingUrl ? (
        <a
          href={signingUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open signing link for ${signer.name}`}
        >
          Open signing link
        </a>
      ) : null}
      {copyError ? <p role="alert">{copyError}</p> : null}
    </div>
  );
}
```

The signer row must also:

- Show signer name, email, and status.
- Show “Get signing link” only when `canRequest` is true.
- Show a non-sensitive explanation for `waiting`, `finished`, or forbidden states.
- Show an “Open signing link” anchor after success without rendering the URL text.
- Keep signer errors inside that signer row.

All company, document, envelope, and PDF anchors use `target="_blank"` and `rel="noreferrer"`. Use discriminated `resource.kind` branches; do not use unsafe casts.

- [ ] **Step 5: Run panel tests and accessibility assertions**

Run:

```powershell
npm.cmd run test:run -- src/components/tasks/__tests__/task-resources-panel.test.tsx --reporter=dot
```

Expected: PASS. Verify every icon-only action has an accessible label and unavailable cards contain no linked entity ID or href.

- [ ] **Step 6: Commit the standalone panel**

Run:

```powershell
git diff --check -- src/components/tasks/task-resources-panel.tsx src/components/tasks/__tests__/task-resources-panel.test.tsx
git add -- src/components/tasks/task-resources-panel.tsx src/components/tasks/__tests__/task-resources-panel.test.tsx
git commit -m "feat(tasks): render task resources panel"
```

---

### Task 6: Integrate the panel into the stage modal and task workspace

**Files:**
- Modify: `src/components/tasks/task-stage-modal-layout.tsx`
- Modify: `src/components/tasks/task-stage-modal.tsx`
- Modify: `src/components/tasks/task-workspace.tsx`
- Modify: `src/components/tasks/__tests__/task-components.test.tsx`
- Modify: `src/components/tasks/__tests__/task-workspace.test.tsx`

**Interfaces:**
- Consumes: `useTaskResources(taskId, isModalOpen)`
- Extends: `PipelineStageModalFrame` with `aside?: ReactNode`
- Extends: `TaskStageModalProps` with resource data/loading/error/retry props

- [ ] **Step 1: Write failing modal layout and workspace integration tests**

In the stage-modal tests, pass a resources fixture and assert:

```ts
expect(screen.getByTestId('pipeline-stage-modal-main')).toBeVisible();
expect(screen.getByTestId('task-resources-panel')).toBeVisible();
expect(screen.getAllByTestId(/task-resource-stage-/)).toHaveLength(3);
expect(screen.getByTestId('pipeline-stage-modal-footer')).toBeVisible();
```

In the workspace tests, mock `useTaskResources` and assert it receives the selected task ID only after a stage is selected:

```ts
expect(useTaskResources).toHaveBeenLastCalledWith('task-1', true);
expect(screen.getByText('UEN 202600001A')).toBeVisible();
```

Add an assertion that a resources error appears inside the panel while the existing stage form and primary action remain visible.

- [ ] **Step 2: Run the component tests and verify RED**

Run:

```powershell
npm.cmd run test:run -- src/components/tasks/__tests__/task-components.test.tsx src/components/tasks/__tests__/task-workspace.test.tsx --reporter=dot
```

Expected: FAIL because the modal has no aside contract and the workspace does not load resources.

- [ ] **Step 3: Add the responsive modal frame slot**

Extend `PipelineStageModalFrameProps`:

```ts
interface PipelineStageModalFrameProps {
  isOpen: boolean;
  stage?: TaskStageDetail | null;
  onClose: () => void;
  isMutating: boolean;
  children: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
}
```

Replace the body content with:

```tsx
<ModalBody
  data-testid="pipeline-stage-modal-body"
  className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
>
  <div data-testid="pipeline-stage-modal-main" className="min-w-0 space-y-4">
    {children}
  </div>
  {aside ? (
    <aside
      className="max-h-[50dvh] min-w-0 overflow-y-auto border-t border-border-primary pt-4 lg:max-h-[calc(100dvh-12rem)] lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0"
      aria-label="Task resources"
    >
      {aside}
    </aside>
  ) : null}
</ModalBody>
```

Keep the existing modal header, status accent, footer, and mutation close guards unchanged.

- [ ] **Step 4: Pass resource state through `TaskStageModal`**

Add these props:

```ts
resources?: TaskResourcesResponse;
isResourcesLoading?: boolean;
resourcesError?: Error | null;
onRetryResources?: () => void;
```

Pass this slot to `PipelineStageModalFrame`:

```tsx
aside={(
  <TaskResourcesPanel
    data={resources}
    activeStageId={stage?.id}
    isLoading={isResourcesLoading ?? false}
    error={resourcesError}
    onRetry={onRetryResources ?? (() => undefined)}
  />
)}
```

Do not merge `resourcesError` into the existing stage `error` prop.

- [ ] **Step 5: Load resources in `TaskWorkspace` and invalidate after BizFile upload**

Add:

```ts
const queryClient = useQueryClient();
const resourcesQuery = useTaskResources(
  selectedStage?.task.id ?? '',
  Boolean(selectedStage),
);
```

Pass the query state to the modal:

```tsx
resources={resourcesQuery.data}
isResourcesLoading={resourcesQuery.isLoading}
resourcesError={resourcesQuery.error}
onRetryResources={() => void resourcesQuery.refetch()}
```

After a successful BizFile upload and before navigation, invalidate the selected task’s resources:

```ts
await queryClient.invalidateQueries({
  queryKey: taskKeys.resources(selectedStage.task.id),
});
```

The task mutations already invalidate this key through Task 4. Closing the modal disables polling but retains the cache for the next open.

- [ ] **Step 6: Run all task component/hook tests**

Run:

```powershell
npm.cmd run test:run -- src/components/tasks/__tests__/task-resources-panel.test.tsx src/components/tasks/__tests__/task-components.test.tsx src/components/tasks/__tests__/task-workspace.test.tsx __tests__/hooks/task-resources-hook.test.tsx __tests__/hooks/task-hooks.test.tsx --reporter=dot
```

Expected: PASS, including existing stage completion/next-stage behavior and pipeline name rendering.

- [ ] **Step 7: Commit only feature-specific integration hunks**

The modal layout and modal component are clean at planning time and can be staged directly. The workspace and two existing test files overlap user work; inspect them, use hunk staging for those three paths, and skip the commit if the feature cannot be separated safely:

```powershell
git diff --check -- src/components/tasks/task-stage-modal-layout.tsx src/components/tasks/task-stage-modal.tsx src/components/tasks/task-workspace.tsx src/components/tasks/__tests__/task-components.test.tsx src/components/tasks/__tests__/task-workspace.test.tsx
git add -- src/components/tasks/task-stage-modal-layout.tsx src/components/tasks/task-stage-modal.tsx
git add -p -- src/components/tasks/task-workspace.tsx src/components/tasks/__tests__/task-components.test.tsx src/components/tasks/__tests__/task-workspace.test.tsx
git diff --cached --check
git commit -m "feat(tasks): integrate task resources into stage modal"
```

---

### Task 7: Verify responsive behavior and complete regression coverage

**Files:**
- Create: `__tests__/browser/task-resources-panel.browser.test.tsx`

**Interfaces:**
- Consumes: completed `TaskStageModal` and `TaskResourcesResponse`
- Produces: browser-level desktop/phone layout regression coverage

- [ ] **Step 1: Write the browser layout test**

Render a stage modal with company/document resources and no active signer mutation. At 1440×900 assert the panel is to the right of the main content; at 390×844 assert it is below and the dialog does not overflow horizontally:

```ts
const dialog = screen.getByRole('dialog');
const main = screen.getByTestId('pipeline-stage-modal-main');
const panel = screen.getByTestId('task-resources-panel');

await page.viewport(1440, 900);
expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(
  main.getBoundingClientRect().right,
);

await page.viewport(390, 844);
expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(
  main.getBoundingClientRect().bottom,
);
expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
```

Also assert company, generated-document, and e-signing PDF anchors remain keyboard-focusable at both widths.

- [ ] **Step 2: Run the browser test**

Run:

```powershell
npm.cmd run test:browser -- __tests__/browser/task-resources-panel.browser.test.tsx --reporter=dot
```

Expected: PASS at desktop and phone viewports with no outer horizontal overflow.

- [ ] **Step 3: Run the focused server/client regression suite**

Run:

```powershell
npm.cmd run test:run -- __tests__/lib/generated-document-filename.test.ts __tests__/services/task-resources.service.test.ts __tests__/services/task-access.test.ts __tests__/api/tasks-api.test.ts __tests__/hooks/task-resources-hook.test.tsx __tests__/hooks/task-hooks.test.tsx src/components/tasks/__tests__/task-resources-panel.test.tsx src/components/tasks/__tests__/task-components.test.tsx src/components/tasks/__tests__/task-workspace.test.tsx --reporter=dot
```

Expected: every listed suite passes.

- [ ] **Step 4: Run static verification**

Run:

```powershell
npx.cmd tsc --noEmit
npx.cmd eslint src/lib/generated-document-filename.ts src/services/document-export.service.ts src/services/tasks/types.ts src/services/tasks/resources.service.ts src/services/tasks/index.ts src/app/api/tasks/[taskId]/resources/route.ts src/hooks/use-task-resources.ts src/hooks/use-tasks.ts src/components/tasks/task-resources-panel.tsx src/components/tasks/task-stage-modal-layout.tsx src/components/tasks/task-stage-modal.tsx src/components/tasks/task-workspace.tsx
```

Expected: both commands exit 0.

- [ ] **Step 5: Review the final diff against the specification**

Run:

```powershell
git diff --check
git status --short
```

Confirm all acceptance criteria in the spec have a passing test, raw signing URLs appear only in local post-action state, no storage paths/tokens are serialized, and no unrelated working-tree files were staged.

- [ ] **Step 6: Commit the browser regression test**

Run:

```powershell
git add -- __tests__/browser/task-resources-panel.browser.test.tsx
git commit -m "test(tasks): cover task resources modal layout"
```
