import type { Prisma } from '@/generated/prisma';
import type { SessionUser } from '@/lib/auth';
import { canAccessCompany } from '@/lib/auth';
import { hasPermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import {
  canReadEnvelope,
  resolveEsigningActorScope,
  type EsigningActorScope,
} from '@/services/esigning-envelope.lib';
import { NotFoundError } from '@/lib/errors';
import { getStageActionAdapter } from './action-registry';
import type {
  StageActionBlocker,
  StageActionRecord,
  TaskEsigningEnvelopeResource,
  TaskEsigningSignerResource,
  TaskGeneratedDocumentResource,
  TaskResource,
  TaskResourceStage,
  TaskResourcesResponse,
  TaskSignerLinkState,
  TaskStageStatus,
} from './types';

const taskResourcesSelect = {
  id: true,
  title: true,
  status: true,
  dueDate: true,
  company: {
    select: { id: true, name: true, uen: true, deletedAt: true },
  },
  owner: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  pipelineVersion: {
    select: { pipeline: { select: { name: true } } },
  },
  stages: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      name: true,
      position: true,
      actionType: true,
      actionConfig: true,
      status: true,
      description: true,
      notes: true,
      startedAt: true,
      completedAt: true,
      assignee: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      checklistItems: {
        orderBy: { position: 'asc' as const },
        select: { id: true, label: true, isCompleted: true },
      },
      outcome: {
        select: {
          type: true,
          companyId: true,
          generatedDocumentId: true,
          esigningEnvelopeId: true,
          company: {
            select: { id: true, name: true, uen: true, deletedAt: true },
          },
          generatedDocument: {
            select: { id: true, title: true, status: true, companyId: true, deletedAt: true },
          },
          esigningEnvelope: {
            select: {
              id: true,
              title: true,
              status: true,
              pdfGenerationStatus: true,
              expiresAt: true,
              companyId: true,
              createdById: true,
              deletedAt: true,
              documents: {
                orderBy: { sortOrder: 'asc' as const },
                select: { id: true, fileName: true, signedStoragePath: true, generatedDocumentId: true },
              },
              recipients: {
                where: { type: 'SIGNER' },
                orderBy: [
                  { signingOrder: 'asc' as const },
                  { createdAt: 'asc' as const },
                ],
                select: {
                  id: true,
                  name: true,
                  email: true,
                  status: true,
                  signingOrder: true,
                },
              },
            },
          },
        },
      },
      esigningPreparation: {
        select: { status: true },
      },
    },
  },
} satisfies Prisma.TaskSelect;

type TaskResourcesRecord = Prisma.TaskGetPayload<{ select: typeof taskResourcesSelect }>;
type TaskResourceStageRecord = TaskResourcesRecord['stages'][number];

const taskLinkedBatchSelect = {
  items: {
    orderBy: { displayOrder: 'asc' as const },
    where: { generatedDocument: { deletedAt: null } },
    select: {
      generatedDocument: {
        select: { id: true, title: true, status: true, companyId: true, deletedAt: true },
      },
    },
  },
} satisfies Prisma.DocumentGenerationBatchSelect;

type TaskLinkedBatchRecord = Prisma.DocumentGenerationBatchGetPayload<{
  select: typeof taskLinkedBatchSelect;
}>;
type TaskGeneratedDocumentRecord = NonNullable<
  TaskLinkedBatchRecord['items'][number]['generatedDocument']
>;

function taskResourceHref(path: string, taskId: string, stageId: string): string {
  const params = new URLSearchParams({
    taskId,
    taskStageId: stageId,
    returnTo: '/tasks',
  });
  return `${path}${path.includes('?') ? '&' : '?'}${params}`;
}

function signerLinkState(status: string): TaskSignerLinkState {
  if (status === 'NOTIFIED' || status === 'VIEWED') return 'available';
  if (status === 'SIGNED' || status === 'DECLINED') return 'finished';
  return 'waiting';
}

function pendingReason(): string {
  return 'This resource will appear when the stage creates or links it.';
}

function missingReason(): string {
  return 'The linked resource is no longer available.';
}

function forbiddenReason(): string {
  return 'You do not have permission to view this resource.';
}

function failedPreparationReason(): string {
  return 'The linked resource could not be prepared.';
}

function isTerminalStage(status: TaskStageStatus): boolean {
  return status === 'FAILED' || status === 'SKIPPED' || status === 'COMPLETED';
}

function isLiveResource(resource: TaskResource): boolean {
  if (resource.state === 'pending') return true;
  if (resource.state !== 'available') return false;
  if (resource.kind === 'generatedDocument') {
    return resource.status === 'DRAFT';
  }
  if (resource.kind === 'esigningEnvelope') {
    return (
      resource.status === 'DRAFT'
      || resource.status === 'SENT'
      || resource.status === 'IN_PROGRESS'
      || resource.pdfGenerationStatus === 'PENDING'
      || resource.pdfGenerationStatus === 'PROCESSING'
    );
  }
  return false;
}

function safeStageBlockers(stage: StageActionRecord): StageActionBlocker[] {
  try {
    return getStageActionAdapter(stage.actionType).blockers({
      tenantId: stage.tenantId,
      stage,
    });
  } catch {
    return [{
      code: 'STAGE_CONFIGURATION_UNAVAILABLE',
      message: 'Stage configuration is unavailable.',
    }];
  }
}

function createPlaceholderResource(
  kind: TaskResource['kind'],
  state: 'pending' | 'unavailable',
  reason: string,
): TaskResource {
  if (kind === 'company') {
    return { kind, id: null, state, label: 'Company', name: null, uen: null, href: null, reason };
  }
  if (kind === 'generatedDocument') {
    return {
      kind,
      id: null,
      state,
      label: 'Generated document',
      title: null,
      status: null,
      href: null,
      reason,
    };
  }
  return {
    kind,
    id: null,
    state,
    label: 'Signing request',
    title: null,
    status: null,
    pdfGenerationStatus: null,
    expiresAt: null,
    completedSignatures: 0,
    requiredSignatures: 0,
    href: null,
    canGenerateSignerLink: false,
    documents: [],
    signers: [],
    reason,
  };
}

async function canReadDocumentResource(
  session: SessionUser,
  companyId: string | null,
): Promise<boolean> {
  try {
    if (!await hasPermission(session.id, 'document', 'read', companyId ?? undefined)) {
      return false;
    }
    return !companyId || await canAccessCompany(session, companyId);
  } catch {
    return false;
  }
}

async function canReadCompanyResource(
  session: SessionUser,
  companyId: string,
): Promise<boolean> {
  try {
    return Boolean(
      await hasPermission(session.id, 'company', 'read', companyId)
      && await canAccessCompany(session, companyId),
    );
  } catch {
    return false;
  }
}

async function serializeCompanyResource(
  session: SessionUser,
  company: NonNullable<TaskResourceStageRecord['outcome']>['company'] | TaskResourcesRecord['company'],
): Promise<TaskResource> {
  if (!company) return createPlaceholderResource('company', 'unavailable', missingReason());
  if (company.deletedAt) return createPlaceholderResource('company', 'unavailable', missingReason());
  if (!await canReadCompanyResource(session, company.id)) {
    return createPlaceholderResource('company', 'unavailable', forbiddenReason());
  }
  return {
    kind: 'company',
    id: company.id,
    state: 'available',
    label: 'Company',
    name: company.name,
    uen: company.uen,
    href: `/companies/${company.id}`,
    reason: null,
  };
}

async function findTaskLinkedBatch(
  tenantId: string,
  taskId: string,
  stageId: string,
): Promise<TaskLinkedBatchRecord | null> {
  return prisma.documentGenerationBatch.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      AND: [
        { taskContext: { path: ['taskId'], equals: taskId } },
        { taskContext: { path: ['taskStageId'], equals: stageId } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    select: taskLinkedBatchSelect,
  });
}

async function serializeGeneratedDocumentResource(
  session: SessionUser,
  taskId: string,
  stageId: string,
  stageStatus: TaskStageStatus,
  document: TaskGeneratedDocumentRecord | NonNullable<TaskResourceStageRecord['outcome']>['generatedDocument'] | null,
): Promise<TaskGeneratedDocumentResource> {
  if (!document) {
    return createPlaceholderResource(
      'generatedDocument',
      isTerminalStage(stageStatus) ? 'unavailable' : 'pending',
      isTerminalStage(stageStatus) ? missingReason() : pendingReason(),
    ) as TaskGeneratedDocumentResource;
  }
  if (document.deletedAt) {
    return createPlaceholderResource('generatedDocument', 'unavailable', missingReason()) as TaskGeneratedDocumentResource;
  }
  if (!await canReadDocumentResource(session, document.companyId)) {
    return createPlaceholderResource('generatedDocument', 'unavailable', forbiddenReason()) as TaskGeneratedDocumentResource;
  }
  return {
    kind: 'generatedDocument',
    id: document.id,
    state: 'available',
    label: 'Generated document',
    title: document.title,
    status: document.status,
    href: taskResourceHref(`/generated-documents/${document.id}`, taskId, stageId),
    reason: null,
  };
}

function serializeSigner(
  recipient: NonNullable<NonNullable<TaskResourceStageRecord['outcome']>['esigningEnvelope']>['recipients'][number],
): TaskEsigningSignerResource {
  return {
    id: recipient.id,
    name: recipient.name,
    email: recipient.email,
    status: recipient.status,
    signingOrder: recipient.signingOrder,
    linkState: signerLinkState(recipient.status),
  };
}

async function serializeEsigningEnvelopeResource(
  session: SessionUser,
  taskId: string,
  stage: TaskResourceStageRecord,
  esigningScope: EsigningActorScope | null,
): Promise<TaskEsigningEnvelopeResource> {
  const envelope = stage.outcome?.esigningEnvelope;
  if (!envelope) {
    const preparationStatus = stage.esigningPreparation?.status;
    const unavailable = preparationStatus === 'FAILED_PERMANENT';
    return createPlaceholderResource(
      'esigningEnvelope',
      unavailable || isTerminalStage(stage.status) ? 'unavailable' : 'pending',
      unavailable ? failedPreparationReason() : isTerminalStage(stage.status) ? missingReason() : pendingReason(),
    ) as TaskEsigningEnvelopeResource;
  }
  if (envelope.deletedAt) {
    return createPlaceholderResource('esigningEnvelope', 'unavailable', missingReason()) as TaskEsigningEnvelopeResource;
  }

  const companyReadable = envelope.companyId
    ? await canReadCompanyResource(session, envelope.companyId)
    : true;
  const envelopeReadable = Boolean(
    esigningScope?.canReadAll
      && canReadEnvelope(esigningScope, session, envelope.createdById)
      && companyReadable,
  );
  if (!envelopeReadable) {
    return createPlaceholderResource('esigningEnvelope', 'unavailable', forbiddenReason()) as TaskEsigningEnvelopeResource;
  }

  const signers = envelope.recipients.map(serializeSigner);
  return {
    kind: 'esigningEnvelope',
    id: envelope.id,
    state: 'available',
    label: 'Signing request',
    title: envelope.title,
    status: envelope.status,
    pdfGenerationStatus: envelope.pdfGenerationStatus,
    expiresAt: envelope.expiresAt?.toISOString() ?? null,
    completedSignatures: signers.filter((signer) => signer.status === 'SIGNED').length,
    requiredSignatures: signers.length,
    href: taskResourceHref(`/esigning/${envelope.id}`, taskId, stage.id),
    canGenerateSignerLink: Boolean(esigningScope?.canUpdateAny),
    generatedDocumentIds: envelope.documents.flatMap((document) => (
      document.generatedDocumentId ? [document.generatedDocumentId] : []
    )),
    documents: envelope.documents.map((document) => ({
      id: document.id,
      fileName: document.fileName,
      originalPdfHref: `/api/esigning/envelopes/${envelope.id}/documents/${document.id}/pdf`,
      signedPdfHref: document.signedStoragePath
        ? `/api/esigning/envelopes/${envelope.id}/documents/${document.id}/signed-pdf`
        : null,
    })),
    signers,
    reason: null,
  };
}

async function serializeResourceStage(input: {
  session: SessionUser;
  tenantId: string;
  taskId: string;
  task: TaskResourcesRecord;
  stage: TaskResourceStageRecord;
  esigningScope: EsigningActorScope | null;
}): Promise<TaskResourceStage> {
  const { session, tenantId, taskId, task, stage, esigningScope } = input;
  let resources: TaskResource[] = [];

  if (stage.actionType === 'COMPANY_PROFILE') {
    const company = stage.outcome?.company ?? task.company;
    resources = company
      ? [await serializeCompanyResource(session, company)]
      : [createPlaceholderResource(
        'company',
        isTerminalStage(stage.status) ? 'unavailable' : 'pending',
        isTerminalStage(stage.status) ? missingReason() : pendingReason(),
      )];
  } else if (stage.actionType === 'DOCUMENT_GENERATION') {
    const batch = await findTaskLinkedBatch(tenantId, taskId, stage.id);
    const batchDocuments = batch?.items.map((item) => item.generatedDocument) ?? [];
    resources = batchDocuments.length > 0
      ? await Promise.all(batchDocuments.map((document) => (
        serializeGeneratedDocumentResource(
          session,
          taskId,
          stage.id,
          stage.status,
          document,
        )
      )))
      : [await serializeGeneratedDocumentResource(
        session,
        taskId,
        stage.id,
        stage.status,
        stage.outcome?.generatedDocument ?? null,
      )];
  } else if (stage.actionType === 'ESIGNING') {
    resources = [await serializeEsigningEnvelopeResource(
      session,
      taskId,
      stage,
      esigningScope,
    )];
  }

  const stageRecord: StageActionRecord = {
    id: stage.id,
    tenantId,
    taskId,
    actionType: stage.actionType,
    actionConfig: stage.actionConfig,
    status: stage.status,
    task: { companyId: task.company?.id ?? null },
    outcome: stage.outcome
      ? {
        type: stage.outcome.type,
        companyId: stage.outcome.companyId,
        generatedDocumentId: stage.outcome.generatedDocumentId,
        esigningEnvelopeId: stage.outcome.esigningEnvelopeId,
      }
      : null,
  };

  return {
    id: stage.id,
    name: stage.name,
    position: stage.position,
    actionType: stage.actionType,
    status: stage.status,
    description: stage.description,
    notes: stage.notes,
    startedAt: stage.startedAt?.toISOString() ?? null,
    completedAt: stage.completedAt?.toISOString() ?? null,
    assignee: stage.assignee
      ? {
        id: stage.assignee.id,
        name: [stage.assignee.firstName, stage.assignee.lastName].filter(Boolean).join(' ').trim()
          || stage.assignee.email,
        email: stage.assignee.email,
      }
      : null,
    checklist: stage.checklistItems,
    blockers: safeStageBlockers(stageRecord),
    resources,
  };
}

function serializeTaskSummary(task: TaskResourcesRecord): TaskResourcesResponse['task'] {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueDate: task.dueDate?.toISOString() ?? null,
    company: task.company && !task.company.deletedAt
      ? {
        id: task.company.id,
        name: task.company.name,
        uen: task.company.uen,
        href: `/companies/${task.company.id}`,
      }
      : null,
    owner: task.owner
      ? {
        id: task.owner.id,
        name: [task.owner.firstName, task.owner.lastName].filter(Boolean).join(' ').trim()
          || task.owner.email,
        email: task.owner.email,
      }
      : null,
    pipelineName: task.pipelineVersion.pipeline.name,
  };
}

export async function getTaskResources(
  session: SessionUser,
  tenantId: string,
  taskId: string,
): Promise<TaskResourcesResponse> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, tenantId, deletedAt: null },
    select: taskResourcesSelect,
  });
  if (!task) throw new NotFoundError('Task not found');

  const esigningScope = await resolveEsigningActorScope(session, tenantId)
    .catch(() => null);
  const stages = await Promise.all(task.stages.map((stage) => (
    serializeResourceStage({
      session,
      tenantId,
      taskId,
      task,
      stage,
      esigningScope,
    })
  )));

  return {
    task: serializeTaskSummary(task),
    stages,
    hasPendingResources: stages.some((stage) => (
      stage.resources.some(isLiveResource)
    )),
  };
}
