import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import { businessAssistantActionSchema, type BusinessAssistantAction } from '@/lib/validations/business-assistant';
import { businessAssistantCapabilityRegistry } from '@/generated/business-assistant-capability-registry';
import { aggregateRun, isBlockedPreparation, sha256, type CapabilityPresentation, type JsonValue } from './contracts';
import { assertAssistantActor, assertAssistantMutationAccess, assertAssistantWorkspaceOperational } from './policy.service';
import { confirmProposal, persistProposal } from './proposal.service';
import type { AssistantActor } from './conversation.service';

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export interface RunDto {
  id: string;
  conversationId: string | null;
  capabilityId: string;
  capabilityVersion: string;
  contractVersion: string;
  schemaVersion: string;
  status: string;
  resources: readonly JsonValue[];
  items: readonly RunItemDto[];
  proposal: ProposalDto | null;
  aggregate: ReturnType<typeof aggregateRun>;
  cancellationRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  allowedActions: readonly ('REVISE' | 'CONFIRM' | 'CANCEL' | 'RETRY')[];
}

export interface RunItemDto {
  id: string;
  itemKey: string;
  ordinal: number;
  lifecycleState: string;
  executionOutcome: string;
  reviewOutcome: string;
  requiredEffectStatus: string;
  dispositionReason: string | null;
  operationId: string | null;
  output: JsonValue | null;
  receipt: JsonValue | null;
  presentation: CapabilityPresentation | null;
  reviews: readonly ReviewDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewDto {
  id: string;
  attemptNumber: number;
  verdict: string;
  executionConformance: string;
  sourceAlignment: string;
  evidence: JsonValue;
  findings: JsonValue;
  coverage: JsonValue;
  schemaVersion: string;
  promptVersion: string;
  providerVersion: string | null;
  createdAt: string;
}

export interface ProposalDto {
  id: string;
  revision: number;
  status: string;
  preparedArtifact: JsonValue;
  preparedHash: string;
  /** Client-safe item IDs; approval accepts only this immutable subset. */
  eligibleItems: readonly string[];
  /** Immutable binding hashes retained for review/audit. */
  eligibleBindings: readonly { itemId: string; itemKey: string; preparedHash: string }[];
  effectManifest: JsonValue | null;
  presentation: CapabilityPresentation | null;
  expiresAt: string;
  createdAt: string;
}

export async function getRun(actor: AssistantActor, runId: string): Promise<RunDto> {
  await assertAssistantActor(actor.userId, actor.tenantId);
  const run = await prisma.businessAssistantRun.findFirst({
    where: { id: runId, tenantId: actor.tenantId, ownerId: actor.userId },
    select: {
      id: true,
      conversationId: true,
      capabilityId: true,
      capabilityVersion: true,
      contractVersion: true,
      schemaVersion: true,
      status: true,
      resources: true,
      cancellationRequestedAt: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      items: {
        orderBy: { ordinal: 'asc' },
        select: {
          id: true,
          itemKey: true,
          ordinal: true,
          lifecycleState: true,
          executionOutcome: true,
          reviewOutcome: true,
          requiredEffectStatus: true,
          dispositionReason: true,
          operationId: true,
          output: true,
          receiptRef: true,
          createdAt: true,
          updatedAt: true,
          reviews: {
            orderBy: { attemptNumber: 'desc' },
            select: { id: true, attemptNumber: true, verdict: true, executionConformance: true, sourceAlignment: true, evidence: true, findings: true, coverage: true, schemaVersion: true, promptVersion: true, providerVersion: true, createdAt: true },
          },
        },
      },
      proposals: { orderBy: { revision: 'desc' }, take: 1, select: { id: true, revision: true, status: true, preparedArtifact: true, preparedHash: true, eligibleItems: true, effectManifest: true, expiresAt: true, createdAt: true } },
    },
  });
  if (!run) throw new RunServiceError('NOT_FOUND', 'The run is unavailable.');
  const capability = businessAssistantCapabilityRegistry.get(run.capabilityId, run.capabilityVersion);
  const selected = run.items.map((item) => ({
    selected: item.dispositionReason !== 'NOT_SELECTED' && item.lifecycleState !== 'BLOCKED',
    lifecycleState: item.lifecycleState,
    executionOutcome: item.executionOutcome,
    reviewOutcome: item.reviewOutcome,
    requiredEffectStatus: item.requiredEffectStatus,
    dispositionReason: item.dispositionReason,
  }));
  const aggregate = aggregateRun(selected, {
    confirmationPending: run.status === 'WAITING_CONFIRMATION',
    preparing: run.status === 'PREPARING',
    cancellationRequested: run.status === 'CANCEL_REQUESTED',
  });
  const proposalRecord = run.proposals[0];
  const presentation = capability && proposalRecord ? safePresent(capability, proposalRecord.preparedArtifact) : null;
  const eligibleBindings = proposalRecord && Array.isArray(proposalRecord.eligibleItems)
    ? proposalRecord.eligibleItems.filter((binding): binding is { itemId: string; itemKey: string; preparedHash: string } => Boolean(binding && typeof binding === 'object' && !Array.isArray(binding) && typeof (binding as Record<string, unknown>).itemId === 'string' && typeof (binding as Record<string, unknown>).itemKey === 'string' && typeof (binding as Record<string, unknown>).preparedHash === 'string'))
    : [];
  const proposal = proposalRecord ? {
    id: proposalRecord.id,
    revision: proposalRecord.revision,
    status: proposalRecord.status,
    preparedArtifact: proposalRecord.preparedArtifact as JsonValue,
    preparedHash: proposalRecord.preparedHash,
    eligibleItems: eligibleBindings.map((binding) => binding.itemId),
    eligibleBindings,
    effectManifest: proposalRecord.effectManifest as JsonValue | null,
    presentation,
    expiresAt: proposalRecord.expiresAt.toISOString(),
    createdAt: proposalRecord.createdAt.toISOString(),
  } : null;
  const allowedActions = allowedRunActions(run.status, proposal);
  return {
    id: run.id,
    conversationId: run.conversationId,
    capabilityId: run.capabilityId,
    capabilityVersion: run.capabilityVersion,
    contractVersion: run.contractVersion,
    schemaVersion: run.schemaVersion,
    status: run.status,
    resources: Array.isArray(run.resources) ? run.resources as readonly JsonValue[] : [],
    items: run.items.map((item) => ({
      id: item.id,
      itemKey: item.itemKey,
      ordinal: item.ordinal,
      lifecycleState: item.lifecycleState,
      executionOutcome: item.executionOutcome,
      reviewOutcome: item.reviewOutcome,
      requiredEffectStatus: item.requiredEffectStatus,
      dispositionReason: item.dispositionReason,
      operationId: item.operationId,
      output: item.output as JsonValue | null,
      receipt: item.receiptRef as JsonValue | null,
      presentation: presentation ? {
        sections: presentation.sections.filter((section) => section.id.startsWith(`${item.id}:`)),
        ...(presentation.allowedActions ? { allowedActions: presentation.allowedActions } : {}),
      } : null,
      reviews: item.reviews.map((review) => ({ ...review, evidence: review.evidence as JsonValue, findings: review.findings as JsonValue, coverage: review.coverage as JsonValue, providerVersion: review.providerVersion, createdAt: review.createdAt.toISOString() })),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    proposal,
    aggregate,
    cancellationRequestedAt: run.cancellationRequestedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    allowedActions,
  };
}

function safePresent(capability: NonNullable<ReturnType<typeof businessAssistantCapabilityRegistry.get>>, prepared: Prisma.JsonValue): CapabilityPresentation | null {
  try {
    return capability.present(prepared);
  } catch {
    return null;
  }
}

function allowedRunActions(status: string, proposal: ProposalDto | null): RunDto['allowedActions'] {
  if (status === 'WAITING_CONFIRMATION' && proposal && new Date(proposal.expiresAt).getTime() > Date.now()) return ['REVISE', 'CONFIRM', 'CANCEL'];
  if (['RUNNING', 'PREPARING', 'READY', 'RECOVERING', 'REVIEWING', 'CANCEL_REQUESTED'].includes(status)) return ['CANCEL', 'RETRY'];
  if (status === 'COMPLETED_WITH_EXCEPTIONS' || status === 'FAILED') return ['RETRY'];
  return [];
}

export async function applyRunAction(actor: AssistantActor, runId: string, rawAction: unknown): Promise<RunDto> {
  const parsed = businessAssistantActionSchema.safeParse(rawAction);
  if (!parsed.success) throw new RunServiceError('VALIDATION_FAILED', 'The assistant action is invalid.', parsed.error.flatten());
  const action = parsed.data;
  const run = await prisma.businessAssistantRun.findFirst({ where: { id: runId, tenantId: actor.tenantId, ownerId: actor.userId }, select: { id: true, capabilityId: true, capabilityVersion: true, status: true, activeProposalId: true } });
  if (!run) throw new RunServiceError('NOT_FOUND', 'The run is unavailable.');
  const capability = businessAssistantCapabilityRegistry.get(run.capabilityId, run.capabilityVersion);
  if (!capability) throw new RunServiceError('CAPABILITY_VERSION_UNAVAILABLE', 'The capability version is unavailable.');
  await assertAssistantActor(actor.userId, actor.tenantId);
  if (action.action === 'RETRY' && capability.executionKind === 'READ_ONLY') {
    // Retrying a lookup does not authorize a business write. Capabilities that
    // need a provider recheck their own dispatch gate when the worker runs.
    await assertAssistantWorkspaceOperational(actor.userId, actor.tenantId);
  } else if (action.action !== 'CANCEL') {
    await assertAssistantMutationAccess(actor.userId, actor.tenantId);
  }
  const actionKind = actionToKind(action);
  const actionBodyHash = sha256({ runId, action });
  const duplicate = await prisma.businessAssistantActionRequest.findFirst({ where: { tenantId: actor.tenantId, ownerId: actor.userId, actionKind, clientRequestId: action.clientRequestId }, select: { bodyHash: true } });
  if (duplicate) {
    if (duplicate.bodyHash !== actionBodyHash) throw new RunServiceError('ACTION_CONFLICT', 'This action request ID was already used with different content.');
    return getRun(actor, runId);
  }
  if (action.action === 'REVISE') {
    if (capability.executionKind !== 'CANONICAL_WRITE' || !run.activeProposalId || action.proposalId !== run.activeProposalId) throw new RunServiceError('PROPOSAL_STALE', 'The proposal is no longer current.');
    const proposal = await prisma.businessAssistantProposal.findFirst({ where: { tenantId: actor.tenantId, id: action.proposalId, runId, revision: action.revision, status: 'ACTIVE' }, select: { preparedArtifact: true, revision: true, expiresAt: true } });
    if (!proposal) throw new RunServiceError('PROPOSAL_STALE', 'The proposal is no longer current.');
    if (proposal.expiresAt.getTime() <= Date.now()) throw new RunServiceError('APPROVAL_EXPIRED', 'The proposal has expired.');
    const prepared = await capability.revise(proposal.preparedArtifact, { itemId: action.itemId, patch: action.patch }, { actor: { tenantId: actor.tenantId, userId: actor.userId, requestId: action.clientRequestId, source: 'BUSINESS_ASSISTANT' }, resources: [] });
    if (isBlockedPreparation(prepared)) throw new RunServiceError('ACTION_CONFLICT', prepared.reason);
    await runSerializableTransaction(prisma, async (tx) => {
      await persistProposal({ actor: { tenantId: actor.tenantId, userId: actor.userId, requestId: action.clientRequestId, source: 'BUSINESS_ASSISTANT' }, runId, prepared, policyVersion: '1', schemaVersion: capability.version }, tx as never);
      await tx.businessAssistantActionRequest.create({ data: { tenantId: actor.tenantId, ownerId: actor.userId, runId, actionKind, clientRequestId: action.clientRequestId, bodyHash: actionBodyHash, status: 'APPLIED', response: jsonInput({ runId }) } });
    });
  } else if (action.action === 'CONFIRM') {
    if (capability.executionKind !== 'CANONICAL_WRITE') throw new RunServiceError('ACTION_CONFLICT', 'Read-only capabilities do not require confirmation.');
    await confirmProposal({ actor: { tenantId: actor.tenantId, userId: actor.userId, requestId: action.clientRequestId, source: 'BUSINESS_ASSISTANT' }, runId, proposalId: action.proposalId, revision: action.revision, itemIds: action.itemIds, actionKey: action.clientRequestId, actionBodyHash });
    await prisma.businessAssistantActionRequest.create({ data: { tenantId: actor.tenantId, ownerId: actor.userId, runId, actionKind, clientRequestId: action.clientRequestId, bodyHash: actionBodyHash, status: 'APPLIED', response: jsonInput({ runId }) } });
  } else if (action.action === 'CANCEL') {
    await runSerializableTransaction(prisma, async (tx) => {
      await tx.businessAssistantRun.updateMany({ where: { tenantId: actor.tenantId, id: runId, status: { notIn: ['COMPLETED', 'COMPLETED_WITH_EXCEPTIONS', 'FAILED', 'CANCELLED', 'EXPIRED'] } }, data: { cancellationRequestedAt: new Date(), cancellationReason: action.reason ?? null, status: 'CANCEL_REQUESTED' } });
      await tx.businessAssistantRunItem.updateMany({ where: { tenantId: actor.tenantId, runId, lifecycleState: { in: ['PENDING', 'PREPARING', 'WAITING_CONFIRMATION', 'READY'] } }, data: { lifecycleState: 'CANCELLED', dispositionReason: 'CANCEL_REQUESTED' } });
      await tx.businessAssistantActionRequest.create({ data: { tenantId: actor.tenantId, ownerId: actor.userId, runId, actionKind, clientRequestId: action.clientRequestId, bodyHash: actionBodyHash, status: 'APPLIED', response: jsonInput({ runId }) } });
    });
  } else {
    await runSerializableTransaction(prisma, async (tx) => {
      const items = await tx.businessAssistantRunItem.findMany({ where: { tenantId: actor.tenantId, runId, id: { in: action.itemIds } }, select: { id: true, lifecycleState: true, executionOutcome: true, reviewOutcome: true, requiredEffectStatus: true, activeStage: true, operationId: true } });
      if (items.length !== action.itemIds.length) throw new RunServiceError('NOT_FOUND', 'One or more run items are unavailable.');
      for (const item of items) {
        if (item.executionOutcome === 'OUTCOME_UNKNOWN') {
          await tx.businessAssistantRunItem.update({ where: { id: item.id }, data: { lifecycleState: 'RECOVERING', activeStage: 'EXECUTION', availableAt: new Date() } });
        } else if (item.executionOutcome === 'COMMITTED') {
          const stage = item.requiredEffectStatus !== 'NOT_REQUIRED' && item.requiredEffectStatus !== 'COMPLETE' ? 'EFFECTS' : item.reviewOutcome === 'NOT_STARTED' || item.reviewOutcome === 'RUNNING' ? 'REVIEW' : 'READ_BACK';
          await tx.businessAssistantRunItem.update({ where: { id: item.id }, data: { lifecycleState: 'RECOVERING', activeStage: action.stage ?? stage, availableAt: new Date() } });
        } else {
          await tx.businessAssistantRunItem.update({ where: { id: item.id }, data: { lifecycleState: 'PENDING', executionOutcome: 'NOT_STARTED', reviewOutcome: 'NOT_REQUIRED', requiredEffectStatus: 'NOT_REQUIRED', activeStage: action.stage ?? 'PREPARATION', availableAt: new Date() } });
        }
      }
      await tx.businessAssistantRun.update({ where: { id: runId }, data: { status: 'RUNNING' } });
      await tx.businessAssistantActionRequest.create({ data: { tenantId: actor.tenantId, ownerId: actor.userId, runId, actionKind, clientRequestId: action.clientRequestId, bodyHash: actionBodyHash, status: 'APPLIED', response: jsonInput({ runId }) } });
    });
  }
  return getRun(actor, runId);
}

function actionToKind(action: BusinessAssistantAction): 'REVISE' | 'CONFIRM' | 'CANCEL' | 'RETRY' {
  return action.action;
}

export class RunServiceError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'FORBIDDEN' | 'NOT_FOUND' | 'PROPOSAL_STALE' | 'APPROVAL_EXPIRED' | 'ACTION_CONFLICT' | 'CAPABILITY_VERSION_UNAVAILABLE', message: string, readonly details?: unknown) {
    super(message);
    this.name = 'RunServiceError';
  }
}
