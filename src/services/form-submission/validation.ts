/** Validation and sanitising of public form answers and submission metadata. */

import { Prisma, type FormField } from '@/generated/prisma';
import {
  evaluateCondition,
  isEmptyValue,
  parseChoiceOptions,
  parseObject,
  isProgressStopInfoBlock,
  type FormSubmissionAiReview,
} from '@/lib/form-utils';
import { SIGNATURE_DATA_URL_MAX_LENGTH, extractSignatureDataUrl } from '@/lib/signature-utils';
import { COMPANY_NAME_RECORD_COUNT_CAP } from '@/lib/external/company-name-check';
import {
  getNameCheckMode,
  parseNameCheckResultValue,
  type NameCheckResultValue,
} from '@/lib/forms/name-check-result';
import { evaluateArithmeticExpression } from '@/lib/safe-math';
import { isRepeatEndMarker, isRepeatStartMarker } from '@/services/form-builder.helpers';
import { UPLOAD_ID_PATTERN, collectUploadIdsFromAnswer } from './shared';

export function withSubmissionAiReview(
  metadata: unknown,
  aiReview: FormSubmissionAiReview | null
): Record<string, unknown> | null {
  const nextMetadata = parseObject(metadata) ? { ...(metadata as Record<string, unknown>) } : {};

  if (aiReview) {
    nextMetadata.aiReview = aiReview as unknown as Prisma.InputJsonValue;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
}

export function normalizeUploadIds(uploadIds?: string[]): string[] {
  return [...new Set((uploadIds || []).filter((id) => typeof id === 'string' && UPLOAD_ID_PATTERN.test(id)))];
}

function hasItemValue(item: unknown): boolean {
  if (isEmptyValue(item)) return false;
  const itemRecord = parseObject(item);
  if (itemRecord && 'time' in itemRecord && 'timezone' in itemRecord) {
    return typeof itemRecord.time === 'string' && itemRecord.time.trim().length > 0;
  }
  if (itemRecord && 'value' in itemRecord) {
    return typeof itemRecord.value === 'string' && itemRecord.value.trim().length > 0;
  }
  return true;
}

function hasRequiredFieldItemValue(field: FormField, item: unknown): boolean {
  if (
    field.type === 'SHORT_TEXT' &&
    field.inputType === 'phone' &&
    parseObject(field.validation)?.splitPhoneCountryCode === true
  ) {
    if (typeof item !== 'string') return false;
    const trimmed = item.trim();
    const match = trimmed.match(/^\+\d{1,4}\s*(.*)$/);
    return (match ? match[1] : trimmed).trim().length > 0;
  }

  return hasItemValue(item);
}

function sanitizeTimeTimezoneValue(value: unknown): { time: string; timezone: string } | null {
  const record = parseObject(value);
  if (!record) return null;

  const time = typeof record.time === 'string' ? record.time.trim() : '';
  if (!/^\d{2}:\d{2}$/.test(time)) return null;

  const timezone = typeof record.timezone === 'string' ? record.timezone.trim().slice(0, 120) : '';
  return {
    time,
    timezone: timezone || 'Asia/Singapore',
  };
}

type SanitizedChoiceEntry = string | { value: string; detailText?: string; children?: SanitizedChoiceEntry[] };

function sanitizeChoiceEntry(entry: unknown): SanitizedChoiceEntry | null {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 10_000);
  }

  const record = parseObject(entry);
  if (!record) return null;
  const valueText = typeof record.value === 'string' ? record.value.trim() : '';
  if (!valueText) return null;
  const detailTextRaw = typeof record.detailText === 'string' ? record.detailText.trim() : '';
  const detailText = detailTextRaw ? detailTextRaw.slice(0, 10_000) : '';
  const children = Array.isArray(record.children)
    ? record.children
      .slice(0, 100)
      .map((child) => sanitizeChoiceEntry(child))
      .filter((child): child is SanitizedChoiceEntry => !!child)
    : [];

  if (!detailText && children.length === 0) {
    return { value: valueText.slice(0, 10_000) };
  }

  return {
    value: valueText.slice(0, 10_000),
    ...(detailText ? { detailText } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function getTodayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function resolveDateBoundary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'today') return getTodayIsoDate();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}

function addIsoDateDays(value: string, offsetDays: number): string | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function resolveRelativeDateBoundary(
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

function getDateValidationRange(field: FormField, answersRecord: Record<string, unknown>): { minDate?: string; maxDate?: string } {
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

function formatValidationDate(value: string): string {
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

function formatValidationNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toString();
}

function quoteValidationText(value: string): string {
  return `"${value}"`;
}

function normalizeNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function evaluateNumberFormula(formula: string, answersRecord: Record<string, unknown>): number | null {
  const normalizedFormula = formula.trim().replace(/^(>=|<=|>|<|=)\s*/, '');
  const referenced = normalizedFormula.replace(/\[([a-zA-Z][a-zA-Z0-9_]*)\]/g, (_match, fieldKey: string) => {
    const resolved = normalizeNumberValue(answersRecord[fieldKey]);
    return resolved === null ? 'NaN' : String(resolved);
  });

  return evaluateArithmeticExpression(referenced);
}

function getRowAnswerContext(answersRecord: Record<string, unknown>, rowIndex?: number): Record<string, unknown> {
  if (rowIndex === undefined) return answersRecord;

  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answersRecord)) {
    context[key] = Array.isArray(value) ? value[rowIndex] : value;
  }
  return context;
}

function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}

function validateDateFieldValue(field: FormField, value: unknown, answersRecord: Record<string, unknown>): void {
  if (field.type !== 'SHORT_TEXT' || field.inputType !== 'date') return;
  if (typeof value !== 'string') return;

  const normalizedValue = value.trim();
  if (!normalizedValue) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue) || !isRealCalendarDate(normalizedValue)) {
    throw new Error(`Enter a valid date for ${field.label || field.key}.`);
  }

  const { minDate, maxDate } = getDateValidationRange(field, answersRecord);
  if (minDate && normalizedValue < minDate) {
    throw new Error(`${field.label || field.key} must be on or after ${formatValidationDate(minDate)}.`);
  }
  if (maxDate && normalizedValue > maxDate) {
    throw new Error(`${field.label || field.key} must be on or before ${formatValidationDate(maxDate)}.`);
  }
}

function validateTextFieldValue(field: FormField, value: unknown): void {
  if (field.type !== 'LONG_TEXT' && (field.type !== 'SHORT_TEXT' || field.inputType === 'date' || field.inputType === 'number')) {
    return;
  }
  if (typeof value !== 'string' || value.length === 0) return;

  const validation = parseObject(field.validation);
  const text = value;

  if (typeof validation?.minLength === 'number' && text.length < validation.minLength) {
    throw new Error(`${field.label || field.key} must be at least ${validation.minLength} character${validation.minLength === 1 ? '' : 's'}.`);
  }
  if (typeof validation?.maxLength === 'number' && text.length > validation.maxLength) {
    throw new Error(`${field.label || field.key} must be at most ${validation.maxLength} character${validation.maxLength === 1 ? '' : 's'}.`);
  }
  if (typeof validation?.startsWith === 'string' && validation.startsWith.length > 0 && !text.startsWith(validation.startsWith)) {
    throw new Error(`${field.label || field.key} must begin with ${quoteValidationText(validation.startsWith)}.`);
  }
  if (typeof validation?.containsText === 'string' && validation.containsText.length > 0 && !text.includes(validation.containsText)) {
    throw new Error(`${field.label || field.key} must contain ${quoteValidationText(validation.containsText)}.`);
  }
  if (typeof validation?.notContainsText === 'string' && validation.notContainsText.length > 0 && text.includes(validation.notContainsText)) {
    throw new Error(`${field.label || field.key} must not contain ${quoteValidationText(validation.notContainsText)}.`);
  }
  if (typeof validation?.endsWith === 'string' && validation.endsWith.length > 0 && !text.endsWith(validation.endsWith)) {
    throw new Error(`${field.label || field.key} must end with ${quoteValidationText(validation.endsWith)}.`);
  }
}

function validateNumberFieldValue(field: FormField, value: unknown, answersRecord: Record<string, unknown>): void {
  if (field.type !== 'SHORT_TEXT' || field.inputType !== 'number') return;
  if (value === null || value === undefined || value === '') return;

  const numericValue = normalizeNumberValue(value);
  if (numericValue === null) {
    throw new Error(`Enter a valid number for ${field.label || field.key}.`);
  }

  const validation = parseObject(field.validation);
  if (typeof validation?.min === 'number' && numericValue < validation.min) {
    throw new Error(`${field.label || field.key} must be at least ${formatValidationNumber(validation.min)}.`);
  }
  if (typeof validation?.max === 'number' && numericValue > validation.max) {
    throw new Error(`${field.label || field.key} must be at most ${formatValidationNumber(validation.max)}.`);
  }
  if (typeof validation?.equal === 'number' && numericValue !== validation.equal) {
    throw new Error(`${field.label || field.key} must equal ${formatValidationNumber(validation.equal)}.`);
  }
  if (typeof validation?.minFormula === 'string' && validation.minFormula.trim().length > 0) {
    const resolved = evaluateNumberFormula(validation.minFormula, answersRecord);
    if (resolved !== null && numericValue < resolved) {
      throw new Error(`${field.label || field.key} must be at least ${formatValidationNumber(resolved)}.`);
    }
  }
  if (typeof validation?.maxFormula === 'string' && validation.maxFormula.trim().length > 0) {
    const resolved = evaluateNumberFormula(validation.maxFormula, answersRecord);
    if (resolved !== null && numericValue > resolved) {
      throw new Error(`${field.label || field.key} must be at most ${formatValidationNumber(resolved)}.`);
    }
  }
  if (typeof validation?.equalFormula === 'string' && validation.equalFormula.trim().length > 0) {
    const resolved = evaluateNumberFormula(validation.equalFormula, answersRecord);
    if (resolved !== null && numericValue !== resolved) {
      throw new Error(`${field.label || field.key} must equal ${formatValidationNumber(resolved)}.`);
    }
  }
}

function validateTimeTimezoneFieldValue(field: FormField, value: unknown): void {
  if (field.type !== 'SHORT_TEXT' || field.inputType !== 'time_timezone') return;
  if (isEmptyValue(value)) return;

  const normalizedValue = sanitizeTimeTimezoneValue(value);
  if (!normalizedValue) {
    throw new Error(`Enter a valid time and timezone for ${field.label || field.key}.`);
  }
}

function choiceAnswerValue(entry: unknown): string | null {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    return trimmed || null;
  }

  const record = parseObject(entry);
  const value = typeof record?.value === 'string' ? record.value.trim() : '';
  return value || null;
}

function choiceAnswerChildren(entry: unknown): unknown[] {
  const record = parseObject(entry);
  return Array.isArray(record?.children) ? record.children : [];
}

function validateRequiredSelectedChoiceOptions(field: FormField, value: unknown): void {
  if (field.type !== 'MULTIPLE_CHOICE') return;

  const options = parseChoiceOptions(field.options);
  const hasRequiredOption = options.some((option) => option.requiredSelected || option.childOptions.some((childOption) => childOption.requiredSelected));
  if (!hasRequiredOption) return;
  if (isEmptyValue(value)) return;

  const validateChoiceEntries = (entries: unknown[], availableOptions: typeof options): void => {
    const selectedValues = new Set(entries.map(choiceAnswerValue).filter((item): item is string => !!item));
    const missingOption = availableOptions.find((option) => option.requiredSelected && !selectedValues.has(option.value));
    if (missingOption) {
      throw new Error(`${missingOption.label} is required for ${field.label || field.key}.`);
    }

    for (const entry of entries) {
      const entryValue = choiceAnswerValue(entry);
      const option = availableOptions.find((candidate) => candidate.value === entryValue);
      if (!option || option.childOptions.length === 0) continue;
      const childEntries = choiceAnswerChildren(entry);
      if (option.childSelectionMode === 'single' && childEntries.length > 1) {
        throw new Error(`${option.label} allows only one nested option for ${field.label || field.key}.`);
      }
      validateChoiceEntries(childEntries, option.childOptions);
    }
  };

  if (!Array.isArray(value)) {
    validateChoiceEntries([], options);
    return;
  }

  const hasNestedRows = value.some(Array.isArray);
  if (!hasNestedRows) {
    validateChoiceEntries(value, options);
    return;
  }

  for (const rowValue of value) {
    if (isEmptyValue(rowValue)) continue;
    validateChoiceEntries(Array.isArray(rowValue) ? rowValue : [], options);
  }
}

export function validatePublicAnswerConstraints(fields: FormField[], answers: Record<string, unknown>): void {
  for (const field of fields) {
    const value = answers[field.key];
    validateRequiredSelectedChoiceOptions(field, value);

    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        const rowAnswers = getRowAnswerContext(answers, index);
        validateDateFieldValue(field, item, rowAnswers);
        validateTextFieldValue(field, item);
        validateNumberFieldValue(field, item, rowAnswers);
        validateTimeTimezoneFieldValue(field, item);
      }
      continue;
    }

    validateDateFieldValue(field, value, answers);
    validateTextFieldValue(field, value);
    validateNumberFieldValue(field, value, answers);
    validateTimeTimezoneFieldValue(field, value);
  }
}

function getRepeatMinItems(field: FormField): number {
  const validation = parseObject(field.validation);
  const minItemsRaw = typeof validation?.repeatMinItems === 'number' ? Math.trunc(validation.repeatMinItems) : 1;
  return Math.max(1, Math.min(50, minItemsRaw));
}

function getRepeatRowCount(sectionFields: FormField[], answers: Record<string, unknown>, startField: FormField): number {
  let rowCount = getRepeatMinItems(startField);
  for (const sectionField of sectionFields) {
    const value = answers[sectionField.key];
    if (Array.isArray(value)) {
      rowCount = Math.max(rowCount, value.length);
    }
  }
  return Math.max(1, Math.min(50, rowCount));
}

export function hasActiveProgressStopInfoBlock(fields: FormField[], answers: Record<string, unknown>): boolean {
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];

    if (isRepeatStartMarker(field)) {
      const sectionVisible = evaluateCondition(parseObject(field.condition), answers, { fields });
      const sectionFields: FormField[] = [];
      let cursor = index + 1;

      while (cursor < fields.length && !isRepeatEndMarker(fields[cursor])) {
        if (fields[cursor].type !== 'PAGE_BREAK') {
          sectionFields.push(fields[cursor]);
        }
        cursor += 1;
      }

      if (sectionVisible) {
        const rowCount = getRepeatRowCount(sectionFields, answers, field);
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          const rowAnswers = getRowAnswerContext(answers, rowIndex);
          for (const sectionField of sectionFields) {
            if (
              isProgressStopInfoBlock(sectionField) &&
              evaluateCondition(parseObject(sectionField.condition), rowAnswers, { fields: sectionFields })
            ) {
              return true;
            }
          }
        }
      }

      index = cursor;
      continue;
    }

    if (isRepeatEndMarker(field) || field.type === 'PAGE_BREAK') continue;
    if (
      isProgressStopInfoBlock(field) &&
      evaluateCondition(parseObject(field.condition), answers, { fields })
    ) {
      return true;
    }
  }

  return false;
}

function validateRequiredFieldValue(
  field: FormField,
  answers: Record<string, unknown>,
  uploadIdSet: Set<string>,
  rowIndex?: number
): void {
  if (!field.isRequired) return;

  const value = answers[field.key];
  const rowSuffix = rowIndex === undefined ? '' : ` (row ${rowIndex + 1})`;

  if (field.type === 'FILE_UPLOAD') {
    const referencedUploadIds = collectUploadIdsFromAnswer(value)
      .filter((id) => UPLOAD_ID_PATTERN.test(id));

    if (referencedUploadIds.length === 0) {
      throw new Error(`${field.label || field.key} is required${rowSuffix}`);
    }

    const hasMissingUpload = referencedUploadIds.some((id) => !uploadIdSet.has(id));
    if (hasMissingUpload) {
      throw new Error(`${field.label || field.key} has an invalid upload${rowSuffix}`);
    }

    return;
  }

  if (Array.isArray(value)) {
    const hasAllValues = value.length > 0 && value.every((item) => hasRequiredFieldItemValue(field, item));
    if (!hasAllValues) {
      throw new Error(`${field.label || field.key} is required${rowSuffix}`);
    }
    return;
  }

  if (!hasRequiredFieldItemValue(field, value)) {
    throw new Error(`${field.label || field.key} is required${rowSuffix}`);
  }
}

/**
 * Required checks for a repeated section run per row, with each row's own
 * condition context, so a field hidden in one row is not required there.
 */
function validateRequiredRepeatRows(
  startField: FormField,
  sectionFields: FormField[],
  answers: Record<string, unknown>,
  uploadIdSet: Set<string>
): void {
  const rowCount = getRepeatRowCount(sectionFields, answers, startField);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowAnswers = getRowAnswerContext(answers, rowIndex);
    for (const sectionField of sectionFields) {
      if (!sectionField.isRequired) continue;
      if (!evaluateCondition(parseObject(sectionField.condition), rowAnswers, { fields: sectionFields })) continue;

      const value = answers[sectionField.key];
      const rowValue = Array.isArray(value) ? value[rowIndex] : undefined;
      validateRequiredFieldValue(sectionField, { [sectionField.key]: rowValue }, uploadIdSet, rowIndex);
    }
  }
}

export function validateRequiredPublicAnswers(
  fields: FormField[],
  answers: Record<string, unknown>,
  uploadIdSet: Set<string>
): void {
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];

    if (isRepeatStartMarker(field)) {
      const sectionVisible = evaluateCondition(parseObject(field.condition), answers, { fields });
      const sectionFields: FormField[] = [];
      let cursor = index + 1;

      while (cursor < fields.length && !isRepeatEndMarker(fields[cursor])) {
        const sectionField = fields[cursor];
        if (
          sectionField.type !== 'PAGE_BREAK' &&
          sectionField.type !== 'PARAGRAPH' &&
          sectionField.type !== 'HTML' &&
          sectionField.type !== 'HIDDEN'
        ) {
          sectionFields.push(sectionField);
        }
        cursor += 1;
      }

      if (sectionVisible) {
        validateRequiredRepeatRows(field, sectionFields, answers, uploadIdSet);
      }

      index = cursor;
      continue;
    }

    if (
      field.type === 'PAGE_BREAK' ||
      field.type === 'PARAGRAPH' ||
      field.type === 'HTML' ||
      field.type === 'HIDDEN'
    ) {
      continue;
    }

    if (!evaluateCondition(parseObject(field.condition), answers, { fields })) {
      continue;
    }

    validateRequiredFieldValue(field, answers, uploadIdSet);
  }
}

export function sanitizePublicAnswers(
  fields: FormField[],
  answers: Record<string, unknown>,
  uploadIdSet: Set<string>
): Record<string, unknown> {
  const validKeys = new Set(fields.map((field) => field.key));
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const sanitizedAnswers: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(answers)) {
    if (!validKeys.has(key)) continue;

    const field = fieldsByKey.get(key);
    if (!field) continue;

    switch (field.type) {
      case 'SHORT_TEXT':
        if (field.inputType === 'time_timezone') {
          const sanitizeOne = (item: unknown) => sanitizeTimeTimezoneValue(item);
          if (Array.isArray(value)) {
            sanitizedAnswers[key] = value
              .slice(0, 100)
              .map((item) => sanitizeOne(item) ?? { time: '', timezone: 'Asia/Singapore' });
          } else {
            const sanitizedValue = sanitizeOne(value);
            if (sanitizedValue) sanitizedAnswers[key] = sanitizedValue;
          }
          break;
        }
        if (Array.isArray(value)) {
          // Repeated rows keep one slot per row so parallel fields stay aligned.
          sanitizedAnswers[key] = value
            .slice(0, 100)
            .map((item) => (typeof item === 'string' ? item.trim().slice(0, 500) : ''));
          break;
        }
        // falls through: single short-text values are trimmed like company names
      case 'COMPANY_NAME_CHECK':
        if (typeof value === 'string') {
          const trimmed = value.trim().slice(0, 500);
          if (trimmed) {
            sanitizedAnswers[key] = trimmed;
          }
        }
        break;
      case 'LONG_TEXT':
      case 'DROPDOWN':
        if (typeof value === 'string') {
          sanitizedAnswers[key] = value.slice(0, 10_000);
        } else if (Array.isArray(value)) {
          sanitizedAnswers[key] = value
            .slice(0, 100)
            .map((item) => (typeof item === 'string' ? item.slice(0, 10_000) : ''));
        }
        break;
      case 'SINGLE_CHOICE':
        if (Array.isArray(value)) {
          sanitizedAnswers[key] = value
            .slice(0, 100)
            .map((entry) => sanitizeChoiceEntry(entry) ?? '');
        } else {
          const singleValue = sanitizeChoiceEntry(value);
          if (singleValue) {
            sanitizedAnswers[key] = singleValue;
          }
        }
        break;
      case 'MULTIPLE_CHOICE':
        if (Array.isArray(value)) {
          sanitizedAnswers[key] = value.slice(0, 100).map((entry) => {
            if (Array.isArray(entry)) {
              return entry
                .slice(0, 100)
                .map((candidate) => sanitizeChoiceEntry(candidate))
                .map((candidate) => candidate ?? '');
            }
            return sanitizeChoiceEntry(entry) ?? '';
          });
        }
        break;
      case 'FILE_UPLOAD': {
        const referencedUploadIds = collectUploadIdsFromAnswer(value)
          .filter((id) => UPLOAD_ID_PATTERN.test(id) && uploadIdSet.has(id))
          .slice(0, 100);

        if (referencedUploadIds.length > 0) {
          sanitizedAnswers[key] = referencedUploadIds;
        }
        break;
      }
      case 'SIGNATURE':
        {
          const signatureDataUrl = extractSignatureDataUrl(value);
          if (signatureDataUrl) {
            if (signatureDataUrl.length > SIGNATURE_DATA_URL_MAX_LENGTH) {
              throw new Error('Signature image is too large. Please redraw or upload a smaller signature image.');
            }
            sanitizedAnswers[key] = signatureDataUrl;
          }
        }
        break;
      case 'HIDDEN':
        if (typeof value === 'string') {
          sanitizedAnswers[key] = value.slice(0, 10_000);
        }
        break;
      default:
        break;
    }
  }

  const totalSize = JSON.stringify(sanitizedAnswers).length;
  if (totalSize > 5_000_000) {
    throw new Error('Submission answers payload is too large. Please reduce the size of your responses.');
  }

  return sanitizedAnswers;
}

function getVisibleCompanyNameCheckFields(fields: FormField[]): FormField[] {
  const visible: FormField[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];

    if (isRepeatStartMarker(field)) {
      while (index < fields.length && !isRepeatEndMarker(fields[index])) {
        index += 1;
      }
      continue;
    }

    if (
      isRepeatEndMarker(field) ||
      field.type === 'PAGE_BREAK' ||
      field.type === 'PARAGRAPH' ||
      field.type === 'HTML' ||
      field.type === 'HIDDEN'
    ) {
      continue;
    }

    if (field.type === 'COMPANY_NAME_CHECK' && getNameCheckMode(field.validation) === 'strict') {
      visible.push(field);
    }
  }

  return visible;
}

export function validateCompanyNameCheckResults(
  fields: FormField[],
  answers: Record<string, unknown>,
  metadata: unknown
): void {
  const metadataRoot = parseObject(metadata);
  const results = metadataRoot ? parseObject(metadataRoot.nameCheckResults) : null;

  for (const field of getVisibleCompanyNameCheckFields(fields)) {
    if (!evaluateCondition(parseObject(field.condition), answers, { fields })) continue;

    const value = answers[field.key];
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name) {
      throw new Error(`Company name availability check is required for ${field.label || field.key}`);
    }

    const result = results ? parseObject(results[field.key]) : null;
    const checkedName = typeof result?.name === 'string' ? result.name.trim() : '';
    const recordsAreValid = Array.isArray(result?.records);
    const recordCount = recordsAreValid ? (result?.records as unknown[]).length : 0;
    const availabilityIsConsistent =
      typeof result?.available === 'boolean' &&
      recordsAreValid &&
      result.available === (recordCount === 0);

    if (
      !result ||
      checkedName !== name ||
      typeof result.checkedAt !== 'string' ||
      !result.checkedAt.trim() ||
      !recordsAreValid ||
      !availabilityIsConsistent
    ) {
      throw new Error(`Company name availability check is required for ${field.label || field.key}`);
    }

    if (!result.available) {
      throw new Error(
        `Similar names were found for ${field.label || field.key}. Please enter an available company name.`
      );
    }
  }
}

export function sanitizeSubmissionMetadata(
  metadata: unknown,
  fields: FormField[],
  answers: Record<string, unknown>,
  serverNameChecks: Record<string, NameCheckResultValue> = {}
): Record<string, unknown> {
  const root = parseObject(metadata) ? { ...(metadata as Record<string, unknown>) } : {};
  const rawResults = parseObject(root.nameCheckResults);
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const sanitizedResults: Record<string, unknown> = {};

  if (rawResults) {
    for (const [fieldKey, entry] of Object.entries(rawResults)) {
      const field = fieldByKey.get(fieldKey);
      if (!field || field.type !== 'COMPANY_NAME_CHECK') continue;
      // Advisory fields are rechecked on the server; the client claim is never kept.
      if (getNameCheckMode(field.validation) === 'advisory') continue;

      const parsed = parseNameCheckResultValue(entry);
      if (!parsed) continue;

      const answerName = typeof answers[fieldKey] === 'string' ? answers[fieldKey].trim() : '';
      if (!answerName || parsed.name !== answerName) continue;

      sanitizedResults[fieldKey] = {
        name: parsed.name,
        available: parsed.available,
        ...(parseObject(entry)?.assessment ? { assessment: parsed.assessment } : {}),
        checkedAt: parsed.checkedAt,
        records: parsed.records.slice(0, COMPANY_NAME_RECORD_COUNT_CAP),
        ...(parsed.dataAsOf ? { dataAsOf: parsed.dataAsOf } : {}),
        ...(parsed.reasonCodes.length > 0 ? { reasonCodes: parsed.reasonCodes } : {}),
      };
    }
  }

  for (const [fieldKey, result] of Object.entries(serverNameChecks)) {
    const field = fieldByKey.get(fieldKey);
    if (!field || field.type !== 'COMPANY_NAME_CHECK') continue;
    sanitizedResults[fieldKey] = { ...result, source: 'server' };
  }

  const nextMetadata = { ...root };
  // Server-owned keys can never come from the public payload.
  delete nextMetadata.companyIncorporation;
  delete nextMetadata.companyIncorporationReview;
  delete nextMetadata.responseReviewStatus;
  delete nextMetadata.aiReview;
  delete nextMetadata.responseTags;
  if (Object.keys(sanitizedResults).length > 0) {
    nextMetadata.nameCheckResults = sanitizedResults;
  } else {
    delete nextMetadata.nameCheckResults;
  }

  return nextMetadata;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------
