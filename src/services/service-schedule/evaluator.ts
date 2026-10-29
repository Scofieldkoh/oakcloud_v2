import { DeadlineApiError, ErrorCodes, ValidationError } from '@/lib/errors';
import {
  collectApplicabilityFields,
  evaluateApplicability,
  type ApplicabilityInput,
  type ApplicabilityResult,
} from './applicability';
import {
  addBusinessDays,
  adjustBusinessDay,
  businessDayFromEnd,
  businessDayFromStart,
  isBusinessDay,
} from './business-days';
import {
  addCalendarDays,
  addMonthsClamped,
  addMonthsPreservingMonthEnd,
  alignAnnualLandmarkToPeriod,
  compareDateOnly,
  dayOfMonth,
  fixedDateFromSourceYear,
  parseDateOnly,
} from './date-only';
import { hashConfiguration } from './hash';
import {
  applicabilityDefinitionSchema,
  applicabilityGroupSchema,
  applicabilityPredicateSchema,
  deadlineMilestonesSchema,
  recurrenceSchema,
  scheduleEntriesSchema,
} from '@/lib/validations/service-schedule';
import type {
  BusinessCalendarSnapshot,
  CompanyField,
  CompanyRuleSource,
  DateOnly,
  DateSource,
  IntegerOperand,
  MilestoneDefinition,
  MilestoneExpression,
  ObligationPeriodInput,
  RuleRecurrenceDefinition,
  ScheduleEntry,
} from './types';

/** The persisted, browser-safe date expression language used by the evaluator. */
export type RuleDateExpression = MilestoneExpression;

/** MilestoneDefinition widened for the evaluator's persisted expression contract. */
export type EvaluatorMilestoneDefinition = Omit<MilestoneDefinition, 'expression'> & {
  expression: RuleDateExpression;
};

export type DeadlineRuleEvaluationInput = {
  ruleId: string;
  ruleVersionId: string;
  recurrence: RuleRecurrenceDefinition;
  applicability: ApplicabilityInput;
  parameters: Record<string, unknown>;
  scheduleEntries: ScheduleEntry[];
  milestones: EvaluatorMilestoneDefinition[];
  company: CompanyRuleSource;
  period: { key: string; start: DateOnly; end: DateOnly };
  /** Explicit financial/tax period for period-based statutory rules. */
  obligationPeriod?: ObligationPeriodInput;
  calendar: BusinessCalendarSnapshot;
};

export type EvaluatedDeadline = {
  milestoneKey: string;
  scheduleEntryKey: string;
  type: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  calculatedDueDate: DateOnly;
  explanation: string[];
};

export type DeadlineRuleEvaluationResult = {
  applicability: ApplicabilityResult;
  occurrences: EvaluatedDeadline[];
  byKey: Record<string, EvaluatedDeadline>;
  sourceSnapshot: Record<string, unknown>;
  evaluationHash: string;
};

type NodeKind = 'SCHEDULE_ENTRY' | 'MILESTONE';
type EvaluationNode = {
  id: string;
  kind: NodeKind;
  key: string;
  order: number;
  milestone?: EvaluatorMilestoneDefinition;
};

type DateResolution = {
  date: DateOnly;
  explanation: string[];
};

type EvaluationContext = {
  nodeId: string;
  scheduleEntryKey: string;
};

type SourceTracker = {
  company: Set<CompanyField>;
  parameters: Set<string>;
  scheduleEntries: Set<string>;
  milestones: Set<string>;
  provenance: Array<{ source: string; value: string | null }>;
};

const DATE_SOURCE_FIELDS = new Set([
  'financialYearEnd',
  'accountsDueDate',
  'incorporationDate',
]);
const DATE_OPERATIONS = new Set([
  'RELATIVE_TO_SOURCE',
  'ADD',
  'ADD_CALENDAR_DAYS',
  'ADD_BUSINESS_DAYS',
  'ADD_MONTHS',
  'ADD_MONTHS_MONTH_END',
  'FIXED_DATE_FROM_SOURCE_YEAR',
  'FIXED_DATE_IN_ASSESSMENT_YEAR',
  'ADJUST_BUSINESS_DAY',
]);
const SCHEDULE_KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const REFERENCE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;
const MAX_JSON_ARRAY_ITEMS = 1_000;
const MAX_JSON_OBJECT_PROPERTIES = 1_000;
const MAX_EXPRESSION_CANDIDATES = 31;
const EXPRESSION_KINDS = new Set([
  'DAY_OF_MONTH',
  'BUSINESS_DAY_FROM_START',
  'BUSINESS_DAY_FROM_END',
  ...DATE_OPERATIONS,
  'SOURCE',
  'COALESCE',
]);
const OWN = Object.prototype.hasOwnProperty;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${name} must be a non-empty string`, { name, value });
  }
  return value;
}

function safeInteger(value: unknown, name: string, min?: number, max?: number): number {
  if (!Number.isSafeInteger(value)) throw new ValidationError(`${name} must be a safe integer`, { name, value });
  if (min !== undefined && (value as number) < min) throw new ValidationError(`${name} is below the allowed minimum`, { name, value, min });
  if (max !== undefined && (value as number) > max) throw new ValidationError(`${name} is above the allowed maximum`, { name, value, max });
  return value as number;
}

type JsonGuardFrame = { value: unknown; path: string; depth: number };

/**
 * Defensively walk caller-created values before any recursive schema or
 * snapshot traversal. The evaluator accepts only JSON-shaped rule inputs;
 * calendar Sets are validated separately by the Task 2 date engine.
 */
function guardJsonGraph(value: unknown, path: string): void {
  const active = new WeakSet<object>();
  const stack: JsonGuardFrame[] = [{ value, path, depth: 0 }];
  let nodes = 0;

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const current = frame.value;
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
    if (typeof current === 'undefined') continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new ValidationError(`${frame.path} contains a non-finite number`);
      continue;
    }
    if (typeof current !== 'object') {
      throw new ValidationError(`${frame.path} contains a non-JSON value`);
    }
    if (current instanceof Date || current instanceof Set || current instanceof Map) {
      throw new ValidationError(`${frame.path} contains a non-JSON value`);
    }
    if (active.has(current)) {
      throw new ValidationError(`${frame.path} contains a cyclic or shared object reference`);
    }
    if (frame.depth > MAX_JSON_DEPTH) {
      throw new ValidationError(`${frame.path} exceeds the maximum JSON depth`);
    }
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      throw new ValidationError(`${frame.path} exceeds the maximum JSON node count`);
    }
    active.add(current);
    if (Array.isArray(current)) {
      if (current.length > MAX_JSON_ARRAY_ITEMS) {
        throw new ValidationError(`${frame.path} exceeds the maximum array length`);
      }
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current[index], path: `${frame.path}[${index}]`, depth: frame.depth + 1 });
      }
      continue;
    }
    if (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
      throw new ValidationError(`${frame.path} contains a non-plain object`);
    }
    const keys = Object.keys(current);
    if (keys.length > MAX_JSON_OBJECT_PROPERTIES) {
      throw new ValidationError(`${frame.path} exceeds the maximum property count`);
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!;
      stack.push({ value: (current as Record<string, unknown>)[key], path: `${frame.path}.${key}`, depth: frame.depth + 1 });
    }
  }
}

type SchemaResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: Array<{ path: Array<string | number>; message: string }> } };

function schemaFailure(path: string, result: SchemaResult<unknown>): ValidationError {
  if (result.success) return new ValidationError(`${path} is invalid`);
  const issue = result.error.issues[0];
  const location = issue?.path.length ? `${path}.${issue.path.join('.')}` : path;
  return new ValidationError(`${location}: ${issue?.message ?? 'invalid value'}`, result.error.issues);
}

function parseRecurrence(value: unknown): RuleRecurrenceDefinition {
  const result = recurrenceSchema.safeParse(value) as SchemaResult<RuleRecurrenceDefinition>;
  if (!result.success) throw schemaFailure('recurrence', result);
  return result.data;
}

function parseScheduleEntries(value: unknown): ScheduleEntry[] {
  const result = scheduleEntriesSchema.safeParse(value) as SchemaResult<ScheduleEntry[]>;
  if (!result.success) {
    const issue = result.error.issues[0];
    if (issue?.message === 'Schedule entry keys must be unique') {
      throw duplicateSchedule('Duplicate schedule entry key', { path: issue.path });
    }
    if (issue?.message.includes('at most 31')) {
      throw new DeadlineApiError(ErrorCodes.SCHEDULE_LIMIT_EXCEEDED, issue.message, 422, { path: issue.path });
    }
    throw schemaFailure('scheduleEntries', result);
  }
  return result.data;
}

function parseMilestones(value: unknown): EvaluatorMilestoneDefinition[] {
  const result = deadlineMilestonesSchema.safeParse(value) as SchemaResult<EvaluatorMilestoneDefinition[]>;
  if (!result.success) {
    const issue = result.error.issues[0];
    if (issue?.message === 'Milestone keys must be unique') {
      throw new ValidationError('Duplicate milestone key', { path: issue.path });
    }
    throw schemaFailure('milestones', result);
  }
  return result.data;
}

function parseApplicability(value: unknown): ApplicabilityInput {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new ValidationError('Applicability definition must be a predicate or ALL/ANY group');
  }
  let result: SchemaResult<ApplicabilityInput>;
  if (value.kind.startsWith('FIELD_')) {
    result = applicabilityPredicateSchema.safeParse(value) as SchemaResult<ApplicabilityInput>;
  } else if ((value.kind === 'ALL' || value.kind === 'ANY') && OWN.call(value, 'schemaVersion')) {
    result = applicabilityDefinitionSchema.safeParse(value) as SchemaResult<ApplicabilityInput>;
  } else {
    result = applicabilityGroupSchema.safeParse(value) as SchemaResult<ApplicabilityInput>;
  }
  if (!result.success) throw schemaFailure('applicability', result);
  return result.data;
}

function missingInput(message: string, details?: unknown): DeadlineApiError {
  return new DeadlineApiError(ErrorCodes.MISSING_RULE_INPUT, message, 422, details);
}

function duplicateSchedule(message: string, details?: unknown): DeadlineApiError {
  return new DeadlineApiError(ErrorCodes.DUPLICATE_SCHEDULE_ENTRY, message, 422, details);
}

function assertDatePeriod(period: DeadlineRuleEvaluationInput['period']): void {
  if (!isRecord(period)) throw new ValidationError('Evaluation period must be an object');
  if (Object.keys(period).some((key) => !['key', 'start', 'end'].includes(key))) {
    throw new ValidationError('Evaluation period contains unknown fields');
  }
  requiredString(period.key, 'period.key');
  parseDateOnly(period.start);
  parseDateOnly(period.end);
  if (compareDateOnly(period.start, period.end) > 0) {
    throw new ValidationError('Evaluation period start must be on or before period end', { period });
  }
}

function validateCalendar(calendar: BusinessCalendarSnapshot, start: DateOnly): void {
  // The Task 2 function is the canonical calendar validator. Calling it once
  // here keeps malformed typed objects from being accepted when no date
  // expression happens to use a business-day operation.
  isBusinessDay(start, calendar);
}

function assertDateSource(source: unknown, path: string): DateSource {
  if (!isRecord(source) || typeof source.kind !== 'string') {
    throw new ValidationError(`${path} must be a supported date source`, { path, source });
  }
  switch (source.kind) {
    case 'COMPANY_FIELD':
      if (typeof source.field !== 'string' || !DATE_SOURCE_FIELDS.has(source.field)) {
        throw new ValidationError(`${path}.field is not a supported Company date field`, { path, source });
      }
      if (Object.keys(source).some((key) => key !== 'kind' && key !== 'field')) {
        throw new ValidationError(`${path} contains unknown fields`, { path, source });
      }
      return {
        kind: 'COMPANY_FIELD',
        field: source.field as Extract<DateSource, { kind: 'COMPANY_FIELD' }>['field'],
      };
    case 'CYCLE_START':
    case 'CYCLE_END':
      if (Object.keys(source).some((key) => key !== 'kind')) throw new ValidationError(`${path} contains unknown fields`, { path });
      return { kind: source.kind };
    case 'OBLIGATION_PERIOD_START':
    case 'OBLIGATION_PERIOD_END':
      if (Object.keys(source).some((key) => key !== 'kind')) throw new ValidationError(`${path} contains unknown fields`, { path });
      return { kind: source.kind };
    case 'CURRENT_SCHEDULE_ENTRY':
      if (Object.keys(source).some((key) => key !== 'kind')) throw new ValidationError(`${path} contains unknown fields`, { path });
      return { kind: 'CURRENT_SCHEDULE_ENTRY' };
    case 'PARAMETER':
    case 'SCHEDULE_ENTRY':
    case 'MILESTONE':
      {
        const key = requiredString(source.key, `${path}.key`);
        if (!REFERENCE_KEY_PATTERN.test(key)) {
          throw new ValidationError(`${path}.key is malformed`, { path, source });
        }
        if (source.kind === 'SCHEDULE_ENTRY' && !SCHEDULE_KEY_PATTERN.test(key)) {
          throw new ValidationError(`${path}.key is not a valid schedule entry key`, { path, source });
        }
        if (Object.keys(source).some((property) => property !== 'kind' && property !== 'key')) {
          throw new ValidationError(`${path} contains unknown fields`, { path, source });
        }
        return { kind: source.kind, key } as DateSource;
      }
    default:
      throw new ValidationError(`${path} uses unsupported source type ${source.kind}`, { path, source });
  }
}

function assertAdjustment(value: unknown, path: string): 'NONE' | 'PREVIOUS' | 'NEXT' {
  if (value !== 'NONE' && value !== 'PREVIOUS' && value !== 'NEXT') {
    throw new ValidationError(`${path} must be NONE, PREVIOUS, or NEXT`, { path, value });
  }
  return value;
}

function assertIntegerOperand(value: unknown, path: string): IntegerOperand {
  if (typeof value === 'number') return safeInteger(value, path, -3660, 3660);
  if (!isRecord(value) || value.kind !== 'INTEGER_PARAMETER') {
    throw new ValidationError(`${path} must be an integer literal or INTEGER_PARAMETER`, { path, value });
  }
  if (Object.keys(value).some((key) => key !== 'kind' && key !== 'key')) {
    throw new ValidationError(`${path} contains unknown fields`, { path });
  }
  const key = requiredString(value.key, `${path}.key`);
  if (!REFERENCE_KEY_PATTERN.test(key)) throw new ValidationError(`${path}.key is malformed`, { path, key });
  return { kind: 'INTEGER_PARAMETER', key };
}

function assertExpression(expression: unknown, path: string, allowOperations = true): RuleDateExpression {
  if (!isRecord(expression) || typeof expression.kind !== 'string' || !EXPRESSION_KINDS.has(expression.kind)) {
    throw new ValidationError(`${path} uses an unsupported date expression`, { path, expression });
  }
  if (!allowOperations && !['DAY_OF_MONTH', 'BUSINESS_DAY_FROM_START', 'BUSINESS_DAY_FROM_END', 'RELATIVE_TO_SOURCE'].includes(expression.kind)) {
    throw new ValidationError(`${path} uses an operation that is not valid for a schedule entry`, { path, expression });
  }
  switch (expression.kind) {
    case 'DAY_OF_MONTH':
      if (Object.keys(expression).some((key) => key !== 'kind' && key !== 'day')) throw new ValidationError(`${path} contains unknown fields`, { path });
      safeInteger(expression.day, `${path}.day`, 1, 31);
      return expression as unknown as RuleDateExpression;
    case 'BUSINESS_DAY_FROM_START':
    case 'BUSINESS_DAY_FROM_END':
      if (Object.keys(expression).some((key) => key !== 'kind' && key !== 'ordinal')) throw new ValidationError(`${path} contains unknown fields`, { path });
      safeInteger(expression.ordinal, `${path}.ordinal`, 1, 31);
      return expression as unknown as RuleDateExpression;
    case 'RELATIVE_TO_SOURCE':
      if (Object.keys(expression).some((key) => !['kind', 'source', 'offset', 'unit'].includes(key))) throw new ValidationError(`${path} contains unknown fields`, { path });
      assertDateSource(expression.source, `${path}.source`);
      assertIntegerOperand(expression.offset, `${path}.offset`);
      if (expression.unit !== 'CALENDAR_DAY' && expression.unit !== 'BUSINESS_DAY') {
        throw new ValidationError(`${path}.unit must be CALENDAR_DAY or BUSINESS_DAY`);
      }
      return expression as unknown as RuleDateExpression;
    case 'ADD':
      if (Object.keys(expression).some((key) => !['kind', 'source', 'offset', 'unit'].includes(key))) throw new ValidationError(`${path} contains unknown fields`, { path });
      if (expression.source !== undefined) assertDateSource(expression.source, `${path}.source`);
      assertIntegerOperand(expression.offset, `${path}.offset`);
      if (expression.unit !== 'CALENDAR_DAY' && expression.unit !== 'BUSINESS_DAY') {
        throw new ValidationError(`${path}.unit must be CALENDAR_DAY or BUSINESS_DAY`);
      }
      return expression as unknown as RuleDateExpression;
    case 'ADD_CALENDAR_DAYS':
    case 'ADD_BUSINESS_DAYS':
      if (Object.keys(expression).some((key) => !['kind', 'source', 'amount'].includes(key))) throw new ValidationError(`${path} contains unknown fields`, { path });
      if (expression.source !== undefined) assertDateSource(expression.source, `${path}.source`);
      assertIntegerOperand(expression.amount, `${path}.amount`);
      return expression as unknown as RuleDateExpression;
    case 'ADD_MONTHS':
    case 'ADD_MONTHS_MONTH_END':
      if (Object.keys(expression).some((key) => !['kind', 'source', 'amount'].includes(key))) throw new ValidationError(`${path} contains unknown fields`, { path });
      if (expression.source !== undefined) assertDateSource(expression.source, `${path}.source`);
      assertIntegerOperand(expression.amount, `${path}.amount`);
      return expression as unknown as RuleDateExpression;
    case 'FIXED_DATE_IN_ASSESSMENT_YEAR':
      if (Object.keys(expression).some((key) => !['kind', 'month', 'day'].includes(key))) throw new ValidationError(`${path} contains unknown fields`, { path });
      safeInteger(expression.month, `${path}.month`, 1, 12);
      safeInteger(expression.day, `${path}.day`, 1, 31);
      return expression as unknown as RuleDateExpression;
    case 'FIXED_DATE_FROM_SOURCE_YEAR':
      if (Object.keys(expression).some((key) => !['kind', 'source', 'yearOffset', 'month', 'day'].includes(key))) throw new ValidationError(`${path} contains unknown fields`, { path });
      assertDateSource(expression.source, `${path}.source`);
      safeInteger(expression.yearOffset, `${path}.yearOffset`, -100, 100);
      safeInteger(expression.month, `${path}.month`, 1, 12);
      safeInteger(expression.day, `${path}.day`, 1, 31);
      return expression as unknown as RuleDateExpression;
    case 'ADJUST_BUSINESS_DAY':
      if (Object.keys(expression).some((key) => key !== 'kind' && key !== 'adjustment')) throw new ValidationError(`${path} contains unknown fields`, { path });
      assertAdjustment(expression.adjustment, `${path}.adjustment`);
      return expression as unknown as RuleDateExpression;
    case 'SOURCE':
      if (Object.keys(expression).some((key) => key !== 'kind' && key !== 'source')) throw new ValidationError(`${path} contains unknown fields`, { path });
      assertDateSource(expression.source, `${path}.source`);
      return expression as unknown as RuleDateExpression;
    case 'COALESCE':
      if (Object.keys(expression).some((key) => key !== 'kind' && key !== 'candidates')) throw new ValidationError(`${path} contains unknown fields`, { path });
      if (!Array.isArray(expression.candidates) || expression.candidates.length < 1 || expression.candidates.length > MAX_EXPRESSION_CANDIDATES) {
        throw new ValidationError(`${path}.candidates must contain 1 to ${MAX_EXPRESSION_CANDIDATES} expressions`, { path });
      }
      expression.candidates.forEach((candidate, index) => assertExpression(candidate, `${path}.candidates[${index}]`));
      return expression as unknown as RuleDateExpression;
    default:
      throw new ValidationError(`${path} uses an unsupported date expression`, { path, expression });
  }
}

function scheduleEntriesByKey(entries: ScheduleEntry[]): Map<string, ScheduleEntry> {
  const byKey = new Map<string, ScheduleEntry>();
  entries.forEach((entry) => {
    if (byKey.has(entry.key)) throw duplicateSchedule(`Duplicate schedule entry key ${entry.key}`, { key: entry.key });
    byKey.set(entry.key, entry);
  });
  return byKey;
}

function milestonesByKey(milestones: EvaluatorMilestoneDefinition[]): Map<string, EvaluatorMilestoneDefinition> {
  const byKey = new Map<string, EvaluatorMilestoneDefinition>();
  milestones.forEach((milestone) => {
    if (byKey.has(milestone.key)) throw new ValidationError(`Duplicate milestone key ${milestone.key}`, { key: milestone.key });
    if (!['STATUTORY', 'CLIENT', 'INTERNAL'].includes(milestone.type)) {
      throw new ValidationError(`milestone ${milestone.key}.type is unsupported`);
    }
    byKey.set(milestone.key, milestone);
  });
  return byKey;
}

function sourcesFromExpression(expression: RuleDateExpression): DateSource[] {
  switch (expression.kind) {
    case 'RELATIVE_TO_SOURCE':
    case 'SOURCE':
      return [expression.source];
    case 'ADD':
    case 'ADD_CALENDAR_DAYS':
    case 'ADD_BUSINESS_DAYS':
    case 'ADD_MONTHS':
    case 'ADD_MONTHS_MONTH_END':
      return expression.source ? [expression.source] : [];
    case 'FIXED_DATE_FROM_SOURCE_YEAR':
      return [expression.source];
    case 'COALESCE':
      return expression.candidates.flatMap((candidate) => sourcesFromExpression(candidate));
    default:
      return [];
  }
}

function sourceDependencyId(source: DateSource, current: EvaluationNode, scheduleEntries: Map<string, ScheduleEntry>, milestones: Map<string, EvaluatorMilestoneDefinition>): string | null {
  if (source.kind === 'SCHEDULE_ENTRY') {
    if (!scheduleEntries.has(source.key)) throw missingInput(`Schedule entry source ${source.key} is missing`, { source });
    if (current.kind === 'SCHEDULE_ENTRY' && current.key === source.key) {
      throw new ValidationError(`Schedule entry ${current.key} has a self dependency`, { source });
    }
    return `schedule:${source.key}`;
  }
  if (source.kind === 'MILESTONE') {
    const target = milestones.get(source.key);
    if (!target) throw missingInput(`Milestone source ${source.key} is missing`, { source });
    if (current.kind === 'MILESTONE' && current.key === source.key) {
      throw new ValidationError(`Milestone ${current.key} has a self dependency`, { source });
    }
    if (target.generationMode === 'ONCE_PER_SCHEDULE_ENTRY' && current.kind === 'SCHEDULE_ENTRY') {
      throw new ValidationError(`Schedule entry ${current.key} has an ambiguous per-entry milestone source ${source.key}`);
    }
    if (target.generationMode === 'ONCE_PER_SCHEDULE_ENTRY' && current.kind === 'MILESTONE'
      && current.milestone?.generationMode !== 'ONCE_PER_SCHEDULE_ENTRY') {
      throw new ValidationError(`Cycle milestone ${current.key} has an ambiguous per-entry milestone source ${source.key}`);
    }
    return `milestone:${source.key}`;
  }
  if (source.kind === 'CURRENT_SCHEDULE_ENTRY') {
    if (current.kind !== 'MILESTONE' || current.milestone?.generationMode !== 'ONCE_PER_SCHEDULE_ENTRY') {
      throw new ValidationError('CURRENT_SCHEDULE_ENTRY is only valid for per-schedule-entry milestones');
    }
    return null;
  }
  return null;
}

function buildEvaluationGraph(
  scheduleEntries: Map<string, ScheduleEntry>,
  milestones: Map<string, EvaluatorMilestoneDefinition>,
): { nodes: EvaluationNode[]; dependencies: Map<string, string[]> } {
  const nodes: EvaluationNode[] = [];
  let order = 0;
  for (const [key] of scheduleEntries) nodes.push({ id: `schedule:${key}`, kind: 'SCHEDULE_ENTRY', key, order: order += 1 });
  for (const [key, milestone] of milestones) nodes.push({ id: `milestone:${key}`, kind: 'MILESTONE', key, milestone, order: order += 1 });

  const dependencies = new Map<string, string[]>();
  for (const node of nodes) {
    const definition = node.kind === 'SCHEDULE_ENTRY' ? scheduleEntries.get(node.key)! : node.milestone!;
    const expression = assertExpression(definition.expression, `${node.id}.expression`, node.kind !== 'SCHEDULE_ENTRY');
    const dependencyIds = sourcesFromExpression(expression)
      .map((source) => sourceDependencyId(source, node, scheduleEntries, milestones))
      .filter((dependency): dependency is string => dependency !== null);
    dependencies.set(node.id, [...new Set(dependencyIds)]);
  }

  const colors = new Map<string, 'WHITE' | 'GRAY' | 'BLACK'>();
  const path: string[] = [];
  const sortedNodes = [...nodes].sort((left, right) => left.order - right.order);
  const topological: EvaluationNode[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visit = (node: EvaluationNode): void => {
    const color = colors.get(node.id) ?? 'WHITE';
    if (color === 'BLACK') return;
    if (color === 'GRAY') {
      const start = path.indexOf(node.id);
      const cycle = [...path.slice(start), node.id].join(' -> ');
      throw new ValidationError(`Circular schedule dependency: ${cycle}`);
    }
    colors.set(node.id, 'GRAY');
    path.push(node.id);
    for (const dependencyId of dependencies.get(node.id) ?? []) visit(byId.get(dependencyId)!);
    path.pop();
    colors.set(node.id, 'BLACK');
    topological.push(node);
  };
  for (const node of sortedNodes) visit(node);
  return { nodes: topological, dependencies };
}

function hasCompanyValue(company: CompanyRuleSource, field: CompanyField): boolean {
  return OWN.call(company, field) && company[field] !== undefined && company[field] !== null;
}

function hasParameter(parameters: Record<string, unknown>, key: string): boolean {
  return OWN.call(parameters, key);
}

function readParameter(input: DeadlineRuleEvaluationInput, key: string): unknown {
  return hasParameter(input.parameters, key) ? input.parameters[key] : undefined;
}

function sourceName(source: DateSource): string {
  switch (source.kind) {
    case 'COMPANY_FIELD': return `Company.${source.field}`;
    case 'CYCLE_START': return 'Cycle.start';
    case 'CYCLE_END': return 'Cycle.end';
    case 'OBLIGATION_PERIOD_START': return 'ObligationPeriod.start';
    case 'OBLIGATION_PERIOD_END': return 'ObligationPeriod.end';
    case 'PARAMETER': return `Parameter.${source.key}`;
    case 'SCHEDULE_ENTRY': return `ScheduleEntry.${source.key}`;
    case 'MILESTONE': return `Milestone.${source.key}`;
    case 'CURRENT_SCHEDULE_ENTRY': return 'CurrentScheduleEntry';
  }
}

function markProvenance(tracker: SourceTracker, source: string, value: string | null): void {
  if (!tracker.provenance.some((item) => item.source === source && item.value === value)) {
    tracker.provenance.push({ source, value });
  }
}

function resolveSource(
  source: DateSource,
  context: EvaluationContext,
  input: DeadlineRuleEvaluationInput,
  scheduleDates: Map<string, DateResolution>,
  milestoneDates: Map<string, Map<string, DateResolution>>,
  tracker: SourceTracker,
): DateResolution {
  switch (source.kind) {
    case 'COMPANY_FIELD': {
      tracker.company.add(source.field as CompanyField);
      const value = input.company[source.field];
      if (!hasCompanyValue(input.company, source.field)) {
        markProvenance(tracker, sourceName(source), null);
        throw missingInput(`${sourceName(source)} is required`, { source });
      }
      if (typeof value !== 'string') throw new ValidationError(`${sourceName(source)} must be a DateOnly string`, { source });
      parseDateOnly(value as DateOnly);
      markProvenance(tracker, sourceName(source), value);

      let resolvedDate = value as DateOnly;
      const recurringAnnualCompanyField =
        input.recurrence.kind === 'ANNUALLY'
        && (source.field === 'accountsDueDate' || source.field === 'financialYearEnd');
      if (recurringAnnualCompanyField) {
        resolvedDate = alignAnnualLandmarkToPeriod(value as DateOnly, input.period.start);
      }
      return { date: resolvedDate, explanation: [`Source ${sourceName(source)} = ${resolvedDate}`] };
    }
    case 'CYCLE_START':
      markProvenance(tracker, sourceName(source), input.period.start);
      return { date: input.period.start, explanation: [`Source ${sourceName(source)} = ${input.period.start}`] };
    case 'CYCLE_END':
      markProvenance(tracker, sourceName(source), input.period.end);
      return { date: input.period.end, explanation: [`Source ${sourceName(source)} = ${input.period.end}`] };
    case 'OBLIGATION_PERIOD_START':
    case 'OBLIGATION_PERIOD_END': {
      if (!input.obligationPeriod) {
        markProvenance(tracker, sourceName(source), null);
        throw missingInput(`${sourceName(source)} is required`, { source });
      }
      const date = source.kind === 'OBLIGATION_PERIOD_START' ? input.obligationPeriod.start : input.obligationPeriod.end;
      markProvenance(tracker, sourceName(source), date);
      return { date, explanation: [`Source ${sourceName(source)} = ${date}`] };
    }
    case 'PARAMETER': {
      tracker.parameters.add(source.key);
      const supplied = hasParameter(input.parameters, source.key);
      const value = readParameter(input, source.key);
      if (!supplied || value === undefined || value === null) {
        markProvenance(tracker, sourceName(source), null);
        throw missingInput(`${sourceName(source)} is required`, { source });
      }
      if (typeof value !== 'string') throw new ValidationError(`${sourceName(source)} must be a DateOnly string`, { source });
      parseDateOnly(value as DateOnly);
      markProvenance(tracker, sourceName(source), value);
      return { date: value as DateOnly, explanation: [`Source ${sourceName(source)} = ${value}`] };
    }
    case 'SCHEDULE_ENTRY': {
      tracker.scheduleEntries.add(source.key);
      const resolution = scheduleDates.get(source.key);
      if (!resolution) {
        markProvenance(tracker, sourceName(source), null);
        throw missingInput(`${sourceName(source)} is required`, { source });
      }
      markProvenance(tracker, sourceName(source), resolution.date);
      return {
        date: resolution.date,
        explanation: [`Source ${sourceName(source)} = ${resolution.date}`, ...resolution.explanation],
      };
    }
    case 'CURRENT_SCHEDULE_ENTRY': {
      if (context.scheduleEntryKey.length === 0) {
        markProvenance(tracker, sourceName(source), null);
        throw missingInput('Current schedule entry is unavailable outside a schedule-entry occurrence', { source });
      }
      tracker.scheduleEntries.add(context.scheduleEntryKey);
      const resolution = scheduleDates.get(context.scheduleEntryKey);
      if (!resolution) {
        markProvenance(tracker, `${sourceName(source)}.${context.scheduleEntryKey}`, null);
        throw missingInput(`Current schedule entry ${context.scheduleEntryKey} is required`, { source, scheduleEntryKey: context.scheduleEntryKey });
      }
      markProvenance(tracker, `${sourceName(source)}.${context.scheduleEntryKey}`, resolution.date);
      return {
        date: resolution.date,
        explanation: [`Source ${sourceName(source)} (${context.scheduleEntryKey}) = ${resolution.date}`, ...resolution.explanation],
      };
    }
    case 'MILESTONE': {
      tracker.milestones.add(source.key);
      const values = milestoneDates.get(source.key);
      if (!values) {
        markProvenance(tracker, sourceName(source), null);
        throw missingInput(`${sourceName(source)} is required`, { source });
      }
      const resolution = values.get(context.scheduleEntryKey) ?? values.get('');
      if (!resolution) {
        markProvenance(tracker, sourceName(source), null);
        throw missingInput(`${sourceName(source)} has no value for schedule entry ${context.scheduleEntryKey || '(cycle)'}`, { source });
      }
      markProvenance(tracker, sourceName(source), resolution.date);
      return {
        date: resolution.date,
        explanation: [`Source ${sourceName(source)} = ${resolution.date}`, ...resolution.explanation],
      };
    }
    default:
      throw new ValidationError(`Unsupported date source ${(source as { kind: string }).kind}`);
  }
}

function resolveIntegerOperand(
  operand: IntegerOperand,
  input: DeadlineRuleEvaluationInput,
  tracker: SourceTracker,
  path: string,
): number {
  if (typeof operand === 'number') return safeInteger(operand, path, -3660, 3660);
  if (!isRecord(operand) || operand.kind !== 'INTEGER_PARAMETER') {
    throw new ValidationError(`${path} must be an integer literal or INTEGER_PARAMETER`);
  }
  const key = requiredString(operand.key, `${path}.key`);
  if (!REFERENCE_KEY_PATTERN.test(key)) throw new ValidationError(`${path}.key is malformed`, { path, key });
  tracker.parameters.add(key);
  const supplied = hasParameter(input.parameters, key);
  const value = readParameter(input, key);
  if (!supplied || value === undefined || value === null) {
    markProvenance(tracker, `Parameter.${key}`, null);
    throw missingInput(`Parameter.${key} is required`, { parameter: key, expectedType: 'INTEGER' });
  }
  const amount = safeInteger(value, `Parameter.${key}`, -3660, 3660);
  markProvenance(tracker, `Parameter.${key}`, String(amount));
  return amount;
}

function integerOperandExplanation(operand: IntegerOperand, amount: number): string {
  if (typeof operand === 'number') return `Resolved integer operand ${amount}`;
  return `Resolved Parameter.${operand.key} = ${amount}`;
}

function applyOffset(
  resolution: DateResolution,
  amount: number,
  unit: 'CALENDAR_DAY' | 'BUSINESS_DAY',
  calendar: BusinessCalendarSnapshot,
): DateResolution {
  if (unit === 'CALENDAR_DAY') {
    return {
      date: addCalendarDays(resolution.date, amount),
      explanation: [...resolution.explanation, `Applied ${amount} calendar day${Math.abs(amount) === 1 ? '' : 's'}`],
    };
  }
  return {
    date: addBusinessDays(resolution.date, amount, calendar),
    explanation: [...resolution.explanation, `Applied ${amount} business day${Math.abs(amount) === 1 ? '' : 's'}`],
  };
}

function evaluateExpression(
  expression: RuleDateExpression,
  context: EvaluationContext,
  input: DeadlineRuleEvaluationInput,
  scheduleDates: Map<string, DateResolution>,
  milestoneDates: Map<string, Map<string, DateResolution>>,
  tracker: SourceTracker,
): DateResolution {
  switch (expression.kind) {
    case 'DAY_OF_MONTH': {
      const date = dayOfMonth(input.period.start, expression.day);
      return { date, explanation: [`Period month ${input.period.start.slice(0, 7)} day ${expression.day} = ${date}`] };
    }
    case 'BUSINESS_DAY_FROM_START': {
      const date = businessDayFromStart(input.period.start, input.period.end, expression.ordinal, input.calendar);
      return { date, explanation: [`Business day ${expression.ordinal} from period start = ${date}`] };
    }
    case 'BUSINESS_DAY_FROM_END': {
      const date = businessDayFromEnd(input.period.start, input.period.end, expression.ordinal, input.calendar);
      return { date, explanation: [`Business day ${expression.ordinal} from period end = ${date}`] };
    }
    case 'RELATIVE_TO_SOURCE': {
      const source = assertDateSource(expression.source, 'expression.source');
      const amount = resolveIntegerOperand(expression.offset, input, tracker, 'expression.offset');
      const base = resolveSource(source, context, input, scheduleDates, milestoneDates, tracker);
      return applyOffset(
        { date: base.date, explanation: [...base.explanation, integerOperandExplanation(expression.offset, amount)] },
        amount,
        expression.unit,
        input.calendar,
      );
    }
    case 'ADD': {
      const base = expression.source
        ? resolveSource(assertDateSource(expression.source, 'expression.source'), context, input, scheduleDates, milestoneDates, tracker)
        : { date: input.period.start, explanation: [`Default source Cycle.start = ${input.period.start}`] };
      const amount = resolveIntegerOperand(expression.offset, input, tracker, 'expression.offset');
      return applyOffset(
        { date: base.date, explanation: [...base.explanation, integerOperandExplanation(expression.offset, amount)] },
        amount,
        expression.unit,
        input.calendar,
      );
    }
    case 'ADD_CALENDAR_DAYS': {
      const amount = resolveIntegerOperand(expression.amount, input, tracker, 'expression.amount');
      const base = expression.source
        ? resolveSource(assertDateSource(expression.source, 'expression.source'), context, input, scheduleDates, milestoneDates, tracker)
        : { date: input.period.start, explanation: [`Default source Cycle.start = ${input.period.start}`] };
      return {
        date: addCalendarDays(base.date, amount),
        explanation: [...base.explanation, integerOperandExplanation(expression.amount, amount), `Applied ${amount} calendar day${Math.abs(amount) === 1 ? '' : 's'}`],
      };
    }
    case 'ADD_BUSINESS_DAYS': {
      const amount = resolveIntegerOperand(expression.amount, input, tracker, 'expression.amount');
      const base = expression.source
        ? resolveSource(assertDateSource(expression.source, 'expression.source'), context, input, scheduleDates, milestoneDates, tracker)
        : { date: input.period.start, explanation: [`Default source Cycle.start = ${input.period.start}`] };
      return {
        date: addBusinessDays(base.date, amount, input.calendar),
        explanation: [...base.explanation, integerOperandExplanation(expression.amount, amount), `Applied ${amount} business day${Math.abs(amount) === 1 ? '' : 's'}`],
      };
    }
    case 'ADD_MONTHS': {
      const amount = resolveIntegerOperand(expression.amount, input, tracker, 'expression.amount');
      const base = expression.source
        ? resolveSource(assertDateSource(expression.source, 'expression.source'), context, input, scheduleDates, milestoneDates, tracker)
        : { date: input.period.start, explanation: [`Default source Cycle.start = ${input.period.start}`] };
      return {
        date: addMonthsClamped(base.date, amount),
        explanation: [...base.explanation, integerOperandExplanation(expression.amount, amount), `Applied ${amount} month${Math.abs(amount) === 1 ? '' : 's'}`],
      };
    }
    case 'ADD_MONTHS_MONTH_END': {
      const amount = resolveIntegerOperand(expression.amount, input, tracker, 'expression.amount');
      const base = expression.source
        ? resolveSource(assertDateSource(expression.source, 'expression.source'), context, input, scheduleDates, milestoneDates, tracker)
        : { date: input.period.start, explanation: [`Default source Cycle.start = ${input.period.start}`] };
      return {
        date: addMonthsPreservingMonthEnd(base.date, amount),
        explanation: [
          ...base.explanation,
          integerOperandExplanation(expression.amount, amount),
          `Applied ${amount} month${Math.abs(amount) === 1 ? '' : 's'} (month end stays month end)`,
        ],
      };
    }
    case 'FIXED_DATE_IN_ASSESSMENT_YEAR': {
      const yearOfAssessment = input.obligationPeriod?.yearOfAssessment ?? null;
      if (yearOfAssessment === null) {
        markProvenance(tracker, 'ObligationPeriod.yearOfAssessment', null);
        throw missingInput('ObligationPeriod.yearOfAssessment is required', {
          source: { kind: 'OBLIGATION_PERIOD_END' },
          field: 'yearOfAssessment',
        });
      }
      markProvenance(tracker, 'ObligationPeriod.yearOfAssessment', String(yearOfAssessment));
      const yearStart = `${String(yearOfAssessment).padStart(4, '0')}-01-01` as DateOnly;
      const date = fixedDateFromSourceYear(yearStart, 0, expression.month, expression.day);
      return {
        date,
        explanation: [
          `Year of Assessment ${yearOfAssessment}`,
          `Fixed calendar date month ${expression.month} day ${expression.day} in YA ${yearOfAssessment} = ${date}`,
        ],
      };
    }
    case 'FIXED_DATE_FROM_SOURCE_YEAR': {
      const base = resolveSource(assertDateSource(expression.source, 'expression.source'), context, input, scheduleDates, milestoneDates, tracker);
      const date = fixedDateFromSourceYear(base.date, expression.yearOffset, expression.month, expression.day);
      return {
        date,
        explanation: [
          ...base.explanation,
          `Fixed calendar date month ${expression.month} day ${expression.day} with year offset ${expression.yearOffset} = ${date}`,
        ],
      };
    }
    case 'ADJUST_BUSINESS_DAY':
      return {
        date: adjustBusinessDay(input.period.start, expression.adjustment, input.calendar),
        explanation: [`Default source Cycle.start = ${input.period.start}`, `Applied ${expression.adjustment} business-day adjustment`],
      };
    case 'SOURCE':
      return resolveSource(assertDateSource(expression.source, 'expression.source'), context, input, scheduleDates, milestoneDates, tracker);
    case 'COALESCE': {
      let lastMissing: DeadlineApiError | null = null;
      for (const [index, candidate] of expression.candidates.entries()) {
        try {
          const resolution = evaluateExpression(candidate, context, input, scheduleDates, milestoneDates, tracker);
          return {
            date: resolution.date,
            explanation: [`Coalesce selected candidate ${index + 1}`, ...resolution.explanation],
          };
        } catch (error) {
          if (error instanceof DeadlineApiError && error.code === ErrorCodes.MISSING_RULE_INPUT) {
            lastMissing = error;
            continue;
          }
          throw error;
        }
      }
      if (lastMissing) throw lastMissing;
      throw missingInput('COALESCE has no available candidate');
    }
    default:
      throw new ValidationError(`Unsupported date expression ${(expression as { kind: string }).kind}`);
  }
}

function withFinalAdjustment(
  resolution: DateResolution,
  adjustment: 'NONE' | 'PREVIOUS' | 'NEXT',
  calendar: BusinessCalendarSnapshot,
): DateResolution {
  if (adjustment === 'NONE') return resolution;
  const adjusted = adjustBusinessDay(resolution.date, adjustment, calendar);
  return {
    date: adjusted,
    explanation: [...resolution.explanation, `Applied final ${adjustment} business-day adjustment to ${resolution.date} = ${adjusted}`],
  };
}

type JsonSafeState = { active: WeakSet<object>; nodes: number };

function jsonSafe(value: unknown, path: string, state: JsonSafeState = { active: new WeakSet<object>(), nodes: 0 }, depth = 0): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ValidationError(`${path} contains a non-finite number`);
    return value;
  }
  if (typeof value === 'undefined') return null;
  if (typeof value !== 'object') throw new ValidationError(`${path} contains a non-JSON value`);
  if (depth > MAX_JSON_DEPTH) throw new ValidationError(`${path} exceeds the maximum JSON depth`);
  if (state.active.has(value)) throw new ValidationError(`${path} contains a cyclic object reference`);
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) throw new ValidationError(`${path} exceeds the maximum JSON node count`);
  state.active.add(value);
  try {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) throw new ValidationError(`${path} contains an invalid Date`);
      return value.toISOString();
    }
    if (value instanceof Set) {
      return [...value]
        .map((item) => jsonSafe(item, path, state, depth + 1))
        .sort((left, right) => String(left).localeCompare(String(right)));
    }
    if (value instanceof Map) {
      const result: Record<string, unknown> = {};
      for (const [key, entry] of [...value.entries()].sort(([left], [right]) => String(left).localeCompare(String(right)))) {
        result[String(key)] = jsonSafe(entry, `${path}.${String(key)}`, state, depth + 1);
      }
      return result;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_JSON_ARRAY_ITEMS) throw new ValidationError(`${path} exceeds the maximum array length`);
      return value.map((item, index) => jsonSafe(item, `${path}[${index}]`, state, depth + 1));
    }
    if (isRecord(value)) {
      const keys = Object.keys(value).sort();
      if (keys.length > MAX_JSON_OBJECT_PROPERTIES) throw new ValidationError(`${path} exceeds the maximum property count`);
      const result: Record<string, unknown> = {};
      for (const key of keys) result[key] = jsonSafe(value[key], `${path}.${key}`, state, depth + 1);
      return result;
    }
    throw new ValidationError(`${path} contains a non-JSON value`);
  } finally {
    state.active.delete(value);
  }
}

const COMPANY_FIELDS = new Set<CompanyField>([
  'isGstRegistered',
  'isRegisteredCharity',
  'isIPC',
  'hasCharges',
  'currentOfficerCount',
  'currentShareholderCount',
  'annualReceiptsOrExpenditure',
  'financialYearEnd',
  'accountsDueDate',
  'incorporationDate',
  'registrationDate',
  'entityType',
  'status',
  'primarySsicCode',
  'secondarySsicCode',
  'uen',
  'name',
]);
const BOOLEAN_COMPANY_FIELDS = new Set(['isGstRegistered', 'isRegisteredCharity', 'isIPC', 'hasCharges']);
const NUMERIC_COMPANY_FIELDS = new Set(['currentOfficerCount', 'currentShareholderCount', 'annualReceiptsOrExpenditure']);
const DATE_COMPANY_FIELDS = new Set([
  'financialYearEnd',
  'accountsDueDate',
  'incorporationDate',
  'registrationDate',
]);

function normalizeCompany(value: unknown): CompanyRuleSource {
  if (!isRecord(value)) throw new ValidationError('company must be an object');
  guardJsonGraph(value, 'company');
  for (const key of Object.keys(value)) {
    if (!COMPANY_FIELDS.has(key as CompanyField)) throw new ValidationError(`company.${key} is not a supported field`);
    const fieldValue = value[key];
    if (fieldValue === undefined || fieldValue === null) continue;
    if (BOOLEAN_COMPANY_FIELDS.has(key) && typeof fieldValue !== 'boolean') {
      throw new ValidationError(`company.${key} must be a boolean`);
    }
    if (NUMERIC_COMPANY_FIELDS.has(key) && (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue))) {
      throw new ValidationError(`company.${key} must be a finite number`);
    }
    if (DATE_COMPANY_FIELDS.has(key)) {
      if (typeof fieldValue !== 'string') throw new ValidationError(`company.${key} must be a DateOnly string`);
      parseDateOnly(fieldValue as DateOnly);
    }
    if (!BOOLEAN_COMPANY_FIELDS.has(key) && !NUMERIC_COMPANY_FIELDS.has(key)
      && !DATE_COMPANY_FIELDS.has(key) && typeof fieldValue !== 'string') {
      throw new ValidationError(`company.${key} must be a string`);
    }
  }
  return value as CompanyRuleSource;
}

function normalizeParameters(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ValidationError('parameters must be an object');
  guardJsonGraph(value, 'parameters');
  for (const key of Object.keys(value)) {
    if (!REFERENCE_KEY_PATTERN.test(key)) throw new ValidationError(`parameters.${key} has a malformed key`);
  }
  return value;
}

function normalizeObligationPeriod(value: unknown): ObligationPeriodInput | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new ValidationError('obligationPeriod must be an object');
  guardJsonGraph(value, 'obligationPeriod');
  if (Object.keys(value).some((key) => !['start', 'end', 'yearOfAssessment'].includes(key))) {
    throw new ValidationError('obligationPeriod contains unknown fields');
  }
  const start = value.start as DateOnly;
  const end = value.end as DateOnly;
  parseDateOnly(start);
  parseDateOnly(end);
  if (compareDateOnly(start, end) > 0) {
    throw new ValidationError('obligationPeriod.start must be on or before obligationPeriod.end');
  }
  const yearOfAssessment = value.yearOfAssessment === null || value.yearOfAssessment === undefined
    ? null
    : safeInteger(value.yearOfAssessment, 'obligationPeriod.yearOfAssessment', 1, 9999);
  return { start, end, yearOfAssessment };
}

function normalizeEvaluationInput(input: DeadlineRuleEvaluationInput): DeadlineRuleEvaluationInput {
  if (!isRecord(input)) throw new ValidationError('Deadline rule evaluation input must be an object');
  requiredString(input.ruleId, 'ruleId');
  requiredString(input.ruleVersionId, 'ruleVersionId');
  guardJsonGraph(input.recurrence, 'recurrence');
  guardJsonGraph(input.applicability, 'applicability');
  guardJsonGraph(input.period, 'period');
  guardJsonGraph(input.scheduleEntries, 'scheduleEntries');
  guardJsonGraph(input.milestones, 'milestones');
  const recurrence = parseRecurrence(input.recurrence);
  const applicability = parseApplicability(input.applicability);
  const scheduleEntries = parseScheduleEntries(input.scheduleEntries);
  const milestones = parseMilestones(input.milestones);
  const company = normalizeCompany(input.company);
  const parameters = normalizeParameters(input.parameters);
  assertDatePeriod(input.period);
  validateCalendar(input.calendar, input.period.start);
  const obligationPeriod = normalizeObligationPeriod(input.obligationPeriod);
  return {
    ...input,
    ...(obligationPeriod ? { obligationPeriod } : {}),
    recurrence,
    applicability,
    scheduleEntries,
    milestones,
    company,
    parameters,
  };
}

function buildSnapshot(
  input: DeadlineRuleEvaluationInput,
  applicability: ApplicabilityResult,
  tracker: SourceTracker,
): Record<string, unknown> {
  const company: Record<string, unknown> = {};
  for (const field of [...tracker.company].sort()) {
    if (hasCompanyValue(input.company, field)) company[field] = jsonSafe(input.company[field], `company.${field}`);
  }
  const parameters: Record<string, unknown> = {};
  for (const key of [...tracker.parameters].sort()) {
    const value = readParameter(input, key);
    if (hasParameter(input.parameters, key) && value !== undefined) {
      parameters[key] = jsonSafe(value, `parameters.${key}`);
    }
  }
  const calendar = {
    id: input.calendar.id,
    timeZone: input.calendar.timeZone,
    revision: input.calendar.revision,
    weekendDays: [...input.calendar.weekendDays].sort((left, right) => left - right),
    holidays: [...input.calendar.holidays].sort(),
  };
  return jsonSafe({
    ruleId: input.ruleId,
    ruleVersionId: input.ruleVersionId,
    recurrence: input.recurrence,
    applicability: {
      definition: input.applicability,
      result: applicability,
    },
    period: input.period,
    // Only period-based rules carry an obligation period, so legacy snapshot
    // hashes stay byte-for-byte unchanged.
    ...(input.obligationPeriod ? { obligationPeriod: input.obligationPeriod } : {}),
    company,
    parameters,
    scheduleEntries: input.scheduleEntries,
    milestones: input.milestones,
    calendar,
    provenance: tracker.provenance,
  }, 'sourceSnapshot') as Record<string, unknown>;
}

function resultWithNoOccurrences(
  input: DeadlineRuleEvaluationInput,
  applicability: ApplicabilityResult,
): DeadlineRuleEvaluationResult {
  const tracker: SourceTracker = {
    company: new Set(collectApplicabilityFields(input.applicability)),
    parameters: new Set(),
    scheduleEntries: new Set(),
    milestones: new Set(),
    provenance: [],
  };
  for (const field of tracker.company) {
    markProvenance(tracker, `Company.${field}`, hasCompanyValue(input.company, field) ? String(input.company[field]) : null);
  }
  const sourceSnapshot = buildSnapshot(input, applicability, tracker);
  return {
    applicability,
    occurrences: [],
    byKey: {},
    sourceSnapshot,
    evaluationHash: hashConfiguration(sourceSnapshot),
  };
}

/**
 * Evaluate one validated rule version for one period. The evaluator is pure:
 * all persistence, reconciliation, and materialisation happen in later
 * services and receive this serializable result.
 */
export function evaluateDeadlineRule(input: DeadlineRuleEvaluationInput): DeadlineRuleEvaluationResult {
  const normalizedInput = normalizeEvaluationInput(input);

  const applicability = evaluateApplicability(normalizedInput.applicability, normalizedInput.company);
  if (applicability.state !== 'APPLICABLE') return resultWithNoOccurrences(normalizedInput, applicability);

  const scheduleEntries = scheduleEntriesByKey(normalizedInput.scheduleEntries);
  const milestones = milestonesByKey(normalizedInput.milestones);
  const graph = buildEvaluationGraph(scheduleEntries, milestones);
  const scheduleDates = new Map<string, DateResolution>();
  const milestoneDates = new Map<string, Map<string, DateResolution>>();
  const tracker: SourceTracker = {
    company: new Set(collectApplicabilityFields(normalizedInput.applicability)),
    parameters: new Set(),
    scheduleEntries: new Set(),
    milestones: new Set(),
    provenance: [],
  };

  for (const node of graph.nodes) {
    if (node.kind === 'SCHEDULE_ENTRY') {
      const definition = scheduleEntries.get(node.key)!;
      const raw = evaluateExpression(
        assertExpression(definition.expression, `${node.id}.expression`),
        { nodeId: node.id, scheduleEntryKey: node.key },
        normalizedInput,
        scheduleDates,
        milestoneDates,
        tracker,
      );
      const resolved = withFinalAdjustment(raw, definition.businessDayAdjustment, normalizedInput.calendar);
      scheduleDates.set(node.key, resolved);
      tracker.scheduleEntries.add(node.key);
      markProvenance(tracker, `ScheduleEntry.${node.key}`, resolved.date);
    } else {
      const definition = node.milestone!;
      const keys = definition.generationMode === 'ONCE_PER_SCHEDULE_ENTRY'
        ? [...scheduleEntries.keys()]
        : [''];
      const values = new Map<string, DateResolution>();
      for (const scheduleEntryKey of keys) {
        const raw = evaluateExpression(
          assertExpression(definition.expression, `${node.id}.expression`),
          { nodeId: node.id, scheduleEntryKey },
          normalizedInput,
          scheduleDates,
          milestoneDates,
          tracker,
        );
        values.set(scheduleEntryKey, withFinalAdjustment(raw, definition.businessDayAdjustment, normalizedInput.calendar));
      }
      milestoneDates.set(node.key, values);
    }
  }

  const orderedMilestones = [...normalizedInput.milestones]
    .map((definition, index) => ({ definition, index }))
    .filter(({ definition }) => definition.isActive)
    .sort((left, right) => left.definition.displayOrder - right.definition.displayOrder || left.index - right.index);
  const occurrences: EvaluatedDeadline[] = [];
  const byKey: Record<string, EvaluatedDeadline> = {};
  for (const { definition } of orderedMilestones) {
    const scheduleKeys = definition.generationMode === 'ONCE_PER_SCHEDULE_ENTRY' ? [...scheduleEntries.keys()] : [''];
    const values = milestoneDates.get(definition.key);
    if (!values) throw missingInput(`Milestone ${definition.key} did not produce a value`, { milestoneKey: definition.key });
    for (const scheduleEntryKey of scheduleKeys) {
      const resolution = values.get(scheduleEntryKey);
      if (!resolution) throw missingInput(`Milestone ${definition.key} has no value for schedule entry ${scheduleEntryKey}`, { milestoneKey: definition.key, scheduleEntryKey });
      const key = `${definition.key}:${scheduleEntryKey}`;
      if (byKey[key]) throw new ValidationError(`Duplicate occurrence key ${key}`, { key });
      const occurrence: EvaluatedDeadline = {
        milestoneKey: definition.key,
        scheduleEntryKey,
        type: definition.type,
        calculatedDueDate: resolution.date,
        explanation: [...resolution.explanation],
      };
      occurrences.push(occurrence);
      byKey[key] = occurrence;
    }
  }

  const finalApplicability: ApplicabilityResult = { state: 'APPLICABLE', reason: null };
  const sourceSnapshot = buildSnapshot(normalizedInput, finalApplicability, tracker);
  return {
    applicability: finalApplicability,
    occurrences,
    byKey,
    sourceSnapshot,
    evaluationHash: hashConfiguration(sourceSnapshot),
  };
}
