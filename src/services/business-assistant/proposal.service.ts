import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import { sha256, type CanonicalActorContext, type PreparedCapabilityArtifact } from './contracts';

type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export interface ProposalInput {
  actor: CanonicalActorContext;
  runId: string;
  prepared: PreparedCapabilityArtifact;
  policyVersion: string;
  schemaVersion: string;
  expiresAt?: Date;
}

export interface ProposalSelection {
  runId: string;
  itemIds: readonly string[];
  proposalId: string;
  revision: number;
  actionKey: string;
  actionBodyHash: string;
}

function eligibleBindings(prepared: PreparedCapabilityArtifact): readonly { itemId: string; itemKey: string; preparedHash: string }[] {
  return prepared.items
    .filter((item) => item.status === 'ELIGIBLE')
    .map((item) => ({ itemId: item.itemId, itemKey: item.itemKey, preparedHash: sha256(item) }));
}

export async function persistProposal(input: ProposalInput, client: TransactionClient = prisma as unknown as TransactionClient) {
  const preparedHash = sha256({ prepared: input.prepared, serializerVersion: '1' });
  const latest = await client.businessAssistantProposal.findFirst({
    where: { tenantId: input.actor.tenantId, runId: input.runId },
    orderBy: { revision: 'desc' },
    select: { revision: true },
  });
  const revision = (latest?.revision ?? 0) + 1;
  if (latest) {
    await client.businessAssistantProposal.updateMany({
      where: { tenantId: input.actor.tenantId, runId: input.runId, status: 'ACTIVE' },
      data: { status: 'SUPERSEDED' },
    });
  }
  const eligible = eligibleBindings(input.prepared);
  const effectManifest = input.prepared.items.flatMap((item) => (item.effectManifest ?? []).map((effect) => ({ itemId: item.itemId, ...effect })));
  const proposal = await client.businessAssistantProposal.create({
    data: {
      tenantId: input.actor.tenantId,
      runId: input.runId,
      revision,
      status: 'ACTIVE',
      preparedArtifact: jsonInput(input.prepared),
      preparedHash,
      eligibleItems: jsonInput(eligible),
      effectManifest: jsonInput(effectManifest),
      policyVersion: input.policyVersion,
      serializerVersion: '1',
      schemaVersion: input.schemaVersion,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 30 * 60_000),
      createdById: input.actor.userId,
    },
    select: { id: true, revision: true, preparedHash: true, expiresAt: true },
  });
  await client.businessAssistantRun.updateMany({
    where: { tenantId: input.actor.tenantId, id: input.runId },
    data: { activeProposalId: proposal.id, status: 'WAITING_CONFIRMATION' },
  });
  await client.businessAssistantRunItem.updateMany({
    where: { tenantId: input.actor.tenantId, runId: input.runId, itemKey: { in: input.prepared.items.map((item) => item.itemKey) } },
    data: { lifecycleState: 'WAITING_CONFIRMATION', activeStage: null, availableAt: new Date() },
  });
  const blockedItemKeys = input.prepared.items.filter((item) => item.status !== 'ELIGIBLE').map((item) => item.itemKey);
  if (blockedItemKeys.length > 0) {
    await client.businessAssistantRunItem.updateMany({
      where: { tenantId: input.actor.tenantId, runId: input.runId, itemKey: { in: blockedItemKeys } },
      data: { lifecycleState: 'BLOCKED', dispositionReason: 'PREPARATION_BLOCKED', activeStage: null, availableAt: new Date() },
    });
  }
  return proposal;
}

export async function confirmProposal(input: ProposalSelection & { actor: CanonicalActorContext }) {
  const actionBodyHash = input.actionBodyHash;
  return runSerializableTransaction(prisma, async (tx) => {
    const proposal = await tx.businessAssistantProposal.findFirst({
      where: { tenantId: input.actor.tenantId, id: input.proposalId, runId: input.runId, revision: input.revision, status: { in: ['ACTIVE', 'CONFIRMED'] } },
      select: { id: true, revision: true, preparedHash: true, eligibleItems: true, expiresAt: true, runId: true, status: true },
    });
    if (!proposal) throw new ProposalServiceError('PROPOSAL_STALE', 'The proposal is no longer current.');
    if (proposal.expiresAt.getTime() <= Date.now()) {
      await tx.businessAssistantProposal.update({ where: { id: proposal.id }, data: { status: 'EXPIRED' } });
      throw new ProposalServiceError('APPROVAL_EXPIRED', 'The proposal has expired.');
    }
    const bindings = Array.isArray(proposal.eligibleItems) ? proposal.eligibleItems as Array<{ itemId?: string; itemKey?: string; preparedHash?: string }> : [];
    const byId = new Map(bindings.map((binding) => [binding.itemId, binding]));
    const uniqueItems = [...new Set(input.itemIds)];
    if (uniqueItems.length === 0 || uniqueItems.some((id) => !byId.has(id))) throw new ProposalServiceError('ACTION_CONFLICT', 'Confirmation must select eligible items from the current proposal.');
    const selectedBindings = uniqueItems.map((id) => byId.get(id)!);
    const existing = await tx.businessAssistantApproval.findFirst({ where: { tenantId: input.actor.tenantId, runId: input.runId, proposalId: proposal.id, decision: 'APPROVED' }, select: { id: true, selectedItems: true, actionKey: true, actionBodyHash: true } });
    if (existing) {
      if (existing.actionKey !== input.actionKey || existing.actionBodyHash !== actionBodyHash) throw new ProposalServiceError('ACTION_CONFLICT', 'The proposal is already approved with a different selection.');
      const storedItems = Array.isArray(existing.selectedItems) && existing.selectedItems.every((item): item is string => typeof item === 'string') ? existing.selectedItems : [];
      if (storedItems.length !== uniqueItems.length || storedItems.some((itemId, index) => itemId !== uniqueItems[index])) {
        throw new ProposalServiceError('ACTION_CONFLICT', 'The proposal is already approved with a different selection.');
      }
      const existingItems = await tx.businessAssistantRunItem.findMany({
        where: { tenantId: input.actor.tenantId, runId: input.runId, id: { in: storedItems } },
        select: { id: true, operationId: true },
      });
      if (existingItems.length !== storedItems.length || existingItems.some((item) => !item.operationId)) {
        throw new ProposalServiceError('ACTION_CONFLICT', 'The approved operation identity is unavailable.');
      }
      const operationByItemId = new Map(existingItems.map((item) => [item.id, item.operationId!]));
      return { approvalId: existing.id, operationIds: storedItems.map((itemId) => ({ itemId, operationId: operationByItemId.get(itemId)! })), duplicate: true };
    }
    if (proposal.status === 'CONFIRMED') throw new ProposalServiceError('PROPOSAL_STALE', 'The proposal is no longer current.');
    const operations = uniqueItems.map((itemId) => ({ itemId, operationId: randomUUID() }));
    const approval = await tx.businessAssistantApproval.create({
      data: {
        tenantId: input.actor.tenantId,
        runId: input.runId,
        proposalId: proposal.id,
        revision: proposal.revision,
        selectedItems: jsonInput(uniqueItems),
        selectedBindings: jsonInput(selectedBindings),
        decision: 'APPROVED',
        policyVersion: '1',
        approverId: input.actor.userId,
        actionKey: input.actionKey,
        actionBodyHash,
        expiresAt: proposal.expiresAt,
      },
      select: { id: true },
    });
    await tx.businessAssistantProposal.update({ where: { id: proposal.id }, data: { status: 'CONFIRMED' } });
    for (const operation of operations) {
      const updated = await tx.businessAssistantRunItem.updateMany({
        where: { tenantId: input.actor.tenantId, id: operation.itemId, runId: input.runId, lifecycleState: 'WAITING_CONFIRMATION' },
        data: { lifecycleState: 'READY', operationId: operation.operationId, availableAt: new Date() },
      });
      if (updated.count !== 1) throw new ProposalServiceError('ACTION_CONFLICT', 'An item changed while confirmation was being applied.');
    }
    await tx.businessAssistantRun.update({ where: { id: input.runId }, data: { status: 'READY' } });
    return { approvalId: approval.id, operationIds: operations, duplicate: false };
  });
}

export class ProposalServiceError extends Error {
  constructor(readonly code: 'PROPOSAL_STALE' | 'APPROVAL_EXPIRED' | 'ACTION_CONFLICT', message: string) {
    super(message);
    this.name = 'ProposalServiceError';
  }
}
