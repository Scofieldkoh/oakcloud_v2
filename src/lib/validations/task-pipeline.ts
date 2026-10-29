import { z } from 'zod';

const actionTypes = [
  'MANUAL',
  'COMPANY_PROFILE',
  'DOCUMENT_GENERATION',
  'ESIGNING',
] as const;

export const DEFAULT_STAGE_ICONS = {
  MANUAL: 'CircleCheckBig',
  COMPANY_PROFILE: 'Building2',
  DOCUMENT_GENERATION: 'FileText',
  ESIGNING: 'PenLine',
} as const;

export const CURATED_TASK_STAGE_ICONS = [
  'CircleCheckBig',
  'Building2',
  'FileText',
  'PenLine',
  'CheckSquare',
  'Mail',
] as const;

export const taskChecklistDefinitionSchema = z.object({
  label: z.string().trim().min(1).max(300),
  position: z.number().int().nonnegative().optional(),
}).strict();

export const taskPipelineStageSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  position: z.number().int().nonnegative().optional(),
  actionType: z.enum(actionTypes),
  icon: z.enum(CURATED_TASK_STAGE_ICONS).optional(),
  isRequired: z.boolean().optional().default(true),
  actionConfig: z.record(z.unknown()).nullable().optional(),
  checklistItems: z.array(taskChecklistDefinitionSchema).optional().default([]),
}).strict();

function normalizeStages(stages: z.infer<typeof taskPipelineStageSchema>[]) {
  return stages.map((stage, position) => ({
    ...stage,
    position,
    icon: stage.icon ?? DEFAULT_STAGE_ICONS[stage.actionType],
    checklistItems: stage.checklistItems.map((item, itemPosition) => ({
      ...item,
      position: itemPosition,
    })),
  }));
}

export const createTaskPipelineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  stages: z.array(taskPipelineStageSchema).min(1).max(100),
}).transform((value) => ({
  ...value,
  stages: normalizeStages(value.stages),
}));

export const updateTaskPipelineSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  stages: z.array(taskPipelineStageSchema).min(1).max(100),
}).transform((value) => ({
  ...value,
  stages: normalizeStages(value.stages),
}));

export const duplicateTaskPipelineSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

export const archiveTaskPipelineSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export type CreateTaskPipelineInput = z.input<typeof createTaskPipelineSchema>;
export type ParsedCreateTaskPipelineInput = z.output<typeof createTaskPipelineSchema>;
export type UpdateTaskPipelineInput = z.input<typeof updateTaskPipelineSchema>;
export type ParsedUpdateTaskPipelineInput = z.output<typeof updateTaskPipelineSchema>;
