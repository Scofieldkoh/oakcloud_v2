import { createHash } from 'crypto';
import { z } from 'zod';
import type { Form, FormField, FormSubmission, FormUpload } from '@/generated/prisma';
import { callAIWithConnector, getDefaultModelId, stripMarkdownCodeBlocks } from '@/lib/ai';
import { getModelConfig } from '@/lib/ai/models';
import type { AIImageInput } from '@/lib/ai/types';
import {
  formatChoiceAnswer,
  formatTimeTimezoneAnswer,
  isEmptyValue,
  parseFormAiSettings,
  parseFormSubmissionAiReview,
  parseObject,
  sanitizeAiReviewSections,
  toAnswerRecord,
  toUploadIds,
  type FormSubmissionAiReview,
  type FormSubmissionAiReviewSection,
} from '@/lib/form-utils';
import { createLogger } from '@/lib/logger';
import { storage } from '@/lib/storage';

const log = createLogger('form-ai');

const MAX_AI_REVIEW_ATTACHMENTS = 8;
const MAX_AI_REVIEW_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_AI_REVIEW_SINGLE_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const aiReviewSectionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  type: z.enum(['text', 'bullet_list', 'key_value']),
  content: z.string().trim().max(4000).nullable().optional(),
  items: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  entries: z.array(
    z.object({
      label: z.string().trim().min(1).max(120),
      value: z.string().trim().min(1).max(1000),
    })
  ).max(20).optional(),
});

const aiReviewSchema = z.object({
  reviewRequired: z.boolean(),
  severity: z.enum(['low', 'medium', 'high']).nullable().optional(),
  summary: z.string().trim().max(4000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  sections: z.array(aiReviewSectionSchema).max(8).optional(),
});

const attachmentCheckSchema = z.object({
  summary: z.string().trim().max(4000).nullable().optional(),
  attachments: z.array(
    z.object({
      attachmentIndex: z.number().int().min(1).max(MAX_AI_REVIEW_ATTACHMENTS),
      fileName: z.string().trim().min(1).max(240),
      fieldKey: z.string().trim().min(1).max(120).nullable().optional(),
      fieldLabel: z.string().trim().min(1).max(240).nullable().optional(),
      readability: z.enum(['clear', 'partial', 'unreadable']),
      documentType: z.string().trim().max(240).nullable().optional(),
      visibleTextSummary: z.string().trim().max(3000).nullable().optional(),
      extractedFields: z.array(
        z.object({
          label: z.string().trim().min(1).max(120),
          value: z.string().trim().min(1).max(500),
        })
      ).max(20).optional(),
      notes: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
    })
  ).max(MAX_AI_REVIEW_ATTACHMENTS).optional(),
});

type AttachmentSummary = {
  fileName: string;
  originalFileName: string | null;
  mimeType: string;
  sizeBytes: number;
  fieldKey: string | null;
  fieldLabel: string | null;
};

export interface FormSubmissionAiAttachmentCheckField {
  label: string;
  value: string;
}

export interface FormSubmissionAiAttachmentCheckItem {
  attachmentIndex: number;
  fileName: string;
  fieldKey: string | null;
  fieldLabel: string | null;
  readability: 'clear' | 'partial' | 'unreadable';
  documentType: string | null;
  visibleTextSummary: string | null;
  extractedFields: FormSubmissionAiAttachmentCheckField[];
  notes: string[];
}

export interface FormSubmissionAiAttachmentCheckResult {
  model: string;
  provider: string;
  attachmentCount: number;
  summary: string | null;
  attachments: FormSubmissionAiAttachmentCheckItem[];
  unsupportedAttachmentNames: string[];
  omittedAttachmentNames: string[];
}

function buildWarningSignature(input: Pick<FormSubmissionAiReview, 'reviewRequired' | 'severity' | 'summary' | 'tags' | 'sections'>): string | null {
  if (!input.reviewRequired) return null;

  const payload = JSON.stringify({
    severity: input.severity,
    summary: input.summary,
    tags: input.tags,
    sections: input.sections,
  });

  return createHash('sha256').update(payload).digest('hex');
}

function normalizeGeneratedSections(
  sections: z.infer<typeof aiReviewSectionSchema>[] | undefined
): FormSubmissionAiReviewSection[] {
  const normalizedSections: FormSubmissionAiReviewSection[] = [];

  for (const section of sections || []) {
    if (section.type === 'text') {
      const content = section.content?.trim() || null;
      if (!content) continue;
      normalizedSections.push({
        title: section.title.trim(),
        type: 'text',
        content,
        items: [],
        entries: [],
      });
      continue;
    }

    if (section.type === 'bullet_list') {
      const items = (section.items || []).map((item) => item.trim()).filter(Boolean);
      if (items.length === 0) continue;
      normalizedSections.push({
        title: section.title.trim(),
        type: 'bullet_list',
        content: null,
        items,
        entries: [],
      });
      continue;
    }

    const entries = (section.entries || [])
      .map((entry) => ({
        label: entry.label.trim(),
        value: entry.value.trim(),
      }))
      .filter((entry) => entry.label && entry.value);

    if (entries.length === 0) continue;

    normalizedSections.push({
      title: section.title.trim(),
      type: 'key_value',
      content: null,
      items: [],
      entries,
    });
  }

  return sanitizeAiReviewSections(normalizedSections);
}

function normalizeAttachmentCheckItems(
  attachments: z.infer<typeof attachmentCheckSchema>['attachments'],
  includedAttachments: AttachmentSummary[]
): FormSubmissionAiAttachmentCheckItem[] {
  const normalizedItems: FormSubmissionAiAttachmentCheckItem[] = [];

  for (const attachment of attachments || []) {
    const index = attachment.attachmentIndex - 1;
    const source = includedAttachments[index];
    if (!source) continue;

    normalizedItems.push({
      attachmentIndex: attachment.attachmentIndex,
      fileName: source.originalFileName || source.fileName,
      fieldKey: source.fieldKey,
      fieldLabel: source.fieldLabel,
      readability: attachment.readability,
      documentType: attachment.documentType?.trim() || null,
      visibleTextSummary: attachment.visibleTextSummary?.trim() || null,
      extractedFields: (attachment.extractedFields || [])
        .map((field) => ({
          label: field.label.trim(),
          value: field.value.trim(),
        }))
        .filter((field) => field.label && field.value),
      notes: (attachment.notes || []).map((note) => note.trim()).filter(Boolean),
    });
  }

  return normalizedItems;
}

function normalizePrimitiveValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
      return '[binary data omitted]';
    }
    return trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => normalizePrimitiveValue(item))
      .filter((item) => item !== null);
    return items.length > 0 ? items : null;
  }

  const record = parseObject(value);
  if (!record) {
    return String(value);
  }

  if (typeof record.value === 'string' || typeof record.value === 'number' || typeof record.value === 'boolean') {
    const detailText = typeof record.detailText === 'string' ? record.detailText.trim() : '';
    if (detailText) {
      return `${record.value} (${detailText})`;
    }
    return record.value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(record)) {
    const normalized = normalizePrimitiveValue(nestedValue);
    if (normalized === null) continue;
    next[key] = normalized;
  }

  return Object.keys(next).length > 0 ? next : null;
}

function normalizeAnswerValueForAI(
  field: FormField,
  value: unknown,
  uploadsById: Map<string, FormUpload>
): unknown {
  if (field.type === 'FILE_UPLOAD') {
    const uploadIds = toUploadIds(value);
    if (uploadIds.length === 0) return null;

    return uploadIds.map((uploadId) => {
      const upload = uploadsById.get(uploadId);
      if (!upload) {
        return { uploadId };
      }

      return {
        fileName: upload.fileName,
        originalFileName: upload.originalFileName || null,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
      };
    });
  }

  if (field.type === 'SIGNATURE') {
    return typeof value === 'string' && value.trim().length > 0 ? 'Provided' : null;
  }

  if (field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE' || field.type === 'DROPDOWN') {
    return formatChoiceAnswer(value);
  }

  const timeTimezoneText = formatTimeTimezoneAnswer(value);
  if (timeTimezoneText) return timeTimezoneText;

  return normalizePrimitiveValue(value);
}

function buildAnswerPayload(
  fields: FormField[],
  answers: Record<string, unknown>,
  uploadsById: Map<string, FormUpload>
): Array<Record<string, unknown>> {
  return fields
    .filter((field) => !['PAGE_BREAK', 'PARAGRAPH', 'HTML', 'HIDDEN'].includes(field.type))
    .map((field) => {
      const normalizedValue = normalizeAnswerValueForAI(field, answers[field.key], uploadsById);
      return {
        key: field.key,
        label: field.label?.trim() || field.key,
        type: field.type,
        required: field.isRequired,
        value: normalizedValue,
      };
    })
    .filter((entry) => !isEmptyValue(entry.value));
}

function isMimeTypeSupported(provider: string, mimeType: string): boolean {
  if (mimeType === 'application/pdf') {
    return provider === 'openai' || provider === 'anthropic' || provider === 'google';
  }

  return mimeType.startsWith('image/');
}

async function buildAttachmentInputs(
  uploads: FormUpload[],
  fields: FormField[],
  provider: string
): Promise<{
  images: AIImageInput[];
  includedAttachments: AttachmentSummary[];
  unsupportedAttachmentNames: string[];
  omittedAttachmentNames: string[];
}> {
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const images: AIImageInput[] = [];
  const includedAttachments: AttachmentSummary[] = [];
  const unsupportedAttachmentNames: string[] = [];
  const omittedAttachmentNames: string[] = [];
  let totalBytes = 0;

  for (const upload of uploads) {
    const displayName = upload.originalFileName || upload.fileName;
    const mimeType = upload.mimeType || 'application/octet-stream';

    if (!isMimeTypeSupported(provider, mimeType)) {
      unsupportedAttachmentNames.push(displayName);
      continue;
    }

    if (images.length >= MAX_AI_REVIEW_ATTACHMENTS) {
      omittedAttachmentNames.push(displayName);
      continue;
    }

    try {
      const content = await storage.download(upload.storageKey);
      if (
        content.length > MAX_AI_REVIEW_SINGLE_ATTACHMENT_BYTES ||
        totalBytes + content.length > MAX_AI_REVIEW_TOTAL_ATTACHMENT_BYTES
      ) {
        omittedAttachmentNames.push(displayName);
        continue;
      }

      images.push({
        base64: content.toString('base64'),
        mimeType,
      });
      totalBytes += content.length;

      const field = upload.fieldId ? fieldById.get(upload.fieldId) : null;
      includedAttachments.push({
        fileName: upload.fileName,
        originalFileName: upload.originalFileName || null,
        mimeType,
        sizeBytes: upload.sizeBytes,
        fieldKey: field?.key || null,
        fieldLabel: field?.label?.trim() || field?.key || null,
      });
    } catch (error) {
      omittedAttachmentNames.push(displayName);
      log.error('Failed to load form attachment for AI review', {
        uploadId: upload.id,
        formId: upload.formId,
        submissionId: upload.submissionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    images,
    includedAttachments,
    unsupportedAttachmentNames,
    omittedAttachmentNames,
  };
}

function buildUserPrompt(input: {
  form: Form & { fields: FormField[] };
  submission: FormSubmission;
  uploads: FormUpload[];
  customContext: string | null;
  includedAttachments: AttachmentSummary[];
  unsupportedAttachmentNames: string[];
  omittedAttachmentNames: string[];
}): string {
  const answers = toAnswerRecord(input.submission.answers);
  const uploadsById = new Map(input.uploads.map((upload) => [upload.id, upload]));
  const answerPayload = buildAnswerPayload(input.form.fields, answers, uploadsById);

  const defaultContext = [
    'Review the submission for internal staff.',
    'Compare form answers with attached evidence when available.',
    'Identify concrete mismatches, missing or unclear supporting evidence, suspicious inconsistencies, and any operational or compliance issues stated in the submission.',
    'Do not invent facts. If something cannot be verified from the evidence provided, say so clearly.',
  ].join(' ');

  return [
    'Analyze this submitted form and return only JSON.',
    '',
    'Custom review instructions:',
    input.customContext || defaultContext,
    '',
    'Output JSON schema:',
    JSON.stringify({
      reviewRequired: true,
      severity: 'medium',
      summary: 'Short overall assessment for staff.',
      tags: ['short-label'],
      sections: [
        {
          title: 'Issues found',
          type: 'bullet_list',
          items: ['Concrete issue or risk to review'],
        },
      ],
    }, null, 2),
    '',
    'Submission context:',
    JSON.stringify({
      formTitle: input.form.title,
      formDescription: input.form.description || null,
      submissionId: input.submission.id,
      submittedAt: input.submission.submittedAt.toISOString(),
      respondentName: input.submission.respondentName || null,
      respondentEmail: input.submission.respondentEmail || null,
      answers: answerPayload,
      includedAttachments: input.includedAttachments,
      unsupportedAttachmentNames: input.unsupportedAttachmentNames,
      omittedAttachmentNames: input.omittedAttachmentNames,
    }, null, 2),
    '',
    'Rules:',
    '- Set reviewRequired to true only when staff follow-up is justified.',
    '- severity should be low, medium, high, or null if severity is not meaningful for this form.',
    '- Keep summary concise and operational.',
    '- tags should be short labels, not full sentences.',
    '- sections should contain only useful form-specific output. Use only these section types: text, bullet_list, key_value.',
    '- In issue descriptions, do not mention internal field keys or uploaded file names.',
    '- Write issue bullets in plain language, for example: "Attachment appears to be a national identification card instead of a passport."',
    '- If there are no meaningful issues, return reviewRequired=false and keep sections focused and minimal.',
  ].join('\n');
}

function buildAttachmentCheckPrompt(input: {
  form: Form & { fields: FormField[] };
  submission: FormSubmission;
  includedAttachments: AttachmentSummary[];
  unsupportedAttachmentNames: string[];
  omittedAttachmentNames: string[];
}): string {
  return [
    'Inspect the attached submission files and return only JSON.',
    '',
    'Goal:',
    '- Report what is visibly readable from each included attachment.',
    '- Do not perform compliance, risk, or fraud analysis.',
    '- Do not guess text that is blurred, cropped, faint, or ambiguous.',
    '- If a document appears readable, extract the clearly visible fields.',
    '- If a document is only partly readable, state that precisely.',
    '',
    'Output JSON schema:',
    JSON.stringify({
      summary: 'Short statement on whether the attachments were readable.',
      attachments: [
        {
          attachmentIndex: 1,
          fileName: 'NRIC - Amy Chew Xing Mei - 10 Mar 26.pdf',
          fieldKey: 'nric',
          fieldLabel: 'NRIC',
          readability: 'clear',
          documentType: 'Singapore NRIC',
          visibleTextSummary: 'Front of a Singapore NRIC. Name, sex, and card number are visible.',
          extractedFields: [
            { label: 'full_name', value: 'AMY CHEW XING MEI' },
            { label: 'id_number', value: 'S1234567A' },
          ],
          notes: ['Date of birth is cropped and cannot be read confidently.'],
        },
      ],
    }, null, 2),
    '',
    'Attachment metadata:',
    JSON.stringify({
      formTitle: input.form.title,
      submissionId: input.submission.id,
      attachments: input.includedAttachments.map((attachment, index) => ({
        attachmentIndex: index + 1,
        fileName: attachment.originalFileName || attachment.fileName,
        mimeType: attachment.mimeType,
        fieldKey: attachment.fieldKey,
        fieldLabel: attachment.fieldLabel,
      })),
      unsupportedAttachmentNames: input.unsupportedAttachmentNames,
      omittedAttachmentNames: input.omittedAttachmentNames,
    }, null, 2),
    '',
    'Rules:',
    '- Return one attachments entry for each included attachment.',
    '- Keep attachmentIndex aligned to the metadata order.',
    '- Use readability=clear only when the relevant text is legible enough to read confidently.',
    '- Use readability=partial when only some of the important fields are readable.',
    '- Use readability=unreadable when the attachment cannot be meaningfully read.',
    '- For extractedFields, prefer labels like full_name, id_number, date_of_birth, address, nationality, issue_date, expiry_date, document_number, or document_type when visible.',
    '- Keep summary and visibleTextSummary concise: one or two short sentences each.',
    '- Limit extractedFields to the most important clearly visible values.',
    '- Keep notes short and only include important caveats.',
    '- Only include values that are directly visible in the attachment.',
    '- If a field is not readable, put that in notes instead of guessing.',
  ].join('\n');
}

export async function generateFormSubmissionAiReview(input: {
  form: Form & { fields: FormField[] };
  submission: FormSubmission;
  uploads: FormUpload[];
}): Promise<FormSubmissionAiReview | null> {
  const aiSettings = parseFormAiSettings(input.form.settings);
  if (!aiSettings.enabled) {
    return null;
  }

  const selectedModel = getDefaultModelId();
  const modelConfig = getModelConfig(selectedModel);
  const existingReview = parseFormSubmissionAiReview(input.submission.metadata);
  const queuedAt = existingReview?.queuedAt ?? null;
  const startedAt = existingReview?.startedAt ?? null;
  const processedAt = new Date().toISOString();

  const {
    images,
    includedAttachments,
    unsupportedAttachmentNames,
    omittedAttachmentNames,
  } = await buildAttachmentInputs(input.uploads, input.form.fields, modelConfig.provider);

  try {
    const response = await callAIWithConnector({
      tenantId: input.form.tenantId,
      userId: null,
      model: selectedModel,
      systemPrompt: 'You are a careful compliance and operations reviewer for submitted business forms. Respond with valid JSON only.',
      userPrompt: buildUserPrompt({
        form: input.form,
        submission: input.submission,
        uploads: input.uploads,
        customContext: aiSettings.customContext,
        includedAttachments,
        unsupportedAttachmentNames,
        omittedAttachmentNames,
      }),
      jsonMode: true,
      images,
      temperature: 0.1,
      operation: 'form_submission_ai_review',
      usageMetadata: {
        formId: input.form.id,
        submissionId: input.submission.id,
        attachmentCount: images.length,
      },
    });

    const parsed = aiReviewSchema.parse(JSON.parse(stripMarkdownCodeBlocks(response.content)));
    const sections = normalizeGeneratedSections(parsed.sections);
    const baseReview = {
      reviewRequired: parsed.reviewRequired,
      severity: parsed.severity ?? null,
      summary: parsed.summary ?? null,
      tags: (parsed.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
      sections,
    } satisfies Pick<FormSubmissionAiReview, 'reviewRequired' | 'severity' | 'summary' | 'tags' | 'sections'>;

    return {
      status: 'completed',
      ...baseReview,
      model: selectedModel,
      warningSignature: buildWarningSignature(baseReview),
      resolvedWarningSignature: existingReview?.resolvedWarningSignature ?? null,
      resolvedAt: existingReview?.resolvedAt ?? null,
      resolvedByUserId: existingReview?.resolvedByUserId ?? null,
      resolvedReason: existingReview?.resolvedReason ?? null,
      queuedAt,
      startedAt,
      processedAt,
      attachmentCount: includedAttachments.length,
      unsupportedAttachmentNames,
      omittedAttachmentNames,
      error: null,
      emailNotificationPending: existingReview?.emailNotificationPending === true,
      ...(response.usage ? { usage: response.usage } : {}),
    };
  } catch (error) {
    log.error('Form AI review failed', {
      formId: input.form.id,
      submissionId: input.submission.id,
      model: selectedModel,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      status: 'failed',
      reviewRequired: false,
      severity: null,
      summary: null,
      tags: [],
      sections: [],
      model: selectedModel,
      warningSignature: null,
      resolvedWarningSignature: existingReview?.resolvedWarningSignature ?? null,
      resolvedAt: existingReview?.resolvedAt ?? null,
      resolvedByUserId: existingReview?.resolvedByUserId ?? null,
      resolvedReason: existingReview?.resolvedReason ?? null,
      queuedAt,
      startedAt,
      processedAt,
      attachmentCount: includedAttachments.length,
      unsupportedAttachmentNames,
      omittedAttachmentNames,
      error: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown AI review error',
      emailNotificationPending: existingReview?.emailNotificationPending === true,
    };
  }
}

export async function diagnoseFormSubmissionAiAttachments(input: {
  form: Form & { fields: FormField[] };
  submission: FormSubmission;
  uploads: FormUpload[];
}): Promise<FormSubmissionAiAttachmentCheckResult> {
  const selectedModel = getDefaultModelId();
  const modelConfig = getModelConfig(selectedModel);

  const {
    images,
    includedAttachments,
    unsupportedAttachmentNames,
    omittedAttachmentNames,
  } = await buildAttachmentInputs(input.uploads, input.form.fields, modelConfig.provider);

  if (includedAttachments.length === 0 || images.length === 0) {
    return {
      model: selectedModel,
      provider: modelConfig.provider,
      attachmentCount: includedAttachments.length,
      summary: 'No supported attachments were available for the AI attachment check.',
      attachments: [],
      unsupportedAttachmentNames,
      omittedAttachmentNames,
    };
  }

  const response = await callAIWithConnector({
    tenantId: input.form.tenantId,
    userId: null,
    model: selectedModel,
    systemPrompt: 'You inspect attached submission documents for readability. Return valid JSON only.',
    userPrompt: buildAttachmentCheckPrompt({
      form: input.form,
      submission: input.submission,
      includedAttachments,
      unsupportedAttachmentNames,
      omittedAttachmentNames,
    }),
    jsonMode: true,
    images,
    temperature: 0.1,
    operation: 'form_submission_ai_attachment_check',
    usageMetadata: {
      formId: input.form.id,
      submissionId: input.submission.id,
      attachmentCount: images.length,
    },
  });

  const parsed = attachmentCheckSchema.parse(JSON.parse(stripMarkdownCodeBlocks(response.content)));

  return {
    model: response.model,
    provider: response.provider,
    attachmentCount: includedAttachments.length,
    summary: parsed.summary?.trim() || null,
    attachments: normalizeAttachmentCheckItems(parsed.attachments, includedAttachments),
    unsupportedAttachmentNames,
    omittedAttachmentNames,
  };
}
