import { Prisma, type BusinessAssistantMemoryState } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import { acquireBusinessOperationBarrier } from '@/lib/business-operation-backup-barrier';
import { resolveFreshActor } from '@/lib/fresh-authorization';
import { businessAssistantMemoryActionSchema } from '@/lib/validations/business-assistant';
import { getAssistantPreferenceDefinition } from '@/lib/business-assistant-preferences';
import { sha256 } from './contracts';
import { assertAssistantActor, assertAssistantAdministrativeAccess } from './policy.service';
import type { AssistantActor } from './conversation.service';
import { eraseLearningDerivedFromMemory } from './learning-derived-cleanup';

const MEMORY_ADMIN_FORBIDDEN_MESSAGE = 'Only a workspace administrator can change tenant preferences.';
const MEMORY_WORKSPACE_PAUSED_MESSAGE = 'The workspace is restoring and cannot accept new assistant work.';

export const ASSISTANT_MEMORY_KEYS = ['language', 'response_detail', 'playfulness'] as const;
export type AssistantMemoryKey = typeof ASSISTANT_MEMORY_KEYS[number];

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function validateMemoryValue(key: string, value: unknown): void {
  if (!ASSISTANT_MEMORY_KEYS.includes(key as AssistantMemoryKey)) throw new MemoryServiceError('VALIDATION_FAILED', 'This preference key is not supported.');
  const definition = getAssistantPreferenceDefinition(key);
  if (!definition) throw new MemoryServiceError('VALIDATION_FAILED', 'This preference key is not supported.');
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) throw new MemoryServiceError('VALIDATION_FAILED', 'The preference value is not valid for this key.');
}

async function freshMemoryActorInTransaction(actor: AssistantActor, tx: Prisma.TransactionClient): Promise<boolean> {
  await acquireBusinessOperationBarrier(tx, actor.tenantId, 'shared');
  const freshActor = await resolveFreshActor({ userId: actor.userId, workspaceId: actor.tenantId }, tx);
  if (!freshActor) throw new MemoryServiceError('FORBIDDEN', 'The current user or workspace is unavailable.');
  return Boolean(freshActor.isWorkspaceAdmin || freshActor.isSuperAdmin || freshActor.internalRole === 'ADMIN');
}

async function assertMemoryScopeAndWorkspaceOperationalInTransaction(
  actor: AssistantActor,
  tx: Prisma.TransactionClient,
  scope: string,
  isAdmin: boolean,
): Promise<void> {
  if (scope === 'TENANT' && !isAdmin) throw new MemoryServiceError('FORBIDDEN', MEMORY_ADMIN_FORBIDDEN_MESSAGE);
  const backups = await tx.workspaceBackup.findMany({
    where: { tenantId: actor.tenantId, status: { in: ['RESTORING', 'COMPLETED'] } },
    select: { status: true, errorDetails: true },
  });
  const paused = backups.some((backup) => {
    if (backup.status === 'RESTORING') return true;
    const details = backup.errorDetails;
    return Boolean(details && typeof details === 'object' && !Array.isArray(details)
      && (details as Record<string, unknown>).businessAssistantDispatchPaused === true);
  });
  if (paused) throw new MemoryServiceError('FORBIDDEN', MEMORY_WORKSPACE_PAUSED_MESSAGE);
}

export interface MemoryDto {
  id: string;
  scope: string;
  conversationId: string | null;
  capabilityId: string | null;
  capabilityVersion: string | null;
  key: string;
  value: Prisma.JsonValue;
  provenance: Prisma.JsonValue;
  evidenceCount: number;
  risk: string;
  state: string;
  version: number;
  effectiveAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  allowedActions: readonly ('CONFIRM' | 'REVISE' | 'DEACTIVATE' | 'DELETE')[];
}

export async function listMemories(actor: AssistantActor, options: { includeDeleted?: boolean; capabilityId?: string; capabilityVersion?: string; conversationId?: string } = {}): Promise<MemoryDto[]> {
  await assertAssistantActor(actor.userId, actor.tenantId);
  const filters = [
    ...(options.capabilityId ? [{ OR: [{ capabilityId: null }, { capabilityId: options.capabilityId }] }] : []),
    ...(options.capabilityVersion ? [{ OR: [{ capabilityVersion: null }, { capabilityVersion: options.capabilityVersion }] }] : []),
    ...(options.conversationId ? [{ OR: [{ conversationId: null }, { conversationId: options.conversationId }] }] : []),
  ];
  const memories = await prisma.businessAssistantMemory.findMany({
    where: {
      tenantId: actor.tenantId,
      ownerId: actor.userId,
      ...(options.includeDeleted ? {} : { state: { not: 'DELETED' } }),
      ...(filters.length > 0 ? { AND: filters } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });
  return memories.map(toMemoryDto);
}

export async function createMemoryCandidate(actor: AssistantActor, input: { key: string; value: unknown; scope?: 'SESSION' | 'USER' | 'TENANT'; conversationId?: string; capabilityId?: string; capabilityVersion?: string; provenance?: unknown; expiresAt?: Date }): Promise<MemoryDto> {
  const access = await assertAssistantAdministrativeAccess(actor.userId, actor.tenantId);
  validateMemoryValue(input.key, input.value);
  if ((input.scope ?? 'USER') === 'SESSION' && !input.conversationId) throw new MemoryServiceError('VALIDATION_FAILED', 'Session preferences require a conversation.');
  const scope = input.scope ?? 'USER';
  if (scope === 'TENANT' && !access.isAdmin) throw new MemoryServiceError('FORBIDDEN', MEMORY_ADMIN_FORBIDDEN_MESSAGE);
  const memory = await runSerializableTransaction(prisma, async (tx) => {
    const isAdmin = await freshMemoryActorInTransaction(actor, tx);
    await assertMemoryScopeAndWorkspaceOperationalInTransaction(actor, tx, scope, isAdmin);
    const latest = await tx.businessAssistantMemory.findFirst({
      where: {
        tenantId: actor.tenantId,
        ownerId: actor.userId,
        scope,
        conversationId: input.conversationId ?? null,
        capabilityId: input.capabilityId ?? null,
        capabilityVersion: input.capabilityVersion ?? null,
        key: input.key,
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return tx.businessAssistantMemory.create({
      data: {
        tenantId: actor.tenantId,
        ownerId: actor.userId,
        scope,
        conversationId: input.conversationId,
        capabilityId: input.capabilityId,
        capabilityVersion: input.capabilityVersion,
        key: input.key,
        value: jsonInput(input.value),
        provenance: jsonInput(input.provenance ?? { source: 'EXPLICIT_REQUEST' }),
        evidenceCount: 1,
        risk: 'LOW',
        state: 'CANDIDATE',
        version: (latest?.version ?? 0) + 1,
        expiresAt: input.expiresAt,
      },
    });
  });
  return toMemoryDto(memory);
}

export async function applyMemoryAction(actor: AssistantActor, memoryId: string, rawAction: unknown): Promise<MemoryDto> {
  const parsed = businessAssistantMemoryActionSchema.safeParse(rawAction);
  if (!parsed.success) throw new MemoryServiceError('VALIDATION_FAILED', 'The memory action is invalid.');
  const action = parsed.data;
  const memory = await prisma.businessAssistantMemory.findFirst({ where: { id: memoryId, tenantId: actor.tenantId, ownerId: actor.userId }, select: { id: true, key: true, value: true, state: true, version: true, scope: true } });
  if (!memory) throw new MemoryServiceError('NOT_FOUND', 'The preference is unavailable.');
  const access = await assertAssistantAdministrativeAccess(actor.userId, actor.tenantId);
  if (memory.scope === 'TENANT' && !access.isAdmin) throw new MemoryServiceError('FORBIDDEN', MEMORY_ADMIN_FORBIDDEN_MESSAGE);
  const actionKind = `MEMORY_${action.action}` as 'MEMORY_CONFIRM' | 'MEMORY_REVISE' | 'MEMORY_DEACTIVATE' | 'MEMORY_DELETE';
  const bodyHash = sha256({ memoryId, action });
  const result = await runSerializableTransaction(prisma, async (tx) => {
    const isAdmin = await freshMemoryActorInTransaction(actor, tx);
    const current = await tx.businessAssistantMemory.findFirst({ where: { id: memoryId, tenantId: actor.tenantId, ownerId: actor.userId } });
    if (!current) throw new MemoryServiceError('NOT_FOUND', 'The preference is unavailable.');
    await assertMemoryScopeAndWorkspaceOperationalInTransaction(actor, tx, current.scope, isAdmin);
    const existing = await tx.businessAssistantActionRequest.findFirst({ where: { tenantId: actor.tenantId, ownerId: actor.userId, actionKind, clientRequestId: action.clientRequestId }, select: { bodyHash: true } });
    if (existing) {
      if (existing.bodyHash !== bodyHash) throw new MemoryServiceError('ACTION_CONFLICT', 'This action request ID was already used with different content.');
      return current;
    }
    if (current.version !== action.expectedVersion) throw new MemoryServiceError('ACTION_CONFLICT', 'The preference changed; refresh before applying this action.');
    if (current.state === 'DELETED') throw new MemoryServiceError('ACTION_CONFLICT', 'A deleted preference cannot be changed. Create a new candidate to remember a new preference.');
    let nextState: BusinessAssistantMemoryState = current.state;
    let value = current.value as Prisma.InputJsonValue;
    if (action.action === 'CONFIRM') {
      if (current.state !== 'CANDIDATE') throw new MemoryServiceError('ACTION_CONFLICT', 'Only a candidate preference can be confirmed.');
      nextState = 'ACTIVE';
    } else if (action.action === 'REVISE') {
      const nextKey = action.key ?? current.key;
      const nextValue = action.value === undefined ? current.value : action.value;
      validateMemoryValue(nextKey, nextValue);
      value = jsonInput(nextValue);
      nextState = 'CANDIDATE';
    } else if (action.action === 'DEACTIVATE') {
      nextState = 'DEACTIVATED';
    } else {
      // Keep a minimal tombstone and remove the value so deletion cannot be
      // undone by a later rollback or stale cache.
      nextState = 'DELETED';
      value = jsonInput({ deleted: true });
    }
    if (action.action === 'CONFIRM') {
      await tx.businessAssistantMemory.updateMany({
        where: {
          tenantId: actor.tenantId,
          ownerId: actor.userId,
          scope: current.scope,
          conversationId: current.conversationId,
          capabilityId: current.capabilityId,
          capabilityVersion: current.capabilityVersion,
          key: current.key,
          state: 'ACTIVE',
          id: { not: current.id },
        },
        data: { state: 'SUPERSEDED' },
      });
    }
    if (action.action === 'DELETE') {
      await eraseLearningDerivedFromMemory(tx, actor, current.id);
    }
    const updated = await tx.businessAssistantMemory.update({ where: { id: memoryId }, data: { state: nextState, value, effectiveAt: action.action === 'CONFIRM' ? new Date() : undefined, version: { increment: 1 }, ...(action.action === 'REVISE' && action.key ? { key: action.key } : {}), ...(action.action === 'DELETE' ? { deletedAt: new Date(), provenance: jsonInput({ deletedAt: new Date().toISOString(), source: 'USER_REQUEST' }) } : {}) } });
    await tx.businessAssistantActionRequest.create({ data: { tenantId: actor.tenantId, ownerId: actor.userId, actionKind, clientRequestId: action.clientRequestId, bodyHash, status: 'APPLIED', response: jsonInput({ memoryId: updated.id, version: updated.version }) } });
    return updated;
  });
  return toMemoryDto(result);
}

export interface ActiveMemoryContext {
  ownerId?: string;
  scope?: 'SESSION' | 'USER' | 'TENANT';
  conversationId?: string;
  capabilityId?: string;
  capabilityVersion?: string;
}

export function activeMemoriesForPrompt(
  memories: readonly { key: string; value: Prisma.JsonValue; state: string; expiresAt: Date | null; ownerId?: string; scope?: string; conversationId?: string | null; capabilityId?: string | null; capabilityVersion?: string | null }[],
  now = new Date(),
  context: ActiveMemoryContext = {},
): readonly { key: string; value: Prisma.JsonValue }[] {
  return memories
    .filter((memory) => memory.state === 'ACTIVE' && (!memory.expiresAt || memory.expiresAt > now))
    .filter((memory) => !context.ownerId || !memory.ownerId || memory.ownerId === context.ownerId)
    .filter((memory) => !context.scope || memory.scope === context.scope)
    .filter((memory) => memory.scope !== 'SESSION' || !context.conversationId || memory.conversationId === context.conversationId)
    .filter((memory) => !context.capabilityId || memory.capabilityId === null || memory.capabilityId === context.capabilityId)
    .filter((memory) => !context.capabilityVersion || memory.capabilityVersion === null || memory.capabilityVersion === context.capabilityVersion)
    .map(({ key, value }) => ({ key, value }));
}

function toMemoryDto(memory: { id: string; scope: string; conversationId: string | null; capabilityId: string | null; capabilityVersion: string | null; key: string; value: Prisma.JsonValue; provenance: Prisma.JsonValue; evidenceCount: number; risk: string; state: string; version: number; effectiveAt: Date | null; expiresAt: Date | null; createdAt: Date; updatedAt: Date }): MemoryDto {
  const allowedActions = memory.state === 'DELETED' ? [] : memory.state === 'CANDIDATE' ? ['CONFIRM', 'REVISE', 'DELETE'] as const : ['REVISE', 'DEACTIVATE', 'DELETE'] as const;
  return {
    id: memory.id,
    scope: memory.scope,
    conversationId: memory.conversationId,
    capabilityId: memory.capabilityId,
    capabilityVersion: memory.capabilityVersion,
    key: memory.key,
    value: memory.value,
    provenance: memory.provenance,
    evidenceCount: memory.evidenceCount,
    risk: memory.risk,
    state: memory.state,
    version: memory.version,
    effectiveAt: memory.effectiveAt?.toISOString() ?? null,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
    allowedActions,
  };
}

export class MemoryServiceError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'FORBIDDEN' | 'NOT_FOUND' | 'ACTION_CONFLICT', message: string) {
    super(message);
    this.name = 'MemoryServiceError';
  }
}
