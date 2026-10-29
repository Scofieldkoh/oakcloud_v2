import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), access: vi.fn(), actor: vi.fn(), barrier: vi.fn(),
  registry: vi.fn(), prefetch: vi.fn(), prepare: vi.fn(), proposal: vi.fn(),
  preflightRun: vi.fn(), preflightExisting: vi.fn(), run: vi.fn(), existing: vi.fn(),
  review: vi.fn(), item: vi.fn(), backups: vi.fn(), createRun: vi.fn(), createItem: vi.fn(), action: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: {
  businessAssistantRun: { findFirst: mocks.preflightRun },
  businessAssistantActionRequest: { findFirst: mocks.preflightExisting },
} }));
vi.mock('@/services/business-assistant/correction-transaction', () => ({ runCorrectionSerializableTransaction: mocks.transaction }));
vi.mock('@/lib/business-operation-backup-barrier', () => ({ acquireBusinessOperationBarrier: mocks.barrier }));
vi.mock('@/lib/fresh-authorization', () => ({ resolveFreshActor: mocks.actor }));
vi.mock('@/services/business-assistant/policy.service', () => ({ assertAssistantMutationAccess: mocks.access }));
vi.mock('@/generated/business-assistant-capability-registry', () => ({ businessAssistantCapabilityRegistry: { get: mocks.registry } }));
vi.mock('@/services/business-assistant/proposal.service', () => ({ persistProposal: mocks.proposal }));

import { createCorrectionProposal } from '@/services/business-assistant/correction.service';

const actor = { userId: 'user', tenantId: 'tenant', requestId: 'trace', source: 'BUSINESS_ASSISTANT' };
const request = { reviewId: 'review', clientRequestId: 'request', corrections: [{ findingId: 'finding', value: 'value' }] };
const sourceRun = { id: 'source-run', tenantId: 'tenant', ownerId: 'user', conversationId: null,
  capabilityId: 'capability.old', capabilityVersion: '1.0', contractVersion: '1', schemaVersion: '1' };
const tx = {
  workspaceBackup: { findMany: mocks.backups },
  businessAssistantRun: { findFirst: mocks.run, create: mocks.createRun },
  businessAssistantRunItem: { findFirst: mocks.item, create: mocks.createItem },
  businessAssistantReview: { findFirst: mocks.review },
  businessAssistantActionRequest: { findFirst: mocks.existing, create: mocks.action },
};
function capability(id: string, version = '1.0', contractVersion = '1') {
  const prepareCorrection = Object.assign(
    (context: unknown, prefetched?: unknown) => mocks.prepare(context, prefetched),
    { prefetch: mocks.prefetch },
  );
  return {
    id, version, contractVersion, executionKind: 'CANONICAL_WRITE', reviewPolicy: 'REQUIRED',
    approvalPolicyVersion: '1', preparedSchema: z.unknown(), prepareCorrection,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BUSINESS_ASSISTANT_MUTATIONS_ENABLED', 'true');
  vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'true');
  mocks.access.mockResolvedValue({ allowed: true });
  mocks.actor.mockResolvedValue({ userId: actor.userId });
  mocks.backups.mockResolvedValue([]);
  mocks.preflightRun.mockResolvedValue(sourceRun);
  mocks.preflightExisting.mockResolvedValue(null);
  mocks.existing.mockResolvedValue(null);
  mocks.prefetch.mockResolvedValue({ sourceHash: 'evidence' });
  mocks.transaction.mockImplementation(async (_db: unknown, work: (db: unknown) => Promise<unknown>) => work(tx));
  mocks.registry.mockImplementation((id: string, version: string) => capability(id, version));
  mocks.review.mockResolvedValue({ id: 'review', runItemId: 'source-item', attemptNumber: 1 });
  mocks.item.mockResolvedValue({ id: 'source-item', tenantId: 'tenant', runId: sourceRun.id, operationId: 'old-operation',
    receiptRef: { receiptId: 'old-receipt' }, executionOutcome: 'COMMITTED', lifecycleState: 'NEEDS_REVIEW', activeStage: null, reviews: [{ id: 'review' }] });
  mocks.prepare.mockImplementation(async (context: { nextItemId: string }) => ({
    status: 'PREPARED', preparedItem: { itemId: context.nextItemId, itemKey: 'correction', input: {}, resources: [], status: 'ELIGIBLE' },
    resources: [], lineage: {},
  }));
  mocks.proposal.mockResolvedValue({ id: 'proposal', revision: 1 });
});

describe('correction prefetch transaction authority', () => {
  it.each([
    ['capability id', { ...sourceRun, capabilityId: 'capability.new' }],
    ['capability version', { ...sourceRun, capabilityVersion: '2.0' }],
    ['contract version', { ...sourceRun, contractVersion: '2' }],
  ])('fails closed when %s changes after prefetch', async (_label, transactionalRun) => {
    mocks.run.mockResolvedValue(transactionalRun);
    if (transactionalRun.contractVersion === '2') {
      mocks.registry.mockImplementation((id: string, version: string) => capability(id, version, '2'));
      mocks.registry.mockImplementationOnce((id: string, version: string) => capability(id, version, '1'));
    }

    await expect(createCorrectionProposal({ actor, runId: sourceRun.id, rawInput: request }))
      .rejects.toMatchObject({ code: 'PROPOSAL_STALE' });

    expect(mocks.prefetch).toHaveBeenCalledOnce();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.createItem).not.toHaveBeenCalled();
    expect(mocks.proposal).not.toHaveBeenCalled();
    expect(mocks.action).not.toHaveBeenCalled();
  });
});