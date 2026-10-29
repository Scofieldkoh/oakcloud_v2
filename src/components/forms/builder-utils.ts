import { normalizeKey, isRecord } from '@/lib/form-utils';
import type { FormFieldInput } from '@/lib/validations/form-builder';

export { normalizeKey, WIDTH_CLASS } from '@/lib/form-utils';

export const FIELD_TYPE_OPTIONS: Array<{ value: FormFieldInput['type']; label: string }> = [
  { value: 'SHORT_TEXT', label: 'Short answer (Input)' },
  { value: 'LONG_TEXT', label: 'Long answer (Textarea)' },
  { value: 'SINGLE_CHOICE', label: 'Single choice' },
  { value: 'MULTIPLE_CHOICE', label: 'Multiple choice' },
  { value: 'DROPDOWN', label: 'Dropdown' },
  { value: 'PARAGRAPH', label: 'Information block' },
  { value: 'HTML', label: 'HTML / Code' },
  { value: 'FILE_UPLOAD', label: 'File upload' },
  { value: 'SIGNATURE', label: 'eSignature' },
  { value: 'COMPANY_NAME_CHECK', label: 'Company name check' },
  { value: 'HIDDEN', label: 'Hidden field' },
  { value: 'PAGE_BREAK', label: 'Page break' },
];

export const FIELD_TYPE_LABEL: Record<FormFieldInput['type'], string> = FIELD_TYPE_OPTIONS.reduce(
  (acc, item) => ({ ...acc, [item.value]: item.label }),
  {} as Record<FormFieldInput['type'], string>
);

export const WIDTH_OPTIONS: Array<25 | 33 | 50 | 66 | 75 | 100> = [25, 33, 50, 66, 75, 100];


export type ShortInputType =
  | 'text'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'time_timezone'
  | 'info_text'
  | 'info_image'
  | 'info_url'
  | 'info_heading_1'
  | 'info_heading_2'
  | 'info_heading_3'
  | 'info_faq'
  | 'repeat_start'
  | 'repeat_end'
  | 'block_divider';

export function isRepeatMarkerInputType(value: string): value is 'repeat_start' | 'repeat_end' {
  return value === 'repeat_start' || value === 'repeat_end';
}

export function isBlockDividerInputType(value: string): value is 'block_divider' {
  return value === 'block_divider';
}

export type ValidationConfig = {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  equal?: number;
  minFormula?: string;
  maxFormula?: string;
  equalFormula?: string;
  minDate?: string;
  maxDate?: string;
  minDateFieldKey?: string;
  minDateOffsetDays?: number;
  maxDateFieldKey?: string;
  maxDateOffsetDays?: number;
  startsWith?: string;
  containsText?: string;
  notContainsText?: string;
  endsWith?: string;
  pattern?: string;
  maxFileSizeMb?: number;
  allowMultipleFiles?: boolean;
  allowedMimeTypes?: string[];
  uploadFileNameTemplate?: string;
  layoutBreakBefore?: boolean;
  tooltipEnabled?: boolean;
  tooltipMode?: 'hover' | 'inline';
  tooltipInfoBackgroundColor?: string;
  tooltipInfoPaddingTopPx?: number;
  tooltipInfoPaddingRightPx?: number;
  tooltipInfoPaddingBottomPx?: number;
  tooltipInfoPaddingLeftPx?: number;
  choiceInlineRight?: boolean;
  defaultValue?: string;
  defaultToday?: boolean;
  alwaysDefaultToday?: boolean;
  timezoneDefault?: string;
  splitPhoneCountryCode?: boolean;
  phoneDefaultCountryCode?: string;
  infoBackgroundColor?: string;
  infoPaddingPx?: number;
  infoPaddingTopPx?: number;
  infoPaddingRightPx?: number;
  infoPaddingBottomPx?: number;
  infoPaddingLeftPx?: number;
  infoInlineCard?: boolean;
  infoBareStyle?: boolean;
  infoStopsProgress?: boolean;
  infoShowInPdf?: boolean;
  faqDefaultState?: 'collapsed' | 'expanded' | 'first_expanded';
  faqSearchEnabled?: boolean;
  faqMainToggleEnabled?: boolean;
  faqMainDefaultExpanded?: boolean;
  repeatMinItems?: number;
  repeatMaxItems?: number;
  repeatAddLabel?: string;
  repeatItemLabel?: string;
  repeatTotalFieldKey?: string;
  repeatTotalLabel?: string;
  repeatTotalSuffix?: string;
  repeatTotalTarget?: number;
  nameCheckMode?: 'strict' | 'advisory';
  /** 'chips' renders choice options as a wrapped row of toggle pills. */
  choiceLayout?: 'list' | 'chips';
};

export type ChoiceOptionConfig = {
  label: string;
  value: string;
  bodyHtml?: string | null;
  allowTextInput?: boolean;
  textInputLabel?: string | null;
  textInputPlaceholder?: string | null;
  tooltipText?: string | null;
  defaultSelected?: boolean;
  requiredSelected?: boolean;
  childSelectionMode?: 'multiple' | 'single';
  childOptions?: ChoiceOptionConfig[];
  /** Carried through unchanged; set by guided templates, not edited in the builder. */
  condition?: Record<string, unknown> | null;
};

type SerializedChoiceOption = {
  label: string;
  value: string;
  bodyHtml?: string;
  allowTextInput?: true;
  textInputLabel?: string;
  textInputPlaceholder?: string;
  tooltipText?: string;
  defaultSelected?: true;
  requiredSelected?: true;
  childSelectionMode?: 'multiple' | 'single';
  childOptions?: SerializedChoiceOption[];
  condition?: Record<string, unknown>;
};

export type ConditionConfig = {
  fieldKey: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'is_empty' | 'not_empty' | 'is_visible' | 'is_not_visible';
  value?: string | number | boolean | null;
};

export type ConditionGroupConfig = {
  logic: 'and' | 'or';
  rules: FieldConditionConfig[];
};

export type FieldConditionConfig = ConditionConfig | ConditionGroupConfig;

export interface BuilderField {
  clientId: string;
  id?: string;
  optionPresetId?: string | null;
  type: FormFieldInput['type'];
  label: string;
  key: string;
  placeholder: string;
  subtext: string;
  helpText: string;
  inputType: ShortInputType;
  options: ChoiceOptionConfig[];
  validation: ValidationConfig | null;
  condition: FieldConditionConfig | null;
  isRequired: boolean;
  hideLabel: boolean;
  isReadOnly: boolean;
  showOnSummary: boolean;
  layoutWidth: 25 | 33 | 50 | 66 | 75 | 100;
  position: number;
}

export function isFaqField(field: Pick<BuilderField, 'type' | 'inputType'>): boolean {
  return field.type === 'PARAGRAPH' && field.inputType === 'info_faq';
}

export function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tmp_${crypto.randomUUID()}`;
  }
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}


export function defaultField(type: FormFieldInput['type'], position: number): BuilderField {
  const label = type === 'PAGE_BREAK'
    ? 'Page break'
    : type === 'COMPANY_NAME_CHECK'
      ? 'Company name'
      : 'Untitled field';
  const key = normalizeKey(label);

  return {
    clientId: newClientId(),
    optionPresetId: null,
    type,
    label,
    key,
    placeholder: '',
    subtext: '',
    helpText: '',
    inputType: type === 'PARAGRAPH' ? 'info_text' : 'text',
    options: type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE' || type === 'DROPDOWN'
      ? [
        { label: 'Option 1', value: 'Option 1' },
        { label: 'Option 2', value: 'Option 2' },
      ]
      : [],
    validation: type === 'FILE_UPLOAD'
      ? { maxFileSizeMb: 50 }
      : null,
    condition: null,
    isRequired: false,
    hideLabel: false,
    isReadOnly: false,
    showOnSummary: false,
    layoutWidth: 100,
    position,
  };
}


function parseFieldOptions(value: unknown, depth: number = 0): ChoiceOptionConfig[] {
  if (!Array.isArray(value)) return [];

  const parsed: ChoiceOptionConfig[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const text = item.trim();
      if (!text) continue;
      parsed.push({ label: text, value: text });
      continue;
    }

    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

    const optionRecord = item as Record<string, unknown>;
    const label = typeof optionRecord.label === 'string' ? optionRecord.label.trim() : '';
    const valueText = typeof optionRecord.value === 'string' ? optionRecord.value.trim() : '';
    const value = valueText || label;
    if (!label || !value) continue;

    parsed.push({
      label,
      value,
      bodyHtml: typeof optionRecord.bodyHtml === 'string' ? optionRecord.bodyHtml.trim() || null : null,
      allowTextInput: optionRecord.allowTextInput === true,
      textInputLabel: typeof optionRecord.textInputLabel === 'string' ? optionRecord.textInputLabel.trim() || null : null,
      textInputPlaceholder: typeof optionRecord.textInputPlaceholder === 'string' ? optionRecord.textInputPlaceholder.trim() || null : null,
      tooltipText: typeof optionRecord.tooltipText === 'string' ? optionRecord.tooltipText.trim() || null : null,
      defaultSelected: optionRecord.defaultSelected === true,
      requiredSelected: optionRecord.requiredSelected === true,
      childSelectionMode: optionRecord.childSelectionMode === 'single' ? 'single' : 'multiple',
      childOptions: depth < 1 ? parseFieldOptions(optionRecord.childOptions, depth + 1) : [],
      condition: isRecord(optionRecord.condition) ? optionRecord.condition : null,
    });
  }

  return parsed;
}

function parseConditionRule(value: unknown): ConditionConfig | null {
  if (!isRecord(value)) return null;

  const fieldKey = typeof value.fieldKey === 'string' ? value.fieldKey.trim() : '';
  const operator = value.operator;
  if (
    !fieldKey
    || (
      operator !== 'equals'
      && operator !== 'not_equals'
      && operator !== 'contains'
      && operator !== 'is_empty'
      && operator !== 'not_empty'
      && operator !== 'is_visible'
      && operator !== 'is_not_visible'
    )
  ) {
    return null;
  }

  return {
    fieldKey,
    operator,
    value: value.value as string | number | boolean | null | undefined,
  };
}

export function normalizeConditionConfig(value: unknown): FieldConditionConfig | null {
  const singleRule = parseConditionRule(value);
  if (singleRule) return singleRule;

  if (!isRecord(value) || !Array.isArray(value.rules)) return null;

  const rules = value.rules
    .map(normalizeConditionConfig)
    .filter((rule): rule is FieldConditionConfig => !!rule);

  if (rules.length === 0) return null;

  return {
    logic: value.logic === 'or' ? 'or' : 'and',
    rules,
  };
}

export function fromServerField(field: {
  id: string;
  optionPresetId: string | null;
  type: FormFieldInput['type'];
  label: string | null;
  key: string;
  placeholder: string | null;
  subtext: string | null;
  helpText: string | null;
  inputType: string | null;
  options: unknown;
  validation: unknown;
  condition: unknown;
  isRequired: boolean;
  hideLabel: boolean;
  isReadOnly: boolean;
  layoutWidth: number;
  position: number;
}, options?: { showOnSummary?: boolean }): BuilderField {
  const validation = isRecord(field.validation) ? field.validation as ValidationConfig : null;
  const condition = normalizeConditionConfig(field.condition);
  const inputType = (field.inputType || (field.type === 'PARAGRAPH' ? 'info_text' : 'text')) as ShortInputType;

  return {
    clientId: field.id,
    id: field.id,
    optionPresetId: field.optionPresetId,
    type: field.type,
    label: field.label || '',
    key: field.key,
    placeholder: field.placeholder || '',
    subtext: field.subtext || '',
    helpText: field.helpText || '',
    inputType,
    options: parseFieldOptions(field.options),
    validation,
    condition,
    isRequired: field.isRequired,
    hideLabel: field.hideLabel,
    isReadOnly: field.isReadOnly,
    showOnSummary: options?.showOnSummary ?? false,
    layoutWidth: WIDTH_OPTIONS.includes(field.layoutWidth as 25 | 33 | 50 | 66 | 75 | 100)
      ? (field.layoutWidth as 25 | 33 | 50 | 66 | 75 | 100)
      : 100,
    position: field.position,
  };
}

export function toPayloadFields(fields: BuilderField[]): FormFieldInput[] {
  const serializeChoiceOption = (
    option: ChoiceOptionConfig,
    fieldType: FormFieldInput['type'],
    depth: number = 0
  ): SerializedChoiceOption | null => {
    const label = option.label?.trim();
    const value = fieldType === 'PARAGRAPH'
      ? (option.value?.trim() || newClientId())
      : (option.value?.trim() || label);
    if (!label || !value) return null;
    const childOptions: SerializedChoiceOption[] = fieldType === 'MULTIPLE_CHOICE' && depth < 1
      ? (option.childOptions || [])
        .map((childOption) => serializeChoiceOption(childOption, fieldType, depth + 1))
        .filter((childOption): childOption is NonNullable<typeof childOption> => !!childOption)
      : [];
    return {
      label,
      value,
      ...(fieldType === 'PARAGRAPH' && option.bodyHtml ? { bodyHtml: option.bodyHtml.trim() } : {}),
      ...(option.allowTextInput ? { allowTextInput: true } : {}),
      ...(option.textInputLabel ? { textInputLabel: option.textInputLabel.trim() } : {}),
      ...(option.textInputPlaceholder ? { textInputPlaceholder: option.textInputPlaceholder.trim() } : {}),
      ...(option.tooltipText ? { tooltipText: option.tooltipText.trim() } : {}),
      ...(option.defaultSelected ? { defaultSelected: true } : {}),
      ...(option.requiredSelected && fieldType === 'MULTIPLE_CHOICE' ? { requiredSelected: true, defaultSelected: true } : {}),
      ...(fieldType === 'MULTIPLE_CHOICE' && depth === 0 && option.childSelectionMode === 'single' ? { childSelectionMode: 'single' as const } : {}),
      ...(childOptions.length > 0 ? { childOptions } : {}),
      ...(option.condition ? { condition: option.condition } : {}),
    };
  };

  return fields.map((field, idx) => ({
    id: field.id,
    optionPresetId: field.optionPresetId,
    type: field.type,
    label: field.label || null,
    key: normalizeKey(field.key || field.label || `field_${idx + 1}`),
    placeholder: field.placeholder || null,
    subtext: field.subtext || null,
    helpText: field.helpText || null,
    inputType: field.type === 'SHORT_TEXT' || field.type === 'PARAGRAPH'
      ? field.inputType
      : (field.type === 'PAGE_BREAK' && (isRepeatMarkerInputType(field.inputType) || isBlockDividerInputType(field.inputType)) ? field.inputType : null),
    options: isFaqField(field)
      ? field.options
        .map((option) => serializeChoiceOption(option, field.type))
        .filter((option): option is NonNullable<typeof option> => !!option)
      : (field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE')
      ? field.options
        .map((option) => serializeChoiceOption(option, field.type))
        .filter((option): option is NonNullable<typeof option> => !!option)
      : (field.type === 'DROPDOWN' && field.optionPresetId
        ? null
        : field.type === 'DROPDOWN'
        ? field.options
          .map((option) => serializeChoiceOption(option, field.type))
          .filter((option): option is NonNullable<typeof option> => !!option)
        : null),
    validation: field.validation,
    condition: field.condition,
    isRequired: field.isRequired,
    hideLabel: field.hideLabel,
    isReadOnly: field.isReadOnly,
    layoutWidth: field.layoutWidth,
    position: idx,
  }));
}

export function serializeBuilderState(input: {
  title: string;
  description: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  tags: string[];
  fields: BuilderField[];
  notificationRecipientEmails?: string[];
  notificationRecipientText?: string;
  notificationLinkOnly?: boolean;
  draftSaveEnabled?: boolean;
  draftAutoDeleteDays?: number;
  pdfFileNameTemplate?: string;
  i18nDefaultLocale?: string;
  i18nEnabledLocales?: string[];
  i18nAllowLocaleSwitch?: boolean;
  i18nTranslations?: unknown;
  hideLogo?: boolean;
  hideFooter?: boolean;
  backgroundImageUrl?: string | null;
  backgroundImageOpacity?: number;
  panelOpacity?: number;
  headingColor?: string | null;
  aiParsingEnabled?: boolean;
  aiParsingCustomContext?: string;
}): string {
  return JSON.stringify({
    title: input.title.trim(),
    description: input.description.trim(),
    slug: input.slug.trim(),
    status: input.status,
    tags: input.tags,
    notificationRecipientEmails: (input.notificationRecipientEmails || []).map((email) => email.trim().toLowerCase()).filter(Boolean),
    notificationRecipientText: (input.notificationRecipientText || '').trim(),
    notificationLinkOnly: input.notificationLinkOnly === true,
    draftSaveEnabled: input.draftSaveEnabled === true,
    draftAutoDeleteDays: typeof input.draftAutoDeleteDays === 'number' && Number.isFinite(input.draftAutoDeleteDays)
      ? Math.max(1, Math.min(365, Math.trunc(input.draftAutoDeleteDays)))
      : 14,
    pdfFileNameTemplate: (input.pdfFileNameTemplate || '').trim(),
    i18nDefaultLocale: (input.i18nDefaultLocale || '').trim(),
    i18nEnabledLocales: (input.i18nEnabledLocales || []).map((locale) => locale.trim()).filter(Boolean),
    i18nAllowLocaleSwitch: input.i18nAllowLocaleSwitch !== false,
    i18nTranslations: input.i18nTranslations || {},
    hideLogo: input.hideLogo === true,
    hideFooter: input.hideFooter === true,
    backgroundImageUrl: typeof input.backgroundImageUrl === 'string' && input.backgroundImageUrl.trim()
      ? input.backgroundImageUrl.trim()
      : null,
    backgroundImageOpacity: typeof input.backgroundImageOpacity === 'number' && Number.isFinite(input.backgroundImageOpacity)
      ? Math.min(100, Math.max(0, Math.round(input.backgroundImageOpacity)))
      : 40,
    panelOpacity: typeof input.panelOpacity === 'number' && Number.isFinite(input.panelOpacity)
      ? Math.min(100, Math.max(0, Math.round(input.panelOpacity)))
      : 100,
    headingColor: input.headingColor || null,
    aiParsingEnabled: input.aiParsingEnabled === true,
    aiParsingCustomContext: (input.aiParsingCustomContext || '').trim(),
    fields: input.fields.map((field, idx) => ({
      type: field.type,
      label: field.label,
      key: field.key,
      placeholder: field.placeholder,
      subtext: field.subtext,
      helpText: field.helpText,
      inputType: field.inputType,
      options: field.options,
      validation: field.validation,
      condition: field.condition,
      isRequired: field.isRequired,
      hideLabel: field.hideLabel,
      isReadOnly: field.isReadOnly,
      showOnSummary: field.showOnSummary,
      layoutWidth: field.layoutWidth,
      position: idx,
    })),
  });
}

export function suggestFieldsFromPrompt(prompt: string): BuilderField[] {
  const lowered = prompt.toLowerCase();
  const generated: BuilderField[] = [];

  const maybePush = (condition: boolean, field: BuilderField) => {
    if (condition) generated.push(field);
  };

  maybePush(/name|full name|first name|last name/.test(lowered), {
    ...defaultField('SHORT_TEXT', generated.length),
    label: 'Full Name',
    key: 'full_name',
    isRequired: true,
  });

  maybePush(/email/.test(lowered), {
    ...defaultField('SHORT_TEXT', generated.length),
    label: 'Email address',
    key: 'email_address',
    inputType: 'email',
    isRequired: true,
    layoutWidth: 50,
  });

  maybePush(/phone|contact/.test(lowered), {
    ...defaultField('SHORT_TEXT', generated.length),
    label: 'Contact number',
    key: 'contact_number',
    inputType: 'phone',
    layoutWidth: 50,
  });

  maybePush(/upload|attach|file/.test(lowered), {
    ...defaultField('FILE_UPLOAD', generated.length),
    label: 'Attachment',
    key: 'attachment',
    validation: { maxFileSizeMb: 50 },
  });

  maybePush(/signature|sign/.test(lowered), {
    ...defaultField('SIGNATURE', generated.length),
    label: 'Signature',
    key: 'signature',
  });

  if (generated.length === 0) {
    generated.push(defaultField('SHORT_TEXT', 0));
  }

  return generated.map((field, index) => ({ ...field, position: index }));
}
