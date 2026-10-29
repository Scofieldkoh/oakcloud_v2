import { isSummaryEligibleFieldType, normalizeKey } from '@/lib/form-utils';
import type { BuilderField, ConditionConfig, FieldConditionConfig } from './builder-utils';

export type ReadinessItem = {
  message: string;
  fieldKey?: string;
};

export type PublishReadiness = {
  blockers: ReadinessItem[];
  warnings: ReadinessItem[];
};

const NO_VALUE_OPERATORS = new Set(['is_empty', 'not_empty', 'is_visible', 'is_not_visible']);

const OPERATOR_LABELS: Record<ConditionConfig['operator'], string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  contains: 'contains',
  is_empty: 'is empty',
  not_empty: 'is not empty',
  is_visible: 'is visible',
  is_not_visible: 'is not visible',
};

function isConditionGroup(condition: FieldConditionConfig | null): condition is Extract<FieldConditionConfig, { rules: FieldConditionConfig[] }> {
  return !!condition && 'rules' in condition;
}

function fieldNameByKey(fields: BuilderField[], key: string): string {
  const field = fields.find((candidate) => candidate.key === key);
  if (!field) return key;
  return field.label?.trim() || field.key;
}

export function describeCondition(condition: FieldConditionConfig | null, fields: BuilderField[]): string {
  if (!condition) return 'Always shown';

  if (isConditionGroup(condition)) {
    const parts = condition.rules
      .map((rule) => describeCondition(rule, fields))
      .filter((part) => part !== 'Always shown');
    if (parts.length === 0) return 'Always shown';
    return parts.join(condition.logic === 'or' ? ' or ' : ' and ');
  }

  const fieldName = fieldNameByKey(fields, condition.fieldKey);
  const operatorLabel = OPERATOR_LABELS[condition.operator] || condition.operator;
  if (NO_VALUE_OPERATORS.has(condition.operator)) {
    return `${fieldName} ${operatorLabel}`;
  }
  return `${fieldName} ${operatorLabel} ${String(condition.value ?? '')}`;
}

export function collectConditionFieldKeys(condition: FieldConditionConfig | null): string[] {
  if (!condition) return [];
  if (isConditionGroup(condition)) {
    return Array.from(new Set(condition.rules.flatMap(collectConditionFieldKeys)));
  }
  return condition.fieldKey ? [condition.fieldKey] : [];
}

export function getConditionDependents(fields: BuilderField[], fieldKey: string): BuilderField[] {
  return fields.filter((field) => (
    field.key !== fieldKey && collectConditionFieldKeys(field.condition).includes(fieldKey)
  ));
}

function hasAnswerFields(fields: BuilderField[]): boolean {
  return fields.some((field) => !['PAGE_BREAK', 'PARAGRAPH', 'HTML', 'HIDDEN'].includes(field.type));
}

function hasEmailLikeField(fields: BuilderField[]): boolean {
  return fields.some((field) => {
    const label = `${field.label} ${field.key}`.toLowerCase();
    return label.includes('email') || field.inputType === 'email';
  });
}

export function getPublishReadiness(input: {
  title: string;
  slug: string;
  draftSaveEnabled: boolean;
  fields: BuilderField[];
}): PublishReadiness {
  const blockers: ReadinessItem[] = [];
  const warnings: ReadinessItem[] = [];
  const normalizedSlug = input.slug.trim();

  if (!input.title.trim()) {
    blockers.push({ message: 'Form title is required.' });
  }
  if (normalizedSlug.length < 3) {
    blockers.push({ message: 'Custom URL segment must be at least 3 characters.' });
  }
  if (!hasAnswerFields(input.fields)) {
    blockers.push({ message: 'Add at least one answer field before publishing.' });
  }

  const keyCounts = new Map<string, number>();
  for (const field of input.fields) {
    const key = normalizeKey(field.key || field.label || '');
    if (!key) continue;
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }

  input.fields.forEach((field, index) => {
    const label = field.label.trim();
    const key = normalizeKey(field.key || label);

    if (!label && field.type !== 'HIDDEN' && !(field.type === 'PAGE_BREAK' && field.inputType === 'block_divider')) {
      blockers.push({ message: `Field ${index + 1} has no visible label.`, fieldKey: field.key });
    }
    if (!key) {
      blockers.push({ message: `${label || `Field ${index + 1}`} has no key.`, fieldKey: field.key });
    } else if ((keyCounts.get(key) || 0) > 1) {
      blockers.push({ message: `${label || key} uses duplicate key "${key}".`, fieldKey: field.key });
    }

    for (const dependencyKey of collectConditionFieldKeys(field.condition)) {
      if (!input.fields.some((candidate) => candidate.key === dependencyKey)) {
        blockers.push({
          message: `${label || field.key || `Field ${index + 1}`} references missing field key "${dependencyKey}".`,
          fieldKey: field.key,
        });
      }
    }

    if (field.type === 'FILE_UPLOAD' && !field.validation?.maxFileSizeMb) {
      warnings.push({
        message: `${label || field.key} has no upload size limit configured.`,
        fieldKey: field.key,
      });
    }
  });

  if (!input.fields.some((field) => field.showOnSummary && isSummaryEligibleFieldType(field.type))) {
    warnings.push({ message: 'No response summary fields are selected.' });
  }

  if (input.draftSaveEnabled && !hasEmailLikeField(input.fields)) {
    warnings.push({
      message: 'Draft saving is enabled. Confirm the form asks for an email or other respondent identifier.',
    });
  }

  return { blockers, warnings };
}
