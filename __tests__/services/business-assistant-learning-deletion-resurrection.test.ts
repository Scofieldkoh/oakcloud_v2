import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  derivedFindMany: vi.fn(),
  activeFindMany: vi.fn(),
  activeUpdateMany: vi.fn(),
  derivedUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
}));

import { eraseLearningDerivedFromMemory } from '@/services/business-assistant/learning-derived-cleanup';
import { createLearningActiveEnvelope, decodeLearningActiveValue } from '@/services/business-assistant/learning-active-target';
import { learningTargetDefinition } from '@/services/business-assistant/learning-targets';

const actor = { userId: 'admin-1', tenantId: 'workspace-1', requestId: 'request-1' };
const definition = learningTargetDefinition('assistant.response_detail')!;
const sourceEnvelope = createLearningActiveEnvelope(
  definition,
  'detailed',
  'candidate-source',
  new Date('2026-09-01T00:00:00.000Z'),
);
const unrelatedEnvelope = createLearningActiveEnvelope(
  definition,
  'standard',
  'candidate-current',
  new Date('2026-09-02T00:00:00.000Z'),
);

function tx() {
  return {
    businessAssistantLearningChange: {
      findMany: mocks.derivedFindMany,
      updateMany: mocks.derivedUpdateMany,
    },
    businessAssistantLearningActiveTarget: {
      findMany: mocks.activeFindMany,
      updateMany: mocks.activeUpdateMany,
    },
    auditLog: { create: mocks.auditCreate },
  } as never;
}

describe('deleted preference resurrection prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.derivedFindMany.mockResolvedValue([{
      id: 'candidate-source',
      targetKey: 'assistant.response_detail',
      baselineVersion: '1',
      candidateVersion: '2',
      state: 'PROMOTED',
    }]);
    mocks.activeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.derivedUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
  });

  it('scrubs a deleted source from an unrelated active target rollback slot without disturbing the current value', async () => {
    mocks.activeFindMany.mockResolvedValue([{
      id: 'target-1',
      tenantId: 'workspace-1',
      targetKey: 'assistant.response_detail',
      activeVersion: '3',
      activeValue: unrelatedEnvelope,
      previousVersion: '2',
      previousValue: sourceEnvelope,
      activeChangeId: 'candidate-current',
      revision: 8,
      updatedById: 'admin-2',
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);

    await expect(eraseLearningDerivedFromMemory(tx(), actor, 'memory-source'))
      .resolves.toEqual({ removedCandidates: 1, deactivatedTargets: 0 });

    const mutation = mocks.activeUpdateMany.mock.calls[0][0];
    expect(mutation.where).toMatchObject({
      id: 'target-1',
      tenantId: 'workspace-1',
      targetKey: 'assistant.response_detail',
      activeVersion: '3',
      activeChangeId: 'candidate-current',
      revision: 8,
    });
    expect(mutation.data.activeValue).toBeUndefined();
    expect(mutation.data.activeChangeId).toBeUndefined();
    expect(mutation.data.previousVersion).toBe('1');
    expect(mutation.data.previousValue).toBe('concise');
    expect(JSON.stringify(mutation.data)).not.toContain('candidate-source');
    expect(JSON.stringify(mutation.data)).not.toContain('detailed');
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ scrubbedRollbackSlots: 1, deactivatedTargets: 0 }),
      }),
    }));
  });

  it('detects a derived envelope restored by an earlier rollback even when activeChangeId is already null', async () => {
    mocks.activeFindMany.mockResolvedValue([{
      id: 'target-1',
      tenantId: 'workspace-1',
      targetKey: 'assistant.response_detail',
      activeVersion: '2',
      activeValue: sourceEnvelope,
      previousVersion: '3',
      previousValue: unrelatedEnvelope,
      activeChangeId: null,
      revision: 9,
      updatedById: 'admin-2',
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);

    await expect(eraseLearningDerivedFromMemory(tx(), actor, 'memory-source'))
      .resolves.toEqual({ removedCandidates: 1, deactivatedTargets: 1 });

    const mutation = mocks.activeUpdateMany.mock.calls[0][0];
    const decoded = decodeLearningActiveValue('assistant.response_detail', mutation.data.activeValue);
    expect(decoded).toMatchObject({ state: 'DEACTIVATED', value: null, changeId: null });
    expect(mutation.data).toMatchObject({ previousVersion: null, activeChangeId: null });
    expect(JSON.stringify(mutation.data.activeValue)).not.toContain('candidate-source');
    expect(JSON.stringify(mutation.data.activeValue)).not.toContain('detailed');
  });

  it('binds rollback-slot scrubbing to the tenant, active pointer, version, and revision CAS', async () => {
    mocks.activeFindMany.mockResolvedValue([{
      id: 'target-1',
      tenantId: 'workspace-1',
      targetKey: 'assistant.response_detail',
      activeVersion: '3',
      activeValue: unrelatedEnvelope,
      previousVersion: '2',
      previousValue: sourceEnvelope,
      activeChangeId: 'candidate-current',
      revision: 8,
      updatedById: 'admin-2',
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
    mocks.activeUpdateMany.mockResolvedValue({ count: 0 });

    await expect(eraseLearningDerivedFromMemory(tx(), actor, 'memory-source'))
      .rejects.toThrow('changed during source deletion');
    expect(mocks.derivedUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
