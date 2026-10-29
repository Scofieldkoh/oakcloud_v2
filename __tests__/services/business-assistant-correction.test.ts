import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  barrier: vi.fn(), actor: vi.fn(), access: vi.fn(), registry: vi.fn(), prepare: vi.fn(), prefetch: vi.fn(), proposal: vi.fn(),
  transaction: vi.fn(), preflightRun: vi.fn(), preflightExisting: vi.fn(), run: vi.fn(), review: vi.fn(), item: vi.fn(), existing: vi.fn(), backups: vi.fn(),
  createRun: vi.fn(), createItem: vi.fn(), action: vi.fn(), updateRun: vi.fn(), updateItem: vi.fn(), updateReview: vi.fn(), deleteRun: vi.fn(), deleteItem: vi.fn(), deleteReview: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  businessAssistantRun: { findFirst: mocks.preflightRun },
  businessAssistantActionRequest: { findFirst: mocks.preflightExisting },
} }));
vi.mock('@/lib/prisma-transaction', () => ({ runSerializableTransaction: mocks.transaction }));
vi.mock('@/lib/business-operation-backup-barrier', () => ({ acquireBusinessOperationBarrier: mocks.barrier }));
vi.mock('@/lib/fresh-authorization', () => ({ resolveFreshActor: mocks.actor }));
vi.mock('@/services/business-assistant/policy.service', () => ({ assertAssistantMutationAccess: mocks.access }));
vi.mock('@/generated/business-assistant-capability-registry', () => ({ businessAssistantCapabilityRegistry: { get: mocks.registry } }));
vi.mock('@/services/business-assistant/proposal.service', () => ({ persistProposal: mocks.proposal }));

import { createCorrectionProposal } from '@/services/business-assistant/correction.service';

const actor = { userId: 'user', tenantId: 'tenant', requestId: 'trace', source: 'BUSINESS_ASSISTANT' };
const rawInput = { reviewId: 'review', clientRequestId: 'request', corrections: [{ findingId: 'finding', value: 'value' }] };
const input = { actor, runId: 'old-run', rawInput };
const run = { id: 'old-run', tenantId: 'tenant', ownerId: 'user', conversationId: null,
  capabilityId: 'example.correctable', capabilityVersion: '1.0', contractVersion: '1', schemaVersion: '1' };
const item = { id: 'old-item', tenantId: 'tenant', runId: 'old-run', operationId: 'old-operation',
  lifecycleState: 'NEEDS_REVIEW', activeStage: null,
  executionOutcome: 'COMMITTED', receiptRef: { receiptId: 'old-receipt' }, reviews: [{ id: 'review' }] };
const tx = {
  workspaceBackup: { findMany: mocks.backups }, businessAssistantRun: { findFirst: mocks.run, create: mocks.createRun, update: mocks.updateRun, delete: mocks.deleteRun },
  businessAssistantRunItem: { findFirst: mocks.item, create: mocks.createItem, update: mocks.updateItem, delete: mocks.deleteItem },
  businessAssistantReview: { findFirst: mocks.review, update: mocks.updateReview, delete: mocks.deleteReview },
  businessAssistantActionRequest: { findFirst: mocks.existing, create: mocks.action },
};

function capability(withPrefetch = true) {
  const prepareCorrection = (context: unknown, prefetched?: unknown) => mocks.prepare(context, prefetched);
  const handler = withPrefetch ? Object.assign(prepareCorrection, { prefetch: mocks.prefetch }) : prepareCorrection;
  return { id: run.capabilityId, version: '1.0', contractVersion: '1', approvalPolicyVersion: '1',
    executionKind: 'CANONICAL_WRITE', reviewPolicy: 'REQUIRED', preparedSchema: z.unknown(), prepareCorrection: handler };
}

describe('module-neutral correction proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BUSINESS_ASSISTANT_MUTATIONS_ENABLED', 'true');
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'true');
    mocks.access.mockResolvedValue({ allowed: true });
    mocks.actor.mockResolvedValue({ userId: 'user' });
    mocks.backups.mockResolvedValue([]);
    mocks.preflightRun.mockResolvedValue(run);
    mocks.preflightExisting.mockResolvedValue(null);
    mocks.run.mockResolvedValue(run);
    mocks.item.mockResolvedValue(item);
    mocks.review.mockResolvedValue({ id: 'review', runItemId: 'old-item', attemptNumber: 1 });
    mocks.existing.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (_db: unknown, work: (client: unknown) => unknown) => work(tx));
    mocks.registry.mockImplementation(() => capability());
    mocks.prefetch.mockResolvedValue({ sourceHash: 'prefetched-hash' });
    mocks.prepare.mockImplementation(async (context) => ({ status: 'PREPARED',
      preparedItem: { itemId: context.nextItemId, itemKey: 'correction', input: { corrected: 'value' }, status: 'ELIGIBLE', resources: [] },
      resources: [], lineage: { originalReceiptId: 'old-receipt' },
    }));
    mocks.proposal.mockResolvedValue({ id: 'new-proposal', revision: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('prefetches before the transaction, rechecks state, and creates a fresh unapproved item', async () => {
    const result = await createCorrectionProposal(input);
    expect(result.runId).not.toBe('old-run');
    expect(result.runItemId).not.toBe('old-item');
    expect(result).not.toHaveProperty('operationId');
    expect(mocks.prefetch).toHaveBeenCalledWith(expect.objectContaining({ actor, sourceRunId: 'old-run' }));
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ db: tx, sourceRunId: 'old-run', sourceItem: expect.objectContaining({ operationId: 'old-operation' }) }),
      { sourceHash: 'prefetched-hash' },
    );
    const created = mocks.createItem.mock.calls[0][0].data;
    expect(created).toMatchObject({ lifecycleState: 'WAITING_CONFIRMATION', executionOutcome: 'NOT_STARTED' });
    expect(created).not.toHaveProperty('operationId');
    expect(mocks.proposal).toHaveBeenCalledWith(expect.objectContaining({ runId: result.runId }), tx);
    expect(mocks.access.mock.invocationCallOrder[0]).toBeLessThan(mocks.prefetch.mock.invocationCallOrder[0]);
    expect(mocks.prefetch.mock.invocationCallOrder[0]).toBeLessThan(mocks.barrier.mock.invocationCallOrder[0]);
    expect(mocks.barrier.mock.invocationCallOrder[0]).toBeLessThan(mocks.actor.mock.invocationCallOrder[0]);
    expect(mocks.actor.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepare.mock.invocationCallOrder[0]);
  });

  it('preserves the historical source lifecycle, operation, receipt, review, and evidence while creating correction lineage', async () => {
    const sourceRunBefore = structuredClone(run);
    const sourceItemBefore = structuredClone(item);
    const sourceReview = { id: 'review', runItemId: 'old-item', attemptNumber: 1, verdict: 'FAIL', evidence: { immutable: true } };
    mocks.review.mockResolvedValue(sourceReview);
    const reviewBefore = structuredClone(sourceReview);

    const result = await createCorrectionProposal(input);

    expect(run).toEqual(sourceRunBefore);
    expect(item).toEqual(sourceItemBefore);
    expect(sourceReview).toEqual(reviewBefore);
    expect(item.operationId).toBe('old-operation');
    expect(item.receiptRef).toEqual({ receiptId: 'old-receipt' });
    expect(mocks.updateRun).not.toHaveBeenCalled();
    expect(mocks.updateItem).not.toHaveBeenCalled();
    expect(mocks.updateReview).not.toHaveBeenCalled();
    expect(mocks.deleteRun).not.toHaveBeenCalled();
    expect(mocks.deleteItem).not.toHaveBeenCalled();
    expect(mocks.deleteReview).not.toHaveBeenCalled();
    expect(mocks.createRun).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: result.runId }) }));
    expect(mocks.createItem).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: result.runItemId }) }));
  });

  it('keeps existing correction handlers compatible when they have no prefetch stage', async () => {
    mocks.registry.mockImplementation(() => capability(false));
    await createCorrectionProposal(input);
    expect(mocks.prefetch).not.toHaveBeenCalled();
    expect(mocks.prepare).toHaveBeenCalledWith(expect.any(Object), undefined);
  });

  it('replays only the same request and skips external prefetch for replay candidates', async () => {
    const first = await createCorrectionProposal(input);
    const saved = mocks.action.mock.calls[0][0].data;
    mocks.preflightExisting.mockResolvedValue({ id: 'existing-action' });
    mocks.existing.mockResolvedValue({ bodyHash: saved.bodyHash, response: saved.response });
    expect(await createCorrectionProposal(input)).toEqual({ ...first, duplicate: true });
    expect(mocks.prefetch).toHaveBeenCalledOnce();
    expect(mocks.createRun).toHaveBeenCalledOnce();
    expect(mocks.prepare).toHaveBeenCalledOnce();
    await expect(createCorrectionProposal({ ...input, rawInput: { ...rawInput, corrections: [{ findingId: 'finding', value: 'changed' }] } })).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
    expect(mocks.prefetch).toHaveBeenCalledOnce();
  });

  it('rejects a run outside the current owner scope', async () => {
    mocks.preflightRun.mockResolvedValue(null);
    mocks.run.mockResolvedValue(null);
    await expect(createCorrectionProposal(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'old-run', tenantId: 'tenant', ownerId: 'user' } }));
    expect(mocks.prefetch).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('rejects an older review attempt before module preparation', async () => {
    mocks.item.mockResolvedValue({ ...item, reviews: [{ id: 'new-review' }] });
    await expect(createCorrectionProposal(input)).rejects.toMatchObject({ code: 'PROPOSAL_STALE' });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('rejects capabilities without a correction handler', async () => {
    mocks.registry.mockReturnValue({ executionKind: 'READ_ONLY' });
    await expect(createCorrectionProposal(input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it('rejects an old finding while a new review attempt is queued', async () => {
    mocks.item.mockResolvedValue({ ...item, lifecycleState: 'RECOVERING', activeStage: 'REVIEW' });
    await expect(createCorrectionProposal(input)).rejects.toMatchObject({ code: 'PROPOSAL_STALE' });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it.each(['revocation', 'pause'])('rechecks %s after preflight before writing', async (reason) => {
    if (reason === 'revocation') mocks.actor.mockResolvedValue(null);
    else mocks.backups.mockResolvedValue([{ status: 'COMPLETED', errorDetails: { businessAssistantDispatchPaused: true } }]);
    await expect(createCorrectionProposal(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.prefetch).toHaveBeenCalledOnce();
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('rejects a module response bound to another item before writes', async () => {
    mocks.prepare.mockResolvedValue({ status: 'PREPARED', preparedItem: { itemId: 'old-item', status: 'ELIGIBLE' } });
    await expect(createCorrectionProposal(input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it('rejects mismatched explicit workspace context', async () => {
    await expect(createCorrectionProposal({ ...input, rawInput: { ...rawInput, workspaceId: 'other' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.preflightRun).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
