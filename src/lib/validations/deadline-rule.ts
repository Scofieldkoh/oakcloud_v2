import { z } from 'zod';
import {
  applicabilityDefinitionSchema,
  deadlineMilestoneSchema,
  deadlineParameterDefinitionSchema,
  ruleRecurrenceSchema,
  scheduleEntriesSchema,
} from './service-schedule';

const UUID = z.string().uuid();

/**
 * The mutable rule authoring payload. The date/schedule language itself is
 * intentionally owned by service-schedule so deadlines and billing cannot
 * drift into separate expression dialects.
 */
export const deadlineRuleDraftSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable(),
  recurrence: ruleRecurrenceSchema,
  applicability: applicabilityDefinitionSchema,
  parameters: z.array(deadlineParameterDefinitionSchema).max(100),
  milestones: z.array(deadlineMilestoneSchema).min(1).max(100),
  expectedDraftRevision: z.number().int().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  const parameterByKey = new Map<string, (typeof value.parameters)[number]>();
  for (const [index, parameter] of value.parameters.entries()) {
    if (parameterByKey.has(parameter.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parameters', index, 'key'],
        message: 'Parameter keys must be unique',
      });
    }
    parameterByKey.set(parameter.key, parameter);
  }

  const milestoneByKey = new Map<string, (typeof value.milestones)[number]>();
  for (const [index, milestone] of value.milestones.entries()) {
    if (milestoneByKey.has(milestone.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['milestones', index, 'key'],
        message: 'Milestone keys must be unique',
      });
    }
    milestoneByKey.set(milestone.key, milestone);
  }

  const dependencies = new Map<string, Set<string>>();
  for (const milestone of value.milestones) dependencies.set(milestone.key, new Set());

  const inspectExpression = (expression: unknown, path: Array<string | number>, seen: Set<object>) => {
    if (typeof expression !== 'object' || expression === null) return;
    if (seen.has(expression)) return;
    seen.add(expression);

    const record = expression as Record<string, unknown>;
    const source = record.source;
    if (typeof source === 'object' && source !== null) {
      const sourceRecord = source as Record<string, unknown>;
      const sourceKind = sourceRecord.kind;
      const sourceKey = sourceRecord.key;
      if ((sourceKind === 'PARAMETER' || sourceKind === 'MILESTONE' || sourceKind === 'SCHEDULE_ENTRY')
        && typeof sourceKey === 'string') {
        if (sourceKind === 'PARAMETER') {
          const parameter = parameterByKey.get(sourceKey);
          if (!parameter) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...path, 'source', 'key'],
              message: `Unknown parameter reference: ${sourceKey}`,
            });
          } else if (parameter.type !== 'DATE') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...path, 'source', 'key'],
              message: `Parameter ${sourceKey} must be a DATE parameter when used as a date source`,
            });
          }
        }
        if (sourceKind === 'MILESTONE') {
          if (!milestoneByKey.has(sourceKey)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...path, 'source', 'key'],
              message: `Unknown milestone reference: ${sourceKey}`,
            });
          } else {
            const currentKey = path[0] === 'milestones' && typeof path[1] === 'number'
              ? value.milestones[path[1]]?.key
              : undefined;
            if (currentKey) dependencies.get(currentKey)?.add(sourceKey);
          }
        }
      }
    }

    const amount = record.amount;
    const offset = record.offset;
    for (const [operand, operandName] of [[amount, 'amount'], [offset, 'offset']] as const) {
      if (typeof operand !== 'object' || operand === null) continue;
      const operandRecord = operand as Record<string, unknown>;
      if (operandRecord.kind === 'INTEGER_PARAMETER' && typeof operandRecord.key === 'string') {
        const parameter = parameterByKey.get(operandRecord.key);
        if (!parameter) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, operandName, 'key'],
            message: `Unknown parameter reference: ${operandRecord.key}`,
          });
        } else if (parameter.type !== 'INTEGER') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, operandName, 'key'],
            message: `Parameter ${operandRecord.key} must be an INTEGER parameter`,
          });
        }
      }
    }

    for (const [key, child] of Object.entries(record)) {
      if (key === 'source' || key === 'amount' || key === 'offset') continue;
      if (Array.isArray(child)) {
        child.forEach((entry, index) => inspectExpression(entry, [...path, key, index], seen));
      } else {
        inspectExpression(child, [...path, key], seen);
      }
    }
  };

  value.milestones.forEach((milestone, index) => {
    inspectExpression(milestone.expression, ['milestones', index, 'expression'], new Set());
  });

  // Validate the milestone dependency graph with a three-colour DFS. A rule
  // may reference an earlier or later milestone, but cycles are never valid.
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (key: string, stack: string[]): void => {
    const current = state.get(key) ?? 0;
    if (current === 2) return;
    if (current === 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['milestones'],
        message: `Milestone dependency cycle detected: ${[...stack, key].join(' -> ')}`,
      });
      return;
    }
    state.set(key, 1);
    for (const dependency of dependencies.get(key) ?? []) {
      if (milestoneByKey.has(dependency)) visit(dependency, [...stack, key]);
    }
    state.set(key, 2);
  };
  for (const milestone of value.milestones) visit(milestone.key, []);
});

export const serviceVariantRuleAssociationSchema = z.object({
  ruleId: UUID,
  enabledByDefault: z.boolean(),
  parameterDefaults: z.record(z.string(), z.unknown()).default({}),
  scheduleDefaults: scheduleEntriesSchema.default([]),
  displayOrder: z.number().int().min(0),
}).strict();

export const serviceVariantRuleAssociationsSchema = z.array(serviceVariantRuleAssociationSchema)
  .max(100)
  .superRefine((associations, ctx) => {
    const seen = new Set<string>();
    associations.forEach((association, index) => {
      if (seen.has(association.ruleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'ruleId'],
          message: 'Rule associations must be unique per variant',
        });
      }
      seen.add(association.ruleId);
    });
  });

export const searchDeadlineRulesSchema = z.object({
  query: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
  includeArchived: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['code', 'name', 'createdAt', 'updatedAt']).default('code'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
}).strict();

export type DeadlineRuleDraftInput = z.infer<typeof deadlineRuleDraftSchema>;
export type ServiceVariantRuleAssociationInput = z.infer<typeof serviceVariantRuleAssociationSchema>;
export type SearchDeadlineRulesInput = z.infer<typeof searchDeadlineRulesSchema>;
