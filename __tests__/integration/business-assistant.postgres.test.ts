// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { acceptTurn } from '@/services/business-assistant/conversation.service';
import { runBusinessAssistantWorker } from '@/services/business-assistant/worker';
import { claimInboundMessage, claimRunnableItem, releaseItemClaim, settleInboundMessage, updateClaimedItem } from '@/services/business-assistant/claim.repository';
import { confirmProposal, persistProposal } from '@/services/business-assistant/proposal.service';
import { recordClaimedReview } from '@/services/business-assistant/review.repository';
import { createCorrectionProposal } from '@/services/business-assistant/correction.service';
import { businessAssistantCapabilityRegistry } from '@/generated/business-assistant-capability-registry';
import { sha256, type CanonicalActorContext, type PreparedCapabilityArtifact } from '@/services/business-assistant/contracts';

const connectionString = process.env.BUSINESS_ASSISTANT_TEST_DATABASE_URL;
if (connectionString && process.env.DATABASE_URL !== connectionString) {
  throw new Error('DATABASE_URL and BUSINESS_ASSISTANT_TEST_DATABASE_URL must be preconfigured to the same isolated disposable database.');
}
const suite = connectionString ? describe : describe.skip;
const slotKeys = ['business-assistant-0', 'business-assistant-1'];

let tenantId: string | undefined;
let userId: string | undefined;

suite('Business Assistant durable PostgreSQL execution', () => {
  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!/(?:^|[_-])test(?:[_-]|$)/i.test(url.pathname.slice(1)) || ['5433', '3000'].includes(url.port)) {
      throw new Error('Business Assistant integration tests require the isolated disposable test database.');
    }
    await prisma.$queryRaw`SELECT 1`;
    await clearAssistantRows();
  }, 15_000);

  beforeEach(async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
    const workspace = await prisma.workspace.create({
      data: { id: randomUUID(), name: `Business Assistant ${suffix}`, slug: `business-assistant-${suffix}`, status: 'ACTIVE' },
      select: { id: true },
    });
    tenantId = workspace.id;
    const user = await prisma.user.create({
      data: { tenantId, email: `business-assistant-${suffix}@example.test`, passwordHash: 'test-only', firstName: 'Assistant', lastName: 'Tester', isActive: true },
      select: { id: true },
    });
    userId = user.id;
  });

  afterEach(async () => {
    if (tenantId) await clearAssistantRows(tenantId);
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (tenantId) await prisma.workspace.deleteMany({ where: { id: tenantId } });
    tenantId = undefined;
    userId = undefined;
    await prisma.businessAssistantCapacitySlot.updateMany({
      where: { slotKey: { in: slotKeys } },
      data: { claimToken: null, leaseExpiresAt: null, heartbeatAt: null, tenantId: null, userId: null, runItemId: null, stage: null },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('limits concurrent workers to two durable capacity slots', async () => {
    const run = await createRun('RUNNING');
    await createItem(run.id, 'one', 0);
    await createItem(run.id, 'two', 1);
    await createItem(run.id, 'three', 2);

    const attempts = await Promise.allSettled([claimRunnableItem(), claimRunnableItem(), claimRunnableItem()]);
    const errors = attempts.filter((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected');
    expect(errors).toHaveLength(0);
    const claims = attempts.flatMap((attempt) => attempt.status === 'fulfilled' && attempt.value ? [attempt.value] : []);
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((claim) => claim.capacitySlotKey)).size).toBe(2);
    expect(await prisma.businessAssistantCapacitySlot.count({ where: { runItemId: { not: null } } })).toBe(2);
    await Promise.all(claims.map((claim) => releaseItemClaim(claim, { keepState: true })));
  });

  it('fences an expired worker claim after a replacement claim is issued', async () => {
    const run = await createRun('RUNNING');
    const item = await createItem(run.id, 'fenced', 0);
    const first = await claimRunnableItem();
    expect(first?.id).toBe(item.id);
    const expiredAt = new Date(Date.now() - 1_000);
    await prisma.businessAssistantRunItem.update({ where: { id: item.id }, data: { leaseExpiresAt: expiredAt, availableAt: expiredAt } });
    await prisma.businessAssistantCapacitySlot.updateMany({ where: { runItemId: item.id }, data: { leaseExpiresAt: expiredAt } });

    const replacement = await claimRunnableItem();
    expect(replacement?.id).toBe(item.id);
    expect(replacement?.generation).toBeGreaterThan(first?.generation ?? 0);
    expect(await updateClaimedItem(first!, { dispositionReason: 'STALE_WORKER_MUST_NOT_SETTLE' })).toBe(false);
    expect(await updateClaimedItem(replacement!, { dispositionReason: 'CURRENT_WORKER_SETTLED' })).toBe(true);
    await updateClaimedItem(replacement!, { lifecycleState: 'EXECUTING', executionOutcome: 'COMMITTED' });
    const reviewInput = {
      reviewed: { verdict: 'NEEDS_REVIEW' as const, executionConformance: 'UNVERIFIABLE' as const,
        sourceAlignment: 'INCOMPLETE' as const, findings: [], coverage: { complete: false } },
      snapshot: {}, observedAt: new Date().toISOString(), effectStatus: 'COMPLETE' as const,
      output: {}, schemaVersion: '1', promptVersion: '1',
    };
    expect(await recordClaimedReview({ ...reviewInput, claim: first! })).toBe(false);
    expect(await prisma.businessAssistantReview.count({ where: { runItemId: item.id } })).toBe(0);
    expect(await recordClaimedReview({ ...reviewInput, claim: replacement! })).toBe(true);
    expect(await recordClaimedReview({ ...reviewInput, claim: replacement! })).toBe(false);
    expect(await prisma.businessAssistantReview.count({ where: { runItemId: item.id } })).toBe(1);
    await releaseItemClaim(replacement!, { keepState: true });
  });

  it('reclaims expired inbound work and rejects settlement from the old fence', async () => {
    const run = await createRun('PREPARING');
    const conversation = await prisma.businessAssistantConversation.findUniqueOrThrow({ where: { id: run.conversationId! }, select: { id: true } });
    const message = await prisma.businessAssistantMessage.create({
      data: {
        tenantId: tenantId!, conversationId: conversation.id, ownerId: userId!, sequence: 1, role: 'USER', type: 'INPUT', status: 'ACCEPTED',
        content: 'List companies', payload: { runId: run.id }, resources: [], operationKind: 'TURN', clientRequestId: randomUUID(), bodyHash: sha256({ runId: run.id }), availableAt: new Date(Date.now() - 1_000),
      },
      select: { id: true },
    });
    const first = await claimInboundMessage();
    expect(first?.id).toBe(message.id);
    const expiredAt = new Date(Date.now() - 1_000);
    await prisma.businessAssistantMessage.update({ where: { id: message.id }, data: { availableAt: expiredAt, leaseExpiresAt: expiredAt } });
    const replacement = await claimInboundMessage();
    expect(replacement?.id).toBe(message.id);
    expect(await settleInboundMessage(first!, 'PROCESSED')).toBe(false);
    expect(await settleInboundMessage(replacement!, 'PROCESSED')).toBe(true);
    await expect(prisma.businessAssistantMessage.findUniqueOrThrow({ where: { id: message.id }, select: { status: true, claimToken: true } })).resolves.toEqual({ status: 'PROCESSED', claimToken: null });
  });

  it('approves one immutable proposal subset and makes replay return the same operations', async () => {
    const run = await createRun('PREPARING');
    const first = await createItem(run.id, 'first', 0);
    const second = await createItem(run.id, 'second', 1);
    const items = [
      { itemId: first.id, itemKey: 'first', input: { value: 'first' }, resources: [], status: 'ELIGIBLE' as const },
      { itemId: second.id, itemKey: 'second', input: { value: 'second' }, resources: [], status: 'ELIGIBLE' as const },
    ];
    const preparedWithoutHash = { status: 'PREPARED' as const, items, preparedAt: new Date().toISOString() };
    const prepared: PreparedCapabilityArtifact = { ...preparedWithoutHash, preparedHash: sha256(preparedWithoutHash) };
    const actor: CanonicalActorContext = { tenantId: tenantId!, userId: userId!, requestId: randomUUID(), source: 'BUSINESS_ASSISTANT_TEST' };
    const proposal = await persistProposal({ actor, runId: run.id, prepared, policyVersion: '1', schemaVersion: '1' });
    const actionBodyHash = sha256({ proposalId: proposal.id, revision: proposal.revision, itemIds: [first.id] });
    const selection = { actor, runId: run.id, itemIds: [first.id], proposalId: proposal.id, revision: proposal.revision, actionKey: randomUUID(), actionBodyHash };
    const initial = await confirmProposal(selection);
    const replay = await confirmProposal(selection);
    expect(initial.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(replay.operationIds).toEqual(initial.operationIds);
    expect((await prisma.businessAssistantRunItem.findUniqueOrThrow({ where: { id: first.id }, select: { lifecycleState: true, operationId: true } })).lifecycleState).toBe('READY');
    expect((await prisma.businessAssistantRunItem.findUniqueOrThrow({ where: { id: second.id }, select: { lifecycleState: true } })).lifecycleState).toBe('WAITING_CONFIRMATION');
    expect((await prisma.businessAssistantApproval.findFirstOrThrow({ where: { tenantId: tenantId!, proposalId: proposal.id }, select: { decision: true, selectedItems: true } })).selectedItems).toEqual([first.id]);
  });

  it('persists a linked correction without approval and assigns a new operation only on confirmation', async () => {
    const run = await createRun('RUNNING');
    const source = await createItem(run.id, 'committed-source', 0);
    const oldOperationId = randomUUID();
    const capability = businessAssistantCapabilityRegistry.require('bizfile.import_and_review', '1.0');
    if (capability.executionKind !== 'CANONICAL_WRITE') throw new Error('Expected a write capability fixture.');
    await prisma.businessAssistantRun.update({ where: { id: run.id }, data: { capabilityId: capability.id, capabilityVersion: capability.version } });
    await prisma.businessAssistantRunItem.update({ where: { id: source.id }, data: {
      lifecycleState: 'NEEDS_REVIEW', activeStage: null, executionOutcome: 'COMMITTED', operationId: oldOperationId,
      receiptRef: { receiptType: 'TestReceipt', receiptId: 'original-receipt', operationId: oldOperationId, status: 'COMMITTED' },
    } });
    const sourceReview = await prisma.businessAssistantReview.create({ data: {
      tenantId: tenantId!, runItemId: source.id, attemptNumber: 1, verdict: 'NEEDS_REVIEW', executionConformance: 'FAIL',
      sourceAlignment: 'DIFFERENCES_PRESENT', evidence: {}, findings: [], coverage: {}, schemaVersion: '1', promptVersion: '1',
    } });
    // Only the module preparation is mocked. Proposal persistence, replay,
    // fresh authorization, confirmation, and operation identity use real SQL.
    const registry = vi.spyOn(businessAssistantCapabilityRegistry, 'get').mockReturnValue({ ...capability,
      prepareCorrection: async (context) => ({ status: 'PREPARED',
        preparedItem: { itemId: context.nextItemId, itemKey: 'corrected-item', status: 'ELIGIBLE', input: { value: 'corrected' }, resources: [] },
        lineage: { sourceReceiptId: 'original-receipt' }, resources: [],
      }),
    });
    vi.stubEnv('BUSINESS_ASSISTANT_MUTATIONS_ENABLED', 'true');
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'true');
    try {
      const actor: CanonicalActorContext = { tenantId: tenantId!, userId: userId!, requestId: randomUUID(), source: 'BUSINESS_ASSISTANT_TEST' };
      const request = { actor, runId: run.id, rawInput: { reviewId: sourceReview.id, clientRequestId: randomUUID(), corrections: [{ findingId: 'fixture', value: 'corrected' }] } };
      const prepared = await createCorrectionProposal(request);
      expect(await createCorrectionProposal(request)).toEqual({ ...prepared, duplicate: true });
      expect(await prisma.businessAssistantApproval.count({ where: { runId: prepared.runId } })).toBe(0);
      expect(await prisma.businessAssistantRunItem.findUniqueOrThrow({ where: { id: prepared.runItemId }, select: { lifecycleState: true, operationId: true } }))
        .toEqual({ lifecycleState: 'WAITING_CONFIRMATION', operationId: null });
      const confirmed = await confirmProposal({ actor, runId: prepared.runId, proposalId: prepared.proposalId, revision: prepared.revision,
        itemIds: [prepared.runItemId], actionKey: randomUUID(), actionBodyHash: sha256({ proposalId: prepared.proposalId }) });
      expect(confirmed.operationIds[0].operationId).not.toBe(oldOperationId);
      expect(await prisma.businessAssistantRunItem.findUniqueOrThrow({ where: { id: source.id }, select: { operationId: true, lifecycleState: true } }))
        .toEqual({ operationId: oldOperationId, lifecycleState: 'NEEDS_REVIEW' });
      expect(await prisma.businessAssistantReview.count({ where: { id: sourceReview.id } })).toBe(1);
    } finally {
      registry.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('runs the registered generic read capability and writes a durable answer message', async () => {
    const previousEnabled = process.env.BUSINESS_ASSISTANT_ENABLED;
    process.env.BUSINESS_ASSISTANT_ENABLED = 'true';
    try {
      const accepted = await acceptTurn(
        { tenantId: tenantId!, userId: userId!, requestId: randomUUID() },
        { clientRequestId: randomUUID(), workspaceId: tenantId!, message: 'List companies', context: { capabilityId: 'workspace.resource_lookup', capabilityVersion: '1.0' } },
      );
      expect(accepted.runId).toBeTruthy();
      const result = await runBusinessAssistantWorker({ once: true });
      expect(result).toEqual({ messagesProcessed: 1, itemsProcessed: 1, errors: 0 });
      const item = await prisma.businessAssistantRunItem.findFirstOrThrow({ where: { tenantId: tenantId!, runId: accepted.runId! }, select: { lifecycleState: true, executionOutcome: true, output: true } });
      expect(item.lifecycleState).toBe('SUCCEEDED');
      expect(item.executionOutcome).toBe('SUCCEEDED_READ');
      expect(item.output).toMatchObject({ resources: [] });
      const answer = await prisma.businessAssistantMessage.findFirst({ where: { tenantId: tenantId!, conversationId: accepted.conversationId, role: 'ASSISTANT', type: 'RESULT' }, select: { content: true, status: true } });
      expect(answer).toEqual({ content: 'No accessible workspace records matched your request.', status: 'PROCESSED' });
    } finally {
      if (previousEnabled === undefined) delete process.env.BUSINESS_ASSISTANT_ENABLED;
      else process.env.BUSINESS_ASSISTANT_ENABLED = previousEnabled;
    }
  });

  it('routes one accepted lookup turn once and reuses the persisted run after message replay', async () => {
    const previousEnabled = process.env.BUSINESS_ASSISTANT_ENABLED;
    const previousProviderEnabled = process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED;
    process.env.BUSINESS_ASSISTANT_ENABLED = 'true';
    process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED = 'false';
    try {
      const accepted = await acceptTurn(
        { tenantId: tenantId!, userId: userId!, requestId: randomUUID() },
        { clientRequestId: randomUUID(), workspaceId: tenantId!, message: 'Find companies' },
      );
      expect(accepted.runId).toBeNull();

      await expect(runBusinessAssistantWorker({ once: true })).resolves.toEqual({ messagesProcessed: 1, itemsProcessed: 1, errors: 0 });
      const source = await prisma.businessAssistantMessage.findUniqueOrThrow({
        where: { id: accepted.messageId },
        select: { payload: true, status: true },
      });
      expect(source.status).toBe('PROCESSED');
      expect(source.payload).toMatchObject({ routing: { kind: 'CAPABILITY', capabilityId: 'workspace.resource_lookup', capabilityVersion: '1.0' } });
      const payload = source.payload as Record<string, unknown>;
      expect(typeof payload.runId).toBe('string');
      expect(await prisma.businessAssistantRun.count({ where: { tenantId: tenantId!, conversationId: accepted.conversationId } })).toBe(1);
      expect(await prisma.businessAssistantMessage.count({ where: { tenantId: tenantId!, conversationId: accepted.conversationId, role: 'ASSISTANT', operationKind: 'RESULT' } })).toBe(1);

      await prisma.businessAssistantMessage.update({
        where: { id: accepted.messageId },
        data: { status: 'ACCEPTED', availableAt: new Date(Date.now() - 1_000), claimToken: null, leaseExpiresAt: null },
      });
      await expect(runBusinessAssistantWorker({ once: true })).resolves.toEqual({ messagesProcessed: 1, itemsProcessed: 0, errors: 0 });
      expect(await prisma.businessAssistantRun.count({ where: { tenantId: tenantId!, conversationId: accepted.conversationId } })).toBe(1);
      expect(await prisma.businessAssistantMessage.count({ where: { tenantId: tenantId!, conversationId: accepted.conversationId, role: 'ASSISTANT', operationKind: 'RESULT' } })).toBe(1);
    } finally {
      if (previousEnabled === undefined) delete process.env.BUSINESS_ASSISTANT_ENABLED;
      else process.env.BUSINESS_ASSISTANT_ENABLED = previousEnabled;
      if (previousProviderEnabled === undefined) delete process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED;
      else process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED = previousProviderEnabled;
    }
  });
});

async function createRun(status: 'PREPARING' | 'RUNNING') {
  const conversation = await prisma.businessAssistantConversation.create({ data: { tenantId: tenantId!, ownerId: userId!, title: 'Integration test', status: 'ACTIVE' }, select: { id: true } });
  return prisma.businessAssistantRun.create({
    data: {
      tenantId: tenantId!, conversationId: conversation.id, conversationTenantId: tenantId!, ownerId: userId!, capabilityId: 'workspace.resource_lookup', capabilityVersion: '1.0', contractVersion: '1', schemaVersion: '1',
      input: { message: 'List companies' }, resources: [], status,
    },
    select: { id: true, conversationId: true },
  });
}

async function createItem(runId: string, itemKey: string, ordinal: number) {
  return prisma.businessAssistantRunItem.create({
    data: {
      tenantId: tenantId!, runId, itemKey, ordinal, input: { message: 'List companies' }, resources: [], lifecycleState: 'PENDING', executionOutcome: 'NOT_STARTED', reviewOutcome: 'NOT_REQUIRED', requiredEffectStatus: 'NOT_REQUIRED', activeStage: 'PREPARATION', availableAt: new Date(Date.now() - 1_000),
    },
    select: { id: true, itemKey: true },
  });
}

async function clearAssistantRows(onlyTenantId?: string): Promise<void> {
  const where = onlyTenantId ? { tenantId: onlyTenantId } : undefined;
  await prisma.businessAssistantReview.deleteMany({ where });
  await prisma.businessAssistantRunStep.deleteMany({ where });
  await prisma.businessAssistantApproval.deleteMany({ where });
  await prisma.businessAssistantProposal.deleteMany({ where });
  await prisma.businessAssistantRunItem.deleteMany({ where });
  await prisma.businessAssistantRun.deleteMany({ where });
  await prisma.businessAssistantMessage.deleteMany({ where });
  await prisma.businessAssistantFeedback.deleteMany({ where });
  await prisma.businessAssistantMemory.deleteMany({ where });
  await prisma.businessAssistantLearningChange.deleteMany({ where });
  await prisma.businessAssistantLearningActiveTarget.deleteMany({ where });
  await prisma.businessAssistantActionRequest.deleteMany({ where });
  await prisma.businessAssistantConversation.deleteMany({ where });
  if (!onlyTenantId) await prisma.businessAssistantCapacitySlot.deleteMany({ where: { slotKey: { in: slotKeys } } });
}