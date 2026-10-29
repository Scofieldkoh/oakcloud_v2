import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import { acquireBusinessOperationBarrier } from '@/lib/business-operation-backup-barrier';
import { resolveFreshActor } from '@/lib/fresh-authorization';
import { canonicalizeJson } from './contracts';
import type { AssistantActor } from './conversation.service';
import { assertAssistantAdministrativeAccess } from './policy.service';
import { isDeletedLearningTarget } from './learning-active-target';
import { learningCandidateDigest } from './learning-behavioral-evaluator';
import { learningTargetDefinition } from './learning-targets';

const VERSION = /^v?[0-9]+(?:\.[0-9]+){0,2}$/;
const ADMIN_MESSAGE = 'Only a workspace administrator can derive tenant learning candidates.';

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function assertDerivationAdmin(actor: AssistantActor): Promise<void> {
  const access = await assertAssistantAdministrativeAccess(actor.userId, actor.tenantId);
  if (!access.isAdmin) throw new LearningDerivationError('FORBIDDEN', ADMIN_MESSAGE);
}

async function assertDerivationAdminInTransaction(actor: AssistantActor, tx: Prisma.TransactionClient): Promise<void> {
  await acquireBusinessOperationBarrier(tx, actor.tenantId, 'shared');
  const fresh = await resolveFreshActor({ userId: actor.userId, workspaceId: actor.tenantId }, tx);
  if (!fresh || !(fresh.isWorkspaceAdmin || fresh.isSuperAdmin || fresh.internalRole === 'ADMIN')) {
    throw new LearningDerivationError('FORBIDDEN', ADMIN_MESSAGE);
  }
  const backups = await tx.workspaceBackup.findMany({
    where: { tenantId: actor.tenantId, status: { in: ['RESTORING', 'COMPLETED'] } },
    select: { status: true, errorDetails: true },
  });
  const paused = backups.some((backup) => backup.status === 'RESTORING'
    || Boolean(backup.errorDetails && typeof backup.errorDetails === 'object' && !Array.isArray(backup.errorDetails)
      && (backup.errorDetails as Record<string, unknown>).businessAssistantDispatchPaused === true));
  if (paused) throw new LearningDerivationError('FORBIDDEN', 'The workspace is restoring and cannot accept new assistant work.');
}

export interface DerivedLearningCandidateDto {
  candidateId: string;
  targetKey: string;
  baselineVersion: string;
  candidateVersion: string;
  state: 'CANDIDATE';
  sourceMemoryId: string;
  sourceFeedbackId: string;
}

/**
 * Convert feedback into a learning candidate only when the feedback references
 * a preference memory that was already explicitly confirmed. Current-turn
 * style text, free-form feedback comments, and inferred/unconfirmed memories
 * can never supply the candidate value.
 */
export async function deriveLearningCandidateFromFeedback(
  actor: AssistantActor,
  feedbackId: string,
  candidateVersion: string,
): Promise<DerivedLearningCandidateDto> {
  await assertDerivationAdmin(actor);
  if (!VERSION.test(candidateVersion)) throw new LearningDerivationError('VALIDATION_FAILED', 'The candidate version is invalid.');
  return runSerializableTransaction(prisma, async (tx) => {
    await assertDerivationAdminInTransaction(actor, tx);
    const feedback = await tx.businessAssistantFeedback.findFirst({
      where: { id: feedbackId, tenantId: actor.tenantId, ownerId: actor.userId, targetType: 'MEMORY' },
      select: { id: true, targetId: true, eventType: true, adjudication: true },
    });
    if (!feedback) throw new LearningDerivationError('NOT_FOUND', 'The learning feedback source is unavailable.');
    if (feedback.eventType !== 'CORRECTNESS' && feedback.eventType !== 'OUTCOME') {
      throw new LearningDerivationError('VALIDATION_FAILED', 'Only correctness or outcome feedback on an explicitly confirmed preference can derive learning.');
    }
    const memory = await tx.businessAssistantMemory.findFirst({
      where: {
        id: feedback.targetId,
        tenantId: actor.tenantId,
        ownerId: actor.userId,
        state: 'ACTIVE',
        scope: { in: ['USER', 'TENANT'] },
      },
      select: { id: true, key: true, value: true, version: true, scope: true, capabilityId: true, capabilityVersion: true, expiresAt: true },
    });
    if (!memory) throw new LearningDerivationError('ACTION_CONFLICT', 'The feedback source preference is not currently confirmed and active.');
    if (memory.expiresAt && memory.expiresAt <= new Date()) throw new LearningDerivationError('ACTION_CONFLICT', 'The feedback source preference has expired.');
    if (memory.capabilityId && memory.capabilityId !== 'assistant.answer') throw new LearningDerivationError('VALIDATION_FAILED', 'The feedback source preference belongs to another capability.');
    if (memory.capabilityVersion && memory.capabilityVersion !== '1.0') throw new LearningDerivationError('VALIDATION_FAILED', 'The feedback source preference belongs to another capability version.');
    const definition = learningTargetDefinition(`assistant.${memory.key}`);
    if (!definition || definition.targetKind !== 'PREFERENCE') throw new LearningDerivationError('VALIDATION_FAILED', 'The confirmed preference is not an allowlisted learning target.');
    const parsedValue = definition.valueSchema.safeParse(memory.value);
    if (!parsedValue.success) throw new LearningDerivationError('VALIDATION_FAILED', 'The confirmed preference value is outside the learning target schema.');
    const target = await tx.businessAssistantLearningActiveTarget.findUnique({
      where: { tenantId_targetKey: { tenantId: actor.tenantId, targetKey: definition.targetKey } },
      select: { activeVersion: true, activeValue: true, revision: true },
    });
    if (target && isDeletedLearningTarget(definition.targetKey, target.activeValue)) {
      throw new LearningDerivationError('ACTION_CONFLICT', 'The learning target was deleted and cannot be recreated from derived data.');
    }
    const baselineVersion = target?.activeVersion ?? definition.defaultVersion;
    const baselineTargetRevision = target?.revision ?? 0;
    if (candidateVersion === baselineVersion) throw new LearningDerivationError('VALIDATION_FAILED', 'The candidate version must differ from the active baseline.');

    const prior = await tx.businessAssistantLearningChange.findFirst({
      where: {
        tenantId: actor.tenantId,
        ownerId: actor.userId,
        targetKey: definition.targetKey,
        candidateVersion,
        state: 'CANDIDATE',
        AND: [
          { evidence: { path: ['source'], equals: 'CONFIRMED_MEMORY_FEEDBACK' } },
          { evidence: { path: ['feedbackId'], equals: feedback.id } },
          { evidence: { path: ['memoryId'], equals: memory.id } },
        ],
      },
      select: { id: true, baselineVersion: true, candidateVersion: true, state: true },
    });
    if (prior) {
      return {
        candidateId: prior.id,
        targetKey: definition.targetKey,
        baselineVersion: prior.baselineVersion,
        candidateVersion: prior.candidateVersion,
        state: 'CANDIDATE',
        sourceMemoryId: memory.id,
        sourceFeedbackId: feedback.id,
      };
    }

    const evidence = canonicalizeJson({
      source: 'CONFIRMED_MEMORY_FEEDBACK',
      feedbackId: feedback.id,
      feedbackEventType: feedback.eventType,
      feedbackAdjudication: feedback.adjudication,
      memoryId: memory.id,
      memoryVersion: memory.version,
      memoryScope: memory.scope,
      governance: {
        schemaVersion: '1',
        targetKey: definition.targetKey,
        capabilityId: definition.capabilityId,
        capabilityVersion: definition.capabilityVersion,
        baselineTargetRevision,
      },
    });
    const created = await tx.businessAssistantLearningChange.create({
      data: {
        tenantId: actor.tenantId,
        ownerId: actor.userId,
        targetKey: definition.targetKey,
        targetKind: definition.targetKind,
        risk: 'LOW',
        baselineVersion,
        candidateVersion,
        candidateValue: jsonInput(canonicalizeJson(parsedValue.data)),
        evidence: jsonInput(evidence),
        expectedVersion: 1,
        state: 'CANDIDATE',
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'CREATE',
        entityType: 'BUSINESS_ASSISTANT_LEARNING_DERIVATION',
        entityId: created.id,
        changeSource: 'SYSTEM',
        summary: 'Derived governed learning candidate from confirmed preference feedback',
        metadata: jsonInput({
          targetKey: definition.targetKey,
          baselineVersion,
          baselineTargetRevision,
          candidateVersion,
          candidateDigest: learningCandidateDigest(created),
          sourceMemoryId: memory.id,
          sourceMemoryVersion: memory.version,
          sourceFeedbackId: feedback.id,
        }),
        requestId: actor.requestId,
      },
    });
    return {
      candidateId: created.id,
      targetKey: definition.targetKey,
      baselineVersion,
      candidateVersion,
      state: 'CANDIDATE',
      sourceMemoryId: memory.id,
      sourceFeedbackId: feedback.id,
    };
  });
}

export class LearningDerivationError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'FORBIDDEN' | 'NOT_FOUND' | 'ACTION_CONFLICT', message: string) {
    super(message);
    this.name = 'LearningDerivationError';
  }
}
