import { normalizeFormBackgroundUrl } from '@/lib/form-background-url';

export interface PublicFormField {
  id: string;
  type: string;
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
}

export interface PublicFormDefinition {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  settings?: unknown;
  fields: PublicFormField[];
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  tenantLogoUrl: string | null;
  tenantName: string | null;
}

export interface ChoiceOption {
  label: string;
  value: string;
  bodyHtml: string | null;
  allowTextInput: boolean;
  textInputLabel: string | null;
  textInputPlaceholder: string | null;
  tooltipText: string | null;
  defaultSelected: boolean;
  requiredSelected: boolean;
  childSelectionMode: 'multiple' | 'single';
  childOptions: ChoiceOption[];
  /** Show the option only when this condition holds; null means always shown. */
  condition: unknown | null;
}

export const WIDTH_CLASS: Record<number, string> = {
  25: 'col-span-12 md:col-span-3',
  33: 'col-span-12 md:col-span-4',
  50: 'col-span-12 md:col-span-6',
  66: 'col-span-12 md:col-span-8',
  75: 'col-span-12 md:col-span-9',
  100: 'col-span-12',
};

export const FORM_FIELD_KEY_MAX_LENGTH = 120;

export function normalizeKey(raw: string, maxLength: number = FORM_FIELD_KEY_MAX_LENGTH): string {
  const safeMaxLength = Number.isFinite(maxLength) && maxLength > 0
    ? Math.trunc(maxLength)
    : FORM_FIELD_KEY_MAX_LENGTH;
  let cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned) {
    return 'field'.slice(0, safeMaxLength);
  }

  if (!/^[a-z]/.test(cleaned)) {
    cleaned = `field_${cleaned}`;
  }

  let normalized = cleaned
    .slice(0, safeMaxLength)
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    normalized = 'field'.slice(0, safeMaxLength);
  }

  if (!/^[a-z]/.test(normalized)) {
    normalized = `field_${normalized}`
      .slice(0, safeMaxLength)
      .replace(/^_+|_+$/g, '');
  }

  if (!normalized || !/^[a-z]/.test(normalized)) {
    return 'field'.slice(0, safeMaxLength);
  }

  return normalized;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeChoiceOption(input: unknown, depth: number = 0): ChoiceOption | null {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    return {
      label: trimmed,
      value: trimmed,
      bodyHtml: null,
      allowTextInput: false,
      textInputLabel: null,
      textInputPlaceholder: null,
      tooltipText: null,
      defaultSelected: false,
      requiredSelected: false,
      childSelectionMode: 'multiple',
      childOptions: [],
      condition: null,
    };
  }

  const raw = parseObject(input);
  if (!raw) return null;

  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const valueRaw = typeof raw.value === 'string' ? raw.value.trim() : '';
  const value = valueRaw || label;

  if (!label || !value) return null;

  const allowTextInput = raw.allowTextInput === true;
  const bodyHtml = typeof raw.bodyHtml === 'string' ? raw.bodyHtml.trim() : '';
  const textInputLabel = typeof raw.textInputLabel === 'string' ? raw.textInputLabel.trim() : '';
  const textInputPlaceholder = typeof raw.textInputPlaceholder === 'string' ? raw.textInputPlaceholder.trim() : '';
  const tooltipText = typeof raw.tooltipText === 'string' ? raw.tooltipText.trim() : '';

  return {
    label,
    value,
    bodyHtml: bodyHtml || null,
    allowTextInput,
    textInputLabel: textInputLabel || null,
    textInputPlaceholder: textInputPlaceholder || null,
    tooltipText: tooltipText || null,
    defaultSelected: raw.defaultSelected === true,
    requiredSelected: raw.requiredSelected === true,
    childSelectionMode: raw.childSelectionMode === 'single' ? 'single' : 'multiple',
    childOptions: depth < 1 && Array.isArray(raw.childOptions)
      ? raw.childOptions
        .map((item) => normalizeChoiceOption(item, depth + 1))
        .filter((option): option is ChoiceOption => !!option)
      : [],
    condition: parseObject(raw.condition) ?? null,
  };
}

export function parseChoiceOptions(value: unknown): ChoiceOption[] {
  if (!Array.isArray(value)) return [];

  const options: ChoiceOption[] = [];
  for (const item of value) {
    const parsed = normalizeChoiceOption(item);
    if (!parsed) continue;
    options.push(parsed);
  }

  return options;
}

type ChoiceAnswerEntry = {
  value: string;
  detailText: string | null;
  children: ChoiceAnswerEntry[];
};

function parseChoiceAnswerEntry(input: unknown): ChoiceAnswerEntry | null {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    return { value: trimmed, detailText: null, children: [] };
  }

  const raw = parseObject(input);
  if (!raw) return null;
  const value = typeof raw.value === 'string' ? raw.value.trim() : '';
  if (!value) return null;
  const detailText = typeof raw.detailText === 'string' ? raw.detailText.trim() : '';
  const children = Array.isArray(raw.children)
    ? raw.children
      .map(parseChoiceAnswerEntry)
      .filter((entry): entry is ChoiceAnswerEntry => !!entry)
    : [];

  return {
    value,
    detailText: detailText || null,
    children,
  };
}

export function formatChoiceAnswer(value: unknown): string | null {
  const formatEntry = (entry: ChoiceAnswerEntry): string => {
    const childText = entry.children.map(formatEntry).join(', ');
    const notes = [entry.detailText, childText].filter(Boolean);
    if (notes.length > 0) return `${entry.value} (${notes.join('; ')})`;
    return entry.value;
  };

  if (Array.isArray(value)) {
    const groups: string[] = [];
    for (const item of value) {
      if (Array.isArray(item)) {
        const nestedEntries = item
          .map(parseChoiceAnswerEntry)
          .filter((entry): entry is ChoiceAnswerEntry => !!entry);
        if (nestedEntries.length > 0) {
          groups.push(nestedEntries.map(formatEntry).join(', '));
        }
        continue;
      }

      const entry = parseChoiceAnswerEntry(item);
      if (!entry) continue;
      groups.push(formatEntry(entry));
    }

    if (groups.length === 0) return null;
    return groups.join('; ');
  }

  const entry = parseChoiceAnswerEntry(value);
  if (!entry) return null;
  return formatEntry(entry);
}

export function formatTimeTimezoneAnswer(value: unknown): string | null {
  const entry = parseObject(value);
  if (!entry) return null;

  const time = typeof entry.time === 'string' ? entry.time.trim() : '';
  const timezone = typeof entry.timezone === 'string' ? entry.timezone.trim() : '';
  if (!time) return null;
  return timezone ? `${time} ${timezone}` : time;
}

export const RESPONSE_COLUMN_SUBMITTED_ID = '__submitted';
export const RESPONSE_COLUMN_STATUS_ID = '__status';
const RESPONSE_COLUMN_MIN_WIDTH = 120;
const RESPONSE_COLUMN_MAX_WIDTH = 900;

export interface FormResponseTableSettings {
  summaryFieldKeys: string[];
  columnOrder: string[];
  columnWidths: Record<string, number>;
}

export type FormNotificationAttachmentMode = 'attachments' | 'link_only';

export interface FormNotificationSettings {
  completionRecipientEmails: string[];
  /** 'link_only' sends a link to the response without the PDF or uploaded files. */
  attachmentMode?: FormNotificationAttachmentMode;
}

export interface FormCompletionSettings {
  /** Show a review-all-answers step before the submit button. */
  reviewStep: boolean;
  reviewTitle: string | null;
  reviewIntro: string | null;
  submitLabel: string | null;
  successTitle: string | null;
  /** May contain {reference}, replaced with the short submission reference. */
  successMessage: string | null;
  showPdfActions: boolean;
}

export const DEFAULT_FORM_DRAFT_AUTO_DELETE_DAYS = 14;
export const MIN_FORM_DRAFT_AUTO_DELETE_DAYS = 1;
export const MAX_FORM_DRAFT_AUTO_DELETE_DAYS = 365;

export interface FormDraftSettings {
  enabled: boolean;
  autoDeleteDays: number;
}

export interface FormAiSettings {
  enabled: boolean;
  customContext: string | null;
}

export interface FormFileNameSettings {
  pdfTemplate: string | null;
}

export interface FormSubmissionAiReviewSectionEntry {
  label: string;
  value: string;
}

export interface FormSubmissionAiReviewSection {
  title: string;
  type: 'text' | 'bullet_list' | 'key_value';
  content: string | null;
  items: string[];
  entries: FormSubmissionAiReviewSectionEntry[];
}

export interface FormSubmissionAiReview {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  reviewRequired: boolean;
  severity: 'low' | 'medium' | 'high' | null;
  summary: string | null;
  tags: string[];
  sections: FormSubmissionAiReviewSection[];
  model: string | null;
  warningSignature: string | null;
  resolvedWarningSignature: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolvedReason: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  processedAt: string | null;
  attachmentCount: number;
  unsupportedAttachmentNames: string[];
  omittedAttachmentNames: string[];
  error: string | null;
  emailNotificationPending: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

function normalizeAiReviewSectionTitleValue(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

function isHiddenAiReviewSectionTitle(title: string): boolean {
  const normalizedTitle = normalizeAiReviewSectionTitleValue(title).toLowerCase();
  return normalizedTitle === 'recommended actions' || normalizedTitle === 'recommended action';
}

function isIssuesFoundSectionTitle(title: string): boolean {
  return normalizeAiReviewSectionTitleValue(title).toLowerCase() === 'issues found';
}

export function sanitizeAiReviewIssueText(value: string): string {
  let cleaned = value.trim().replace(/\s+/g, ' ');

  cleaned = cleaned.replace(/\s*\((?=[^)]*\b(?:field|fields|file|files)\b)[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\b(?:uploaded|provided)\s+document\b/gi, 'attachment');
  cleaned = cleaned.replace(/\bthis document\b/gi, 'this attachment');
  cleaned = cleaned.replace(/^Cannot verify:\s*[^:.;()]+?\s+appears to be\b/i, 'Attachment appears to be');
  cleaned = cleaned.replace(/^Cannot verify:\s*[^:.;()]+?\s+is\b/i, 'Attachment is');
  cleaned = cleaned.replace(/^Cannot verify:\s*[^:.;()]+?\s+does\b/i, 'Attachment does');
  cleaned = cleaned.replace(/^Cannot verify:\s*[^:.;()]+?\s+cannot\b/i, 'Attachment cannot');
  cleaned = cleaned.replace(/^Cannot verify:\s*[^:.;()]+\b/i, 'Attachment');
  cleaned = cleaned.replace(
    /^Proof of Address mismatch\b\s*:?\s*/i,
    'Proof of address does not match the applicant or declared residential address: '
  );
  cleaned = cleaned.replace(
    /^Identity document type inconsistency\b\s*:?\s*/i,
    'Identity document type is inconsistent: '
  );
  cleaned = cleaned.replace(/\s+([,.;:])/g, '$1');
  cleaned = cleaned.replace(/:\s*/g, ': ');
  cleaned = cleaned.trim();

  if (cleaned && /^[a-z]/.test(cleaned)) {
    cleaned = `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
  }

  if (cleaned && !/[.!?]$/.test(cleaned)) {
    cleaned = `${cleaned}.`;
  }

  return cleaned;
}

export function sanitizeAiReviewSections(
  sections: FormSubmissionAiReviewSection[]
): FormSubmissionAiReviewSection[] {
  const sanitizedSections: FormSubmissionAiReviewSection[] = [];

  for (const section of sections) {
    const title = normalizeAiReviewSectionTitleValue(section.title);
    if (!title || isHiddenAiReviewSectionTitle(title)) continue;

    if (section.type === 'text') {
      const content = section.content?.trim() || null;
      if (!content) continue;

      sanitizedSections.push({
        title,
        type: 'text',
        content,
        items: [],
        entries: [],
      });
      continue;
    }

    if (section.type === 'bullet_list') {
      const items = section.items
        .map((item) => isIssuesFoundSectionTitle(title) ? sanitizeAiReviewIssueText(item) : item.trim())
        .filter(Boolean);

      if (items.length === 0) continue;

      sanitizedSections.push({
        title,
        type: 'bullet_list',
        content: null,
        items,
        entries: [],
      });
      continue;
    }

    const entries = section.entries
      .map((entry) => ({
        label: entry.label.trim(),
        value: entry.value.trim(),
      }))
      .filter((entry) => entry.label && entry.value);

    if (entries.length === 0) continue;

    sanitizedSections.push({
      title,
      type: 'key_value',
      content: null,
      items: [],
      entries,
    });
  }

  return sanitizedSections;
}

export interface FormI18nFieldTranslation {
  label?: string;
  placeholder?: string;
  subtext?: string;
  helpText?: string;
  options?: Array<string | { label?: string; bodyHtml?: string }>;
}

export interface FormI18nLocaleTranslation {
  form: {
    title?: string;
    description?: string;
  };
  fields: Record<string, FormI18nFieldTranslation>;
  ui: Record<string, string>;
}

export interface FormI18nSettings {
  defaultLocale: string;
  enabledLocales: string[];
  allowLocaleSwitch: boolean;
  translations: Record<string, FormI18nLocaleTranslation>;
}

export function isSummaryEligibleFieldType(fieldType: string): boolean {
  return !['PAGE_BREAK', 'PARAGRAPH', 'HTML', 'HIDDEN'].includes(fieldType);
}

export function isProgressStopInfoBlock(field: { type: string; validation: unknown }): boolean {
  const validation = parseObject(field.validation);
  return field.type === 'PARAGRAPH' && validation?.infoStopsProgress === true;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }

  return Array.from(unique);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeFileNameTemplate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 240);
}

function normalizeDraftAutoDeleteDays(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : (typeof value === 'string' ? Number.parseInt(value.trim(), 10) : NaN);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_FORM_DRAFT_AUTO_DELETE_DAYS;
  }

  const rounded = Math.trunc(parsed);
  return Math.min(MAX_FORM_DRAFT_AUTO_DELETE_DAYS, Math.max(MIN_FORM_DRAFT_AUTO_DELETE_DAYS, rounded));
}

function normalizeAiCustomContext(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10_000);
}

function normalizeAiReviewStringList(value: unknown, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(value)) return [];

  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    items.push(trimmed.slice(0, maxItemLength));
    if (items.length >= maxItems) break;
  }

  return items;
}

function normalizeAiReviewSeverity(value: unknown): 'low' | 'medium' | 'high' | null {
  return value === 'low' || value === 'medium' || value === 'high' ? value : null;
}

function normalizeAiReviewSectionEntries(value: unknown): FormSubmissionAiReviewSectionEntry[] {
  if (!Array.isArray(value)) return [];

  const entries: FormSubmissionAiReviewSectionEntry[] = [];
  for (const entry of value) {
    const rawEntry = parseObject(entry);
    if (!rawEntry) continue;

    const label = typeof rawEntry.label === 'string'
      ? rawEntry.label.trim().slice(0, 120)
      : '';
    const entryValue = typeof rawEntry.value === 'string'
      ? rawEntry.value.trim().slice(0, 1000)
      : '';

    if (!label || !entryValue) continue;

    entries.push({
      label,
      value: entryValue,
    });

    if (entries.length >= 20) break;
  }

  return entries;
}

function normalizeAiReviewSections(value: unknown): FormSubmissionAiReviewSection[] {
  if (!Array.isArray(value)) return [];

  const sections: FormSubmissionAiReviewSection[] = [];
  for (const section of value) {
    const rawSection = parseObject(section);
    if (!rawSection) continue;

    const title = typeof rawSection.title === 'string'
      ? rawSection.title.trim().slice(0, 120)
      : '';
    const type = rawSection.type === 'text' || rawSection.type === 'bullet_list' || rawSection.type === 'key_value'
      ? rawSection.type
      : null;

    if (!title || !type) continue;

    const content = typeof rawSection.content === 'string'
      ? rawSection.content.trim().slice(0, 4000) || null
      : null;
    const items = normalizeAiReviewStringList(rawSection.items, 20, 500);
    const entries = normalizeAiReviewSectionEntries(rawSection.entries);

    if (type === 'text' && !content) continue;
    if (type === 'bullet_list' && items.length === 0) continue;
    if (type === 'key_value' && entries.length === 0) continue;

    sections.push({
      title,
      type,
      content: type === 'text' ? content : null,
      items: type === 'bullet_list' ? items : [],
      entries: type === 'key_value' ? entries : [],
    });

    if (sections.length >= 8) break;
  }

  return sanitizeAiReviewSections(sections);
}

function normalizeAiReviewUsage(value: unknown): FormSubmissionAiReview['usage'] | undefined {
  const usage = parseObject(value);
  if (!usage) return undefined;

  const inputTokens = typeof usage.inputTokens === 'number' && Number.isFinite(usage.inputTokens)
    ? Math.max(0, Math.trunc(usage.inputTokens))
    : null;
  const outputTokens = typeof usage.outputTokens === 'number' && Number.isFinite(usage.outputTokens)
    ? Math.max(0, Math.trunc(usage.outputTokens))
    : null;
  const totalTokens = typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
    ? Math.max(0, Math.trunc(usage.totalTokens))
    : null;

  if (inputTokens === null || outputTokens === null || totalTokens === null) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export function normalizeLocaleCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const [canonical] = Intl.getCanonicalLocales(trimmed);
    return canonical || null;
  } catch {
    return null;
  }
}

function normalizeI18nText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeI18nOptionList(value: unknown): Array<string | { label?: string; bodyHtml?: string }> {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 500)
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim().slice(0, 5000);
      const record = parseObject(entry);
      if (!record) return '';
      const label = normalizeI18nText(record.label, 5000);
      const bodyHtml = normalizeI18nText(record.bodyHtml, 10000);
      return {
        ...(label ? { label } : {}),
        ...(bodyHtml ? { bodyHtml } : {}),
      };
    });
}

function parseI18nFieldTranslations(value: unknown): Record<string, FormI18nFieldTranslation> {
  const fieldsObject = parseObject(value);
  if (!fieldsObject) return {};

  const parsed: Record<string, FormI18nFieldTranslation> = {};

  for (const [rawFieldKey, rawFieldTranslation] of Object.entries(fieldsObject)) {
    const fieldKey = rawFieldKey.trim();
    if (!fieldKey) continue;

    const fieldTranslation = parseObject(rawFieldTranslation);
    if (!fieldTranslation) continue;

    const nextTranslation: FormI18nFieldTranslation = {};
    const label = normalizeI18nText(fieldTranslation.label, 1000);
    const placeholder = normalizeI18nText(fieldTranslation.placeholder, 500);
    const subtext = normalizeI18nText(fieldTranslation.subtext, 10000);
    const helpText = normalizeI18nText(fieldTranslation.helpText, 2000);
    const options = normalizeI18nOptionList(fieldTranslation.options);

    if (label) nextTranslation.label = label;
    if (placeholder) nextTranslation.placeholder = placeholder;
    if (subtext) nextTranslation.subtext = subtext;
    if (helpText) nextTranslation.helpText = helpText;
    if (options.length > 0) nextTranslation.options = options;

    if (Object.keys(nextTranslation).length > 0) {
      parsed[fieldKey] = nextTranslation;
    }
  }

  return parsed;
}

function parseI18nUiTranslations(value: unknown): Record<string, string> {
  const uiObject = parseObject(value);
  if (!uiObject) return {};

  const parsed: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(uiObject)) {
    const key = rawKey.trim();
    if (!key) continue;
    const text = normalizeI18nText(rawValue, 240);
    if (!text) continue;
    parsed[key] = text;
  }

  return parsed;
}

function parseI18nTranslations(value: unknown): Record<string, FormI18nLocaleTranslation> {
  const translationsObject = parseObject(value);
  if (!translationsObject) return {};

  const parsed: Record<string, FormI18nLocaleTranslation> = {};

  for (const [rawLocale, rawTranslation] of Object.entries(translationsObject)) {
    const locale = normalizeLocaleCode(rawLocale);
    if (!locale) continue;

    const translationObject = parseObject(rawTranslation);
    if (!translationObject) continue;

    const formObject = parseObject(translationObject.form);
    const formTitle = normalizeI18nText(formObject?.title, 120);
    const formDescription = normalizeI18nText(formObject?.description, 2000);
    const fields = parseI18nFieldTranslations(translationObject.fields);
    const ui = parseI18nUiTranslations(translationObject.ui);

    const localeTranslation: FormI18nLocaleTranslation = {
      form: {},
      fields,
      ui,
    };

    if (formTitle) localeTranslation.form.title = formTitle;
    if (formDescription) localeTranslation.form.description = formDescription;

    const hasFormTranslation = Object.keys(localeTranslation.form).length > 0;
    const hasFieldTranslation = Object.keys(localeTranslation.fields).length > 0;
    const hasUiTranslation = Object.keys(localeTranslation.ui).length > 0;

    if (hasFormTranslation || hasFieldTranslation || hasUiTranslation) {
      parsed[locale] = localeTranslation;
    }
  }

  return parsed;
}

export function clampResponseColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return RESPONSE_COLUMN_MIN_WIDTH;
  return Math.min(RESPONSE_COLUMN_MAX_WIDTH, Math.max(RESPONSE_COLUMN_MIN_WIDTH, Math.round(width)));
}

export function normalizeResponseColumnOrder(baseColumnIds: string[], preferredOrder?: string[]): string[] {
  const allowed = new Set(baseColumnIds);
  const ordered: string[] = [];

  for (const id of preferredOrder || []) {
    if (!allowed.has(id)) continue;
    if (ordered.includes(id)) continue;
    ordered.push(id);
  }

  for (const id of baseColumnIds) {
    if (!ordered.includes(id)) {
      ordered.push(id);
    }
  }

  return ordered;
}

export function sanitizeResponseColumnWidths(
  columnWidths: Record<string, number>,
  allowedColumnIds: string[]
): Record<string, number> {
  const allowed = new Set(allowedColumnIds);
  const sanitized: Record<string, number> = {};

  for (const [key, value] of Object.entries(columnWidths)) {
    if (!allowed.has(key)) continue;
    if (!Number.isFinite(value)) continue;
    sanitized[key] = clampResponseColumnWidth(value);
  }

  return sanitized;
}

export function parseFormResponseTableSettings(settings: unknown): FormResponseTableSettings {
  const root = parseObject(settings);
  const responseTable = parseObject(root?.responseTable);

  const summaryFieldKeys = normalizeStringArray(responseTable?.summaryFieldKeys);
  const columnOrder = normalizeStringArray(responseTable?.columnOrder);
  const rawWidths = parseObject(responseTable?.columnWidths);
  const columnWidths: Record<string, number> = {};

  if (rawWidths) {
    for (const [key, value] of Object.entries(rawWidths)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      columnWidths[key] = clampResponseColumnWidth(value);
    }
  }

  return {
    summaryFieldKeys,
    columnOrder,
    columnWidths,
  };
}

export function writeFormResponseTableSettings(
  settings: unknown,
  responseTable: FormResponseTableSettings
): Record<string, unknown> {
  const root = parseObject(settings) ? { ...(settings as Record<string, unknown>) } : {};
  root.responseTable = {
    summaryFieldKeys: [...responseTable.summaryFieldKeys],
    columnOrder: [...responseTable.columnOrder],
    columnWidths: { ...responseTable.columnWidths },
  };
  return root;
}

export function parseFormNotificationSettings(settings: unknown): FormNotificationSettings {
  const root = parseObject(settings);
  const notifications = parseObject(root?.notifications);
  const rawRecipients = normalizeStringArray(notifications?.completionRecipientEmails);

  const recipientSet = new Set<string>();
  for (const email of rawRecipients) {
    const normalized = email.trim().toLowerCase();
    if (!isValidEmail(normalized)) continue;
    recipientSet.add(normalized);
  }

  return {
    completionRecipientEmails: Array.from(recipientSet),
    attachmentMode: notifications?.attachmentMode === 'link_only' ? 'link_only' : 'attachments',
  };
}

export function writeFormNotificationSettings(
  settings: unknown,
  notifications: FormNotificationSettings
): Record<string, unknown> {
  const root = parseObject(settings) ? { ...(settings as Record<string, unknown>) } : {};
  const existingNotifications = parseObject(root.notifications) ? { ...(root.notifications as Record<string, unknown>) } : {};

  root.notifications = {
    ...existingNotifications,
    completionRecipientEmails: [...notifications.completionRecipientEmails],
    ...(notifications.attachmentMode ? { attachmentMode: notifications.attachmentMode } : {}),
  };

  return root;
}

function normalizeCompletionText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export function parseFormCompletionSettings(settings: unknown): FormCompletionSettings {
  const root = parseObject(settings);
  const completion = parseObject(root?.completion);

  return {
    reviewStep: completion?.reviewStep === true,
    reviewTitle: normalizeCompletionText(completion?.reviewTitle, 120),
    reviewIntro: normalizeCompletionText(completion?.reviewIntro, 1000),
    submitLabel: normalizeCompletionText(completion?.submitLabel, 60),
    successTitle: normalizeCompletionText(completion?.successTitle, 120),
    successMessage: normalizeCompletionText(completion?.successMessage, 1000),
    showPdfActions: completion?.showPdfActions !== false,
  };
}

export function writeFormCompletionSettings(
  settings: unknown,
  completion: FormCompletionSettings
): Record<string, unknown> {
  const root = parseObject(settings) ? { ...(settings as Record<string, unknown>) } : {};
  const next: Record<string, unknown> = {
    reviewStep: completion.reviewStep === true,
    showPdfActions: completion.showPdfActions !== false,
  };
  const texts: Array<[keyof FormCompletionSettings, number]> = [
    ['reviewTitle', 120],
    ['reviewIntro', 1000],
    ['submitLabel', 60],
    ['successTitle', 120],
    ['successMessage', 1000],
  ];
  for (const [key, maxLength] of texts) {
    const value = normalizeCompletionText(completion[key], maxLength);
    if (value) next[key] = value;
  }

  const isDefault = next.reviewStep === false && next.showPdfActions === true && Object.keys(next).length === 2;
  if (isDefault) {
    delete root.completion;
  } else {
    root.completion = next;
  }
  return root;
}

export function parseFormDraftSettings(settings: unknown): FormDraftSettings {
  const root = parseObject(settings);
  const drafts = parseObject(root?.drafts);

  return {
    enabled: drafts?.enabled === true,
    autoDeleteDays: normalizeDraftAutoDeleteDays(drafts?.autoDeleteDays),
  };
}

export function writeFormDraftSettings(
  settings: unknown,
  draftSettings: FormDraftSettings
): Record<string, unknown> {
  const root = parseObject(settings) ? { ...(settings as Record<string, unknown>) } : {};
  const existingDrafts = parseObject(root.drafts) ? { ...(root.drafts as Record<string, unknown>) } : {};

  root.drafts = {
    ...existingDrafts,
    enabled: draftSettings.enabled === true,
    autoDeleteDays: normalizeDraftAutoDeleteDays(draftSettings.autoDeleteDays),
  };

  return root;
}

export function parseFormAiSettings(settings: unknown): FormAiSettings {
  const root = parseObject(settings);
  const aiParsing = parseObject(root?.aiParsing);

  return {
    enabled: aiParsing?.enabled === true,
    customContext: normalizeAiCustomContext(aiParsing?.customContext),
  };
}

export function writeFormAiSettings(
  settings: unknown,
  aiSettings: FormAiSettings
): Record<string, unknown> {
  const root = parseObject(settings) ? { ...(settings as Record<string, unknown>) } : {};
  const existingAi = parseObject(root.aiParsing) ? { ...(root.aiParsing as Record<string, unknown>) } : {};
  const nextAi = {
    ...existingAi,
    enabled: aiSettings.enabled === true,
  } as Record<string, unknown>;

  const nextCustomContext = normalizeAiCustomContext(aiSettings.customContext);
  if (nextCustomContext) {
    nextAi.customContext = nextCustomContext;
  } else {
    delete nextAi.customContext;
  }

  if (nextAi.enabled === true || 'customContext' in nextAi) {
    root.aiParsing = nextAi;
  } else {
    delete root.aiParsing;
  }

  return root;
}

export function parseFormFileNameSettings(settings: unknown): FormFileNameSettings {
  const root = parseObject(settings);
  const fileNaming = parseObject(root?.fileNaming);

  return {
    pdfTemplate: normalizeFileNameTemplate(fileNaming?.pdfTemplate),
  };
}

export function writeFormFileNameSettings(
  settings: unknown,
  fileNameSettings: FormFileNameSettings
): Record<string, unknown> {
  const root = parseObject(settings) ? { ...(settings as Record<string, unknown>) } : {};
  const existingFileNaming = parseObject(root.fileNaming) ? { ...(root.fileNaming as Record<string, unknown>) } : {};
  const nextFileNaming = { ...existingFileNaming };

  const nextPdfTemplate = normalizeFileNameTemplate(fileNameSettings.pdfTemplate);

  if (nextPdfTemplate) {
    nextFileNaming.pdfTemplate = nextPdfTemplate;
  } else {
    delete nextFileNaming.pdfTemplate;
  }
  delete nextFileNaming.uploadTemplate;

  if (Object.keys(nextFileNaming).length > 0) {
    root.fileNaming = nextFileNaming;
  } else {
    delete root.fileNaming;
  }

  return root;
}

export function parseFormI18nSettings(settings: unknown): FormI18nSettings {
  const root = parseObject(settings);
  const i18n = parseObject(root?.i18n);

  const fallbackDefaultLocale = 'en';
  const parsedDefaultLocale = normalizeLocaleCode(i18n?.defaultLocale) || fallbackDefaultLocale;
  const rawEnabledLocales = Array.isArray(i18n?.enabledLocales) ? i18n.enabledLocales : [];
  const enabledLocaleSet = new Set<string>();

  for (const locale of rawEnabledLocales) {
    const normalized = normalizeLocaleCode(locale);
    if (!normalized) continue;
    enabledLocaleSet.add(normalized);
  }

  enabledLocaleSet.add(parsedDefaultLocale);

  const translations = parseI18nTranslations(i18n?.translations);
  for (const locale of Object.keys(translations)) {
    enabledLocaleSet.add(locale);
  }

  const enabledLocales = Array.from(enabledLocaleSet);
  const allowLocaleSwitch = i18n?.allowLocaleSwitch !== false;

  return {
    defaultLocale: parsedDefaultLocale,
    enabledLocales,
    allowLocaleSwitch,
    translations,
  };
}

export function writeFormI18nSettings(
  settings: unknown,
  i18nSettings: FormI18nSettings
): Record<string, unknown> {
  const root = parseObject(settings) ? { ...(settings as Record<string, unknown>) } : {};

  const defaultLocale = normalizeLocaleCode(i18nSettings.defaultLocale) || 'en';
  const enabledLocaleSet = new Set<string>([defaultLocale]);

  for (const locale of i18nSettings.enabledLocales || []) {
    const normalized = normalizeLocaleCode(locale);
    if (!normalized) continue;
    enabledLocaleSet.add(normalized);
  }

  const translations = parseI18nTranslations(i18nSettings.translations);
  for (const locale of Object.keys(translations)) {
    enabledLocaleSet.add(locale);
  }

  root.i18n = {
    defaultLocale,
    enabledLocales: Array.from(enabledLocaleSet),
    allowLocaleSwitch: i18nSettings.allowLocaleSwitch !== false,
    translations,
  };

  return root;
}

export const DEFAULT_FORM_BACKGROUND_OPACITY = 40;
export const DEFAULT_FORM_PANEL_OPACITY = 100;

export interface FormAppearanceSettings {
  backgroundImageUrl: string | null;
  /** Background image opacity, 0-100. */
  backgroundImageOpacity: number;
  /** Opacity of the white panels that hold the fields, 0-100. */
  panelOpacity: number;
  /** Hex colour for the title, headings and other text drawn on the background; null keeps the default. */
  headingColor: string | null;
}

function clampPercent(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : fallback;
}

export function normalizeFormHeadingColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toUpperCase() : null;
}

export function parseFormAppearanceSettings(settings: unknown): FormAppearanceSettings {
  const root = parseObject(settings);
  return {
    backgroundImageUrl: normalizeFormBackgroundUrl(
      typeof root?.backgroundImageUrl === 'string' ? root.backgroundImageUrl : null
    ),
    backgroundImageOpacity: clampPercent(root?.backgroundImageOpacity, DEFAULT_FORM_BACKGROUND_OPACITY),
    panelOpacity: clampPercent(root?.panelOpacity, DEFAULT_FORM_PANEL_OPACITY),
    headingColor: normalizeFormHeadingColor(root?.headingColor),
  };
}

export function buildPublicFormSettings(settings: unknown): Record<string, unknown> | null {
  let nextSettings: Record<string, unknown> = {};

  nextSettings = writeFormDraftSettings(nextSettings, parseFormDraftSettings(settings));
  nextSettings = writeFormI18nSettings(nextSettings, parseFormI18nSettings(settings));
  nextSettings = writeFormCompletionSettings(nextSettings, parseFormCompletionSettings(settings));

  const root = parseObject(settings);
  const template = parseObject(root?.template);
  if (template && typeof template.key === 'string' && typeof template.version === 'number') {
    nextSettings.template = { key: template.key, version: template.version };
  }
  nextSettings.hideLogo = root?.hideLogo === true;
  nextSettings.hideFooter = root?.hideFooter === true;

  const appearance = parseFormAppearanceSettings(settings);
  const rawOpacity = root?.backgroundImageOpacity;
  if (appearance.backgroundImageUrl || (typeof rawOpacity === 'number' && Number.isFinite(rawOpacity))) {
    nextSettings.backgroundImageUrl = appearance.backgroundImageUrl;
    nextSettings.backgroundImageOpacity = appearance.backgroundImageOpacity;
  }
  if (appearance.panelOpacity !== DEFAULT_FORM_PANEL_OPACITY) {
    nextSettings.panelOpacity = appearance.panelOpacity;
  }
  if (appearance.headingColor) {
    nextSettings.headingColor = appearance.headingColor;
  }

  return Object.keys(nextSettings).length > 0 ? nextSettings : null;
}

export function parseFormSubmissionAiReview(metadata: unknown): FormSubmissionAiReview | null {
  const root = parseObject(metadata);
  const review = parseObject(root?.aiReview);
  if (!review) return null;

  const usesLegacyReviewShape = (
    ('riskLevel' in review || 'warnings' in review || 'recommendedActions' in review)
    && !('severity' in review || 'tags' in review || 'sections' in review)
  );
  if (usesLegacyReviewShape) {
    return null;
  }

  const status = review.status === 'queued'
    ? 'queued'
    : review.status === 'processing'
      ? 'processing'
      : review.status === 'failed'
        ? 'failed'
        : review.status === 'completed'
          ? 'completed'
          : null;
  if (!status) return null;

  const summary = typeof review.summary === 'string'
    ? review.summary.trim().slice(0, 4000) || null
    : null;
  const model = typeof review.model === 'string' ? review.model.trim().slice(0, 120) || null : null;
  const warningSignature = typeof review.warningSignature === 'string'
    ? review.warningSignature.trim().slice(0, 128) || null
    : null;
  const resolvedWarningSignature = typeof review.resolvedWarningSignature === 'string'
    ? review.resolvedWarningSignature.trim().slice(0, 128) || null
    : null;
  const resolvedAt = typeof review.resolvedAt === 'string' ? review.resolvedAt.trim() || null : null;
  const resolvedByUserId = typeof review.resolvedByUserId === 'string'
    ? review.resolvedByUserId.trim().slice(0, 120) || null
    : null;
  const resolvedReason = typeof review.resolvedReason === 'string'
    ? review.resolvedReason.trim().slice(0, 2000) || null
    : null;
  const queuedAt = typeof review.queuedAt === 'string' ? review.queuedAt.trim() || null : null;
  const startedAt = typeof review.startedAt === 'string' ? review.startedAt.trim() || null : null;
  const processedAt = typeof review.processedAt === 'string' ? review.processedAt.trim() || null : null;
  const error = typeof review.error === 'string' ? review.error.trim().slice(0, 1000) || null : null;
  const attachmentCount = typeof review.attachmentCount === 'number' && Number.isFinite(review.attachmentCount)
    ? Math.max(0, Math.trunc(review.attachmentCount))
    : 0;
  const tags = normalizeAiReviewStringList(review.tags, 12, 120);
  const sections = normalizeAiReviewSections(review.sections);
  const unsupportedAttachmentNames = normalizeAiReviewStringList(review.unsupportedAttachmentNames, 20, 240);
  const omittedAttachmentNames = normalizeAiReviewStringList(review.omittedAttachmentNames, 20, 240);
  const usage = normalizeAiReviewUsage(review.usage);

  return {
    status,
    reviewRequired: review.reviewRequired === true,
    severity: normalizeAiReviewSeverity(review.severity),
    summary,
    tags,
    sections,
    model,
    warningSignature,
    resolvedWarningSignature,
    resolvedAt,
    resolvedByUserId,
    resolvedReason,
    queuedAt,
    startedAt,
    processedAt,
    attachmentCount,
    unsupportedAttachmentNames,
    omittedAttachmentNames,
    error,
    emailNotificationPending: review.emailNotificationPending === true,
    ...(usage ? { usage } : {}),
  };
}

export function hasUnresolvedFormSubmissionAiWarning(review: FormSubmissionAiReview | null): boolean {
  if (!review || review.status !== 'completed' || !review.reviewRequired) {
    return false;
  }

  if (!review.warningSignature) {
    return true;
  }

  return review.resolvedWarningSignature !== review.warningSignature;
}

export function parseOptions(value: unknown): string[] {
  return parseChoiceOptions(value).map((option) => option.label);
}

export function toAnswerRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function toUploadIds(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(value)) return [];

  const ids: string[] = [];
  for (const item of value) {
    ids.push(...toUploadIds(item));
  }

  return ids;
}

export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) {
    if (value.length === 0) return true;
    return value.every((item) => isEmptyValue(item));
  }
  if (isRecord(value) && 'time' in value && 'timezone' in value) {
    return isEmptyValue(value.time);
  }
  if (isRecord(value) && 'value' in value) {
    return isEmptyValue(value.value);
  }
  return false;
}

export type FormResponseReviewStatus = 'new' | 'reviewed' | 'needs_follow_up' | 'archived';

export const FORM_RESPONSE_REVIEW_STATUS_OPTIONS: Array<{ value: FormResponseReviewStatus; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'needs_follow_up', label: 'Needs follow-up' },
  { value: 'archived', label: 'Archived' },
];

export function parseFormResponseReviewStatus(metadata: unknown): FormResponseReviewStatus {
  const root = parseObject(metadata);
  const value = typeof root?.responseReviewStatus === 'string' ? root.responseReviewStatus : '';
  return FORM_RESPONSE_REVIEW_STATUS_OPTIONS.some((option) => option.value === value)
    ? value as FormResponseReviewStatus
    : 'new';
}

type ConditionEvaluationField = {
  key: string;
  condition: unknown;
};

type ConditionEvaluationOptions = {
  fields?: ConditionEvaluationField[];
  activeFieldKeys?: Set<string>;
};

export function evaluateCondition(
  condition: unknown,
  answers: Record<string, unknown>,
  options: ConditionEvaluationOptions = {}
): boolean {
  if (!condition) return true;
  const cond = isRecord(condition) ? condition : null;
  if (!cond) return true;

  const rules = Array.isArray(cond.rules) ? cond.rules : null;
  if (rules) {
    const validRules = rules.filter(isRecord);
    if (validRules.length === 0) return true;

    const logic = cond.logic === 'or' ? 'or' : 'and';
    return logic === 'or'
      ? validRules.some((rule) => evaluateCondition(rule, answers, options))
      : validRules.every((rule) => evaluateCondition(rule, answers, options));
  }

  const fieldKey = typeof cond.fieldKey === 'string' ? cond.fieldKey : null;
  const operator = typeof cond.operator === 'string' ? cond.operator : null;

  if (!fieldKey || !operator) return true;

  const normalizeActual = (value: unknown): unknown => {
    const record = parseObject(value);
    if (record && typeof record.value === 'string') {
      return record.value;
    }
    return value;
  };

  const actual = normalizeActual(answers[fieldKey]);
  const expected = cond.value;

  switch (operator) {
    case 'is_visible':
    case 'is_not_visible': {
      const targetField = options.fields?.find((field) => field.key === fieldKey);
      const targetIsVisible = targetField
        ? (() => {
          const activeFieldKeys = options.activeFieldKeys || new Set<string>();
          if (activeFieldKeys.has(fieldKey)) return false;
          const nextActiveFieldKeys = new Set(activeFieldKeys);
          nextActiveFieldKeys.add(fieldKey);
          return evaluateCondition(targetField.condition, answers, {
            ...options,
            activeFieldKeys: nextActiveFieldKeys,
          });
        })()
        : true;
      return operator === 'is_visible' ? targetIsVisible : !targetIsVisible;
    }
    case 'equals':
      return actual === expected;
    case 'not_equals':
      return !isEmptyValue(actual) && actual !== expected;
    case 'contains':
      if (Array.isArray(actual)) return actual.map((item) => normalizeActual(item)).includes(expected);
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual.toLowerCase().includes(expected.toLowerCase());
      }
      return false;
    case 'is_empty':
      return isEmptyValue(actual);
    case 'not_empty':
      return !isEmptyValue(actual);
    default:
      return true;
  }
}

type ConditionalAnswerField = {
  key: string;
  type: string;
  inputType: string | null;
  condition: unknown;
};

function isRepeatStartField(field: ConditionalAnswerField): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'repeat_start';
}

function isRepeatEndField(field: ConditionalAnswerField): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'repeat_end';
}

function isBlockDividerField(field: ConditionalAnswerField): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'block_divider';
}

function isAnswerField(field: ConditionalAnswerField): boolean {
  return field.type !== 'PAGE_BREAK' && field.type !== 'PARAGRAPH' && field.type !== 'HTML';
}

function getRepeatRowContext(answers: Record<string, unknown>, rowIndex: number): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    context[key] = Array.isArray(value) ? value[rowIndex] : value;
  }
  return context;
}

function maxAnswerRowCount(fields: ConditionalAnswerField[], answers: Record<string, unknown>): number {
  let rowCount = 0;
  for (const field of fields) {
    const value = answers[field.key];
    if (Array.isArray(value)) {
      rowCount = Math.max(rowCount, value.length);
    }
  }
  return rowCount;
}

export function pruneHiddenConditionalAnswers<T extends Record<string, unknown>>(
  fields: ConditionalAnswerField[],
  answers: T
): T {
  let next: Record<string, unknown> = answers;
  let changedAny = false;

  const ensureWritable = () => {
    if (next === answers) {
      next = { ...answers };
    }
  };

  const clearField = (fieldKey: string): boolean => {
    if (!(fieldKey in next)) return false;
    ensureWritable();
    delete next[fieldKey];
    return true;
  };

  const clearRepeatFieldRow = (fieldKey: string, rowIndex: number): boolean => {
    const currentValue = next[fieldKey];
    if (!Array.isArray(currentValue)) return false;
    if (isEmptyValue(currentValue[rowIndex]) && !(rowIndex in currentValue)) return false;

    ensureWritable();
    const updated = [...currentValue];
    updated[rowIndex] = undefined;
    while (updated.length > 0 && isEmptyValue(updated[updated.length - 1])) {
      updated.pop();
    }
    if (updated.length === 0) {
      delete next[fieldKey];
    } else {
      next[fieldKey] = updated;
    }
    return true;
  };

  for (let pass = 0; pass < fields.length + 1; pass += 1) {
    let changedThisPass = false;

    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];

      if (isRepeatStartField(field)) {
        const sectionFields: ConditionalAnswerField[] = [];
        let cursor = index + 1;
        while (cursor < fields.length && !isRepeatEndField(fields[cursor])) {
          if (fields[cursor].type !== 'PAGE_BREAK' && !isBlockDividerField(fields[cursor])) {
            sectionFields.push(fields[cursor]);
          }
          cursor += 1;
        }

        if (!evaluateCondition(field.condition, next, { fields })) {
          for (const sectionField of sectionFields) {
            if (isAnswerField(sectionField)) {
              changedThisPass = clearField(sectionField.key) || changedThisPass;
            }
          }
          index = cursor;
          continue;
        }

        const rowCount = maxAnswerRowCount(sectionFields, next);
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          const rowAnswers = getRepeatRowContext(next, rowIndex);
          for (const sectionField of sectionFields) {
            if (!isAnswerField(sectionField)) continue;
            if (!evaluateCondition(sectionField.condition, rowAnswers, { fields: sectionFields })) {
              if (clearRepeatFieldRow(sectionField.key, rowIndex)) {
                rowAnswers[sectionField.key] = undefined;
                changedThisPass = true;
              }
            }
          }
        }

        index = cursor;
        continue;
      }

      if (!isAnswerField(field)) continue;
      if (!evaluateCondition(field.condition, next, { fields })) {
        changedThisPass = clearField(field.key) || changedThisPass;
      }
    }

    changedAny = changedAny || changedThisPass;
    if (!changedThisPass) break;
  }

  return changedAny ? next as T : answers;
}
