import {
  TaskStageActionType,
  TaskStageOutcomeType,
} from '@/generated/prisma';
import type { SessionUser } from '@/lib/auth';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
export {
  parseTaskLaunchContext,
  taskLaunchContextSchema,
} from '@/lib/task-launch-context';
import {
  getTaskStageDetail,
  linkTaskStageOutcome,
  reconcileTaskStageOutcome,
} from './stage.service';
import type { TaskLaunchContext } from './types';
import {
  requireTaskAccess,
  requireTaskOutcomeAccess,
} from './access';

const log = createLogger('tasks:integration');

interface LinkTaskOutcomeInput {
  tenantId: string;
  context: TaskLaunchContext;
  authoritativeId: string;
  userId?: string;
  session?: SessionUser;
}

export async function preflightTaskLaunchContext(
  tenantId: string,
  context: TaskLaunchContext,
  expectedAction: TaskStageActionType,
  session?: SessionUser,
) {
  if (session) {
    await requireTaskAccess(session, tenantId, context.taskId, 'update');
  }
  const stage = await getTaskStageDetail(
    tenantId,
    context.taskId,
    context.taskStageId,
  );
  if (stage.actionType !== expectedAction) {
    throw new ValidationError(`Task stage action must be ${expectedAction}`);
  }
  return stage;
}

async function linkAuthoritativeOutcome(
  input: LinkTaskOutcomeInput,
  outcome:
    | { type: typeof TaskStageOutcomeType.COMPANY; companyId: string }
    | {
      type: typeof TaskStageOutcomeType.GENERATED_DOCUMENT;
      generatedDocumentId: string;
    }
    | {
      type: typeof TaskStageOutcomeType.ESIGNING_ENVELOPE;
      esigningEnvelopeId: string;
    },
) {
  if (input.session) {
    await requireTaskOutcomeAccess(input.session, input.tenantId, outcome);
  }
  await getTaskStageDetail(
    input.tenantId,
    input.context.taskId,
    input.context.taskStageId,
  );
  return linkTaskStageOutcome(
    input.tenantId,
    input.context.taskStageId,
    outcome,
    input.userId,
    { protectAuthoritativeCompany: true },
  );
}

export function linkCompanyTaskOutcome(input: LinkTaskOutcomeInput) {
  return linkAuthoritativeOutcome(input, {
    type: TaskStageOutcomeType.COMPANY,
    companyId: input.authoritativeId,
  });
}

export function linkGeneratedDocumentTaskOutcome(input: LinkTaskOutcomeInput) {
  return linkAuthoritativeOutcome(input, {
    type: TaskStageOutcomeType.GENERATED_DOCUMENT,
    generatedDocumentId: input.authoritativeId,
  });
}

export function linkEsigningEnvelopeTaskOutcome(input: LinkTaskOutcomeInput) {
  return linkAuthoritativeOutcome(input, {
    type: TaskStageOutcomeType.ESIGNING_ENVELOPE,
    esigningEnvelopeId: input.authoritativeId,
  });
}

async function safelyRunTaskCallback(
  label: string,
  callback: () => Promise<unknown>,
) {
  try {
    await callback();
  } catch (error) {
    log.warn(`Task integration callback failed after ${label}`, { error });
  }
}

export function safelyLinkCompanyTaskOutcome(input: LinkTaskOutcomeInput) {
  return safelyRunTaskCallback(
    'company mutation',
    () => linkCompanyTaskOutcome(input),
  );
}

export function safelyLinkGeneratedDocumentTaskOutcome(input: LinkTaskOutcomeInput) {
  return safelyRunTaskCallback(
    'generated document mutation',
    () => linkGeneratedDocumentTaskOutcome(input),
  );
}

/**
 * Link the first successful batch output to a task stage.
 *
 * `TaskStageOutcome.taskStageId` is currently unique, so a batch may have at
 * most one authoritative generated-document outcome per stage. The first
 * successful item by display order wins; already-linked stages are left
 * untouched so retries cannot overwrite an authoritative outcome.
 */
export async function linkFirstGeneratedDocumentTaskOutcomeForBatch(params: {
  tenantId: string;
  taskContext: TaskLaunchContext;
  userId: string;
  successes: Array<{ itemId: string; documentId: string; title: string }>;
}) {
  return safelyRunTaskCallback(
    'batch generation outcome',
    async () => {
      const existing = await prisma.taskStageOutcome.findFirst({
        where: {
          tenantId: params.tenantId,
          taskStageId: params.taskContext.taskStageId,
          type: TaskStageOutcomeType.GENERATED_DOCUMENT,
        },
        select: { id: true },
      });
      if (existing) return;
      const first = params.successes[0];
      if (!first) return;
      await linkGeneratedDocumentTaskOutcome({
        tenantId: params.tenantId,
        context: params.taskContext,
        authoritativeId: first.documentId,
        userId: params.userId,
      });
    },
  );
}

export function safelyLinkEsigningEnvelopeTaskOutcome(input: LinkTaskOutcomeInput) {
  return safelyRunTaskCallback(
    'e-signing envelope mutation',
    () => linkEsigningEnvelopeTaskOutcome(input),
  );
}

async function reconcileLinkedOutcomes(
  tenantId: string,
  where:
    | { companyId: string }
    | { generatedDocumentId: string }
    | { esigningEnvelopeId: string },
  userId?: string,
) {
  const outcomes = await prisma.taskStageOutcome.findMany({
    where: { tenantId, ...where },
    select: { taskStageId: true },
  });
  await Promise.all(
    outcomes.map(({ taskStageId }) => (
      reconcileTaskStageOutcome(tenantId, taskStageId, userId)
    )),
  );
}

export function reconcileCompanyTaskOutcomes(
  tenantId: string,
  companyId: string,
  userId?: string,
) {
  return reconcileLinkedOutcomes(tenantId, { companyId }, userId);
}

export function reconcileGeneratedDocumentTaskOutcomes(
  tenantId: string,
  generatedDocumentId: string,
  userId?: string,
) {
  return reconcileLinkedOutcomes(
    tenantId,
    { generatedDocumentId },
    userId,
  );
}

export function reconcileEsigningEnvelopeTaskOutcomes(
  tenantId: string,
  esigningEnvelopeId: string,
  userId?: string,
) {
  return reconcileLinkedOutcomes(
    tenantId,
    { esigningEnvelopeId },
    userId,
  );
}

export function safelyReconcileGeneratedDocumentTaskOutcomes(
  tenantId: string,
  generatedDocumentId: string,
  userId?: string,
) {
  return safelyRunTaskCallback(
    'generated document lifecycle change',
    () => reconcileGeneratedDocumentTaskOutcomes(
      tenantId,
      generatedDocumentId,
      userId,
    ),
  );
}

export function safelyReconcileCompanyTaskOutcomes(
  tenantId: string,
  companyId: string,
  userId?: string,
) {
  return safelyRunTaskCallback(
    'company lifecycle change',
    () => reconcileCompanyTaskOutcomes(tenantId, companyId, userId),
  );
}

export async function safelyCaptureCompanyTaskStageIds(
  tenantId: string,
  companyId: string,
) {
  try {
    const [outcomes, recoveries] = await Promise.all([
      prisma.taskStageOutcome.findMany({
        where: { tenantId, companyId },
        select: { taskStageId: true },
      }),
      prisma.taskCompanyRecoveryContext.findMany({
        where: { tenantId, companyId },
        select: { taskStageId: true },
      }),
    ]);
    return Array.from(new Set([
      ...outcomes.map(({ taskStageId }) => taskStageId),
      ...recoveries.map(({ taskStageId }) => taskStageId),
    ]));
  } catch (error) {
    log.warn('Failed to capture linked task stages before company deletion', {
      error,
    });
    return [];
  }
}

export function safelyReconcileEsigningEnvelopeTaskOutcomes(
  tenantId: string,
  esigningEnvelopeId: string,
  userId?: string,
) {
  return safelyRunTaskCallback(
    'e-signing envelope lifecycle change',
    () => reconcileEsigningEnvelopeTaskOutcomes(
      tenantId,
      esigningEnvelopeId,
      userId,
    ),
  );
}

export async function safelyCaptureEsigningTaskStageIds(
  tenantId: string,
  esigningEnvelopeId: string,
) {
  try {
    const outcomes = await prisma.taskStageOutcome.findMany({
      where: { tenantId, esigningEnvelopeId },
      select: { taskStageId: true },
    });
    return outcomes.map(({ taskStageId }) => taskStageId);
  } catch (error) {
    log.warn('Failed to capture linked task stages before e-signing deletion', {
      error,
    });
    return [];
  }
}

export async function safelyCaptureGeneratedDocumentTaskStageIds(
  tenantId: string,
  generatedDocumentId: string,
) {
  try {
    const outcomes = await prisma.taskStageOutcome.findMany({
      where: { tenantId, generatedDocumentId },
      select: { taskStageId: true },
    });
    return Array.from(new Set(outcomes.map(({ taskStageId }) => taskStageId)));
  } catch (error) {
    log.warn('Failed to capture linked task stages before generated document deletion', {
      error,
    });
    return [];
  }
}

export function safelyReconcileTaskStageIds(
  tenantId: string,
  taskStageIds: string[],
  userId?: string,
) {
  return safelyRunTaskCallback(
    'authoritative record deletion',
    async () => {
      const stages = await prisma.taskStage.findMany({
        where: { tenantId, id: { in: taskStageIds } },
        select: { id: true, taskId: true },
      });
      await Promise.all(stages.map(({ id, taskId }) => (
        getTaskStageDetail(tenantId, taskId, id, userId)
      )));
    },
  );
}

export async function findPreferredEsigningDocument(
  tenantId: string,
  context: TaskLaunchContext,
) {
  const stage = await prisma.taskStage.findFirst({
    where: {
      id: context.taskStageId,
      taskId: context.taskId,
      tenantId,
      actionType: TaskStageActionType.ESIGNING,
      task: { deletedAt: null },
    },
    select: { id: true, position: true },
  });
  if (!stage) throw new NotFoundError('Task stage not found');

  const outcome = await prisma.taskStageOutcome.findFirst({
    where: {
      tenantId,
      taskStage: {
        taskId: context.taskId,
        position: { lt: stage.position },
        actionType: TaskStageActionType.DOCUMENT_GENERATION,
      },
      generatedDocument: {
        tenantId,
        status: 'FINALIZED',
        deletedAt: null,
      },
    },
    orderBy: { taskStage: { position: 'desc' } },
    select: {
      generatedDocument: {
        select: { id: true, title: true, companyId: true },
      },
    },
  });

  return outcome?.generatedDocument ?? null;
}

export async function resolveEsigningGeneratedDocument(
  tenantId: string,
  context: TaskLaunchContext,
  selectedGeneratedDocumentId?: string,
  session?: SessionUser,
) {
  await preflightTaskLaunchContext(
    tenantId,
    context,
    TaskStageActionType.ESIGNING,
    session,
  );
  if (!selectedGeneratedDocumentId) {
    const preferred = await findPreferredEsigningDocument(tenantId, context);
    if (!preferred) {
      throw new NotFoundError('No eligible finalized document is available');
    }
    if (session) {
      await requireTaskOutcomeAccess(session, tenantId, {
        type: TaskStageOutcomeType.GENERATED_DOCUMENT,
        generatedDocumentId: preferred.id,
      });
    }
    return preferred;
  }

  const selected = await prisma.generatedDocument.findFirst({
    where: {
      id: selectedGeneratedDocumentId,
      tenantId,
      status: 'FINALIZED',
      deletedAt: null,
    },
    select: { id: true, title: true, companyId: true },
  });
  if (!selected) {
    throw new NotFoundError('Selected generated document must be finalized and eligible');
  }
  if (session) {
    await requireTaskOutcomeAccess(session, tenantId, {
      type: TaskStageOutcomeType.GENERATED_DOCUMENT,
      generatedDocumentId: selected.id,
    });
  }
  return selected;
}

async function findTaskGeneratedDocumentIds(
  tenantId: string,
  taskId: string,
  signingStagePosition: number,
) {
  const documentStages = await prisma.taskStage.findMany({
    where: {
      tenantId,
      taskId,
      position: { lt: signingStagePosition },
      actionType: TaskStageActionType.DOCUMENT_GENERATION,
      task: { deletedAt: null },
    },
    select: { id: true },
  });
  const documentStageIds = documentStages.map((stage) => stage.id);
  if (documentStageIds.length === 0) return new Set<string>();

  const [outcomes, batches] = await Promise.all([
    prisma.taskStageOutcome.findMany({
      where: {
        tenantId,
        taskStageId: { in: documentStageIds },
        type: TaskStageOutcomeType.GENERATED_DOCUMENT,
        generatedDocumentId: { not: null },
      },
      select: { generatedDocumentId: true },
    }),
    prisma.documentGenerationBatch.findMany({
      where: {
        tenantId,
        deletedAt: null,
        AND: [
          { taskContext: { path: ['taskId'], equals: taskId } },
          {
            OR: documentStageIds.map((stageId) => ({
              taskContext: { path: ['taskStageId'], equals: stageId },
            })),
          },
        ],
      },
      select: {
        items: {
          where: { generatedDocument: { deletedAt: null } },
          select: { generatedDocumentId: true },
        },
      },
    }),
  ]);

  return new Set([
    ...outcomes
      .map(({ generatedDocumentId }) => generatedDocumentId)
      .filter((id): id is string => Boolean(id)),
    ...batches.flatMap((batch) => batch.items.map((item) => item.generatedDocumentId)),
  ]);
}

export async function resolveEsigningGeneratedDocuments(
  tenantId: string,
  context: TaskLaunchContext,
  selectedGeneratedDocumentIds: string[],
  session?: SessionUser,
) {
  const stage = await preflightTaskLaunchContext(
    tenantId,
    context,
    TaskStageActionType.ESIGNING,
    session,
  );
  const uniqueSelectedIds = Array.from(new Set(selectedGeneratedDocumentIds));
  if (uniqueSelectedIds.length === 0) {
    const preferred = await findPreferredEsigningDocument(tenantId, context);
    if (!preferred) throw new NotFoundError('No eligible finalized document is available');
    return [preferred];
  }

  const taskDocumentIds = await findTaskGeneratedDocumentIds(
    tenantId,
    context.taskId,
    stage.position,
  );
  if (uniqueSelectedIds.some((id) => !taskDocumentIds.has(id))) {
    throw new ValidationError('Selected documents must belong to this task');
  }

  const documents = await prisma.generatedDocument.findMany({
    where: {
      id: { in: uniqueSelectedIds },
      tenantId,
      status: 'FINALIZED',
      deletedAt: null,
    },
    select: { id: true, title: true, companyId: true },
  });
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  if (documentsById.size !== uniqueSelectedIds.length) {
    throw new NotFoundError('Selected generated documents must be finalized and available');
  }

  const orderedDocuments = uniqueSelectedIds.map((id) => documentsById.get(id)!);
  if (session) {
    await Promise.all(orderedDocuments.map((document) => requireTaskOutcomeAccess(
      session,
      tenantId,
      {
        type: TaskStageOutcomeType.GENERATED_DOCUMENT,
        generatedDocumentId: document.id,
      },
    )));
  }
  return orderedDocuments;
}
