import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireTaskAccess: vi.fn(),
  requirePermission: vi.fn(),
  getPreparation: vi.fn(),
  ensurePreparation: vi.fn(),
  retryPreparation: vi.fn(),
  triggerPreparation: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-helpers')>();
  return {
    ...actual,
    requireSessionWorkspaceId: () => 'tenant-a',
  };
});

vi.mock('@/lib/rbac', () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock('@/services/tasks/access', () => ({
  requireTaskAccess: mocks.requireTaskAccess,
}));

vi.mock('@/services/tasks/esigning-preparation.service', () => ({
  getTaskEsigningPreparation: mocks.getPreparation,
  ensureTaskEsigningPreparation: mocks.ensurePreparation,
  retryTaskEsigningPreparation: mocks.retryPreparation,
  triggerQueuedTaskEsigningPreparationProcessing: mocks.triggerPreparation,
}));

import {
  GET,
  POST,
} from '@/app/api/tasks/[taskId]/stages/[stageId]/esigning-preparation/route';
import { POST as retryPOST } from '@/app/api/tasks/[taskId]/stages/[stageId]/esigning-preparation/retry/route';

const context = {
  params: Promise.resolve({
    taskId: '11111111-1111-4111-8111-111111111111',
    stageId: '22222222-2222-4222-8222-222222222222',
  }),
};
const snapshot = {
  id: 'preparation-1',
  taskId: '11111111-1111-4111-8111-111111111111',
  taskStageId: '22222222-2222-4222-8222-222222222222',
  status: 'QUEUED',
  blockingStage: null,
  generatedDocumentId: '33333333-3333-4333-8333-333333333333',
  esigningEnvelopeId: null,
  lastError: null,
};

describe('task E-signing preparation routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuth.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-a',
      isSuperAdmin: false,
    });
    mocks.getPreparation.mockResolvedValue(snapshot);
    mocks.ensurePreparation.mockResolvedValue(snapshot);
    mocks.retryPreparation.mockResolvedValue(snapshot);
  });

  it('returns tenant-scoped preparation status with task read access', async () => {
    const response = await GET(new Request('http://localhost') as never, context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(mocks.requireTaskAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'tenant-a',
      snapshot.taskId,
      'read',
    );
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      expect.anything(),
      'document',
      'read',
    );
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      expect.anything(),
      'esigning',
      'read',
    );
    expect(mocks.getPreparation).toHaveBeenCalledWith(
      'tenant-a',
      snapshot.taskId,
      snapshot.taskStageId,
    );
  });

  it('ensures legacy preparation only after task, document, and E-signing permissions', async () => {
    const response = await POST(new Request('http://localhost', {
      method: 'POST',
    }) as never, context);

    expect(response.status).toBe(200);
    expect(mocks.requireTaskAccess).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-a',
      snapshot.taskId,
      'update',
    );
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      expect.anything(),
      'document',
      'read',
    );
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      expect.anything(),
      'esigning',
      'create',
    );
    expect(mocks.ensurePreparation).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      taskId: snapshot.taskId,
      taskStageId: snapshot.taskStageId,
      initiatedById: 'user-1',
    });
    expect(mocks.triggerPreparation).toHaveBeenCalledTimes(1);
  });

  it('retries the same scoped preparation after update permissions', async () => {
    const response = await retryPOST(new Request('http://localhost', {
      method: 'POST',
    }) as never, context);

    expect(response.status).toBe(200);
    expect(mocks.retryPreparation).toHaveBeenCalledWith(
      'tenant-a',
      snapshot.taskId,
      snapshot.taskStageId,
    );
  });
});
