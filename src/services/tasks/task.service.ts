import {
  Prisma,
  TaskStageStatus,
  TaskStatus,
  type TaskStatus as TaskStatusValue,
} from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  archiveTaskSchema,
  createTaskSchema,
  updateTaskMetadataSchema,
  type CreateTaskInput,
  type UpdateTaskMetadataInput,
} from '@/lib/validations/task';
import { deriveTaskStatus } from './status';
import { lockTaskForUpdate } from './locking';
import { queueTaskEsigningPreparationsForTask } from './esigning-preparation.service';
import {
  getTaskStageDetail,
  synchronizeCompanyProfileStages,
} from './stage.service';
import type { ChecklistDefinition, TaskListItem } from './types';

const log = createLogger('tasks:task');

async function safelyQueueTaskEsigningPreparation(
  tenantId: string,
  taskId: string,
  userId?: string,
) {
  try {
    await queueTaskEsigningPreparationsForTask(tenantId, taskId, userId);
  } catch (error) {
    log.warn('Failed to queue E-signing preparation after task metadata change', {
      taskId,
      error,
    });
  }
}

const taskPublicSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { id: true, name: true } },
  owner: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
  pipelineVersion: {
    select: {
      id: true,
      version: true,
      pipeline: { select: { id: true, name: true } },
    },
  },
  stages: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      name: true,
      position: true,
      actionType: true,
      icon: true,
      isRequired: true,
      status: true,
    },
  },
} satisfies Prisma.TaskSelect;

type PublicTaskRecord = Prisma.TaskGetPayload<{ select: typeof taskPublicSelect }>;

export function toPublicTaskDto(task: PublicTaskRecord): TaskListItem {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: task.dueDate?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    company: task.company ? { id: task.company.id, name: task.company.name } : null,
    owner: task.owner
      ? {
        id: task.owner.id,
        firstName: task.owner.firstName,
        lastName: task.owner.lastName,
        email: task.owner.email,
      }
      : null,
    pipelineVersion: {
      id: task.pipelineVersion.id,
      version: task.pipelineVersion.version,
      pipeline: {
        id: task.pipelineVersion.pipeline.id,
        name: task.pipelineVersion.pipeline.name,
      },
    },
    stages: task.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      position: stage.position,
      actionType: stage.actionType,
      icon: stage.icon,
      isRequired: stage.isRequired,
      status: stage.status,
    })),
  };
}

export interface ListTasksOptions {
  includeDeleted?: boolean;
  status?: TaskStatusValue;
  companyId?: string;
  ownerId?: string;
  accessibleCompanyIds?: string[];
}

export type TaskDueBucket = 'today' | 'thisWeek' | 'nextWeek' | 'overdue';
export type TaskSortField =
  | 'title'
  | 'company'
  | 'pipeline'
  | 'owner'
  | 'status'
  | 'dueDate'
  | 'createdAt'
  | 'updatedAt';

export interface SearchTasksOptions {
  query?: string;
  title?: string;
  ownerQuery?: string;
  pipelineId?: string;
  companyId?: string;
  ownerId?: string;
  status?: TaskStatusValue;
  dueBucket?: TaskDueBucket;
  dueDateFrom?: string;
  dueDateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: TaskSortField;
  sortOrder?: Prisma.SortOrder;
  accessibleCompanyIds?: string[];
}

export async function listTasks(tenantId: string, options: ListTasksOptions = {}) {
  const tasks = await prisma.task.findMany({
    where: {
      tenantId,
      ...(options.includeDeleted ? {} : { deletedAt: null }),
      ...(options.status ? { status: options.status } : {}),
      ...(options.companyId ? { companyId: options.companyId } : {}),
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      ...(options.accessibleCompanyIds
        ? {
          AND: [{
            companyId: { in: options.accessibleCompanyIds },
          }],
        }
        : {}),
    },
    select: taskPublicSelect,
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
  });
  return tasks.map(toPublicTaskDto);
}

function addUtcDays(value: Date, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function singaporeCalendarStart(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: 'year' | 'month' | 'day') => (
    Number(parts.find((part) => part.type === type)?.value)
  );
  return new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
}

function dueDateFilter(bucket: TaskDueBucket, now = new Date()): Prisma.DateTimeNullableFilter {
  const today = singaporeCalendarStart(now);
  const tomorrow = addUtcDays(today, 1);

  if (bucket === 'overdue') return { lt: today };
  if (bucket === 'today') return { gte: today, lt: tomorrow };
  if (bucket === 'thisWeek') return { gte: tomorrow, lt: addUtcDays(today, 8) };
  return { gte: addUtcDays(today, 8), lt: addUtcDays(today, 15) };
}

function dueDateRangeFilter(
  dueDateFrom?: string,
  dueDateTo?: string,
): Prisma.DateTimeNullableFilter | undefined {
  if (!dueDateFrom && !dueDateTo) return undefined;

  return {
    ...(dueDateFrom
      ? { gte: new Date(`${dueDateFrom}T00:00:00.000Z`) }
      : {}),
    ...(dueDateTo
      ? { lt: addUtcDays(new Date(`${dueDateTo}T00:00:00.000Z`), 1) }
      : {}),
  };
}

function taskOrderBy(
  sortBy: TaskSortField,
  sortOrder: Prisma.SortOrder,
): Prisma.TaskOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'company':
      return [{ company: { name: sortOrder } }, { createdAt: 'desc' }];
    case 'pipeline':
      return [
        { pipelineVersion: { pipeline: { name: sortOrder } } },
        { createdAt: 'desc' },
      ];
    case 'owner':
      return [
        { owner: { firstName: sortOrder } },
        { owner: { lastName: sortOrder } },
        { createdAt: 'desc' },
      ];
    case 'dueDate':
      return [
        { dueDate: { sort: sortOrder, nulls: 'last' } },
        { createdAt: 'desc' },
      ];
    default:
      return [{ [sortBy]: sortOrder }, { createdAt: 'desc' }];
  }
}

export function buildTaskWhere(
  tenantId: string,
  options: SearchTasksOptions = {},
): Prisma.TaskWhereInput {
  const query = options.query?.trim();
  const title = options.title?.trim();
  const ownerQuery = options.ownerQuery?.trim();
  const dueRange = dueDateRangeFilter(options.dueDateFrom, options.dueDateTo);
  const additionalFilters: Prisma.TaskWhereInput[] = [];

  if (options.accessibleCompanyIds) {
    additionalFilters.push({
      companyId: { in: options.accessibleCompanyIds },
    });
  }
  if (ownerQuery) {
    additionalFilters.push({
      OR: [
        { owner: { firstName: { contains: ownerQuery, mode: 'insensitive' } } },
        { owner: { lastName: { contains: ownerQuery, mode: 'insensitive' } } },
        { owner: { email: { contains: ownerQuery, mode: 'insensitive' } } },
      ],
    });
  }
  if (query) {
    additionalFilters.push({
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { company: { name: { contains: query, mode: 'insensitive' } } },
        {
          pipelineVersion: {
            pipeline: { name: { contains: query, mode: 'insensitive' } },
          },
        },
        { owner: { firstName: { contains: query, mode: 'insensitive' } } },
        { owner: { lastName: { contains: query, mode: 'insensitive' } } },
        { owner: { email: { contains: query, mode: 'insensitive' } } },
      ],
    });
  }

  return {
    tenantId,
    deletedAt: null,
    ...(title ? { title: { contains: title, mode: 'insensitive' } } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.companyId ? { companyId: options.companyId } : {}),
    ...(options.ownerId ? { ownerId: options.ownerId } : {}),
    ...(options.pipelineId
      ? { pipelineVersion: { pipelineId: options.pipelineId } }
      : {}),
    ...(options.dueBucket
      ? { dueDate: dueDateFilter(options.dueBucket) }
      : dueRange
        ? { dueDate: dueRange }
        : {}),
    ...(additionalFilters.length > 0 ? { AND: additionalFilters } : {}),
  };
}

export async function searchTasks(
  tenantId: string,
  options: SearchTasksOptions = {},
) {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const where = buildTaskWhere(tenantId, options);

  const [tasks, total] = await prisma.$transaction([
    prisma.task.findMany({
      where,
      select: taskPublicSelect,
      orderBy: taskOrderBy(
        options.sortBy ?? 'dueDate',
        options.sortOrder ?? 'asc',
      ),
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.task.count({ where }),
  ]);

  return {
    tasks: tasks.map(toPublicTaskDto),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getTask(
  tenantId: string,
  taskId: string,
  actorUserId?: string,
) {
  const initial = await prisma.task.findFirst({
    where: { id: taskId, tenantId, deletedAt: null },
    select: taskPublicSelect,
  });
  if (!initial) {
    throw new NotFoundError('Task not found');
  }
  for (const stage of initial.stages.slice(0, 100)) {
    if (stage.actionType !== 'MANUAL') {
      await getTaskStageDetail(tenantId, taskId, stage.id, actorUserId);
    }
  }
  const reconciled = await prisma.task.findFirst({
    where: { id: taskId, tenantId, deletedAt: null },
    select: taskPublicSelect,
  });
  if (!reconciled) throw new NotFoundError('Task not found');
  return toPublicTaskDto(reconciled);
}

function checklistDefinitions(actionConfig: Prisma.JsonValue | null): ChecklistDefinition[] {
  if (!actionConfig || typeof actionConfig !== 'object' || Array.isArray(actionConfig)) {
    return [];
  }
  const definitions = actionConfig.checklistItems;
  if (!Array.isArray(definitions)) {
    return [];
  }
  return definitions.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) {
      return [];
    }
    return [{ label, position: typeof item.position === 'number' ? item.position : index }];
  });
}

async function validateTaskRelations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  companyId?: string | null,
  ownerId?: string | null,
) {
  if (companyId) {
    const company = await tx.company.findFirst({
      where: { id: companyId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new NotFoundError('Company not found');
  }
  if (ownerId) {
    const owner = await tx.user.findFirst({
      where: { id: ownerId, tenantId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!owner) throw new NotFoundError('Task owner not found');
  }
}

export async function createTask(
  tenantId: string,
  input: CreateTaskInput,
  userId?: string,
) {
  const parsed = createTaskSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const version = await tx.taskPipelineVersion.findFirst({
      where: {
        id: parsed.pipelineVersionId,
        tenantId,
        publishedAt: { not: null },
        pipeline: { deletedAt: null },
      },
      include: { stages: { orderBy: { position: 'asc' } } },
    });
    if (!version) {
      throw new NotFoundError('Published task pipeline version not found');
    }

    await validateTaskRelations(tx, tenantId, parsed.companyId, parsed.ownerId);

    const task = await tx.task.create({
      data: {
        tenantId,
        pipelineVersionId: version.id,
        title: parsed.title,
        description: parsed.description ?? null,
        companyId: parsed.companyId ?? null,
        ownerId: parsed.ownerId ?? null,
        dueDate: parsed.dueDate ?? null,
        status: TaskStatus.NOT_STARTED,
        snapshotLockedAt: null,
      },
    });

    for (const pipelineStage of version.stages) {
      const stage = await tx.taskStage.create({
        data: {
          tenantId,
          taskId: task.id,
          name: pipelineStage.name,
          description: pipelineStage.description,
          position: pipelineStage.position,
          actionType: pipelineStage.actionType,
          icon: pipelineStage.icon,
          isRequired: pipelineStage.isRequired,
          actionConfig: pipelineStage.actionConfig ?? Prisma.JsonNull,
          status: TaskStageStatus.NOT_STARTED,
        },
      });
      const checklist = checklistDefinitions(pipelineStage.actionConfig);
      if (checklist.length > 0) {
        await tx.taskStageChecklistItem.createMany({
          data: checklist.map((item) => ({
            tenantId,
            taskStageId: stage.id,
            label: item.label,
            position: item.position,
          })),
        });
      }
    }

    if (parsed.companyId) {
      await synchronizeCompanyProfileStages(tx, {
        tenantId,
        taskId: task.id,
        companyId: parsed.companyId,
        currentTaskStatus: TaskStatus.NOT_STARTED,
        userId,
      });
    }

    const lockedTask = await tx.task.update({
      where: { id: task.id },
      data: { snapshotLockedAt: new Date() },
      select: taskPublicSelect,
    });

    await createAuditLog({
      tenantId,
      userId,
      companyId: parsed.companyId ?? undefined,
      action: 'CREATE',
      entityType: 'Task',
      entityId: task.id,
      entityName: task.title,
      summary: `Created task "${task.title}"`,
      metadata: {
        pipelineVersionId: version.id,
        stageCount: version.stages.length,
      },
    }, tx);

    return toPublicTaskDto(lockedTask);
  });
}

async function requireTask(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
) {
  const task = await tx.task.findFirst({
    where: { id: taskId, tenantId, deletedAt: null },
    include: { stages: { select: { status: true } } },
  });
  if (!task) throw new NotFoundError('Task not found');
  return task;
}

export async function updateTaskMetadata(
  tenantId: string,
  taskId: string,
  input: UpdateTaskMetadataInput,
  userId?: string,
) {
  const parsed = updateTaskMetadataSchema.parse(input);
  const updated = await prisma.$transaction(async (tx) => {
    const lockedTask = await lockTaskForUpdate(tx, tenantId, taskId);
    const existing = await requireTask(tx, tenantId, taskId);
    await validateTaskRelations(tx, tenantId, parsed.companyId, parsed.ownerId);
    if (parsed.companyId !== undefined) {
      await synchronizeCompanyProfileStages(tx, {
        tenantId,
        taskId: existing.id,
        companyId: parsed.companyId ?? null,
        currentTaskStatus: lockedTask.status,
        userId,
      });
    }
    const updated = await tx.task.update({
      where: { id: existing.id },
      data: parsed,
      select: taskPublicSelect,
    });
    await createAuditLog({
      tenantId,
      userId,
      companyId: updated.company?.id ?? undefined,
      action: 'UPDATE',
      entityType: 'Task',
      entityId: existing.id,
      entityName: updated.title,
      summary: `Updated task "${updated.title}"`,
    }, tx);
    return toPublicTaskDto(updated);
  });
  await safelyQueueTaskEsigningPreparation(tenantId, taskId, userId);
  return updated;
}

export async function archiveTask(
  tenantId: string,
  taskId: string,
  reason: string,
  userId?: string,
) {
  const parsed = archiveTaskSchema.parse({ reason });
  return prisma.$transaction(async (tx) => {
    const existing = await requireTask(tx, tenantId, taskId);
    const archived = await tx.task.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), deletedReason: parsed.reason },
    });
    await createAuditLog({
      tenantId,
      userId,
      companyId: existing.companyId ?? undefined,
      action: 'DELETE',
      entityType: 'Task',
      entityId: existing.id,
      entityName: existing.title,
      reason: parsed.reason,
      summary: `Archived task "${existing.title}"`,
    }, tx);
    return archived;
  });
}

async function setTaskStatus(
  tenantId: string,
  taskId: string,
  status: TaskStatusValue | 'RESUME',
  userId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await lockTaskForUpdate(tx, tenantId, taskId);
    if (status === TaskStatus.PAUSED) {
      if (
        existing.status === TaskStatus.PAUSED
        || existing.status === TaskStatus.COMPLETED
        || existing.status === TaskStatus.CANCELLED
      ) {
        throw new ValidationError(`Cannot pause a ${existing.status} task`);
      }
    } else if (status === TaskStatus.CANCELLED) {
      if (
        existing.status === TaskStatus.COMPLETED
        || existing.status === TaskStatus.CANCELLED
      ) {
        throw new ValidationError(`Cannot cancel a ${existing.status} task`);
      }
    } else if (existing.status !== TaskStatus.PAUSED) {
      throw new ValidationError('Only PAUSED tasks can be resumed');
    }

    const nextStatus = status === 'RESUME'
      ? deriveTaskStatus(await tx.taskStage.findMany({
        where: { tenantId, taskId: existing.id },
        select: { status: true },
      }))
      : status;
    const updated = await tx.task.update({
      where: { id: existing.id },
      data: { status: nextStatus },
      select: taskPublicSelect,
    });
    await createAuditLog({
      tenantId,
      userId,
      companyId: existing.companyId ?? undefined,
      action: 'UPDATE',
      entityType: 'Task',
      entityId: existing.id,
      entityName: existing.title,
      summary: `Changed task status to ${nextStatus}`,
      metadata: { previousStatus: existing.status, status: nextStatus },
    }, tx);
    return toPublicTaskDto(updated);
  });
}

export const pauseTask = (tenantId: string, taskId: string, userId?: string) => (
  setTaskStatus(tenantId, taskId, TaskStatus.PAUSED, userId)
);
export const resumeTask = (tenantId: string, taskId: string, userId?: string) => (
  setTaskStatus(tenantId, taskId, 'RESUME', userId)
);
export const cancelTask = (tenantId: string, taskId: string, userId?: string) => (
  setTaskStatus(tenantId, taskId, TaskStatus.CANCELLED, userId)
);
