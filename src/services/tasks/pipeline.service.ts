import type { Prisma } from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import {
  archiveTaskPipelineSchema,
  createTaskPipelineSchema,
  duplicateTaskPipelineSchema,
  updateTaskPipelineSchema,
  type CreateTaskPipelineInput,
  type ParsedCreateTaskPipelineInput,
  type ParsedUpdateTaskPipelineInput,
  type UpdateTaskPipelineInput,
} from '@/lib/validations/task-pipeline';
import { getStageActionAdapter } from './action-registry';
import { lockTaskPipelineForUpdate } from './locking';

const pipelineDetailInclude = {
  versions: {
    where: { publishedAt: { not: null } },
    orderBy: { version: 'desc' as const },
    include: {
      stages: { orderBy: { position: 'asc' as const } },
    },
  },
} satisfies Prisma.TaskPipelineInclude;

export interface ListTaskPipelinesOptions {
  includeArchived?: boolean;
}

export async function listTaskPipelines(
  tenantId: string,
  options: ListTaskPipelinesOptions = {},
) {
  return prisma.taskPipeline.findMany({
    where: {
      tenantId,
      ...(options.includeArchived ? {} : { deletedAt: null }),
    },
    include: {
      versions: {
        where: { publishedAt: { not: null } },
        orderBy: { version: 'desc' },
        take: 1,
        include: { stages: { orderBy: { position: 'asc' } } },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getTaskPipeline(tenantId: string, pipelineId: string) {
  const pipeline = await prisma.taskPipeline.findFirst({
    where: { id: pipelineId, tenantId, deletedAt: null },
    include: pipelineDetailInclude,
  });

  if (!pipeline) {
    throw new NotFoundError('Task pipeline not found');
  }

  return pipeline;
}

function stageCreateManyData(
  tenantId: string,
  versionId: string,
  stages: ParsedCreateTaskPipelineInput['stages'] | ParsedUpdateTaskPipelineInput['stages'],
): Prisma.TaskPipelineStageCreateManyInput[] {
  return stages.map((stage) => {
    const actionConfig = getStageActionAdapter(stage.actionType).parseConfig({
      ...(stage.actionConfig ?? {}),
      checklistItems: stage.checklistItems,
    }) as Prisma.InputJsonObject;

    return {
      tenantId,
      versionId,
      name: stage.name,
      description: stage.description ?? null,
      position: stage.position,
      actionType: stage.actionType,
      icon: stage.icon,
      isRequired: stage.isRequired,
      actionConfig,
    };
  });
}

async function validateStageConfigs(
  tx: Prisma.TransactionClient,
  tenantId: string,
  stages: ParsedCreateTaskPipelineInput['stages'] | ParsedUpdateTaskPipelineInput['stages'],
) {
  const templateIds = new Set<string>();
  const generatedDocumentIds = new Set<string>();
  for (const stage of stages) {
    const config = getStageActionAdapter(stage.actionType).parseConfig({
      ...(stage.actionConfig ?? {}),
      checklistItems: stage.checklistItems,
    });
    if (stage.actionType === 'DOCUMENT_GENERATION') {
      const configuredTemplateIds = Array.isArray(config.templateIds)
        ? config.templateIds.filter((templateId): templateId is string => typeof templateId === 'string')
        : typeof config.templateId === 'string'
          ? [config.templateId]
          : [];
      configuredTemplateIds.forEach((templateId) => templateIds.add(templateId));
    }
    if (stage.actionType === 'ESIGNING' && typeof config.generatedDocumentId === 'string') {
      generatedDocumentIds.add(config.generatedDocumentId);
    }
  }
  if (templateIds.size > 0) {
    const templates = await tx.documentTemplate.findMany({
      where: {
        tenantId,
        id: { in: [...templateIds] },
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (templates.length !== templateIds.size) {
      throw new NotFoundError('Document template must be active in this workspace');
    }
  }
  if (generatedDocumentIds.size > 0) {
    const documents = await tx.generatedDocument.findMany({
      where: {
        tenantId,
        id: { in: [...generatedDocumentIds] },
        status: 'FINALIZED',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (documents.length !== generatedDocumentIds.size) {
      throw new NotFoundError('E-signing document must be finalized in this workspace');
    }
  }
}

async function getPersistedPipelineDetail(
  tx: Prisma.TransactionClient,
  tenantId: string,
  pipelineId: string,
) {
  const pipeline = await tx.taskPipeline.findFirst({
    where: { id: pipelineId, tenantId, deletedAt: null },
    include: pipelineDetailInclude,
  });
  if (!pipeline) {
    throw new NotFoundError('Task pipeline not found after mutation');
  }
  return pipeline;
}

async function publishVersion(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    pipelineId: string;
    version: number;
    stages: ParsedCreateTaskPipelineInput['stages'] | ParsedUpdateTaskPipelineInput['stages'];
  },
) {
  const version = await tx.taskPipelineVersion.create({
    data: {
      tenantId: params.tenantId,
      pipelineId: params.pipelineId,
      version: params.version,
      publishedAt: null,
    },
  });

  await tx.taskPipelineStage.createMany({
    data: stageCreateManyData(params.tenantId, version.id, params.stages),
  });

  return tx.taskPipelineVersion.update({
    where: { id: version.id },
    data: { publishedAt: new Date() },
  });
}

export async function createTaskPipeline(
  tenantId: string,
  input: CreateTaskPipelineInput,
  userId?: string,
) {
  const parsed = createTaskPipelineSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    await validateStageConfigs(tx, tenantId, parsed.stages);
    const pipeline = await tx.taskPipeline.create({
      data: {
        tenantId,
        name: parsed.name,
        description: parsed.description ?? null,
      },
    });
    await publishVersion(tx, {
      tenantId,
      pipelineId: pipeline.id,
      version: 1,
      stages: parsed.stages,
    });

    await createAuditLog({
      tenantId,
      userId,
      action: 'CREATE',
      entityType: 'TaskPipeline',
      entityId: pipeline.id,
      entityName: pipeline.name,
      summary: `Created task pipeline "${pipeline.name}"`,
      metadata: { version: 1, stageCount: parsed.stages.length },
    }, tx);

    return getPersistedPipelineDetail(tx, tenantId, pipeline.id);
  });
}

async function requirePipelineForUpdate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  pipelineId: string,
) {
  const pipeline = await tx.taskPipeline.findFirst({
    where: { id: pipelineId, tenantId, deletedAt: null },
    include: {
      versions: {
        where: { publishedAt: { not: null } },
        orderBy: { version: 'desc' },
        take: 1,
        include: { stages: { orderBy: { position: 'asc' } } },
      },
    },
  });

  if (!pipeline) {
    throw new NotFoundError('Task pipeline not found');
  }

  return pipeline;
}

export async function updateTaskPipeline(
  tenantId: string,
  pipelineId: string,
  input: UpdateTaskPipelineInput,
  userId?: string,
) {
  const parsed = updateTaskPipelineSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    await validateStageConfigs(tx, tenantId, parsed.stages);
    await lockTaskPipelineForUpdate(tx, tenantId, pipelineId);
    const existing = await requirePipelineForUpdate(tx, tenantId, pipelineId);
    const nextVersion = (existing.versions[0]?.version ?? 0) + 1;
    await tx.taskPipeline.update({
      where: { id: existing.id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      },
    });
    await publishVersion(tx, {
      tenantId,
      pipelineId: existing.id,
      version: nextVersion,
      stages: parsed.stages,
    });

    await createAuditLog({
      tenantId,
      userId,
      action: 'UPDATE',
      entityType: 'TaskPipeline',
      entityId: existing.id,
      entityName: parsed.name ?? existing.name,
      summary: `Published task pipeline version ${nextVersion}`,
      metadata: { version: nextVersion, stageCount: parsed.stages.length },
    }, tx);

    return getPersistedPipelineDetail(tx, tenantId, existing.id);
  });
}

export async function duplicateTaskPipeline(
  tenantId: string,
  pipelineId: string,
  input: { name?: string } = {},
  userId?: string,
) {
  const parsed = duplicateTaskPipelineSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const source = await requirePipelineForUpdate(tx, tenantId, pipelineId);
    const sourceVersion = source.versions[0];
    if (!sourceVersion) {
      throw new NotFoundError('Published task pipeline version not found');
    }

    const duplicateStages = sourceVersion.stages.map((stage, position) => {
      const actionConfig = stage.actionConfig
        && typeof stage.actionConfig === 'object'
        && !Array.isArray(stage.actionConfig)
        ? stage.actionConfig as Record<string, unknown>
        : {};
      const checklistItems = Array.isArray(actionConfig.checklistItems)
        ? actionConfig.checklistItems.flatMap((item, itemPosition) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const label = typeof item.label === 'string' ? item.label.trim() : '';
          return label ? [{ label, position: itemPosition }] : [];
        })
        : [];

      return {
        name: stage.name,
        description: stage.description,
        position,
        actionType: stage.actionType,
        icon: stage.icon,
        isRequired: stage.isRequired,
        actionConfig,
        checklistItems,
      };
    });
    const parsedDuplicateStages = createTaskPipelineSchema.parse({
      name: source.name,
      description: source.description,
      stages: duplicateStages,
    }).stages;
    await validateStageConfigs(tx, tenantId, parsedDuplicateStages);
    const pipeline = await tx.taskPipeline.create({
      data: {
        tenantId,
        name: parsed.name ?? `${source.name} (Copy)`,
        description: source.description,
      },
    });
    await publishVersion(tx, {
      tenantId,
      pipelineId: pipeline.id,
      version: 1,
      stages: parsedDuplicateStages,
    });

    await createAuditLog({
      tenantId,
      userId,
      action: 'CREATE',
      entityType: 'TaskPipeline',
      entityId: pipeline.id,
      entityName: pipeline.name,
      summary: `Duplicated task pipeline "${source.name}"`,
      metadata: { sourcePipelineId: source.id },
    }, tx);

    return getPersistedPipelineDetail(tx, tenantId, pipeline.id);
  });
}

export async function archiveTaskPipeline(
  tenantId: string,
  pipelineId: string,
  reason: string,
  userId?: string,
) {
  const parsed = archiveTaskPipelineSchema.parse({ reason });

  return prisma.$transaction(async (tx) => {
    const existing = await requirePipelineForUpdate(tx, tenantId, pipelineId);
    const archived = await tx.taskPipeline.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), deletedReason: parsed.reason },
    });

    await createAuditLog({
      tenantId,
      userId,
      action: 'DELETE',
      entityType: 'TaskPipeline',
      entityId: existing.id,
      entityName: existing.name,
      reason: parsed.reason,
      summary: `Archived task pipeline "${existing.name}"`,
    }, tx);

    return archived;
  });
}
