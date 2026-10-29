import { Prisma } from '@/generated/prisma';
import type { AssistantActor } from './conversation.service';
import { createLearningLifecycleMarker, decodeLearningActiveValue } from './learning-active-target';
import { learningTargetDefinition } from './learning-targets';

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * Erase candidates derived from a confirmed memory when that source memory is
 * deleted. This runs inside the memory deletion transaction so source deletion
 * and descendant cleanup are atomic. Both the active slot and the hidden
 * rollback slot are inspected so supersession cannot preserve data that a
 * later rollback would resurrect.
 */
export async function eraseLearningDerivedFromMemory(
  tx: Prisma.TransactionClient,
  actor: AssistantActor,
  memoryId: string,
): Promise<{ removedCandidates: number; deactivatedTargets: number }> {
  const changes = await tx.businessAssistantLearningChange.findMany({
    where: {
      tenantId: actor.tenantId,
      ownerId: actor.userId,
      AND: [
        { evidence: { path: ['source'], equals: 'CONFIRMED_MEMORY_FEEDBACK' } },
        { evidence: { path: ['memoryId'], equals: memoryId } },
      ],
    },
    select: { id: true, targetKey: true, baselineVersion: true, candidateVersion: true, state: true },
  });
  if (changes.length === 0) return { removedCandidates: 0, deactivatedTargets: 0 };

  const ids = new Set(changes.map((change) => change.id));
  // There are only a small, source-controlled number of learning targets. Read
  // the tenant set so a derived envelope restored from previousValue can be
  // found even when activeChangeId was intentionally cleared by rollback.
  const activeTargets = await tx.businessAssistantLearningActiveTarget.findMany({
    where: { tenantId: actor.tenantId },
  });
  let deactivatedTargets = 0;
  let scrubbedRollbackSlots = 0;
  for (const target of activeTargets) {
    const directPointerMatches = Boolean(target.activeChangeId && ids.has(target.activeChangeId));
    const definition = learningTargetDefinition(target.targetKey);
    if (!definition) {
      if (directPointerMatches) {
        throw new DerivedLearningCleanupError('ACTION_CONFLICT', 'A derived active learning target is no longer allowlisted.');
      }
      continue;
    }
    const activeDecoded = decodeLearningActiveValue(definition.targetKey, target.activeValue);
    if (!activeDecoded && directPointerMatches) {
      throw new DerivedLearningCleanupError('ACTION_CONFLICT', 'A derived active learning target is unreadable.');
    }
    const previousDecoded = target.previousValue === null
      ? null
      : decodeLearningActiveValue(definition.targetKey, target.previousValue);
    const activeEnvelopeMatches = Boolean(activeDecoded?.changeId && ids.has(activeDecoded.changeId));
    const previousEnvelopeMatches = Boolean(previousDecoded?.changeId && ids.has(previousDecoded.changeId));
    const activeDerived = directPointerMatches || activeEnvelopeMatches;
    if (!activeDerived && !previousEnvelopeMatches) continue;

    const update: Prisma.BusinessAssistantLearningActiveTargetUpdateManyMutationInput = {
      revision: { increment: 1 },
      updatedById: actor.userId,
    };
    if (activeDerived) {
      update.activeValue = jsonInput(createLearningLifecycleMarker(definition, 'DEACTIVATED', {
        changeId: null,
        valueDigest: null,
      }));
      update.activeChangeId = null;
      // The active derived version is no longer rollback-eligible. Remove the
      // slot entirely so stale lineage cannot be traversed after source erase.
      update.previousVersion = null;
      update.previousValue = Prisma.JsonNull;
      deactivatedTargets += 1;
      if (previousEnvelopeMatches) scrubbedRollbackSlots += 1;
    } else if (previousEnvelopeMatches) {
      // Keep the current unrelated active configuration, but replace its
      // rollback slot with the source-controlled default rather than deleted
      // derived data. A later rollback can therefore never restore the source.
      update.previousVersion = definition.defaultVersion;
      update.previousValue = jsonInput(definition.defaultValue);
      scrubbedRollbackSlots += 1;
    }

    const cas = await tx.businessAssistantLearningActiveTarget.updateMany({
      where: {
        id: target.id,
        tenantId: actor.tenantId,
        targetKey: definition.targetKey,
        activeVersion: target.activeVersion,
        activeChangeId: target.activeChangeId,
        revision: target.revision,
      },
      data: update,
    });
    if (cas.count !== 1) {
      throw new DerivedLearningCleanupError('ACTION_CONFLICT', 'A derived learning target changed during source deletion.');
    }
  }

  const scrubbed = await tx.businessAssistantLearningChange.updateMany({
    where: { tenantId: actor.tenantId, ownerId: actor.userId, id: { in: [...ids] } },
    data: {
      candidateValue: Prisma.JsonNull,
      evidence: jsonInput({ redacted: true, source: 'SOURCE_MEMORY_DELETION' }),
      evaluation: Prisma.JsonNull,
      state: 'REJECTED',
      approvedById: null,
      approvedAt: null,
      promotedAt: null,
      rollbackTarget: null,
      expectedVersion: { increment: 1 },
    },
  });
  if (scrubbed.count !== changes.length) {
    throw new DerivedLearningCleanupError('ACTION_CONFLICT', 'Derived learning descendants changed during source deletion.');
  }
  await tx.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'DELETE',
      entityType: 'BUSINESS_ASSISTANT_LEARNING_DERIVATION',
      entityId: memoryId,
      changeSource: 'MANUAL',
      summary: 'Erased learning candidates derived from a deleted preference memory',
      metadata: jsonInput({
        memoryId,
        removedCandidates: changes.map(({ id, targetKey, baselineVersion, candidateVersion, state }) => ({
          id,
          targetKey,
          baselineVersion,
          candidateVersion,
          state,
        })),
        deactivatedTargets,
        scrubbedRollbackSlots,
      }),
      requestId: actor.requestId,
    },
  });
  return { removedCandidates: changes.length, deactivatedTargets };
}

export class DerivedLearningCleanupError extends Error {
  constructor(readonly code: 'ACTION_CONFLICT', message: string) {
    super(message);
    this.name = 'DerivedLearningCleanupError';
  }
}
