# Company Profile Metadata Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `Task.companyId` and every non-skipped Company Profile stage outcome synchronized through both task metadata edits and stage linking.

**Architecture:** Add one transaction-aware synchronization helper to the task stage service, beside the existing outcome and parent-status logic it reuses. Task metadata updates and Company Profile outcome linking will call that helper inside their existing Prisma transactions, making the task company, recovery context, stage outcome, stage status, and parent task status one atomic change.

**Tech Stack:** TypeScript, Next.js service layer, Prisma 7 transactions, Vitest 4

## Global Constraints

- `Task.companyId` is the authoritative linked company for the task.
- Every non-skipped `COMPANY_PROFILE` stage must have the same company as its linked outcome.
- Setting or replacing the company completes every non-skipped Company Profile stage.
- Clearing the company removes applicable outcomes and returns those stages to `NOT_STARTED`.
- Skipped Company Profile stages and their outcomes remain untouched.
- Metadata-only edits that omit `companyId` do not synchronize Company Profile stages.
- No API payload or UI changes are required.
- Preserve unrelated existing work in the dirty worktree.

## File Map

- Modify `src/services/tasks/stage.service.ts`: own the transaction-aware Company Profile synchronization helper and reuse it from stage outcome linking.
- Modify `src/services/tasks/task.service.ts`: invoke synchronization when `companyId` is included in a metadata update.
- Modify `__tests__/services/task-stage-registry.test.ts`: extend Prisma mocks and add service-level regression coverage for both entry points.

---

### Task 1: Synchronize metadata-selected companies with Company Profile stages

**Files:**
- Modify: `__tests__/services/task-stage-registry.test.ts`
- Modify: `src/services/tasks/stage.service.ts`
- Modify: `src/services/tasks/task.service.ts`

**Interfaces:**
- Consumes: `lockTaskForUpdate(tx, tenantId, taskId)`, `updateParentTaskStatus(tx, tenantId, taskId, currentStatus)`, and `auditStageMutation(tx, params)`.
- Produces:

```ts
export interface SynchronizeCompanyProfileStagesInput {
  tenantId: string;
  taskId: string;
  companyId: string | null;
  currentTaskStatus: TaskStatusValue;
  userId?: string;
}

export interface SynchronizeCompanyProfileStagesResult {
  taskStatus: TaskStatusValue;
  outcomesByStageId: Map<string, TaskStageOutcome>;
}

export async function synchronizeCompanyProfileStages(
  tx: Prisma.TransactionClient,
  input: SynchronizeCompanyProfileStagesInput,
): Promise<SynchronizeCompanyProfileStagesResult>
```

- [ ] **Step 1: Extend the transaction mocks for synchronization**

Add recovery-context and outcome deletion mocks to the hoisted mock object and transaction client in `__tests__/services/task-stage-registry.test.ts`:

```ts
const mocks = vi.hoisted(() => ({
  // existing mocks
  outcomeDeleteMany: vi.fn(),
  recoveryUpsert: vi.fn(),
  recoveryDeleteMany: vi.fn(),
}));

const tx = {
  // existing delegates
  taskStageOutcome: {
    upsert: mocks.outcomeUpsert,
    deleteMany: mocks.outcomeDeleteMany,
  },
  taskCompanyRecoveryContext: {
    upsert: mocks.recoveryUpsert,
    deleteMany: mocks.recoveryDeleteMany,
  },
};
```

- [ ] **Step 2: Write failing metadata synchronization tests**

Add a focused describe block after the existing task-metadata mutation test. Use valid UUIDs and return the public task record from the final `task.update` call:

```ts
describe('Company Profile metadata synchronization', () => {
  const companyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const companyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  beforeEach(() => {
    mocks.taskFindFirst.mockResolvedValue({
      id: 'task-1',
      tenantId: 'tenant-a',
      title: 'Company Profile',
      companyId: null,
      status: TaskStatus.NOT_STARTED,
      stages: [
        { status: TaskStageStatus.NOT_STARTED },
        { status: TaskStageStatus.SKIPPED },
      ],
    });
    mocks.rawQuery.mockResolvedValue([{
      id: 'task-1',
      tenantId: 'tenant-a',
      title: 'Company Profile',
      companyId: null,
      status: TaskStatus.NOT_STARTED,
    }]);
    mocks.companyFindFirst.mockResolvedValue({ id: companyA });
    mocks.stageFindMany
      .mockResolvedValueOnce([
        {
          id: 'profile-1',
          status: TaskStageStatus.NOT_STARTED,
          startedAt: null,
          completedAt: null,
          outcome: null,
        },
      ])
      .mockResolvedValueOnce([{ status: TaskStageStatus.COMPLETED }]);
    mocks.outcomeUpsert.mockResolvedValue({
      id: 'outcome-1',
      tenantId: 'tenant-a',
      taskStageId: 'profile-1',
      type: 'COMPANY',
      companyId: companyA,
      generatedDocumentId: null,
      esigningEnvelopeId: null,
    });
    mocks.recoveryUpsert.mockResolvedValue({ id: 'recovery-1' });
    mocks.taskUpdate.mockResolvedValue(publicTaskRecord({
      status: TaskStatus.COMPLETED,
      company: { id: companyA, name: 'Company A' },
      stages: [{
        id: 'profile-1',
        name: 'Company Profile',
        position: 0,
        actionType: 'COMPANY_PROFILE',
        icon: 'Building2',
        isRequired: true,
        status: TaskStageStatus.COMPLETED,
      }],
    }));
  });

  it('completes every non-skipped Company Profile stage when metadata selects a company', async () => {
    const result = await updateTaskMetadata(
      'tenant-a',
      'task-1',
      { companyId: companyA },
      'user-1',
    );

    expect(mocks.stageFindMany).toHaveBeenNthCalledWith(1, {
      where: {
        tenantId: 'tenant-a',
        taskId: 'task-1',
        actionType: TaskStageActionType.COMPANY_PROFILE,
        status: { not: TaskStageStatus.SKIPPED },
      },
      select: expect.objectContaining({
        id: true,
        status: true,
        outcome: { select: { companyId: true } },
      }),
    });
    expect(mocks.outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskStageId: 'profile-1' },
      update: expect.objectContaining({ companyId: companyA }),
    }));
    expect(mocks.recoveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId_taskStageId: {
          tenantId: 'tenant-a',
          taskStageId: 'profile-1',
        },
      },
      update: { companyId: companyA },
    }));
    expect(mocks.stageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'profile-1' },
      data: expect.objectContaining({
        status: TaskStageStatus.COMPLETED,
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
      }),
    }));
    expect(result.status).toBe(TaskStatus.COMPLETED);
  });

  it('replaces all applicable outcomes with a newly selected metadata company', async () => {
    mocks.companyFindFirst.mockResolvedValue({ id: companyB });
    mocks.stageFindMany
      .mockReset()
      .mockResolvedValueOnce([
        {
          id: 'profile-1',
          status: TaskStageStatus.COMPLETED,
          startedAt: new Date('2026-07-01T00:00:00.000Z'),
          completedAt: new Date('2026-07-01T00:00:00.000Z'),
          outcome: { companyId: companyA },
        },
        {
          id: 'profile-2',
          status: TaskStageStatus.NOT_STARTED,
          startedAt: null,
          completedAt: null,
          outcome: null,
        },
      ])
      .mockResolvedValueOnce([
        { status: TaskStageStatus.COMPLETED },
        { status: TaskStageStatus.COMPLETED },
      ]);

    await updateTaskMetadata(
      'tenant-a',
      'task-1',
      { companyId: companyB },
      'user-1',
    );

    expect(mocks.outcomeUpsert).toHaveBeenCalledTimes(2);
    for (const call of mocks.outcomeUpsert.mock.calls) {
      expect(call[0].update).toEqual(expect.objectContaining({ companyId: companyB }));
    }
  });

  it('clears outcomes and reopens non-skipped Company Profile stages when metadata unlinks the company', async () => {
    mocks.stageFindMany
      .mockReset()
      .mockResolvedValueOnce([{
        id: 'profile-1',
        status: TaskStageStatus.COMPLETED,
        startedAt: new Date('2026-07-01T00:00:00.000Z'),
        completedAt: new Date('2026-07-01T00:00:00.000Z'),
        outcome: { companyId: companyA },
      }])
      .mockResolvedValueOnce([{ status: TaskStageStatus.NOT_STARTED }]);
    mocks.taskUpdate.mockResolvedValue(publicTaskRecord());

    await updateTaskMetadata(
      'tenant-a',
      'task-1',
      { companyId: null },
      'user-1',
    );

    expect(mocks.outcomeDeleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', taskStageId: 'profile-1' },
    });
    expect(mocks.recoveryDeleteMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        taskId: 'task-1',
        taskStageId: 'profile-1',
      },
    });
    expect(mocks.stageUpdate).toHaveBeenCalledWith({
      where: { id: 'profile-1' },
      data: {
        status: TaskStageStatus.NOT_STARTED,
        completedAt: null,
      },
    });
  });

  it('does not inspect or mutate Company Profile stages for unrelated metadata', async () => {
    mocks.taskUpdate.mockResolvedValue(publicTaskRecord({ title: 'Renamed task' }));

    await updateTaskMetadata(
      'tenant-a',
      'task-1',
      { title: 'Renamed task' },
      'user-1',
    );

    expect(mocks.outcomeUpsert).not.toHaveBeenCalled();
    expect(mocks.outcomeDeleteMany).not.toHaveBeenCalled();
    expect(mocks.recoveryUpsert).not.toHaveBeenCalled();
    expect(mocks.stageUpdate).not.toHaveBeenCalled();
  });

  it('rejects the metadata update from the same transaction when stage synchronization fails', async () => {
    mocks.outcomeUpsert.mockRejectedValueOnce(new Error('outcome write failed'));

    await expect(updateTaskMetadata(
      'tenant-a',
      'task-1',
      { companyId: companyA },
      'user-1',
    )).rejects.toThrow('outcome write failed');

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
```

The first-stage query excludes skipped stages, which proves skipped stages remain untouched without separately mutating one in the fixture.

- [ ] **Step 3: Run the metadata tests and verify RED**

Run:

```powershell
npx.cmd vitest run __tests__/services/task-stage-registry.test.ts -t "Company Profile metadata synchronization"
```

Expected: FAIL because metadata updates do not call `taskStageOutcome.upsert`, `taskCompanyRecoveryContext.upsert`, or stage status updates.

- [ ] **Step 4: Implement the transaction-aware synchronization helper**

In `src/services/tasks/stage.service.ts`, import the generated `TaskStageOutcome` and `TaskStatus` types and add the exported interfaces and helper beside `updateParentTaskStatus`:

```ts
export interface SynchronizeCompanyProfileStagesInput {
  tenantId: string;
  taskId: string;
  companyId: string | null;
  currentTaskStatus: TaskStatusValue;
  userId?: string;
}

export interface SynchronizeCompanyProfileStagesResult {
  taskStatus: TaskStatusValue;
  outcomesByStageId: Map<string, TaskStageOutcome>;
}

export async function synchronizeCompanyProfileStages(
  tx: Prisma.TransactionClient,
  input: SynchronizeCompanyProfileStagesInput,
): Promise<SynchronizeCompanyProfileStagesResult> {
  const stages = await tx.taskStage.findMany({
    where: {
      tenantId: input.tenantId,
      taskId: input.taskId,
      actionType: TaskStageActionType.COMPANY_PROFILE,
      status: { not: TaskStageStatus.SKIPPED },
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      outcome: { select: { companyId: true } },
    },
  });
  const outcomesByStageId = new Map<string, TaskStageOutcome>();
  const now = new Date();

  for (const stage of stages) {
    if (input.companyId) {
      const changedCompany = stage.outcome?.companyId !== input.companyId;
      const newlyCompleted = stage.status !== TaskStageStatus.COMPLETED;
      const outcome = await tx.taskStageOutcome.upsert({
        where: { taskStageId: stage.id },
        create: {
          tenantId: input.tenantId,
          taskStageId: stage.id,
          type: TaskStageOutcomeType.COMPANY,
          companyId: input.companyId,
        },
        update: {
          type: TaskStageOutcomeType.COMPANY,
          companyId: input.companyId,
          generatedDocumentId: null,
          esigningEnvelopeId: null,
        },
      });
      outcomesByStageId.set(stage.id, outcome);
      await tx.taskCompanyRecoveryContext.upsert({
        where: {
          tenantId_taskStageId: {
            tenantId: input.tenantId,
            taskStageId: stage.id,
          },
        },
        create: {
          tenantId: input.tenantId,
          taskId: input.taskId,
          taskStageId: stage.id,
          companyId: input.companyId,
        },
        update: { companyId: input.companyId },
      });
      await tx.taskStage.update({
        where: { id: stage.id },
        data: {
          status: TaskStageStatus.COMPLETED,
          startedAt: stage.startedAt ?? now,
          completedAt: changedCompany || newlyCompleted
            ? now
            : stage.completedAt ?? now,
        },
      });
      if (changedCompany || newlyCompleted) {
        await auditStageMutation(tx, {
          tenantId: input.tenantId,
          userId: input.userId,
          stageId: stage.id,
          companyId: input.companyId,
          summary: 'Synchronized Company Profile outcome with task company',
          metadata: {
            previousCompanyId: stage.outcome?.companyId ?? null,
            companyId: input.companyId,
            status: TaskStageStatus.COMPLETED,
          },
        });
      }
      continue;
    }

    await tx.taskStageOutcome.deleteMany({
      where: { tenantId: input.tenantId, taskStageId: stage.id },
    });
    await tx.taskCompanyRecoveryContext.deleteMany({
      where: {
        tenantId: input.tenantId,
        taskId: input.taskId,
        taskStageId: stage.id,
      },
    });
    await tx.taskStage.update({
      where: { id: stage.id },
      data: {
        status: TaskStageStatus.NOT_STARTED,
        startedAt: null,
        completedAt: null,
        skipReason: null,
      },
    });
    if (stage.outcome || stage.status !== TaskStageStatus.NOT_STARTED) {
      await auditStageMutation(tx, {
        tenantId: input.tenantId,
        userId: input.userId,
        stageId: stage.id,
        companyId: null,
        summary: 'Cleared Company Profile outcome with task company',
        metadata: {
          previousCompanyId: stage.outcome?.companyId ?? null,
          companyId: null,
          status: TaskStageStatus.NOT_STARTED,
        },
      });
    }
  }

  await tx.task.update({
    where: { id: input.taskId },
    data: { companyId: input.companyId },
  });
  const taskStatus = await updateParentTaskStatus(
    tx,
    input.tenantId,
    input.taskId,
    input.currentTaskStatus,
  );
  return { taskStatus, outcomesByStageId };
}
```

Use the generated model type import:

```ts
import type { TaskStageOutcome } from '@/generated/prisma';
```

- [ ] **Step 5: Invoke the helper from task metadata updates**

In `src/services/tasks/task.service.ts`, import `synchronizeCompanyProfileStages` with `getTaskStageDetail`. Update `updateTaskMetadata` so the task is locked before synchronization and the final metadata update remains the operation returning `taskPublicSelect`:

```ts
export async function updateTaskMetadata(
  tenantId: string,
  taskId: string,
  input: UpdateTaskMetadataInput,
  userId?: string,
) {
  const parsed = updateTaskMetadataSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const lockedTask = await lockTaskForUpdate(tx, tenantId, taskId);
    const existing = await requireTask(tx, tenantId, taskId);
    await validateTaskRelations(tx, tenantId, parsed.companyId, parsed.ownerId);

    if (parsed.companyId !== undefined) {
      await synchronizeCompanyProfileStages(tx, {
        tenantId,
        taskId: existing.id,
        companyId: parsed.companyId ?? null,
        currentTaskStatus: lockedTask.status,
        userId,
      });
    }

    const updated = await tx.task.update({
      where: { id: existing.id },
      data: parsed,
      select: taskPublicSelect,
    });
    // Preserve the existing task audit call and DTO conversion.
    return toPublicTaskDto(updated);
  });
}
```

The final `task.update` repeats the same `companyId` value after synchronization but does not overwrite the status recalculated by `updateParentTaskStatus`; its select observes the synchronized stage rows.

- [ ] **Step 6: Run the focused metadata tests and verify GREEN**

Run:

```powershell
npx.cmd vitest run __tests__/services/task-stage-registry.test.ts -t "Company Profile metadata synchronization"
```

Expected: all five focused tests PASS.

- [ ] **Step 7: Run the complete task stage service test**

Run:

```powershell
npx.cmd vitest run __tests__/services/task-stage-registry.test.ts
```

Expected: PASS with no regression in locking, recovery, status, checklist, or other outcome tests.

- [ ] **Step 8: Commit Task 1**

```powershell
git add -- src/services/tasks/stage.service.ts src/services/tasks/task.service.ts __tests__/services/task-stage-registry.test.ts
git commit -m "fix(tasks): sync metadata company profile outcomes"
```

---

### Task 2: Reuse synchronization for Company Profile stage linking

**Files:**
- Modify: `__tests__/services/task-stage-registry.test.ts`
- Modify: `src/services/tasks/stage.service.ts`

**Interfaces:**
- Consumes: `synchronizeCompanyProfileStages(tx, input)` from Task 1.
- Produces: `linkTaskStageOutcome(...)` preserving its existing return shape while synchronizing all non-skipped Company Profile stages.

- [ ] **Step 1: Write a failing multi-stage linking test**

Add this regression inside `stage-authoritative Company callback ordering`, resetting `stageFindMany` so the first call supplies synchronizable stage records and the second supplies statuses for parent-task derivation:

```ts
it('synchronizes every non-skipped Company Profile stage after an authoritative stage link', async () => {
  recoveryCompanyId = companyB;
  mocks.stageFindMany
    .mockReset()
    .mockResolvedValueOnce([
      {
        id: 'stage-1',
        status: TaskStageStatus.NOT_STARTED,
        startedAt: null,
        completedAt: null,
        outcome: null,
      },
      {
        id: 'stage-2',
        status: TaskStageStatus.COMPLETED,
        startedAt: new Date('2026-07-01T00:00:00.000Z'),
        completedAt: new Date('2026-07-01T00:00:00.000Z'),
        outcome: { companyId: companyA },
      },
    ])
    .mockResolvedValueOnce([
      { status: TaskStageStatus.COMPLETED },
      { status: TaskStageStatus.COMPLETED },
    ]);
  mocks.recoveryUpsert.mockResolvedValue({ id: 'recovery-1' });
  mocks.outcomeUpsert
    .mockResolvedValueOnce({
      id: 'outcome-1',
      taskStageId: 'stage-1',
      type: 'COMPANY',
      companyId: companyB,
    })
    .mockResolvedValueOnce({
      id: 'outcome-2',
      taskStageId: 'stage-2',
      type: 'COMPANY',
      companyId: companyB,
    });

  const result = await linkTaskStageOutcome('tenant-a', 'stage-1', {
    type: 'COMPANY',
    companyId: companyB,
  }, 'user-1');

  expect(mocks.outcomeUpsert).toHaveBeenCalledTimes(2);
  expect(mocks.outcomeUpsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
    where: { taskStageId: 'stage-2' },
    update: expect.objectContaining({ companyId: companyB }),
  }));
  expect(result).toEqual(expect.objectContaining({
    outcome: expect.objectContaining({ id: 'outcome-1', companyId: companyB }),
    status: TaskStageStatus.COMPLETED,
    taskStatus: TaskStatus.COMPLETED,
  }));
});
```

- [ ] **Step 2: Run the linking test and verify RED**

Run:

```powershell
npx.cmd vitest run __tests__/services/task-stage-registry.test.ts -t "synchronizes every non-skipped Company Profile stage after an authoritative stage link"
```

Expected: FAIL because `linkTaskStageOutcome` only upserts the selected stage.

- [ ] **Step 3: Route Company Profile linking through the helper**

In `linkTaskStageOutcome`, keep the existing recovery-row stale-callback guard and authoritative company resolution. Immediately after deriving `resolution`, branch for a Company Profile outcome:

```ts
if (
  parsed.type === TaskStageOutcomeType.COMPANY
  && parsed.companyId
) {
  const synchronized = await synchronizeCompanyProfileStages(tx, {
    tenantId,
    taskId: stage.taskId,
    companyId: parsed.companyId,
    currentTaskStatus: lockedTask.status,
    userId,
  });
  const outcome = synchronized.outcomesByStageId.get(stage.id) ?? stage.outcome;
  if (stage.status !== TaskStageStatus.SKIPPED && !outcome) {
    throw new ValidationError('Company Profile stage was not synchronized');
  }
  return {
    outcome,
    status: stage.status === TaskStageStatus.SKIPPED
      ? TaskStageStatus.SKIPPED
      : TaskStageStatus.COMPLETED,
    summary: resolution.summary,
    taskStatus: synchronized.taskStatus,
  };
}
```

Leave the existing generic outcome upsert, selected-stage status update, task-status update, and audit path in place for document generation and e-signing outcomes. Remove the old Company-specific `task.update({ companyId })` branch because the helper now owns that invariant. If a Company outcome link is called directly for a skipped stage, the helper synchronizes the task and its other non-skipped Company Profile stages while returning the skipped stage unchanged.

- [ ] **Step 4: Run the linking test and verify GREEN**

Run:

```powershell
npx.cmd vitest run __tests__/services/task-stage-registry.test.ts -t "synchronizes every non-skipped Company Profile stage after an authoritative stage link"
```

Expected: PASS.

- [ ] **Step 5: Run the complete task service regression file**

Run:

```powershell
npx.cmd vitest run __tests__/services/task-stage-registry.test.ts
```

Expected: PASS. If existing Company callback tests assert the old single-stage write count, update their fixtures to return one synchronizable stage and preserve their stale-callback assertions.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- src/services/tasks/stage.service.ts __tests__/services/task-stage-registry.test.ts
git commit -m "refactor(tasks): centralize company profile synchronization"
```

---

### Task 3: Verify the service boundary and repository quality gates

**Files:**
- Verify: `src/services/tasks/stage.service.ts`
- Verify: `src/services/tasks/task.service.ts`
- Verify: `__tests__/services/task-stage-registry.test.ts`

**Interfaces:**
- Consumes: the completed synchronization behavior from Tasks 1 and 2.
- Produces: fresh test, type-check, lint, and diff evidence for handoff.

- [ ] **Step 1: Run all task-module service tests**

```powershell
npx.cmd vitest run __tests__/services/task-stage-registry.test.ts __tests__/services/task-module-integrations.test.ts __tests__/services/task-status.test.ts __tests__/api/tasks-api.test.ts
```

Expected: all selected files PASS.

- [ ] **Step 2: Run the TypeScript compiler**

```powershell
npx.cmd tsc --noEmit
```

Expected: exit code 0. If unrelated pre-existing compiler errors remain, record their exact file and diagnostic separately and ensure neither modified production file introduces a diagnostic.

- [ ] **Step 3: Run lint on the modified production files**

```powershell
npx.cmd eslint src/services/tasks/stage.service.ts src/services/tasks/task.service.ts __tests__/services/task-stage-registry.test.ts
```

Expected: exit code 0 with no errors or warnings.

- [ ] **Step 4: Inspect the final patch**

```powershell
git diff --check
git diff -- src/services/tasks/stage.service.ts src/services/tasks/task.service.ts __tests__/services/task-stage-registry.test.ts
```

Expected: `git diff --check` produces no output; the scoped diff contains only the synchronization helper, its two callers, and regression tests.

- [ ] **Step 5: Commit any verification-only corrections**

Only if Step 1-4 required corrections:

```powershell
git add -- src/services/tasks/stage.service.ts src/services/tasks/task.service.ts __tests__/services/task-stage-registry.test.ts
git commit -m "test(tasks): verify company profile synchronization"
```
