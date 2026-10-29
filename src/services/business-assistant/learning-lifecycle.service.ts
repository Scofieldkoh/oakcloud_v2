import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import { acquireBusinessOperationBarrier } from '@/lib/business-operation-backup-barrier';
import { resolveFreshActor } from '@/lib/fresh-authorization';
import type { AssistantActor } from './conversation.service';
import { assertAssistantAdministrativeAccess } from './policy.service';
import { learningTargetDefinition } from './learning-targets';
import {
  createLearningLifecycleMarker,
  decodeLearningActiveValue,
  type LearningActiveState,
} from './learning-active-target';

const ADMIN_MESSAGE = 'Only a workspace administrator can change tenant learning configuration.';
const PAUSED_MESSAGE = 'The workspace is restoring and cannot accept new assistant work.';

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function assertLifecycleAdmin(actor: AssistantActor): Promise<void> {
  const access = await assertAssistantAdministrativeAccess(actor.userId, actor.tenantId);
  if (!access.isAdmin) throw new LearningLifecycleError('FORBIDDEN', ADMIN_MESSAGE);
}

async function assertLifecycleAdminInTransaction(actor: AssistantActor, tx: Prisma.TransactionClient): Promise<void> {
  await acquireBusinessOperationBarrier(tx, actor.tenantId, 'shared');
  const fresh = await resolveFreshActor({ userId: actor.userId, workspaceId: actor.tenantId }, tx);
  if (!fresh || !(fresh.isWorkspaceAdmin || fresh.isSuperAdmin || fresh.internalRole === 'ADMIN')) {
    throw new LearningLifecycleError('FORBIDDEN', ADMIN_MESSAGE);
  }
  const backups = await tx.workspaceBackup.findMany({
    where: { tenantId: actor.tenantId, status: { in: ['RESTORING', 'COMPLETED'] } },
    select: { status: true, errorDetails: true },
  });
  const paused = backups.some((backup) => backup.status === 'RESTORING'
    || Boolean(backup.errorDetails && typeof backup.errorDetails === 'object' && !Array.isArray(backup.errorDetails)
      && (backup.errorDetails as Record<string, unknown>).businessAssistantDispatchPaused === true));
  if (paused) throw new LearningLifecycleError('FORBIDDEN', PAUSED_MESSAGE);
}

async function auditLifecycle(
  tx: Prisma.TransactionClient,
  actor: AssistantActor,
  action: 'UPDATE' | 'DELETE',
  entityId: string,
  summary: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action,
      entityType: 'BUSINESS_ASSISTANT_LEARNING_TARGET',
      entityId,
      changeSource: 'MANUAL',
      summary,
      metadata: jsonInput(metadata),
      requestId: actor.requestId,
    },
  });
}

export interface LearningTargetLifecycleDto {
  targetKey: string;
  activeVersion: string;
  revision: number;
  state: LearningActiveState;
  expiresAt: string | null;
  activeChangeId: string | null;
}

export async function getLearningTargetLifecycle(
  tenantId: string,
  targetKey: string,
  now = new Date(),
): Promise<LearningTargetLifecycleDto | null> {
  const definition = learningTargetDefinition(targetKey);
  if (!definition) return null;
  const target = await prisma.businessAssistantLearningActiveTarget.findUnique({
    where: { tenantId_targetKey: { tenantId, targetKey: definition.targetKey } },
    select: { activeVersion: true, activeValue: true, activeChangeId: true, revision: true },
  });
  if (!target) return null;
  const decoded = decodeLearningActiveValue(definition.targetKey, target.activeValue, now);
  if (!decoded) return null;
  return {
    targetKey: definition.targetKey,
    activeVersion: target.activeVersion,
    revision: target.revision,
    state: decoded.state,
    expiresAt: decoded.expiresAt?.toISOString() ?? null,
    activeChangeId: target.activeChangeId,
  };
}

async function transitionExistingTarget(
  actor: AssistantActor,
  targetKey: string,
  expectedRevision: number,
  nextState: 'DEACTIVATED' | 'EXPIRED',
  now: Date,
): Promise<LearningTargetLifecycleDto> {
  await assertLifecycleAdmin(actor);
  const definition = learningTargetDefinition(targetKey);
  if (!definition) throw new LearningLifecycleError('VALIDATION_FAILED', 'The learning target is not allowlisted.');
  return runSerializableTransaction(prisma, async (tx) => {
    await assertLifecycleAdminInTransaction(actor, tx);
    const target = await tx.businessAssistantLearningActiveTarget.findUnique({
      where: { tenantId_targetKey: { tenantId: actor.tenantId, targetKey: definition.targetKey } },
    });
    if (!target) throw new LearningLifecycleError('NOT_FOUND', 'The active learning target does not exist.');
    if (target.revision !== expectedRevision) throw new LearningLifecycleError('ACTION_CONFLICT', 'The learning target changed; refresh before applying this lifecycle action.');
    const decoded = decodeLearningActiveValue(definition.targetKey, target.activeValue, now);
    if (!decoded) throw new LearningLifecycleError('ACTION_CONFLICT', 'The active learning target is unreadable and cannot be changed safely.');
    if (nextState === 'DEACTIVATED' && decoded.state !== 'ACTIVE') {
      throw new LearningLifecycleError('ACTION_CONFLICT', 'Only an active learning target can be deactivated.');
    }
    if (nextState === 'EXPIRED' && decoded.state !== 'EXPIRED') {
      throw new LearningLifecycleError('ACTION_CONFLICT', 'The learning target has not reached its governed expiry time.');
    }
    const marker = createLearningLifecycleMarker(definition, nextState, {
      valueDigest: decoded.valueDigest,
      changeId: decoded.changeId,
      lifecycleAt: now,
    });
    const cas = await tx.businessAssistantLearningActiveTarget.updateMany({
      where: {
        id: target.id,
        tenantId: actor.tenantId,
        targetKey: definition.targetKey,
        activeVersion: target.activeVersion,
        revision: expectedRevision,
      },
      data: {
        activeValue: jsonInput(marker),
        activeChangeId: null,
        revision: { increment: 1 },
        updatedById: actor.userId,
      },
    });
    if (cas.count !== 1) throw new LearningLifecycleError('ACTION_CONFLICT', 'The learning target changed during the lifecycle transition.');
    await auditLifecycle(tx, actor, 'UPDATE', target.id, nextState === 'EXPIRED' ? 'Expired governed learning configuration' : 'Deactivated governed learning configuration', {
      lifecycleAction: nextState,
      targetKey: definition.targetKey,
      activeVersion: target.activeVersion,
      previousRevision: expectedRevision,
      revision: expectedRevision + 1,
      sourceChangeId: target.activeChangeId,
    });
    return {
      targetKey: definition.targetKey,
      activeVersion: target.activeVersion,
      revision: expectedRevision + 1,
      state: nextState,
      expiresAt: null,
      activeChangeId: null,
    };
  });
}

export async function deactivateLearningConfiguration(
  actor: AssistantActor,
  targetKey: string,
  expectedRevision: number,
  now = new Date(),
): Promise<LearningTargetLifecycleDto> {
  return transitionExistingTarget(actor, targetKey, expectedRevision, 'DEACTIVATED', now);
}

export async function expireLearningConfiguration(
  actor: AssistantActor,
  targetKey: string,
  expectedRevision: number,
  now = new Date(),
): Promise<LearningTargetLifecycleDto> {
  return transitionExistingTarget(actor, targetKey, expectedRevision, 'EXPIRED', now);
}

export async function deleteLearningConfiguration(
  actor: AssistantActor,
  targetKey: string,
  expectedRevision: number,
  now = new Date(),
): Promise<LearningTargetLifecycleDto> {
  await assertLifecycleAdmin(actor);
  const definition = learningTargetDefinition(targetKey);
  if (!definition) throw new LearningLifecycleError('VALIDATION_FAILED', 'The learning target is not allowlisted.');
  return runSerializableTransaction(prisma, async (tx) => {
    await assertLifecycleAdminInTransaction(actor, tx);
    const target = await tx.businessAssistantLearningActiveTarget.findUnique({
      where: { tenantId_targetKey: { tenantId: actor.tenantId, targetKey: definition.targetKey } },
    });
    if ((target?.revision ?? 0) !== expectedRevision) {
      throw new LearningLifecycleError('ACTION_CONFLICT', 'The learning target changed; refresh before deleting it.');
    }
    const lineage = await tx.businessAssistantLearningChange.findMany({
      where: { tenantId: actor.tenantId, targetKey: definition.targetKey },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, ownerId: true, baselineVersion: true, candidateVersion: true, state: true },
    });
    const marker = createLearningLifecycleMarker(definition, 'DELETED', { lifecycleAt: now });
    let targetId: string;
    let revision: number;
    if (target) {
      const cas = await tx.businessAssistantLearningActiveTarget.updateMany({
        where: { id: target.id, tenantId: actor.tenantId, targetKey: definition.targetKey, revision: expectedRevision },
        data: {
          activeValue: jsonInput(marker),
          previousVersion: null,
          previousValue: Prisma.JsonNull,
          activeChangeId: null,
          revision: { increment: 1 },
          updatedById: actor.userId,
        },
      });
      if (cas.count !== 1) throw new LearningLifecycleError('ACTION_CONFLICT', 'The learning target changed during deletion.');
      targetId = target.id;
      revision = expectedRevision + 1;
    } else {
      const created = await tx.businessAssistantLearningActiveTarget.create({
        data: {
          tenantId: actor.tenantId,
          targetKey: definition.targetKey,
          activeVersion: definition.defaultVersion,
          activeValue: jsonInput(marker),
          previousVersion: null,
          previousValue: Prisma.JsonNull,
          activeChangeId: null,
          updatedById: actor.userId,
        },
      });
      targetId = created.id;
      revision = created.revision;
    }

    await tx.businessAssistantLearningChange.updateMany({
      where: { tenantId: actor.tenantId, targetKey: definition.targetKey },
      data: {
        candidateValue: Prisma.JsonNull,
        evidence: jsonInput({ redacted: true, source: 'TARGET_DELETION' }),
        evaluation: Prisma.JsonNull,
        state: 'REJECTED',
        approvedById: null,
        approvedAt: null,
        promotedAt: null,
        rollbackTarget: null,
        expectedVersion: { increment: 1 },
      },
    });
    await auditLifecycle(tx, actor, 'DELETE', targetId, 'Deleted governed learning configuration and derived candidate payloads', {
      lifecycleAction: 'DELETE',
      targetKey: definition.targetKey,
      previousRevision: expectedRevision,
      revision,
      retainedLineage: lineage,
      removedCandidatePayloadCount: lineage.length,
    });
    return {
      targetKey: definition.targetKey,
      activeVersion: target?.activeVersion ?? definition.defaultVersion,
      revision,
      state: 'DELETED',
      expiresAt: null,
      activeChangeId: null,
    };
  });
}

export class LearningLifecycleError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'FORBIDDEN' | 'NOT_FOUND' | 'ACTION_CONFLICT', message: string) {
    super(message);
    this.name = 'LearningLifecycleError';
  }
}
