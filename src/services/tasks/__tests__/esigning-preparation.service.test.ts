import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stageFindMany: vi.fn(),
  preparationFindUnique: vi.fn(),
  preparationUpsert: vi.fn(),
  preparationUpdate: vi.fn(),
  preparationUpdateMany: vi.fn(),
  preparationFindMany: vi.fn(),
  queryRaw: vi.fn(),
  createEnvelope: vi.fn(),
  attachDocument: vi.fn(),
  detachDocument: vi.fn(),
  linkOutcome: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskStage: { findMany: mocks.stageFindMany },
    taskEsigningPreparation: {
      findUnique: mocks.preparationFindUnique,
      upsert: mocks.preparationUpsert,
      update: mocks.preparationUpdate,
      updateMany: mocks.preparationUpdateMany,
      findMany: mocks.preparationFindMany,
    },
    $queryRaw: mocks.queryRaw,
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
      taskEsigningPreparation: {
        updateMany: mocks.preparationUpdateMany,
      },
      $queryRaw: mocks.queryRaw,
    })),
  },
}));

vi.mock('@/services/esigning-envelope.service', () => ({
  createTaskPreparedEsigningEnvelope: mocks.createEnvelope,
  attachGeneratedDocumentToDraftEnvelope: mocks.attachDocument,
  detachGeneratedDocumentFromDraftEnvelope: mocks.detachDocument,
}));

vi.mock('@/services/tasks/stage.service', () => ({
  linkTaskStageOutcome: mocks.linkOutcome,
}));

import {
  ensureTaskEsigningPreparation,
  processQueuedTaskEsigningPreparations,
  processTaskEsigningPreparation,
  resolveTaskEsigningPreparationEligibility,
  triggerQueuedTaskEsigningPreparationProcessing,
} from '@/services/tasks/esigning-preparation.service';

const tenantId = 'tenant-a';
const taskId = 'task-1';
const taskStageId = 'esign-stage';
const documentId = '33333333-3333-4333-8333-333333333333';

function stageRows(
  reviewStatus: string = 'COMPLETED',
  documentStatus: string = 'FINALIZED',
) {
  return [
    {
      id: 'document-stage',
      name: 'Generate contract',
      position: 0,
      actionType: 'DOCUMENT_GENERATION',
      status: 'COMPLETED',
      outcome: {
        generatedDocumentId: documentId,
        generatedDocument: {
          id: documentId,
          title: 'Engagement letter',
          status: documentStatus,
          companyId: 'company-1',
          deletedAt: null,
        },
      },
    },
    {
      id: 'review-stage',
      name: 'Internal review',
      position: 1,
      actionType: 'MANUAL',
      status: reviewStatus,
      outcome: null,
    },
    {
      id: taskStageId,
      name: 'E-signing',
      position: 2,
      actionType: 'ESIGNING',
      status: 'NOT_STARTED',
      outcome: null,
    },
  ];
}

function preparation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'preparation-1',
    tenantId,
    taskId,
    taskStageId,
    sourceTaskStageId: 'document-stage',
    generatedDocumentId: documentId,
    esigningEnvelopeId: null,
    envelopeDocumentId: null,
    initiatedById: 'user-1',
    status: 'QUEUED',
    attemptCount: 0,
    availableAt: new Date('2026-07-28T00:00:00.000Z'),
    claimedAt: null,
    leaseExpiresAt: null,
    lastError: null,
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
    updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    ...overrides,
  };
}

describe('task E-signing preparation eligibility', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.stageFindMany.mockResolvedValue(stageRows());
    mocks.preparationFindUnique.mockResolvedValue(preparation());
    mocks.preparationUpsert.mockResolvedValue(preparation());
  });

  it('opens the gate when every intervening stage is completed or skipped', async () => {
    await expect(resolveTaskEsigningPreparationEligibility(
      tenantId,
      taskId,
      taskStageId,
    )).resolves.toMatchObject({
      sourceStageId: 'document-stage',
      generatedDocumentId: documentId,
      ready: true,
      blockingStage: null,
    });

    mocks.stageFindMany.mockResolvedValue(stageRows('SKIPPED'));
    await expect(resolveTaskEsigningPreparationEligibility(
      tenantId,
      taskId,
      taskStageId,
    )).resolves.toMatchObject({ ready: true, blockingStage: null });
  });

  it('reports the first uncleared intervening stage', async () => {
    mocks.stageFindMany.mockResolvedValue(stageRows('IN_PROGRESS'));

    await expect(resolveTaskEsigningPreparationEligibility(
      tenantId,
      taskId,
      taskStageId,
    )).resolves.toMatchObject({
      ready: false,
      blockingStage: {
        id: 'review-stage',
        name: 'Internal review',
        status: 'IN_PROGRESS',
      },
    });
  });

  it('uses the nearest preceding document stage', async () => {
    mocks.stageFindMany.mockResolvedValue([
      ...stageRows().slice(0, 2),
      {
        id: 'document-stage-2',
        name: 'Generate amendment',
        position: 2,
        actionType: 'DOCUMENT_GENERATION',
        status: 'COMPLETED',
        outcome: {
          generatedDocumentId: '44444444-4444-4444-8444-444444444444',
          generatedDocument: {
            id: '44444444-4444-4444-8444-444444444444',
            title: 'Amendment',
            status: 'FINALIZED',
            companyId: 'company-1',
            deletedAt: null,
          },
        },
      },
      { ...stageRows()[2], position: 3 },
    ]);

    await expect(resolveTaskEsigningPreparationEligibility(
      tenantId,
      taskId,
      taskStageId,
    )).resolves.toMatchObject({
      sourceStageId: 'document-stage-2',
      generatedDocumentId: '44444444-4444-4444-8444-444444444444',
      ready: true,
    });
  });

  it('queues one durable record without replacing its existing envelope or initiator', async () => {
    await ensureTaskEsigningPreparation({
      tenantId,
      taskId,
      taskStageId,
      initiatedById: 'user-1',
    });

    expect(mocks.preparationUpsert).toHaveBeenCalledWith({
      where: { taskStageId },
      create: expect.objectContaining({
        tenantId,
        taskId,
        taskStageId,
        sourceTaskStageId: 'document-stage',
        generatedDocumentId: documentId,
        initiatedById: 'user-1',
        status: 'QUEUED',
      }),
      update: expect.not.objectContaining({
        esigningEnvelopeId: expect.anything(),
        initiatedById: expect.anything(),
      }),
    });
  });

  it('attributes a legacy preparation that does not yet have an initiator', async () => {
    mocks.preparationFindUnique.mockResolvedValue(preparation({ initiatedById: null }));

    await ensureTaskEsigningPreparation({
      tenantId,
      taskId,
      taskStageId,
      initiatedById: 'user-2',
    });

    expect(mocks.preparationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ initiatedById: 'user-2' }),
    }));
  });

  it('keeps an already converged preparation ready', async () => {
    mocks.preparationFindUnique.mockResolvedValue(preparation({
      status: 'READY',
      esigningEnvelopeId: 'envelope-1',
      envelopeDocumentId: 'envelope-document-1',
    }));

    await ensureTaskEsigningPreparation({ tenantId, taskId, taskStageId });

    expect(mocks.preparationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'READY' }),
    }));
  });

  it('queues detachment when a prepared source becomes unfinalized', async () => {
    mocks.stageFindMany.mockResolvedValue(stageRows('COMPLETED', 'DRAFT'));
    mocks.preparationFindUnique.mockResolvedValue(preparation({
      status: 'READY',
      esigningEnvelopeId: 'envelope-1',
      envelopeDocumentId: 'envelope-document-1',
    }));

    await ensureTaskEsigningPreparation({ tenantId, taskId, taskStageId });

    expect(mocks.preparationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'QUEUED' }),
    }));
  });
});

describe('task E-signing preparation worker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.stageFindMany.mockResolvedValue(stageRows());
    mocks.preparationFindUnique.mockResolvedValue(preparation({
      status: 'PROCESSING',
      claimedAt: new Date('2026-07-28T00:01:00.000Z'),
      leaseExpiresAt: new Date('2026-07-28T00:06:00.000Z'),
    }));
    mocks.createEnvelope.mockResolvedValue({ id: 'envelope-1' });
    mocks.attachDocument.mockResolvedValue({ envelopeDocumentId: 'envelope-document-1' });
    mocks.linkOutcome.mockResolvedValue({});
    mocks.preparationUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('creates one envelope, attaches the generated PDF, and marks the preparation ready', async () => {
    await processTaskEsigningPreparation('preparation-1');

    expect(mocks.createEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      taskContext: { taskId, taskStageId },
      createdById: 'user-1',
      title: 'Engagement letter',
    }));
    expect(mocks.attachDocument).toHaveBeenCalledWith({
      tenantId,
      envelopeId: 'envelope-1',
      generatedDocumentId: documentId,
      actorUserId: 'user-1',
    });
    expect(mocks.linkOutcome).toHaveBeenCalledWith(
      tenantId,
      taskStageId,
      {
        type: 'ESIGNING_ENVELOPE',
        esigningEnvelopeId: 'envelope-1',
      },
      'user-1',
    );
    expect(mocks.preparationUpdateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        id: 'preparation-1',
        status: 'PROCESSING',
      }),
      data: expect.objectContaining({
        status: 'READY',
        esigningEnvelopeId: 'envelope-1',
        envelopeDocumentId: 'envelope-document-1',
        lastError: null,
      }),
    });
  });

  it('detaches an unfinalized source while preserving the existing envelope', async () => {
    mocks.stageFindMany.mockResolvedValue(stageRows('COMPLETED', 'DRAFT'));
    mocks.preparationFindUnique.mockResolvedValue(preparation({
      esigningEnvelopeId: 'envelope-1',
      envelopeDocumentId: 'envelope-document-1',
      status: 'PROCESSING',
      claimedAt: new Date('2026-07-28T00:01:00.000Z'),
      leaseExpiresAt: new Date('2026-07-28T00:06:00.000Z'),
    }));

    await processTaskEsigningPreparation('preparation-1');

    expect(mocks.detachDocument).toHaveBeenCalledWith({
      tenantId,
      envelopeId: 'envelope-1',
      generatedDocumentId: documentId,
      actorUserId: 'user-1',
    });
    expect(mocks.createEnvelope).not.toHaveBeenCalled();
    expect(mocks.preparationUpdateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: 'preparation-1' }),
      data: expect.objectContaining({
        status: 'WAITING',
        envelopeDocumentId: null,
      }),
    });
    expect(mocks.preparationUpdateMany.mock.calls.at(-1)?.[0]?.data)
      .not.toHaveProperty('esigningEnvelopeId');
  });

  it('detaches the previously attached document when the source outcome changes', async () => {
    mocks.stageFindMany.mockResolvedValue(stageRows('COMPLETED', 'DRAFT').map((stage) => (
      stage.id === 'document-stage'
        ? {
          ...stage,
          outcome: {
            generatedDocumentId: 'new-document',
            generatedDocument: {
              id: 'new-document',
              title: 'Replacement',
              status: 'DRAFT',
              companyId: 'company-1',
              deletedAt: null,
            },
          },
        }
        : stage
    )));
    mocks.preparationFindUnique.mockResolvedValue(preparation({
      generatedDocumentId: 'new-document',
      esigningEnvelopeId: 'envelope-1',
      envelopeDocumentId: 'envelope-document-1',
      envelopeDocument: { generatedDocumentId: documentId },
      status: 'PROCESSING',
      claimedAt: new Date('2026-07-28T00:01:00.000Z'),
    }));

    await processTaskEsigningPreparation('preparation-1');

    expect(mocks.detachDocument).toHaveBeenCalledWith(expect.objectContaining({
      generatedDocumentId: documentId,
    }));
  });

  it('claims due jobs with skip-locked SQL before bounded processing', async () => {
    mocks.queryRaw.mockResolvedValue([{ id: 'preparation-1' }]);

    await processQueuedTaskEsigningPreparations({ limit: 2, concurrency: 1 });

    expect(mocks.queryRaw).toHaveBeenCalled();
    expect(String(mocks.queryRaw.mock.calls[0]?.[0]?.sql))
      .toContain('SKIP LOCKED');
    expect(mocks.preparationFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'preparation-1' },
    }));
  });

  it('runs another immediate batch when work arrives during processing', async () => {
    let releaseFirstClaim: ((value: Array<{ id: string }>) => void) | undefined;
    mocks.queryRaw
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseFirstClaim = resolve;
      }))
      .mockResolvedValueOnce([]);

    triggerQueuedTaskEsigningPreparationProcessing();
    triggerQueuedTaskEsigningPreparationProcessing();
    releaseFirstClaim?.([]);

    await vi.waitFor(() => {
      expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    });
  });
});
