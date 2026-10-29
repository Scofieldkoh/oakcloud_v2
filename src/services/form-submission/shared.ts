/**
 * Limits, response-cell formatting, tag helpers and upload cleanup shared by
 * the form submission modules.
 */

import { FormFieldType, type FormSubmission, type FormUpload } from '@/generated/prisma';
import {
  RESPONSE_COLUMN_STATUS_ID,
  RESPONSE_COLUMN_SUBMITTED_ID,
  formatChoiceAnswer,
  formatTimeTimezoneAnswer,
  parseFormSubmissionAiReview,
  parseObject,
  toAnswerRecord,
} from '@/lib/form-utils';
import { storage } from '@/lib/storage';
import { createLogger } from '@/lib/logger';

export const MAX_NOTIFICATION_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_NOTIFICATION_UPLOAD_ATTACHMENTS = 20;
export const MAX_NOTIFICATION_DOWNLOAD_CONCURRENCY = 4;
export const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const RESPONSE_ATTACHMENTS_COLUMN_ID = '__submission_attachments';
export const RESPONSE_TAGS_COLUMN_ID = '__submission_tags';
export const log = createLogger('form-builder');

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

export function formatResponseCellValue(fieldType: FormFieldType | string, value: unknown): string {
  if (value === null || value === undefined) return '-';

  if (fieldType === 'SIGNATURE') {
    return typeof value === 'string' && value.trim().length > 0 ? 'Signed' : '-';
  }

  if (fieldType === 'FILE_UPLOAD') {
    if (Array.isArray(value)) {
      return value.length > 0 ? `${value.length} file${value.length > 1 ? 's' : ''}` : '-';
    }
    return typeof value === 'string' && value.trim().length > 0 ? value : '-';
  }

  if (fieldType === 'SINGLE_CHOICE' || fieldType === 'MULTIPLE_CHOICE') {
    const choiceText = formatChoiceAnswer(value);
    return choiceText || '-';
  }

  const timeTimezoneText = formatTimeTimezoneAnswer(value);
  if (timeTimezoneText) return timeTimezoneText;

  if (Array.isArray(value)) {
    const text = value.map((item) => String(item)).join(', ').trim();
    return text || '-';
  }

  if (typeof value === 'object') {
    try {
      const text = JSON.stringify(value);
      return text.length > 0 ? text : '-';
    } catch {
      return '-';
    }
  }

  const text = String(value).trim();
  return text || '-';
}

export function getSubmissionStatusText(submission: Pick<FormSubmission, 'status' | 'metadata'>): string {
  const aiReview = parseFormSubmissionAiReview(submission.metadata);
  const tokens: string[] = [submission.status];

  if (aiReview?.status === 'queued' || aiReview?.status === 'processing') {
    tokens.push('review pending');
  }

  if (aiReview && aiReview.status === 'completed' && aiReview.reviewRequired) {
    if (!aiReview.warningSignature || aiReview.resolvedWarningSignature !== aiReview.warningSignature) {
      tokens.push('warning review required');
    }
  }

  return tokens.join(' ');
}

export function normalizeFormResponseTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 48);
}

export function normalizeFormResponseTags(values: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const value of values) {
    const tag = normalizeFormResponseTag(value);
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    tags.push(tag);
  }

  return tags.slice(0, 20);
}

export function getFormResponseTags(metadata: unknown): string[] {
  const root = parseObject(metadata);
  if (!root || !Array.isArray(root.responseTags)) return [];

  return normalizeFormResponseTags(root.responseTags.filter((tag): tag is string => typeof tag === 'string'));
}

export function hasAllTags(rowTags: string[], requiredTags: string[]): boolean {
  if (requiredTags.length === 0) return true;
  const rowTagSet = new Set(rowTags.map((tag) => tag.toLowerCase()));
  return requiredTags.every((tag) => rowTagSet.has(tag.toLowerCase()));
}

export function hasAnyTag(rowTags: string[], excludedTags: string[]): boolean {
  if (excludedTags.length === 0) return false;
  const rowTagSet = new Set(rowTags.map((tag) => tag.toLowerCase()));
  return excludedTags.some((tag) => rowTagSet.has(tag.toLowerCase()));
}

export function getSubmissionColumnFilterText(
  submission: FormSubmission & { _count: { uploads: number } },
  fieldTypeByKey: Map<string, FormFieldType>,
  columnId: string
): string {
  if (columnId === RESPONSE_COLUMN_SUBMITTED_ID) {
    return `${submission.submittedAt.toISOString()} ${submission.submittedAt.toLocaleString('en-SG')}`.toLowerCase();
  }

  if (columnId === RESPONSE_COLUMN_STATUS_ID) {
    return getSubmissionStatusText(submission).toLowerCase();
  }

  if (columnId === RESPONSE_ATTACHMENTS_COLUMN_ID) {
    return `${submission._count.uploads} file${submission._count.uploads === 1 ? '' : 's'}`.toLowerCase();
  }

  if (columnId === RESPONSE_TAGS_COLUMN_ID) {
    return getFormResponseTags(submission.metadata).join(' ').toLowerCase();
  }

  const fieldType = fieldTypeByKey.get(columnId);
  if (!fieldType) {
    return '';
  }

  const answers = toAnswerRecord(submission.answers);
  return formatResponseCellValue(fieldType, answers[columnId]).toLowerCase();
}

export function compareSubmissionRows(
  left: FormSubmission & { _count: { uploads: number } },
  right: FormSubmission & { _count: { uploads: number } },
  fieldTypeByKey: Map<string, FormFieldType>,
  sortBy: string,
  sortOrder: 'asc' | 'desc'
): number {
  const direction = sortOrder === 'asc' ? 1 : -1;

  if (sortBy === RESPONSE_COLUMN_SUBMITTED_ID) {
    return (left.submittedAt.getTime() - right.submittedAt.getTime()) * direction;
  }

  if (sortBy === RESPONSE_ATTACHMENTS_COLUMN_ID) {
    return (left._count.uploads - right._count.uploads) * direction;
  }

  const leftValue = sortBy === RESPONSE_COLUMN_STATUS_ID
    ? getSubmissionStatusText(left)
    : getSubmissionColumnFilterText(left, fieldTypeByKey, sortBy);
  const rightValue = sortBy === RESPONSE_COLUMN_STATUS_ID
    ? getSubmissionStatusText(right)
    : getSubmissionColumnFilterText(right, fieldTypeByKey, sortBy);

  const comparison = leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: 'base' });
  if (comparison !== 0) {
    return comparison * direction;
  }

  return right.submittedAt.getTime() - left.submittedAt.getTime();
}

export function removeUploadIdFromAnswerValue(value: unknown, uploadId: string): unknown {
  if (typeof value === 'string') {
    return value.trim() === uploadId ? undefined : value;
  }

  if (!Array.isArray(value)) {
    return value;
  }

  const nextValue: unknown[] = [];

  for (const item of value) {
    if (Array.isArray(item)) {
      const updatedNested = removeUploadIdFromAnswerValue(item, uploadId);
      nextValue.push(Array.isArray(updatedNested) ? updatedNested : []);
      continue;
    }

    const updatedItem = removeUploadIdFromAnswerValue(item, uploadId);
    if (updatedItem !== undefined) {
      nextValue.push(updatedItem);
    }
  }

  return nextValue;
}

export function removeUploadFromAnswerRecord(
  answers: Record<string, unknown>,
  uploadId: string,
  fieldKey?: string
): Record<string, unknown> {
  const nextAnswers = { ...answers };
  const updateKey = (key: string): boolean => {
    if (!(key in nextAnswers)) return false;

    const value = nextAnswers[key];
    if (!collectUploadIdsFromAnswer(value).includes(uploadId)) return false;

    const updatedValue = removeUploadIdFromAnswerValue(value, uploadId);
    nextAnswers[key] = updatedValue === undefined ? [] : updatedValue;
    return true;
  };

  const removedFromFieldKey = fieldKey ? updateKey(fieldKey) : false;

  if (!removedFromFieldKey) {
    for (const key of Object.keys(nextAnswers)) {
      updateKey(key);
    }
  }

  return nextAnswers;
}

export async function deleteStoredUploads(
  uploads: Array<Pick<FormUpload, 'id' | 'storageKey'>>,
  context: { formId: string; submissionId?: string }
): Promise<void> {
  if (uploads.length === 0) return;

  const results = await Promise.allSettled(
    uploads.map((upload) => storage.delete(upload.storageKey))
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') return;

    const upload = uploads[index];
    if (!upload) return;

    log.error('Failed to delete form upload from storage', {
      formId: context.formId,
      submissionId: context.submissionId,
      uploadId: upload.id,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });
}

export function collectUploadIdsFromAnswer(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(value)) return [];

  const ids: string[] = [];
  for (const item of value) {
    ids.push(...collectUploadIdsFromAnswer(item));
  }
  return ids;
}
