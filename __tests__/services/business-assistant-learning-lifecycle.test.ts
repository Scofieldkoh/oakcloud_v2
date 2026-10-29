import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeFindUnique: vi.fn(), activeUpdateMany: vi.fn(), activeCreate: vi.fn(),
  changeFindMany: vi.fn(), changeUpdateMany: vi.fn(), auditCreate: vi.fn(),
  backupFindMany: vi.fn(), access: vi.fn(), operationBarrier: vi.fn(), resolveFreshActor: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: {
  businessAssistantLearningActiveTarget: { findUnique: mocks.activeFindUnique },
} }));
vi.mock('@/lib/prisma-transaction', () => ({ runSerializableTransaction: async (_db: unknown, run: (tx: unknown) => unknown) => run({
  businessAssistantLearningActiveTarget: { findUnique: mocks.activeFindUnique, updateMany: mocks.activeUpdateMany, create: mocks.activeCreate },
  businessAssistantLearningChange: { findMany: mocks.changeFindMany, updateMany: mocks.changeUpdateMany },
  auditLog: { create: mocks.auditCreate },
  workspaceBackup: { findMany: mocks.backupFindMany },
}) }));
vi.mock('@/lib/business-operation-backup-barrier', () => ({ acquireBusinessOperationBarrier: mocks.operationBarrier }));
vi.mock('@/lib/fresh-authorization', () => ({ resolveFreshActor: mocks.resolveFreshActor }));
vi.mock('@/services/business-assistant/policy.service', () => ({ assertAssistantAdministrativeAccess: mocks.access }));

import {
  deactivateLearningConfiguration,
  deleteLearningConfiguration,
  expireLearningConfiguration,
  getLearningTargetLifecycle,
} from '@/services/business-assistant/learning-lifecycle.service';
import {
  createLearningActiveEnvelope,
  decodeLearningActiveValue,
} from '@/services/business-assistant/learning-active-target';
import { learningTargetDefinition } from '@/services/business-assistant/learning-targets';

const actor = { userId: 'admin-1', tenantId: 'workspace-1', requestId: 'request-1' };
const definition = learningTargetDefinition('assistant.response_detail')!;
const activatedAt = new Date('2026-01-01T00:00:00.000Z');
const activeEnvelope = createLearningActiveEnvelope(definition, 'detailed', 'change-1', activatedAt);
const activeTarget = {
  id: 'target-1', tenantId: 'workspace-1', targetKey: 'assistant.response_detail',
  activeVersion: '2', activeValue: activeEnvelope, previousVersion: '1', previousValue: 'concise',
  activeChangeId: 'change-1', revision: 7, updatedById: 'admin-1', createdAt: activatedAt, updatedAt: activatedAt,
};
const activeClock = new Date('2026-01-02T00:00:00.000Z');

describe('Business Assistant learning target lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ isAdmin: true });
    mocks.resolveFreshActor.mockResolvedValue({ isWorkspaceAdmin: true, isSuperAdmin: false, internalRole: 'ADMIN' });
    mocks.backupFindMany.mockResolvedValue([]);
    mocks.operationBarrier.mockResolvedValue(undefined);
    mocks.activeFindUnique.mockResolvedValue(activeTarget);
    mocks.activeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.activeCreate.mockImplementation(({ data }) => ({ id: 'target-created', revision: 1, ...data }));
    mocks.changeFindMany.mockResolvedValue([]);
    mocks.changeUpdateMany.mockResolvedValue({ count: 0 });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
  });

  it('deactivates with revision CAS and removes the runtime value from the active pointer', async () => {
    const result = await deactivateLearningConfiguration(actor, 'assistant.response_detail', 7, activeClock);
    expect(result).toMatchObject({ state: 'DEACTIVATED', revision: 8, activeChangeId: null });
    const update = mocks.activeUpdateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({ id: 'target-1', tenantId: 'workspace-1', targetKey: 'assistant.response_detail', activeVersion: '2', revision: 7 });
    const decoded = decodeLearningActiveValue('assistant.response_detail', update.data.activeValue);
    expect(decoded).toMatchObject({ state: 'DEACTIVATED', value: null, changeId: 'change-1' });
    expect(JSON.stringify(update.data.activeValue)).not.toContain('detailed');
    expect(update.data.activeChangeId).toBeNull();
  });

  it('does not allow expiry before the source-controlled activation TTL has elapsed', async () => {
    await expect(expireLearningConfiguration(actor, 'assistant.response_detail', 7, activeClock))
      .rejects.toThrow('has not reached');
    expect(mocks.activeUpdateMany).not.toHaveBeenCalled();
  });

  it('expires a due target and clears the rollback pointer to the promoted change', async () => {
    const afterExpiry = new Date('2026-05-01T00:00:00.000Z');
    const result = await expireLearningConfiguration(actor, 'assistant.response_detail', 7, afterExpiry);
    expect(result).toMatchObject({ state: 'EXPIRED', revision: 8, activeChangeId: null });
    expect(mocks.activeUpdateMany.mock.calls[0][0].data.activeChangeId).toBeNull();
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ summary: 'Expired governed learning configuration' }) }));
  });

  it('fails closed on a stale lifecycle revision', async () => {
    await expect(deactivateLearningConfiguration(actor, 'assistant.response_detail', 6, activeClock)).rejects.toThrow('changed; refresh');
    expect(mocks.activeUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('prevents a CAS loser from recording a lifecycle event', async () => {
    mocks.activeUpdateMany.mockResolvedValue({ count: 0 });
    await expect(deactivateLearningConfiguration(actor, 'assistant.response_detail', 7, activeClock)).rejects.toThrow('changed during');
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('deletes an active target, destroys rollback payloads, and scrubs every tenant candidate payload', async () => {
    mocks.changeFindMany.mockResolvedValue([
      { id: 'change-1', ownerId: 'admin-1', baselineVersion: '1', candidateVersion: '2', state: 'PROMOTED' },
      { id: 'change-2', ownerId: 'admin-2', baselineVersion: '2', candidateVersion: '3', state: 'EVALUATED' },
    ]);
    mocks.changeUpdateMany.mockResolvedValue({ count: 2 });
    const result = await deleteLearningConfiguration(actor, 'assistant.response_detail', 7, new Date('2026-01-03T00:00:00.000Z'));
    expect(result).toMatchObject({ state: 'DELETED', revision: 8, activeChangeId: null });
    const targetUpdate = mocks.activeUpdateMany.mock.calls[0][0];
    expect(targetUpdate.data).toMatchObject({ previousVersion: null, activeChangeId: null });
    expect(targetUpdate.data.previousValue).toBeDefined();
    const decoded = decodeLearningActiveValue('assistant.response_detail', targetUpdate.data.activeValue);
    expect(decoded).toMatchObject({ state: 'DELETED', value: null, valueDigest: null });
    expect(mocks.changeUpdateMany).toHaveBeenCalledWith({
      where: { tenantId: 'workspace-1', targetKey: 'assistant.response_detail' },
      data: expect.objectContaining({ candidateValue: expect.anything(), state: 'REJECTED', approvedById: null, promotedAt: null, rollbackTarget: null }),
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: 'DELETE', entityType: 'BUSINESS_ASSISTANT_LEARNING_TARGET',
      metadata: expect.objectContaining({ removedCandidatePayloadCount: 2 }),
    }) }));
  });

  it('creates a deletion tombstone even when no active row exists so retained candidates cannot resurrect it', async () => {
    mocks.activeFindUnique.mockResolvedValue(null);
    mocks.changeFindMany.mockResolvedValue([{ id: 'change-old', ownerId: 'admin-1', baselineVersion: '1', candidateVersion: '2', state: 'REJECTED' }]);
    const result = await deleteLearningConfiguration(actor, 'preference.response_detail', 0);
    expect(result).toMatchObject({ targetKey: 'assistant.response_detail', state: 'DELETED', revision: 1 });
    expect(mocks.activeCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId: 'workspace-1', targetKey: 'assistant.response_detail', activeVersion: '1', activeChangeId: null,
    }) }));
  });

  it('rechecks administrator authority inside the same barrier-protected transaction', async () => {
    mocks.resolveFreshActor.mockResolvedValue({ isWorkspaceAdmin: false, isSuperAdmin: false, internalRole: 'STAFF' });
    await expect(deactivateLearningConfiguration(actor, 'assistant.response_detail', 7, activeClock)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.activeUpdateMany).not.toHaveBeenCalled();
  });

  it('never crosses workspace boundaries in lifecycle reads or writes', async () => {
    await deactivateLearningConfiguration(actor, 'assistant.response_detail', 7, activeClock);
    expect(mocks.activeFindUnique).toHaveBeenCalledWith({ where: { tenantId_targetKey: { tenantId: 'workspace-1', targetKey: 'assistant.response_detail' } } });
    expect(mocks.activeUpdateMany.mock.calls[0][0].where.tenantId).toBe('workspace-1');
    expect(mocks.auditCreate.mock.calls[0][0].data.tenantId).toBe('workspace-1');
  });

  it('reports lazy expiry from the runtime envelope even before an explicit expiry transition runs', async () => {
    const status = await getLearningTargetLifecycle('workspace-1', 'assistant.response_detail', new Date('2026-05-01T00:00:00.000Z'));
    expect(status).toMatchObject({ state: 'EXPIRED', revision: 7, activeChangeId: 'change-1' });
  });
});