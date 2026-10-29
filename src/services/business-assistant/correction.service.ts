import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma';
import { businessAssistantCapabilityRegistry } from '@/generated/business-assistant-capability-registry';
import { acquireBusinessOperationBarrier } from '@/lib/business-operation-backup-barrier';
import { resolveFreshActor } from '@/lib/fresh-authorization';
import { prisma } from '@/lib/prisma';
import { businessAssistantCorrectionRequestSchema } from '@/lib/validations/business-assistant';
import { CapabilityCorrectionError, sha256, type CanonicalActorContext, type PreparedCapabilityArtifact } from './contracts';
import { asPrefetchableCorrectionHandler } from './correction-prefetch';
import { runCorrectionSerializableTransaction } from './correction-transaction';
import { assertAssistantMutationAccess } from './policy.service';
import { persistProposal } from './proposal.service';

export { CapabilityCorrectionError as CorrectionServiceError } from './contracts';
const KIND = 'CORRECTION_PROPOSAL';
const responseSchema = z.object({
  kind: z.literal(KIND), correctionOfReviewId: z.string().min(1), sourceRunId: z.string().min(1),
  runId: z.string().min(1), runItemId: z.string().min(1), proposalId: z.string().min(1),
  revision: z.number().int().positive(), duplicate: z.boolean(),
}).strict();
export type CorrectionProposalResult = z.infer<typeof responseSchema>;
export interface CreateCorrectionProposalInput { actor: CanonicalActorContext; runId: string; rawInput: unknown }
interface CorrectionPrefetchEnvelope {
  capabilityId: string;
  capabilityVersion: string;
  contractVersion: string;
  evidence: unknown;
}
function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }

/** Prepare only: the existing confirmation flow creates a new operation ID. */
export async function createCorrectionProposal(input: CreateCorrectionProposalInput): Promise<CorrectionProposalResult> {
  const parsed = businessAssistantCorrectionRequestSchema.safeParse(input.rawInput);
  if (!parsed.success) throw new CapabilityCorrectionError('VALIDATION_FAILED', 'The correction request is invalid.');
  const request = parsed.data;
  if (request.workspaceId && request.workspaceId !== input.actor.tenantId) throw new CapabilityCorrectionError('FORBIDDEN', 'The correction workspace does not match the current actor.');
  await assertAssistantMutationAccess(input.actor.userId, input.actor.tenantId);
  const bodyHash = sha256({ kind: KIND, runId: input.runId, request });

  // External source verification must not extend the serializable write
  // transaction. These preflight reads are advisory only: an existing action
  // merely suppresses unnecessary external I/O, while the transaction below
  // remains authoritative for replay/conflict, permissions and source state.
  const [preflightRun, preflightExistingAction] = await Promise.all([
    prisma.businessAssistantRun.findFirst({
      where: { id: input.runId, tenantId: input.actor.tenantId, ownerId: input.actor.userId },
      select: { id: true, capabilityId: true, capabilityVersion: true, contractVersion: true },
    }),
    prisma.businessAssistantActionRequest.findFirst({
      where: { tenantId: input.actor.tenantId, ownerId: input.actor.userId, actionKind: 'REVISE', clientRequestId: request.clientRequestId },
      select: { id: true },
    }),
  ]);
  let correctionPrefetch: CorrectionPrefetchEnvelope | null = null;
  if (preflightRun && !preflightExistingAction) {
    const preflightCapability = businessAssistantCapabilityRegistry.get(preflightRun.capabilityId, preflightRun.capabilityVersion);
    if (preflightCapability?.executionKind === 'CANONICAL_WRITE' && preflightCapability.prepareCorrection
      && preflightCapability.contractVersion === preflightRun.contractVersion) {
      const prefetchable = asPrefetchableCorrectionHandler(preflightCapability.prepareCorrection);
      if (prefetchable.prefetch) {
        correctionPrefetch = {
          capabilityId: preflightCapability.id,
          capabilityVersion: preflightCapability.version,
          contractVersion: preflightCapability.contractVersion,
          evidence: await prefetchable.prefetch({ actor: input.actor, request, sourceRunId: preflightRun.id, db: prisma }),
        };
      }
    }
  }

  return runCorrectionSerializableTransaction(prisma, async (tx) => {
    await acquireBusinessOperationBarrier(tx, input.actor.tenantId, 'shared');
    const actor = await resolveFreshActor({ userId: input.actor.userId, workspaceId: input.actor.tenantId }, tx);
    if (!actor) throw new CapabilityCorrectionError('FORBIDDEN', 'The current user or workspace is unavailable.');
    const backups = await tx.workspaceBackup.findMany({
      where: { tenantId: input.actor.tenantId, status: { in: ['RESTORING', 'COMPLETED'] } }, select: { status: true, errorDetails: true },
    });
    if (backups.some((backup) => backup.status === 'RESTORING' || Boolean(backup.errorDetails
      && typeof backup.errorDetails === 'object' && !Array.isArray(backup.errorDetails)
      && (backup.errorDetails as Record<string, unknown>).businessAssistantDispatchPaused === true))) {
      throw new CapabilityCorrectionError('FORBIDDEN', 'The workspace is restoring and cannot accept correction proposals.');
    }
    if (process.env.BUSINESS_ASSISTANT_MUTATIONS_ENABLED !== 'true' || process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED !== 'true') {
      throw new CapabilityCorrectionError('FORBIDDEN', 'Correction preparation is disabled by workspace dispatch policy.');
    }
    const run = await tx.businessAssistantRun.findFirst({
      where: { id: input.runId, tenantId: input.actor.tenantId, ownerId: input.actor.userId },
      select: { id: true, tenantId: true, ownerId: true, conversationId: true, capabilityId: true, capabilityVersion: true, contractVersion: true, schemaVersion: true },
    });
    if (!run) throw new CapabilityCorrectionError('NOT_FOUND', 'The source run is unavailable.');
    const existing = await tx.businessAssistantActionRequest.findFirst({
      where: { tenantId: input.actor.tenantId, ownerId: input.actor.userId, actionKind: 'REVISE', clientRequestId: request.clientRequestId },
      select: { bodyHash: true, response: true },
    });
    if (existing) {
      const response = responseSchema.safeParse(existing.response);
      if (existing.bodyHash !== bodyHash || !response.success || response.data.sourceRunId !== input.runId
        || response.data.correctionOfReviewId !== request.reviewId) {
        throw new CapabilityCorrectionError('ACTION_CONFLICT', 'This request ID was already used for another action or different content.');
      }
      return { ...response.data, duplicate: true };
    }
    const capability = businessAssistantCapabilityRegistry.get(run.capabilityId, run.capabilityVersion);
    if (!capability || capability.executionKind !== 'CANONICAL_WRITE' || !capability.prepareCorrection) {
      throw new CapabilityCorrectionError('VALIDATION_FAILED', 'This capability does not support correction proposals.');
    }
    if (capability.contractVersion !== run.contractVersion) throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The source capability contract has changed.');
    if (correctionPrefetch && (correctionPrefetch.capabilityId !== capability.id
      || correctionPrefetch.capabilityVersion !== capability.version
      || correctionPrefetch.contractVersion !== capability.contractVersion)) {
      throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The correction capability changed after source prefetch.');
    }
    const review = await tx.businessAssistantReview.findFirst({
      where: { id: request.reviewId, tenantId: input.actor.tenantId },
      select: { id: true, tenantId: true, runItemId: true, attemptNumber: true, verdict: true, executionConformance: true, sourceAlignment: true, findings: true, coverage: true, evidence: true },
    });
    if (!review) throw new CapabilityCorrectionError('NOT_FOUND', 'The source review is unavailable.');
    const item = await tx.businessAssistantRunItem.findFirst({
      where: { id: review.runItemId, tenantId: input.actor.tenantId, runId: run.id },
      select: { id: true, tenantId: true, runId: true, operationId: true, input: true, output: true, receiptRef: true,
        executionOutcome: true, lifecycleState: true, activeStage: true, reviews: { orderBy: { attemptNumber: 'desc' }, take: 1, select: { id: true } } },
    });
    if (!item) throw new CapabilityCorrectionError('NOT_FOUND', 'The source review is unavailable.');
    if (item.reviews[0]?.id !== review.id || item.executionOutcome !== 'COMMITTED' || !item.receiptRef || !item.operationId
      || item.activeStage !== null || !['NEEDS_REVIEW', 'PASSED', 'PASSED_WITH_WARNINGS'].includes(item.lifecycleState)) {
      throw new CapabilityCorrectionError('PROPOSAL_STALE', 'Corrections require the latest review of a committed operation.');
    }
    const nextRunId = randomUUID();
    const nextItemId = randomUUID();
    const correctionHandler = asPrefetchableCorrectionHandler(capability.prepareCorrection);
    const result = await correctionHandler({
      actor: input.actor, request, sourceRunId: run.id, sourceReview: review, sourceItem: { ...item, run }, nextRunId, nextItemId, db: tx,
    }, correctionPrefetch?.evidence);
    if (result.status === 'BLOCKED') throw new CapabilityCorrectionError('PROPOSAL_STALE', result.reason);
    if (result.preparedItem.itemId !== nextItemId || result.preparedItem.status !== 'ELIGIBLE') {
      throw new CapabilityCorrectionError('VALIDATION_FAILED', 'The capability returned an invalid correction item.');
    }
    const preparedBody = { status: 'PREPARED' as const, items: [result.preparedItem], preparedAt: new Date().toISOString() };
    const prepared: PreparedCapabilityArtifact = { ...preparedBody, preparedHash: sha256(preparedBody) };
    if (!capability.preparedSchema.safeParse(prepared).success) throw new CapabilityCorrectionError('VALIDATION_FAILED', 'The correction proposal does not satisfy its capability contract.');
    await tx.businessAssistantRun.create({ data: {
      id: nextRunId, tenantId: input.actor.tenantId, ownerId: input.actor.userId,
      conversationId: run.conversationId, conversationTenantId: run.conversationId ? input.actor.tenantId : null,
      capabilityId: capability.id, capabilityVersion: capability.version, contractVersion: capability.contractVersion, schemaVersion: run.schemaVersion,
      input: json({ kind: KIND, correctionOfReviewId: review.id, sourceRunId: run.id, lineage: result.lineage }), resources: json(result.resources), status: 'DRAFT',
    } });
    await tx.businessAssistantRunItem.create({ data: {
      id: nextItemId, tenantId: input.actor.tenantId, runId: nextRunId, itemKey: result.preparedItem.itemKey, ordinal: 0,
      input: json(result.preparedItem.input), resources: json(result.preparedItem.resources), lifecycleState: 'WAITING_CONFIRMATION',
      executionOutcome: 'NOT_STARTED', reviewOutcome: capability.reviewPolicy === 'NONE' ? 'NOT_REQUIRED' : 'NOT_STARTED',
      requiredEffectStatus: result.preparedItem.effectManifest?.some((effect) => effect.required) ? 'PENDING' : 'NOT_REQUIRED',
      activeStage: null, availableAt: new Date(),
    } });
    const proposal = await persistProposal({ actor: input.actor, runId: nextRunId, prepared,
      policyVersion: capability.approvalPolicyVersion, schemaVersion: run.schemaVersion }, tx);
    const response: CorrectionProposalResult = { kind: KIND, correctionOfReviewId: review.id, sourceRunId: run.id,
      runId: nextRunId, runItemId: nextItemId, proposalId: proposal.id, revision: proposal.revision, duplicate: false };
    await tx.businessAssistantActionRequest.create({ data: {
      tenantId: input.actor.tenantId, ownerId: input.actor.userId, runId: nextRunId, actionKind: 'REVISE',
      clientRequestId: request.clientRequestId, bodyHash, status: 'APPLIED', response: json(response),
    } });
    return response;
  });
}
