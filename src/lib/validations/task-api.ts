import { z } from 'zod';
import {
  taskStageChecklistUpdateSchema,
  taskStageOutcomeSchema,
  taskStageSkipSchema,
} from './task';

const uuid = z.string().uuid();

export const taskPipelineListQuerySchema = z.object({
  includeArchived: z.enum(['true', 'false']).optional(),
}).transform(({ includeArchived }) => ({
  includeArchived: includeArchived === 'true',
}));

export const taskPipelineRouteParamsSchema = z.object({
  id: uuid,
});

export const taskRouteParamsSchema = z.object({
  id: uuid,
});

export const taskStageRouteParamsSchema = z.object({
  taskId: uuid,
  stageId: uuid,
});

export const taskListQuerySchema = z.object({
  query: z.string().trim().min(1).max(300).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  ownerQuery: z.string().trim().min(1).max(300).optional(),
  pipelineId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  status: z.enum([
    'NOT_STARTED',
    'IN_PROGRESS',
    'PAUSED',
    'COMPLETED',
    'CANCELLED',
  ]).optional(),
  dueBucket: z.enum(['today', 'thisWeek', 'nextWeek', 'overdue']).optional(),
  dueDateFrom: z.string().date().optional(),
  dueDateTo: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  sortBy: z.enum([
    'title',
    'company',
    'pipeline',
    'owner',
    'status',
    'dueDate',
    'createdAt',
    'updatedAt',
  ]).default('dueDate'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const taskStatusTransitionSchema = z.object({
  action: z.enum(['pause', 'resume', 'cancel']),
});

export const taskStageTransitionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('complete') }),
  z.object({ action: z.literal('reopen') }),
  taskStageSkipSchema.extend({ action: z.literal('skip') }),
  taskStageChecklistUpdateSchema.extend({
    action: z.literal('checklist'),
    checklistItemId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('linkOutcome'),
    outcome: taskStageOutcomeSchema,
  }),
  z.object({ action: z.literal('reconcile') }),
]);

export type TaskListQueryInput = z.input<typeof taskListQuerySchema>;
export type ParsedTaskListQuery = z.output<typeof taskListQuerySchema>;
export type TaskStatusTransitionInput = z.input<typeof taskStatusTransitionSchema>;
export type TaskStageTransitionInput = z.input<typeof taskStageTransitionSchema>;
