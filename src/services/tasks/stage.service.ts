import {
  Prisma,
  TaskStageActionType,
  TaskStageOutcomeType,
  TaskStageStatus,
  type TaskStageOutcome,
  type TaskStageStatus as TaskStageStatusValue,
  type TaskStatus as TaskStatusValue,
} from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  taskStageChecklistUpdateSchema,
  taskStageMetadataSchema,
  taskStageOutcomeSchema,
  taskStageSkipSchema,
  type TaskStageOutcomeInput,
} from '@/lib/validations/task';
import {
  assertOutcomeMatchesAction,
  getStageActionAdapter,
  readDocumentStageTemplateIds,
  resolveStageActionOutcome,
} from './action-registry';
import { resolveTemplateIdsForNewRun } from '@/services/oakdoc-migration.service';
import { deriveTaskStatus } from './status';
import { lockTaskForUpdate } from './locking';
import { queueTaskEsigningPreparationsForTask } from './esigning-preparation.service';
import type { ResolvedStageOutcome } from './types';

const log = createLogger('tasks:stage');

async function safelyQueueTaskEsigningPreparation(
  tenantId: string,
  taskId: string,
  userId?: string,
) {
  try {
    await queueTaskEsigningPreparationsForTask(tenantId, taskId, userId);
  } catch (error) {
    log.warn('Failed to queue E-signing preparation after task-stage change', {
      taskId,
      error,
    });
  }
}

async function findDocumentGenerationBatchId(
  tenantId: string,
  generatedDocumentId: string,
) {
  const batchItem = await prisma.documentGenerationBatchItem.findFirst({
    where: {
      tenantId,
      generatedDocumentId,
      batch: { tenantId, deletedAt: null },
    },
    select: { batchId: true },
  });
  return batchItem?.batchId ?? null;
}

async function findTaskLinkedDocumentId(
  tenantId: string,
  taskId: string,
  taskStageId: string,
) {
  const batch = await prisma.documentGenerationBatch.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      AND: [
        { taskContext: { path: ['taskId'], equals: taskId } },
        { taskContext: { path: ['taskStageId'], equals: taskStageId } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      items: {
        where: { generatedDocument: { deletedAt: null } },
        orderBy: { displayOrder: 'asc' },
        take: 1,
        select: { generatedDocumentId: true },
      },
    },
  });
  return batch?.items[0]?.generatedDocumentId ?? null;
}

const stageDetailInclude = {
  task: {
    select: {
      id: true,
      status: true,
      companyId: true,
      deletedAt: true,
    },
  },
  assignee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
  outcome: true,
  checklistItems: { orderBy: { position: 'asc' as const } },
} satisfies Prisma.TaskStageInclude;

function hasLinkedOutcomeEntity(outcome: {
  companyId?: string | null;
  generatedDocumentId?: string | null;
  esigningEnvelopeId?: string | null;
}) {
  return Boolean(
    outcome.companyId
    || outcome.generatedDocumentId
    || outcome.esigningEnvelopeId,
  );
}

interface LockedCompanyRecoveryContext {
  taskId: string;
  companyId: string | null;
}

async function lockCompanyRecoveryContext(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
  taskStageId: string,
) {
  const rows = await tx.$queryRaw<LockedCompanyRecoveryContext[]>(Prisma.sql`
    SELECT
      task_id AS "taskId",
      company_id AS "companyId"
    FROM task_company_recovery_contexts
    WHERE tenant_id = ${tenantId}
      AND task_id = ${taskId}
      AND task_stage_id = ${taskStageId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

export async function getTaskStageDetail(
  tenantId: string,
  taskId: string,
  stageId: string,
  actorUserId?: string,
) {
  let stage = await prisma.taskStage.findFirst({
    where: {
      id: stageId,
      taskId,
      tenantId,
      task: { deletedAt: null },
    },
    include: stageDetailInclude,
  });
  if (!stage) throw new NotFoundError('Task stage not found');

  const synchronizedCompanyOutcome = (
    stage.status !== TaskStageStatus.SKIPPED
    && stage.actionType === TaskStageActionType.COMPANY_PROFILE
  )
    ? await synchronizeCompanyOutcomeWithRecovery(
      tenantId,
      stage.id,
      actorUserId,
    )
    : false;
  if (synchronizedCompanyOutcome) {
    stage = await prisma.taskStage.findFirst({
      where: {
        id: stageId,
        taskId,
        tenantId,
        task: { deletedAt: null },
      },
      include: stageDetailInclude,
    });
    if (!stage) throw new NotFoundError('Task stage not found');
  }

  const recovered = stage.status !== TaskStageStatus.SKIPPED && !stage.outcome
    ? await recoverTaskStageOutcomeFromDurableContext(tenantId, stage)
    : false;
  if (
    stage.status !== TaskStageStatus.SKIPPED
    && (stage.outcome || recovered)
    && !synchronizedCompanyOutcome
  ) {
    await reconcileTaskStageOutcome(tenantId, stage.id, actorUserId);
    stage = await prisma.taskStage.findFirst({
      where: {
        id: stageId,
        taskId,
        tenantId,
        task: { deletedAt: null },
      },
      include: stageDetailInclude,
    });
    if (!stage) throw new NotFoundError('Task stage not found');
  }

  // A deleted document can leave a SetNull outcome row behind. Once the
  // normal reconciliation marks that stale link as failed, use any newer
  // task-linked batch as the replacement durable outcome.
  if (
    !recovered
    && stage.status === TaskStageStatus.FAILED
    && stage.actionType === TaskStageActionType.DOCUMENT_GENERATION
    && stage.outcome?.type === TaskStageOutcomeType.GENERATED_DOCUMENT
  ) {
    const relinked = await recoverTaskStageOutcomeFromDurableContext(tenantId, stage);
    if (relinked) {
      await reconcileTaskStageOutcome(tenantId, stage.id, actorUserId);
      stage = await prisma.taskStage.findFirst({
        where: {
          id: stageId,
          taskId,
          tenantId,
          task: { deletedAt: null },
        },
        include: stageDetailInclude,
      });
      if (!stage) throw new NotFoundError('Task stage not found');
    }
  }

  const adapter = getStageActionAdapter(stage.actionType);
  const generatedDocumentId = (
    stage.outcome?.type === TaskStageOutcomeType.GENERATED_DOCUMENT
      ? stage.outcome.generatedDocumentId
      : null
  );
  const documentGenerationBatchId = (
    stage.status === TaskStageStatus.IN_PROGRESS && generatedDocumentId
  )
    ? await findDocumentGenerationBatchId(tenantId, generatedDocumentId)
    : null;
  const configuredTemplateIds = (
    stage.actionType === TaskStageActionType.DOCUMENT_GENERATION && !generatedDocumentId
  )
    ? readDocumentStageTemplateIds(stage.actionConfig)
    : undefined;
  const adapterContext = {
    tenantId,
    resolvedTemplateIds: configuredTemplateIds
      ? await resolveTemplateIdsForNewRun(configuredTemplateIds, tenantId)
      : undefined,
    stage: {
      ...stage,
      outcome: stage.outcome
        ? { ...stage.outcome, documentGenerationBatchId }
        : stage.outcome,
    },
  };
  let resolvedOutcome: ResolvedStageOutcome | null = null;
  let outcomeUnavailable = false;

  if (stage.outcome) {
    if (!hasLinkedOutcomeEntity(stage.outcome)) {
      outcomeUnavailable = true;
    } else {
      const parsed = taskStageOutcomeSchema.parse({
        type: stage.outcome.type,
        companyId: stage.outcome.companyId,
        generatedDocumentId: stage.outcome.generatedDocumentId,
        esigningEnvelopeId: stage.outcome.esigningEnvelopeId,
      });
      try {
        resolvedOutcome = await resolveAuthoritativeOutcome(prisma, tenantId, parsed);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
        outcomeUnavailable = true;
      }
    }
  }

  return {
    ...stage,
    startedAt: stage.startedAt?.toISOString() ?? null,
    completedAt: stage.completedAt?.toISOString() ?? null,
    ...(outcomeUnavailable ? { status: TaskStageStatus.FAILED } : {}),
    blockers: adapter.blockers(adapterContext),
    launch: adapter.launch(adapterContext),
    outcomeSummary: adapter.outcomeSummary(resolvedOutcome),
  };
}

export async function synchronizeCompanyOutcomeWithRecovery(
  tenantId: string,
  stageId: string,
  userId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const stage = await requireStage(tx, tenantId, stageId);
    if (stage.status === TaskStageStatus.SKIPPED) return false;
    if (stage.actionType !== TaskStageActionType.COMPANY_PROFILE) {
      return false;
    }
    const lockedTask = await lockTaskForUpdate(tx, tenantId, stage.taskId);
    const recovery = await lockCompanyRecoveryContext(
      tx,
      tenantId,
      stage.taskId,
      stage.id,
    );
    if (
      !recovery
      || recovery.taskId !== stage.taskId
      || (
        Boolean(stage.outcome)
        && recovery.companyId === stage.outcome?.companyId
      )
    ) {
      return false;
    }

    const company = recovery.companyId
      ? await tx.company.findFirst({
        where: { id: recovery.companyId, tenantId },
        select: { id: true, name: true, deletedAt: true },
      })
      : null;
    if (recovery.companyId && !company) {
      return false;
    }

    await tx.taskStageOutcome.upsert({
      where: { taskStageId: stage.id },
      create: {
        tenantId,
        taskStageId: stage.id,
        type: TaskStageOutcomeType.COMPANY,
        companyId: company?.id ?? null,
      },
      update: {
        type: TaskStageOutcomeType.COMPANY,
        companyId: company?.id ?? null,
        generatedDocumentId: null,
        esigningEnvelopeId: null,
      },
    });
    if (lockedTask.companyId !== (company?.id ?? null)) {
      await tx.task.update({
        where: { id: stage.taskId },
        data: { companyId: company?.id ?? null },
      });
    }

    const status = !company || company.deletedAt
      ? TaskStageStatus.FAILED
      : TaskStageStatus.COMPLETED;
    const now = new Date();
    await tx.taskStage.update({
      where: { id: stage.id },
      data: {
        status,
        startedAt: stage.startedAt ?? now,
        completedAt: status === TaskStageStatus.COMPLETED ? now : null,
      },
    });
    const taskStatus = await updateParentTaskStatus(
      tx,
      tenantId,
      stage.taskId,
      lockedTask.status,
    );
    await auditStageMutation(tx, {
      tenantId,
      userId,
      stageId: stage.id,
      companyId: company?.id ?? null,
      summary: !company
        ? 'Recovered Company outcome was permanently deleted'
        : company.deletedAt
        ? 'Recovered Company outcome is no longer available'
        : `Recovered Company outcome: ${company.name}`,
      metadata: {
        previousCompanyId: stage.outcome?.companyId ?? null,
        companyId: company?.id ?? null,
        status,
        taskStatus,
      },
    });
    return true;
  });
}

export async function recoverTaskStageOutcomeFromDurableContext(
  tenantId: string,
  stage: {
    id: string;
    taskId: string;
    actionType: TaskStageActionType;
    status?: TaskStageStatusValue;
  },
) {
  if (stage.status === TaskStageStatus.SKIPPED) return false;
  const contextFilter = {
    path: ['taskStageId'],
    equals: stage.id,
  } as const;
  const metadataContextFilter = {
    path: ['taskIntegrationContext', 'taskStageId'],
    equals: stage.id,
  } as const;

  if (stage.actionType === TaskStageActionType.COMPANY_PROFILE) {
    const recovery = await prisma.taskCompanyRecoveryContext.findFirst({
      where: {
        tenantId,
        taskId: stage.taskId,
        taskStageId: stage.id,
        taskStage: {
          actionType: TaskStageActionType.COMPANY_PROFILE,
          taskId: stage.taskId,
          tenantId,
        },
        company: { deletedAt: null, tenantId },
      },
      select: {
        taskId: true,
        company: { select: { id: true } },
      },
    });
    const company = (
      recovery?.taskId === stage.taskId
        ? recovery.company
        : null
    ) ?? await prisma.company.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        taskIntegrationContext: contextFilter,
      },
      select: { id: true },
    });
    if (!company) return false;
    await linkTaskStageOutcome(tenantId, stage.id, {
      type: TaskStageOutcomeType.COMPANY,
      companyId: company.id,
    });
    return true;
  }
  if (stage.actionType === TaskStageActionType.DOCUMENT_GENERATION) {
    const batchDocumentId = await findTaskLinkedDocumentId(
      tenantId,
      stage.taskId,
      stage.id,
    );
    if (batchDocumentId) {
      await linkTaskStageOutcome(tenantId, stage.id, {
        type: TaskStageOutcomeType.GENERATED_DOCUMENT,
        generatedDocumentId: batchDocumentId,
      });
      return true;
    }
    const document = await prisma.generatedDocument.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        metadata: metadataContextFilter,
      },
      select: { id: true },
    });
    if (!document) return false;
    await linkTaskStageOutcome(tenantId, stage.id, {
      type: TaskStageOutcomeType.GENERATED_DOCUMENT,
      generatedDocumentId: document.id,
    });
    return true;
  }
  if (stage.actionType === TaskStageActionType.ESIGNING) {
    const envelope = await prisma.esigningEnvelope.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        metadata: metadataContextFilter,
      },
      select: { id: true },
    });
    if (!envelope) return false;
    await linkTaskStageOutcome(tenantId, stage.id, {
      type: TaskStageOutcomeType.ESIGNING_ENVELOPE,
      esigningEnvelopeId: envelope.id,
    });
    return true;
  }
  return false;
}

async function requireStage(
  tx: Prisma.TransactionClient,
  tenantId: string,
  stageId: string,
) {
  const stage = await tx.taskStage.findFirst({
    where: {
      id: stageId,
      tenantId,
      task: { deletedAt: null },
    },
    include: {
      task: { select: { id: true, status: true, companyId: true, deletedAt: true } },
      outcome: true,
      checklistItems: { orderBy: { position: 'asc' } },
    },
  });
  if (!stage) throw new NotFoundError('Task stage not found');
  return stage;
}

async function requireStageTaskId(
  tx: Prisma.TransactionClient,
  tenantId: string,
  stageId: string,
) {
  const stage = await tx.taskStage.findFirst({
    where: {
      id: stageId,
      tenantId,
      task: { deletedAt: null },
    },
    select: { taskId: true },
  });
  if (!stage) throw new NotFoundError('Task stage not found');
  return stage.taskId;
}

async function updateParentTaskStatus(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
  currentStatus: Parameters<typeof deriveTaskStatus>[1],
) {
  const stages = await tx.taskStage.findMany({
    where: { tenantId, taskId },
    select: { status: true },
  });
  const status = deriveTaskStatus(stages, currentStatus);
  if (status !== currentStatus) {
    await tx.task.update({
      where: { id: taskId },
      data: { status },
    });
  }
  return status;
}

async function auditStageMutation(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    userId?: string;
    stageId: string;
    companyId?: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
    reason?: string;
  },
) {
  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    companyId: params.companyId ?? undefined,
    action: 'UPDATE',
    entityType: 'TaskStage',
    entityId: params.stageId,
    summary: params.summary,
    metadata: params.metadata,
    reason: params.reason,
  }, tx);
}

export interface SynchronizeCompanyProfileStagesInput {
  tenantId: string;
  taskId: string;
  companyId: string | null;
  currentTaskStatus: TaskStatusValue;
  userId?: string;
}

export interface SynchronizeCompanyProfileStagesResult {
  taskStatus: TaskStatusValue;
  outcomesByStageId: Map<string, TaskStageOutcome>;
}

export async function synchronizeCompanyProfileStages(
  tx: Prisma.TransactionClient,
  input: SynchronizeCompanyProfileStagesInput,
): Promise<SynchronizeCompanyProfileStagesResult> {
  const stages = await tx.taskStage.findMany({
    where: {
      tenantId: input.tenantId,
      taskId: input.taskId,
      actionType: TaskStageActionType.COMPANY_PROFILE,
      status: { not: TaskStageStatus.SKIPPED },
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      outcome: { select: { companyId: true } },
    },
  });
  const outcomesByStageId = new Map<string, TaskStageOutcome>();
  const now = new Date();

  for (const stage of stages) {
    if (input.companyId) {
      const changedCompany = stage.outcome?.companyId !== input.companyId;
      const newlyCompleted = stage.status !== TaskStageStatus.COMPLETED;
      const outcome = await tx.taskStageOutcome.upsert({
        where: { taskStageId: stage.id },
        create: {
          tenantId: input.tenantId,
          taskStageId: stage.id,
          type: TaskStageOutcomeType.COMPANY,
          companyId: input.companyId,
        },
        update: {
          type: TaskStageOutcomeType.COMPANY,
          companyId: input.companyId,
          generatedDocumentId: null,
          esigningEnvelopeId: null,
        },
      });
      outcomesByStageId.set(stage.id, outcome);
      await tx.taskCompanyRecoveryContext.upsert({
        where: {
          tenantId_taskStageId: {
            tenantId: input.tenantId,
            taskStageId: stage.id,
          },
        },
        create: {
          tenantId: input.tenantId,
          taskId: input.taskId,
          taskStageId: stage.id,
          companyId: input.companyId,
        },
        update: { companyId: input.companyId },
      });
      await tx.taskStage.update({
        where: { id: stage.id },
        data: {
          status: TaskStageStatus.COMPLETED,
          startedAt: stage.startedAt ?? now,
          completedAt: changedCompany || newlyCompleted
            ? now
            : stage.completedAt ?? now,
        },
      });
      if (changedCompany || newlyCompleted) {
        await auditStageMutation(tx, {
          tenantId: input.tenantId,
          userId: input.userId,
          stageId: stage.id,
          companyId: input.companyId,
          summary: 'Synchronized Company Profile outcome with task company',
          metadata: {
            previousCompanyId: stage.outcome?.companyId ?? null,
            companyId: input.companyId,
            status: TaskStageStatus.COMPLETED,
          },
        });
      }
      continue;
    }

    await tx.taskStageOutcome.deleteMany({
      where: { tenantId: input.tenantId, taskStageId: stage.id },
    });
    await tx.taskCompanyRecoveryContext.deleteMany({
      where: {
        tenantId: input.tenantId,
        taskId: input.taskId,
        taskStageId: stage.id,
      },
    });
    await tx.taskStage.update({
      where: { id: stage.id },
      data: {
        status: TaskStageStatus.NOT_STARTED,
        startedAt: null,
        completedAt: null,
        skipReason: null,
      },
    });
    if (stage.outcome || stage.status !== TaskStageStatus.NOT_STARTED) {
      await auditStageMutation(tx, {
        tenantId: input.tenantId,
        userId: input.userId,
        stageId: stage.id,
        companyId: null,
        summary: 'Cleared Company Profile outcome with task company',
        metadata: {
          previousCompanyId: stage.outcome?.companyId ?? null,
          companyId: null,
          status: TaskStageStatus.NOT_STARTED,
        },
      });
    }
  }

  await tx.task.update({
    where: { id: input.taskId },
    data: { companyId: input.companyId },
  });
  const taskStatus = await updateParentTaskStatus(
    tx,
    input.tenantId,
    input.taskId,
    input.currentTaskStatus,
  );
  return { taskStatus, outcomesByStageId };
}

export async function updateTaskStageMetadata(
  tenantId: string,
  stageId: string,
  input: { notes?: string | null; assigneeId?: string | null },
  userId?: string,
) {
  const parsed = taskStageMetadataSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const stage = await requireStage(tx, tenantId, stageId);
    await lockTaskForUpdate(tx, tenantId, stage.taskId);
    if (parsed.assigneeId) {
      const assignee = await tx.user.findFirst({
        where: {
          id: parsed.assigneeId,
          tenantId,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
      if (!assignee) throw new NotFoundError('Stage assignee not found');
    }
    const updated = await tx.taskStage.update({
      where: { id: stage.id },
      data: parsed,
    });
    await auditStageMutation(tx, {
      tenantId,
      userId,
      stageId: stage.id,
      companyId: stage.task.companyId,
      summary: `Updated task stage "${stage.name}"`,
    });
    return updated;
  });
}

export async function updateTaskStageChecklistItem(
  tenantId: string,
  checklistItemId: string,
  input: { isCompleted: boolean },
  userId?: string,
) {
  const parsed = taskStageChecklistUpdateSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const item = await tx.taskStageChecklistItem.findFirst({
      where: {
        id: checklistItemId,
        tenantId,
        taskStage: { task: { deletedAt: null } },
      },
      include: {
        taskStage: {
          include: {
            task: { select: { companyId: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundError('Task stage checklist item not found');
    await lockTaskForUpdate(tx, tenantId, item.taskStage.taskId);
    const updated = await tx.taskStageChecklistItem.update({
      where: { id: item.id },
      data: {
        isCompleted: parsed.isCompleted,
        completedAt: parsed.isCompleted ? new Date() : null,
      },
    });
    await auditStageMutation(tx, {
      tenantId,
      userId,
      stageId: item.taskStageId,
      companyId: item.taskStage.task.companyId,
      summary: `${parsed.isCompleted ? 'Completed' : 'Reopened'} checklist item "${item.label}"`,
      metadata: { checklistItemId: item.id, isCompleted: parsed.isCompleted },
    });
    return updated;
  });
}

async function setStageStatus(
  tenantId: string,
  stageId: string,
  status: TaskStageStatusValue,
  userId?: string,
  reason?: string,
  manualOnly = false,
) {
  let taskId: string | null = null;
  const result = await prisma.$transaction(async (tx) => {
    const stage = await requireStage(tx, tenantId, stageId);
    taskId = stage.taskId;
    const lockedTask = await lockTaskForUpdate(tx, tenantId, stage.taskId);
    if (
      manualOnly
      && stage.actionType !== TaskStageActionType.MANUAL
      && !(status === TaskStageStatus.NOT_STARTED && stage.status === TaskStageStatus.SKIPPED)
    ) {
      throw new ValidationError('Only MANUAL task stages support manual completion or reopening');
    }
    if (status === TaskStageStatus.SKIPPED && stage.isRequired) {
      throw new ValidationError('Required task stages cannot be skipped');
    }
    const now = new Date();
    const updated = await tx.taskStage.update({
      where: { id: stage.id },
      data: {
        status,
        ...(status === TaskStageStatus.SKIPPED ? { skipReason: reason } : {}),
        ...(status === TaskStageStatus.COMPLETED
          ? { startedAt: stage.startedAt ?? now, completedAt: now, skipReason: null }
          : {}),
        ...(status === TaskStageStatus.NOT_STARTED
          ? { startedAt: null, completedAt: null, skipReason: null }
          : {}),
      },
    });
    const taskStatus = await updateParentTaskStatus(
      tx,
      tenantId,
      stage.taskId,
      lockedTask.status,
    );
    await auditStageMutation(tx, {
      tenantId,
      userId,
      stageId: stage.id,
      companyId: stage.task.companyId,
      summary: `Changed task stage status to ${status}`,
      metadata: { previousStatus: stage.status, status, taskStatus },
      reason,
    });
    return updated;
  });
  if (taskId) {
    await safelyQueueTaskEsigningPreparation(tenantId, taskId, userId);
  }
  return result;
}

export const completeTaskStage = (
  tenantId: string,
  stageId: string,
  userId?: string,
) => setStageStatus(
  tenantId,
  stageId,
  TaskStageStatus.COMPLETED,
  userId,
  undefined,
  true,
);

export const reopenTaskStage = (
  tenantId: string,
  stageId: string,
  userId?: string,
) => setStageStatus(
  tenantId,
  stageId,
  TaskStageStatus.NOT_STARTED,
  userId,
  undefined,
  true,
);

export async function skipTaskStage(
  tenantId: string,
  stageId: string,
  reason: string,
  userId?: string,
) {
  const parsed = taskStageSkipSchema.parse({ reason });
  return setStageStatus(tenantId, stageId, TaskStageStatus.SKIPPED, userId, parsed.reason);
}

function outcomeEntityIds(parsed: ReturnType<typeof taskStageOutcomeSchema.parse>) {
  return {
    companyId: parsed.companyId ?? null,
    generatedDocumentId: parsed.generatedDocumentId ?? null,
    esigningEnvelopeId: parsed.esigningEnvelopeId ?? null,
  };
}

async function resolveAuthoritativeOutcome(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: ReturnType<typeof taskStageOutcomeSchema.parse>,
): Promise<ResolvedStageOutcome> {
  if (input.type === TaskStageOutcomeType.COMPANY && input.companyId) {
    const company = await tx.company.findFirst({
      where: { id: input.companyId, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!company) throw new NotFoundError('Company not found');
    return {
      type: TaskStageOutcomeType.COMPANY,
      entity: { kind: 'company', ...company },
    };
  }

  if (
    input.type === TaskStageOutcomeType.GENERATED_DOCUMENT
    && input.generatedDocumentId
  ) {
    const document = await tx.generatedDocument.findFirst({
      where: { id: input.generatedDocumentId, tenantId, deletedAt: null },
      select: { id: true, title: true, status: true },
    });
    if (!document) throw new NotFoundError('Generated document not found');
    return {
      type: TaskStageOutcomeType.GENERATED_DOCUMENT,
      entity: { kind: 'generatedDocument', ...document },
    };
  }

  if (
    input.type === TaskStageOutcomeType.ESIGNING_ENVELOPE
    && input.esigningEnvelopeId
  ) {
    const envelope = await tx.esigningEnvelope.findFirst({
      where: { id: input.esigningEnvelopeId, tenantId, deletedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        recipients: {
          where: { type: 'SIGNER' },
          select: { status: true },
        },
      },
    });
    if (!envelope) throw new NotFoundError('E-signing envelope not found');
    const recipients = envelope.recipients ?? [];
    return {
      type: TaskStageOutcomeType.ESIGNING_ENVELOPE,
      entity: {
        kind: 'esigningEnvelope',
        id: envelope.id,
        title: envelope.title,
        status: envelope.status,
        requiredSignatures: recipients.length,
        completedSignatures: recipients.filter((recipient) => recipient.status === 'SIGNED').length,
      },
    };
  }

  throw new ValidationError('Outcome type and linked entity do not match');
}

export interface LinkTaskStageOutcomeOptions {
  /**
   * Keep background callback links (e.g. a late company-creation callback)
   * from replacing a company that is still active and already committed.
   * Explicit stage links pass no option and may replace like task metadata.
   */
  protectAuthoritativeCompany?: boolean;
}

export async function linkTaskStageOutcome(
  tenantId: string,
  stageId: string,
  input: TaskStageOutcomeInput,
  userId?: string,
  options: LinkTaskStageOutcomeOptions = {},
) {
  const parsed = taskStageOutcomeSchema.parse(input);
  let taskId: string | null = null;
  const result = await prisma.$transaction(async (tx) => {
    const stage = await requireStage(tx, tenantId, stageId);
    taskId = stage.taskId;
    const lockedTask = await lockTaskForUpdate(tx, tenantId, stage.taskId);
    assertOutcomeMatchesAction(stage.actionType, parsed.type);
    if (
      options.protectAuthoritativeCompany
      && parsed.type === TaskStageOutcomeType.COMPANY
      && parsed.companyId
    ) {
      const recovery = await lockCompanyRecoveryContext(
        tx,
        tenantId,
        stage.taskId,
        stage.id,
      );
      const authoritativeCompanyId = recovery?.taskId === stage.taskId
        ? recovery.companyId
        : null;
      if (
        authoritativeCompanyId
        && authoritativeCompanyId !== parsed.companyId
      ) {
        const authoritativeCompany = await tx.company.findFirst({
          where: {
            id: authoritativeCompanyId,
            tenantId,
            deletedAt: null,
          },
          select: { id: true, name: true },
        });
        if (authoritativeCompany) {
          return {
            stale: true,
            authoritativeCompanyId,
            status: stage.status,
            taskStatus: lockedTask.status,
            outcome: stage.outcome,
          };
        }
      }
    }
    const authoritative = await resolveAuthoritativeOutcome(tx, tenantId, parsed);
    const resolution = resolveStageActionOutcome(stage.actionType, authoritative);
    if (
      parsed.type === TaskStageOutcomeType.COMPANY
      && parsed.companyId
    ) {
      const synchronized = await synchronizeCompanyProfileStages(tx, {
        tenantId,
        taskId: stage.taskId,
        companyId: parsed.companyId,
        currentTaskStatus: lockedTask.status,
        userId,
      });
      const outcome = synchronized.outcomesByStageId.get(stage.id) ?? stage.outcome;
      if (stage.status !== TaskStageStatus.SKIPPED && !outcome) {
        throw new ValidationError('Company Profile stage was not synchronized');
      }
      return {
        outcome,
        status: stage.status === TaskStageStatus.SKIPPED
          ? TaskStageStatus.SKIPPED
          : TaskStageStatus.COMPLETED,
        summary: resolution.summary,
        taskStatus: synchronized.taskStatus,
      };
    }
    const effectiveStatus = stage.status === TaskStageStatus.SKIPPED
      ? TaskStageStatus.SKIPPED
      : resolution.status;
    const ids = outcomeEntityIds(parsed);
    const outcome = await tx.taskStageOutcome.upsert({
      where: { taskStageId: stage.id },
      create: {
        tenantId,
        taskStageId: stage.id,
        type: parsed.type,
        ...ids,
      },
      update: {
        type: parsed.type,
        ...ids,
      },
    });
    const now = new Date();
    await tx.taskStage.update({
      where: { id: stage.id },
      data: {
        status: effectiveStatus,
        ...(effectiveStatus === TaskStageStatus.SKIPPED
          ? {}
          : {
            startedAt: stage.startedAt ?? now,
            completedAt: effectiveStatus === TaskStageStatus.COMPLETED ? now : null,
          }),
      },
    });
    const taskStatus = await updateParentTaskStatus(
      tx,
      tenantId,
      stage.taskId,
      lockedTask.status,
    );
    await auditStageMutation(tx, {
      tenantId,
      userId,
      stageId: stage.id,
      companyId: stage.task.companyId,
      summary: resolution.summary ?? `Linked ${parsed.type} outcome`,
      metadata: { outcomeId: outcome.id, outcomeType: parsed.type, taskStatus },
    });
    return { outcome, status: effectiveStatus, summary: resolution.summary, taskStatus };
  });
  if (taskId && parsed.type !== TaskStageOutcomeType.ESIGNING_ENVELOPE) {
    await safelyQueueTaskEsigningPreparation(tenantId, taskId, userId);
  }
  return result;
}

export async function reconcileTaskStageOutcome(
  tenantId: string,
  stageId: string,
  userId?: string,
) {
  let taskIdForQueue: string | null = null;
  const result = await prisma.$transaction(async (tx) => {
    const taskId = await requireStageTaskId(tx, tenantId, stageId);
    taskIdForQueue = taskId;
    const lockedTask = await lockTaskForUpdate(tx, tenantId, taskId);
    const stage = await requireStage(tx, tenantId, stageId);
    if (stage.taskId !== taskId) {
      throw new ValidationError('Task stage parent changed during reconciliation');
    }
    if (stage.actionType === TaskStageActionType.MANUAL) {
      return {
        status: stage.status,
        summary: null,
        taskStatus: lockedTask.status,
      };
    }
    if (stage.status === TaskStageStatus.SKIPPED) {
      return {
        status: stage.status,
        summary: null,
        taskStatus: lockedTask.status,
      };
    }
    if (!stage.outcome) {
      const adapter = getStageActionAdapter(stage.actionType);
      const status = adapter.deriveStatus(null);
      const stageChanged = stage.status !== status || stage.completedAt !== null;
      if (stageChanged) {
        await tx.taskStage.update({
          where: { id: stage.id },
          data: { status, completedAt: null },
        });
      }
      const taskStatus = await updateParentTaskStatus(
        tx,
        tenantId,
        stage.taskId,
        lockedTask.status,
      );
      if (!stageChanged && taskStatus === lockedTask.status) {
        return { status, summary: null, taskStatus };
      }
      await auditStageMutation(tx, {
        tenantId,
        userId,
        stageId: stage.id,
        companyId: stage.task.companyId,
        summary: 'Reconciled task stage without an outcome',
        metadata: { status, taskStatus },
      });
      return { status, summary: null, taskStatus };
    }
    const stageOutcome = stage.outcome;

    const failUnavailableOutcome = async () => {
      const status = TaskStageStatus.FAILED;
      const stageChanged = stage.status !== status || stage.completedAt !== null;
      if (stageChanged) {
        await tx.taskStage.update({
          where: { id: stage.id },
          data: { status, completedAt: null },
        });
      }
      const taskStatus = await updateParentTaskStatus(
        tx,
        tenantId,
        stage.taskId,
        lockedTask.status,
      );
      if (!stageChanged && taskStatus === lockedTask.status) {
        return {
          status,
          summary: 'Linked outcome is no longer available',
          taskStatus,
        };
      }
      await auditStageMutation(tx, {
        tenantId,
        userId,
        stageId: stage.id,
        companyId: stage.task.companyId,
        summary: 'Linked task stage outcome is no longer available',
        metadata: { outcomeId: stageOutcome.id, status, taskStatus },
      });
      return {
        status,
        summary: 'Linked outcome is no longer available',
        taskStatus,
      };
    };

    if (!hasLinkedOutcomeEntity(stageOutcome)) {
      return failUnavailableOutcome();
    }

    const input = taskStageOutcomeSchema.parse({
      type: stageOutcome.type,
      companyId: stageOutcome.companyId,
      generatedDocumentId: stageOutcome.generatedDocumentId,
      esigningEnvelopeId: stageOutcome.esigningEnvelopeId,
    });
    assertOutcomeMatchesAction(stage.actionType, input.type);
    let authoritative: ResolvedStageOutcome;
    try {
      authoritative = await resolveAuthoritativeOutcome(tx, tenantId, input);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      return failUnavailableOutcome();
    }
    const resolution = resolveStageActionOutcome(stage.actionType, authoritative);
    const completedAt = resolution.status === TaskStageStatus.COMPLETED
      ? stage.completedAt ?? new Date()
      : null;
    const stageChanged = (
      stage.status !== resolution.status
      || stage.completedAt?.getTime() !== completedAt?.getTime()
    );
    if (stageChanged) {
      await tx.taskStage.update({
        where: { id: stage.id },
        data: {
          status: resolution.status,
          completedAt,
        },
      });
    }
    const taskStatus = await updateParentTaskStatus(
      tx,
      tenantId,
      stage.taskId,
      lockedTask.status,
    );
    if (!stageChanged && taskStatus === lockedTask.status) {
      return {
        status: resolution.status,
        summary: resolution.summary,
        taskStatus,
      };
    }
    await auditStageMutation(tx, {
      tenantId,
      userId,
      stageId: stage.id,
      companyId: stage.task.companyId,
      summary: resolution.summary ?? 'Reconciled task stage outcome',
      metadata: { outcomeId: stageOutcome.id, status: resolution.status, taskStatus },
    });
    return { ...resolution, taskStatus };
  });
  if (taskIdForQueue) {
    await safelyQueueTaskEsigningPreparation(tenantId, taskIdForQueue, userId);
  }
  return result;
}
