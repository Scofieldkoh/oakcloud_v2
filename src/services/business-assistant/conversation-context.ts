import { prisma } from '@/lib/prisma';
import { evaluateFreshAuthorization } from '@/lib/fresh-authorization';
import { BUSINESS_ASSISTANT_LIMITS, resourceRefSchema, type ResourceRef } from './contracts';

const CONTEXT_SCAN_LIMIT = 24;
const CONTEXT_RESOURCE_LIMIT = Math.min(12, BUSINESS_ASSISTANT_LIMITS.maxResourceRefs);

interface ContextMessageRecord {
  id: string;
  sequence: number;
  role: string;
  status: string;
  resources: unknown;
  createdAt: Date;
}

interface ContextRunItemRecord {
  resources: unknown;
  updatedAt: Date;
}

export interface ConversationContextStore {
  loadCurrentMessage(input: {
    tenantId: string;
    userId: string;
    conversationId: string;
    messageId: string;
  }): Promise<{ id: string; sequence: number; resources: unknown; createdAt: Date } | null>;
  loadRecentMessages(input: {
    tenantId: string;
    userId: string;
    conversationId: string;
    throughSequence: number;
    limit: number;
  }): Promise<readonly ContextMessageRecord[]>;
  loadRecentSuccessfulItems(input: {
    tenantId: string;
    userId: string;
    conversationId: string;
    createdBefore: Date;
    limit: number;
  }): Promise<readonly ContextRunItemRecord[]>;
}

export interface ConversationContextDependencies {
  store?: ConversationContextStore;
  authorizeResource?: (input: { tenantId: string; userId: string; resource: ResourceRef }) => Promise<boolean>;
  maxResources?: number;
}

const prismaContextStore: ConversationContextStore = {
  async loadCurrentMessage(input) {
    return prisma.businessAssistantMessage.findFirst({
      where: {
        id: input.messageId,
        tenantId: input.tenantId,
        ownerId: input.userId,
        conversationId: input.conversationId,
        conversation: { status: 'ACTIVE' },
      },
      select: { id: true, sequence: true, resources: true, createdAt: true },
    });
  },

  async loadRecentMessages(input) {
    return prisma.businessAssistantMessage.findMany({
      where: {
        tenantId: input.tenantId,
        ownerId: input.userId,
        conversationId: input.conversationId,
        sequence: { lte: input.throughSequence },
        status: { not: 'FAILED' },
      },
      orderBy: [{ sequence: 'desc' }, { createdAt: 'desc' }],
      take: input.limit,
      select: { id: true, sequence: true, role: true, status: true, resources: true, createdAt: true },
    });
  },

  async loadRecentSuccessfulItems(input) {
    return prisma.businessAssistantRunItem.findMany({
      where: {
        tenantId: input.tenantId,
        executionOutcome: { in: ['SUCCEEDED_READ', 'COMMITTED', 'NO_CHANGE'] },
        run: {
          tenantId: input.tenantId,
          ownerId: input.userId,
          conversationId: input.conversationId,
          createdAt: { lte: input.createdBefore },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: input.limit,
      select: { resources: true, updatedAt: true },
    });
  },
};

function parseRefs(value: unknown): ResourceRef[] {
  if (!Array.isArray(value)) return [];
  const refs: ResourceRef[] = [];
  for (const candidate of value) {
    const parsed = resourceRefSchema.safeParse(candidate);
    if (parsed.success) refs.push(parsed.data);
  }
  return refs;
}

function normalizedType(value: string): string {
  const type = value.trim().toLowerCase();
  if (type === 'bizfile.document') return 'document';
  return type;
}

async function authorizeContextResource(input: {
  tenantId: string;
  userId: string;
  resource: ResourceRef;
}): Promise<boolean> {
  const type = normalizedType(input.resource.resourceType);
  if (type === 'company') {
    return (await evaluateFreshAuthorization({
      userId: input.userId,
      workspaceId: input.tenantId,
      permission: { resource: 'company', action: 'read' },
      resource: { kind: 'company', id: input.resource.resourceId },
    })).allowed;
  }
  if (type === 'document') {
    return (await evaluateFreshAuthorization({
      userId: input.userId,
      workspaceId: input.tenantId,
      permission: { resource: 'document', action: 'read' },
      resource: { kind: 'document', id: input.resource.resourceId },
    })).allowed;
  }
  if (type === 'processingdocument') {
    return (await evaluateFreshAuthorization({
      userId: input.userId,
      workspaceId: input.tenantId,
      permission: { resource: 'document', action: 'read' },
      resource: { kind: 'processingDocument', id: input.resource.resourceId },
    })).allowed;
  }
  if (type === 'generateddocument') {
    return (await evaluateFreshAuthorization({
      userId: input.userId,
      workspaceId: input.tenantId,
      permission: { resource: 'document', action: 'read' },
      resource: { kind: 'generatedDocument', id: input.resource.resourceId },
    })).allowed;
  }
  if (type === 'contact') {
    return (await evaluateFreshAuthorization({
      userId: input.userId,
      workspaceId: input.tenantId,
      permission: { resource: 'contact', action: 'read' },
      resource: { kind: 'contact', id: input.resource.resourceId },
    })).allowed;
  }
  // Unknown resource vocabularies fail closed until their module provides a
  // fresh authorization mapping. Context is convenience, never authority.
  return false;
}

/**
 * Apply newest-source precedence generically by resource type. All refs of a
 * type from the newest source group are retained (so genuine ambiguity stays
 * visible), while stale older refs of that same type are shadowed.
 */
function prioritizedCandidates(sourceGroups: readonly (readonly ResourceRef[])[]): ResourceRef[] {
  const claimedTypes = new Set<string>();
  const seen = new Set<string>();
  const result: ResourceRef[] = [];
  for (const source of sourceGroups) {
    const byType = new Map<string, ResourceRef[]>();
    for (const resource of source) {
      const type = normalizedType(resource.resourceType);
      const bucket = byType.get(type) ?? [];
      bucket.push(resource);
      byType.set(type, bucket);
    }
    for (const [type, resources] of byType) {
      if (claimedTypes.has(type)) continue;
      claimedTypes.add(type);
      for (const resource of resources) {
        const key = `${type}\u0000${resource.resourceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(resource);
        if (result.length >= CONTEXT_SCAN_LIMIT) return result;
      }
    }
  }
  return result;
}

/**
 * Resolve bounded durable resource context for one accepted turn. Context is
 * conversation-local, newest-first, and every candidate is freshly
 * reauthorized before it can reach the router/capability.
 */
export async function resolveConversationResourceContext(
  input: { tenantId: string; userId: string; conversationId: string; messageId: string },
  dependencies: ConversationContextDependencies = {},
): Promise<ResourceRef[]> {
  const store = dependencies.store ?? prismaContextStore;
  const authorizeResource = dependencies.authorizeResource ?? authorizeContextResource;
  const maxResources = Math.max(1, Math.min(
    dependencies.maxResources ?? CONTEXT_RESOURCE_LIMIT,
    BUSINESS_ASSISTANT_LIMITS.maxResourceRefs,
  ));
  const current = await store.loadCurrentMessage(input);
  if (!current) return [];

  const [messages, successfulItems] = await Promise.all([
    store.loadRecentMessages({
      tenantId: input.tenantId,
      userId: input.userId,
      conversationId: input.conversationId,
      throughSequence: current.sequence,
      limit: CONTEXT_SCAN_LIMIT,
    }),
    store.loadRecentSuccessfulItems({
      tenantId: input.tenantId,
      userId: input.userId,
      conversationId: input.conversationId,
      createdBefore: current.createdAt,
      limit: CONTEXT_SCAN_LIMIT,
    }),
  ]);

  const recentSuccessfulSources = [
    ...messages
      .filter((message) => message.id !== current.id && message.role === 'ASSISTANT' && message.status === 'PROCESSED')
      .map((message) => ({ resources: parseRefs(message.resources), at: message.createdAt })),
    ...successfulItems.map((item) => ({ resources: parseRefs(item.resources), at: item.updatedAt })),
  ]
    .filter((source) => source.resources.length > 0)
    .sort((left, right) => right.at.getTime() - left.at.getTime())
    .map((source) => source.resources);
  const earlierSources = messages
    .filter((message) => message.id !== current.id && message.role !== 'ASSISTANT')
    .map((message) => parseRefs(message.resources));
  const candidates = prioritizedCandidates([
    parseRefs(current.resources),
    ...recentSuccessfulSources,
    ...earlierSources,
  ]);

  const authorized: ResourceRef[] = [];
  for (const resource of candidates) {
    if (authorized.length >= maxResources) break;
    try {
      if (await authorizeResource({ tenantId: input.tenantId, userId: input.userId, resource })) {
        authorized.push(resource);
      }
    } catch {
      // A failed resource reauthorization is treated as unavailable context.
      // Do not reveal whether the resource exists or why access disappeared.
    }
  }
  return authorized;
}

export const BUSINESS_ASSISTANT_CONVERSATION_CONTEXT_LIMIT = CONTEXT_RESOURCE_LIMIT;
