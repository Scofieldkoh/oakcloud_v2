import {
  FormSubmissionStatus,
  type FormField,
  type FormUpload,
} from '@/generated/prisma';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { generatePDF } from '@/services/document-export.service';
import {
  evaluateCondition,
  formatChoiceAnswer,
  formatTimeTimezoneAnswer,
  isEmptyValue,
  parseChoiceOptions,
  parseFormFileNameSettings,
  parseObject,
  toAnswerRecord,
  toUploadIds,
} from '@/lib/form-utils';
import { extractSignatureDataUrl, isSignatureDataUrl } from '@/lib/signature-utils';
import { prisma } from '@/lib/prisma';
import { getAppBaseUrl, sendEmail } from '@/lib/email';
import { StorageKeys } from '@/lib/storage';
import { normalizeWorkspaceLogoUrl } from '@/lib/workspace-logo-url';
import {
  escapeHtml,
  getTenantTimeZone,
  isRepeatEndMarker,
  isRepeatStartMarker,
  normalizeTenantTimeZone,
} from './form-builder.helpers';

const FILE_NAME_TEMPLATE_PATTERN = /\[([a-zA-Z0-9_]+)\]/g;
const FILE_NAME_INVALID_CHARS_PATTERN = /[<>"/\\|?*\u0000-\u001F]+/g;
const FILE_NAME_FALLBACK = 'file';
const FILE_NAME_MAX_LENGTH = 220;

// ---------------------------------------------------------------------------
// Date stamps
// ---------------------------------------------------------------------------

function toDateStamps(value: Date, timeZone: string): { dateStamp: string; timeStamp: string; datetimeStamp: string } {
  const resolvedTimeZone = normalizeTenantTimeZone(timeZone);
  const date = new Date(value);

  try {
    const prettyParts = new Intl.DateTimeFormat('en-US', {
      timeZone: resolvedTimeZone,
      day: 'numeric',
      month: 'short',
      year: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(date);

    const partValue = (parts: Intl.DateTimeFormatPart[], partType: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === partType)?.value || '';

    const day = String(Number(partValue(prettyParts, 'day') || '0'));
    const monthLong = partValue(prettyParts, 'month');
    const year2 = partValue(prettyParts, 'year');
    const hourRaw = partValue(prettyParts, 'hour');
    const hour = String(Number(hourRaw || '0'));
    const minute = partValue(prettyParts, 'minute');
    const dayPeriod = partValue(prettyParts, 'dayPeriod').replace(/\s+/g, '').toUpperCase();

    const dateStamp = `${day} ${monthLong} ${year2}`;
    const timeStamp = `${hour}.${minute}${dayPeriod}`;
    const datetimeStamp = `${dateStamp} - ${timeStamp}`;

    return {
      dateStamp,
      timeStamp,
      datetimeStamp,
    };
  } catch {
    const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(date.getUTCDate());
    const month = monthShort[date.getUTCMonth()] || 'Jan';
    const year2 = String(date.getUTCFullYear()).slice(-2);
    const hour24 = date.getUTCHours();
    const hour12 = String((hour24 % 12) || 12);
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    const dayPeriod = hour24 >= 12 ? 'PM' : 'AM';
    const dateStamp = `${day} ${month} ${year2}`;
    const timeStamp = `${hour12}.${minute}${dayPeriod}`;
    return {
      dateStamp,
      timeStamp,
      datetimeStamp: `${dateStamp} - ${timeStamp}`,
    };
  }
}

// ---------------------------------------------------------------------------
// File name template helpers (exported so submission service can use them)
// ---------------------------------------------------------------------------

function normalizeTemplateValue(value: string, maxLength: number = 160): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, maxLength);
}

function toFileNameTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || isSignatureDataUrl(trimmed)) return '';
    return normalizeTemplateValue(trimmed, 240);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  const choiceText = formatChoiceAnswer(value);
  if (choiceText) {
    return normalizeTemplateValue(choiceText, 240);
  }

  const timeTimezoneText = formatTimeTimezoneAnswer(value);
  if (timeTimezoneText) {
    return normalizeTemplateValue(timeTimezoneText, 240);
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => toFileNameTemplateValue(item))
      .filter(Boolean)
      .join(', ');
    return normalizeTemplateValue(text, 240);
  }

  const record = parseObject(value);
  if (record && typeof record.value === 'string') {
    return normalizeTemplateValue(record.value, 240);
  }

  try {
    return normalizeTemplateValue(JSON.stringify(value), 240);
  } catch {
    return '';
  }
}

export function sanitizeFileNameExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';

  const normalized = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  if (!/^\.[a-z0-9]{1,15}$/.test(normalized)) {
    return '';
  }

  return normalized;
}

function stripTrailingExtension(value: string): string {
  return value.trim().replace(/\.[a-z0-9]{1,15}$/i, '');
}

export function sanitizeFileNameStem(value: string, fallback: string): string {
  const safeFallback = normalizeTemplateValue(
    stripTrailingExtension(fallback)
      .replace(FILE_NAME_INVALID_CHARS_PATTERN, ' ')
      .replace(/\s+/g, ' '),
    180
  ) || FILE_NAME_FALLBACK;

  const cleaned = normalizeTemplateValue(
    stripTrailingExtension(value)
      .replace(FILE_NAME_INVALID_CHARS_PATTERN, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[. ]+|[. ]+$/g, ''),
    180
  );

  return cleaned || safeFallback;
}

export function splitFileNameParts(fileName: string): { base: string; extension: string } {
  const trimmed = fileName.trim();
  const match = trimmed.match(/(\.[a-z0-9]{1,15})$/i);

  if (!match) {
    return { base: trimmed, extension: '' };
  }

  return {
    base: trimmed.slice(0, -match[1].length),
    extension: sanitizeFileNameExtension(match[1]),
  };
}

export function composeSafeFileName(stem: string, extension: string, fallbackStem: string): string {
  const safeExtension = sanitizeFileNameExtension(extension);
  const safeStem = sanitizeFileNameStem(stem, fallbackStem);
  const maxStemLength = Math.max(1, FILE_NAME_MAX_LENGTH - safeExtension.length);
  const boundedStem = safeStem.slice(0, maxStemLength).replace(/[. ]+$/g, '').trim() || FILE_NAME_FALLBACK;
  return `${boundedStem}${safeExtension}`;
}

export function makeUniqueFileName(candidate: string, used: Set<string>): string {
  let nextName = candidate;
  const initialParts = splitFileNameParts(candidate);
  const base = sanitizeFileNameStem(initialParts.base, FILE_NAME_FALLBACK);
  const extension = sanitizeFileNameExtension(initialParts.extension);
  let suffix = 2;

  while (used.has(nextName.toLowerCase())) {
    const counterSuffix = `-${suffix}`;
    const maxBaseLength = Math.max(1, FILE_NAME_MAX_LENGTH - extension.length - counterSuffix.length);
    const nextBase = base.slice(0, maxBaseLength).replace(/[. ]+$/g, '').trim() || FILE_NAME_FALLBACK;
    nextName = `${nextBase}${counterSuffix}${extension}`;
    suffix += 1;
  }

  used.add(nextName.toLowerCase());
  return nextName;
}

export function buildFileNameTemplateVariables(input: {
  formTitle: string;
  formSlug: string;
  submissionId: string;
  submittedAt: Date;
  timeZone: string;
  answers: Record<string, unknown>;
  extra?: Record<string, string>;
}): Record<string, string> {
  const stamps = toDateStamps(input.submittedAt, input.timeZone);
  const variables: Record<string, string> = {
    form_title: normalizeTemplateValue(input.formTitle, 200),
    form_slug: normalizeTemplateValue(input.formSlug, 120),
    submission_id: normalizeTemplateValue(input.submissionId, 80),
    datetime_stamp: stamps.datetimeStamp,
    date_stamp: stamps.dateStamp,
    time_stamp: stamps.timeStamp,
  };

  for (const [answerKey, answerValue] of Object.entries(input.answers)) {
    if (!answerKey) continue;
    variables[answerKey.toLowerCase()] = toFileNameTemplateValue(answerValue);
  }

  for (const [extraKey, extraValue] of Object.entries(input.extra || {})) {
    if (!extraKey) continue;
    variables[extraKey.toLowerCase()] = normalizeTemplateValue(extraValue, 200);
  }

  return variables;
}

export function applyFileNameTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(FILE_NAME_TEMPLATE_PATTERN, (_match, rawKey: string) => {
    const key = rawKey.trim().toLowerCase();
    return variables[key] || '';
  });
}

export function toPdfFileName(formTitle: string, submissionId: string): string {
  const safeTitle = formTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'form-response';
  return `${safeTitle}-${submissionId.slice(0, 8)}.pdf`;
}

export function resolveSubmissionPdfFileName(input: {
  formTitle: string;
  formSlug: string;
  settings: unknown;
  submissionId: string;
  submittedAt: Date;
  timeZone: string;
  answers: Record<string, unknown>;
}): string {
  const fallback = toPdfFileName(input.formTitle, input.submissionId);
  const fileNameSettings = parseFormFileNameSettings(input.settings);

  if (!fileNameSettings.pdfTemplate) {
    return fallback;
  }

  const templateVariables = buildFileNameTemplateVariables({
    formTitle: input.formTitle,
    formSlug: input.formSlug,
    submissionId: input.submissionId,
    submittedAt: input.submittedAt,
    timeZone: input.timeZone,
    answers: input.answers,
  });

  const rendered = applyFileNameTemplate(fileNameSettings.pdfTemplate, templateVariables);
  const fallbackParts = splitFileNameParts(fallback);
  return composeSafeFileName(rendered, '.pdf', fallbackParts.base || 'form-response');
}

export function resolveSubmissionUploadFileNames(input: {
  formTitle: string;
  formSlug: string;
  submissionId: string;
  submittedAt: Date;
  timeZone: string;
  answers: Record<string, unknown>;
  uploads: Array<Pick<FormUpload, 'id' | 'fieldId' | 'fileName' | 'mimeType'>>;
  fieldById: Map<string, Pick<FormField, 'key' | 'validation'>>;
}): Map<string, string> {
  const usedNames = new Set<string>();
  const renamedByUploadId = new Map<string, string>();

  for (const upload of input.uploads) {
    const fieldMeta = upload.fieldId ? input.fieldById.get(upload.fieldId) : null;
    const validation = parseObject(fieldMeta?.validation);
    const templateRaw = typeof validation?.uploadFileNameTemplate === 'string'
      ? validation.uploadFileNameTemplate.trim()
      : '';

    if (templateRaw.length === 0) {
      usedNames.add(upload.fileName.toLowerCase());
    }
  }

  for (let index = 0; index < input.uploads.length; index += 1) {
    const upload = input.uploads[index];
    const fieldMeta = upload.fieldId ? input.fieldById.get(upload.fieldId) : null;
    const validation = parseObject(fieldMeta?.validation);
    const uploadTemplate = typeof validation?.uploadFileNameTemplate === 'string'
      ? validation.uploadFileNameTemplate.trim()
      : '';
    if (!uploadTemplate) {
      continue;
    }

    const parsedOriginal = splitFileNameParts(upload.fileName);
    const inferredExtension = sanitizeFileNameExtension(
      parsedOriginal.extension || StorageKeys.getExtension(upload.fileName, upload.mimeType)
    );
    const originalBase = sanitizeFileNameStem(parsedOriginal.base, 'upload');
    const originalFileName = composeSafeFileName(originalBase, inferredExtension, 'upload');
    const fieldKey = fieldMeta?.key || '';

    const templateVariables = buildFileNameTemplateVariables({
      formTitle: input.formTitle,
      formSlug: input.formSlug,
      submissionId: input.submissionId,
      submittedAt: input.submittedAt,
      timeZone: input.timeZone,
      answers: input.answers,
      extra: {
        field_key: fieldKey,
        upload_id: upload.id,
        original_filename: originalFileName,
        original_basename: originalBase,
        original_extension: inferredExtension.startsWith('.') ? inferredExtension.slice(1) : inferredExtension,
        file_index: String(index + 1),
      },
    });

    const rendered = applyFileNameTemplate(uploadTemplate, templateVariables);
    const candidate = composeSafeFileName(rendered, inferredExtension, originalBase || 'upload');
    const uniqueFileName = makeUniqueFileName(candidate, usedNames);
    renamedByUploadId.set(upload.id, uniqueFileName);
  }

  return renamedByUploadId;
}

// ---------------------------------------------------------------------------
// PDF HTML/buffer builders
// ---------------------------------------------------------------------------

export function buildSubmissionPdfHtml(input: {
  formTitle: string;
  formDescription?: string | null;
  submittedAt: Date;
  respondentName: string | null;
  respondentEmail: string | null;
  status: FormSubmissionStatus;
  fields: FormField[];
  answers: Record<string, unknown>;
  uploads: FormUpload[];
  tenantLogoUrl?: string | null;
  tenantName?: string | null;
  formSettings?: unknown;
  timeZone?: string;
}): { contentHtml: string; footerHtml: string } {
  const settings = parseObject(input.formSettings);
  const hideLogo = settings?.hideLogo === true;
  const hideFooter = settings?.hideFooter === true;

  const uploadsById = new Map(input.uploads.map((u) => [u.id, u]));

  const appBase = getAppBaseUrl();
  const logoUrl = !hideLogo && input.tenantLogoUrl
    ? (input.tenantLogoUrl.startsWith('http') ? input.tenantLogoUrl : `${appBase}${input.tenantLogoUrl}`)
    : null;
  const footerText = !hideFooter && input.tenantName ? `\u00a9 ${input.tenantName}` : null;

  const submittedAt = new Date(input.submittedAt).toLocaleString('en-SG', {
    timeZone: input.timeZone ?? 'Asia/Singapore',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  function esc(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const purify = DOMPurify(new JSDOM('').window);

  function sanitizeRichHtml(value: string): string {
    const prepared = value
      .replace(/<p><\/p>/gi, '<p>&nbsp;</p>')
      .replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, '<p>&nbsp;</p>');

    return purify.sanitize(prepared, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
        'ul', 'ol', 'li', 'a', 'span', 'div', 'hr',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
      ],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'style', 'class'],
    });
  }

  function richTextToPlainText(value: string): string {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#039;/gi, "'")
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function renderRichText(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return /<\/?[a-z][\s\S]*>/i.test(trimmed)
      ? sanitizeRichHtml(trimmed)
      : `<div style="white-space:pre-wrap">${esc(trimmed)}</div>`;
  }

  function isHttpUrl(value: string | null | undefined): value is string {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  // Map layoutWidth (25/33/50/66/75/100) to CSS grid column span out of 12
  function colSpan(layoutWidth: number | null | undefined): number {
    const map: Record<number, number> = { 25: 3, 33: 4, 50: 6, 66: 8, 75: 9, 100: 12 };
    return map[layoutWidth ?? 100] ?? 12;
  }

  function isChoiceInlineRight(field: FormField): boolean {
    const validation = parseObject(field.validation);
    return validation?.choiceInlineRight === true;
  }

  function shouldRenderInfoBlockInPdf(field: FormField): boolean {
    const validation = parseObject(field.validation);
    return field.type === 'PARAGRAPH' && validation?.infoShowInPdf === true;
  }

  function fieldGridStyle(field: FormField, span: number): string {
    const validation = parseObject(field.validation);
    return `grid-column: ${validation?.layoutBreakBefore === true ? '1 / ' : ''}span ${span};`;
  }

  function renderChoiceInlineRight(field: FormField, value: unknown): string {
    const label = esc(field.label?.trim() || field.key);
    const options = parseChoiceOptions(field.options);
    const selectedText = formatChoiceAnswer(value);
    const optionsHtml = options.map((opt) => {
      const isSelected = formatChoiceAnswer(value) !== null &&
        (opt.value === (typeof value === 'string' ? value : (parseObject(value) as { value?: string } | null)?.value));
      return `<span class="choice-option${isSelected ? ' choice-option-selected' : ''}">${esc(opt.label)}</span>`;
    }).join('');
    return `
      <div class="field-inline-right">
        <span class="field-label-inline">${label}</span>
        <span class="choice-options-right">${optionsHtml || (selectedText ? `<span class="choice-option choice-option-selected">${esc(selectedText)}</span>` : `<span class="empty">\u2014</span>`)}</span>
      </div>`;
  }

  function renderInformationBlock(field: FormField): string {
    if (!shouldRenderInfoBlockInPdf(field)) return '';

    const span = colSpan(field.layoutWidth);
    const inputType = field.inputType || 'info_text';
    const blockStyle = fieldGridStyle(field, span);

    if (inputType === 'info_heading_1' || inputType === 'info_heading_2' || inputType === 'info_heading_3') {
      const tag = inputType === 'info_heading_1' ? 'h1' : inputType === 'info_heading_2' ? 'h2' : 'h3';
      const title = richTextToPlainText(field.label || field.subtext || '').trim();
      const description = field.label ? richTextToPlainText(field.subtext || '').trim() : '';
      if (!title && !description) return '';
      return `
        <div class="info-block info-heading ${tag}" style="${blockStyle}">
          ${title ? `<${tag}>${esc(title)}</${tag}>` : ''}
          ${description ? `<p>${esc(description)}</p>` : ''}
        </div>`;
    }

    if (inputType === 'info_image') {
      const imageUrl = field.placeholder?.trim() || '';
      const caption = field.subtext?.trim() || field.label?.trim() || '';
      return `
        <div class="info-block" style="${blockStyle}">
          <div class="info-box">
            ${isHttpUrl(imageUrl)
              ? `<img class="info-image" src="${esc(imageUrl)}" alt="${esc(richTextToPlainText(caption) || 'Information image')}" />`
              : `<div class="info-muted">Image URL is not available.</div>`}
            ${caption ? `<div class="info-caption">${esc(richTextToPlainText(caption))}</div>` : ''}
          </div>
        </div>`;
    }

    if (inputType === 'info_url') {
      const href = field.placeholder?.trim() || '';
      const label = richTextToPlainText(field.subtext || field.label || href).trim();
      const validation = parseObject(field.validation);
      const linkHtml = isHttpUrl(href)
        ? `<a class="info-link" href="${esc(href)}">${esc(label || href)}</a>`
        : '<span class="info-muted">URL is not available.</span>';
      return `
        <div class="info-block" style="${blockStyle}">
          ${validation?.infoBareStyle === true ? linkHtml : `<div class="info-box">${linkHtml}</div>`}
        </div>`;
    }

    if (inputType === 'info_faq') {
      const headerHtml = renderRichText(field.label || 'Commonly Asked Questions');
      const faqItems = parseChoiceOptions(field.options)
        .map((option, index) => {
          const questionHtml = renderRichText(option.label || `Question ${index + 1}`);
          const answerHtml = renderRichText(option.bodyHtml || '');
          if (!questionHtml && !answerHtml) return '';
          return `
            <div class="faq-item">
              ${questionHtml ? `<div class="faq-question">${questionHtml}</div>` : ''}
              ${answerHtml ? `<div class="faq-answer">${answerHtml}</div>` : ''}
            </div>`;
        })
        .filter(Boolean)
        .join('');
      if (!headerHtml && !faqItems) return '';
      return `
        <div class="info-block" style="${blockStyle}">
          <div class="info-box faq-box">
            ${headerHtml ? `<div class="faq-main-header">${headerHtml}</div>` : ''}
            ${faqItems}
          </div>
        </div>`;
    }

    const infoHtml = renderRichText(field.subtext || field.label || '');
    if (!infoHtml) return '';
    return `
      <div class="info-block" style="${blockStyle}">
        <div class="info-box info-rich">${infoHtml}</div>
      </div>`;
  }

  function renderFieldValue(field: FormField, value: unknown): string {
    if (field.type === 'SIGNATURE') {
      const signatureDataUrl = extractSignatureDataUrl(value);
      if (signatureDataUrl) {
        return `
          <div class="signature-value">
            <img src="${esc(signatureDataUrl)}" alt="Signature" />
          </div>`;
      }
      return `<span class="empty">\u2014</span>`;
    }
    if (field.type === 'FILE_UPLOAD') {
      const ids = toUploadIds(value);
      if (ids.length === 0) return `<span class="empty">\u2014</span>`;
      return ids.map((id) => {
        const upload = uploadsById.get(id);
        const name = upload?.originalFileName || upload?.fileName || id;
        return `<div class="file-name">${esc(name)}</div>`;
      }).join('');
    }
    if (field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE' || field.type === 'DROPDOWN') {
      const text = formatChoiceAnswer(value);
      return text ? esc(text) : `<span class="empty">\u2014</span>`;
    }
    const timeTimezoneText = formatTimeTimezoneAnswer(value);
    if (timeTimezoneText) {
      return esc(timeTimezoneText);
    }
    if (value === null || value === undefined || value === '') {
      return `<span class="empty">\u2014</span>`;
    }
    if (Array.isArray(value)) {
      const text = value.map((item) => String(item)).join(', ').trim();
      return text ? esc(text) : `<span class="empty">\u2014</span>`;
    }
    const text = String(value).trim();
    return text ? `<span style="white-space:pre-wrap">${esc(text)}</span>` : `<span class="empty">\u2014</span>`;
  }

  function renderField(field: FormField, value: unknown): string {
    if (field.type === 'PARAGRAPH') return renderInformationBlock(field);
    if (field.type === 'HTML' || field.type === 'HIDDEN') return '';
    const span = colSpan(field.layoutWidth);

    // choiceInlineRight: label on left, selected option pills on right
    if ((field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE') && isChoiceInlineRight(field)) {
      return `<div class="field" style="${fieldGridStyle(field, span)}">${renderChoiceInlineRight(field, value)}</div>`;
    }

    const label = esc(field.label?.trim() || field.key);
    return `
      <div class="field" style="${fieldGridStyle(field, span)}">
        <div class="field-label">${label}</div>
        <div class="field-value">${renderFieldValue(field, value)}</div>
      </div>`;
  }

  type PdfItem =
    | { kind: 'field'; field: FormField }
    | { kind: 'repeat'; title: string; hint: string | null; fields: FormField[]; rowCount: number };

  const items: PdfItem[] = [];

  for (let i = 0; i < input.fields.length; i++) {
    const field = input.fields[i];

    if (field.type === 'PAGE_BREAK') {
      if (isRepeatStartMarker(field)) {
        const sectionFields: FormField[] = [];
        let cursor = i + 1;
        while (cursor < input.fields.length) {
          const candidate = input.fields[cursor];
          if (isRepeatEndMarker(candidate)) break;
          // Back up so the outer for-loop's i++ lands back on this PAGE_BREAK,
          // which will then be processed as a regular page-break (continue) on the next iteration.
          if (candidate.type === 'PAGE_BREAK') { cursor -= 1; break; }
          if (candidate.type !== 'HIDDEN') sectionFields.push(candidate);
          cursor++;
        }
        const validation = parseObject(field.validation);
        const minItemsRaw = typeof validation?.repeatMinItems === 'number' ? Math.trunc(validation.repeatMinItems) : 1;
        const minItems = Math.max(1, Math.min(50, minItemsRaw));
        let rowCount = 0;
        for (const sf of sectionFields) {
          const v = input.answers[sf.key];
          if (Array.isArray(v)) rowCount = Math.max(rowCount, v.length);
          else if (!isEmptyValue(v)) rowCount = Math.max(rowCount, 1);
        }
        rowCount = Math.max(minItems, rowCount);
        const hasData = sectionFields.some((sf) => {
          const v = input.answers[sf.key];
          return Array.isArray(v) ? v.some((item) => !isEmptyValue(item)) : !isEmptyValue(v);
        });
        if ((evaluateCondition(field.condition, input.answers, { fields: input.fields }) || hasData) && sectionFields.length > 0 && rowCount > 0) {
          items.push({ kind: 'repeat', title: field.label?.trim() || 'Section', hint: field.subtext?.trim() || null, fields: sectionFields, rowCount });
        }
        i = cursor;
        continue;
      }
      continue; // repeat_end and regular page breaks — skip (render flat)
    }

    if (field.type === 'HIDDEN') continue;
    if (!evaluateCondition(field.condition, input.answers, { fields: input.fields })) continue;
    items.push({ kind: 'field', field });
  }

  const fieldsHtml = items.map((item) => {
    if (item.kind === 'field') {
      return renderField(item.field, input.answers[item.field.key]);
    }
    const rowsHtml = Array.from({ length: item.rowCount }, (_, rowIndex) => {
      const rowAnswers: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input.answers)) {
        rowAnswers[k] = Array.isArray(v) ? v[rowIndex] : (rowIndex === 0 ? v : undefined);
      }
      const rowFields = item.fields.filter(
        (f) => f.type !== 'HIDDEN' && evaluateCondition(f.condition, rowAnswers, { fields: item.fields })
      );
      if (rowFields.length === 0) return '';
      return `
        <div class="repeat-card">
          <div class="repeat-card-label">Entry ${rowIndex + 1}</div>
          <div class="repeat-card-fields fields-grid">${rowFields.map((f) => renderField(f, rowAnswers[f.key])).join('')}</div>
        </div>`;
    }).join('');

    return `
      <div class="repeat-section">
        <div class="repeat-title">${esc(item.title)}</div>
        ${item.hint ? `<div class="repeat-hint">${esc(item.hint)}</div>` : ''}
        ${rowsHtml}
      </div>`;
  }).join('');

  const contentHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4 portrait; margin: 48px 52px 40px; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
    font-size: 13px; line-height: 1.5; color: #111827; background: #fff;
  }
  /* --- First-page header --- */
  .header { margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb; }
  .header-top { display: flex; align-items: flex-start; gap: 12px; }
  .logo { max-height: 56px; max-width: 180px; object-fit: contain; flex-shrink: 0; }
  .header-text { display: flex; flex-direction: column; }
  .form-title { font-size: 20px; font-weight: 700; color: #111827; line-height: 1.3; }
  .form-submitted { font-size: 12px; color: #6b7280; margin-top: 3px; }
  .form-description { font-size: 12px; color: #6b7280; margin-top: 2px; }
  /* --- Fields grid (12 columns) --- */
  .fields-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 12px 16px; }
  .field { page-break-inside: avoid; min-width: 0; }
  .field-label { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .field-value {
    font-size: 13px; color: #111827; background: #f9fafb; border: 1px solid #e5e7eb;
    border-radius: 6px; padding: 8px 12px; min-height: 36px;
    word-break: break-word; overflow-wrap: break-word; white-space: pre-wrap;
  }
  /* --- choiceInlineRight --- */
  .field-inline-right {
    display: flex; align-items: flex-start; gap: 12px; background: #f9fafb;
    border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; min-height: 36px;
  }
  .field-label-inline { font-size: 13px; color: #111827; font-weight: 500; flex: 1 1 0; min-width: 0; word-break: break-word; }
  .choice-options-right { display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end; flex-shrink: 0; max-width: 55%; }
  .choice-option { font-size: 11px; padding: 2px 9px; border-radius: 9999px; border: 1px solid #d1d5db; color: #6b7280; background: #fff; white-space: normal; word-break: break-word; }
  .choice-option-selected { border-color: #4f46e5; color: #4f46e5; background: #eef2ff; font-weight: 600; }
  /* --- Misc --- */
  .empty { color: #d1d5db; }
  .file-name { color: #374151; word-break: break-all; }
  .signature-value {
    display: flex; align-items: center; justify-content: flex-start;
    min-height: 88px; background: #fff; border-radius: 4px; padding: 8px;
  }
  .signature-value img {
    display: block; max-height: 72px; max-width: 260px; width: auto; height: auto;
    object-fit: contain;
  }
  .info-block { page-break-inside: avoid; min-width: 0; }
  .info-box {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 6px;
    padding: 10px 12px; color: #111827; font-size: 12px; line-height: 1.55;
  }
  .info-rich p, .faq-answer p, .faq-main-header p { margin: 0 0 8px; }
  .info-rich p:last-child, .faq-answer p:last-child, .faq-main-header p:last-child { margin-bottom: 0; }
  .info-rich ul, .info-rich ol, .faq-answer ul, .faq-answer ol { margin: 6px 0 8px 18px; }
  .info-heading { padding-top: 4px; }
  .info-heading h1 { font-size: 18px; margin: 0 0 4px; line-height: 1.3; }
  .info-heading h2 { font-size: 15px; margin: 0 0 4px; line-height: 1.35; }
  .info-heading h3 { font-size: 13px; margin: 0 0 4px; line-height: 1.4; }
  .info-heading p { font-size: 12px; color: #6b7280; margin: 0; white-space: pre-wrap; }
  .info-image { display: block; max-width: 100%; max-height: 240px; object-fit: contain; margin: 0 auto; }
  .info-caption { border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 11px; margin-top: 8px; padding-top: 7px; }
  .info-link { color: #1d4ed8; text-decoration: underline; word-break: break-all; }
  .info-muted { color: #9ca3af; }
  .faq-box { padding: 0; overflow: hidden; }
  .faq-main-header { background: #f9fafb; border-bottom: 1px solid #e5e7eb; font-weight: 700; padding: 10px 12px; }
  .faq-item { border-top: 1px solid #e5e7eb; padding: 10px 12px; }
  .faq-item:first-of-type { border-top: 0; }
  .faq-question { font-weight: 600; color: #111827; margin-bottom: 5px; }
  .faq-answer { color: #374151; }
  /* --- Repeat sections (full-width within grid) --- */
  .repeat-section { margin-bottom: 20px; grid-column: span 12; }
  .repeat-title { font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 4px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; }
  .repeat-hint { font-size: 12px; color: #9ca3af; margin-bottom: 10px; }
  .repeat-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; margin-bottom: 10px; background: #fff; page-break-inside: avoid; }
  .repeat-card-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; margin-bottom: 10px; }
</style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      ${logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="Logo" />` : ''}
      <div class="header-text">
        <h1 class="form-title">${esc(input.formTitle || 'Form Response')}</h1>
        <div class="form-submitted">Submitted: ${esc(submittedAt)} (${esc(input.timeZone ?? 'Asia/Singapore')})</div>
        ${input.formDescription ? `<p class="form-description">${esc(input.formDescription)}</p>` : ''}
      </div>
    </div>
  </div>
  <div class="fields-grid">${fieldsHtml}</div>
</body>
</html>`;

  // Puppeteer footerTemplate renders in the page margin area — never overlaps content.
  // font-size must be set explicitly; Puppeteer resets it to 0 in header/footer context.
  const footerHtml = footerText
    ? `<div style="width:100%;font-family:sans-serif;font-size:9px;color:#9ca3af;text-align:center;padding:0 40px;">${esc(footerText)}</div>`
    : '<div></div>';

  return { contentHtml, footerHtml };
}

export async function buildSubmissionPdfBuffer(input: {
  formTitle: string;
  formDescription?: string | null;
  submittedAt: Date;
  respondentName: string | null;
  respondentEmail: string | null;
  status: FormSubmissionStatus;
  fields: FormField[];
  answers: Record<string, unknown>;
  uploads: FormUpload[];
  tenantLogoUrl?: string | null;
  tenantName?: string | null;
  formSettings?: unknown;
  timeZone?: string;
}): Promise<Buffer> {
  const { contentHtml, footerHtml } = buildSubmissionPdfHtml(input);
  return generatePDF(contentHtml, {
    format: 'A4',
    orientation: 'portrait',
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    headerHtml: '<div></div>',
    footerHtml,
  });
}

// ---------------------------------------------------------------------------
// Exported PDF route functions
// ---------------------------------------------------------------------------

export async function exportFormResponsePdf(
  formId: string,
  submissionId: string,
  tenantId: string
): Promise<{ buffer: Buffer; fileName: string }> {
  const form = await prisma.form.findFirst({
    where: { id: formId, tenantId, deletedAt: null },
    include: {
      fields: {
        orderBy: { position: 'asc' },
      },
      tenant: {
        select: { logoUrl: true, name: true },
      },
    },
  });

  if (!form) {
    throw new Error('Form not found');
  }

  const submission = await prisma.formSubmission.findFirst({
    where: {
      id: submissionId,
      formId,
      tenantId,
      deletedAt: null,
    },
  });

  if (!submission) {
    throw new Error('Submission not found');
  }

  const uploads = await prisma.formUpload.findMany({
    where: {
      formId,
      submissionId,
      tenantId,
    },
    orderBy: { createdAt: 'asc' },
  });
  const answers = toAnswerRecord(submission.answers);
  const tenantTimeZone = await getTenantTimeZone(form.tenantId);

  const buffer = await buildSubmissionPdfBuffer({
    formTitle: form.title,
    formDescription: form.description,
    submittedAt: submission.submittedAt,
    respondentName: submission.respondentName,
    respondentEmail: submission.respondentEmail,
    status: submission.status,
    fields: form.fields,
    answers,
    uploads,
    tenantLogoUrl: normalizeWorkspaceLogoUrl(form.tenant?.logoUrl),
    tenantName: form.tenant?.name ?? null,
    formSettings: form.settings,
    timeZone: tenantTimeZone,
  });
  const fileName = resolveSubmissionPdfFileName({
    formTitle: form.title,
    formSlug: form.slug,
    settings: form.settings,
    submissionId: submission.id,
    submittedAt: submission.submittedAt,
    timeZone: tenantTimeZone,
    answers,
  });

  return {
    buffer,
    fileName,
  };
}

async function getPublishedFormSubmissionContext(slug: string, submissionId: string) {
  const form = await prisma.form.findFirst({
    where: {
      slug,
      status: 'PUBLISHED',
      deletedAt: null,
    },
    include: {
      fields: {
        orderBy: { position: 'asc' },
      },
      tenant: {
        select: { logoUrl: true, name: true },
      },
    },
  });

  if (!form) {
    throw new Error('Form not found');
  }

  const submission = await prisma.formSubmission.findFirst({
    where: {
      id: submissionId,
      formId: form.id,
      tenantId: form.tenantId,
      deletedAt: null,
    },
  });

  if (!submission) {
    throw new Error('Submission not found');
  }

  const uploads = await prisma.formUpload.findMany({
    where: {
      formId: form.id,
      submissionId: submission.id,
      tenantId: form.tenantId,
    },
    orderBy: { createdAt: 'asc' },
  });

  return { form, submission, uploads };
}

export async function exportPublicFormResponsePdf(
  slug: string,
  submissionId: string
): Promise<{ buffer: Buffer; fileName: string }> {
  const { form, submission, uploads } = await getPublishedFormSubmissionContext(slug, submissionId);
  const answers = toAnswerRecord(submission.answers);
  const tenantTimeZone = await getTenantTimeZone(form.tenantId);

  const buffer = await buildSubmissionPdfBuffer({
    formTitle: form.title,
    formDescription: form.description,
    submittedAt: submission.submittedAt,
    respondentName: submission.respondentName,
    respondentEmail: submission.respondentEmail,
    status: submission.status,
    fields: form.fields,
    answers,
    uploads,
    tenantLogoUrl: normalizeWorkspaceLogoUrl(form.tenant?.logoUrl),
    tenantName: form.tenant?.name ?? null,
    formSettings: form.settings,
    timeZone: tenantTimeZone,
  });
  const fileName = resolveSubmissionPdfFileName({
    formTitle: form.title,
    formSlug: form.slug,
    settings: form.settings,
    submissionId: submission.id,
    submittedAt: submission.submittedAt,
    timeZone: tenantTimeZone,
    answers,
  });

  return {
    buffer,
    fileName,
  };
}

export async function emailPublicFormResponsePdfLink(
  slug: string,
  submissionId: string,
  recipientEmail: string,
  downloadToken: string
): Promise<void> {
  const { form, submission } = await getPublishedFormSubmissionContext(slug, submissionId);

  const email = recipientEmail.trim().toLowerCase();
  const downloadUrl = `${getAppBaseUrl()}/api/forms/public/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submission.id)}/pdf?token=${encodeURIComponent(downloadToken)}`;
  const submissionDate = new Date(submission.submittedAt).toLocaleString('en-SG');
  const safeFormTitle = escapeHtml(form.title);

  const subject = `Form response PDF: ${form.title}`;
  const html = `
    <p>Hello,</p>
    <p>Your response PDF for <strong>${safeFormTitle}</strong> is ready.</p>
    <p>Submitted on: ${submissionDate}</p>
    <p><a href="${downloadUrl}">Download response PDF</a></p>
    <p>If you did not request this email, you can ignore it.</p>
  `;

  const result = await sendEmail({
    to: email,
    subject,
    html,
  });

  if (!result.success) {
    throw new Error(result.error || 'Failed to send email');
  }
}
