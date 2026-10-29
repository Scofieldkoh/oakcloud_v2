/** Choice option localisation and choice answer building, parsing and validation. */

import {
  parseObject,
  parseChoiceOptions,
  evaluateCondition,
  type PublicFormField as PublicField,
} from '@/lib/form-utils';
import {
  COUNTRY_PRESET_OPTIONS,
  NATIONALITY_PRESET_OPTIONS,
  getLocalizedCountryPresetOptions,
  getLocalizedNationalityPresetOptions,
} from '@/lib/constants/form-option-presets';
import { type ChoiceChipOption } from '@/components/forms/choice-chips';
import { interpolateUiLabel } from './labels';
import { type ChoiceAnswerEntry } from './types';

export function matchesPresetOptions(
  options: ReturnType<typeof parseChoiceOptions>,
  preset: readonly string[]
): boolean {
  return options.length === preset.length && options.every((option, index) => option.label === preset[index]);
}

export function localizePresetChoiceOptions(
  options: ReturnType<typeof parseChoiceOptions>,
  locale: string
): ReturnType<typeof parseChoiceOptions> {
  if (locale === 'en') return options;

  if (matchesPresetOptions(options, COUNTRY_PRESET_OPTIONS)) {
    const localizedOptions = getLocalizedCountryPresetOptions(locale);
    return options.map((option, index) => ({
      ...option,
      label: localizedOptions[index]?.label || option.label,
    }));
  }

  if (matchesPresetOptions(options, NATIONALITY_PRESET_OPTIONS)) {
    const localizedOptions = getLocalizedNationalityPresetOptions(locale);
    return options.map((option, index) => ({
      ...option,
      label: localizedOptions[index]?.label || option.label,
    }));
  }

  return options;
}

export function withLocalizedFieldText(field: PublicField, fieldTranslation: Record<string, unknown> | null, locale: string): PublicField {
  if (!fieldTranslation) {
    const parsedOptions = parseChoiceOptions(field.options);
    if (parsedOptions.length === 0) return field;

    return {
      ...field,
      options: localizePresetChoiceOptions(parsedOptions, locale),
    };
  }

  const label = typeof fieldTranslation.label === 'string' && fieldTranslation.label.trim().length > 0
    ? fieldTranslation.label.trim()
    : field.label;
  const placeholder = typeof fieldTranslation.placeholder === 'string' && fieldTranslation.placeholder.trim().length > 0
    ? fieldTranslation.placeholder.trim()
    : field.placeholder;
  const subtext = typeof fieldTranslation.subtext === 'string' && fieldTranslation.subtext.trim().length > 0
    ? fieldTranslation.subtext.trim()
    : field.subtext;
  const helpText = typeof fieldTranslation.helpText === 'string' && fieldTranslation.helpText.trim().length > 0
    ? fieldTranslation.helpText.trim()
    : field.helpText;

  const optionTranslations = Array.isArray(fieldTranslation.options)
    ? fieldTranslation.options.map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      const optionTranslation = parseObject(entry);
      if (!optionTranslation) return '';
      return {
        label: typeof optionTranslation.label === 'string' ? optionTranslation.label.trim() : '',
        bodyHtml: typeof optionTranslation.bodyHtml === 'string' ? optionTranslation.bodyHtml.trim() : '',
      };
    })
    : [];

  let options = field.options;
  if (optionTranslations.length > 0) {
    const parsedOptions = parseChoiceOptions(field.options);
    if (parsedOptions.length > 0) {
      options = parsedOptions.map((option, index) => ({
        ...option,
        label: typeof optionTranslations[index] === 'string'
          ? optionTranslations[index]
          : optionTranslations[index]?.label || option.label,
        bodyHtml: typeof optionTranslations[index] === 'object'
          ? optionTranslations[index]?.bodyHtml || option.bodyHtml
          : option.bodyHtml,
      }));
    }
  } else {
    const parsedOptions = parseChoiceOptions(field.options);
    if (parsedOptions.length > 0) {
      options = localizePresetChoiceOptions(parsedOptions, locale);
    }
  }

  return {
    ...field,
    label,
    placeholder,
    subtext,
    helpText,
    options,
  };
}

export function getDefaultMultipleChoiceValue(field: PublicField): unknown[] {
  if (field.type !== 'MULTIPLE_CHOICE') return [];
  return parseChoiceOptions(field.options)
    .filter((option) => option.defaultSelected || option.requiredSelected)
    .map((option) => buildChoiceAnswerValue(option));
}

export function choiceEntryValue(entry: unknown): string {
  if (typeof entry === 'string') return entry.trim();
  const entryRecord = parseObject(entry);
  return typeof entryRecord?.value === 'string' ? entryRecord.value.trim() : '';
}

export function buildChoiceAnswerValue(
  option: ReturnType<typeof parseChoiceOptions>[number],
  existingEntry?: unknown
): unknown {
  const existingRecord = parseObject(existingEntry);
  const existingChildren = parseChoiceAnswerEntries(existingRecord?.children);
  const defaultChildOptions = option.childOptions
    .filter((childOption) => childOption.defaultSelected || childOption.requiredSelected);
  const childOptionsToApply = option.childSelectionMode === 'single'
    ? defaultChildOptions.slice(0, 1)
    : defaultChildOptions;
  const childDefaults = childOptionsToApply.map((childOption) => buildChoiceAnswerValue(childOption));
  const childValues = new Set(existingChildren.map((entry) => entry.value));
  const missingChildDefaults = childDefaults.filter((childDefault) => !childValues.has(choiceEntryValue(childDefault)));
  const children = option.childSelectionMode === 'single'
    ? ([...existingChildren.map(serializeChoiceAnswerEntry), ...missingChildDefaults].slice(0, 1))
    : [...existingChildren.map(serializeChoiceAnswerEntry), ...missingChildDefaults];
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

export function serializeChoiceAnswerEntry(entry: ChoiceAnswerEntry): unknown {
  if (!entry.detailText && entry.children.length === 0) return entry.value;
  return {
    value: entry.value,
    detailText: entry.detailText,
    ...(entry.children.length > 0 ? { children: entry.children.map(serializeChoiceAnswerEntry) } : {}),
  };
}

export function serializeChoiceAnswerEntries(entries: ChoiceAnswerEntry[]): unknown[] {
  return entries.map(serializeChoiceAnswerEntry);
}

export function ensureRequiredMultipleChoiceValue(field: PublicField, value: unknown): unknown[] | null {
  if (field.type !== 'MULTIPLE_CHOICE' || !Array.isArray(value)) return null;
  const options = parseChoiceOptions(field.options);
  const requiredOptions = options.filter((option) => option.requiredSelected);
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  if (requiredOptions.length === 0 && options.every((option) => option.childOptions.length === 0)) return null;

  const entries = parseChoiceAnswerEntries(value);
  const normalizedEntries = entries.map((entry) => {
    const option = optionByValue.get(entry.value);
    if (!option) return serializeChoiceAnswerEntry(entry);
    return buildChoiceAnswerValue(option, serializeChoiceAnswerEntry(entry));
  });
  const selectedValues = new Set(normalizedEntries.map(choiceEntryValue));
  const missingRequiredValues = requiredOptions
    .filter((option) => !selectedValues.has(option.value))
    .map((option) => buildChoiceAnswerValue(option));
  const nextValue = [...normalizedEntries, ...missingRequiredValues];

  return JSON.stringify(nextValue) === JSON.stringify(value) ? null : nextValue;
}

export function getDefaultSingleChoiceValue(field: PublicField): unknown | null {
  if (field.type !== 'SINGLE_CHOICE') return null;
  const option = parseChoiceOptions(field.options).find((candidate) => candidate.defaultSelected);
  if (!option) return null;
  return option.allowTextInput ? { value: option.value, detailText: '' } : option.value;
}

export function getChoiceOptionDisplayLabel(option: ReturnType<typeof parseChoiceOptions>[number]): string {
  return option.requiredSelected ? `${option.label} (Required)` : option.label;
}

export function isChoiceInlineRightEnabled(field: PublicField): boolean {
  if (field.type !== 'SINGLE_CHOICE' && field.type !== 'MULTIPLE_CHOICE') return false;
  const validation = parseObject(field.validation);
  return validation?.choiceInlineRight === true;
}

export function isChoiceChipsEnabled(field: PublicField): boolean {
  if (field.type !== 'SINGLE_CHOICE' && field.type !== 'MULTIPLE_CHOICE') return false;
  return parseObject(field.validation)?.choiceLayout === 'chips';
}

/** Chip options whose condition holds; a selected option stays visible so it can be cleared. */
export function toChoiceChipOptions(
  options: ReturnType<typeof parseChoiceOptions>,
  answers: Record<string, unknown>,
  selected: string[],
): ChoiceChipOption[] {
  return options
    .filter((option) => !option.condition || selected.includes(option.value) || evaluateCondition(option.condition, answers))
    .map((option) => ({ value: option.value, label: getChoiceOptionDisplayLabel(option), locked: option.requiredSelected === true }));
}

export function parseChoiceAnswerEntry(value: unknown): ChoiceAnswerEntry | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return { value: trimmed, detailText: '', children: [] };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const answerValue = typeof record.value === 'string' ? record.value.trim() : '';
  if (!answerValue) return null;
  const detailText = typeof record.detailText === 'string' ? record.detailText : '';
  const children = parseChoiceAnswerEntries(record.children);
  return { value: answerValue, detailText, children };
}

export function parseChoiceAnswerEntries(value: unknown): ChoiceAnswerEntry[] {
  if (!Array.isArray(value)) {
    const entry = parseChoiceAnswerEntry(value);
    return entry ? [entry] : [];
  }

  const entries: ChoiceAnswerEntry[] = [];
  for (const item of value) {
    const entry = parseChoiceAnswerEntry(item);
    if (!entry) continue;
    entries.push(entry);
  }
  return entries;
}

export function getChoiceDetailValidationError(
  fieldLabel: string,
  options: ReturnType<typeof parseChoiceOptions>,
  value: unknown,
  template: string
): string | null {
  const entries = parseChoiceAnswerEntries(value);
  if (entries.length === 0) return null;

  const validateEntries = (
    availableOptions: ReturnType<typeof parseChoiceOptions>,
    selectedEntries: ChoiceAnswerEntry[]
  ): string | null => {
    for (const entry of selectedEntries) {
      const option = availableOptions.find((candidate) => candidate.value === entry.value);
      if (!option) continue;
      if (option.allowTextInput && entry.detailText.trim().length === 0) {
        return interpolateUiLabel(template, {
          field: fieldLabel,
          option: option.label,
        });
      }
      const childError = validateEntries(option.childOptions, entry.children);
      if (childError) return childError;
    }
    return null;
  };

  return validateEntries(options, entries);
}

export function getChoiceDetailErrorValues(
  options: ReturnType<typeof parseChoiceOptions>,
  value: unknown
): Set<string> {
  const errorValues = new Set<string>();
  const entries = parseChoiceAnswerEntries(value);

  const collectErrors = (
    availableOptions: ReturnType<typeof parseChoiceOptions>,
    selectedEntries: ChoiceAnswerEntry[]
  ) => {
    for (const entry of selectedEntries) {
      const option = availableOptions.find((candidate) => candidate.value === entry.value);
      if (!option) continue;
      if (option.allowTextInput && entry.detailText.trim().length === 0) errorValues.add(entry.value);
      collectErrors(option.childOptions, entry.children);
    }
  };

  collectErrors(options, entries);

  return errorValues;
}
