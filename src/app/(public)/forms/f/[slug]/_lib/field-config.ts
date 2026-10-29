/**
 * Field configuration readers: defaults, uploads, tooltips, info blocks, phone,
 * time and repeat sections.
 */

import React from 'react';
import { parseObject, type PublicFormField as PublicField } from '@/lib/form-utils';
import {
  DEFAULT_PHONE_COUNTRY_CODE,
  PHONE_COUNTRY_CODE_OPTIONS,
} from '@/lib/constants/phone-country-codes';
import { TIMEZONE_OPTIONS } from '@/lib/constants/timezones';
import { parseNameCheckResultMap } from '@/lib/forms/name-check-result';
import {
  UUID_PATTERN,
  NAME_HINT_PATTERN,
  EMAIL_HINT_PATTERN,
  DATA_URI_PATTERN,
  HEX_COLOR_PATTERN,
  DEFAULT_TIMEZONE,
} from './constants';
import {
  type UploadStatus,
  type NameCheckResult,
  type RepeatSectionConfig,
  type InfoPadding,
} from './types';

export function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) return null;
  if (DATA_URI_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export function inferRespondentName(
  orderedFields: PublicField[],
  answersRecord: Record<string, unknown>
): string | null {
  const shortTextFields = orderedFields.filter((field) => field.type === 'SHORT_TEXT');
  const inferredNameField = shortTextFields.find((field) => {
    const hint = `${field.key} ${field.label || ''}`;
    return NAME_HINT_PATTERN.test(hint);
  });
  const fallbackNameAnswer = answersRecord.full_name ?? answersRecord.name;
  return normalizeOptionalText(
    inferredNameField ? answersRecord[inferredNameField.key] : fallbackNameAnswer,
    200
  );
}

export function inferRespondentEmail(
  orderedFields: PublicField[],
  answersRecord: Record<string, unknown>
): string | null {
  const shortTextFields = orderedFields.filter((field) => field.type === 'SHORT_TEXT');
  const inferredEmailField = shortTextFields.find((field) => {
    const hint = `${field.key} ${field.label || ''}`;
    return field.inputType === 'email' || EMAIL_HINT_PATTERN.test(hint);
  });
  const fallbackEmailAnswer = answersRecord.email_address ?? answersRecord.email;
  const normalizedEmailCandidate = normalizeOptionalText(
    inferredEmailField ? answersRecord[inferredEmailField.key] : fallbackEmailAnswer,
    320
  );

  return normalizedEmailCandidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmailCandidate)
    ? normalizedEmailCandidate.toLowerCase()
    : null;
}

export function toDomSafeId(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'field';
}

export function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 B';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function collectUploadIds(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return UUID_PATTERN.test(trimmed) ? [trimmed] : [];
  }

  if (!Array.isArray(value)) return [];

  const ids: string[] = [];
  for (const item of value) {
    ids.push(...collectUploadIds(item));
  }
  return ids;
}

export function formatDraftDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function isMultipleFileUploadEnabled(field: PublicField): boolean {
  if (field.type !== 'FILE_UPLOAD') return false;
  const validation = parseObject(field.validation);
  return validation?.allowMultipleFiles === true;
}

export function normalizeDraftUploadsByFieldKey(value: unknown): Record<string, UploadStatus[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result: Record<string, UploadStatus[]> = {};
  for (const [fieldKey, rawUploads] of Object.entries(value)) {
    const rawList = Array.isArray(rawUploads) ? rawUploads : [rawUploads];
    const uploads = rawList
      .filter((item): item is UploadStatus => !!item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        fileName: typeof item.fileName === 'string' ? item.fileName : 'Uploaded file',
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : 'application/octet-stream',
        sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : 0,
      }))
      .filter((item) => item.id.length > 0);

    if (uploads.length > 0) {
      result[fieldKey] = uploads;
    }
  }

  return result;
}

export function isTooltipEnabled(field: PublicField): boolean {
  const validation = parseObject(field.validation);
  return validation?.tooltipEnabled === true && typeof field.helpText === 'string' && field.helpText.trim().length > 0;
}

export function getTooltipMode(field: PublicField): 'hover' | 'inline' {
  const validation = parseObject(field.validation);
  return validation?.tooltipMode === 'inline' ? 'inline' : 'hover';
}

export function getTooltipInfoStyle(field: PublicField): React.CSSProperties {
  const validation = parseObject(field.validation);
  const top = parseInfoPaddingValue(validation?.tooltipInfoPaddingTopPx) ?? 8;
  const right = parseInfoPaddingValue(validation?.tooltipInfoPaddingRightPx) ?? 12;
  const bottom = parseInfoPaddingValue(validation?.tooltipInfoPaddingBottomPx) ?? 8;
  const left = parseInfoPaddingValue(validation?.tooltipInfoPaddingLeftPx) ?? 12;

  return {
    backgroundColor: normalizeHexColor(validation?.tooltipInfoBackgroundColor) || '#f8fafc',
    paddingTop: `${top}px`,
    paddingRight: `${right}px`,
    paddingBottom: `${bottom}px`,
    paddingLeft: `${left}px`,
  };
}

export function isValidHttpUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!HEX_COLOR_PATTERN.test(trimmed)) return null;

  if (trimmed.length === 4) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }

  return trimmed;
}

export function getInfoBackgroundColor(field: PublicField): string | null {
  if (field.type !== 'PARAGRAPH') return null;
  const validation = parseObject(field.validation);
  if (validation?.infoBareStyle === true) return null;
  return normalizeHexColor(validation?.infoBackgroundColor);
}

export function isBareInfoBlock(field: PublicField): boolean {
  const validation = parseObject(field.validation);
  const supportsBareStyle = field.inputType === 'info_text' || field.inputType === 'info_url' || !field.inputType;
  return field.type === 'PARAGRAPH' && supportsBareStyle && validation?.infoBareStyle === true;
}

export function parseInfoPaddingValue(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : (typeof value === 'string' ? Number.parseInt(value, 10) : NaN);

  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.round(parsed);
  if (normalized < 0 || normalized > 80) return null;
  return normalized;
}

export function getInfoPadding(field: PublicField): InfoPadding | null {
  if (field.type !== 'PARAGRAPH') return null;
  const validation = parseObject(field.validation);
  const fallbackPadding = parseInfoPaddingValue(validation?.infoPaddingPx);
  const top = parseInfoPaddingValue(validation?.infoPaddingTopPx) ?? fallbackPadding;
  const right = parseInfoPaddingValue(validation?.infoPaddingRightPx) ?? fallbackPadding;
  const bottom = parseInfoPaddingValue(validation?.infoPaddingBottomPx) ?? fallbackPadding;
  const left = parseInfoPaddingValue(validation?.infoPaddingLeftPx) ?? fallbackPadding;

  if (top === null && right === null && bottom === null && left === null) {
    return validation?.infoBareStyle === true ? { top: 0, right: 0, bottom: 0, left: 0 } : null;
  }

  return { top, right, bottom, left };
}

export function isDateDefaultTodayEnabled(field: PublicField): boolean {
  if (field.type !== 'SHORT_TEXT' || field.inputType !== 'date') return false;
  const validation = parseObject(field.validation);
  return validation?.defaultToday === true || validation?.alwaysDefaultToday === true;
}

export function isDateAlwaysDefaultTodayEnabled(field: PublicField): boolean {
  if (field.type !== 'SHORT_TEXT' || field.inputType !== 'date') return false;
  const validation = parseObject(field.validation);
  return validation?.alwaysDefaultToday === true;
}

export function getConfiguredDefaultValue(field: PublicField, todayIso: string): unknown | null {
  if (field.type !== 'SHORT_TEXT' && field.type !== 'LONG_TEXT' && field.type !== 'DROPDOWN') return null;
  const validation = parseObject(field.validation);
  if (field.type === 'SHORT_TEXT' && field.inputType === 'date' && validation?.alwaysDefaultToday === true) {
    return todayIso;
  }

  const defaultValue = typeof validation?.defaultValue === 'string' ? validation.defaultValue : '';
  if (defaultValue.length > 0) {
    if (field.type === 'SHORT_TEXT' && field.inputType === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(defaultValue)) {
      return null;
    }
    return defaultValue;
  }

  if (isDateDefaultTodayEnabled(field)) {
    return todayIso;
  }

  return null;
}

export function applyAlwaysDefaultTodayAnswers(
  fields: PublicField[],
  inputAnswers: Record<string, unknown>,
  todayIso: string
): Record<string, unknown> {
  const next = { ...inputAnswers };
  let changed = false;

  for (const field of fields) {
    if (!isDateAlwaysDefaultTodayEnabled(field)) continue;

    const currentValue = next[field.key];
    if (Array.isArray(currentValue)) {
      const nextRows = currentValue.map(() => todayIso);
      if (JSON.stringify(nextRows) !== JSON.stringify(currentValue)) {
        next[field.key] = nextRows;
        changed = true;
      }
      continue;
    }

    if (currentValue !== todayIso) {
      next[field.key] = todayIso;
      changed = true;
    }
  }

  return changed ? next : inputAnswers;
}

export function isSplitPhoneCountryCodeEnabled(field: PublicField): boolean {
  if (field.type !== 'SHORT_TEXT' || field.inputType !== 'phone') return false;
  const validation = parseObject(field.validation);
  return validation?.splitPhoneCountryCode === true;
}

export function getPhoneDefaultCountryCode(field: PublicField): string {
  if (field.type !== 'SHORT_TEXT' || field.inputType !== 'phone') return DEFAULT_PHONE_COUNTRY_CODE;
  const validation = parseObject(field.validation);
  const rawValue = typeof validation?.phoneDefaultCountryCode === 'string' ? validation.phoneDefaultCountryCode.trim() : '';
  const matched = PHONE_COUNTRY_CODE_OPTIONS.find((option) => option.value === rawValue);
  return matched?.value || DEFAULT_PHONE_COUNTRY_CODE;
}

export function parsePhoneParts(value: unknown, defaultCountryCode: string): { countryCode: string; number: string } {
  if (typeof value !== 'string') {
    return { countryCode: defaultCountryCode, number: '' };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { countryCode: defaultCountryCode, number: '' };
  }

  const match = trimmed.match(/^(\+\d{1,4})\s*(.*)$/);
  if (!match) {
    return { countryCode: defaultCountryCode, number: trimmed };
  }

  const matchedCode = PHONE_COUNTRY_CODE_OPTIONS.find((option) => option.value === match[1])?.value || defaultCountryCode;
  return {
    countryCode: matchedCode,
    number: match[2].trim(),
  };
}

export function buildPhoneValue(countryCode: string, number: string): string {
  const trimmedNumber = number.trim();
  if (!trimmedNumber) return countryCode;
  return `${countryCode} ${trimmedNumber}`;
}

export function getTimezoneDefault(field: PublicField): string {
  if (field.type !== 'SHORT_TEXT' || field.inputType !== 'time_timezone') return DEFAULT_TIMEZONE;
  const validation = parseObject(field.validation);
  const rawValue = typeof validation?.timezoneDefault === 'string' ? validation.timezoneDefault.trim() : '';
  return TIMEZONE_OPTIONS.some((option) => option.value === rawValue) ? rawValue : DEFAULT_TIMEZONE;
}

export function parseTimeTimezoneValue(value: unknown, defaultTimezone: string): { time: string; timezone: string } {
  const record = parseObject(value);
  const rawTime = typeof record?.time === 'string' ? record.time.trim() : '';
  const rawTimezone = typeof record?.timezone === 'string' ? record.timezone.trim() : '';
  const matchedTimezone = TIMEZONE_OPTIONS.some((option) => option.value === rawTimezone) ? rawTimezone : defaultTimezone;
  return {
    time: /^\d{2}:\d{2}$/.test(rawTime) ? rawTime : '',
    timezone: matchedTimezone,
  };
}

export function buildTimeTimezoneValue(time: string, timezone: string): { time: string; timezone: string } {
  return {
    time,
    timezone: TIMEZONE_OPTIONS.some((option) => option.value === timezone) ? timezone : DEFAULT_TIMEZONE,
  };
}

export function isLayoutBreakBeforeEnabled(field: PublicField): boolean {
  const validation = parseObject(field.validation);
  return validation?.layoutBreakBefore === true;
}

export function isRepeatStartMarker(field: PublicField): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'repeat_start';
}

export function isRepeatEndMarker(field: PublicField): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'repeat_end';
}

export function isBlockDivider(field: PublicField): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'block_divider';
}

export function getRepeatSectionConfig(startField: PublicField): RepeatSectionConfig {
  const validation = parseObject(startField.validation);
  const minItemsRaw = typeof validation?.repeatMinItems === 'number' ? Math.trunc(validation.repeatMinItems) : 1;
  const maxItemsRaw = typeof validation?.repeatMaxItems === 'number' ? Math.trunc(validation.repeatMaxItems) : null;
  const minItems = Math.max(1, Math.min(50, minItemsRaw));
  const maxItems = maxItemsRaw === null ? null : Math.max(minItems, Math.min(50, maxItemsRaw));
  const addLabelRaw = typeof validation?.repeatAddLabel === 'string' ? validation.repeatAddLabel.trim() : '';

  const itemLabelRaw = typeof validation?.repeatItemLabel === 'string' ? validation.repeatItemLabel.trim() : '';
  const totalFieldKey = typeof validation?.repeatTotalFieldKey === 'string' ? validation.repeatTotalFieldKey.trim() : '';
  const totalTarget = typeof validation?.repeatTotalTarget === 'number' && Number.isFinite(validation.repeatTotalTarget)
    ? validation.repeatTotalTarget
    : null;

  return {
    id: startField.id || startField.key,
    minItems,
    maxItems,
    addLabel: addLabelRaw || 'Add row',
    itemLabel: itemLabelRaw || null,
    total: totalFieldKey
      ? {
        fieldKey: totalFieldKey,
        label: typeof validation?.repeatTotalLabel === 'string' && validation.repeatTotalLabel.trim() ? validation.repeatTotalLabel.trim() : 'Total',
        suffix: typeof validation?.repeatTotalSuffix === 'string' ? validation.repeatTotalSuffix : '',
        target: totalTarget,
      }
      : null,
  };
}

export function getFieldErrorKey(fieldKey: string, rowIndex?: number): string {
  return rowIndex === undefined ? fieldKey : `${fieldKey}__${rowIndex}`;
}

export function formatDataAsOf(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function parseNameCheckResults(value: unknown): Record<string, NameCheckResult> {
  return parseNameCheckResultMap(value);
}
