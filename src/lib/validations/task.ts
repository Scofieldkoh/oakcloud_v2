import { z } from 'zod';

const optionalUuid = z.string().uuid().nullable().optional();
const optionalDueDate = z.string().date().transform(
  (value) => new Date(`${value}T00:00:00.000Z`),
).nullable().optional();

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  pipelineVersionId: z.string().uuid(),
  description: z.string().trim().max(5000).nullable().optional(),
  companyId: optionalUuid,
  ownerId: optionalUuid,
  dueDate: optionalDueDate,
});

export const updateTaskMetadataSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  companyId: optionalUuid,
  ownerId: optionalUuid,
  dueDate: optionalDueDate,
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one task field is required',
});

export const archiveTaskSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export const taskStageMetadataSchema = z.object({
  notes: z.string().trim().max(5000).nullable().optional(),
  assigneeId: optionalUuid,
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one stage field is required',
});

export const taskStageSkipSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export const taskStageChecklistUpdateSchema = z.object({
  isCompleted: z.boolean(),
});

export const taskStageOutcomeSchema = z.object({
  type: z.enum(['COMPANY', 'GENERATED_DOCUMENT', 'ESIGNING_ENVELOPE']),
  companyId: optionalUuid,
  generatedDocumentId: optionalUuid,
  esigningEnvelopeId: optionalUuid,
}).superRefine((value, context) => {
  const links = [
    value.companyId,
    value.generatedDocumentId,
    value.esigningEnvelopeId,
  ].filter((link): link is string => Boolean(link));

  if (links.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Exactly one outcome entity is required',
    });
  }
});

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type ParsedCreateTaskInput = z.output<typeof createTaskSchema>;
export type UpdateTaskMetadataInput = z.input<typeof updateTaskMetadataSchema>;
export type TaskStageOutcomeInput = z.input<typeof taskStageOutcomeSchema>;
