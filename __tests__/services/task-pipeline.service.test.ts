import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  pipelineFindMany: vi.fn(),
  pipelineFindFirst: vi.fn(),
  pipelineCreate: vi.fn(),
  pipelineUpdate: vi.fn(),
  versionCreate: vi.fn(),
  versionUpdate: vi.fn(),
  stageCreateMany: vi.fn(),
  transaction: vi.fn(),
  rawQuery: vi.fn(),
  templateFindMany: vi.fn(),
  documentFindMany: vi.fn(),
}));

const tx = {
  taskPipeline: {
    findFirst: mocks.pipelineFindFirst,
    create: mocks.pipelineCreate,
    update: mocks.pipelineUpdate,
  },
  taskPipelineVersion: {
    create: mocks.versionCreate,
    update: mocks.versionUpdate,
  },
  taskPipelineStage: {
    createMany: mocks.stageCreateMany,
  },
  documentTemplate: { findMany: mocks.templateFindMany },
  generatedDocument: { findMany: mocks.documentFindMany },
  $queryRaw: mocks.rawQuery,
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskPipeline: {
      findMany: mocks.pipelineFindMany,
      findFirst: mocks.pipelineFindFirst,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/audit', () => ({
  createAuditLog: mocks.audit,
}));

import {
  archiveTaskPipeline,
  createTaskPipeline,
  duplicateTaskPipeline,
  listTaskPipelines,
  updateTaskPipeline,
} from '@/services/tasks/pipeline.service';

describe('task pipeline service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  });

  it('lists only active pipelines belonging to the tenant', async () => {
    mocks.pipelineFindMany.mockResolvedValue([]);

    await listTaskPipelines('tenant-a');

    expect(mocks.pipelineFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', deletedAt: null },
    }));
  });

  it('publishes a new version only after all stages have been inserted', async () => {
    mocks.pipelineCreate.mockResolvedValue({
      id: 'pipeline-1',
      tenantId: 'tenant-a',
      name: 'Onboarding',
    });
    mocks.versionCreate.mockResolvedValue({
      id: 'version-1',
      pipelineId: 'pipeline-1',
      version: 1,
      publishedAt: null,
    });
    mocks.stageCreateMany.mockResolvedValue({ count: 1 });
    mocks.versionUpdate.mockResolvedValue({
      id: 'version-1',
      pipelineId: 'pipeline-1',
      version: 1,
      publishedAt: new Date(),
    });
    const persisted = {
      id: 'pipeline-1',
      tenantId: 'tenant-a',
      name: 'Onboarding',
      versions: [{
        id: 'version-1',
        version: 1,
        stages: [{
          id: 'persisted-stage-1',
          name: 'Verify company',
          position: 0,
          actionType: 'COMPANY_PROFILE',
        }],
      }],
    };
    mocks.pipelineFindFirst.mockResolvedValue(persisted);

    const result = await createTaskPipeline('tenant-a', {
      name: 'Onboarding',
      stages: [{
        name: 'Verify company',
        actionType: 'COMPANY_PROFILE',
        checklistItems: [{ label: 'Review registered office' }],
      }],
    }, 'user-1');

    expect(mocks.versionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-a',
        pipelineId: 'pipeline-1',
        version: 1,
        publishedAt: null,
      }),
    }));
    expect(mocks.stageCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        tenantId: 'tenant-a',
        versionId: 'version-1',
        position: 0,
        actionType: 'COMPANY_PROFILE',
        actionConfig: expect.objectContaining({
          checklistItems: [{ label: 'Review registered office', position: 0 }],
        }),
      })],
    });
    expect(mocks.versionUpdate).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: { publishedAt: expect.any(Date) },
    });
    expect(mocks.versionCreate.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.stageCreateMany.mock.invocationCallOrder[0]);
    expect(mocks.stageCreateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.versionUpdate.mock.invocationCallOrder[0]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      userId: 'user-1',
      action: 'CREATE',
      entityType: 'TaskPipeline',
      entityId: 'pipeline-1',
    }), tx);
    expect(result).toEqual(persisted);
  });

  it('creates a new immutable version when a pipeline is edited', async () => {
    const existing = {
      id: 'pipeline-1',
      tenantId: 'tenant-a',
      name: 'Onboarding',
      description: null,
      versions: [{ id: 'version-2', version: 2 }],
    };
    const persisted = {
      id: 'pipeline-1',
      tenantId: 'tenant-a',
      name: 'Updated onboarding',
      versions: [{
        id: 'version-3',
        version: 3,
        stages: [{ id: 'persisted-stage-3', name: 'Manual review', position: 0 }],
      }],
    };
    mocks.pipelineFindFirst
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(persisted);
    mocks.rawQuery.mockResolvedValue([{ id: 'pipeline-1' }]);
    mocks.pipelineUpdate.mockResolvedValue({ id: 'pipeline-1' });
    mocks.versionCreate.mockResolvedValue({
      id: 'version-3',
      pipelineId: 'pipeline-1',
      version: 3,
      publishedAt: null,
    });
    mocks.stageCreateMany.mockResolvedValue({ count: 1 });
    mocks.versionUpdate.mockResolvedValue({ id: 'version-3', version: 3, publishedAt: new Date() });

    const result = await updateTaskPipeline('tenant-a', 'pipeline-1', {
      name: 'Updated onboarding',
      stages: [{ name: 'Manual review', actionType: 'MANUAL' }],
    }, 'user-1');

    expect(mocks.pipelineFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pipeline-1', tenantId: 'tenant-a', deletedAt: null },
    }));
    expect(mocks.versionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pipelineId: 'pipeline-1', version: 3, publishedAt: null }),
    }));
    const lockQuery = mocks.rawQuery.mock.calls[0]?.[0] as {
      sql?: string;
      values?: unknown[];
    } | undefined;
    expect(lockQuery?.sql).toContain('FOR UPDATE');
    expect(lockQuery?.values).toEqual(['pipeline-1', 'tenant-a']);
    expect(mocks.rawQuery.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.pipelineFindFirst.mock.invocationCallOrder[0]);
    expect(result).toEqual(persisted);
  });

  it('preserves checklist definitions when a pipeline is duplicated', async () => {
    const source = {
      id: 'pipeline-1',
      tenantId: 'tenant-a',
      name: 'Onboarding',
      description: null,
      versions: [{
        id: 'version-1',
        version: 1,
        stages: [{
          name: 'Manual review',
          description: null,
          position: 0,
          actionType: 'MANUAL',
          icon: 'CircleCheckBig',
          isRequired: true,
          actionConfig: {
            checklistItems: [{ label: 'Confirm approval', position: 0 }],
          },
        }],
      }],
    };
    const persistedCopy = {
      id: 'pipeline-copy',
      tenantId: 'tenant-a',
      name: 'Onboarding (Copy)',
      versions: [{
        id: 'version-copy',
        version: 1,
        stages: [{
          id: 'persisted-copy-stage',
          name: 'Manual review',
          position: 0,
          actionType: 'MANUAL',
        }],
      }],
    };
    mocks.pipelineFindFirst
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(persistedCopy);
    mocks.pipelineCreate.mockResolvedValue({
      id: 'pipeline-copy',
      tenantId: 'tenant-a',
      name: 'Onboarding (Copy)',
    });
    mocks.versionCreate.mockResolvedValue({
      id: 'version-copy',
      pipelineId: 'pipeline-copy',
      version: 1,
      publishedAt: null,
    });
    mocks.stageCreateMany.mockResolvedValue({ count: 1 });
    mocks.versionUpdate.mockResolvedValue({
      id: 'version-copy',
      pipelineId: 'pipeline-copy',
      version: 1,
      publishedAt: new Date(),
    });

    const result = await duplicateTaskPipeline('tenant-a', 'pipeline-1', {}, 'user-1');

    expect(mocks.stageCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        actionConfig: expect.objectContaining({
          checklistItems: [{ label: 'Confirm approval', position: 0 }],
        }),
      })],
    });
    expect(result).toEqual(persistedCopy);
  });

  it('rejects an uncurated persisted stage icon before duplicating the pipeline', async () => {
    mocks.pipelineFindFirst.mockResolvedValueOnce({
      id: 'pipeline-1',
      tenantId: 'tenant-a',
      name: 'Legacy onboarding',
      description: null,
      versions: [{
        id: 'version-1',
        version: 1,
        stages: [{
          name: 'Legacy stage',
          description: null,
          position: 0,
          actionType: 'MANUAL',
          icon: 'UntrustedIcon',
          isRequired: true,
          actionConfig: {},
        }],
      }],
    });

    await expect(
      duplicateTaskPipeline('tenant-a', 'pipeline-1', {}, 'user-1'),
    ).rejects.toThrow();

    expect(mocks.pipelineCreate).not.toHaveBeenCalled();
    expect(mocks.versionCreate).not.toHaveBeenCalled();
  });

  it('validates stage action configuration through the registry before publishing', async () => {
    await expect(createTaskPipeline('tenant-a', {
      name: 'Broken template',
      stages: [{
        name: 'Generate document',
        actionType: 'DOCUMENT_GENERATION',
        actionConfig: { templateId: 'not-a-uuid' },
      }],
    }, 'user-1')).rejects.toThrow();

    expect(mocks.pipelineCreate).not.toHaveBeenCalled();
    expect(mocks.versionCreate).not.toHaveBeenCalled();
  });

  it('rejects cross-workspace or ineligible configured module records', async () => {
    mocks.templateFindMany.mockResolvedValue([]);

    await expect(createTaskPipeline('tenant-a', {
      name: 'Foreign template',
      stages: [{
        name: 'Generate document',
        actionType: 'DOCUMENT_GENERATION',
        actionConfig: {
          templateId: '11111111-1111-4111-8111-111111111111',
        },
      }],
    }, 'user-1')).rejects.toThrow(
      'Document template must be active in this workspace',
    );

    expect(mocks.templateFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        id: { in: ['11111111-1111-4111-8111-111111111111'] },
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(mocks.pipelineCreate).not.toHaveBeenCalled();
  });

  it('soft deletes a tenant pipeline with a mandatory reason and audit record', async () => {
    mocks.pipelineFindFirst.mockResolvedValue({
      id: 'pipeline-1',
      tenantId: 'tenant-a',
      name: 'Onboarding',
      deletedAt: null,
    });
    mocks.pipelineUpdate.mockResolvedValue({ id: 'pipeline-1', deletedAt: new Date() });

    await archiveTaskPipeline('tenant-a', 'pipeline-1', 'Retired template', 'user-1');

    expect(mocks.pipelineUpdate).toHaveBeenCalledWith({
      where: { id: 'pipeline-1' },
      data: { deletedAt: expect.any(Date), deletedReason: 'Retired template' },
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE',
      reason: 'Retired template',
      entityId: 'pipeline-1',
    }), tx);
  });
});
