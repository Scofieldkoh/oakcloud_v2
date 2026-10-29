import { Prisma, type BusinessAssistantRunStatus } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import { businessAssistantConversationActionSchema, businessAssistantTurnRequestSchema } from '@/lib/validations/business-assistant';
import { businessAssistantCapabilityRegistry } from '@/generated/business-assistant-capability-registry';
import { BUSINESS_ASSISTANT_LIMITS, canonicalJson, canonicalizeJson, sha256, type CapabilityDescriptor, type JsonValue } from './contracts';
import { assertAssistantAdministrativeAccess, assertAssistantReadAccess, assertAssistantWorkspaceOperational, filterCapabilityDescriptors, normalizeResourceRefs } from './policy.service';

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function cursorFor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt: updatedAt.toISOString(), id }), 'utf8').toString('base64url');
}

function parseCursor(cursor: string | undefined): { updatedAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { updatedAt?: string; id?: string };
    if (!parsed.updatedAt || !parsed.id) return undefined;
    const updatedAt = new Date(parsed.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) return undefined;
    return { updatedAt, id: parsed.id };
  } catch {
    return undefined;
  }
}

export interface AssistantActor {
  userId: string;
  tenantId: string;
  requestId: string;
}

export interface AcceptedTurn {
  conversationId: string;
  messageId: string;
  runId: string | null;
  duplicate: boolean;
}

export async function acceptTurn(actor: AssistantActor, rawInput: unknown): Promise<AcceptedTurn> {
  const parsed = businessAssistantTurnRequestSchema.safeParse(rawInput);
  if (!parsed.success) throw new ConversationServiceError('VALIDATION_FAILED', 'The assistant request is invalid.', parsed.error.flatten());
  const input = parsed.data;
  const resources = normalizeResourceRefs(input.resources);
  const requestedWorkspace = input.workspaceId ?? input.context?.workspaceId;
  if (requestedWorkspace && requestedWorkspace !== actor.tenantId) {
    throw new ConversationServiceError('FORBIDDEN', 'The selected workspace is not available to this request.');
  }
  if (process.env.BUSINESS_ASSISTANT_ENABLED !== 'true') {
    throw new ConversationServiceError('FORBIDDEN', 'Business Assistant is disabled for this workspace.');
  }
  await assertAssistantWorkspaceOperational(actor.userId, actor.tenantId);

  const capabilityId = input.context?.capabilityId;
  const capabilityVersion = input.context?.capabilityVersion;
  const requestedCapability = capabilityId ? businessAssistantCapabilityRegistry.get(capabilityId, capabilityVersion) : undefined;
  if (capabilityId && !requestedCapability) throw new ConversationServiceError('CAPABILITY_VERSION_UNAVAILABLE', 'The requested assistant capability is unavailable.');

  const hasCapabilityInput = Object.prototype.hasOwnProperty.call(input, 'capabilityInput');
  if (hasCapabilityInput && !capabilityId) {
    throw new ConversationServiceError('VALIDATION_FAILED', 'Capability input requires an explicitly selected registered capability.');
  }
  let normalizedCapabilityInput: JsonValue | undefined;
  if (hasCapabilityInput) {
    const capabilityInput = requestedCapability!.inputSchema.safeParse(input.capabilityInput);
    if (!capabilityInput.success) {
      throw new ConversationServiceError('VALIDATION_FAILED', 'The selected capability input is invalid.', capabilityInput.error.flatten());
    }
    try {
      normalizedCapabilityInput = canonicalizeJson(capabilityInput.data);
    } catch {
      throw new ConversationServiceError('VALIDATION_FAILED', 'The selected capability input must be JSON-safe.');
    }
    if (Buffer.byteLength(canonicalJson(normalizedCapabilityInput), 'utf8') > BUSINESS_ASSISTANT_LIMITS.maxProposalArtifactBytes) {
      throw new ConversationServiceError('VALIDATION_FAILED', 'The selected capability input exceeds the Business Assistant artifact limit.');
    }
  }

  const normalizedInput = hasCapabilityInput
    ? { ...input, capabilityInput: normalizedCapabilityInput }
    : input;
  const bodyHash = sha256({ ...normalizedInput, workspaceId: actor.tenantId, resources });
  // Explicit capability selection is authoritative and remains synchronous.
  // Ordinary messages are accepted without a run; the durable worker performs
  // bounded routing after the HTTP acceptance transaction has committed.
  const capability = requestedCapability;

  return runSerializableTransaction(prisma, async (tx) => {
    const existing = await tx.businessAssistantMessage.findFirst({
      where: { tenantId: actor.tenantId, ownerId: actor.userId, operationKind: 'TURN', clientRequestId: input.clientRequestId },
      select: { id: true, conversationId: true, bodyHash: true, payload: true },
    });
    if (existing) {
      if (existing.bodyHash !== bodyHash) throw new ConversationServiceError('ACTION_CONFLICT', 'This request ID was already used with different content.');
      const payload = (existing.payload ?? {}) as Record<string, unknown>;
      return {
        conversationId: existing.conversationId,
        messageId: existing.id,
        runId: typeof payload.runId === 'string' ? payload.runId : null,
        duplicate: true,
      };
    }

    let conversationId = input.conversationId ?? null;
    if (conversationId) {
      const conversation = await tx.businessAssistantConversation.findFirst({
        where: { id: conversationId, tenantId: actor.tenantId, ownerId: actor.userId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!conversation) throw new ConversationServiceError('NOT_FOUND', 'The conversation is unavailable.');
    } else {
      const conversation = await tx.businessAssistantConversation.create({
        data: { tenantId: actor.tenantId, ownerId: actor.userId, title: input.message.slice(0, 200), status: 'ACTIVE' },
        select: { id: true },
      });
      conversationId = conversation.id;
    }
    const lastMessage = await tx.businessAssistantMessage.findFirst({
      where: { tenantId: actor.tenantId, conversationId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    const sequence = (lastMessage?.sequence ?? 0) + 1;
    const runId = capability
      ? (await tx.businessAssistantRun.create({
          data: {
            tenantId: actor.tenantId,
            conversationId,
            conversationTenantId: actor.tenantId,
            ownerId: actor.userId,
            capabilityId: capability.id,
            capabilityVersion: capability.version,
            contractVersion: capability.contractVersion,
            schemaVersion: capability.version,
            input: jsonInput(hasCapabilityInput ? normalizedCapabilityInput : { message: input.message, context: input.context ?? null }),
            resources: jsonInput(resources),
            status: 'PREPARING',
          },
          select: { id: true },
        })).id
      : null;
    const messagePayload = { clientRequestId: input.clientRequestId, bodyHash, runId };
    const message = await tx.businessAssistantMessage.create({
      data: {
        tenantId: actor.tenantId,
        conversationId,
        ownerId: actor.userId,
        sequence,
        role: 'USER',
        type: 'INPUT',
        status: 'ACCEPTED',
        content: input.message,
        payload: jsonInput(messagePayload),
        resources: jsonInput(resources),
        operationKind: 'TURN',
        clientRequestId: input.clientRequestId,
        bodyHash,
        availableAt: new Date(),
      },
      select: { id: true },
    });
    return { conversationId, messageId: message.id, runId, duplicate: false };
  });
}

export interface ConversationListResult {
  conversations: readonly ConversationSummary[];
  capabilities: readonly CapabilityDescriptor[];
  enabled: boolean;
  mutationsEnabled: boolean;
  nextCursor: string | null;
}

export interface ConversationSummary {
  id: string;
  workspaceId: string;
  ownerId: string;
  title: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastMessage: MessageDto | null;
  capabilities: readonly CapabilityDescriptor[];
}

export interface MessageDto {
  id: string;
  sequence: number;
  role: string;
  type: string;
  status: string;
  content: string | null;
  payload?: JsonValue | null;
  resources?: readonly { resourceType: string; resourceId: string; role: 'source' | 'target' | 'context' }[];
  createdAt: string;
}

export async function listConversations(actor: AssistantActor, options: { cursor?: string; limit?: number } = {}): Promise<ConversationListResult> {
  const decision = await assertAssistantReadAccess(actor.userId, actor.tenantId);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const cursor = parseCursor(options.cursor);
  const conversations = await prisma.businessAssistantConversation.findMany({
    where: {
      tenantId: actor.tenantId,
      ownerId: actor.userId,
      status: { not: 'DELETED' },
      ...(cursor ? { OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true, ownerId: true, title: true, status: true, createdAt: true, updatedAt: true,
      messages: { orderBy: { sequence: 'desc' }, take: 1, select: { id: true, sequence: true, role: true, type: true, status: true, content: true, payload: true, resources: true, createdAt: true } },
    },
  });
  const hasMore = conversations.length > limit;
  const page = hasMore ? conversations.slice(0, limit) : conversations;
  const capabilities = filterCapabilityDescriptors(decision, businessAssistantCapabilityRegistry.list());
  return {
    conversations: page.map((conversation) => ({
      id: conversation.id,
      workspaceId: actor.tenantId,
      ownerId: conversation.ownerId,
      title: conversation.title,
      status: conversation.status,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      lastMessage: conversation.messages[0] ? toMessageDto(conversation.messages[0]) : null,
      capabilities,
    })),
    capabilities,
    enabled: process.env.BUSINESS_ASSISTANT_ENABLED === 'true',
    mutationsEnabled: process.env.BUSINESS_ASSISTANT_MUTATIONS_ENABLED === 'true' && process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED === 'true',
    nextCursor: hasMore ? cursorFor(page[page.length - 1].updatedAt, page[page.length - 1].id) : null,
  };
}

export interface ConversationDetail extends ConversationSummary {
  messages: readonly MessageDto[];
  runs: readonly { id: string; capabilityId: string; capabilityVersion: string; status: string; updatedAt: string }[];
}

export async function getConversation(actor: AssistantActor, conversationId: string): Promise<ConversationDetail> {
  const decision = await assertAssistantReadAccess(actor.userId, actor.tenantId);
  const conversation = await prisma.businessAssistantConversation.findFirst({
    where: { id: conversationId, tenantId: actor.tenantId, ownerId: actor.userId },
    select: {
      id: true, ownerId: true, title: true, status: true, createdAt: true, updatedAt: true,
      messages: { orderBy: { sequence: 'asc' }, take: 100, select: { id: true, sequence: true, role: true, type: true, status: true, content: true, payload: true, resources: true, createdAt: true } },
      runs: { orderBy: { createdAt: 'asc' }, take: 50, select: { id: true, capabilityId: true, capabilityVersion: true, status: true, updatedAt: true } },
    },
  });
  if (!conversation) throw new ConversationServiceError('NOT_FOUND', 'The conversation is unavailable.');
  const capabilities = filterCapabilityDescriptors(decision, businessAssistantCapabilityRegistry.list());
  return {
    id: conversation.id,
    workspaceId: actor.tenantId,
    ownerId: conversation.ownerId,
    title: conversation.title,
    status: conversation.status,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    lastMessage: conversation.messages.at(-1) ? toMessageDto(conversation.messages.at(-1)!) : null,
    capabilities,
    messages: conversation.messages.map(toMessageDto),
    runs: conversation.runs.map((run) => ({ ...run, status: run.status, updatedAt: run.updatedAt.toISOString() })),
  };
}

/**
 * Archive or tombstone a conversation owned by the caller. Archive cancels
 * work that has not crossed a canonical execution boundary; in-flight and
 * committed work remains for reconciliation and receipt history. Delete
 * redacts assistant content and input references while retaining the audit
 * rows needed to prove what happened.
 */
export async function applyConversationAction(actor: AssistantActor, conversationId: string, rawAction: unknown): Promise<ConversationDetail> {
  const parsed = businessAssistantConversationActionSchema.safeParse(rawAction);
  if (!parsed.success) throw new ConversationServiceError('VALIDATION_FAILED', 'The conversation action is invalid.', parsed.error.flatten());
  const action = parsed.data;
  await assertAssistantAdministrativeAccess(actor.userId, actor.tenantId);
  const bodyHash = sha256({ conversationId, action });
  const actionKind: 'ARCHIVE_CONVERSATION' | 'DELETE_CONVERSATION' = action.action === 'ARCHIVE' ? 'ARCHIVE_CONVERSATION' : 'DELETE_CONVERSATION';

  await runSerializableTransaction(prisma, async (tx) => {
    const existing = await tx.businessAssistantActionRequest.findFirst({
      where: { tenantId: actor.tenantId, ownerId: actor.userId, actionKind, clientRequestId: action.clientRequestId },
      select: { bodyHash: true },
    });
    if (existing) {
      if (existing.bodyHash !== bodyHash) throw new ConversationServiceError('ACTION_CONFLICT', 'This action request ID was already used with different content.');
      return;
    }
    const conversation = await tx.businessAssistantConversation.findFirst({
      where: { id: conversationId, tenantId: actor.tenantId, ownerId: actor.userId },
      select: { id: true, status: true },
    });
    if (!conversation) throw new ConversationServiceError('NOT_FOUND', 'The conversation is unavailable.');
    if (action.action === 'ARCHIVE' && conversation.status !== 'DELETED') {
      await tx.businessAssistantConversation.update({ where: { id: conversationId }, data: { status: 'ARCHIVED', deletedAt: null, deletedReason: null } });
    } else if (action.action === 'DELETE') {
      await tx.businessAssistantConversation.update({ where: { id: conversationId }, data: { status: 'DELETED', deletedAt: new Date(), deletedReason: action.reason ?? 'USER_REQUEST' } });
      await tx.businessAssistantMessage.updateMany({ where: { tenantId: actor.tenantId, conversationId }, data: { content: null, payload: Prisma.JsonNull, resources: Prisma.JsonNull } });
      // Keep run input/resources for an in-flight canonical operation. The
      // worker needs the frozen artifact and resource bindings to reconcile a
      // possible commit; only conversation messages are redacted here.
    }
    const activeRunWhere = { tenantId: actor.tenantId, conversationId, status: { notIn: ['COMPLETED', 'COMPLETED_WITH_EXCEPTIONS', 'FAILED', 'CANCELLED', 'EXPIRED'] as BusinessAssistantRunStatus[] } };
    await tx.businessAssistantRun.updateMany({ where: activeRunWhere, data: { status: 'CANCEL_REQUESTED', cancellationRequestedAt: new Date(), cancellationReason: action.reason ?? `CONVERSATION_${action.action}` } });
    const runs = await tx.businessAssistantRun.findMany({ where: { tenantId: actor.tenantId, conversationId }, select: { id: true } });
    if (runs.length > 0) {
      await tx.businessAssistantRunItem.updateMany({
        where: { tenantId: actor.tenantId, runId: { in: runs.map((run) => run.id) }, lifecycleState: { in: ['PENDING', 'PREPARING', 'WAITING_CONFIRMATION', 'READY'] } },
        data: { lifecycleState: 'CANCELLED', dispositionReason: `CONVERSATION_${action.action}`, activeStage: null, availableAt: new Date() },
      });
      await tx.businessAssistantProposal.updateMany({ where: { tenantId: actor.tenantId, runId: { in: runs.map((run) => run.id) }, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
      // Approval rows are immutable evidence. Cancellation is represented by
      // the run/proposal state and never rewrites an APPROVED decision.
    }
    await tx.businessAssistantActionRequest.create({ data: { tenantId: actor.tenantId, ownerId: actor.userId, conversationId, actionKind, clientRequestId: action.clientRequestId, bodyHash, status: 'APPLIED', response: jsonInput({ conversationId, action: action.action }) } });
  });
  return getConversation(actor, conversationId);
}

function toMessageDto(message: { id: string; sequence: number; role: string; type: string; status: string; content: string | null; payload: Prisma.JsonValue | null; resources: Prisma.JsonValue | null; createdAt: Date }): MessageDto {
  return {
    id: message.id,
    sequence: message.sequence,
    role: message.role,
    type: message.type,
    status: message.status,
    content: message.content,
    payload: message.payload as JsonValue | null,
    resources: Array.isArray(message.resources) ? message.resources as unknown as MessageDto['resources'] : undefined,
    createdAt: message.createdAt.toISOString(),
  };
}

export class ConversationServiceError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'FORBIDDEN' | 'NOT_FOUND' | 'ACTION_CONFLICT' | 'CAPABILITY_VERSION_UNAVAILABLE', message: string, readonly details?: unknown) {
    super(message);
    this.name = 'ConversationServiceError';
  }
}
