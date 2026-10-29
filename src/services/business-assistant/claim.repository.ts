import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import { BUSINESS_ASSISTANT_LIMITS } from './contracts';
import {
  BUSINESS_ASSISTANT_OPERATIONAL_LIMITS,
  assertBusinessAssistantStageBudget,
} from './operational-policy';

export interface AssistantClaim {
  token: string;
  generation: number;
  leaseExpiresAt: Date;
  capacitySlotKey?: string;
  capacityGeneration?: number;
}

export interface ClaimedItem extends AssistantClaim {
  id: string;
  tenantId: string;
  runId: string;
  activeStage: string | null;
}

export interface StageAttempt {
  id: string;
  stage: string;
  attemptNumber: number;
}

const LEASE_MS = BUSINESS_ASSISTANT_LIMITS.leaseSeconds * 1_000;
const SLOT_KEYS = ['business-assistant-0', 'business-assistant-1'] as const;

/**
 * Capacity rows are durable global coordination state. Seed them with an
 * idempotent insert before attempting a claim so the first concurrent worker
 * pair cannot race on the unique slot key.
 */
async function ensureCapacitySlots(): Promise<void> {
  await prisma.businessAssistantCapacitySlot.createMany({
    data: SLOT_KEYS.map((slotKey) => ({ slotKey })),
    skipDuplicates: true,
  });
}

function nextLease(): Date {
  return new Date(Date.now() + LEASE_MS);
}

function leaseAvailable(now: Date) {
  return { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] };
}

function leaseActive(now: Date) {
  return { leaseExpiresAt: { gt: now } } as const;
}

function incrementsRetryCount(data: Prisma.BusinessAssistantRunItemUpdateManyMutationInput): boolean {
  const value = data.retryCount;
  return Boolean(value && typeof value === 'object' && 'increment' in value && Number(value.increment) > 0);
}

/** Claim one accepted or expired inbound message with a fenced token. */
export async function claimInboundMessage(): Promise<(AssistantClaim & { id: string; tenantId: string; ownerId: string; conversationId: string }) | null> {
  const token = randomUUID();
  const leaseExpiresAt = nextLease();
  const now = new Date();
  const candidate = await prisma.businessAssistantMessage.findFirst({
    where: {
      status: { in: ['ACCEPTED', 'PROCESSING'] },
      availableAt: { lte: now },
      ...leaseAvailable(now),
      conversation: { status: { not: 'DELETED' } },
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, tenantId: true, ownerId: true, conversationId: true, claimGeneration: true, status: true },
  });
  if (!candidate) return null;
  const generation = (candidate.claimGeneration ?? 0) + 1;
  const updated = await prisma.businessAssistantMessage.updateMany({
    where: {
      id: candidate.id,
      status: candidate.status,
      claimGeneration: candidate.claimGeneration,
      ...leaseAvailable(now),
    },
    data: { status: 'PROCESSING', claimToken: token, claimGeneration: generation, leaseExpiresAt },
  });
  if (updated.count !== 1) return null;
  return { id: candidate.id, tenantId: candidate.tenantId, ownerId: candidate.ownerId, conversationId: candidate.conversationId, token, generation, leaseExpiresAt };
}

export async function settleInboundMessage(claim: AssistantClaim & { id: string }, status: 'PROCESSED' | 'FAILED', availableAt?: Date): Promise<boolean> {
  const now = new Date();
  const updated = await prisma.businessAssistantMessage.updateMany({
    where: { id: claim.id, claimToken: claim.token, claimGeneration: claim.generation, status: 'PROCESSING', ...leaseActive(now) },
    data: { status, claimToken: null, leaseExpiresAt: null, availableAt: availableAt ?? now },
  });
  return updated.count === 1;
}

export async function renewInboundMessageClaim(claim: AssistantClaim & { id: string }): Promise<boolean> {
  const now = new Date();
  const leaseExpiresAt = nextLease();
  const updated = await prisma.businessAssistantMessage.updateMany({
    where: { id: claim.id, claimToken: claim.token, claimGeneration: claim.generation, status: 'PROCESSING', ...leaseActive(now) },
    data: { leaseExpiresAt },
  });
  if (updated.count === 1) claim.leaseExpiresAt = leaseExpiresAt;
  return updated.count === 1;
}

/**
 * Claim one item and one of the two global capacity slots in a serializable
 * transaction. The item CAS includes an unexpired lease predicate so an old
 * worker cannot settle work after a new worker has reclaimed it. Items that
 * exhausted the worker retry budget are never claimable again.
 */
export async function claimRunnableItem(): Promise<ClaimedItem | null> {
  const token = randomUUID();
  const leaseExpiresAt = nextLease();
  await ensureCapacitySlots();
  const claim = await runSerializableTransaction(prisma, async (tx) => {
    const now = new Date();
    for (const slotKey of SLOT_KEYS) {
      const slot = await tx.businessAssistantCapacitySlot.findUnique({ where: { slotKey }, select: { id: true, claimGeneration: true, leaseExpiresAt: true } });
      const slotGeneration = (slot?.claimGeneration ?? 0) + 1;
      if (!slot) {
        await tx.businessAssistantCapacitySlot.create({ data: { slotKey, claimToken: token, claimGeneration: slotGeneration, leaseExpiresAt, heartbeatAt: now } });
      } else {
        const claimed = await tx.businessAssistantCapacitySlot.updateMany({ where: { id: slot.id, claimGeneration: slot.claimGeneration, ...leaseAvailable(now) }, data: { claimToken: token, claimGeneration: slotGeneration, leaseExpiresAt, heartbeatAt: now, tenantId: null, userId: null, runItemId: null, stage: null } });
        if (claimed.count !== 1) continue;
      }
      const candidate = await tx.businessAssistantRunItem.findFirst({
        where: {
          lifecycleState: { in: ['PENDING', 'PREPARING', 'READY', 'EXECUTING', 'RECOVERING', 'READING_BACK', 'REVIEWING'] },
          retryCount: { lt: BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxWorkerFailuresPerItem },
          availableAt: { lte: now },
          ...leaseAvailable(now),
          run: { status: { in: ['PREPARING', 'READY', 'RUNNING', 'RECOVERING', 'REVIEWING'] } },
        },
        orderBy: [{ availableAt: 'asc' }, { retryCount: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, tenantId: true, runId: true, activeStage: true, claimGeneration: true },
      });
      if (!candidate) {
        await tx.businessAssistantCapacitySlot.updateMany({ where: { slotKey, claimToken: token, claimGeneration: slotGeneration }, data: { claimToken: null, leaseExpiresAt: null, heartbeatAt: null, tenantId: null, userId: null, runItemId: null, stage: null } });
        return null;
      }
      const generation = (candidate.claimGeneration ?? 0) + 1;
      const updated = await tx.businessAssistantRunItem.updateMany({
        where: {
          id: candidate.id,
          claimGeneration: candidate.claimGeneration,
          retryCount: { lt: BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxWorkerFailuresPerItem },
          lifecycleState: { in: ['PENDING', 'PREPARING', 'READY', 'EXECUTING', 'RECOVERING', 'READING_BACK', 'REVIEWING'] },
          ...leaseAvailable(now),
        },
        data: { claimToken: token, claimGeneration: generation, leaseExpiresAt, activeStage: candidate.activeStage ?? 'PREPARATION' },
      });
      if (updated.count !== 1) {
        await tx.businessAssistantCapacitySlot.updateMany({ where: { slotKey, claimToken: token, claimGeneration: slotGeneration }, data: { claimToken: null, leaseExpiresAt: null, heartbeatAt: null, tenantId: null, userId: null, runItemId: null, stage: null } });
        continue;
      }
      await tx.businessAssistantCapacitySlot.updateMany({ where: { slotKey, claimToken: token, claimGeneration: slotGeneration }, data: { tenantId: candidate.tenantId, runItemId: candidate.id, heartbeatAt: now, stage: candidate.activeStage ?? 'PREPARATION' } });
      return { id: candidate.id, tenantId: candidate.tenantId, runId: candidate.runId, activeStage: candidate.activeStage ?? 'PREPARATION', token, generation, leaseExpiresAt, capacitySlotKey: slotKey, capacityGeneration: slotGeneration };
    }
    return null;
  });
  return claim;
}

export async function renewItemClaim(claim: ClaimedItem): Promise<boolean> {
  const now = new Date();
  const leaseExpiresAt = nextLease();
  return runSerializableTransaction(prisma, async (tx) => {
    const updated = await tx.businessAssistantRunItem.updateMany({ where: { id: claim.id, claimToken: claim.token, claimGeneration: claim.generation, ...leaseActive(now) }, data: { leaseExpiresAt } });
    if (updated.count !== 1) return false;
    if (claim.capacitySlotKey && claim.capacityGeneration !== undefined) {
      const slot = await tx.businessAssistantCapacitySlot.updateMany({ where: { slotKey: claim.capacitySlotKey, claimToken: claim.token, claimGeneration: claim.capacityGeneration, runItemId: claim.id, ...leaseActive(now) }, data: { leaseExpiresAt, heartbeatAt: now } });
      if (slot.count !== 1) return false;
    }
    claim.leaseExpiresAt = leaseExpiresAt;
    return true;
  });
}

/**
 * Fenced item settlement primitive for every worker state transition. Retry
 * increments are made terminal at the budget boundary in the same serializable
 * transaction, preventing an active-but-unclaimable poison item.
 */
export async function updateClaimedItem(claim: AssistantClaim & { id: string }, data: Prisma.BusinessAssistantRunItemUpdateManyMutationInput): Promise<boolean> {
  if (!incrementsRetryCount(data)) {
    const updated = await prisma.businessAssistantRunItem.updateMany({ where: { id: claim.id, claimToken: claim.token, claimGeneration: claim.generation, ...leaseActive(new Date()) }, data });
    return updated.count === 1;
  }
  return runSerializableTransaction(prisma, async (tx) => {
    const now = new Date();
    const current = await tx.businessAssistantRunItem.findFirst({
      where: { id: claim.id, claimToken: claim.token, claimGeneration: claim.generation, ...leaseActive(now) },
      select: { retryCount: true },
    });
    if (!current) return false;
    const exhausted = current.retryCount + 1 >= BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxWorkerFailuresPerItem;
    const boundedData: Prisma.BusinessAssistantRunItemUpdateManyMutationInput = exhausted
      ? {
          ...data,
          lifecycleState: 'FAILED',
          activeStage: null,
          dispositionReason: 'RETRY_BUDGET_EXHAUSTED',
          availableAt: now,
        }
      : data;
    const updated = await tx.businessAssistantRunItem.updateMany({
      where: { id: claim.id, claimToken: claim.token, claimGeneration: claim.generation, retryCount: current.retryCount, ...leaseActive(now) },
      data: boundedData,
    });
    return updated.count === 1;
  });
}

export async function releaseItemClaim(claim: AssistantClaim & { id: string }, options: { availableAt?: Date; keepState?: boolean } = {}): Promise<boolean> {
  return runSerializableTransaction(prisma, async (tx) => {
    const now = new Date();
    const updated = await tx.businessAssistantRunItem.updateMany({
      where: { id: claim.id, claimToken: claim.token, claimGeneration: claim.generation, ...leaseActive(now) },
      data: {
        claimToken: null,
        leaseExpiresAt: null,
        ...(options.availableAt ? { availableAt: options.availableAt } : options.keepState ? {} : { availableAt: now }),
        ...(options.keepState ? {} : { lifecycleState: 'PENDING' }),
      },
    });
    if (claim.capacitySlotKey && claim.capacityGeneration !== undefined) {
      await tx.businessAssistantCapacitySlot.updateMany({ where: { slotKey: claim.capacitySlotKey, claimToken: claim.token, claimGeneration: claim.capacityGeneration, runItemId: claim.id, ...leaseActive(now) }, data: { claimToken: null, leaseExpiresAt: null, heartbeatAt: null, tenantId: null, userId: null, runItemId: null, stage: null } });
    }
    return updated.count === 1;
  });
}

/** Start one bounded attempt for a stage under the current item fence. */
export async function startStageAttempt(claim: ClaimedItem, stage: string, inputArtifact?: unknown): Promise<StageAttempt> {
  return runSerializableTransaction(prisma, async (tx) => {
    const now = new Date();
    const item = await tx.businessAssistantRunItem.findFirst({ where: { id: claim.id, tenantId: claim.tenantId, claimToken: claim.token, claimGeneration: claim.generation, ...leaseActive(now) }, select: { id: true, activeStage: true } });
    if (!item) throw new FencedClaimError();
    const totalAttempts = await tx.businessAssistantRunStep.count({ where: { tenantId: claim.tenantId, runItemId: claim.id } });
    assertBusinessAssistantStageBudget(totalAttempts);
    const previous = await tx.businessAssistantRunStep.findFirst({ where: { tenantId: claim.tenantId, runItemId: claim.id, stage: stage as never }, orderBy: { attemptNumber: 'desc' }, select: { id: true, attemptNumber: true, status: true } });
    const attemptNumber = (previous?.attemptNumber ?? 0) + 1;
    if (attemptNumber > BUSINESS_ASSISTANT_LIMITS.maxAttemptsPerStage) throw new StageAttemptsExhaustedError(stage);
    if (previous?.status === 'RUNNING') await tx.businessAssistantRunStep.updateMany({ where: { id: previous.id, tenantId: claim.tenantId, status: 'RUNNING' }, data: { status: 'FAILED_RETRYABLE', error: { code: 'LEASE_EXPIRED' }, completedAt: now, nextRetryAt: now } });
    const step = await tx.businessAssistantRunStep.create({ data: { tenantId: claim.tenantId, runItemId: claim.id, stage: stage as never, attemptNumber, status: 'RUNNING', inputArtifact: inputArtifact === undefined ? undefined : inputArtifact as never, claimToken: claim.token, claimGeneration: claim.generation, startedAt: now } });
    await tx.businessAssistantRunItem.updateMany({ where: { id: claim.id, tenantId: claim.tenantId, claimToken: claim.token, claimGeneration: claim.generation, ...leaseActive(now) }, data: { activeStage: stage as never, activeAttempt: attemptNumber } });
    return { id: step.id, stage, attemptNumber };
  });
}

export async function finishStageAttempt(claim: ClaimedItem, attempt: StageAttempt, status: 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_PERMANENT' | 'SKIPPED', outputArtifact?: unknown, error?: unknown): Promise<boolean> {
  return runSerializableTransaction(prisma, async (tx) => {
    const now = new Date();
    const item = await tx.businessAssistantRunItem.findFirst({ where: { id: claim.id, tenantId: claim.tenantId, claimToken: claim.token, claimGeneration: claim.generation, ...leaseActive(now) }, select: { id: true } });
    if (!item) return false;
    const updated = await tx.businessAssistantRunStep.updateMany({ where: { id: attempt.id, tenantId: claim.tenantId, runItemId: claim.id, claimToken: claim.token, claimGeneration: claim.generation, status: 'RUNNING' }, data: { status, ...(outputArtifact === undefined ? {} : { outputArtifact: outputArtifact as never }), ...(error === undefined ? {} : { error: error as never }), completedAt: now, nextRetryAt: status === 'FAILED_RETRYABLE' ? new Date(Date.now() + 30_000) : null } });
    if (updated.count !== 1) return false;
    await tx.businessAssistantRunItem.updateMany({ where: { id: claim.id, tenantId: claim.tenantId, claimToken: claim.token, claimGeneration: claim.generation, ...leaseActive(now) }, data: { activeAttempt: null } });
    return true;
  });
}

export class FencedClaimError extends Error {
  constructor() { super('The assistant claim is no longer current.'); this.name = 'FencedClaimError'; }
}

export class StageAttemptsExhaustedError extends Error {
  constructor(readonly stage: string) { super(`The ${stage} stage reached its retry limit.`); this.name = 'StageAttemptsExhaustedError'; }
}
