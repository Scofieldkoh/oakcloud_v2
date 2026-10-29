import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  access: vi.fn(), freshActor: vi.fn(), barrier: vi.fn(), backups: vi.fn(),
  feedbackFindFirst: vi.fn(), memoryFindFirst: vi.fn(), activeFindUnique: vi.fn(),
  learningFindFirst: vi.fn(), learningCreate: vi.fn(), auditCreate: vi.fn(),
  derivedFindMany: vi.fn(), activeFindMany: vi.fn(), activeUpdateMany: vi.fn(), derivedUpdateMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/prisma-transaction', () => ({ runSerializableTransaction: async (_db: unknown, run: (tx: unknown) => unknown) => run({
  businessAssistantFeedback: { findFirst: mocks.feedbackFindFirst },
  businessAssistantMemory: { findFirst: mocks.memoryFindFirst },
  businessAssistantLearningActiveTarget: {
    findUnique: mocks.activeFindUnique,
    findMany: mocks.activeFindMany,
    updateMany: mocks.activeUpdateMany,
  },
  businessAssistantLearningChange: {
    findFirst: mocks.learningFindFirst,
    create: mocks.learningCreate,
    findMany: mocks.derivedFindMany,
    updateMany: mocks.derivedUpdateMany,
  },
  workspaceBackup: { findMany: mocks.backups },
  auditLog: { create: mocks.auditCreate },
}) }));
vi.mock('@/lib/business-operation-backup-barrier', () => ({ acquireBusinessOperationBarrier: mocks.barrier }));
vi.mock('@/lib/fresh-authorization', () => ({ resolveFreshActor: mocks.freshActor }));
vi.mock('@/services/business-assistant/policy.service', () => ({ assertAssistantAdministrativeAccess: mocks.access }));

import { deriveLearningCandidateFromFeedback } from '@/services/business-assistant/learning-derivation.service';
import { eraseLearningDerivedFromMemory } from '@/services/business-assistant/learning-derived-cleanup';
import { createLearningLifecycleMarker } from '@/services/business-assistant/learning-active-target';
import { learningTargetDefinition } from '@/services/business-assistant/learning-targets';

const actor = { userId: 'admin-1', tenantId: 'workspace-1', requestId: 'request-1' };
const activeMemory = {
  id: 'memory-1', key: 'response_detail', value: 'detailed', version: 3,
  scope: 'USER', capabilityId: 'assistant.answer', capabilityVersion: '1.0', expiresAt: null,
};
const feedback = { id: 'feedback-1', targetId: 'memory-1', eventType: 'CORRECTNESS', adjudication: 'PENDING' };

describe('Business Assistant governed learning derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ isAdmin: true });
    mocks.freshActor.mockResolvedValue({ isWorkspaceAdmin: true, isSuperAdmin: false, internalRole: 'ADMIN' });
    mocks.barrier.mockResolvedValue(undefined);
    mocks.backups.mockResolvedValue([]);
    mocks.feedbackFindFirst.mockResolvedValue(feedback);
    mocks.memoryFindFirst.mockResolvedValue(activeMemory);
    mocks.activeFindUnique.mockResolvedValue(null);
    mocks.learningFindFirst.mockResolvedValue(null);
    mocks.learningCreate.mockImplementation(({ data }) => ({ id: 'candidate-1', ...data }));
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
    mocks.derivedFindMany.mockResolvedValue([]);
    mocks.activeFindMany.mockResolvedValue([]);
    mocks.activeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.derivedUpdateMany.mockResolvedValue({ count: 0 });
  });

  it('derives only a CANDIDATE from a confirmed preference value and never from feedback text', async () => {
    const result = await deriveLearningCandidateFromFeedback(actor, 'feedback-1', '2');
    expect(result).toEqual({
      candidateId: 'candidate-1', targetKey: 'assistant.response_detail', baselineVersion: '1',
      candidateVersion: '2', state: 'CANDIDATE', sourceMemoryId: 'memory-1', sourceFeedbackId: 'feedback-1',
    });
    const create = mocks.learningCreate.mock.calls[0][0].data;
    expect(create).toMatchObject({
      tenantId: 'workspace-1', ownerId: 'admin-1', targetKey: 'assistant.response_detail',
      targetKind: 'PREFERENCE', baselineVersion: '1', candidateVersion: '2', candidateValue: 'detailed', state: 'CANDIDATE',
      evidence: expect.objectContaining({ source: 'CONFIRMED_MEMORY_FEEDBACK', memoryId: 'memory-1', feedbackId: 'feedback-1' }),
    });
    expect(JSON.stringify(create.evidence)).not.toContain('comment');
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId: 'workspace-1', userId: 'admin-1', entityType: 'BUSINESS_ASSISTANT_LEARNING_DERIVATION', entityId: 'candidate-1',
    }) }));
  });

  it('cannot derive from an inferred or unconfirmed preference candidate', async () => {
    mocks.memoryFindFirst.mockResolvedValue(null);
    await expect(deriveLearningCandidateFromFeedback(actor, 'feedback-1', '2')).rejects.toThrow('not currently confirmed and active');
    expect(mocks.learningCreate).not.toHaveBeenCalled();
  });

  it('cannot derive persistent learning from a session-only current-turn preference', async () => {
    mocks.memoryFindFirst.mockResolvedValue(null);
    await expect(deriveLearningCandidateFromFeedback(actor, 'feedback-1', '2')).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
    const where = mocks.memoryFindFirst.mock.calls[0][0].where;
    expect(where.scope).toEqual({ in: ['USER', 'TENANT'] });
  });

  it('rejects a confirmed preference scoped to another capability or capability version', async () => {
    mocks.memoryFindFirst.mockResolvedValueOnce({ ...activeMemory, capabilityId: 'workspace.resource_lookup' });
    await expect(deriveLearningCandidateFromFeedback(actor, 'feedback-1', '2')).rejects.toThrow('another capability');
    mocks.memoryFindFirst.mockResolvedValueOnce({ ...activeMemory, capabilityVersion: '2.0' });
    await expect(deriveLearningCandidateFromFeedback(actor, 'feedback-1', '2')).rejects.toThrow('another capability version');
    expect(mocks.learningCreate).not.toHaveBeenCalled();
  });

  it('never accepts a caller-selected arbitrary target; the target is derived from the confirmed memory key', async () => {
    mocks.memoryFindFirst.mockResolvedValue({ ...activeMemory, key: 'database.url', value: 'postgres://attacker' });
    await expect(deriveLearningCandidateFromFeedback(actor, 'feedback-1', '2')).rejects.toThrow('not an allowlisted learning target');
    expect(mocks.learningCreate).not.toHaveBeenCalled();
  });

  it('does not resurrect a deleted target from retained feedback or memory data', async () => {
    const definition = learningTargetDefinition('assistant.response_detail')!;
    mocks.activeFindUnique.mockResolvedValue({
      activeVersion: '4',
      activeValue: createLearningLifecycleMarker(definition, 'DELETED', { lifecycleAt: new Date('2026-09-10T00:00:00.000Z') }),
    });
    await expect(deriveLearningCandidateFromFeedback(actor, 'feedback-1', '5')).rejects.toThrow('cannot be recreated from derived data');
    expect(mocks.learningCreate).not.toHaveBeenCalled();
  });

  it('reuses only the exact still-live derived CANDIDATE and does not fabricate a new state', async () => {
    mocks.learningFindFirst.mockResolvedValue({ id: 'candidate-existing', baselineVersion: '1', candidateVersion: '2', state: 'CANDIDATE' });
    const result = await deriveLearningCandidateFromFeedback(actor, 'feedback-1', '2');
    expect(result).toMatchObject({ candidateId: 'candidate-existing', state: 'CANDIDATE' });
    expect(mocks.learningFindFirst.mock.calls[0][0].where.state).toBe('CANDIDATE');
    expect(mocks.learningCreate).not.toHaveBeenCalled();
  });

  it('rechecks administrator authority inside the barrier-protected derivation transaction', async () => {
    mocks.freshActor.mockResolvedValue({ isWorkspaceAdmin: false, isSuperAdmin: false, internalRole: 'STAFF' });
    await expect(deriveLearningCandidateFromFeedback(actor, 'feedback-1', '2')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.feedbackFindFirst).not.toHaveBeenCalled();
    expect(mocks.learningCreate).not.toHaveBeenCalled();
  });

  it('binds all derivation reads and writes to the actor workspace and owner', async () => {
    await deriveLearningCandidateFromFeedback(actor, 'feedback-1', '2');
    expect(mocks.feedbackFindFirst.mock.calls[0][0].where).toMatchObject({ tenantId: 'workspace-1', ownerId: 'admin-1' });
    expect(mocks.memoryFindFirst.mock.calls[0][0].where).toMatchObject({ tenantId: 'workspace-1', ownerId: 'admin-1' });
    expect(mocks.activeFindUnique.mock.calls[0][0].where.tenantId_targetKey.tenantId).toBe('workspace-1');
  });
});

describe('learning descendants of deleted memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditCreate.mockResolvedValue({ id: 'audit-cleanup' });
    mocks.activeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.derivedUpdateMany.mockResolvedValue({ count: 2 });
  });

  it('atomically deactivates active derived targets and scrubs every derived candidate payload', async () => {
    mocks.derivedFindMany.mockResolvedValue([
      { id: 'candidate-1', targetKey: 'assistant.response_detail', baselineVersion: '1', candidateVersion: '2', state: 'PROMOTED' },
      { id: 'candidate-2', targetKey: 'assistant.response_detail', baselineVersion: '2', candidateVersion: '3', state: 'EVALUATED' },
    ]);
    mocks.activeFindMany.mockResolvedValue([{
      id: 'target-1', tenantId: 'workspace-1', targetKey: 'assistant.response_detail',
      activeVersion: '2', activeValue: 'detailed', activeChangeId: 'candidate-1', revision: 5,
      previousVersion: '1', previousValue: 'concise', updatedById: 'admin-1', createdAt: new Date(), updatedAt: new Date(),
    }]);
    const tx = {
      businessAssistantLearningChange: { findMany: mocks.derivedFindMany, updateMany: mocks.derivedUpdateMany },
      businessAssistantLearningActiveTarget: { findMany: mocks.activeFindMany, updateMany: mocks.activeUpdateMany },
      auditLog: { create: mocks.auditCreate },
    } as never;

    const result = await eraseLearningDerivedFromMemory(tx, actor, 'memory-1');
    expect(result).toEqual({ removedCandidates: 2, deactivatedTargets: 1 });
    const targetUpdate = mocks.activeUpdateMany.mock.calls[0][0];
    expect(targetUpdate.where).toMatchObject({
      id: 'target-1', tenantId: 'workspace-1', targetKey: 'assistant.response_detail',
      activeChangeId: 'candidate-1', activeVersion: '2', revision: 5,
    });
    expect(targetUpdate.data).toMatchObject({ previousVersion: null, activeChangeId: null, updatedById: 'admin-1' });
    expect(JSON.stringify(targetUpdate.data.activeValue)).not.toContain('detailed');
    expect(mocks.derivedUpdateMany.mock.calls[0][0].where).toMatchObject({ tenantId: 'workspace-1', ownerId: 'admin-1' });
    expect(mocks.derivedUpdateMany.mock.calls[0][0].data).toMatchObject({
      state: 'REJECTED', approvedById: null, approvedAt: null, promotedAt: null, rollbackTarget: null,
    });
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
  });

  it('aborts descendant scrubbing when the active-target CAS loses', async () => {
    mocks.derivedFindMany.mockResolvedValue([{ id: 'candidate-1', targetKey: 'assistant.response_detail', baselineVersion: '1', candidateVersion: '2', state: 'PROMOTED' }]);
    mocks.activeFindMany.mockResolvedValue([{
      id: 'target-1', tenantId: 'workspace-1', targetKey: 'assistant.response_detail', activeVersion: '2',
      activeValue: 'detailed', activeChangeId: 'candidate-1', revision: 5, previousVersion: '1', previousValue: 'concise',
      updatedById: 'admin-1', createdAt: new Date(), updatedAt: new Date(),
    }]);
    mocks.activeUpdateMany.mockResolvedValue({ count: 0 });
    const tx = {
      businessAssistantLearningChange: { findMany: mocks.derivedFindMany, updateMany: mocks.derivedUpdateMany },
      businessAssistantLearningActiveTarget: { findMany: mocks.activeFindMany, updateMany: mocks.activeUpdateMany },
      auditLog: { create: mocks.auditCreate },
    } as never;

    await expect(eraseLearningDerivedFromMemory(tx, actor, 'memory-1')).rejects.toThrow('changed during source deletion');
    expect(mocks.derivedUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('does nothing when the source memory has no derived candidates', async () => {
    mocks.derivedFindMany.mockResolvedValue([]);
    const tx = {
      businessAssistantLearningChange: { findMany: mocks.derivedFindMany, updateMany: mocks.derivedUpdateMany },
      businessAssistantLearningActiveTarget: { findMany: mocks.activeFindMany, updateMany: mocks.activeUpdateMany },
      auditLog: { create: mocks.auditCreate },
    } as never;
    await expect(eraseLearningDerivedFromMemory(tx, actor, 'memory-1')).resolves.toEqual({ removedCandidates: 0, deactivatedTargets: 0 });
    expect(mocks.activeFindMany).not.toHaveBeenCalled();
    expect(mocks.derivedUpdateMany).not.toHaveBeenCalled();
  });
});
