import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  memoryCreate: vi.fn(),
  create: vi.fn(),
  replay: vi.fn(),
  access: vi.fn(),
  freshActor: vi.fn(),
  backups: vi.fn(),
  barrier: vi.fn(),
  cleanupDerived: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  businessAssistantMemory: { findFirst: mocks.findFirst, findUnique: mocks.findFirst },
  businessAssistantActionRequest: { findFirst: mocks.replay },
} }));
vi.mock('@/lib/prisma-transaction', () => ({ runSerializableTransaction: async (_db: unknown, run: (tx: unknown) => unknown) => run({
  businessAssistantMemory: { findFirst: mocks.findFirst, update: mocks.update, updateMany: mocks.updateMany, create: mocks.memoryCreate },
  businessAssistantActionRequest: { findFirst: mocks.replay, create: mocks.create },
  workspaceBackup: { findMany: mocks.backups },
}) }));
vi.mock('@/lib/business-operation-backup-barrier', () => ({ acquireBusinessOperationBarrier: mocks.barrier }));
vi.mock('@/lib/fresh-authorization', () => ({ resolveFreshActor: mocks.freshActor }));
vi.mock('@/services/business-assistant/policy.service', () => ({ assertAssistantAdministrativeAccess: mocks.access }));
vi.mock('@/services/business-assistant/learning-derived-cleanup', () => ({ eraseLearningDerivedFromMemory: mocks.cleanupDerived }));

import { applyMemoryAction, createMemoryCandidate } from '@/services/business-assistant/memory.service';
import { sha256 } from '@/services/business-assistant/contracts';

const actor = { userId: 'user', tenantId: 'workspace', requestId: 'request' };
const freshUser = {
  id: 'user', email: 'user@example.test', firstName: 'Test', lastName: 'User', tenantId: 'workspace', workspaceId: 'workspace',
  internalRole: 'STAFF', isSuperAdmin: false, isWorkspaceAdmin: false, hasAllCompaniesAccess: false, companyIds: [], roleAssignments: [],
};
const tombstone = {
  id: 'memory', scope: 'USER', conversationId: null, capabilityId: null, capabilityVersion: null,
  key: 'language', value: { deleted: true }, provenance: { source: 'USER_REQUEST' },
  state: 'DELETED', version: 2, risk: 'LOW', evidenceCount: 1,
  effectiveAt: null, expiresAt: null, createdAt: new Date(), updatedAt: new Date(),
};
const request = (action: string) => ({ action, expectedVersion: 2, clientRequestId: '1d0fd7b2-16ec-4111-a0f9-6319cc5f9e75' });
const activeMemory = { ...tombstone, state: 'ACTIVE', value: 'en' };

describe('deleted assistant preference boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(tombstone);
    mocks.replay.mockResolvedValue(null);
    mocks.access.mockResolvedValue({ isAdmin: false });
    mocks.freshActor.mockResolvedValue(freshUser);
    mocks.backups.mockResolvedValue([]);
    mocks.barrier.mockResolvedValue(undefined);
    mocks.cleanupDerived.mockResolvedValue({ removedCandidates: 0, deactivatedTargets: 0 });
  });

  it('creates a personal candidate for an ordinary authorized user inside the transaction', async () => {
    const created = { ...tombstone, id: 'new-memory', state: 'CANDIDATE', value: 'zh', version: 1, capabilityId: 'cap-a', capabilityVersion: '1' };
    mocks.findFirst.mockResolvedValue(null);
    mocks.memoryCreate.mockResolvedValue(created);

    const result = await createMemoryCandidate(actor, { key: 'language', value: 'zh', scope: 'USER', capabilityId: 'cap-a', capabilityVersion: '1', provenance: { source: 'test' } });

    expect(result).toMatchObject({ id: 'new-memory', scope: 'USER', state: 'CANDIDATE', value: 'zh', version: 1 });
    expect(mocks.barrier).toHaveBeenCalledTimes(1);
    expect(mocks.freshActor).toHaveBeenCalledWith({ userId: 'user', workspaceId: 'workspace' }, expect.anything());
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ capabilityId: 'cap-a', capabilityVersion: '1' }) }));
    expect(mocks.memoryCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'workspace', ownerId: 'user', scope: 'USER', key: 'language', value: 'zh', version: 1 }) }));
  });

  it('does not create a candidate when authorization is revoked after the preflight', async () => {
    mocks.freshActor.mockResolvedValue(null);

    await expect(createMemoryCandidate(actor, { key: 'language', value: 'en', scope: 'USER' })).rejects.toThrow('current user or workspace is unavailable');

    expect(mocks.access).toHaveBeenCalledTimes(1);
    expect(mocks.barrier).toHaveBeenCalledTimes(1);
    expect(mocks.memoryCreate).not.toHaveBeenCalled();
  });

  it('does not apply an action when restore pause appears after the preflight', async () => {
    mocks.findFirst.mockResolvedValue(activeMemory);
    mocks.backups.mockResolvedValue([{ status: 'RESTORING', errorDetails: null }]);

    await expect(applyMemoryAction(actor, 'memory', request('DELETE'))).rejects.toThrow('workspace is restoring');

    expect(mocks.access).toHaveBeenCalledTimes(1);
    expect(mocks.barrier).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupDerived).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rechecks tenant administrator access after the preflight before applying an action', async () => {
    mocks.findFirst.mockResolvedValue({ ...activeMemory, scope: 'TENANT' });
    mocks.access.mockResolvedValue({ isAdmin: true });

    await expect(applyMemoryAction(actor, 'memory', request('DELETE'))).rejects.toThrow('Only a workspace administrator');

    expect(mocks.access).toHaveBeenCalledTimes(1);
    expect(mocks.barrier).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupDerived).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('supersedes only the matching capability-scoped active preference on confirmation', async () => {
    const candidate = { ...activeMemory, state: 'CANDIDATE', capabilityId: 'cap-a', capabilityVersion: '1' };
    const updated = { ...candidate, state: 'ACTIVE', version: 3 };
    const activeRows = [
      { id: 'generic', tenantId: 'workspace', ownerId: 'user', scope: 'USER', conversationId: null, capabilityId: null, capabilityVersion: null, key: 'language', state: 'ACTIVE' },
      { id: 'other-capability', tenantId: 'workspace', ownerId: 'user', scope: 'USER', conversationId: null, capabilityId: 'cap-b', capabilityVersion: '1', key: 'language', state: 'ACTIVE' },
      { id: 'matching-capability', tenantId: 'workspace', ownerId: 'user', scope: 'USER', conversationId: null, capabilityId: 'cap-a', capabilityVersion: '1', key: 'language', state: 'ACTIVE' },
    ];
    mocks.findFirst.mockResolvedValue(candidate);
    mocks.update.mockResolvedValue(updated);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(applyMemoryAction(actor, 'memory', request('CONFIRM'))).resolves.toMatchObject({ state: 'ACTIVE' });

    const supersessionWhere = mocks.updateMany.mock.calls[0][0].where;
    expect(supersessionWhere.capabilityId).toBe('cap-a');
    expect(supersessionWhere.capabilityVersion).toBe('1');
    const supersededIds = activeRows.filter((row) => row.tenantId === supersessionWhere.tenantId
      && row.ownerId === supersessionWhere.ownerId
      && row.scope === supersessionWhere.scope
      && row.conversationId === supersessionWhere.conversationId
      && row.capabilityId === supersessionWhere.capabilityId
      && row.capabilityVersion === supersessionWhere.capabilityVersion
      && row.key === supersessionWhere.key
      && row.state === supersessionWhere.state
      && row.id !== supersessionWhere.id.not).map((row) => row.id);
    expect(supersededIds).toEqual(['matching-capability']);
  });

  it('cleans all learning descendants before deleting the confirmed source preference', async () => {
    const deleted = { ...activeMemory, state: 'DELETED', value: { deleted: true }, version: 3, deletedAt: new Date(), updatedAt: new Date() };
    mocks.findFirst.mockResolvedValue(activeMemory);
    mocks.update.mockResolvedValue(deleted);
    mocks.create.mockResolvedValue({ id: 'action-request' });
    const events: string[] = [];
    mocks.cleanupDerived.mockImplementation(async () => { events.push('derived-cleanup'); return { removedCandidates: 2, deactivatedTargets: 1 }; });
    mocks.update.mockImplementation(async () => { events.push('memory-delete'); return deleted; });

    const result = await applyMemoryAction(actor, 'memory', request('DELETE'));

    expect(result).toMatchObject({ state: 'DELETED', value: { deleted: true }, version: 3 });
    expect(mocks.cleanupDerived).toHaveBeenCalledWith(expect.anything(), actor, 'memory');
    expect(events).toEqual(['derived-cleanup', 'memory-delete']);
  });

  it('aborts source deletion if derived learning cleanup cannot safely complete', async () => {
    mocks.findFirst.mockResolvedValue(activeMemory);
    mocks.cleanupDerived.mockRejectedValue(new Error('descendant CAS conflict'));

    await expect(applyMemoryAction(actor, 'memory', request('DELETE'))).rejects.toThrow('descendant CAS conflict');

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['REVISE', 'CONFIRM', 'DEACTIVATE', 'DELETE'])('rejects a new %s action without rewriting the tombstone', async (kind) => {
    const action = { ...request(kind), ...(kind === 'REVISE' ? { value: 'zh' } : {}) };
    await expect(applyMemoryAction(actor, 'memory', action)).rejects.toThrow('A deleted preference cannot be changed');
    expect(mocks.cleanupDerived).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('allows an exact retry of the successful delete without another cleanup or write', async () => {
    const action = { ...request('DELETE'), expectedVersion: 1 };
    mocks.replay.mockResolvedValue({ bodyHash: sha256({ memoryId: 'memory', action }) });
    const result = await applyMemoryAction(actor, 'memory', action);
    expect(result.state).toBe('DELETED');
    expect(result.value).toEqual({ deleted: true });
    expect(result.allowedActions).toEqual([]);
    expect(mocks.cleanupDerived).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects tenant preference changes when its owner is no longer an administrator', async () => {
    mocks.findFirst.mockResolvedValue({ ...tombstone, scope: 'TENANT', state: 'ACTIVE', value: 'en' });
    await expect(applyMemoryAction(actor, 'memory', request('DELETE'))).rejects.toThrow('Only a workspace administrator');
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.cleanupDerived).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
