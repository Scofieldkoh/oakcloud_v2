import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), capability: vi.fn(), operational: vi.fn(), mutation: vi.fn(), itemUpdate: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  businessAssistantRun: { findFirst: mocks.run },
  businessAssistantActionRequest: { findFirst: vi.fn().mockResolvedValue(null) },
} }));
vi.mock('@/generated/business-assistant-capability-registry', () => ({ businessAssistantCapabilityRegistry: { get: mocks.capability } }));
vi.mock('@/services/business-assistant/policy.service', () => ({ assertAssistantActor: vi.fn(), assertAssistantWorkspaceOperational: mocks.operational, assertAssistantMutationAccess: mocks.mutation }));
vi.mock('@/lib/prisma-transaction', () => ({ runSerializableTransaction: mocks.transaction }));

import { applyRunAction } from '@/services/business-assistant/run.service';

const actor = { tenantId: 'tenant', userId: 'user', requestId: 'request' };
const action = { action: 'RETRY', clientRequestId: 'retry-request', itemIds: ['item'] };

describe('read-only assistant retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue({ id: 'run', conversationId: null, capabilityId: 'workspace.resource_lookup', capabilityVersion: '1.0',
      contractVersion: '1', schemaVersion: '1', status: 'FAILED', activeProposalId: null, resources: [],
      cancellationRequestedAt: null, createdAt: new Date(), updatedAt: new Date(), completedAt: null, items: [], proposals: [] });
    mocks.capability.mockReturnValue({ executionKind: 'READ_ONLY' });
    mocks.operational.mockResolvedValue({ allowed: true });
    mocks.mutation.mockRejectedValue(new Error('Business mutations disabled'));
    mocks.transaction.mockImplementation(async (_db: unknown, run: (tx: unknown) => unknown) => run({
      businessAssistantRunItem: { findMany: async () => [{ id: 'item', lifecycleState: 'FAILED', executionOutcome: 'FAILED_NO_COMMIT', reviewOutcome: 'NOT_REQUIRED', requiredEffectStatus: 'NOT_REQUIRED' }], update: mocks.itemUpdate },
      businessAssistantRun: { update: vi.fn() },
      businessAssistantActionRequest: { create: vi.fn() },
    }));
  });

  it('queues a read-only retry without requiring business mutations to be enabled', async () => {
    await applyRunAction(actor, 'run', action);
    expect(mocks.operational).toHaveBeenCalledWith('user', 'tenant');
    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(mocks.itemUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lifecycleState: 'PENDING', executionOutcome: 'NOT_STARTED' }) }));
  });

  it('still blocks read-only retries while the workspace is paused', async () => {
    mocks.operational.mockRejectedValue(new Error('Workspace restoring'));
    await expect(applyRunAction(actor, 'run', action)).rejects.toThrow('Workspace restoring');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('preserves the mutation gate for canonical write retries', async () => {
    mocks.capability.mockReturnValue({ executionKind: 'CANONICAL_WRITE' });
    await expect(applyRunAction(actor, 'run', action)).rejects.toThrow('Business mutations disabled');
    expect(mocks.mutation).toHaveBeenCalledWith('user', 'tenant');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
