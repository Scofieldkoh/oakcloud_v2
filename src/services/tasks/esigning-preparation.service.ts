import {
  Prisma,
  TaskEsigningPreparationStatus,
  TaskStageActionType,
  TaskStageOutcomeType,
  type TaskStageStatus,
} from '@/generated/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  attachGeneratedDocumentToDraftEnvelope,
  createTaskPreparedEsigningEnvelope,
  detachGeneratedDocumentFromDraftEnvelope,
} from '@/services/esigning-envelope.service';
import type {
  TaskEsigningPreparationSnapshot,
} from './types';

export type { TaskEsigningPreparationSnapshot } from './types';

const log = createLogger('tasks:esigning-preparation');

const CLEARED_STAGE_STATUSES = new Set<TaskStageStatus>([
  'COMPLETED',
  'SKIPPED',
]);
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_LIMIT = 5;
const DEFAULT_CONCURRENCY = 2;

interface EligibilityStage {
  id: string;
  name: string;
  position: number;
  actionType: string;
  status: TaskStageStatus;
  outcome: {
    generatedDocumentId: string | null;
    generatedDocument: {
      id: string;
      title: string;
      status: string;
      companyId: string | null;
      deletedAt: Date | null;
    } | null;
  } | null;
}

export interface TaskEsigningPreparationEligibility {
  sourceStageId: string | null;
  generatedDocumentId: string | null;
  documentTitle: string | null;
  companyId: string | null;
  blockingStage: TaskEsigningPreparationSnapshot['blockingStage'];
  ready: boolean;
}

function snapshot(
  preparation: {
    id: string;
    taskId: string;
    taskStageId: string;
    status: TaskEsigningPreparationStatus;
    generatedDocumentId: string | null;
    esigningEnvelopeId: string | null;
    lastError: string | null;
  },
  blockingStage: TaskEsigningPreparationSnapshot['blockingStage'] = null,
): TaskEsigningPreparationSnapshot {
  return {
    id: preparation.id,
    taskId: preparation.taskId,
    taskStageId: preparation.taskStageId,
    status: preparation.status,
    blockingStage,
    generatedDocumentId: preparation.generatedDocumentId,
    esigningEnvelopeId: preparation.esigningEnvelopeId,
    lastError: preparation.lastError,
  };
}

async function loadTaskStages(
  tenantId: string,
  taskId: string,
): Promise<EligibilityStage[]> {
  return prisma.taskStage.findMany({
    where: {
      tenantId,
      taskId,
      task: { deletedAt: null },
    },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      name: true,
      position: true,
      actionType: true,
      status: true,
      outcome: {
        select: {
          generatedDocumentId: true,
          generatedDocument: {
            select: {
              id: true,
              title: true,
              status: true,
              companyId: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  }) as Promise<EligibilityStage[]>;
}

export async function resolveTaskEsigningPreparationEligibility(
  tenantId: string,
  taskId: string,
  taskStageId: string,
): Promise<TaskEsigningPreparationEligibility> {
  const stages = await loadTaskStages(tenantId, taskId);
  const targetIndex = stages.findIndex((stage) => stage.id === taskStageId);
  if (targetIndex < 0) throw new NotFoundError('E-signing task stage not found');

  const target = stages[targetIndex];
  if (target.actionType !== TaskStageActionType.ESIGNING) {
    throw new ValidationError('Task stage action must be ESIGNING');
  }

  let sourceIndex = -1;
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    if (stages[index]?.actionType === TaskStageActionType.DOCUMENT_GENERATION) {
      sourceIndex = index;
      break;
    }
  }

  if (sourceIndex < 0) {
    return {
      sourceStageId: null,
      generatedDocumentId: null,
      documentTitle: null,
      companyId: null,
      blockingStage: null,
      ready: false,
    };
  }

  const source = stages[sourceIndex];
  const document = source.outcome?.generatedDocument ?? null;
  const blocking = stages
    .slice(sourceIndex + 1, targetIndex)
    .find((stage) => !CLEARED_STAGE_STATUSES.has(stage.status));

  return {
    sourceStageId: source.id,
    generatedDocumentId: document?.id ?? source.outcome?.generatedDocumentId ?? null,
    documentTitle: document?.title ?? null,
    companyId: document?.companyId ?? null,
    blockingStage: blocking
      ? { id: blocking.id, name: blocking.name, status: blocking.status }
      : null,
    ready: Boolean(
      document
      && !document.deletedAt
      && document.status === 'FINALIZED'
      && !blocking,
    ),
  };
}

export async function ensureTaskEsigningPreparation(input: {
  tenantId: string;
  taskId: string;
  taskStageId: string;
  initiatedById?: string;
}): Promise<TaskEsigningPreparationSnapshot> {
  const eligibility = await resolveTaskEsigningPreparationEligibility(
    input.tenantId,
    input.taskId,
    input.taskStageId,
  );
  const availableAt = new Date();
  const existing = await prisma.taskEsigningPreparation.findUnique({
    where: { taskStageId: input.taskStageId },
    select: {
      initiatedById: true,
      status: true,
      generatedDocumentId: true,
      esigningEnvelopeId: true,
      envelopeDocumentId: true,
    },
  });
  const isAlreadyReady = Boolean(
    eligibility.ready
    && existing?.status === TaskEsigningPreparationStatus.READY
    && existing.generatedDocumentId === eligibility.generatedDocumentId
    && existing.esigningEnvelopeId
    && existing.envelopeDocumentId,
  );
  const requiresDetachment = Boolean(
    !eligibility.ready
    && existing?.esigningEnvelopeId
    && existing.envelopeDocumentId,
  );
  const status = isAlreadyReady
    ? TaskEsigningPreparationStatus.READY
    : eligibility.ready || requiresDetachment
      ? TaskEsigningPreparationStatus.QUEUED
      : TaskEsigningPreparationStatus.WAITING;
  const preparation = await prisma.taskEsigningPreparation.upsert({
    where: { taskStageId: input.taskStageId },
    create: {
      tenantId: input.tenantId,
      taskId: input.taskId,
      taskStageId: input.taskStageId,
      sourceTaskStageId: eligibility.sourceStageId,
      generatedDocumentId: eligibility.generatedDocumentId,
      initiatedById: input.initiatedById,
      status,
      availableAt,
    },
    update: {
      sourceTaskStageId: eligibility.sourceStageId,
      generatedDocumentId: eligibility.generatedDocumentId,
      status,
      availableAt,
      claimedAt: null,
      leaseExpiresAt: null,
      lastError: null,
      ...(!existing?.initiatedById && input.initiatedById
        ? { initiatedById: input.initiatedById }
        : {}),
    },
  });
  return snapshot(preparation, eligibility.blockingStage);
}

export async function getTaskEsigningPreparation(
  tenantId: string,
  taskId: string,
  taskStageId: string,
): Promise<TaskEsigningPreparationSnapshot | null> {
  const preparation = await prisma.taskEsigningPreparation.findFirst({
    where: { tenantId, taskId, taskStageId },
  });
  if (!preparation) return null;
  const eligibility = await resolveTaskEsigningPreparationEligibility(
    tenantId,
    taskId,
    taskStageId,
  );
  return snapshot(preparation, eligibility.blockingStage);
}

export async function retryTaskEsigningPreparation(
  tenantId: string,
  taskId: string,
  taskStageId: string,
): Promise<TaskEsigningPreparationSnapshot> {
  const preparation = await prisma.taskEsigningPreparation.findFirst({
    where: { tenantId, taskId, taskStageId },
  });
  if (!preparation) throw new NotFoundError('E-signing preparation not found');
  if (
    preparation.status !== TaskEsigningPreparationStatus.FAILED_RETRYABLE
    && !(
      preparation.status === TaskEsigningPreparationStatus.PROCESSING
      && preparation.leaseExpiresAt
      && preparation.leaseExpiresAt <= new Date()
    )
  ) {
    throw new ValidationError('E-signing preparation is not retryable');
  }
  const updated = await prisma.taskEsigningPreparation.update({
    where: { id: preparation.id },
    data: {
      status: TaskEsigningPreparationStatus.QUEUED,
      availableAt: new Date(),
      claimedAt: null,
      leaseExpiresAt: null,
      lastError: null,
    },
  });
  triggerQueuedTaskEsigningPreparationProcessing();
  return snapshot(updated);
}

export async function queueTaskEsigningPreparationsForTask(
  tenantId: string,
  taskId: string,
  initiatedById?: string,
): Promise<number> {
  const stages = await prisma.taskStage.findMany({
    where: {
      tenantId,
      taskId,
      actionType: TaskStageActionType.ESIGNING,
      task: { deletedAt: null },
    },
    select: { id: true },
  });
  await Promise.all(stages.map((stage) => ensureTaskEsigningPreparation({
    tenantId,
    taskId,
    taskStageId: stage.id,
    initiatedById,
  })));
  if (stages.length > 0) triggerQueuedTaskEsigningPreparationProcessing();
  return stages.length;
}

export async function queueTaskEsigningPreparationsForGeneratedDocument(
  tenantId: string,
  generatedDocumentId: string,
  initiatedById?: string,
): Promise<number> {
  const outcomes = await prisma.taskStageOutcome.findMany({
    where: { tenantId, generatedDocumentId },
    select: { taskStage: { select: { taskId: true } } },
  });
  const taskIds = Array.from(new Set(outcomes.map(({ taskStage }) => taskStage.taskId)));
  const counts = await Promise.all(taskIds.map((taskId) => (
    queueTaskEsigningPreparationsForTask(tenantId, taskId, initiatedById)
  )));
  return counts.reduce((sum, count) => sum + count, 0);
}

function retryDelay(attemptCount: number) {
  return Math.min(60 * 60_000, 5_000 * (2 ** Math.min(attemptCount, 8)));
}

function permanentPreparationError(error: unknown) {
  return error instanceof NotFoundError || error instanceof ValidationError;
}

async function finishClaim(
  preparation: {
    id: string;
    claimedAt: Date | null;
  },
  data: Prisma.TaskEsigningPreparationUncheckedUpdateManyInput,
) {
  await prisma.taskEsigningPreparation.updateMany({
    where: {
      id: preparation.id,
      status: TaskEsigningPreparationStatus.PROCESSING,
      claimedAt: preparation.claimedAt,
    },
    data,
  });
}

export async function processTaskEsigningPreparation(
  preparationId: string,
): Promise<TaskEsigningPreparationSnapshot> {
  const preparation = await prisma.taskEsigningPreparation.findUnique({
    where: { id: preparationId },
    include: {
      envelopeDocument: {
        select: { generatedDocumentId: true },
      },
    },
  });
  if (!preparation) throw new NotFoundError('E-signing preparation not found');

  try {
    const eligibility = await resolveTaskEsigningPreparationEligibility(
      preparation.tenantId,
      preparation.taskId,
      preparation.taskStageId,
    );

    if (!eligibility.ready || !eligibility.generatedDocumentId) {
      if (
        preparation.esigningEnvelopeId
        && preparation.envelopeDocumentId
        && preparation.generatedDocumentId
      ) {
        const attachedGeneratedDocumentId = (
          preparation.envelopeDocument?.generatedDocumentId
          ?? preparation.generatedDocumentId
        );
        await detachGeneratedDocumentFromDraftEnvelope({
          tenantId: preparation.tenantId,
          envelopeId: preparation.esigningEnvelopeId,
          generatedDocumentId: attachedGeneratedDocumentId,
          actorUserId: preparation.initiatedById ?? '',
        });
      }
      await finishClaim(preparation, {
        status: TaskEsigningPreparationStatus.WAITING,
        sourceTaskStageId: eligibility.sourceStageId,
        generatedDocumentId: eligibility.generatedDocumentId,
        envelopeDocumentId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        lastError: null,
      });
      return snapshot({
        ...preparation,
        status: TaskEsigningPreparationStatus.WAITING,
        generatedDocumentId: eligibility.generatedDocumentId,
        lastError: null,
      }, eligibility.blockingStage);
    }

    if (!preparation.initiatedById) {
      throw new ValidationError('E-signing preparation has no initiating user');
    }
    const envelopeId = preparation.esigningEnvelopeId ?? (
      await createTaskPreparedEsigningEnvelope({
        tenantId: preparation.tenantId,
        taskContext: {
          taskId: preparation.taskId,
          taskStageId: preparation.taskStageId,
        },
        createdById: preparation.initiatedById,
        title: eligibility.documentTitle ?? 'New Envelope',
        companyId: eligibility.companyId,
      })
    ).id;
    const { linkTaskStageOutcome } = await import('./stage.service');
    await linkTaskStageOutcome(
      preparation.tenantId,
      preparation.taskStageId,
      {
        type: TaskStageOutcomeType.ESIGNING_ENVELOPE,
        esigningEnvelopeId: envelopeId,
      },
      preparation.initiatedById,
    );
    const attachment = await attachGeneratedDocumentToDraftEnvelope({
      tenantId: preparation.tenantId,
      envelopeId,
      generatedDocumentId: eligibility.generatedDocumentId,
      actorUserId: preparation.initiatedById,
    });
    await finishClaim(preparation, {
      status: TaskEsigningPreparationStatus.READY,
      sourceTaskStageId: eligibility.sourceStageId,
      generatedDocumentId: eligibility.generatedDocumentId,
      esigningEnvelopeId: envelopeId,
      envelopeDocumentId: attachment.envelopeDocumentId,
      attemptCount: 0,
      claimedAt: null,
      leaseExpiresAt: null,
      lastError: null,
    });
    return snapshot({
      ...preparation,
      status: TaskEsigningPreparationStatus.READY,
      generatedDocumentId: eligibility.generatedDocumentId,
      esigningEnvelopeId: envelopeId,
      lastError: null,
    });
  } catch (error) {
    const attemptCount = preparation.attemptCount + 1;
    const status = permanentPreparationError(error)
      ? TaskEsigningPreparationStatus.FAILED_PERMANENT
      : TaskEsigningPreparationStatus.FAILED_RETRYABLE;
    await finishClaim(preparation, {
      status,
      attemptCount,
      availableAt: status === TaskEsigningPreparationStatus.FAILED_RETRYABLE
        ? new Date(Date.now() + retryDelay(attemptCount))
        : new Date(),
      claimedAt: null,
      leaseExpiresAt: null,
      lastError: error instanceof Error ? error.message : 'Unknown preparation failure',
    });
    log.warn('E-signing preparation failed', {
      preparationId,
      status,
      error,
    });
    return snapshot({
      ...preparation,
      status,
      lastError: error instanceof Error ? error.message : 'Unknown preparation failure',
    });
  }
}

async function runWithConcurrency<T>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<void>,
) {
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(values[index]);
      }
    },
  );
  await Promise.all(runners);
}

export async function processQueuedTaskEsigningPreparations(options: {
  limit?: number;
  concurrency?: number;
  leaseMs?: number;
} = {}): Promise<{ claimed: number; processed: number; failed: number }> {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const leaseMs = Math.max(30_000, options.leaseMs ?? DEFAULT_LEASE_MS);
  const claimedAt = new Date();
  const leaseExpiresAt = new Date(claimedAt.getTime() + leaseMs);
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH candidates AS (
      SELECT "id"
      FROM "task_esigning_preparations"
      WHERE (
        ("status" IN ('QUEUED', 'FAILED_RETRYABLE') AND "available_at" <= NOW())
        OR ("status" = 'PROCESSING' AND "lease_expires_at" <= NOW())
      )
      ORDER BY "available_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "task_esigning_preparations" AS preparation
    SET
      "status" = 'PROCESSING',
      "claimed_at" = ${claimedAt},
      "lease_expires_at" = ${leaseExpiresAt},
      "updated_at" = NOW()
    FROM candidates
    WHERE preparation."id" = candidates."id"
    RETURNING preparation."id"
  `);
  let processed = 0;
  let failed = 0;
  await runWithConcurrency(
    claimed,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async ({ id }) => {
      const result = await processTaskEsigningPreparation(id);
      processed += 1;
      if (
        result.status === TaskEsigningPreparationStatus.FAILED_RETRYABLE
        || result.status === TaskEsigningPreparationStatus.FAILED_PERMANENT
      ) {
        failed += 1;
      }
    },
  );
  return { claimed: claimed.length, processed, failed };
}

let immediateProcessing: Promise<unknown> | null = null;
let immediateProcessingRequested = false;

export function triggerQueuedTaskEsigningPreparationProcessing() {
  immediateProcessingRequested = true;
  if (immediateProcessing) return;
  immediateProcessing = (async () => {
    while (immediateProcessingRequested) {
      immediateProcessingRequested = false;
      await processQueuedTaskEsigningPreparations();
    }
  })()
    .catch((error) => {
      log.warn('Immediate E-signing preparation processing failed', { error });
    })
    .finally(() => {
      immediateProcessing = null;
      if (immediateProcessingRequested) {
        triggerQueuedTaskEsigningPreparationProcessing();
      }
    });
}

export async function assertGeneratedDocumentCanBeUnfinalized(
  tenantId: string,
  generatedDocumentId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const [activePreparation, activeLinkedDocument] = await Promise.all([
    client.taskEsigningPreparation.findFirst({
      where: {
        tenantId,
        generatedDocumentId,
        esigningEnvelope: {
          status: { notIn: ['DRAFT', 'VOIDED'] },
          deletedAt: null,
        },
      },
      select: { esigningEnvelopeId: true },
    }),
    client.esigningEnvelopeDocument.findFirst({
      where: {
        tenantId,
        generatedDocumentId,
        envelope: {
          status: { notIn: ['DRAFT', 'VOIDED'] },
          deletedAt: null,
        },
      },
      select: { envelopeId: true },
    }),
  ]);
  if (activePreparation || activeLinkedDocument) {
    throw new ValidationError(
      'Void the active E-signing envelope before unfinalizing this document',
    );
  }
}
