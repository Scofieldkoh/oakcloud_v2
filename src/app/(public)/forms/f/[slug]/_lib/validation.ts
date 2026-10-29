/** Date boundaries and text/number validation for public form answers. */

import {
  parseObject,
  evaluateCondition,
  isProgressStopInfoBlock,
  type PublicFormField as PublicField,
} from '@/lib/form-utils';
import {
  isRepeatStartMarker,
  isRepeatEndMarker,
  isBlockDivider,
  getRepeatSectionConfig,
} from './field-config';

export function getLocalTodayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function resolveDateBoundary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'today') return getLocalTodayIsoDate();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}

export function addIsoDateDays(value: string, offsetDays: number): string | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function resolveRelativeDateBoundary(
  validation: Record<string, unknown> | null,
  fieldKeyName: 'minDateFieldKey' | 'maxDateFieldKey',
  offsetName: 'minDateOffsetDays' | 'maxDateOffsetDays',
  answersRecord: Record<string, unknown>
): string | undefined {
  const fieldKey = typeof validation?.[fieldKeyName] === 'string' ? validation[fieldKeyName].trim() : '';
  if (!fieldKey) return undefined;

  const referencedValue = answersRecord[fieldKey];
  if (typeof referencedValue !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(referencedValue.trim())) {
    return undefined;
  }

  const rawOffset = validation?.[offsetName];
  const offsetDays = typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;
  return addIsoDateDays(referencedValue.trim(), offsetDays);
}

export function getDateValidationRange(field: PublicField, answersRecord: Record<string, unknown>): { minDate?: string; maxDate?: string } {
  if (field.type !== 'SHORT_TEXT' || field.inputType !== 'date') return {};
  const validation = parseObject(field.validation);
  const fixedMinDate = resolveDateBoundary(validation?.minDate);
  const fixedMaxDate = resolveDateBoundary(validation?.maxDate);
  const relativeMinDate = resolveRelativeDateBoundary(validation, 'minDateFieldKey', 'minDateOffsetDays', answersRecord);
  const relativeMaxDate = resolveRelativeDateBoundary(validation, 'maxDateFieldKey', 'maxDateOffsetDays', answersRecord);
  const minDate = [fixedMinDate, relativeMinDate].filter((value): value is string => !!value).sort().at(-1);
  const maxDate = [fixedMaxDate, relativeMaxDate].filter((value): value is string => !!value).sort()[0];

  return { minDate, maxDate };
}

export function formatValidationDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthLabel = months[month - 1];
  if (!monthLabel) return value;

  return `${day} ${monthLabel} ${year}`;
}

export function formatValidationNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toString();
}

export function quoteValidationText(value: string): string {
  return `"${value}"`;
}

export function normalizeNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildAnswerContext(answersRecord: Record<string, unknown>, rowIndex?: number): Record<string, unknown> {
  if (rowIndex === undefined) return answersRecord;

  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answersRecord)) {
    context[key] = Array.isArray(value) ? value[rowIndex] : value;
  }
  return context;
}

export function evaluateNumberFormula(formula: string, answersRecord: Record<string, unknown>): number | null {
  const normalizedFormula = formula.trim().replace(/^(>=|<=|>|<|=)\s*/, '');
  const referenced = normalizedFormula.replace(/\[([a-zA-Z][a-zA-Z0-9_]*)\]/g, (_match, fieldKey: string) => {
    const resolved = normalizeNumberValue(answersRecord[fieldKey]);
    return resolved === null ? 'NaN' : String(resolved);
  });

  if (/[^0-9+\-*/().\s]/.test(referenced)) {
    return null;
  }

  try {
    const result = Function(`"use strict"; return (${referenced});`)();
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

export function getTextValidationError(field: PublicField, value: string, fieldLabel: string): string | null {
  const validation = parseObject(field.validation);

  if (typeof validation?.minLength === 'number' && value.length < validation.minLength) {
    return `${fieldLabel} must be at least ${validation.minLength} character${validation.minLength === 1 ? '' : 's'}.`;
  }
  if (typeof validation?.maxLength === 'number' && value.length > validation.maxLength) {
    return `${fieldLabel} must be at most ${validation.maxLength} character${validation.maxLength === 1 ? '' : 's'}.`;
  }
  if (typeof validation?.startsWith === 'string' && validation.startsWith.length > 0 && !value.startsWith(validation.startsWith)) {
    return `${fieldLabel} must begin with ${quoteValidationText(validation.startsWith)}.`;
  }
  if (typeof validation?.containsText === 'string' && validation.containsText.length > 0 && !value.includes(validation.containsText)) {
    return `${fieldLabel} must contain ${quoteValidationText(validation.containsText)}.`;
  }
  if (typeof validation?.notContainsText === 'string' && validation.notContainsText.length > 0 && value.includes(validation.notContainsText)) {
    return `${fieldLabel} must not contain ${quoteValidationText(validation.notContainsText)}.`;
  }
  if (typeof validation?.endsWith === 'string' && validation.endsWith.length > 0 && !value.endsWith(validation.endsWith)) {
    return `${fieldLabel} must end with ${quoteValidationText(validation.endsWith)}.`;
  }

  return null;
}

export function getNumberValidationError(
  field: PublicField,
  value: unknown,
  fieldLabel: string,
  answersRecord: Record<string, unknown>
): string | null {
  if (value === null || value === undefined || value === '') return null;

  const numericValue = normalizeNumberValue(value);
  if (numericValue === null) {
    return `Enter a valid number for ${fieldLabel}.`;
  }

  const validation = parseObject(field.validation);
  if (typeof validation?.min === 'number' && numericValue < validation.min) {
    return `${fieldLabel} must be at least ${formatValidationNumber(validation.min)}.`;
  }
  if (typeof validation?.max === 'number' && numericValue > validation.max) {
    return `${fieldLabel} must be at most ${formatValidationNumber(validation.max)}.`;
  }
  if (typeof validation?.equal === 'number' && numericValue !== validation.equal) {
    return `${fieldLabel} must equal ${formatValidationNumber(validation.equal)}.`;
  }
  if (typeof validation?.minFormula === 'string' && validation.minFormula.trim().length > 0) {
    const resolved = evaluateNumberFormula(validation.minFormula, answersRecord);
    if (resolved !== null && numericValue < resolved) {
      return `${fieldLabel} must be at least ${formatValidationNumber(resolved)}.`;
    }
  }
  if (typeof validation?.maxFormula === 'string' && validation.maxFormula.trim().length > 0) {
    const resolved = evaluateNumberFormula(validation.maxFormula, answersRecord);
    if (resolved !== null && numericValue > resolved) {
      return `${fieldLabel} must be at most ${formatValidationNumber(resolved)}.`;
    }
  }
  if (typeof validation?.equalFormula === 'string' && validation.equalFormula.trim().length > 0) {
    const resolved = evaluateNumberFormula(validation.equalFormula, answersRecord);
    if (resolved !== null && numericValue !== resolved) {
      return `${fieldLabel} must equal ${formatValidationNumber(resolved)}.`;
    }
  }

  return null;
}

export function hasActiveProgressStopInfoBlock(
  pageFields: PublicField[],
  answersRecord: Record<string, unknown>,
  repeatCounts: Record<string, number>,
  allFields: PublicField[]
): boolean {
  for (let index = 0; index < pageFields.length; index += 1) {
    const field = pageFields[index];

    if (isRepeatStartMarker(field)) {
      const sectionVisible = evaluateCondition(field.condition, answersRecord, { fields: allFields });
      const sectionConfig = getRepeatSectionConfig(field);
      const sectionFields: PublicField[] = [];
      let cursor = index + 1;

      while (cursor < pageFields.length && !isRepeatEndMarker(pageFields[cursor])) {
        if (pageFields[cursor].type !== 'PAGE_BREAK') {
          sectionFields.push(pageFields[cursor]);
        }
        cursor += 1;
      }

      if (sectionVisible) {
        const rowCount = repeatCounts[sectionConfig.id] || sectionConfig.minItems;
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          const rowAnswers = buildAnswerContext(answersRecord, rowIndex);
          for (const sectionField of sectionFields) {
            if (
              isProgressStopInfoBlock(sectionField) &&
              evaluateCondition(sectionField.condition, rowAnswers, { fields: sectionFields })
            ) {
              return true;
            }
          }
        }
      }

      index = cursor;
      continue;
    }

    if (isRepeatEndMarker(field) || isBlockDivider(field) || field.type === 'PAGE_BREAK') continue;
    if (isProgressStopInfoBlock(field) && evaluateCondition(field.condition, answersRecord, { fields: allFields })) {
      return true;
    }
  }

  return false;
}
