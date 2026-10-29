import { Prisma, type FormField } from '@/generated/prisma';
import { parseChoiceOptions, parseObject } from '@/lib/form-utils';
import { prisma } from '@/lib/prisma';

export const DEFAULT_TENANT_TIME_ZONE = 'Asia/Singapore';

export function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

export function normalizeTenantTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return DEFAULT_TENANT_TIME_ZONE;
  }

  const candidate = value.trim();
  try {
    Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_TENANT_TIME_ZONE;
  }
}

export async function getTenantTimeZone(tenantId: string): Promise<string> {
  const tenant = await prisma.workspace.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });

  const settings = parseObject(tenant?.settings);
  return normalizeTenantTimeZone(settings?.timezone);
}

export function isRepeatStartMarker(field: { type: string; inputType: string | null }): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'repeat_start';
}

export function isRepeatEndMarker(field: { type: string; inputType: string | null }): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'repeat_end';
}

export function escapeHtml(value: string): string {
  return value.replace(/[<>&]/g, (match) => (
    match === '<' ? '&lt;' : match === '>' ? '&gt;' : '&amp;'
  ));
}

type ParsedChoiceOption = ReturnType<typeof parseChoiceOptions>[number];

function choiceEntryValue(entry: unknown): string {
  if (typeof entry === 'string') return entry.trim();
  const entryRecord = parseObject(entry);
  return typeof entryRecord?.value === 'string' ? entryRecord.value.trim() : '';
}

function choiceEntryChildren(entry: unknown): unknown[] {
  const entryRecord = parseObject(entry);
  return Array.isArray(entryRecord?.children) ? entryRecord.children : [];
}

function buildChoiceAnswerValue(option: ParsedChoiceOption, existingEntry?: unknown): unknown {
  const existingRecord = parseObject(existingEntry);
  const existingChildren = choiceEntryChildren(existingEntry);
  const defaultChildOptions = option.childOptions
    .filter((childOption) => childOption.defaultSelected || childOption.requiredSelected);
  const childOptionsToApply = option.childSelectionMode === 'single'
    ? defaultChildOptions.slice(0, 1)
    : defaultChildOptions;
  const childDefaults = childOptionsToApply.map((childOption) => buildChoiceAnswerValue(childOption));
  const childValues = new Set(existingChildren.map(choiceEntryValue));
  const missingChildDefaults = childDefaults.filter((childDefault) => !childValues.has(choiceEntryValue(childDefault)));
  const children = option.childSelectionMode === 'single'
    ? ([...existingChildren, ...missingChildDefaults].slice(0, 1))
    : [...existingChildren, ...missingChildDefaults];
  const detailText = typeof existingRecord?.detailText === 'string' ? existingRecord.detailText : '';

  if (!option.allowTextInput && children.length === 0 && !detailText) {
    return option.value;
  }

  return {
    value: option.value,
    detailText,
    ...(children.length > 0 ? { children } : {}),
  };
}

function getConfiguredDefaultValue(field: FormField, todayIso: string): unknown | null {
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

  if (field.type === 'SHORT_TEXT' && field.inputType === 'date' && validation?.defaultToday === true) {
    return todayIso;
  }

  return null;
}

export function applyDefaultTodayAnswers(
  fields: FormField[],
  inputAnswers: Record<string, unknown>
): Record<string, unknown> {
  const answers = { ...inputAnswers };
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  for (const field of fields) {
    const currentValue = answers[field.key];
    const hasAnswer = Object.prototype.hasOwnProperty.call(answers, field.key);
    if (field.type === 'SINGLE_CHOICE') {
      const defaultOption = parseChoiceOptions(field.options).find((option) => option.defaultSelected);
      if (defaultOption && !hasAnswer) {
        answers[field.key] = defaultOption.allowTextInput
          ? { value: defaultOption.value, detailText: '' }
          : defaultOption.value;
      }
      continue;
    }

    if (field.type === 'MULTIPLE_CHOICE') {
      const defaultOptions = parseChoiceOptions(field.options)
        .filter((option) => option.defaultSelected || option.requiredSelected);
      const defaultValue = defaultOptions
        .map((option) => buildChoiceAnswerValue(option));
      const requiredOptions = defaultOptions.filter((option) => option.requiredSelected);

      if (defaultValue.length > 0 && !hasAnswer) {
        answers[field.key] = defaultValue;
      } else if (Array.isArray(currentValue)) {
        const options = parseChoiceOptions(field.options);
        const optionByValue = new Map(options.map((option) => [option.value, option]));
        const currentWithRequiredChildren = currentValue.map((item) => {
          const option = optionByValue.get(choiceEntryValue(item));
          if (!option) return item;
          const nextItem = buildChoiceAnswerValue(option, item);
          return JSON.stringify(nextItem) === JSON.stringify(item) ? item : nextItem;
        });
        const existingValues = new Set(currentWithRequiredChildren.map(choiceEntryValue));
        const missingRequiredValues = requiredOptions
          .filter((option) => !existingValues.has(option.value))
          .map((option) => buildChoiceAnswerValue(option));

        if (missingRequiredValues.length > 0 || currentWithRequiredChildren.some((item, index) => item !== currentValue[index])) {
          answers[field.key] = [...currentWithRequiredChildren, ...missingRequiredValues];
        }
      }
      continue;
    }

    if (field.type === 'SHORT_TEXT' && field.inputType === 'time_timezone') {
      const validation = parseObject(field.validation);
      const timezone = normalizeTenantTimeZone(validation?.timezoneDefault);
      if (Array.isArray(currentValue)) {
        answers[field.key] = currentValue.map((rowValue) => {
          const rowRecord = parseObject(rowValue);
          const time = typeof rowRecord?.time === 'string' ? rowRecord.time : '';
          const rowTimezone = typeof rowRecord?.timezone === 'string' ? rowRecord.timezone : timezone;
          return { time, timezone: normalizeTenantTimeZone(rowTimezone) };
        });
      } else if (!hasAnswer) {
        answers[field.key] = { time: '', timezone };
      }
      continue;
    }

    const defaultValue = getConfiguredDefaultValue(field, todayIso);
    if (defaultValue === null) continue;

    const validation = parseObject(field.validation);
    const shouldAlwaysDefaultToday = field.type === 'SHORT_TEXT'
      && field.inputType === 'date'
      && validation?.alwaysDefaultToday === true;

    if (Array.isArray(currentValue)) {
      answers[field.key] = currentValue.map((rowValue) => (shouldAlwaysDefaultToday || rowValue === undefined ? defaultValue : rowValue));
      continue;
    }

    if (shouldAlwaysDefaultToday || !hasAnswer) {
      answers[field.key] = defaultValue;
    }
  }

  return answers;
}
