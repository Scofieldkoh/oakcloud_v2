import { Prisma } from '@/generated/prisma';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import { businessAssistantCapabilityRegistry } from '@/generated/business-assistant-capability-registry';
import { aggregateRun, BUSINESS_ASSISTANT_LIMITS, canonicalizeJson, isBlockedPreparation, resourceRefSchema, sha256, type BusinessAssistantCapability, type CanonicalActorContext, type JsonValue, type PreparedCapabilityArtifact, type PreparedCapabilityItem, type ReadExecutionResult, type ResourceRef, type WorkerInvocationContext } from './contracts';
import { persistProposal } from './proposal.service';
import { recordClaimedReview } from './review.repository';
import { assertAssistantActor, assertAssistantMutationAccess, hasCapabilityPermissions } from './policy.service';
import { claimInboundMessage, claimRunnableItem, finishStageAttempt, releaseItemClaim, renewInboundMessageClaim, renewItemClaim, settleInboundMessage, startStageAttempt, updateClaimedItem, type AssistantClaim, type ClaimedItem, type StageAttempt } from './claim.repository';
import { resolveConversationResourceContext } from './conversation-context';
import { routeBusinessAssistantMessage, type RoutingDecision } from './routing.service';

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface WorkerOptions {
  pollIntervalMs?: number;
  signal?: AbortSignal;
  once?: boolean;
  /** Module-owned durable outbox drain; the generic worker knows no effect kinds. */
  effectDrain?: () => Promise<{ claimed: number; errors: number }>;
}

export interface WorkerResult {
  messagesProcessed: number;
  itemsProcessed: number;
  errors: number;
}

interface PersistedRoute {
  kind: 'CAPABILITY' | 'ANSWER' | 'CLARIFICATION';
  capabilityId?: string;
  capabilityVersion?: string;
  content?: string;
}

export async function runBusinessAssistantWorker(options: WorkerOptions = {}): Promise<WorkerResult> {
  const result: WorkerResult = { messagesProcessed: 0, itemsProcessed: 0, errors: 0 };
  do {
    if (options.signal?.aborted) break;
    let didWork = false;
    try {
      const messageClaim = await claimInboundMessage();
      if (messageClaim) {
        didWork = true;
        try {
          await processInboundMessage(messageClaim);
          result.messagesProcessed += 1;
        } catch (error) {
          result.errors += 1;
          await settleInboundMessage(messageClaim, 'FAILED');
          console.error('[business-assistant] inbound message failed', safeErrorMessage(error));
        }
      }
      const itemClaim = await claimRunnableItem();
      if (itemClaim) {
        didWork = true;
        try {
          await processClaimedItem(itemClaim);
          result.itemsProcessed += 1;
        } catch (error) {
          result.errors += 1;
          const exhausted = error instanceof Error && error.name === 'StageAttemptsExhaustedError';
          await updateClaimedItem(itemClaim, {
            availableAt: new Date(Date.now() + 30_000),
            retryCount: { increment: 1 },
            ...(exhausted ? { lifecycleState: 'FAILED', activeStage: null, dispositionReason: 'STAGE_ATTEMPTS_EXHAUSTED' } : {}),
          });
          await releaseItemClaim(itemClaim, { availableAt: new Date(Date.now() + 30_000), keepState: true });
          console.error('[business-assistant] item failed', safeErrorMessage(error));
        }
      }
    } catch (error) {
      result.errors += 1;
      console.error('[business-assistant] worker poll failed', safeErrorMessage(error));
    }
    // Module-owned effects are drained independently so an intake/database
    // error cannot starve committed receipts that came from another caller.
    if (options.effectDrain) {
      try {
        const effectDrain = await options.effectDrain();
        if (effectDrain.claimed > 0) didWork = true;
        result.errors += effectDrain.errors;
      } catch (error) {
        result.errors += 1;
        console.error('[business-assistant] effect drain failed', safeErrorMessage(error));
      }
    }
    if (options.once) break;
    if (!didWork) await sleep(options.pollIntervalMs ?? 1_000);
  } while (!options.signal?.aborted);
  return result;
}

async function processInboundMessage(claim: AssistantClaim & { id: string; tenantId: string; ownerId: string; conversationId: string }): Promise<void> {
  const message = await prisma.businessAssistantMessage.findFirst({
    where: { id: claim.id, tenantId: claim.tenantId, ownerId: claim.ownerId, conversation: { status: { not: 'DELETED' } } },
    select: { id: true, conversationId: true, content: true, payload: true, resources: true },
  });
  if (!message) return;
  if (!(await renewInboundMessageClaim(claim))) throw new Error('Inbound message claim was fenced');
  const conversation = await prisma.businessAssistantConversation.findFirst({
    where: { id: message.conversationId, tenantId: claim.tenantId, ownerId: claim.ownerId },
    select: { status: true },
  });
  if (!conversation || conversation.status === 'DELETED') {
    await settleInboundMessage(claim, 'FAILED');
    return;
  }
  if (conversation.status !== 'ACTIVE') {
    if (!(await settleInboundMessage(claim, 'PROCESSED'))) throw new Error('Inbound message claim was fenced while settling');
    return;
  }

  let payload = recordValue(message.payload);
  let runId = typeof payload.runId === 'string' ? payload.runId : null;
  if (!runId) {
    const persistedRoute = parsePersistedRoute(payload.routing);
    if (persistedRoute?.kind === 'CLARIFICATION') {
      if (!(await settleInboundMessage(claim, 'PROCESSED'))) throw new Error('Inbound message claim was fenced while settling');
      return;
    }

    const resources = await resolveConversationResourceContext({
      tenantId: claim.tenantId,
      userId: claim.ownerId,
      conversationId: claim.conversationId,
      messageId: claim.id,
    });

    let route: RoutingDecision;
    if (persistedRoute && (persistedRoute.kind === 'CAPABILITY' || persistedRoute.kind === 'ANSWER')) {
      route = persistedRoute.kind === 'ANSWER'
        ? { kind: 'ANSWER' }
        : { kind: 'CAPABILITY', capabilityId: persistedRoute.capabilityId!, capabilityVersion: persistedRoute.capabilityVersion! };
    } else {
      route = await routeBusinessAssistantMessage({
        tenantId: claim.tenantId,
        userId: claim.ownerId,
        message: message.content ?? '',
        resources,
      });
    }

    if (route.kind === 'CLARIFICATION') {
      await persistRoutingClarification(claim, message, payload, route, resources);
      if (!(await settleInboundMessage(claim, 'PROCESSED'))) throw new Error('Inbound message claim was fenced while settling');
      return;
    }

    runId = await persistRoutedRun(claim, message, payload, route, resources);
    payload = { ...payload, runId };
  }

  const run = await prisma.businessAssistantRun.findFirst({
    where: { id: runId, tenantId: claim.tenantId, ownerId: claim.ownerId },
    select: { id: true, capabilityId: true, capabilityVersion: true, input: true, resources: true, status: true, items: { select: { id: true } } },
  });
  if (!run) {
    await appendAssistantMessage({
      tenantId: claim.tenantId,
      conversationId: claim.conversationId,
      ownerId: claim.ownerId,
      type: 'ERROR',
      content: 'The requested assistant capability could not be started.',
      idempotencyKey: `run-missing:${claim.id}`,
    });
    if (!(await settleInboundMessage(claim, 'PROCESSED'))) throw new Error('Inbound message claim was fenced while settling');
    return;
  }
  const capability = businessAssistantCapabilityRegistry.get(run.capabilityId, run.capabilityVersion);
  if (!capability) {
    await markRunError(run.id, claim.tenantId, 'CAPABILITY_VERSION_UNAVAILABLE', 'The requested assistant capability is unavailable.');
    if (!(await settleInboundMessage(claim, 'PROCESSED'))) throw new Error('Inbound message claim was fenced while settling');
    return;
  }
  const decision = await assertAssistantActor(claim.ownerId, claim.tenantId);
  if (!hasCapabilityPermissions(decision, capability)) {
    await markRunError(run.id, claim.tenantId, 'FORBIDDEN', 'The requested assistant capability is no longer authorized.');
    if (!(await settleInboundMessage(claim, 'PROCESSED'))) throw new Error('Inbound message claim was fenced while settling');
    return;
  }
  if (run.items.length === 0) {
    const actor: CanonicalActorContext = { tenantId: claim.tenantId, userId: claim.ownerId, requestId: claim.id, source: 'BUSINESS_ASSISTANT' };
    const sourceInput = { ...(run.input as Record<string, unknown>), resources: run.resources };
    const parts = capability.splitInput(sourceInput, actor);
    if (parts.length === 0 || parts.length > BUSINESS_ASSISTANT_LIMITS.maxItemsPerRun) {
      await markRunError(run.id, claim.tenantId, 'VALIDATION_FAILED', 'The capability produced an invalid number of work items.');
      if (!(await settleInboundMessage(claim, 'PROCESSED'))) throw new Error('Inbound message claim was fenced while settling');
      return;
    }
    await runSerializableTransaction(prisma, async (tx) => {
      const existing = await tx.businessAssistantRunItem.count({ where: { tenantId: claim.tenantId, runId: run.id } });
      if (existing > 0) return;
      await tx.businessAssistantRunItem.createMany({
        data: parts.map((part, ordinal) => ({
          tenantId: claim.tenantId,
          runId: run.id,
          itemKey: part.itemKey,
          ordinal,
          input: jsonInput(part.input),
          resources: jsonInput(part.resources ?? run.resources),
          lifecycleState: 'PENDING',
          executionOutcome: 'NOT_STARTED',
          reviewOutcome: capability.reviewPolicy === 'REQUIRED' ? 'NOT_STARTED' : 'NOT_REQUIRED',
          requiredEffectStatus: capability.effects?.some((effect) => effect.required) ? 'PENDING' : 'NOT_REQUIRED',
          activeStage: 'PREPARATION',
          availableAt: new Date(),
        })),
      });
      await tx.businessAssistantRun.update({ where: { id: run.id }, data: { status: 'PREPARING', startedAt: new Date() } });
    });
  }
  if (!(await settleInboundMessage(claim, 'PROCESSED'))) throw new Error('Inbound message claim was fenced while settling');
}

async function persistRoutedRun(
  claim: AssistantClaim & { id: string; tenantId: string; ownerId: string; conversationId: string },
  message: { id: string; conversationId: string; content: string | null },
  payload: Record<string, unknown>,
  route: Exclude<RoutingDecision, { kind: 'CLARIFICATION' }>,
  resources: readonly ResourceRef[],
): Promise<string> {
  const capabilityId = route.kind === 'ANSWER' ? 'assistant.answer' : route.capabilityId;
  const capabilityVersion = route.kind === 'ANSWER' ? '1.0' : route.capabilityVersion;
  const capability = businessAssistantCapabilityRegistry.get(capabilityId, capabilityVersion);
  if (!capability || capability.executionKind !== 'READ_ONLY') throw new Error('Routed capability is unavailable or not read-only');
  const decision = await assertAssistantActor(claim.ownerId, claim.tenantId);
  if (!hasCapabilityPermissions(decision, capability)) throw new Error('Routed capability is no longer authorized');
  const persistedRoute: PersistedRoute = route.kind === 'ANSWER'
    ? { kind: 'ANSWER', capabilityId: capability.id, capabilityVersion: capability.version }
    : { kind: 'CAPABILITY', capabilityId: capability.id, capabilityVersion: capability.version };

  return runSerializableTransaction(prisma, async (tx) => {
    const current = await tx.businessAssistantMessage.findFirst({
      where: {
        id: claim.id,
        tenantId: claim.tenantId,
        ownerId: claim.ownerId,
        conversationId: claim.conversationId,
        status: 'PROCESSING',
        claimToken: claim.token,
        claimGeneration: claim.generation,
        leaseExpiresAt: { gt: new Date() },
      },
      select: { payload: true },
    });
    if (!current) throw new Error('Inbound message claim was fenced while routing');
    const currentPayload = recordValue(current.payload);
    if (typeof currentPayload.runId === 'string') return currentPayload.runId;

    const run = await tx.businessAssistantRun.create({
      data: {
        tenantId: claim.tenantId,
        conversationId: message.conversationId,
        conversationTenantId: claim.tenantId,
        ownerId: claim.ownerId,
        capabilityId: capability.id,
        capabilityVersion: capability.version,
        contractVersion: capability.contractVersion,
        schemaVersion: capability.version,
        input: jsonInput({ message: message.content ?? '' }),
        resources: jsonInput(resources),
        status: 'PREPARING',
      },
      select: { id: true },
    });
    const updated = await tx.businessAssistantMessage.updateMany({
      where: {
        id: claim.id,
        tenantId: claim.tenantId,
        ownerId: claim.ownerId,
        status: 'PROCESSING',
        claimToken: claim.token,
        claimGeneration: claim.generation,
        leaseExpiresAt: { gt: new Date() },
      },
      data: { payload: jsonInput({ ...payload, runId: run.id, routing: persistedRoute }) },
    });
    if (updated.count !== 1) throw new Error('Inbound message claim was fenced while persisting route');
    return run.id;
  });
}

async function persistRoutingClarification(
  claim: AssistantClaim & { id: string; tenantId: string; ownerId: string; conversationId: string },
  message: { id: string; conversationId: string },
  payload: Record<string, unknown>,
  route: Extract<RoutingDecision, { kind: 'CLARIFICATION' }>,
  resources: readonly ResourceRef[],
): Promise<void> {
  await runSerializableTransaction(prisma, async (tx) => {
    const current = await tx.businessAssistantMessage.findFirst({
      where: {
        id: claim.id,
        tenantId: claim.tenantId,
        ownerId: claim.ownerId,
        conversationId: claim.conversationId,
        status: 'PROCESSING',
        claimToken: claim.token,
        claimGeneration: claim.generation,
        leaseExpiresAt: { gt: new Date() },
      },
      select: { payload: true },
    });
    if (!current) throw new Error('Inbound message claim was fenced while routing');
    const currentPayload = recordValue(current.payload);
    const persisted = parsePersistedRoute(currentPayload.routing);
    if (persisted?.kind === 'CLARIFICATION') return;

    const updated = await tx.businessAssistantMessage.updateMany({
      where: {
        id: claim.id,
        tenantId: claim.tenantId,
        ownerId: claim.ownerId,
        status: 'PROCESSING',
        claimToken: claim.token,
        claimGeneration: claim.generation,
        leaseExpiresAt: { gt: new Date() },
      },
      data: { payload: jsonInput({ ...payload, routing: route }) },
    });
    if (updated.count !== 1) throw new Error('Inbound message claim was fenced while persisting clarification');

    const operationKind = 'ROUTING_RESULT';
    const clientRequestId = message.id;
    const existing = await tx.businessAssistantMessage.findFirst({
      where: { tenantId: claim.tenantId, ownerId: claim.ownerId, operationKind, clientRequestId },
      select: { id: true },
    });
    if (existing) return;
    const last = await tx.businessAssistantMessage.findFirst({
      where: { tenantId: claim.tenantId, conversationId: message.conversationId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    await tx.businessAssistantMessage.create({
      data: {
        tenantId: claim.tenantId,
        conversationId: message.conversationId,
        ownerId: claim.ownerId,
        sequence: (last?.sequence ?? 0) + 1,
        role: 'ASSISTANT',
        type: 'CLARIFICATION',
        status: 'PROCESSED',
        content: route.content,
        payload: jsonInput({ sourceMessageId: message.id, routing: route }),
        resources: jsonInput(resources),
        operationKind,
        clientRequestId,
        bodyHash: sha256({ sourceMessageId: message.id, route, resources }),
        availableAt: new Date(),
      },
    });
  });
}

function parsePersistedRoute(value: unknown): PersistedRoute | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === 'CLARIFICATION' && typeof record.content === 'string' && record.content.trim()) {
    return { kind: 'CLARIFICATION', content: record.content };
  }
  if ((record.kind === 'CAPABILITY' || record.kind === 'ANSWER')
      && typeof record.capabilityId === 'string'
      && typeof record.capabilityVersion === 'string') {
    return {
      kind: record.kind,
      capabilityId: record.capabilityId,
      capabilityVersion: record.capabilityVersion,
    };
  }
  return null;
}

async function processClaimedItem(claim: ClaimedItem): Promise<void> {
  const item = await prisma.businessAssistantRunItem.findFirst({ where: { id: claim.id, tenantId: claim.tenantId, runId: claim.runId }, select: { id: true, runId: true, itemKey: true, input: true, resources: true, lifecycleState: true, activeStage: true, executionOutcome: true, reviewOutcome: true, requiredEffectStatus: true, operationId: true, output: true, receiptRef: true } });
  const run = await prisma.businessAssistantRun.findFirst({ where: { id: claim.runId, tenantId: claim.tenantId }, select: { id: true, ownerId: true, conversationId: true, capabilityId: true, capabilityVersion: true, contractVersion: true, schemaVersion: true, status: true, resources: true, activeProposalId: true, conversation: { select: { status: true } } } });
  if (!item || !run) return;
  if (run.conversation?.status === 'DELETED' && item.executionOutcome !== 'COMMITTED' && item.executionOutcome !== 'OUTCOME_UNKNOWN' && item.lifecycleState !== 'RECOVERING') {
    await updateClaimedItem(claim, { lifecycleState: 'CANCELLED', dispositionReason: 'CONVERSATION_DELETED', activeStage: null, availableAt: new Date() });
    return;
  }
  const capability = businessAssistantCapabilityRegistry.get(run.capabilityId, run.capabilityVersion);
  if (!capability) throw new Error('Capability version unavailable');
  const actor: CanonicalActorContext = { tenantId: claim.tenantId, userId: run.ownerId, requestId: claim.id, source: 'BUSINESS_ASSISTANT' };
  const context: WorkerInvocationContext = { ...actor, conversationId: run.conversationId ?? undefined, runId: run.id, runItemId: item.id, attemptId: randomUUID(), claimToken: claim.token, claimGeneration: claim.generation };
  if (!(await renewItemClaim(claim))) throw new Error('Item claim was fenced');
  let heartbeatLost = false;
  const heartbeat = setInterval(() => {
    void renewItemClaim(claim).then((ok) => { if (!ok) heartbeatLost = true; }).catch(() => { heartbeatLost = true; });
  }, BUSINESS_ASSISTANT_LIMITS.heartbeatSeconds * 1_000);
  try {
    if (capability.executionKind === 'READ_ONLY') await executeReadItem(capability, item, context, claim);
    else if (item.executionOutcome === 'COMMITTED' || item.executionOutcome === 'OUTCOME_UNKNOWN' || item.lifecycleState === 'RECOVERING' || item.activeStage === 'EXECUTION' || item.activeStage === 'EFFECTS' || item.activeStage === 'READ_BACK' || item.activeStage === 'REVIEW') await resumeWriteItem(capability, item, context, claim);
    else if (item.activeStage === 'PREPARATION' || item.lifecycleState === 'PENDING' || item.lifecycleState === 'PREPARING' || item.lifecycleState === 'READY') await prepareOrExecuteWriteItem(capability, item, run.id, actor, context, claim);
    if (heartbeatLost) throw new Error('Item claim heartbeat was fenced');
    await updateRunAggregate(run.id, claim.tenantId);
  } catch (error) {
    const exhausted = error instanceof Error && error.name === 'StageAttemptsExhaustedError';
    await updateClaimedItem(claim, { availableAt: new Date(Date.now() + 30_000), retryCount: { increment: 1 }, ...(exhausted ? { lifecycleState: 'FAILED', activeStage: null, dispositionReason: 'STAGE_ATTEMPTS_EXHAUSTED' } : {}) });
    throw error;
  } finally {
    clearInterval(heartbeat);
    await releaseItemClaim(claim, { keepState: true });
  }
}

async function runStage<T>(claim: ClaimedItem, stage: string, input: JsonValue | undefined, handler: (attempt: StageAttempt) => Promise<T>): Promise<T> {
  const attempt = await startStageAttempt(claim, stage, input as unknown as Prisma.JsonValue);
  try {
    const value = await handler(attempt);
    if (!(await finishStageAttempt(claim, attempt, 'SUCCEEDED', toJson(value)))) throw new Error('Stage claim was fenced');
    return value;
  } catch (error) {
    await finishStageAttempt(claim, attempt, 'FAILED_RETRYABLE', undefined, toJson({ message: safeErrorMessage(error) }));
    throw error;
  }
}

async function prepareOrExecuteWriteItem(capability: Extract<BusinessAssistantCapability, { executionKind: 'CANONICAL_WRITE' }>, item: { id: string; itemKey: string; input: Prisma.JsonValue; resources: Prisma.JsonValue; lifecycleState: string; operationId: string | null }, runId: string, actor: CanonicalActorContext, context: WorkerInvocationContext, claim: ClaimedItem): Promise<void> {
  if (item.lifecycleState === 'READY' || item.operationId) {
    await executeConfirmedWriteItem(capability, item, context, claim);
    return;
  }
  await prepareWriteBatch(capability, item, runId, actor, context, claim);
}

async function prepareWriteBatch(capability: Extract<BusinessAssistantCapability, { executionKind: 'CANONICAL_WRITE' }>, currentItem: { id: string; itemKey: string; input: Prisma.JsonValue; resources: Prisma.JsonValue }, runId: string, actor: CanonicalActorContext, context: WorkerInvocationContext, claim: ClaimedItem): Promise<void> {
  const run = await prisma.businessAssistantRun.findFirst({ where: { id: runId, tenantId: actor.tenantId }, select: { activeProposalId: true, resources: true } });
  if (run?.activeProposalId) return;
  const rows = await prisma.businessAssistantRunItem.findMany({ where: { tenantId: actor.tenantId, runId, lifecycleState: { in: ['PENDING', 'PREPARING'] } }, orderBy: { ordinal: 'asc' }, select: { id: true, itemKey: true, input: true, resources: true } });
  if (rows.length === 0) return;
  const prepared = await runStage(claim, 'PREPARATION', currentItem.input as unknown as JsonValue, async () => {
    const items: PreparedCapabilityItem[] = [];
    const blockers: string[] = [];
    for (const row of rows) {
      const result = await capability.prepare(row.input, { actor, resources: asResourceRefs(row.resources), invocation: context });
      if (isBlockedPreparation(result)) {
        blockers.push(`${row.itemKey}: ${result.reason}`);
        items.push({ itemId: row.id, itemKey: row.itemKey, input: toJson(row.input) as unknown as JsonValue, resources: asResourceRefs(row.resources), status: 'BLOCKED', metadata: toJson({ reason: result.reason, code: result.code ?? null }) as unknown as JsonValue });
        continue;
      }
      const source = result.items.length === 1 ? result.items[0] : result.items.find((candidate) => candidate.itemKey === row.itemKey) ?? result.items[0];
      if (!source) {
        blockers.push(`${row.itemKey}: The capability prepared no item.`);
        items.push({ itemId: row.id, itemKey: row.itemKey, input: toJson(row.input) as unknown as JsonValue, resources: asResourceRefs(row.resources), status: 'BLOCKED', metadata: { reason: 'NO_PREPARED_ITEM' } });
        continue;
      }
      const metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata) ? { ...(source.metadata as Record<string, JsonValue>), capabilityItemId: source.itemId, capabilityItemKey: source.itemKey } : { capabilityItemId: source.itemId, capabilityItemKey: source.itemKey };
      items.push({ ...source, itemId: row.id, itemKey: row.itemKey, metadata });
    }
    const artifactWithoutHash: Omit<PreparedCapabilityArtifact, 'preparedHash'> = { status: items.some((item) => item.status === 'BLOCKED') ? 'BLOCKED' : 'PREPARED', items, ...(blockers.length ? { blockers } : {}), preparedAt: new Date().toISOString() };
    return { ...artifactWithoutHash, preparedHash: sha256(artifactWithoutHash) };
  });
  await runSerializableTransaction(prisma, async (tx) => {
    const freshRun = await tx.businessAssistantRun.findFirst({ where: { tenantId: actor.tenantId, id: runId }, select: { activeProposalId: true } });
    if (freshRun?.activeProposalId) return;
    await persistProposal({ actor, runId, prepared, policyVersion: capability.approvalPolicyVersion, schemaVersion: capability.version }, tx as never);
    const fenced = await tx.businessAssistantRunItem.updateMany({ where: { tenantId: actor.tenantId, id: currentItem.id, claimToken: claim.token, claimGeneration: claim.generation, leaseExpiresAt: { gt: new Date() } }, data: { lifecycleState: 'WAITING_CONFIRMATION', activeStage: null, availableAt: new Date() } });
    if (fenced.count !== 1) throw new Error('Preparation claim was fenced');
  });
  const conversation = await prisma.businessAssistantRun.findFirst({ where: { id: runId, tenantId: actor.tenantId }, select: { conversationId: true } });
  if (conversation?.conversationId) await appendAssistantMessage({ tenantId: actor.tenantId, conversationId: conversation.conversationId, ownerId: actor.userId, runId, type: 'PROPOSAL', content: 'A proposal is ready for your review and confirmation.' });
}

async function executeReadItem(capability: Extract<BusinessAssistantCapability, { executionKind: 'READ_ONLY' }>, item: { id: string; input: Prisma.JsonValue; resources: Prisma.JsonValue }, context: WorkerInvocationContext, claim: ClaimedItem): Promise<void> {
  const prepared = await runStage(claim, 'PREPARATION', item.input as unknown as JsonValue, async () => capability.prepare(item.input, { actor: context, resources: asResourceRefs(item.resources), invocation: context }));
  if (isBlockedPreparation(prepared)) {
    await updateClaimedItem(claim, { lifecycleState: 'BLOCKED', dispositionReason: prepared.reason || 'BLOCKED_CONFLICT', activeStage: null });
    return;
  }
  const result = await runStage(claim, 'EXECUTION', prepared as unknown as JsonValue, async () => capability.execute(prepared, { actor: context, resources: asResourceRefs(item.resources), invocation: context }));
  if (!capability.outputSchema.safeParse(result.output).success) throw new Error('Capability read output failed its registered schema.');
  if (!(await recordReadResult(claim, context, item.resources, result))) throw new Error('Read result claim was fenced');
}

/**
 * Persist the read outcome, declared generic resources, and user-visible
 * message under the same fence. A deterministic RESULT request key makes a
 * retry after a process crash idempotent while keeping the answer durable.
 */
async function recordReadResult(claim: ClaimedItem, context: WorkerInvocationContext, existingResources: Prisma.JsonValue, result: ReadExecutionResult): Promise<boolean> {
  const resultResources = normalizeReturnedResources(result.resources);
  const durableResources = mergeResourceRefs(asResourceRefs(existingResources), resultResources);
  return runSerializableTransaction(prisma, async (tx) => {
    const updated = await tx.businessAssistantRunItem.updateMany({
      where: { id: claim.id, tenantId: claim.tenantId, claimToken: claim.token, claimGeneration: claim.generation, leaseExpiresAt: { gt: new Date() } },
      data: {
        lifecycleState: 'SUCCEEDED',
        executionOutcome: 'SUCCEEDED_READ',
        reviewOutcome: 'NOT_REQUIRED',
        output: jsonInput(result.output),
        resources: jsonInput(durableResources),
        activeStage: null,
        availableAt: new Date(),
      },
    });
    if (updated.count !== 1) return false;
    if (!context.conversationId) return true;
    const conversation = await tx.businessAssistantConversation.findFirst({ where: { tenantId: context.tenantId, id: context.conversationId, ownerId: context.userId, status: { not: 'DELETED' } }, select: { id: true } });
    if (!conversation) return true;
    const clientRequestId = `${context.runId ?? claim.id}:${claim.id}:RESULT`;
    const existing = await tx.businessAssistantMessage.findFirst({ where: { tenantId: context.tenantId, ownerId: context.userId, operationKind: 'RESULT', clientRequestId }, select: { id: true } });
    if (existing) return true;
    const last = await tx.businessAssistantMessage.findFirst({ where: { tenantId: context.tenantId, conversationId: context.conversationId }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
    await tx.businessAssistantMessage.create({
      data: {
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        ownerId: context.userId,
        sequence: (last?.sequence ?? 0) + 1,
        role: 'ASSISTANT',
        type: readResultMessageType(result.output),
        status: 'PROCESSED',
        content: readResultContent(result.output),
        payload: jsonInput({ data: result.output, runId: context.runId ?? null, itemId: claim.id }),
        resources: jsonInput(resultResources),
        operationKind: 'RESULT',
        clientRequestId,
        bodyHash: sha256({ runId: context.runId ?? null, itemId: claim.id, output: result.output, resources: resultResources }),
        availableAt: new Date(),
      },
    });
    return true;
  });
}

function readResultContent(output: JsonValue): string {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const answerContent = (output as Record<string, JsonValue>).content;
    const answerKind = (output as Record<string, JsonValue>).kind;
    if ((answerKind === 'ANSWER' || answerKind === 'CLARIFICATION') && typeof answerContent === 'string' && answerContent.trim()) {
      return answerContent;
    }
    const resources = (output as Record<string, JsonValue>).resources;
    if (Array.isArray(resources)) {
      if (resources.length === 0) return 'No accessible workspace records matched your request.';
      return `I found ${resources.length} accessible workspace record${resources.length === 1 ? '' : 's'}.`;
    }
  }
  return 'The requested workspace information is ready.';
}

function readResultMessageType(output: JsonValue): 'ANSWER' | 'CLARIFICATION' | 'RESULT' {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const kind = (output as Record<string, JsonValue>).kind;
    if (kind === 'ANSWER' || kind === 'CLARIFICATION') return kind;
  }
  return 'RESULT';
}

async function executeConfirmedWriteItem(capability: Extract<BusinessAssistantCapability, { executionKind: 'CANONICAL_WRITE' }>, item: { id: string; input: Prisma.JsonValue; resources: Prisma.JsonValue; operationId: string | null; output?: Prisma.JsonValue | null; receiptRef?: Prisma.JsonValue | null; executionOutcome?: string; requiredEffectStatus?: string; reviewOutcome?: string }, context: WorkerInvocationContext, claim: ClaimedItem): Promise<void> {
  await assertAssistantMutationAccess(context.userId, context.tenantId);
  const frozen = await loadFrozenApproval(context, item.id);
  if (!frozen) {
    await updateClaimedItem(claim, { lifecycleState: 'EXPIRED', dispositionReason: 'APPROVAL_EXPIRED', activeStage: null });
    return;
  }
  const operationId = item.operationId;
  if (!operationId) throw new Error('Write item has no operation identity');
  const result = await runStage(claim, 'EXECUTION', frozen.prepared as unknown as JsonValue, async () => capability.execute(frozen.prepared, { actor: context, resources: asResourceRefs(item.resources), invocation: context }, operationId));
  const receipt = result.receipt;
  if (receipt.operationId !== operationId) throw new Error('Canonical receipt operation identity does not match the approval.');
  if (receipt.status === 'UNKNOWN') {
    await updateClaimedItem(claim, { lifecycleState: 'RECOVERING', executionOutcome: 'OUTCOME_UNKNOWN', activeStage: 'EXECUTION', receiptRef: jsonInput(receipt), dispositionReason: 'RECONCILIATION_REQUIRED' });
    return;
  }
  if (receipt.status === 'NO_COMMIT') {
    await updateClaimedItem(claim, { lifecycleState: 'FAILED', executionOutcome: 'FAILED_NO_COMMIT', activeStage: null, receiptRef: jsonInput(receipt) });
    return;
  }
  if (!capability.outputSchema.safeParse(result.output).success) throw new Error('Committed capability output failed its registered schema; reconciliation is required.');
  if (!(await updateClaimedItem(claim, { lifecycleState: 'EXECUTING', executionOutcome: 'COMMITTED', output: jsonInput(result.output), receiptRef: jsonInput(receipt), activeStage: result.effectStatus === 'PENDING' ? 'EFFECTS' : 'READ_BACK', requiredEffectStatus: result.effectStatus }))) throw new Error('Committed write claim was fenced');
  await continueCommittedWrite(capability, { ...item, operationId, output: toJson(result.output), receiptRef: toJson(receipt), executionOutcome: 'COMMITTED', requiredEffectStatus: result.effectStatus, reviewOutcome: item.reviewOutcome ?? 'NOT_STARTED' }, frozen.prepared, context, claim);
}

async function resumeWriteItem(capability: Extract<BusinessAssistantCapability, { executionKind: 'CANONICAL_WRITE' }>, item: { id: string; input: Prisma.JsonValue; resources: Prisma.JsonValue; operationId: string | null; output: Prisma.JsonValue | null; receiptRef: Prisma.JsonValue | null; executionOutcome: string; requiredEffectStatus: string; reviewOutcome: string }, context: WorkerInvocationContext, claim: ClaimedItem): Promise<void> {
  const operationId = item.operationId;
  if (!operationId) throw new Error('Write item has no operation identity');
  let output = item.output as JsonValue | null;
  let receipt = item.receiptRef as JsonValue | null;
  let requiredEffectStatus = item.requiredEffectStatus as 'NOT_REQUIRED' | 'PENDING' | 'COMPLETE' | 'FAILED';
  if (item.executionOutcome === 'OUTCOME_UNKNOWN' || !receipt) {
    const reconciliation = await runStage(claim, 'EXECUTION', toJson({ operationId }), async () => capability.reconcile(operationId, { actor: context, resources: asResourceRefs(item.resources), invocation: context }));
    if (reconciliation.status === 'UNKNOWN') {
      await updateClaimedItem(claim, { lifecycleState: 'RECOVERING', executionOutcome: 'OUTCOME_UNKNOWN', activeStage: 'EXECUTION', receiptRef: reconciliation.receipt ? jsonInput(reconciliation.receipt) : undefined, dispositionReason: 'RECONCILIATION_REQUIRED' });
      return;
    }
    if (reconciliation.status === 'NO_COMMIT') {
      const frozen = await loadFrozenApproval(context, item.id);
      if (!frozen) {
        await updateClaimedItem(claim, { lifecycleState: 'EXPIRED', executionOutcome: 'FAILED_NO_COMMIT', activeStage: null, dispositionReason: 'APPROVAL_EXPIRED', receiptRef: reconciliation.receipt ? jsonInput(reconciliation.receipt) : undefined });
        return;
      }
      const result = await runStage(claim, 'EXECUTION', frozen.prepared as unknown as JsonValue, async () => capability.execute(frozen.prepared, { actor: context, resources: asResourceRefs(item.resources), invocation: context }, operationId));
      output = result.output;
      receipt = toJson(result.receipt);
      if (result.receipt.status === 'UNKNOWN') {
        await updateClaimedItem(claim, { lifecycleState: 'RECOVERING', executionOutcome: 'OUTCOME_UNKNOWN', activeStage: 'EXECUTION', receiptRef: jsonInput(receipt), dispositionReason: 'RECONCILIATION_REQUIRED' });
        return;
      }
      if (result.receipt.status === 'NO_COMMIT') {
        await updateClaimedItem(claim, { lifecycleState: 'FAILED', executionOutcome: 'FAILED_NO_COMMIT', activeStage: null, receiptRef: jsonInput(receipt) });
        return;
      }
      if (result.receipt.operationId !== operationId || !capability.outputSchema.safeParse(output).success) throw new Error('Retried capability output failed its registered identity or schema.');
      if (!(await updateClaimedItem(claim, { lifecycleState: 'EXECUTING', executionOutcome: 'COMMITTED', output: jsonInput(output), receiptRef: jsonInput(receipt), requiredEffectStatus: result.effectStatus, activeStage: result.effectStatus === 'PENDING' ? 'EFFECTS' : 'READ_BACK' }))) throw new Error('Retried write claim was fenced');
      await continueCommittedWrite(capability, { ...item, output, receiptRef: receipt, executionOutcome: 'COMMITTED', requiredEffectStatus: result.effectStatus }, frozen.prepared, context, claim);
      return;
    }
    receipt = reconciliation.receipt ? toJson(reconciliation.receipt) : null;
    if (reconciliation.output !== undefined) output = reconciliation.output;
    if (reconciliation.effectStatus !== undefined) requiredEffectStatus = reconciliation.effectStatus;
  }
  if (!receipt) throw new Error('Write reconciliation returned no receipt');
  const receiptRecord = receipt as unknown as { status?: string };
  if (receiptRecord.status === 'UNKNOWN') {
    await updateClaimedItem(claim, { lifecycleState: 'RECOVERING', executionOutcome: 'OUTCOME_UNKNOWN', activeStage: 'EXECUTION', receiptRef: jsonInput(receipt) });
    return;
  }
  if (receiptRecord.status === 'NO_COMMIT') {
    await updateClaimedItem(claim, { lifecycleState: 'FAILED', executionOutcome: 'FAILED_NO_COMMIT', activeStage: null, receiptRef: jsonInput(receipt) });
    return;
  }
  const frozen = await loadFrozenApproval(context, item.id, false);
  if (!frozen) throw new Error('Frozen prepared artifact is unavailable for committed recovery.');
  if (!capability.outputSchema.safeParse(output).success) throw new Error('Committed recovery output is unavailable or invalid.');
  if (!(await updateClaimedItem(claim, { lifecycleState: 'EXECUTING', executionOutcome: 'COMMITTED', output: output == null ? undefined : jsonInput(output), receiptRef: jsonInput(receipt), requiredEffectStatus, activeStage: requiredEffectStatus === 'PENDING' ? 'EFFECTS' : 'READ_BACK' }))) throw new Error('Committed recovery claim was fenced');
  await continueCommittedWrite(capability, { ...item, output, receiptRef: receipt, executionOutcome: 'COMMITTED', requiredEffectStatus }, frozen.prepared, context, claim);
}

async function continueCommittedWrite(capability: Extract<BusinessAssistantCapability, { executionKind: 'CANONICAL_WRITE' }>, item: { id: string; resources: Prisma.JsonValue; operationId?: string | null; output: JsonValue | null; receiptRef: JsonValue | null; executionOutcome: string; requiredEffectStatus: string; reviewOutcome: string }, prepared: PreparedCapabilityArtifact, context: WorkerInvocationContext, claim: ClaimedItem): Promise<void> {
  let output = item.output;
  let effectStatus: 'NOT_REQUIRED' | 'PENDING' | 'COMPLETE' | 'FAILED' = item.requiredEffectStatus as 'NOT_REQUIRED' | 'PENDING' | 'COMPLETE' | 'FAILED';
  if (effectStatus === 'PENDING') {
    if (!capability.finalize) throw new Error('Required effects have no finalize handler.');
    const finalized = await runStage(claim, 'EFFECTS', output ?? item.receiptRef, async () => capability.finalize!(output ?? item.receiptRef, { actor: context, resources: asResourceRefs(item.resources), invocation: context }));
    if (finalized.status === 'PENDING') {
      await updateClaimedItem(claim, { lifecycleState: 'RECOVERING', requiredEffectStatus: 'PENDING', activeStage: 'EFFECTS', availableAt: new Date(Date.now() + 30_000) });
      return;
    }
    if (finalized.status === 'FAILED') {
      await updateClaimedItem(claim, { lifecycleState: 'FAILED', requiredEffectStatus: 'FAILED', activeStage: null, dispositionReason: finalized.safeError?.message ?? 'REQUIRED_EFFECT_FAILED' });
      return;
    }
    effectStatus = 'COMPLETE';
    if (finalized.output !== undefined) output = finalized.output;
    if (!capability.outputSchema.safeParse(output).success) throw new Error('Finalized capability output does not match its registered schema.');
    if (!(await updateClaimedItem(claim, { requiredEffectStatus: 'COMPLETE', output: output === null ? undefined : jsonInput(output), activeStage: 'READ_BACK' }))) throw new Error('Effect completion claim was fenced');
  }
  const readBack = await runStage(claim, 'READ_BACK', output ?? item.receiptRef, async () => capability.readBack(output ?? item.receiptRef, { actor: context, resources: asResourceRefs(item.resources), invocation: context }));
  const readBackResources = normalizeReturnedResources(readBack.resources);
  const durableResources = mergeResourceRefs(asResourceRefs(item.resources), readBackResources);
  if (capability.reviewPolicy !== 'REQUIRED') {
    if (!(await updateClaimedItem(claim, {
      lifecycleState: 'SUCCEEDED',
      executionOutcome: 'COMMITTED',
      requiredEffectStatus: effectStatus as never,
      reviewOutcome: 'NOT_REQUIRED',
      output: output === null ? undefined : jsonInput(output),
      resources: jsonInput(durableResources),
      activeStage: null,
      availableAt: new Date(),
    }))) throw new Error('Write completion claim was fenced');
    return;
  }
  if (!capability.review) throw new Error('Required review handler is unavailable.');
  if (!(await updateClaimedItem(claim, { resources: jsonInput(durableResources), activeStage: 'REVIEW' }))) throw new Error('Read-back resource persistence claim was fenced');
  const reviewed = await runStage(claim, 'REVIEW', readBack.snapshot, async () => capability.review!(prepared, output ?? item.receiptRef, readBack.snapshot, { actor: context, resources: durableResources, invocation: context }));
  if (!(await recordClaimedReview({ claim, reviewed, snapshot: readBack.snapshot, observedAt: readBack.observedAt,
    effectStatus, output, schemaVersion: capability.version, promptVersion: capability.contractVersion }))) {
    throw new Error('Review completion claim was fenced');
  }
}

async function loadFrozenApproval(context: WorkerInvocationContext, itemId: string, requireLiveApproval = true): Promise<{ prepared: PreparedCapabilityArtifact; proposalId: string; revision: number } | null> {
  const run = await prisma.businessAssistantRun.findFirst({ where: { id: context.runId, tenantId: context.tenantId, ownerId: context.userId }, select: { activeProposalId: true } });
  if (!run?.activeProposalId) return null;
  const proposal = await prisma.businessAssistantProposal.findFirst({ where: { id: run.activeProposalId, tenantId: context.tenantId, runId: context.runId, status: { in: ['CONFIRMED', 'ACTIVE'] } }, select: { id: true, revision: true, preparedArtifact: true, preparedHash: true, expiresAt: true } });
  if (!proposal) return null;
  const artifact = proposal.preparedArtifact as unknown as PreparedCapabilityArtifact;
  if (!artifact || !Array.isArray(artifact.items)) return null;
  const preparedItem = artifact.items.find((candidate) => candidate.itemId === itemId);
  if (!preparedItem || preparedItem.status !== 'ELIGIBLE') return null;
  const expectedHash = sha256(preparedItem);
  const approval = await prisma.businessAssistantApproval.findFirst({ where: { tenantId: context.tenantId, runId: context.runId, proposalId: proposal.id, decision: 'APPROVED' }, orderBy: { createdAt: 'desc' }, select: { expiresAt: true, selectedItems: true, selectedBindings: true } });
  if (requireLiveApproval && (!approval || approval.expiresAt.getTime() <= Date.now())) return null;
  if (approval) {
    const selectedItems = Array.isArray(approval.selectedItems) ? approval.selectedItems : [];
    if (!selectedItems.includes(itemId)) return null;
    const bindings = Array.isArray(approval.selectedBindings) ? approval.selectedBindings : [];
    const binding = bindings.find((value) => value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).itemId === itemId) as Record<string, unknown> | undefined;
    if (!binding || binding.preparedHash !== expectedHash) return null;
  } else if (requireLiveApproval) return null;
  const selectedArtifact: PreparedCapabilityArtifact = { ...artifact, items: [preparedItem], preparedHash: sha256({ ...artifact, items: [preparedItem] }) };
  return { prepared: selectedArtifact, proposalId: proposal.id, revision: proposal.revision };
}

function asResourceRefs(value: Prisma.JsonValue): ResourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const parsed = resourceRefSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

function normalizeReturnedResources(value: readonly ResourceRef[] | undefined): ResourceRef[] {
  if (!value) return [];
  return value.flatMap((candidate) => {
    const parsed = resourceRefSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  }).slice(0, BUSINESS_ASSISTANT_LIMITS.maxResourceRefs);
}

function mergeResourceRefs(existing: readonly ResourceRef[], returned: readonly ResourceRef[]): ResourceRef[] {
  const seen = new Set<string>();
  const merged: ResourceRef[] = [];
  for (const candidate of [...returned, ...existing]) {
    const key = `${candidate.resourceType.toLowerCase()}\u0000${candidate.resourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
    if (merged.length >= BUSINESS_ASSISTANT_LIMITS.maxResourceRefs) break;
  }
  return merged;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toJson(value: unknown): JsonValue {
  try { return canonicalizeJson(value); } catch { return { error: 'UNSERIALIZABLE_STAGE_OUTPUT' }; }
}

async function updateRunAggregate(runId: string, tenantId: string): Promise<void> {
  const run = await prisma.businessAssistantRun.findFirst({ where: { id: runId, tenantId }, select: { status: true, cancellationRequestedAt: true, items: { select: { lifecycleState: true, executionOutcome: true, reviewOutcome: true, requiredEffectStatus: true, dispositionReason: true } } } });
  if (!run) return;
  const aggregate = aggregateRun(run.items.map((item) => ({ selected: item.dispositionReason !== 'NOT_SELECTED' && item.lifecycleState !== 'BLOCKED', ...item })), { cancellationRequested: Boolean(run.cancellationRequestedAt) });
  if (['WAITING_CONFIRMATION', 'READY'].includes(run.status) && !['COMPLETED', 'COMPLETED_WITH_EXCEPTIONS', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(aggregate.status)) return;
  await prisma.businessAssistantRun.updateMany({ where: { id: runId, tenantId }, data: { status: aggregate.status, ...(aggregate.status === 'COMPLETED' || aggregate.status === 'COMPLETED_WITH_EXCEPTIONS' || aggregate.status === 'FAILED' || aggregate.status === 'CANCELLED' || aggregate.status === 'EXPIRED' ? { completedAt: new Date() } : {}) } });
}

async function markRunError(runId: string, tenantId: string, code: string, message: string): Promise<void> {
  await prisma.businessAssistantRun.updateMany({ where: { id: runId, tenantId }, data: { status: 'FAILED', completedAt: new Date() } });
  const run = await prisma.businessAssistantRun.findFirst({ where: { id: runId, tenantId }, select: { conversationId: true, ownerId: true } });
  if (run?.conversationId) await appendAssistantMessage({ tenantId, conversationId: run.conversationId, ownerId: run.ownerId, type: 'ERROR', content: message, payload: { code }, idempotencyKey: `run-error:${runId}:${code}` });
}

async function appendAssistantMessage(input: { tenantId: string; conversationId: string; ownerId: string; type: 'ANSWER' | 'CLARIFICATION' | 'PROPOSAL' | 'RESULT' | 'ERROR'; content: string; runId?: string; payload?: JsonValue; resources?: readonly ResourceRef[]; idempotencyKey?: string }): Promise<void> {
  await runSerializableTransaction(prisma, async (tx) => {
    const conversation = await tx.businessAssistantConversation.findFirst({ where: { tenantId: input.tenantId, id: input.conversationId, ownerId: input.ownerId, status: { not: 'DELETED' } }, select: { id: true } });
    if (!conversation) return;
    const operationKind = input.idempotencyKey ? 'ASSISTANT_EVENT' : 'TURN';
    if (input.idempotencyKey) {
      const existing = await tx.businessAssistantMessage.findFirst({ where: { tenantId: input.tenantId, ownerId: input.ownerId, operationKind, clientRequestId: input.idempotencyKey }, select: { id: true } });
      if (existing) return;
    }
    const last = await tx.businessAssistantMessage.findFirst({ where: { tenantId: input.tenantId, conversationId: input.conversationId }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
    await tx.businessAssistantMessage.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        ownerId: input.ownerId,
        sequence: (last?.sequence ?? 0) + 1,
        role: 'ASSISTANT',
        type: input.type,
        status: 'PROCESSED',
        content: input.content,
        payload: jsonInput({ data: input.payload ?? null, runId: input.runId ?? null }),
        resources: jsonInput(input.resources ?? []),
        operationKind,
        clientRequestId: input.idempotencyKey ?? undefined,
        bodyHash: input.idempotencyKey ? sha256({ type: input.type, content: input.content, runId: input.runId ?? null, payload: input.payload ?? null, resources: input.resources ?? [] }) : undefined,
        availableAt: new Date(),
      },
    });
  });
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown worker error';
}
