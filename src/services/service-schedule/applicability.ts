import { ValidationError } from '@/lib/errors';
import {
  applicabilityDefinitionSchema,
  applicabilityGroupSchema,
  applicabilityPredicateSchema,
} from '@/lib/validations/service-schedule';
import { compareDateOnly, parseDateOnly } from './date-only';
import type {
  ApplicabilityDefinition,
  ApplicabilityGroup,
  ApplicabilityPredicate,
  CompanyField,
  CompanyRuleSource,
  DateCompanyField,
  NumericCompanyField,
} from './types';

/** The bounded tri-state result used by the rule evaluator and previews. */
export type ApplicabilityResult =
  | { state: 'APPLICABLE'; reason: null }
  | { state: 'NOT_APPLICABLE'; reason: string }
  | { state: 'MISSING_INPUT'; reason: string; missingFields: string[] };

export type ApplicabilityInput = ApplicabilityDefinition | ApplicabilityGroup | ApplicabilityPredicate;

type Evaluation = {
  state: ApplicabilityResult['state'];
  reason: string | null;
  missingFields: string[];
};

const MAX_DEPTH = 5;
const MAX_LEAVES = 50;
const OWN = Object.prototype.hasOwnProperty;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPredicate(value: unknown): value is ApplicabilityPredicate {
  return isRecord(value) && typeof value.kind === 'string' && value.kind.startsWith('FIELD_');
}

function isGroup(value: unknown): value is ApplicabilityGroup {
  return isRecord(value) && (value.kind === 'ALL' || value.kind === 'ANY');
}

function validationMessage(error: { issues?: Array<{ path: Array<string | number>; message: string }> }): string {
  const issue = error.issues?.[0];
  return issue ? `${issue.path.join('.') || 'applicability'}: ${issue.message}` : 'Invalid applicability definition';
}

/**
 * Parse the public AST even when callers bypassed Zod at a TypeScript boundary.
 * The schema has an iterative raw-input guard, so this remains safe for deeply
 * nested/cyclic objects supplied by a caller rather than by an API parser.
 */
function validateDefinition(input: ApplicabilityInput): ApplicabilityInput {
  let parsed: ReturnType<typeof applicabilityPredicateSchema.safeParse>
    | ReturnType<typeof applicabilityGroupSchema.safeParse>
    | ReturnType<typeof applicabilityDefinitionSchema.safeParse>;

  if (isPredicate(input)) parsed = applicabilityPredicateSchema.safeParse(input);
  else if (isGroup(input) && 'schemaVersion' in input) parsed = applicabilityDefinitionSchema.safeParse(input);
  else if (isGroup(input)) parsed = applicabilityGroupSchema.safeParse(input);
  else {
    throw new ValidationError('Applicability definition must be a predicate or ALL/ANY group');
  }

  if (!parsed.success) throw new ValidationError(validationMessage(parsed.error), parsed.error.issues);
  return parsed.data as ApplicabilityInput;
}

function validateBounds(root: ApplicabilityInput): void {
  const seen = new WeakSet<object>();
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: isGroup(root) ? 1 : 0 }];
  let leaves = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!isRecord(current.node)) continue;
    if (seen.has(current.node)) throw new ValidationError('Applicability definitions cannot contain cycles');
    seen.add(current.node);

    if (isGroup(current.node)) {
      if (current.depth > MAX_DEPTH) {
        throw new ValidationError(`Applicability groups may be nested at most ${MAX_DEPTH} levels`);
      }
      for (let index = current.node.conditions.length - 1; index >= 0; index -= 1) {
        stack.push({ node: current.node.conditions[index], depth: current.depth + 1 });
      }
    } else {
      leaves += 1;
      if (leaves > MAX_LEAVES) {
        throw new ValidationError(`Applicability definitions may contain at most ${MAX_LEAVES} leaf predicates`);
      }
    }
  }
}

function hasValue(company: CompanyRuleSource, field: CompanyField): boolean {
  return OWN.call(company, field) && company[field] !== undefined && company[field] !== null;
}

function valueLabel(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function fieldLabel(field: CompanyField): string {
  return `Company.${field}`;
}

function isDateField(field: CompanyField): field is DateCompanyField {
  return [
    'financialYearEnd',
    'accountsDueDate',
    'incorporationDate',
    'registrationDate',
  ].includes(field);
}

function isNumericField(field: CompanyField): field is NumericCompanyField {
  return [
    'currentOfficerCount',
    'currentShareholderCount',
    'annualReceiptsOrExpenditure',
  ].includes(field);
}

function compareValues(field: CompanyField, actual: unknown, expected: unknown): number {
  if (isDateField(field)) {
    if (typeof actual !== 'string' || typeof expected !== 'string') {
      throw new ValidationError(`${fieldLabel(field)} must be a DateOnly string`);
    }
    // Parsing both values also rejects a typed object that contains a malformed
    // date rather than silently applying lexical comparison to it.
    parseDateOnly(actual as never);
    parseDateOnly(expected as never);
    return compareDateOnly(actual as never, expected as never);
  }
  if (isNumericField(field)) {
    if (typeof actual !== 'number' || !Number.isFinite(actual) || typeof expected !== 'number' || !Number.isFinite(expected)) {
      throw new ValidationError(`${fieldLabel(field)} must be a finite number`);
    }
    return actual < expected ? -1 : actual > expected ? 1 : 0;
  }
  throw new ValidationError(`${fieldLabel(field)} does not support comparison`);
}

function valuesEqual(field: CompanyField, actual: unknown, expected: unknown): boolean {
  if (isDateField(field)) {
    return compareValues(field, actual, expected) === 0;
  }
  return Object.is(actual, expected);
}

function missing(field: CompanyField, operator: string): Evaluation {
  return {
    state: 'MISSING_INPUT',
    reason: `${fieldLabel(field)} is required for ${operator}`,
    missingFields: [field],
  };
}

function notApplicable(reason: string): Evaluation {
  return { state: 'NOT_APPLICABLE', reason, missingFields: [] };
}

function applicable(): Evaluation {
  return { state: 'APPLICABLE', reason: null, missingFields: [] };
}

function evaluatePredicate(predicate: ApplicabilityPredicate, company: CompanyRuleSource): Evaluation {
  const field = predicate.field;
  const present = hasValue(company, field);
  const actual = company[field];

  if (predicate.kind === 'FIELD_PRESENT') {
    return present
      ? applicable()
      : notApplicable(`${fieldLabel(field)} is missing`);
  }
  if (predicate.kind === 'FIELD_MISSING') {
    return present
      ? notApplicable(`${fieldLabel(field)} is present`)
      : applicable();
  }
  if (!present) return missing(field, predicate.kind);

  switch (predicate.kind) {
    case 'FIELD_EQUALS':
      return valuesEqual(field, actual, predicate.value)
        ? applicable()
        : notApplicable(`${fieldLabel(field)} ${valueLabel(actual)} does not equal ${valueLabel(predicate.value)}`);
    case 'FIELD_NOT_EQUALS':
      return !valuesEqual(field, actual, predicate.value)
        ? applicable()
        : notApplicable(`${fieldLabel(field)} ${valueLabel(actual)} equals a disallowed value`);
    case 'FIELD_IN': {
      const matches = predicate.values.some((value) => valuesEqual(field, actual, value));
      return matches
        ? applicable()
        : notApplicable(`${fieldLabel(field)} ${valueLabel(actual)} is not in the configured set`);
    }
    case 'FIELD_NOT_IN': {
      const matches = predicate.values.some((value) => valuesEqual(field, actual, value));
      return !matches
        ? applicable()
        : notApplicable(`${fieldLabel(field)} ${valueLabel(actual)} is in the excluded set`);
    }
    case 'FIELD_TRUE':
      return actual === true
        ? applicable()
        : notApplicable(`${fieldLabel(field)} is not true`);
    case 'FIELD_FALSE':
      return actual === false
        ? applicable()
        : notApplicable(`${fieldLabel(field)} is not false`);
    case 'FIELD_COMPARE': {
      const comparison = compareValues(field, actual, predicate.value);
      const matches = predicate.operator === 'GT' ? comparison > 0
        : predicate.operator === 'GTE' ? comparison >= 0
          : predicate.operator === 'LT' ? comparison < 0
            : comparison <= 0;
      return matches
        ? applicable()
        : notApplicable(`${fieldLabel(field)} does not satisfy ${predicate.operator} ${valueLabel(predicate.value)}`);
    }
    default:
      throw new ValidationError(`Unsupported applicability predicate ${(predicate as { kind: string }).kind}`);
  }
}

function uniqueFields(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function uniqueReasons(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function combineGroup(kind: 'ALL' | 'ANY', children: Evaluation[]): Evaluation {
  const missingFields = uniqueFields(children.flatMap((child) => child.missingFields));
  const notApplicableChildren = children.filter((child) => child.state === 'NOT_APPLICABLE');
  const missingChildren = children.filter((child) => child.state === 'MISSING_INPUT');

  if (kind === 'ALL') {
    if (notApplicableChildren.length > 0) {
      return notApplicable(`ALL conditions failed: ${uniqueReasons(notApplicableChildren.map((child) => child.reason)).join('; ')}`);
    }
    if (missingChildren.length > 0) {
      return {
        state: 'MISSING_INPUT',
        reason: `ALL conditions need input: ${uniqueReasons(missingChildren.map((child) => child.reason)).join('; ')}`,
        missingFields,
      };
    }
    return applicable();
  }

  if (children.some((child) => child.state === 'APPLICABLE')) return applicable();
  if (missingChildren.length > 0) {
    return {
      state: 'MISSING_INPUT',
      reason: `ANY condition needs input: ${uniqueReasons(missingChildren.map((child) => child.reason)).join('; ')}`,
      missingFields,
    };
  }
  return notApplicable(`ANY conditions failed: ${uniqueReasons(notApplicableChildren.map((child) => child.reason)).join('; ')}`);
}

function evaluateNode(node: ApplicabilityInput, company: CompanyRuleSource): Evaluation {
  if (isPredicate(node)) return evaluatePredicate(node, company);
  if (!isGroup(node)) throw new ValidationError('Applicability node must be a predicate or ALL/ANY group');
  return combineGroup(node.kind, node.conditions.map((condition) => evaluateNode(condition, company)));
}

/**
 * Evaluate a bounded, whitelisted Company predicate tree without touching a
 * database. The root predicate form is accepted for starter rules and small
 * callers; persisted definitions normally use the versioned ALL/ANY shape.
 */
export function evaluateApplicability(
  definition: ApplicabilityInput,
  company: CompanyRuleSource,
): ApplicabilityResult {
  if (!isRecord(company)) throw new ValidationError('Company rule source must be an object');
  const validated = validateDefinition(definition);
  validateBounds(validated);
  const result = evaluateNode(validated, company);
  if (result.state === 'APPLICABLE') return { state: 'APPLICABLE', reason: null };
  if (result.state === 'NOT_APPLICABLE') return { state: 'NOT_APPLICABLE', reason: result.reason ?? 'Rule is not applicable' };
  return {
    state: 'MISSING_INPUT',
    reason: result.reason ?? 'Applicability input is missing',
    missingFields: uniqueFields(result.missingFields),
  };
}

/** Return Company fields referenced by a predicate tree for provenance snapshots. */
export function collectApplicabilityFields(definition: ApplicabilityInput): CompanyField[] {
  const validated = validateDefinition(definition);
  validateBounds(validated);
  const fields: CompanyField[] = [];
  const stack: ApplicabilityInput[] = [validated];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isPredicate(node)) fields.push(node.field);
    else if (isGroup(node)) stack.push(...node.conditions);
  }
  return uniqueFields(fields) as CompanyField[];
}
