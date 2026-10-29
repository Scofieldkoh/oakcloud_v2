import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskStageActionType,
  TaskStageStatus,
  TaskStatus,
} from '@/generated/prisma';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  transaction: vi.fn(),
  versionFindFirst: vi.fn(),
  taskCreate: vi.fn(),
  taskFindFirst: vi.fn(),
  taskUpdate: vi.fn(),
  stageCreate: vi.fn(),
  stageFindFirst: vi.fn(),
  stageFindMany: vi.fn(),
  stageUpdate: vi.fn(),
  checklistCreateMany: vi.fn(),
  outcomeUpsert: vi.fn(),
  outcomeDeleteMany: vi.fn(),
  companyFindFirst: vi.fn(),
  documentFindFirst: vi.fn(),
  batchFindFirst: vi.fn(),
  batchItemFindFirst: vi.fn(),
  envelopeFindFirst: vi.fn(),
  recoveryFindFirst: vi.fn(),
  recoveryUpsert: vi.fn(),
  recoveryDeleteMany: vi.fn(),
  userFindFirst: vi.fn(),
  checklistFindFirst: vi.fn(),
  checklistUpdate: vi.fn(),
  rawQuery: vi.fn(),
  queueEsigningPreparations: vi.fn(),
}));

const tx = {
  taskPipelineVersion: { findFirst: mocks.versionFindFirst },
  task: {
    create: mocks.taskCreate,
    findFirst: mocks.taskFindFirst,
    update: mocks.taskUpdate,
  },
  taskStage: {
    create: mocks.stageCreate,
    findFirst: mocks.stageFindFirst,
    findMany: mocks.stageFindMany,
    update: mocks.stageUpdate,
  },
  taskStageOutcome: {
    upsert: mocks.outcomeUpsert,
    deleteMany: mocks.outcomeDeleteMany,
  },
  taskCompanyRecoveryContext: {
    upsert: mocks.recoveryUpsert,
    deleteMany: mocks.recoveryDeleteMany,
  },
  company: { findFirst: mocks.companyFindFirst },
  generatedDocument: { findFirst: mocks.documentFindFirst },
  documentGenerationBatch: { findFirst: mocks.batchFindFirst },
  documentGenerationBatchItem: { findFirst: mocks.batchItemFindFirst },
  esigningEnvelope: { findFirst: mocks.envelopeFindFirst },
  user: { findFirst: mocks.userFindFirst },
  taskStageChecklistItem: {
    createMany: mocks.checklistCreateMany,
    findFirst: mocks.checklistFindFirst,
    update: mocks.checklistUpdate,
  },
  $queryRaw: mocks.rawQuery,
};

function expectTaskLock(taskId = 'task-1', tenantId = 'tenant-a') {
  const query = mocks.rawQuery.mock.calls
    .map(([value]) => value as { sql?: string; values?: unknown[] })
    .find((value) => value.sql?.includes('FROM tasks')) as {
    sql?: string;
    values?: unknown[];
  } | undefined;
  expect(query?.sql).toContain('FOR UPDATE');
  expect(query?.sql).toContain('tenant_id');
  expect(query?.values).toEqual([taskId, tenantId]);
}

function publicTaskRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Annual return',
    description: null,
    status: TaskStatus.NOT_STARTED,
    dueDate: null,
    createdAt: new Date('2026-07-24T00:00:00.000Z'),
    updatedAt: new Date('2026-07-24T00:00:00.000Z'),
    company: null,
    owner: null,
    pipelineVersion: {
      id: 'version-1',
      version: 1,
      pipeline: { id: 'pipeline-1', name: 'Annual return' },
    },
    stages: [],
    ...overrides,
  };
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    taskStage: { findFirst: mocks.stageFindFirst },
    generatedDocument: { findFirst: mocks.documentFindFirst },
    documentGenerationBatch: { findFirst: mocks.batchFindFirst },
    documentGenerationBatchItem: { findFirst: mocks.batchItemFindFirst },
    company: { findFirst: mocks.companyFindFirst },
    taskCompanyRecoveryContext: { findFirst: mocks.recoveryFindFirst },
  },
}));

vi.mock('@/lib/audit', () => ({
  createAuditLog: mocks.audit,
}));

vi.mock('@/services/tasks/esigning-preparation.service', () => ({
  queueTaskEsigningPreparationsForTask: mocks.queueEsigningPreparations,
}));

import {
  getStageActionAdapter,
  resolveStageActionOutcome,
} from '@/services/tasks/action-registry';
import { createTask } from '@/services/tasks/task.service';
import {
  archiveTask,
  cancelTask,
  pauseTask,
  resumeTask,
  updateTaskMetadata,
} from '@/services/tasks/task.service';
import {
  completeTaskStage,
  getTaskStageDetail,
  linkTaskStageOutcome,
  reconcileTaskStageOutcome,
  reopenTaskStage,
  skipTaskStage,
  updateTaskStageChecklistItem,
  updateTaskStageMetadata,
  recoverTaskStageOutcomeFromDurableContext,
} from '@/services/tasks/stage.service';

describe('Company recovery ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.companyFindFirst.mockResolvedValue(null);
  });

  it('ignores a recovery row whose task does not own the requested stage', async () => {
    mocks.recoveryFindFirst.mockResolvedValue({
      taskId: 'task-other',
      company: { id: 'company-b' },
    });

    await expect(recoverTaskStageOutcomeFromDurableContext('tenant-a', {
      id: 'stage-1',
      taskId: 'task-1',
      actionType: TaskStageActionType.COMPANY_PROFILE,
    })).resolves.toBe(false);

    expect(mocks.recoveryFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        taskId: 'task-1',
        taskStageId: 'stage-1',
        taskStage: {
          actionType: TaskStageActionType.COMPANY_PROFILE,
          taskId: 'task-1',
          tenantId: 'tenant-a',
        },
        company: { deletedAt: null, tenantId: 'tenant-a' },
      },
      select: {
        taskId: true,
        company: { select: { id: true } },
      },
    });
    expect(mocks.outcomeUpsert).not.toHaveBeenCalled();
  });

  it('recovers a document outcome from a task-linked generation batch', async () => {
    const documentId = '33333333-3333-4333-8333-333333333333';
    const stage = {
      id: 'stage-1',
      taskId: 'task-1',
      actionType: TaskStageActionType.DOCUMENT_GENERATION,
      status: TaskStageStatus.IN_PROGRESS,
    };
    const linkedStage = {
      ...stage,
      tenantId: 'tenant-a',
      name: 'Generate resolution',
      startedAt: new Date('2026-08-29T00:00:00.000Z'),
      completedAt: null,
      isRequired: true,
      task: { id: 'task-1', status: TaskStatus.IN_PROGRESS, companyId: null, deletedAt: null },
      outcome: null,
    };
    mocks.batchFindFirst.mockResolvedValue({
      items: [{ generatedDocumentId: documentId }],
    });
    mocks.documentFindFirst.mockResolvedValue({
      id: documentId,
      title: 'Resolution',
      status: 'DRAFT',
    });
    mocks.stageFindFirst.mockResolvedValue(linkedStage);
    mocks.rawQuery.mockResolvedValue([{
      id: 'task-1',
      tenantId: 'tenant-a',
      status: TaskStatus.IN_PROGRESS,
      title: 'Annual return',
      companyId: null,
    }]);
    mocks.outcomeUpsert.mockResolvedValue({ id: 'outcome-1' });
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1', status: TaskStageStatus.IN_PROGRESS });
    mocks.stageFindMany.mockResolvedValue([{ status: TaskStageStatus.IN_PROGRESS }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1' });
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await expect(recoverTaskStageOutcomeFromDurableContext('tenant-a', stage))
      .resolves.toBe(true);

    expect(mocks.batchFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-a',
        deletedAt: null,
        AND: [
          { taskContext: { path: ['taskId'], equals: 'task-1' } },
          { taskContext: { path: ['taskStageId'], equals: 'stage-1' } },
        ],
      }),
    }));
    expect(mocks.outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        type: 'GENERATED_DOCUMENT',
        generatedDocumentId: documentId,
      }),
    }));
  });
});

describe('stage action registry', () => {
  it('provides curated defaults, blockers, and launch context', () => {
    const adapter = getStageActionAdapter(TaskStageActionType.COMPANY_PROFILE);
    const context = {
      tenantId: 'tenant-a',
      stage: {
        id: 'stage-1',
        tenantId: 'tenant-a',
        taskId: 'task-1',
        actionType: TaskStageActionType.COMPANY_PROFILE,
        actionConfig: null,
        status: TaskStageStatus.NOT_STARTED,
        task: { companyId: null },
      },
    };

    expect(adapter.defaultIcon).toBe('Building2');
    expect(adapter.blockers(context)).toEqual([]);
    expect(adapter.launch(context)).toEqual({
      href: '/companies/new',
      context: { taskId: 'task-1', taskStageId: 'stage-1' },
    });
  });

  it('passes the linked task company into the document generation workspace', () => {
    const adapter = getStageActionAdapter(TaskStageActionType.DOCUMENT_GENERATION);

    expect(adapter.launch({
      tenantId: 'tenant-a',
      stage: {
        id: 'stage-2',
        tenantId: 'tenant-a',
        taskId: 'task-1',
        actionType: TaskStageActionType.DOCUMENT_GENERATION,
        actionConfig: {
          templateId: '11111111-1111-4111-8111-111111111111',
        },
        status: TaskStageStatus.NOT_STARTED,
        task: {
          companyId: '22222222-2222-4222-8222-222222222222',
        },
      },
    })).toEqual({
      href: '/generated-documents/generate?templateId=11111111-1111-4111-8111-111111111111&companyId=22222222-2222-4222-8222-222222222222',
      context: { taskId: 'task-1', taskStageId: 'stage-2' },
    });
  });

  it('launches with resolved replacement templates instead of the stored configuration', () => {
    const adapter = getStageActionAdapter(TaskStageActionType.DOCUMENT_GENERATION);

    expect(adapter.launch({
      tenantId: 'tenant-a',
      resolvedTemplateIds: ['33333333-3333-4333-8333-333333333333'],
      stage: {
        id: 'stage-2',
        tenantId: 'tenant-a',
        taskId: 'task-1',
        actionType: TaskStageActionType.DOCUMENT_GENERATION,
        actionConfig: {
          templateId: '11111111-1111-4111-8111-111111111111',
        },
        status: TaskStageStatus.NOT_STARTED,
        task: { companyId: null },
      },
    }).href).toBe('/generated-documents/generate?templateId=33333333-3333-4333-8333-333333333333');
  });

  it('passes multiple configured templates into the document generation workspace', () => {
    const adapter = getStageActionAdapter(TaskStageActionType.DOCUMENT_GENERATION);

    expect(adapter.launch({
      tenantId: 'tenant-a',
      stage: {
        id: 'stage-2',
        tenantId: 'tenant-a',
        taskId: 'task-1',
        actionType: TaskStageActionType.DOCUMENT_GENERATION,
        actionConfig: {
          templateIds: [
            '11111111-1111-4111-8111-111111111111',
            '33333333-3333-4333-8333-333333333333',
          ],
        },
        status: TaskStageStatus.NOT_STARTED,
        task: { companyId: '22222222-2222-4222-8222-222222222222' },
      },
    })).toEqual({
      href: '/generated-documents/generate?templateId=11111111-1111-4111-8111-111111111111&templateId=33333333-3333-4333-8333-333333333333&companyId=22222222-2222-4222-8222-222222222222',
      context: { taskId: 'task-1', taskStageId: 'stage-2' },
    });
  });

  it.each([
    {
      status: TaskStageStatus.IN_PROGRESS,
      expectedHref:
        '/generated-documents/generate?batch=44444444-4444-4444-8444-444444444444',
      documentGenerationBatchId: '44444444-4444-4444-8444-444444444444',
    },
    {
      status: TaskStageStatus.COMPLETED,
      expectedHref:
        '/generated-documents/33333333-3333-4333-8333-333333333333',
      documentGenerationBatchId: undefined,
    },
  ])('opens the linked document workspace when a generation stage is $status', ({
    status,
    expectedHref,
    documentGenerationBatchId,
  }) => {
    const adapter = getStageActionAdapter(TaskStageActionType.DOCUMENT_GENERATION);

    expect(adapter.launch({
      tenantId: 'tenant-a',
      stage: {
        id: 'stage-2',
        tenantId: 'tenant-a',
        taskId: 'task-1',
        actionType: TaskStageActionType.DOCUMENT_GENERATION,
        actionConfig: {},
        status,
        outcome: {
          type: 'GENERATED_DOCUMENT',
          generatedDocumentId: '33333333-3333-4333-8333-333333333333',
          documentGenerationBatchId,
        },
      },
    })).toEqual({
      href: expectedHref,
      context: { taskId: 'task-1', taskStageId: 'stage-2' },
    });
  });

  it('falls back to a fresh generator when an active stage has no linked document', () => {
    const adapter = getStageActionAdapter(TaskStageActionType.DOCUMENT_GENERATION);

    expect(adapter.launch({
      tenantId: 'tenant-a',
      stage: {
        id: 'stage-2',
        tenantId: 'tenant-a',
        taskId: 'task-1',
        actionType: TaskStageActionType.DOCUMENT_GENERATION,
        actionConfig: {
          templateId: '11111111-1111-4111-8111-111111111111',
        },
        status: TaskStageStatus.IN_PROGRESS,
        task: {
          companyId: '22222222-2222-4222-8222-222222222222',
        },
        outcome: null,
      },
    })).toEqual({
      href: '/generated-documents/generate?templateId=11111111-1111-4111-8111-111111111111&companyId=22222222-2222-4222-8222-222222222222',
      context: { taskId: 'task-1', taskStageId: 'stage-2' },
    });
  });

  it('reopens an existing e-signing task outcome instead of creating another envelope', () => {
    const adapter = getStageActionAdapter(TaskStageActionType.ESIGNING);

    expect(adapter.launch({
      tenantId: 'tenant-a',
      stage: {
        id: 'stage-3',
        tenantId: 'tenant-a',
        taskId: 'task-1',
        actionType: TaskStageActionType.ESIGNING,
        actionConfig: {},
        status: TaskStageStatus.IN_PROGRESS,
        outcome: {
          type: 'ESIGNING_ENVELOPE',
          esigningEnvelopeId: '33333333-3333-4333-8333-333333333333',
        },
      },
    })).toEqual({
      href: '/esigning/33333333-3333-4333-8333-333333333333',
      context: { taskId: 'task-1', taskStageId: 'stage-3' },
    });
  });

  it('derives authoritative company and document outcomes', () => {
    const company = resolveStageActionOutcome(TaskStageActionType.COMPANY_PROFILE, {
      type: 'COMPANY',
      entity: { kind: 'company', id: 'company-1', name: 'Acme' },
    });
    const draft = resolveStageActionOutcome(TaskStageActionType.DOCUMENT_GENERATION, {
      type: 'GENERATED_DOCUMENT',
      entity: { kind: 'generatedDocument', id: 'document-1', title: 'Resolution', status: 'DRAFT' },
    });
    const finalized = resolveStageActionOutcome(TaskStageActionType.DOCUMENT_GENERATION, {
      type: 'GENERATED_DOCUMENT',
      entity: { kind: 'generatedDocument', id: 'document-1', title: 'Resolution', status: 'FINALIZED' },
    });

    expect(company.status).toBe(TaskStageStatus.COMPLETED);
    expect(draft.status).toBe(TaskStageStatus.IN_PROGRESS);
    expect(finalized.status).toBe(TaskStageStatus.COMPLETED);
  });

  it('fails terminal e-signing outcomes and completes only when all required signatures complete', () => {
    const adapter = getStageActionAdapter(TaskStageActionType.ESIGNING);
    const envelope = (status: string, completedSignatures: number, requiredSignatures = 2) => ({
      type: 'ESIGNING_ENVELOPE' as const,
      entity: {
        kind: 'esigningEnvelope' as const,
        id: 'envelope-1',
        title: 'Engagement letter',
        status,
        requiredSignatures,
        completedSignatures,
      },
    });

    expect(adapter.deriveStatus(envelope('IN_PROGRESS', 1))).toBe(TaskStageStatus.IN_PROGRESS);
    expect(adapter.deriveStatus(envelope('COMPLETED', 2))).toBe(TaskStageStatus.COMPLETED);
    expect(adapter.deriveStatus(envelope('DECLINED', 1))).toBe(TaskStageStatus.FAILED);
    expect(adapter.deriveStatus(envelope('EXPIRED', 0))).toBe(TaskStageStatus.FAILED);
    expect(adapter.deriveStatus(envelope('VOIDED', 0))).toBe(TaskStageStatus.FAILED);
  });

  it('loads the batch id for a migrated in-progress document stage', async () => {
    const batchId = '44444444-4444-4444-8444-444444444444';
    const documentId = '33333333-3333-4333-8333-333333333333';
    const stage = {
      id: 'stage-2',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Generate resolution',
      description: null,
      notes: null,
      skipReason: null,
      position: 0,
      actionType: TaskStageActionType.DOCUMENT_GENERATION,
      icon: 'FileText',
      isRequired: true,
      actionConfig: {},
      status: TaskStageStatus.IN_PROGRESS,
      startedAt: new Date('2026-08-29T00:00:00.000Z'),
      completedAt: null,
      assigneeId: null,
      task: { id: 'task-1', status: TaskStatus.IN_PROGRESS, companyId: null, deletedAt: null },
      assignee: null,
      checklistItems: [],
      outcome: {
        id: 'outcome-1',
        type: 'GENERATED_DOCUMENT',
        companyId: null,
        generatedDocumentId: documentId,
        esigningEnvelopeId: null,
      },
    };
    mocks.stageFindFirst.mockImplementation(({ select }: { select?: unknown }) => (
      Promise.resolve(select ? { taskId: stage.taskId } : stage)
    ));
    mocks.rawQuery.mockResolvedValue([{
      id: stage.taskId,
      tenantId: 'tenant-a',
      status: TaskStatus.IN_PROGRESS,
      title: 'Annual return',
      companyId: null,
    }]);
    mocks.documentFindFirst.mockResolvedValue({
      id: documentId,
      title: 'Resolution',
      status: 'DRAFT',
    });
    mocks.stageFindMany.mockResolvedValue([{ status: TaskStageStatus.IN_PROGRESS }]);
    mocks.batchItemFindFirst.mockResolvedValue({ batchId });

    const detail = await getTaskStageDetail('tenant-a', stage.taskId, stage.id);

    expect(detail.launch).toEqual({
      href: `/generated-documents/generate?batch=${batchId}`,
      context: { taskId: stage.taskId, taskStageId: stage.id },
    });
    expect(mocks.batchItemFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        generatedDocumentId: documentId,
        batch: { tenantId: 'tenant-a', deletedAt: null },
      },
      select: { batchId: true },
    });
  });
});

describe('task snapshots and stage mutations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    mocks.rawQuery.mockResolvedValue([{
      id: 'task-1',
      tenantId: 'tenant-a',
      status: TaskStatus.NOT_STARTED,
      title: 'Annual return',
      companyId: null,
    }]);
  });

  describe('stage-authoritative Company callback ordering', () => {
    const companyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const companyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    let recoveryCompanyId: string | null = companyA;
    let deletedCompanyId: string | null = null;

    beforeEach(() => {
      deletedCompanyId = null;
      mocks.stageFindFirst.mockResolvedValue({
        id: 'stage-1',
        tenantId: 'tenant-a',
        taskId: 'task-1',
        actionType: TaskStageActionType.COMPANY_PROFILE,
        status: TaskStageStatus.NOT_STARTED,
        startedAt: null,
        task: {
          id: 'task-1',
          status: TaskStatus.NOT_STARTED,
          companyId: null,
          deletedAt: null,
        },
        outcome: null,
        checklistItems: [],
      });
      mocks.rawQuery.mockImplementation((query: { sql?: string }) => {
        if (query.sql?.includes('task_company_recovery_contexts')) {
          return Promise.resolve([{
            taskId: 'task-1',
            companyId: recoveryCompanyId,
          }]);
        }
        return Promise.resolve([{
          id: 'task-1',
          tenantId: 'tenant-a',
          status: TaskStatus.NOT_STARTED,
          title: 'Onboarding',
          companyId: null,
        }]);
      });
      mocks.companyFindFirst.mockImplementation(({ where }: {
        where: { id: string; tenantId?: string; deletedAt?: null };
      }) => {
        if (where.deletedAt === null && where.id === deletedCompanyId) {
          return Promise.resolve(null);
        }
        return Promise.resolve({ id: where.id, name: `Company ${where.id}` });
      });
      mocks.outcomeUpsert.mockResolvedValue({ id: 'outcome-1' });
      mocks.recoveryUpsert.mockResolvedValue({ id: 'recovery-1' });
      mocks.stageUpdate.mockResolvedValue({ id: 'stage-1' });
      mocks.stageFindMany.mockResolvedValue([{
        id: 'stage-1',
        status: TaskStageStatus.COMPLETED,
        startedAt: null,
        completedAt: null,
        outcome: null,
      }]);
      mocks.taskUpdate.mockResolvedValue({ id: 'task-1' });
    });

    it('does not let a protected callback replace active Company B after B recovery commits', async () => {
      recoveryCompanyId = companyB;

      const result = await linkTaskStageOutcome('tenant-a', 'stage-1', {
        type: 'COMPANY',
        companyId: companyA,
      }, 'user-1', {
        protectAuthoritativeCompany: true,
      });

      expect(result).toEqual(expect.objectContaining({
        stale: true,
        authoritativeCompanyId: companyB,
      }));
      expect(mocks.outcomeUpsert).not.toHaveBeenCalled();
      expect(mocks.taskUpdate).not.toHaveBeenCalled();
      expect(mocks.stageUpdate).not.toHaveBeenCalled();
    });

    it('lets an explicit stage link replace an active Company B like task metadata', async () => {
      recoveryCompanyId = companyB;

      const result = await linkTaskStageOutcome('tenant-a', 'stage-1', {
        type: 'COMPANY',
        companyId: companyA,
      }, 'user-1');

      expect(result).toEqual(expect.objectContaining({
        outcome: expect.objectContaining({ id: 'outcome-1' }),
        status: TaskStageStatus.COMPLETED,
      }));
      expect(mocks.outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ companyId: companyA }),
      }));
      expect(mocks.recoveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ companyId: companyA }),
      }));
    });

    it('lets an explicit link replace a hard-deleted Company B tombstone', async () => {
      recoveryCompanyId = null;

      const result = await linkTaskStageOutcome('tenant-a', 'stage-1', {
        type: 'COMPANY',
        companyId: companyA,
      }, 'user-1');

      expect(result).toEqual(expect.objectContaining({
        outcome: expect.objectContaining({ id: 'outcome-1' }),
        status: TaskStageStatus.COMPLETED,
      }));
      expect(mocks.outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ companyId: companyA }),
      }));
      expect(mocks.recoveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ companyId: companyA }),
      }));
    });

    it('lets an explicit link replace a soft-deleted Company B', async () => {
      recoveryCompanyId = companyB;
      deletedCompanyId = companyB;

      const result = await linkTaskStageOutcome('tenant-a', 'stage-1', {
        type: 'COMPANY',
        companyId: companyA,
      }, 'user-1');

      expect(result).toEqual(expect.objectContaining({
        outcome: expect.objectContaining({ id: 'outcome-1' }),
        status: TaskStageStatus.COMPLETED,
      }));
      expect(mocks.outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ companyId: companyA }),
      }));
    });

    it('lets Company B win when A links before the B recovery commit', async () => {
      recoveryCompanyId = companyA;
      await linkTaskStageOutcome('tenant-a', 'stage-1', {
        type: 'COMPANY',
        companyId: companyA,
      }, 'user-1');

      recoveryCompanyId = companyB;
      await linkTaskStageOutcome('tenant-a', 'stage-1', {
        type: 'COMPANY',
        companyId: companyB,
      }, 'user-1');

      expect(mocks.outcomeUpsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
        update: expect.objectContaining({ companyId: companyA }),
      }));
      expect(mocks.outcomeUpsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
        update: expect.objectContaining({ companyId: companyB }),
      }));
      expect(mocks.taskUpdate).toHaveBeenLastCalledWith({
        where: { id: 'task-1' },
        data: { status: TaskStatus.COMPLETED },
      });
    });

    it('links the same authoritative Company idempotently', async () => {
      recoveryCompanyId = companyB;

      await linkTaskStageOutcome('tenant-a', 'stage-1', {
        type: 'COMPANY',
        companyId: companyB,
      }, 'user-1');
      await linkTaskStageOutcome('tenant-a', 'stage-1', {
        type: 'COMPANY',
        companyId: companyB,
      }, 'user-1');

      expect(mocks.outcomeUpsert).toHaveBeenCalledTimes(2);
      expect(mocks.outcomeUpsert).toHaveBeenLastCalledWith(expect.objectContaining({
        update: expect.objectContaining({ companyId: companyB }),
      }));
    });

    it('aligns every non-skipped Company Profile stage after an authoritative stage link', async () => {
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
          tenantId: 'tenant-a',
          taskStageId: 'stage-1',
          type: 'COMPANY',
          companyId: companyB,
          generatedDocumentId: null,
          esigningEnvelopeId: null,
        })
        .mockResolvedValueOnce({
          id: 'outcome-2',
          tenantId: 'tenant-a',
          taskStageId: 'stage-2',
          type: 'COMPANY',
          companyId: companyB,
          generatedDocumentId: null,
          esigningEnvelopeId: null,
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
        outcome: expect.objectContaining({
          id: 'outcome-1',
          companyId: companyB,
        }),
        status: TaskStageStatus.COMPLETED,
        taskStatus: TaskStatus.COMPLETED,
      }));
    });
  });

  describe('Company outcome self-healing on stage reads', () => {
    const companyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const companyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    let currentOutcome: {
      id: string;
      type: 'COMPANY';
      companyId: string | null;
      generatedDocumentId: null;
      esigningEnvelopeId: null;
    } | null;
    let recoveryCompanyId: string | null;
    let hasRecovery: boolean;
    let deletedCompanyId: string | null;
    let taskCompanyId: string | null;
    let currentStageStatus: TaskStageStatus;
    let currentTaskStatus: TaskStatus;
    let currentCompletedAt: Date | null;

    beforeEach(() => {
      currentOutcome = {
        id: 'outcome-1',
        type: 'COMPANY',
        companyId: companyA,
        generatedDocumentId: null,
        esigningEnvelopeId: null,
      };
      recoveryCompanyId = companyB;
      hasRecovery = true;
      deletedCompanyId = null;
      taskCompanyId = companyA;
      currentStageStatus = TaskStageStatus.COMPLETED;
      currentTaskStatus = TaskStatus.COMPLETED;
      currentCompletedAt = new Date();
      mocks.stageFindFirst.mockImplementation(() => Promise.resolve({
        id: 'stage-1',
        tenantId: 'tenant-a',
        taskId: 'task-1',
        actionType: TaskStageActionType.COMPANY_PROFILE,
        actionConfig: null,
        status: currentStageStatus,
        isRequired: true,
        startedAt: new Date(),
        completedAt: currentCompletedAt,
        task: {
          id: 'task-1',
          status: currentTaskStatus,
          companyId: taskCompanyId,
          deletedAt: null,
        },
        outcome: currentOutcome,
        checklistItems: [],
      }));
      mocks.rawQuery.mockImplementation((query: { sql?: string }) => {
        if (query.sql?.includes('task_company_recovery_contexts')) {
          return Promise.resolve(hasRecovery ? [{
            taskId: 'task-1',
            companyId: recoveryCompanyId,
          }] : []);
        }
        return Promise.resolve([{
          id: 'task-1',
          tenantId: 'tenant-a',
          status: currentTaskStatus,
          title: 'Onboarding',
          companyId: taskCompanyId,
        }]);
      });
      mocks.companyFindFirst.mockImplementation(({ where }: {
        where: { id: string; deletedAt?: null };
      }) => {
        if (where.deletedAt === null && where.id === deletedCompanyId) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          id: where.id,
          name: where.id === companyB ? 'Company B' : 'Company A',
          deletedAt: where.id === deletedCompanyId ? new Date() : null,
        });
      });
      mocks.outcomeUpsert.mockImplementation(({ update }: {
        update: { companyId: string | null };
      }) => {
        currentOutcome = {
          id: currentOutcome?.id ?? 'outcome-1',
          type: 'COMPANY',
          companyId: update.companyId,
          generatedDocumentId: null,
          esigningEnvelopeId: null,
        };
        return Promise.resolve(currentOutcome);
      });
      mocks.stageUpdate.mockImplementation(({ data }: {
        data: { status?: TaskStageStatus; completedAt?: Date | null };
      }) => {
        if (data.status) currentStageStatus = data.status;
        if ('completedAt' in data) currentCompletedAt = data.completedAt ?? null;
        return Promise.resolve({ id: 'stage-1' });
      });
      mocks.stageFindMany.mockImplementation(() => Promise.resolve([
        { status: currentStageStatus },
      ]));
      mocks.taskUpdate.mockImplementation(({ data }: {
        data: { companyId?: string | null; status?: TaskStatus };
      }) => {
        if ('companyId' in data) taskCompanyId = data.companyId ?? null;
        if (data.status) currentTaskStatus = data.status;
        return Promise.resolve({ id: 'task-1' });
      });
    });

    it('replaces stored Company A with recovery Company B when B callback was missed', async () => {
      const detail = await getTaskStageDetail('tenant-a', 'task-1', 'stage-1');

      expect(mocks.outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ companyId: companyB }),
      }));
      expect(mocks.taskUpdate).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { companyId: companyB },
      });
      expect(detail.outcomeSummary).toBe('Linked company: Company B');
      expect(mocks.audit).toHaveBeenCalledTimes(1);
      const taskLockOrder = mocks.rawQuery.mock.calls.findIndex(
        ([query]) => (query as { sql?: string }).sql?.includes('FROM tasks'),
      );
      const recoveryLockOrder = mocks.rawQuery.mock.calls.findIndex(
        ([query]) => (query as { sql?: string }).sql?.includes('task_company_recovery_contexts'),
      );
      expect(taskLockOrder).toBeLessThan(recoveryLockOrder);
    });

    it('does not rewrite a matching recovery outcome or a manual outcome without recovery', async () => {
      recoveryCompanyId = companyA;
      await getTaskStageDetail('tenant-a', 'task-1', 'stage-1');
      expect(mocks.outcomeUpsert).not.toHaveBeenCalled();

      vi.clearAllMocks();
      hasRecovery = false;
      await getTaskStageDetail('tenant-a', 'task-1', 'stage-1');
      expect(mocks.outcomeUpsert).not.toHaveBeenCalled();
    });

    it('replaces stale A with deleted recovery B and persists attention state', async () => {
      deletedCompanyId = companyB;

      const detail = await getTaskStageDetail('tenant-a', 'task-1', 'stage-1');

      expect(mocks.outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ companyId: companyB }),
      }));
      expect(mocks.stageUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: TaskStageStatus.FAILED }),
      }));
      expect(detail.status).toBe(TaskStageStatus.FAILED);
    });

    it.each([
      ['stale Company A outcome', true],
      ['no stored outcome', false],
    ])('persists a hard-delete tombstone with %s', async (_label, hasStoredOutcome) => {
      currentOutcome = hasStoredOutcome ? currentOutcome : null;
      recoveryCompanyId = null;

      const first = await getTaskStageDetail('tenant-a', 'task-1', 'stage-1');
      const second = await getTaskStageDetail('tenant-a', 'task-1', 'stage-1');

      expect(mocks.outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({ companyId: null }),
      }));
      expect(mocks.taskUpdate).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { companyId: null },
      });
      expect(first.status).toBe(TaskStageStatus.FAILED);
      expect(second.status).toBe(TaskStageStatus.FAILED);
    });

    it('replaces a hard-delete tombstone with a later Company C recovery', async () => {
      const companyC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      recoveryCompanyId = null;
      await getTaskStageDetail('tenant-a', 'task-1', 'stage-1');

      recoveryCompanyId = companyC;
      const detail = await getTaskStageDetail('tenant-a', 'task-1', 'stage-1');

      expect(mocks.outcomeUpsert).toHaveBeenLastCalledWith(expect.objectContaining({
        update: expect.objectContaining({ companyId: companyC }),
      }));
      expect(detail.status).toBe(TaskStageStatus.COMPLETED);
    });

    it('attributes hard-delete tombstone self-heal audits to the deleter', async () => {
      recoveryCompanyId = null;

      await getTaskStageDetail(
        'tenant-a',
        'task-1',
        'stage-1',
        'deleter-user',
      );

      expect(mocks.audit).toHaveBeenCalled();
      expect(mocks.audit).toHaveBeenCalledTimes(1);
      expect(mocks.audit.mock.calls.every(
        ([entry]) => (entry as { userId?: string }).userId === 'deleter-user',
      )).toBe(true);
    });

    it('allows detail-read recovery to audit without an explicit actor', async () => {
      recoveryCompanyId = null;

      await getTaskStageDetail('tenant-a', 'task-1', 'stage-1');

      expect(mocks.audit).toHaveBeenCalled();
      expect(mocks.audit.mock.calls.every(
        ([entry]) => (entry as { userId?: string }).userId === undefined,
      )).toBe(true);
    });

    it('does not re-audit an unchanged Company correction on later reads', async () => {
      await getTaskStageDetail('tenant-a', 'task-1', 'stage-1', 'deleter-user');
      expect(mocks.audit).toHaveBeenCalledTimes(1);

      mocks.audit.mockClear();
      await getTaskStageDetail('tenant-a', 'task-1', 'stage-1', 'deleter-user');

      expect(mocks.audit).not.toHaveBeenCalled();
    });
  });

  it('locks a task snapshot only after stages and checklist items are inserted', async () => {
    mocks.versionFindFirst.mockResolvedValue({
      id: 'version-1',
      tenantId: 'tenant-a',
      publishedAt: new Date(),
      stages: [{
        id: 'pipeline-stage-1',
        name: 'Manual review',
        description: null,
        position: 0,
        actionType: 'MANUAL',
        icon: 'CircleCheckBig',
        isRequired: true,
        actionConfig: {
          checklistItems: [
            { label: 'Review documents', position: 0 },
            { label: 'Confirm approval', position: 1 },
          ],
        },
      }],
    });
    mocks.taskCreate.mockResolvedValue({
      id: 'task-1',
      title: 'Annual return',
      status: TaskStatus.NOT_STARTED,
      snapshotLockedAt: null,
    });
    mocks.stageCreate.mockResolvedValue({ id: 'stage-1' });
    mocks.checklistCreateMany.mockResolvedValue({ count: 2 });
    mocks.taskUpdate.mockResolvedValue(publicTaskRecord({
      snapshotLockedAt: new Date(),
    }));

    await createTask('tenant-a', {
      title: 'Annual return',
      pipelineVersionId: '7ff3c11a-4a8e-45c7-a201-56df360db96c',
    }, 'user-1');

    expect(mocks.taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-a',
        snapshotLockedAt: null,
      }),
    });
    expect(mocks.checklistCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ taskStageId: 'stage-1', label: 'Review documents', position: 0 }),
        expect.objectContaining({ taskStageId: 'stage-1', label: 'Confirm approval', position: 1 }),
      ],
    });
    expect(mocks.taskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { snapshotLockedAt: expect.any(Date) },
      select: expect.any(Object),
    });
    expect(mocks.checklistCreateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.taskUpdate.mock.invocationCallOrder[0]);
  });

  it('rejects an outcome type that does not match the stage adapter', async () => {
    mocks.stageFindFirst.mockResolvedValue({
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      actionType: 'COMPANY_PROFILE',
      task: { id: 'task-1', status: 'NOT_STARTED', deletedAt: null },
    });

    await expect(linkTaskStageOutcome('tenant-a', 'stage-1', {
      type: 'GENERATED_DOCUMENT',
      generatedDocumentId: '25e3bf9a-25b3-469b-a797-0c754303f7bd',
    }, 'user-1')).rejects.toThrow('does not match');
    expect(mocks.documentFindFirst).not.toHaveBeenCalled();
  });

  it('rejects manual completion and reopening for integrated stages', async () => {
    mocks.stageFindFirst.mockResolvedValue({
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      actionType: 'DOCUMENT_GENERATION',
      status: 'IN_PROGRESS',
      isRequired: true,
      startedAt: new Date(),
      task: { id: 'task-1', status: 'IN_PROGRESS', companyId: null, deletedAt: null },
    });
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1' });
    mocks.stageFindMany.mockResolvedValue([{ status: 'COMPLETED' }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1' });

    await expect(completeTaskStage('tenant-a', 'stage-1', 'user-1'))
      .rejects.toThrow('MANUAL');
    await expect(reopenTaskStage('tenant-a', 'stage-1', 'user-1'))
      .rejects.toThrow('MANUAL');
    expect(mocks.stageUpdate).not.toHaveBeenCalled();
  });

  it('uses the authoritative entity to reconcile stage and task status', async () => {
    mocks.stageFindFirst.mockResolvedValue({
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      actionType: 'DOCUMENT_GENERATION',
      task: { id: 'task-1', status: 'NOT_STARTED', deletedAt: null },
    });
    mocks.documentFindFirst.mockResolvedValue({
      id: 'document-1',
      title: 'Resolution',
      status: 'FINALIZED',
    });
    mocks.outcomeUpsert.mockResolvedValue({ id: 'outcome-1' });
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1', status: 'COMPLETED' });
    mocks.stageFindMany.mockResolvedValue([{ status: 'COMPLETED' }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1', status: 'COMPLETED' });

    await linkTaskStageOutcome('tenant-a', 'stage-1', {
      type: 'GENERATED_DOCUMENT',
      generatedDocumentId: '25e3bf9a-25b3-469b-a797-0c754303f7bd',
    }, 'user-1');

    expect(mocks.queueEsigningPreparations)
      .toHaveBeenCalledWith('tenant-a', 'task-1', 'user-1');
    expect(mocks.documentFindFirst).toHaveBeenCalledWith({
      where: { id: '25e3bf9a-25b3-469b-a797-0c754303f7bd', tenantId: 'tenant-a', deletedAt: null },
      select: { id: true, title: true, status: true },
    });
    expect(mocks.stageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
    expect(mocks.taskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'COMPLETED' },
    });
  });

  it('atomically syncs the parent task company when linking a company outcome', async () => {
    mocks.stageFindFirst.mockResolvedValue({
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Company profile',
      actionType: 'COMPANY_PROFILE',
      status: 'NOT_STARTED',
      startedAt: null,
      task: { id: 'task-1', status: 'NOT_STARTED', companyId: null, deletedAt: null },
    });
    mocks.companyFindFirst.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333', name: 'Acme' });
    mocks.outcomeUpsert.mockResolvedValue({ id: 'outcome-1' });
    mocks.recoveryUpsert.mockResolvedValue({ id: 'recovery-1' });
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1', status: 'COMPLETED' });
    mocks.stageFindMany.mockResolvedValue([{
      id: 'stage-1',
      status: 'COMPLETED',
      startedAt: null,
      completedAt: null,
      outcome: null,
    }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1', status: 'COMPLETED' });

    await linkTaskStageOutcome('tenant-a', 'stage-1', {
      type: 'COMPANY',
      companyId: '33333333-3333-4333-8333-333333333333',
    }, 'user-1');

    expect(mocks.taskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { companyId: '33333333-3333-4333-8333-333333333333' },
    });
    expect(mocks.outcomeUpsert.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.taskUpdate.mock.invocationCallOrder[0]);
  });

  it('marks a SetNull outcome failed and keeps stage detail readable', async () => {
    const invalidOutcomeStage = {
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Generate contract',
      description: null,
      position: 1,
      icon: 'FileText',
      isRequired: true,
      actionType: 'DOCUMENT_GENERATION',
      actionConfig: null,
      status: 'COMPLETED',
      startedAt: new Date(),
      assignee: null,
      checklistItems: [],
      task: { id: 'task-1', status: 'COMPLETED', companyId: null, deletedAt: null },
      outcome: {
        id: 'outcome-1',
        type: 'GENERATED_DOCUMENT',
        companyId: null,
        generatedDocumentId: null,
        esigningEnvelopeId: null,
      },
    };
    mocks.stageFindFirst.mockResolvedValue(invalidOutcomeStage);
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1', status: 'FAILED' });
    mocks.stageFindMany.mockResolvedValue([{ status: 'FAILED' }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1', status: 'IN_PROGRESS' });

    await expect(getTaskStageDetail('tenant-a', 'task-1', 'stage-1'))
      .resolves.toMatchObject({
        id: 'stage-1',
        status: 'FAILED',
        outcomeSummary: null,
      });
    await expect(reconcileTaskStageOutcome('tenant-a', 'stage-1'))
      .resolves.toMatchObject({ status: 'FAILED' });
    expect(mocks.documentFindFirst).not.toHaveBeenCalled();
  });

  it('marks a soft-deleted authoritative outcome failed during detail and reconciliation', async () => {
    const missingDocumentStage = {
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Generate contract',
      description: null,
      position: 1,
      icon: 'FileText',
      isRequired: true,
      actionType: 'DOCUMENT_GENERATION',
      actionConfig: null,
      status: 'COMPLETED',
      startedAt: new Date(),
      assignee: null,
      checklistItems: [],
      task: { id: 'task-1', status: 'COMPLETED', companyId: null, deletedAt: null },
      outcome: {
        id: 'outcome-1',
        type: 'GENERATED_DOCUMENT',
        companyId: null,
        generatedDocumentId: '33333333-3333-4333-8333-333333333333',
        esigningEnvelopeId: null,
      },
    };
    mocks.stageFindFirst.mockResolvedValue(missingDocumentStage);
    mocks.documentFindFirst.mockResolvedValue(null);
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1', status: 'FAILED' });
    mocks.stageFindMany.mockResolvedValue([{ status: 'FAILED' }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1', status: 'IN_PROGRESS' });

    await expect(getTaskStageDetail('tenant-a', 'task-1', 'stage-1'))
      .resolves.toMatchObject({ status: 'FAILED', outcomeSummary: null });
    await expect(reconcileTaskStageOutcome('tenant-a', 'stage-1'))
      .resolves.toMatchObject({ status: 'FAILED' });
  });

  it('relinks a failed document stage to its active task-linked batch', async () => {
    const oldDocumentId = '33333333-3333-4333-8333-333333333333';
    const newDocumentId = '44444444-4444-4444-8444-444444444444';
    const batchId = '55555555-5555-4555-8555-555555555555';
    const initialStage = {
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Generate contract',
      description: null,
      position: 1,
      icon: 'FileText',
      isRequired: true,
      actionType: 'DOCUMENT_GENERATION',
      actionConfig: {},
      status: 'COMPLETED',
      startedAt: new Date('2026-08-29T00:00:00.000Z'),
      completedAt: new Date('2026-08-29T00:00:00.000Z'),
      assignee: null,
      checklistItems: [],
      task: { id: 'task-1', status: 'COMPLETED', companyId: null, deletedAt: null },
      outcome: {
        id: 'outcome-1',
        type: 'GENERATED_DOCUMENT',
        companyId: null,
        generatedDocumentId: oldDocumentId,
        esigningEnvelopeId: null,
      },
    };
    const failedStage = {
      ...initialStage,
      status: 'FAILED',
      completedAt: null,
    };
    const linkedStage = {
      ...failedStage,
      status: 'IN_PROGRESS',
      outcome: { ...failedStage.outcome, generatedDocumentId: newDocumentId },
    };
    const stageReads = [initialStage, initialStage, failedStage, failedStage, linkedStage, linkedStage];
    mocks.stageFindFirst.mockImplementation(({ select }: { select?: unknown }) => (
      Promise.resolve(select ? { taskId: 'task-1' } : stageReads.shift() ?? linkedStage)
    ));
    mocks.documentFindFirst.mockImplementation(({ where }: { where: { id: string } }) => (
      Promise.resolve(where.id === newDocumentId
        ? { id: newDocumentId, title: 'New contract', status: 'DRAFT' }
        : null)
    ));
    mocks.batchFindFirst.mockResolvedValue({
      items: [{ generatedDocumentId: newDocumentId }],
    });
    mocks.batchItemFindFirst.mockResolvedValue({ batchId });
    mocks.rawQuery.mockResolvedValue([{
      id: 'task-1',
      tenantId: 'tenant-a',
      status: TaskStatus.COMPLETED,
      title: 'Annual return',
      companyId: null,
    }]);
    mocks.outcomeUpsert.mockResolvedValue({ id: 'outcome-1' });
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1', status: TaskStageStatus.IN_PROGRESS });
    mocks.stageFindMany.mockResolvedValue([{ status: TaskStageStatus.IN_PROGRESS }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1' });

    const detail = await getTaskStageDetail('tenant-a', 'task-1', 'stage-1');

    expect(detail.launch).toEqual({
      href: `/generated-documents/generate?batch=${batchId}`,
      context: { taskId: 'task-1', taskStageId: 'stage-1' },
    });
    expect(mocks.outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ generatedDocumentId: newDocumentId }),
    }));
  });

  it('preserves a skipped integrated stage until the user reopens it', async () => {
    mocks.stageFindFirst.mockResolvedValue({
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Generate contract',
      actionType: 'DOCUMENT_GENERATION',
      status: 'SKIPPED',
      completedAt: null,
      task: {
        id: 'task-1',
        status: 'COMPLETED',
        companyId: null,
        deletedAt: null,
      },
      outcome: {
        id: 'outcome-1',
        type: 'GENERATED_DOCUMENT',
        companyId: null,
        generatedDocumentId: '33333333-3333-4333-8333-333333333333',
        esigningEnvelopeId: null,
      },
      checklistItems: [],
    });

    await expect(reconcileTaskStageOutcome('tenant-a', 'stage-1'))
      .resolves.toMatchObject({ status: 'SKIPPED', taskStatus: 'NOT_STARTED' });
    expect(mocks.stageUpdate).not.toHaveBeenCalled();
    expect(mocks.documentFindFirst).not.toHaveBeenCalled();
  });

  it('requires a reason to skip and audits manual completion', async () => {
    await expect(skipTaskStage('tenant-a', 'stage-1', ' ', 'user-1')).rejects.toThrow();

    mocks.stageFindFirst.mockResolvedValue({
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      actionType: 'MANUAL',
      status: 'NOT_STARTED',
      task: { id: 'task-1', status: 'NOT_STARTED', deletedAt: null },
    });
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1', status: 'COMPLETED' });
    mocks.stageFindMany.mockResolvedValue([{ status: 'COMPLETED' }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1', status: 'COMPLETED' });

    await completeTaskStage('tenant-a', 'stage-1', 'user-1');

    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      userId: 'user-1',
      action: 'UPDATE',
      entityType: 'TaskStage',
      entityId: 'stage-1',
    }), tx);
    expect(mocks.queueEsigningPreparations)
      .toHaveBeenCalledWith('tenant-a', 'task-1', 'user-1');
  });

  it('rejects required-stage skipping and persists a reason for optional stages', async () => {
    mocks.stageFindFirst.mockResolvedValueOnce({
      id: 'required-stage',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Required',
      actionType: 'MANUAL',
      status: 'NOT_STARTED',
      isRequired: true,
      task: { id: 'task-1', status: 'NOT_STARTED', companyId: null, deletedAt: null },
    }).mockResolvedValueOnce({
      id: 'optional-stage',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Optional',
      actionType: 'MANUAL',
      status: 'NOT_STARTED',
      isRequired: false,
      task: { id: 'task-1', status: 'NOT_STARTED', companyId: null, deletedAt: null },
    });
    mocks.stageUpdate.mockResolvedValue({ id: 'optional-stage', status: 'SKIPPED' });
    mocks.stageFindMany.mockResolvedValue([{ status: 'SKIPPED' }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1', status: 'COMPLETED' });

    await expect(skipTaskStage('tenant-a', 'required-stage', 'Not applicable', 'user-1'))
      .rejects.toThrow('Required task stages');
    await skipTaskStage('tenant-a', 'optional-stage', 'Not applicable', 'user-1');

    expect(mocks.stageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'optional-stage' },
      data: expect.objectContaining({ status: 'SKIPPED', skipReason: 'Not applicable' }),
    }));
    expectTaskLock();
  });

  it('reopens manual stages while holding the parent task lock', async () => {
    mocks.stageFindFirst.mockResolvedValue({
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Manual review',
      actionType: 'MANUAL',
      status: 'COMPLETED',
      isRequired: true,
      startedAt: new Date(),
      task: { id: 'task-1', status: 'COMPLETED', companyId: null, deletedAt: null },
    });
    mocks.rawQuery.mockResolvedValueOnce([{
      id: 'task-1',
      tenantId: 'tenant-a',
      status: 'COMPLETED',
      title: 'Annual return',
      companyId: null,
    }]);
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1', status: 'NOT_STARTED' });
    mocks.stageFindMany.mockResolvedValue([{ status: 'NOT_STARTED' }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1', status: 'NOT_STARTED' });

    await reopenTaskStage('tenant-a', 'stage-1', 'user-1');

    expect(mocks.stageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'NOT_STARTED',
        startedAt: null,
        completedAt: null,
      }),
    }));
    expect(mocks.rawQuery.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.stageUpdate.mock.invocationCallOrder[0]);
  });

  it('completes Company Profile stages when a task is created with a linked company', async () => {
    const companyId = '11111111-1111-4111-8111-111111111111';
    mocks.versionFindFirst.mockResolvedValue({
      id: 'version-1',
      tenantId: 'tenant-a',
      publishedAt: new Date(),
      stages: [{
        id: 'pipeline-stage-1',
        name: 'Company Profile',
        description: 'Link or create the company',
        position: 0,
        actionType: TaskStageActionType.COMPANY_PROFILE,
        icon: 'Building2',
        isRequired: true,
        actionConfig: null,
      }],
    });
    mocks.companyFindFirst.mockResolvedValue({ id: companyId });
    mocks.taskCreate.mockResolvedValue({
      id: 'task-1',
      title: 'Onboarding',
      companyId,
      status: TaskStatus.NOT_STARTED,
    });
    mocks.stageCreate.mockResolvedValue({ id: 'stage-1' });
    mocks.stageFindMany
      .mockResolvedValueOnce([{
        id: 'stage-1',
        status: TaskStageStatus.NOT_STARTED,
        startedAt: null,
        completedAt: null,
        outcome: null,
      }])
      .mockResolvedValueOnce([{ status: TaskStageStatus.COMPLETED }]);
    mocks.outcomeUpsert.mockResolvedValue({
      id: 'outcome-1',
      tenantId: 'tenant-a',
      taskStageId: 'stage-1',
      type: 'COMPANY',
      companyId,
      generatedDocumentId: null,
      esigningEnvelopeId: null,
    });
    mocks.recoveryUpsert.mockResolvedValue({ id: 'recovery-1' });
    mocks.stageUpdate.mockResolvedValue({
      id: 'stage-1',
      status: TaskStageStatus.COMPLETED,
    });
    mocks.taskUpdate.mockResolvedValue(publicTaskRecord({
      title: 'Onboarding',
      status: TaskStatus.COMPLETED,
      company: { id: companyId, name: 'DAP Atelier (S) Pte. Ltd.' },
      stages: [{
        id: 'stage-1',
        name: 'Company Profile',
        position: 0,
        actionType: TaskStageActionType.COMPANY_PROFILE,
        icon: 'Building2',
        isRequired: true,
        status: TaskStageStatus.COMPLETED,
      }],
    }));

    const result = await createTask('tenant-a', {
      title: 'Onboarding',
      pipelineVersionId: '7ff3c11a-4a8e-45c7-a201-56df360db96c',
      companyId,
    }, 'user-1');

    expect(mocks.outcomeUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskStageId: 'stage-1' },
      update: expect.objectContaining({ companyId }),
    }));
    expect(mocks.stageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'stage-1' },
      data: expect.objectContaining({
        status: TaskStageStatus.COMPLETED,
        completedAt: expect.any(Date),
      }),
    }));
    expect(result).toMatchObject({
      status: TaskStatus.COMPLETED,
      company: { id: companyId },
      stages: [{ id: 'stage-1', status: TaskStageStatus.COMPLETED }],
    });
  });

  it('validates and stores optional task company, owner, due date, and stage assignee', async () => {
    const dueDateInput = '2026-09-30';
    const dueDate = new Date('2026-09-30T00:00:00.000Z');
    mocks.versionFindFirst.mockResolvedValue({
      id: 'version-1',
      tenantId: 'tenant-a',
      publishedAt: new Date(),
      stages: [],
    });
    mocks.companyFindFirst.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' });
    mocks.userFindFirst.mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222' });
    mocks.taskCreate.mockResolvedValue({
      id: 'task-1',
      title: 'Annual return',
      companyId: '11111111-1111-4111-8111-111111111111',
      ownerId: '22222222-2222-4222-8222-222222222222',
      dueDate: '2026-09-30',
    });
    mocks.stageFindMany.mockResolvedValue([]);
    mocks.taskUpdate.mockResolvedValue(publicTaskRecord({
      dueDate,
    }));

    await createTask('tenant-a', {
      title: 'Annual return',
      pipelineVersionId: '7ff3c11a-4a8e-45c7-a201-56df360db96c',
      companyId: '11111111-1111-4111-8111-111111111111',
      ownerId: '22222222-2222-4222-8222-222222222222',
      dueDate: dueDateInput,
    }, 'user-1');

    expect(mocks.taskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: '11111111-1111-4111-8111-111111111111',
        ownerId: '22222222-2222-4222-8222-222222222222',
        dueDate,
      }),
    });

    mocks.stageFindFirst.mockResolvedValue({
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Manual review',
      actionType: 'MANUAL',
      status: 'NOT_STARTED',
      task: { id: 'task-1', status: 'NOT_STARTED', companyId: null, deletedAt: null },
    });
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1' });

    await updateTaskStageMetadata('tenant-a', 'stage-1', {
      assigneeId: '22222222-2222-4222-8222-222222222222',
    }, 'user-1');

    expect(mocks.userFindFirst).toHaveBeenLastCalledWith({
      where: {
        id: '22222222-2222-4222-8222-222222222222',
        tenantId: 'tenant-a',
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });
    expect(mocks.rawQuery).toHaveBeenCalled();
  });

  it('guards pause, resume, and cancellation state transitions', async () => {
    mocks.taskFindFirst.mockResolvedValue({
      id: 'task-1',
      tenantId: 'tenant-a',
      title: 'Annual return',
      companyId: null,
      status: 'COMPLETED',
      stages: [{ status: 'COMPLETED' }],
    });
    mocks.rawQuery.mockResolvedValue([{
      id: 'task-1',
      tenantId: 'tenant-a',
      title: 'Annual return',
      companyId: null,
      status: 'COMPLETED',
    }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1' });

    await expect(pauseTask('tenant-a', 'task-1', 'user-1')).rejects.toThrow('COMPLETED');
    await expect(cancelTask('tenant-a', 'task-1', 'user-1')).rejects.toThrow('COMPLETED');

    mocks.taskFindFirst.mockResolvedValue({
      id: 'task-1',
      tenantId: 'tenant-a',
      title: 'Annual return',
      companyId: null,
      status: 'CANCELLED',
      stages: [{ status: 'IN_PROGRESS' }],
    });
    mocks.rawQuery.mockResolvedValue([{
      id: 'task-1',
      tenantId: 'tenant-a',
      title: 'Annual return',
      companyId: null,
      status: 'CANCELLED',
    }]);

    await expect(resumeTask('tenant-a', 'task-1', 'user-1')).rejects.toThrow('PAUSED');

    mocks.taskFindFirst.mockResolvedValue({
      id: 'task-1',
      tenantId: 'tenant-a',
      title: 'Annual return',
      companyId: null,
      status: 'PAUSED',
      stages: [{ status: 'IN_PROGRESS' }],
    });
    mocks.rawQuery.mockResolvedValue([{
      id: 'task-1',
      tenantId: 'tenant-a',
      title: 'Annual return',
      companyId: null,
      status: 'PAUSED',
    }]);
    mocks.stageFindMany.mockResolvedValue([{ status: 'IN_PROGRESS' }]);
    mocks.taskUpdate.mockResolvedValue(publicTaskRecord({
      status: TaskStatus.IN_PROGRESS,
    }));

    await resumeTask('tenant-a', 'task-1', 'user-1');

    expect(mocks.taskUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { status: 'IN_PROGRESS' },
    }));
    expectTaskLock();
  });

  it('updates task metadata, soft deletion, checklist state, and audits each mutation', async () => {
    mocks.taskFindFirst.mockResolvedValue({
      id: 'task-1',
      tenantId: 'tenant-a',
      title: 'Old title',
      companyId: null,
      status: 'NOT_STARTED',
      stages: [],
    });
    mocks.taskUpdate.mockResolvedValue(publicTaskRecord({
      title: 'New title',
    }));

    await updateTaskMetadata('tenant-a', 'task-1', { title: 'New title' }, 'user-1');
    expect(mocks.queueEsigningPreparations).toHaveBeenCalledWith(
      'tenant-a',
      'task-1',
      'user-1',
    );
    await archiveTask('tenant-a', 'task-1', 'Duplicate task', 'user-1');

    mocks.checklistFindFirst.mockResolvedValue({
      id: 'checklist-1',
      tenantId: 'tenant-a',
      taskStageId: 'stage-1',
      label: 'Verify filing',
      taskStage: { taskId: 'task-1', task: { companyId: null } },
    });
    mocks.checklistUpdate.mockResolvedValue({ id: 'checklist-1', isCompleted: true });
    await updateTaskStageChecklistItem(
      'tenant-a',
      'checklist-1',
      { isCompleted: true },
      'user-1',
    );

    expect(mocks.taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { deletedAt: expect.any(Date), deletedReason: 'Duplicate task' },
    }));
    expect(mocks.checklistUpdate).toHaveBeenCalledWith({
      where: { id: 'checklist-1' },
      data: { isCompleted: true, completedAt: expect.any(Date) },
    });
    expect(mocks.audit).toHaveBeenCalledTimes(3);
    expect(mocks.rawQuery).toHaveBeenCalled();
  });

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
      mocks.recoveryUpsert.mockResolvedValue({ id: 'recovery-1' });
      mocks.outcomeUpsert.mockImplementation(({ where, update }: {
        where: { taskStageId: string };
        update: { companyId: string };
      }) => Promise.resolve({
        id: `outcome-${where.taskStageId}`,
        tenantId: 'tenant-a',
        taskStageId: where.taskStageId,
        type: 'COMPANY',
        companyId: update.companyId,
        generatedDocumentId: null,
        esigningEnvelopeId: null,
      }));
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

    it('completes and aligns every non-skipped Company Profile stage with metadata companyId', async () => {
      mocks.stageFindMany
        .mockResolvedValueOnce([
          {
            id: 'profile-1',
            status: TaskStageStatus.NOT_STARTED,
            startedAt: null,
            completedAt: null,
            outcome: null,
          },
          {
            id: 'profile-2',
            status: TaskStageStatus.COMPLETED,
            startedAt: new Date('2026-07-01T00:00:00.000Z'),
            completedAt: new Date('2026-07-01T00:00:00.000Z'),
            outcome: { companyId: companyB },
          },
        ])
        .mockResolvedValueOnce([
          { status: TaskStageStatus.COMPLETED },
          { status: TaskStageStatus.COMPLETED },
          { status: TaskStageStatus.SKIPPED },
        ]);

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
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          outcome: { select: { companyId: true } },
        },
      });
      expect(mocks.outcomeUpsert).toHaveBeenCalledTimes(2);
      expect(mocks.outcomeUpsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
        where: { taskStageId: 'profile-2' },
        update: expect.objectContaining({ companyId: companyA }),
      }));
      expect(mocks.recoveryUpsert).toHaveBeenCalledTimes(2);
      expect(mocks.stageUpdate).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(TaskStatus.COMPLETED);
    });

    it('clears outcomes and reopens non-skipped Company Profile stages when companyId is cleared', async () => {
      mocks.stageFindMany
        .mockResolvedValueOnce([{
          id: 'profile-1',
          status: TaskStageStatus.COMPLETED,
          startedAt: new Date('2026-07-01T00:00:00.000Z'),
          completedAt: new Date('2026-07-01T00:00:00.000Z'),
          outcome: { companyId: companyA },
        }])
        .mockResolvedValueOnce([{ status: TaskStageStatus.NOT_STARTED }]);
      mocks.taskUpdate.mockResolvedValue(publicTaskRecord());

      const result = await updateTaskMetadata(
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
          startedAt: null,
          completedAt: null,
          skipReason: null,
        },
      });
      expect(result.status).toBe(TaskStatus.NOT_STARTED);
    });

    it('leaves Company Profile stages untouched when companyId is omitted', async () => {
      mocks.taskUpdate.mockResolvedValue(publicTaskRecord({ title: 'Renamed task' }));

      await updateTaskMetadata(
        'tenant-a',
        'task-1',
        { title: 'Renamed task' },
        'user-1',
      );

      expect(mocks.stageFindMany).not.toHaveBeenCalled();
      expect(mocks.outcomeUpsert).not.toHaveBeenCalled();
      expect(mocks.outcomeDeleteMany).not.toHaveBeenCalled();
      expect(mocks.recoveryUpsert).not.toHaveBeenCalled();
      expect(mocks.stageUpdate).not.toHaveBeenCalled();
    });
  });

  it('reconciles authoritative outcomes under lock without overwriting pause', async () => {
    mocks.stageFindFirst.mockResolvedValue({
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Generate resolution',
      actionType: 'DOCUMENT_GENERATION',
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      task: { id: 'task-1', status: 'IN_PROGRESS', companyId: null, deletedAt: null },
      outcome: {
        id: 'outcome-1',
        type: 'GENERATED_DOCUMENT',
        companyId: null,
        generatedDocumentId: '25e3bf9a-25b3-469b-a797-0c754303f7bd',
        esigningEnvelopeId: null,
      },
    });
    mocks.rawQuery.mockResolvedValue([{
      id: 'task-1',
      tenantId: 'tenant-a',
      title: 'Annual return',
      companyId: null,
      status: 'PAUSED',
    }]);
    mocks.documentFindFirst.mockResolvedValue({
      id: '25e3bf9a-25b3-469b-a797-0c754303f7bd',
      title: 'Resolution',
      status: 'FINALIZED',
    });
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1', status: 'COMPLETED' });
    mocks.stageFindMany.mockResolvedValue([{ status: 'COMPLETED' }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1', status: 'PAUSED' });

    const result = await reconcileTaskStageOutcome('tenant-a', 'stage-1', 'user-1');

    expect(result.taskStatus).toBe('PAUSED');
    expect(mocks.queueEsigningPreparations).toHaveBeenCalledWith(
      'tenant-a',
      'task-1',
      'user-1',
    );
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
    expect(mocks.rawQuery.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.stageUpdate.mock.invocationCallOrder[0]);
  });

  it('reloads the stage and outcome only after locking the parent task', async () => {
    const staleStage = {
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Generate resolution',
      actionType: 'DOCUMENT_GENERATION',
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      task: { id: 'task-1', status: 'IN_PROGRESS', companyId: null, deletedAt: null },
      outcome: {
        id: 'outcome-1',
        type: 'GENERATED_DOCUMENT',
        companyId: null,
        generatedDocumentId: '11111111-1111-4111-8111-111111111111',
        esigningEnvelopeId: null,
      },
    };
    const currentStage = {
      ...staleStage,
      outcome: {
        ...staleStage.outcome,
        generatedDocumentId: '22222222-2222-4222-8222-222222222222',
      },
    };
    mocks.stageFindFirst
      .mockResolvedValueOnce(staleStage)
      .mockResolvedValueOnce(currentStage);
    mocks.rawQuery.mockResolvedValue([{
      id: 'task-1',
      tenantId: 'tenant-a',
      title: 'Annual return',
      companyId: null,
      status: 'IN_PROGRESS',
    }]);
    mocks.documentFindFirst.mockImplementation(async ({ where }: {
      where: { id: string };
    }) => ({
      id: where.id,
      title: 'Resolution',
      status: where.id === '22222222-2222-4222-8222-222222222222'
        ? 'FINALIZED'
        : 'DRAFT',
    }));
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1', status: 'COMPLETED' });
    mocks.stageFindMany.mockResolvedValue([{ status: 'COMPLETED' }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1', status: 'COMPLETED' });

    const result = await reconcileTaskStageOutcome('tenant-a', 'stage-1', 'user-1');

    expect(result.status).toBe('COMPLETED');
    expect(mocks.documentFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: '22222222-2222-4222-8222-222222222222',
      }),
    }));
    expect(mocks.stageFindFirst).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'stage-1',
        tenantId: 'tenant-a',
        task: { deletedAt: null },
      },
      select: { taskId: true },
    });
    expect(mocks.stageFindFirst.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.rawQuery.mock.invocationCallOrder[0]);
    expect(mocks.rawQuery.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.stageFindFirst.mock.invocationCallOrder[1]);
  });

  it('leaves completed MANUAL stages unchanged during outcome self-healing', async () => {
    mocks.stageFindFirst.mockResolvedValue({
      id: 'stage-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      name: 'Manual review',
      actionType: 'MANUAL',
      status: 'COMPLETED',
      startedAt: new Date(),
      completedAt: new Date(),
      task: { id: 'task-1', status: 'COMPLETED', companyId: null, deletedAt: null },
      outcome: null,
      checklistItems: [],
    });
    mocks.rawQuery.mockResolvedValue([{
      id: 'task-1',
      tenantId: 'tenant-a',
      title: 'Annual return',
      companyId: null,
      status: 'COMPLETED',
    }]);
    mocks.stageUpdate.mockResolvedValue({ id: 'stage-1', status: 'NOT_STARTED' });
    mocks.stageFindMany.mockResolvedValue([{ status: 'NOT_STARTED' }]);
    mocks.taskUpdate.mockResolvedValue({ id: 'task-1', status: 'NOT_STARTED' });

    const result = await reconcileTaskStageOutcome('tenant-a', 'stage-1', 'user-1');

    expect(result).toEqual({
      status: 'COMPLETED',
      summary: null,
      taskStatus: 'COMPLETED',
    });
    expect(mocks.stageUpdate).not.toHaveBeenCalled();
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
