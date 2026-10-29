import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getStageActionAdapter: vi.fn(),
  resolveTemplateIdsForNewRun: vi.fn(),
  launch: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskStage: { findFirst: mocks.findFirst },
    documentGenerationBatch: { findFirst: vi.fn(async () => null) },
    generatedDocument: { findFirst: vi.fn(async () => null) },
  },
}));

vi.mock('@/services/tasks/action-registry', async (importOriginal) => ({
  getStageActionAdapter: mocks.getStageActionAdapter,
  readDocumentStageTemplateIds: (await importOriginal<typeof import('@/services/tasks/action-registry')>())
    .readDocumentStageTemplateIds,
  resolveStageActionOutcome: vi.fn(),
}));

vi.mock('@/services/oakdoc-migration.service', () => ({
  resolveTemplateIdsForNewRun: mocks.resolveTemplateIdsForNewRun,
}));

import { getTaskStageDetail } from '@/services/tasks/stage.service';
import type { TaskStageDetail } from '@/services/tasks/types';

describe('getTaskStageDetail timestamps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStageActionAdapter.mockReturnValue({
      blockers: () => [],
      launch: mocks.launch.mockReturnValue({
        href: null,
        context: { taskId: 'task-1', taskStageId: 'stage-1' },
      }),
      outcomeSummary: () => null,
    });
  });

  it('returns tenant-scoped stage timestamps as nullable ISO fields', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'stage-1',
      taskId: 'task-1',
      tenantId: 'workspace-1',
      name: 'Review records',
      description: null,
      position: 0,
      actionType: 'MANUAL',
      icon: 'CircleCheckBig',
      isRequired: true,
      status: 'IN_PROGRESS',
      notes: null,
      skipReason: null,
      assigneeId: null,
      assignee: null,
      checklistItems: [],
      outcome: null,
      startedAt: new Date('2026-07-26T02:30:00.000Z'),
      completedAt: null,
      task: {
        id: 'task-1',
        status: 'IN_PROGRESS',
        companyId: null,
        deletedAt: null,
      },
    });

    const detail = await getTaskStageDetail(
      'workspace-1',
      'task-1',
      'stage-1',
    );
    const timestamps: Pick<TaskStageDetail, 'startedAt' | 'completedAt'> = detail;

    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'stage-1',
        taskId: 'task-1',
        tenantId: 'workspace-1',
      }),
    }));
    expect(timestamps.startedAt).toBe('2026-07-26T02:30:00.000Z');
    expect(timestamps.completedAt).toBeNull();
  });

  it('launches a new document run with the approved Word replacements of configured templates', async () => {
    const legacyId = '11111111-1111-4111-8111-111111111111';
    const replacementId = '33333333-3333-4333-8333-333333333333';
    mocks.resolveTemplateIdsForNewRun.mockResolvedValue([replacementId]);
    mocks.findFirst.mockResolvedValue({
      id: 'stage-1',
      taskId: 'task-1',
      tenantId: 'workspace-1',
      name: 'Generate letter',
      description: null,
      position: 0,
      actionType: 'DOCUMENT_GENERATION',
      actionConfig: { templateId: legacyId },
      icon: 'FileText',
      isRequired: true,
      status: 'NOT_STARTED',
      notes: null,
      skipReason: null,
      assigneeId: null,
      assignee: null,
      checklistItems: [],
      outcome: null,
      startedAt: null,
      completedAt: null,
      task: { id: 'task-1', status: 'IN_PROGRESS', companyId: null, deletedAt: null },
    });

    await getTaskStageDetail('workspace-1', 'task-1', 'stage-1');

    expect(mocks.resolveTemplateIdsForNewRun).toHaveBeenCalledWith([legacyId], 'workspace-1');
    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      resolvedTemplateIds: [replacementId],
      stage: expect.objectContaining({ actionConfig: { templateId: legacyId } }),
    }));
  });
});
