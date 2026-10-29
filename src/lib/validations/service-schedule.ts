import { z } from 'zod';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_DATE_OFFSET = 3660;
const MAX_EXPRESSION_CANDIDATES = 31;
const MAX_EXPRESSION_DEPTH = 32;
const MAX_EXPRESSION_NODES = 1_000;
const MAX_APPLICABILITY_LEAVES = 50;
const MAX_APPLICABILITY_DEPTH = 5;
const MAX_APPLICABILITY_GROUP_CONDITIONS = 50;
const MAX_APPLICABILITY_GROUPS = 25;
// A legal AST has at most one semantic record per group or leaf, one
// conditions array per group, and one values array per list leaf. The sum of
// those independent maxima is a safe structural-container budget for the
// generic pre-walk while preserving the smaller semantic-node cap below.
const MAX_APPLICABILITY_STRUCTURAL_CONTAINERS =
  MAX_APPLICABILITY_GROUPS + MAX_APPLICABILITY_LEAVES
  + MAX_APPLICABILITY_GROUPS + MAX_APPLICABILITY_LEAVES;
// This cap applies to semantic AST records (groups and predicates), not their
// bounded conditions/values arrays.
const MAX_APPLICABILITY_NODES = 100;
// Every accepted applicability array is either a bounded conditions list or a
// bounded FIELD_IN/FIELD_NOT_IN values list. Applying that same bound to
// unknown arrays lets the pre-parser reject hostile payloads before Zod walks
// any of their contents.
const MAX_APPLICABILITY_ARRAY_ITEMS = MAX_APPLICABILITY_GROUP_CONDITIONS;
const MAX_APPLICABILITY_OBJECT_PROPERTIES = MAX_APPLICABILITY_GROUP_CONDITIONS;
// A valid group contributes an object and its conditions array per level,
// plus the root object. Keep enough structural headroom for that shape while
// still making malformed arbitrary nesting deterministic.
const MAX_APPLICABILITY_STRUCTURAL_DEPTH = (MAX_APPLICABILITY_DEPTH * 2) + 2;

function isRealGregorianDate(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  // Date.UTC treats years 0-99 as 1900-1999. Setting the full year after
  // construction keeps validation Gregorian and independent of the host zone.
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (year <= 99) candidate.setUTCFullYear(year);
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

export const dateOnlySchema = z.string().refine(isRealGregorianDate, {
  message: 'Expected a real Gregorian date in YYYY-MM-DD format',
});

const keySchema = z.string().trim().regex(KEY_PATTERN, {
  message: 'Keys must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens',
});

// Parameter and milestone references are stable identifiers too, but the
// published starter rules use camelCase (for example monthsAfterFye). Schedule
// entry keys remain the stricter lowercase kebab-case form above.
const referenceKeySchema = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/, {
  message: 'Reference keys must start with a letter and contain only letters, numbers, or hyphens',
});

const companyDateFieldSchema = z.enum([
  'financialYearEnd',
  'accountsDueDate',
  'incorporationDate',
]);

export const companyDateSourceFieldSchema = companyDateFieldSchema;

export const booleanCompanyFieldSchema = z.enum([
  'isGstRegistered',
  'isRegisteredCharity',
  'isIPC',
  'hasCharges',
]);

export const numericCompanyFieldSchema = z.enum([
  'currentOfficerCount',
  'currentShareholderCount',
  'annualReceiptsOrExpenditure',
]);

export const dateCompanyFieldSchema = z.enum([
  'financialYearEnd',
  'accountsDueDate',
  'incorporationDate',
  'registrationDate',
]);

export const stringCompanyFieldSchema = z.enum([
  'entityType',
  'status',
  'primarySsicCode',
  'secondarySsicCode',
  'uen',
  'name',
]);

export const companyFieldSchema = z.union([
  booleanCompanyFieldSchema,
  numericCompanyFieldSchema,
  dateCompanyFieldSchema,
  stringCompanyFieldSchema,
]);

/** Typed, whitelisted date sources. Unknown Company fields are rejected. */
export const dateSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('COMPANY_FIELD'), field: companyDateFieldSchema }).strict(),
  z.object({ kind: z.literal('CYCLE_START') }).strict(),
  z.object({ kind: z.literal('CYCLE_END') }).strict(),
  z.object({ kind: z.literal('OBLIGATION_PERIOD_START') }).strict(),
  z.object({ kind: z.literal('OBLIGATION_PERIOD_END') }).strict(),
  z.object({ kind: z.literal('PARAMETER'), key: referenceKeySchema }).strict(),
  z.object({ kind: z.literal('SCHEDULE_ENTRY'), key: keySchema }).strict(),
  z.object({ kind: z.literal('MILESTONE'), key: referenceKeySchema }).strict(),
  z.object({ kind: z.literal('CURRENT_SCHEDULE_ENTRY') }).strict(),
]);

const dateOffsetSchema = z.number().int().min(-MAX_DATE_OFFSET).max(MAX_DATE_OFFSET);
export const integerOperandSchema = z.union([
  dateOffsetSchema,
  z.object({ kind: z.literal('INTEGER_PARAMETER'), key: referenceKeySchema }).strict(),
]);
const dateUnitSchema = z.enum(['CALENDAR_DAY', 'BUSINESS_DAY']);
const businessDayAdjustmentSchema = z.enum(['NONE', 'PREVIOUS', 'NEXT']);

const relativeToSourceSchema = z.object({
  kind: z.literal('RELATIVE_TO_SOURCE'),
  source: dateSourceSchema,
  offset: integerOperandSchema,
  unit: dateUnitSchema,
}).strict();

export const scheduleEntryExpressionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('DAY_OF_MONTH'), day: z.number().int().min(1).max(31) }).strict(),
  z.object({ kind: z.literal('BUSINESS_DAY_FROM_START'), ordinal: z.number().int().min(1).max(31) }).strict(),
  z.object({ kind: z.literal('BUSINESS_DAY_FROM_END'), ordinal: z.number().int().min(1).max(31) }).strict(),
  relativeToSourceSchema,
]);

export const dateOperationSchema = z.discriminatedUnion('kind', [
  relativeToSourceSchema,
  z.object({
    kind: z.literal('ADD'),
    source: dateSourceSchema.optional(),
    offset: integerOperandSchema,
    unit: dateUnitSchema,
  }).strict(),
  z.object({
    kind: z.literal('ADD_CALENDAR_DAYS'),
    source: dateSourceSchema.optional(),
    amount: integerOperandSchema,
  }).strict(),
  z.object({
    kind: z.literal('ADD_BUSINESS_DAYS'),
    source: dateSourceSchema.optional(),
    amount: integerOperandSchema,
  }).strict(),
  z.object({
    kind: z.literal('ADD_MONTHS'),
    source: dateSourceSchema.optional(),
    amount: integerOperandSchema,
  }).strict(),
  z.object({
    kind: z.literal('ADD_MONTHS_MONTH_END'),
    source: dateSourceSchema.optional(),
    amount: integerOperandSchema,
  }).strict(),
  z.object({
    kind: z.literal('FIXED_DATE_IN_ASSESSMENT_YEAR'),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  }).strict(),
  z.object({
    kind: z.literal('FIXED_DATE_FROM_SOURCE_YEAR'),
    source: dateSourceSchema,
    yearOffset: z.number().int().min(-100).max(100),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  }).strict(),
  z.object({ kind: z.literal('ADJUST_BUSINESS_DAY'), adjustment: businessDayAdjustmentSchema }).strict(),
]);

// Milestones and schedule entries intentionally use the same constrained
// expression language. This keeps billing and deadline consumers on one DSL.
// SOURCE is the explicit direct-source form used by COALESCE candidates.
// COALESCE is recursive, but bounded at every candidate list and defended by
// the evaluator's iterative raw graph guard before Zod traverses it.
const directSourceExpressionSchema = z.object({
  kind: z.literal('SOURCE'),
  source: dateSourceSchema,
}).strict();

type DateExpressionSchemaInput =
  | z.infer<typeof scheduleEntryExpressionSchema>
  | z.infer<typeof dateOperationSchema>
  | z.infer<typeof directSourceExpressionSchema>
  | { kind: 'COALESCE'; candidates: DateExpressionSchemaInput[] };

const coalesceExpressionSchema = z.object({
  kind: z.literal('COALESCE'),
  candidates: z.array(z.lazy(() => recursiveDateExpressionSchema))
    .min(1)
    .max(MAX_EXPRESSION_CANDIDATES),
}).strict();
const recursiveDateExpressionSchema: z.ZodType<DateExpressionSchemaInput> = z.lazy(() => z.union([
  scheduleEntryExpressionSchema,
  dateOperationSchema,
  directSourceExpressionSchema,
  coalesceExpressionSchema,
]));

function guardExpressionGraph(value: unknown, ctx: z.RefinementCtx): boolean {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.value === null || typeof current.value !== 'object') continue;
    if (current.value instanceof Date || current.value instanceof Set || current.value instanceof Map) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date expressions must contain only JSON values' });
      return false;
    }
    if (seen.has(current.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date expressions cannot contain cycles or shared references' });
      return false;
    }
    if (current.depth > MAX_EXPRESSION_DEPTH) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Date expressions may be nested at most ${MAX_EXPRESSION_DEPTH} levels` });
      return false;
    }
    seen.add(current.value);
    nodes += 1;
    if (nodes > MAX_EXPRESSION_NODES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Date expressions may contain at most ${MAX_EXPRESSION_NODES} nodes` });
      return false;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_EXPRESSION_NODES) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date expression arrays exceed the structural bound' });
        return false;
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }
    if (Object.getPrototypeOf(current.value) !== Object.prototype && Object.getPrototypeOf(current.value) !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date expressions must contain only plain objects' });
      return false;
    }
    const keys = Object.keys(current.value);
    if (keys.length > MAX_EXPRESSION_NODES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date expression objects exceed the structural bound' });
      return false;
    }
    for (const key of keys) {
      stack.push({ value: (current.value as Record<string, unknown>)[key], depth: current.depth + 1 });
    }
  }
  return true;
}

const guardedDateExpressionSchema = z.preprocess((value, ctx) => {
  return guardExpressionGraph(value, ctx) ? value : z.NEVER;
}, recursiveDateExpressionSchema) as z.ZodType<DateExpressionSchemaInput>;

export const milestoneExpressionSchema = guardedDateExpressionSchema;
export const dateExpressionSchema = guardedDateExpressionSchema;

export const scheduleEntrySchema = z.object({
  key: keySchema,
  label: z.string().trim().min(1).max(100),
  expression: scheduleEntryExpressionSchema,
  businessDayAdjustment: businessDayAdjustmentSchema,
}).strict();

export const scheduleEntriesSchema = z.array(scheduleEntrySchema).max(31, 'A schedule can contain at most 31 entries').superRefine((entries, ctx) => {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'key'],
        message: 'Schedule entry keys must be unique',
      });
    }
    seen.add(entry.key);
  }
});

const monthlyRecurrenceSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('MONTHLY'),
  interval: z.number().int().min(1).max(120).optional(),
}).strict();

const quarterlyRecurrenceSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('QUARTERLY'),
  interval: z.number().int().min(1).max(120).optional(),
}).strict();

const semiAnnuallyRecurrenceSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('SEMI_ANNUALLY'),
  interval: z.number().int().min(1).max(120).optional(),
}).strict();

const annuallyRecurrenceSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('ANNUALLY'),
  interval: z.number().int().min(1).max(120).optional(),
}).strict();

const oneTimeRecurrenceSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('ONE_TIME'),
}).strict();

const customRecurrenceSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('CUSTOM'),
  interval: z.number().int().min(1).max(120),
  unit: z.literal('MONTH'),
}).strict();

export const recurrenceSchema = z.discriminatedUnion('kind', [
  monthlyRecurrenceSchema,
  quarterlyRecurrenceSchema,
  semiAnnuallyRecurrenceSchema,
  annuallyRecurrenceSchema,
  oneTimeRecurrenceSchema,
  customRecurrenceSchema,
]);

export const ruleRecurrenceSchema = recurrenceSchema;
export const recurrenceDefinitionSchema = recurrenceSchema;

// Keep predicate branches field-specific instead of applying a broad scalar
// schema followed by refinement. This makes both runtime parsing and the
// inferred/public TypeScript AST reject the same invalid field/value pairs.
const applicabilityPredicateBaseSchema = z.union([
  z.object({ kind: z.literal('FIELD_EQUALS'), field: booleanCompanyFieldSchema, value: z.boolean() }).strict(),
  z.object({ kind: z.literal('FIELD_EQUALS'), field: numericCompanyFieldSchema, value: z.number().finite() }).strict(),
  z.object({ kind: z.literal('FIELD_EQUALS'), field: dateCompanyFieldSchema, value: dateOnlySchema }).strict(),
  z.object({ kind: z.literal('FIELD_EQUALS'), field: stringCompanyFieldSchema, value: z.string() }).strict(),
  z.object({ kind: z.literal('FIELD_NOT_EQUALS'), field: booleanCompanyFieldSchema, value: z.boolean() }).strict(),
  z.object({ kind: z.literal('FIELD_NOT_EQUALS'), field: numericCompanyFieldSchema, value: z.number().finite() }).strict(),
  z.object({ kind: z.literal('FIELD_NOT_EQUALS'), field: dateCompanyFieldSchema, value: dateOnlySchema }).strict(),
  z.object({ kind: z.literal('FIELD_NOT_EQUALS'), field: stringCompanyFieldSchema, value: z.string() }).strict(),
  z.object({
    kind: z.literal('FIELD_IN'), field: booleanCompanyFieldSchema,
    values: z.array(z.boolean()).min(1).max(MAX_APPLICABILITY_LEAVES),
  }).strict(),
  z.object({
    kind: z.literal('FIELD_IN'), field: numericCompanyFieldSchema,
    values: z.array(z.number().finite()).min(1).max(MAX_APPLICABILITY_LEAVES),
  }).strict(),
  z.object({
    kind: z.literal('FIELD_IN'), field: dateCompanyFieldSchema,
    values: z.array(dateOnlySchema).min(1).max(MAX_APPLICABILITY_LEAVES),
  }).strict(),
  z.object({
    kind: z.literal('FIELD_IN'), field: stringCompanyFieldSchema,
    values: z.array(z.string()).min(1).max(MAX_APPLICABILITY_LEAVES),
  }).strict(),
  z.object({
    kind: z.literal('FIELD_NOT_IN'), field: booleanCompanyFieldSchema,
    values: z.array(z.boolean()).min(1).max(MAX_APPLICABILITY_LEAVES),
  }).strict(),
  z.object({
    kind: z.literal('FIELD_NOT_IN'), field: numericCompanyFieldSchema,
    values: z.array(z.number().finite()).min(1).max(MAX_APPLICABILITY_LEAVES),
  }).strict(),
  z.object({
    kind: z.literal('FIELD_NOT_IN'), field: dateCompanyFieldSchema,
    values: z.array(dateOnlySchema).min(1).max(MAX_APPLICABILITY_LEAVES),
  }).strict(),
  z.object({
    kind: z.literal('FIELD_NOT_IN'), field: stringCompanyFieldSchema,
    values: z.array(z.string()).min(1).max(MAX_APPLICABILITY_LEAVES),
  }).strict(),
  z.object({ kind: z.literal('FIELD_TRUE'), field: booleanCompanyFieldSchema }).strict(),
  z.object({ kind: z.literal('FIELD_FALSE'), field: booleanCompanyFieldSchema }).strict(),
  z.object({ kind: z.literal('FIELD_PRESENT'), field: companyFieldSchema }).strict(),
  z.object({ kind: z.literal('FIELD_MISSING'), field: companyFieldSchema }).strict(),
  z.object({
    kind: z.literal('FIELD_COMPARE'), field: numericCompanyFieldSchema,
    operator: z.enum(['GT', 'GTE', 'LT', 'LTE']), value: z.number().finite(),
  }).strict(),
  z.object({
    kind: z.literal('FIELD_COMPARE'), field: dateCompanyFieldSchema,
    operator: z.enum(['GT', 'GTE', 'LT', 'LTE']), value: dateOnlySchema,
  }).strict(),
]);

export const applicabilityPredicateSchema = applicabilityPredicateBaseSchema;

type ApplicabilityNode = z.infer<typeof applicabilityPredicateSchema> | {
  kind: 'ALL' | 'ANY';
  conditions: ApplicabilityNode[];
};

const applicabilityNodeSchema: z.ZodType<ApplicabilityNode> = z.lazy(() => z.union([
  applicabilityPredicateSchema,
  z.object({
    kind: z.enum(['ALL', 'ANY']),
    conditions: z.array(applicabilityNodeSchema).max(MAX_APPLICABILITY_GROUP_CONDITIONS),
  }).strict(),
]));

type ApplicabilityGuardIssue = { path: Array<string | number>; message: string };

function isApplicabilityContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/**
 * Inspect untrusted JSON iteratively before the recursive Zod AST parser is
 * entered. This keeps malformed depth/size input from exhausting the JS call
 * stack or consuming unbounded work.
 */
function guardRawApplicabilityInput(input: unknown): ApplicabilityGuardIssue | null {
  if (!isApplicabilityContainer(input)) return null;
  const stack: Array<{
    node: unknown;
    path: Array<string | number>;
    depth: number;
    groupDepth: number;
  }> = [
    { node: input, path: [], depth: 0, groupDepth: 0 },
  ];
  const seen = new WeakSet<object>();
  let structuralContainers = 0;
  let semanticNodes = 0;
  let leaves = 0;
  let groups = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!isApplicabilityContainer(current.node)) continue;
    if (seen.has(current.node)) {
      return { path: current.path, message: 'Applicability definitions cannot contain cycles' };
    }
    seen.add(current.node);

    structuralContainers += 1;
    if (structuralContainers > MAX_APPLICABILITY_STRUCTURAL_CONTAINERS) {
      return {
        path: current.path,
        message: `Applicability structures may contain at most ${MAX_APPLICABILITY_STRUCTURAL_CONTAINERS} containers`,
      };
    }
    if (current.depth > MAX_APPLICABILITY_STRUCTURAL_DEPTH) {
      return {
        path: current.path,
        message: `Applicability structures may be nested at most ${MAX_APPLICABILITY_STRUCTURAL_DEPTH} levels`,
      };
    }

    if (Array.isArray(current.node)) {
      if (current.node.length > MAX_APPLICABILITY_ARRAY_ITEMS) {
        const label = current.path[current.path.length - 1] === 'conditions' ? 'conditions' : 'values';
        return {
          path: current.path,
          message: `Applicability arrays may contain at most ${MAX_APPLICABILITY_ARRAY_ITEMS} ${label}`,
        };
      }
      for (let index = current.node.length - 1; index >= 0; index -= 1) {
        stack.push({
          node: current.node[index],
          path: [...current.path, index],
          depth: current.depth + 1,
          groupDepth: current.groupDepth,
        });
      }
      continue;
    }

    const record = current.node as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > MAX_APPLICABILITY_OBJECT_PROPERTIES) {
      return {
        path: current.path,
        message: `Applicability objects may contain at most ${MAX_APPLICABILITY_OBJECT_PROPERTIES} properties`,
      };
    }
    const kind = record.kind;
    const isGroup = kind === 'ALL' || kind === 'ANY';
    const groupDepth = isGroup ? current.groupDepth + 1 : current.groupDepth;
    const isSemanticNode = isGroup || (typeof kind === 'string' && kind.startsWith('FIELD_'));
    if (isSemanticNode) {
      semanticNodes += 1;
      if (semanticNodes > MAX_APPLICABILITY_NODES) {
        return {
          path: current.path,
          message: `Applicability definitions may contain at most ${MAX_APPLICABILITY_NODES} semantic nodes`,
        };
      }
    }
    if (isGroup) {
      groups += 1;
      if (groups > MAX_APPLICABILITY_GROUPS) {
        return { path: current.path, message: `Applicability definitions may contain at most ${MAX_APPLICABILITY_GROUPS} groups` };
      }
      if (groupDepth > MAX_APPLICABILITY_DEPTH) {
        return { path: current.path, message: `Applicability groups may be nested at most ${MAX_APPLICABILITY_DEPTH} levels` };
      }
    } else if (typeof kind === 'string' && kind.startsWith('FIELD_')) {
      leaves += 1;
      if (leaves > MAX_APPLICABILITY_LEAVES) {
        return { path: current.path, message: `Applicability definitions may contain at most ${MAX_APPLICABILITY_LEAVES} leaf predicates` };
      }
    }

    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      stack.push({
        node: record[key],
        path: [...current.path, key],
        depth: current.depth + 1,
        groupDepth,
      });
    }
  }
  return null;
}

function guardApplicabilitySchema<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T, z.output<T>, z.input<T>> {
  return z.preprocess((input, ctx) => {
    const issue = guardRawApplicabilityInput(input);
    if (issue) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
      return z.NEVER;
    }
    return input;
  }, schema);
}

function checkApplicabilityBounds(node: ApplicabilityNode, depth: number, state: { leaves: number }): string | null {
  if (depth > MAX_APPLICABILITY_DEPTH) return `Applicability groups may be nested at most ${MAX_APPLICABILITY_DEPTH} levels`;
  if ('field' in node) {
    // FIELD_IN/FIELD_NOT_IN are one predicate each; their configured values
    // are operands, not additional leaf predicates.
    state.leaves += 1;
    return state.leaves > MAX_APPLICABILITY_LEAVES
      ? `Applicability definitions may contain at most ${MAX_APPLICABILITY_LEAVES} leaf predicates`
      : null;
  }
  for (const child of node.conditions) {
    const issue = checkApplicabilityBounds(child, depth + 1, state);
    if (issue) return issue;
  }
  return null;
}

const applicabilityGroupBaseSchema = z.object({
  kind: z.enum(['ALL', 'ANY']),
  conditions: z.array(applicabilityNodeSchema).max(MAX_APPLICABILITY_GROUP_CONDITIONS),
}).strict();

const boundedApplicabilityGroupSchema = applicabilityGroupBaseSchema.superRefine((value, ctx) => {
  const issue = checkApplicabilityBounds(value, 1, { leaves: 0 });
  if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
});
export const applicabilityGroupSchema = guardApplicabilitySchema(boundedApplicabilityGroupSchema);

const boundedApplicabilityDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(['ALL', 'ANY']),
  conditions: z.array(applicabilityNodeSchema).max(MAX_APPLICABILITY_GROUP_CONDITIONS),
}).strict().superRefine((value, ctx) => {
  const issue = checkApplicabilityBounds(value, 1, { leaves: 0 });
  if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
});
export const applicabilityDefinitionSchema = guardApplicabilitySchema(boundedApplicabilityDefinitionSchema);

export const deadlineParameterDefinitionSchema = z.object({
  key: referenceKeySchema,
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  type: z.enum(['STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'ENUM']),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.type === 'ENUM' && (!value.options || value.options.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Enum parameters require at least one option' });
  }
  if (value.type !== 'ENUM' && value.options) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Options are only valid for enum parameters' });
  }
});

function expressionHasScheduleEntrySource(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const expression = value as Record<string, unknown>;
  if (expression.kind === 'RELATIVE_TO_SOURCE' || expression.kind === 'SOURCE') {
    const source = expression.source;
    if (typeof source === 'object' && source !== null) {
      const sourceKind = (source as Record<string, unknown>).kind;
      if (sourceKind === 'SCHEDULE_ENTRY' || sourceKind === 'CURRENT_SCHEDULE_ENTRY') return true;
    }
  }
  if (typeof expression.source === 'object' && expression.source !== null) {
    const sourceKind = (expression.source as Record<string, unknown>).kind;
    if (sourceKind === 'SCHEDULE_ENTRY' || sourceKind === 'CURRENT_SCHEDULE_ENTRY') return true;
  }
  if (expression.kind === 'COALESCE' && Array.isArray(expression.candidates)) {
    return expression.candidates.some((candidate) => expressionHasScheduleEntrySource(candidate, seen));
  }
  return false;
}

export const deadlineMilestoneSchema = z.object({
  key: referenceKeySchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable(),
  type: z.enum(['STATUTORY', 'CLIENT', 'INTERNAL']),
  generationMode: z.enum(['ONCE_PER_CYCLE', 'ONCE_PER_SCHEDULE_ENTRY']),
  expression: milestoneExpressionSchema,
  businessDayAdjustment: businessDayAdjustmentSchema,
  displayOrder: z.number().int().min(0),
  isActive: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.generationMode === 'ONCE_PER_SCHEDULE_ENTRY') {
    if (!expressionHasScheduleEntrySource(value.expression)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expression'],
        message: 'ONCE_PER_SCHEDULE_ENTRY milestones require a schedule entry source',
      });
    }
  }
});

export const deadlineMilestonesSchema = z.array(deadlineMilestoneSchema).max(100).superRefine((milestones, ctx) => {
  const seen = new Set<string>();
  for (const [index, milestone] of milestones.entries()) {
    if (seen.has(milestone.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'key'],
        message: 'Milestone keys must be unique',
      });
    }
    seen.add(milestone.key);
  }
});

export const scheduleConfigSchema = z.object({
  schemaVersion: z.literal(1),
  entries: scheduleEntriesSchema,
}).strict();

export const versionedScheduleEntriesSchema = scheduleConfigSchema;
export const scheduleEntriesConfigSchema = scheduleConfigSchema;

export type DateOnlyInput = z.infer<typeof dateOnlySchema>;
export type DateSourceInput = z.infer<typeof dateSourceSchema>;
export type IntegerOperandInput = z.infer<typeof integerOperandSchema>;
export type DateOperationInput = z.infer<typeof dateOperationSchema>;
export type ScheduleEntryExpressionInput = z.infer<typeof scheduleEntryExpressionSchema>;
export type DateExpressionInput = z.infer<typeof dateExpressionSchema>;
export type ScheduleEntryInput = z.infer<typeof scheduleEntrySchema>;
export type ScheduleEntriesInput = z.infer<typeof scheduleEntriesSchema>;
export type RuleRecurrenceInput = z.infer<typeof recurrenceSchema>;
export type ApplicabilityPredicateInput = z.infer<typeof applicabilityPredicateSchema>;
export type ApplicabilityDefinitionInput = z.infer<typeof applicabilityDefinitionSchema>;
export type DeadlineParameterDefinitionInput = z.infer<typeof deadlineParameterDefinitionSchema>;
export type DeadlineMilestoneInput = z.infer<typeof deadlineMilestoneSchema>;
export type DeadlineMilestonesInput = z.infer<typeof deadlineMilestonesSchema>;

export {
  KEY_PATTERN,
  MAX_APPLICABILITY_DEPTH,
  MAX_APPLICABILITY_LEAVES,
  MAX_DATE_OFFSET,
};
