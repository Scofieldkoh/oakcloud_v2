'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronUp, Copy, Download, FileText, Paperclip, RefreshCw, Trash2, User } from 'lucide-react';
import type { FormField, FormUpload } from '@/generated/prisma';
import { CompanyIncorporationReviewPanel } from '@/components/forms/company-incorporation-review-panel';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import {
  useDeleteFormResponse,
  useDeleteFormResponseUpload,
  useForm,
  useFormResponse,
  useUpdateFormResponseReviewStatus,
} from '@/hooks/use-forms';
import {
  FORM_RESPONSE_REVIEW_STATUS_OPTIONS,
  WIDTH_CLASS,
  evaluateCondition,
  hasUnresolvedFormSubmissionAiWarning,
  isEmptyValue,
  parseFormAiSettings,
  parseFormResponseReviewStatus,
  parseFormSubmissionAiReview,
  parseObject,
  type FormResponseReviewStatus,
  type FormSubmissionAiReviewSection,
} from '@/lib/form-utils';
import { formatResponseFieldValue, isResponseAnswerField } from '@/lib/form-response-display';
import { extractSignatureDataUrl } from '@/lib/signature-utils';
import {
  describeNameCheckAssessment,
  describeNameCheckReason,
  parseNameCheckResultValue,
  type NameCheckResultValue,
} from '@/lib/forms/name-check-result';
import { SG_COMPANY_INCORPORATION_TEMPLATE_KEY } from '@/lib/form-templates/sg-company-incorporation';

type RepeatSectionConfig = {
  id: string;
  minItems: number;
};

type ResponsePageItem =
  | { kind: 'field'; field: FormField }
  | {
    kind: 'repeat';
    sectionId: string;
    title: string;
    hint: string | null;
    fields: FormField[];
    rowCount: number;
  };

type ResponsePage = {
  items: ResponsePageItem[];
};

type AttachmentCheckField = {
  label: string;
  value: string;
};

type AttachmentCheckItem = {
  attachmentIndex: number;
  fileName: string;
  fieldKey: string | null;
  fieldLabel: string | null;
  readability: 'clear' | 'partial' | 'unreadable';
  documentType: string | null;
  visibleTextSummary: string | null;
  extractedFields: AttachmentCheckField[];
  notes: string[];
};

type AttachmentCheckResult = {
  model: string;
  provider: string;
  attachmentCount: number;
  summary: string | null;
  attachments: AttachmentCheckItem[];
  unsupportedAttachmentNames: string[];
  omittedAttachmentNames: string[];
};

function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toAnswerRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getSubmissionNameCheckResult(metadata: unknown, fieldKey: string): NameCheckResultValue | null {
  const root = parseObject(metadata);
  const results = root ? parseObject(root.nameCheckResults) : null;
  return results ? parseNameCheckResultValue(results[fieldKey]) : null;
}

function toCopyValue(field: FormField, value: unknown): string | null {
  if (value === null || value === undefined || field.type === 'SIGNATURE') return null;
  return formatResponseFieldValue(field, value);
}

function toUploadIds(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 B';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAttachmentCount(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`;
}

function renderAiReviewTags(tags: string[], tone: 'default' | 'warning') {
  if (tags.length === 0) return null;

  return (
    <div className="mt-3">
      <div className={`text-2xs uppercase tracking-wide ${tone === 'warning' ? 'text-amber-900/70' : 'text-text-muted'}`}>
        Tags
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        {tags.map((tag, index) => (
          <span
            key={`${tag}-${index}`}
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              tone === 'warning'
                ? 'border border-amber-300 bg-amber-100 text-amber-900'
                : 'border border-border-primary bg-background-secondary text-text-secondary'
            }`}
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function renderAiReviewSections(sections: FormSubmissionAiReviewSection[], tone: 'default' | 'warning') {
  if (sections.length === 0) return null;

  const titleClass = tone === 'warning' ? 'text-amber-900/70' : 'text-text-muted';
  const textClass = tone === 'warning' ? 'text-amber-950' : 'text-text-primary';
  const cardClass = tone === 'warning'
    ? 'border-amber-200/80 bg-amber-100/40'
    : 'border-border-primary/70 bg-background-secondary/40';
  const bulletClass = tone === 'warning' ? 'bg-amber-500' : 'bg-text-muted';

  return (
    <div className="mt-3 space-y-3">
      {sections.map((section, index) => (
        <div
          key={`${section.title}-${index}`}
          className={`rounded-md border p-3 ${cardClass}`}
        >
          <div className={`text-2xs uppercase tracking-wide ${titleClass}`}>{section.title}</div>

          {section.type === 'text' && section.content && (
            <p className={`mt-1 text-sm ${textClass}`}>{section.content}</p>
          )}

          {section.type === 'bullet_list' && section.items.length > 0 && (
            <ul className={`mt-1 space-y-1 text-sm ${textClass}`}>
              {section.items.map((item, itemIndex) => (
                <li key={`${section.title}-${itemIndex}`} className="flex gap-2">
                  <span className={`mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full ${bulletClass}`} aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}

          {section.type === 'key_value' && section.entries.length > 0 && (
            <dl className={`mt-2 space-y-2 text-sm ${textClass}`}>
              {section.entries.map((entry, entryIndex) => (
                <div key={`${section.title}-${entryIndex}`} className="grid gap-1 sm:grid-cols-[minmax(0,180px)_1fr] sm:gap-3">
                  <dt className="font-medium">{entry.label}</dt>
                  <dd>{entry.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}

function renderAiResolutionSection(reason: string | null, resolvedAt: string | null) {
  if (!reason) return null;

  return (
    <div className="mt-3 rounded-md border border-sky-200 bg-sky-50/80 p-3">
      <div className="text-2xs uppercase tracking-wide text-sky-800/80">Resolution</div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-sky-950">{reason}</p>
      {resolvedAt && (
        <p className="mt-2 text-xs text-sky-900/70">Resolved on {formatDate(resolvedAt)}</p>
      )}
    </div>
  );
}

function getAttachmentReadabilityClasses(readability: AttachmentCheckItem['readability']): string {
  if (readability === 'clear') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  if (readability === 'partial') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }

  return 'border-red-200 bg-red-50 text-red-700';
}

function isRepeatStartMarker(field: FormField): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'repeat_start';
}

function isRepeatEndMarker(field: FormField): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'repeat_end';
}

function isBlockDivider(field: FormField): boolean {
  return field.type === 'PAGE_BREAK' && field.inputType === 'block_divider';
}

function getRepeatSectionConfig(startField: FormField): RepeatSectionConfig {
  const validation = parseObject(startField.validation);
  const minItemsRaw = typeof validation?.repeatMinItems === 'number' ? Math.trunc(validation.repeatMinItems) : 1;
  const minItems = Math.max(1, Math.min(50, minItemsRaw));
  return {
    id: startField.id || startField.key,
    minItems,
  };
}

function hasAnyAnswerValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasAnyAnswerValue(item));
  }
  return !isEmptyValue(value);
}

function getRepeatRowValue(value: unknown, rowIndex: number): unknown {
  if (Array.isArray(value)) {
    return value[rowIndex];
  }
  return rowIndex === 0 ? value : undefined;
}

function buildRowAnswers(answers: Record<string, unknown>, rowIndex: number): Record<string, unknown> {
  const rowAnswers: Record<string, unknown> = {};
  for (const [answerKey, answerValue] of Object.entries(answers)) {
    rowAnswers[answerKey] = getRepeatRowValue(answerValue, rowIndex);
  }
  return rowAnswers;
}

function getRepeatSectionRowCount(
  sectionFields: FormField[],
  answers: Record<string, unknown>,
  minItems: number
): number {
  let rowCount = 0;

  for (const field of sectionFields) {
    const value = answers[field.key];
    if (Array.isArray(value)) {
      rowCount = Math.max(rowCount, value.length);
      continue;
    }

    if (hasAnyAnswerValue(value)) {
      rowCount = Math.max(rowCount, 1);
    }
  }

  return Math.max(minItems, rowCount);
}

export default function FormResponseDetailPage() {
  const params = useParams<{ id: string; submissionId: string }>();
  const router = useRouter();
  const formId = params.id;
  const submissionId = params.submissionId;
  const { success, error: showError } = useToast();

  const [recentlyCopiedKey, setRecentlyCopiedKey] = useState<string | null>(null);
  const [isDeleteResponseConfirmOpen, setIsDeleteResponseConfirmOpen] = useState(false);
  const [uploadToDelete, setUploadToDelete] = useState<FormUpload | null>(null);
  const [isRerunningAiReview, setIsRerunningAiReview] = useState(false);
  const [isResolvingAiWarning, setIsResolvingAiWarning] = useState(false);
  const [isResolveReasonModalOpen, setIsResolveReasonModalOpen] = useState(false);
  const [resolveReason, setResolveReason] = useState('');
  const [isAttachmentCheckOpen, setIsAttachmentCheckOpen] = useState(false);
  const [isRunningAttachmentCheck, setIsRunningAttachmentCheck] = useState(false);
  const [attachmentCheckResult, setAttachmentCheckResult] = useState<AttachmentCheckResult | null>(null);
  const [attachmentCheckError, setAttachmentCheckError] = useState<string | null>(null);
  const [isResolvedAiExpanded, setIsResolvedAiExpanded] = useState(true);

  const { data: form, isLoading: isFormLoading, error: formError } = useForm(formId);
  const {
    data: responseDetail,
    isLoading: isResponseLoading,
    error: responseError,
    refetch: refetchResponse,
  } = useFormResponse(formId, submissionId);
  const deleteResponseMutation = useDeleteFormResponse(formId);
  const deleteUploadMutation = useDeleteFormResponseUpload(formId, submissionId);
  const updateReviewStatusMutation = useUpdateFormResponseReviewStatus(formId);

  const submission = responseDetail?.submission ?? null;
  const uploadCount = responseDetail?.uploads.length ?? 0;
  const reviewStatus = parseFormResponseReviewStatus(submission?.metadata);
  const isCompanyIncorporationResponse = parseObject(parseObject(submission?.metadata)?.companyIncorporation)?.templateKey === SG_COMPANY_INCORPORATION_TEMPLATE_KEY;

  const submissionAnswers = useMemo(
    () => toAnswerRecord(submission?.answers),
    [submission?.answers]
  );
  const aiReview = useMemo(
    () => parseFormSubmissionAiReview(submission?.metadata),
    [submission?.metadata]
  );
  const aiSettings = useMemo(
    () => parseFormAiSettings(form?.settings),
    [form?.settings]
  );
  const hasUnresolvedAiWarning = hasUnresolvedFormSubmissionAiWarning(aiReview);
  const isResolvedAiCard = !!(
    aiReview &&
    aiReview.status === 'completed' &&
    aiReview.reviewRequired &&
    aiReview.resolvedAt &&
    !hasUnresolvedAiWarning
  );

  useEffect(() => {
    setIsResolvedAiExpanded(!isResolvedAiCard);
  }, [isResolvedAiCard, aiReview?.resolvedAt, aiReview?.warningSignature]);

  const uploadsById = useMemo(() => {
    const map = new Map<string, FormUpload>();
    const uploads = responseDetail?.uploads || [];
    for (const upload of uploads) {
      map.set(upload.id, upload);
    }
    return map;
  }, [responseDetail?.uploads]);

  const responsePages = useMemo(() => {
    if (!form || !submission) return [] as ResponsePage[];

    const pages: ResponsePage[] = [{ items: [] }];

    for (let index = 0; index < form.fields.length; index += 1) {
      const field = form.fields[index];

      if (field.type === 'PAGE_BREAK') {
        if (isBlockDivider(field)) {
          continue;
        }

        if (isRepeatStartMarker(field)) {
          const sectionFields: FormField[] = [];
          let cursor = index + 1;

          while (cursor < form.fields.length) {
            const candidate = form.fields[cursor];
            if (isRepeatEndMarker(candidate)) {
              break;
            }
            if (candidate.type === 'PAGE_BREAK') {
              cursor -= 1;
              break;
            }
            if (isResponseAnswerField(candidate)) {
              sectionFields.push(candidate);
            }
            cursor += 1;
          }

          const sectionConfig = getRepeatSectionConfig(field);
          const rowCount = getRepeatSectionRowCount(sectionFields, submissionAnswers, sectionConfig.minItems);
          const hasData = sectionFields.some((sectionField) => hasAnyAnswerValue(submissionAnswers[sectionField.key]));
          const shouldDisplaySection = evaluateCondition(field.condition, submissionAnswers, { fields: form.fields }) || hasData;

          if (shouldDisplaySection && sectionFields.length > 0 && rowCount > 0) {
            pages[pages.length - 1].items.push({
              kind: 'repeat',
              sectionId: sectionConfig.id,
              title: field.label?.trim() || 'Dynamic section',
              hint: field.subtext?.trim() || null,
              fields: sectionFields,
              rowCount,
            });
          }

          index = cursor;
          continue;
        }

        if (isRepeatEndMarker(field)) {
          continue;
        }

        pages.push({ items: [] });
        continue;
      }

      if (!isResponseAnswerField(field)) continue;
      if (!evaluateCondition(field.condition, submissionAnswers, { fields: form.fields })) continue;

      pages[pages.length - 1].items.push({ kind: 'field', field });
    }

    return pages.filter((page) => page.items.length > 0);
  }, [form, submission, submissionAnswers]);

  async function handleCopyValue(copyKey: string, value: string | null) {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setRecentlyCopiedKey(copyKey);
      success('Field value copied');
      window.setTimeout(() => setRecentlyCopiedKey((prev) => (prev === copyKey ? null : prev)), 1200);
    } catch {
      showError('Failed to copy value');
    }
  }

  async function handleReviewStatusChange(nextStatus: FormResponseReviewStatus) {
    if (!submission || nextStatus === reviewStatus) return;

    try {
      await updateReviewStatusMutation.mutateAsync({
        submissionId: submission.id,
        reviewStatus: nextStatus,
      });
      success('Review status updated');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to update review status');
    }
  }

  async function handleDeleteResponse(reason?: string) {
    if (!submission) return;

    try {
      await deleteResponseMutation.mutateAsync({
        submissionId: submission.id,
        reason,
      });
      success('Response deleted');
      setIsDeleteResponseConfirmOpen(false);
      router.push(`/forms/${formId}/responses`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete response');
    }
  }

  async function handleDeleteUpload(reason?: string) {
    if (!uploadToDelete) return;

    try {
      await deleteUploadMutation.mutateAsync({
        uploadId: uploadToDelete.id,
        reason,
      });
      success(`Removed attachment "${uploadToDelete.fileName}"`);
      setUploadToDelete(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete attachment');
    }
  }

  async function handleRerunAiReview() {
    if (!form || !submission) return;

    try {
      setIsRerunningAiReview(true);
      const response = await fetch(`/api/forms/${encodeURIComponent(form.id)}/responses/${encodeURIComponent(submission.id)}/ai-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: form.tenantId,
          reason: 'Manual AI review rerun from response detail',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to queue AI review');
      }

      await refetchResponse();
      success('AI review queued');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to queue AI review');
    } finally {
      setIsRerunningAiReview(false);
    }
  }

  async function handleResolveAiWarning() {
    if (!form || !submission) return;
    const trimmedReason = resolveReason.trim();
    if (!trimmedReason) {
      showError('Resolution reason is required');
      return;
    }

    try {
      setIsResolvingAiWarning(true);
      const response = await fetch(`/api/forms/${encodeURIComponent(form.id)}/responses/${encodeURIComponent(submission.id)}/ai-review/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: form.tenantId,
          reason: trimmedReason,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to resolve AI warning');
      }

      await refetchResponse();
      setIsResolveReasonModalOpen(false);
      setResolveReason('');
      success('AI warning resolved');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to resolve AI warning');
    } finally {
      setIsResolvingAiWarning(false);
    }
  }

  function openResolveReasonModal() {
    setResolveReason('');
    setIsResolveReasonModalOpen(true);
  }

  function closeAttachmentCheckModal() {
    setIsAttachmentCheckOpen(false);
    setAttachmentCheckError(null);
    setAttachmentCheckResult(null);
  }

  async function handleRunAttachmentCheck() {
    if (!form || !submission) return;

    try {
      setIsAttachmentCheckOpen(true);
      setIsRunningAttachmentCheck(true);
      setAttachmentCheckError(null);
      setAttachmentCheckResult(null);

      const response = await fetch(`/api/forms/${encodeURIComponent(form.id)}/responses/${encodeURIComponent(submission.id)}/ai-review/attachment-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: form.tenantId,
        }),
      });

      if (!response.ok) {
        const responseText = await response.text();
        let errorMessage = `Failed to run attachment check (HTTP ${response.status})`;

        if (responseText) {
          try {
            const errorData = JSON.parse(responseText) as { error?: string };
            if (errorData.error) {
              errorMessage = errorData.error;
            }
          } catch {
            if (response.status === 504) {
              errorMessage = 'Attachment check timed out before the server returned a response';
            }
          }
        }

        throw new Error(errorMessage);
      }

      const data = await response.json() as AttachmentCheckResult;
      setAttachmentCheckResult(data);
      success('Attachment check completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to run attachment check';
      setAttachmentCheckError(message);
      setAttachmentCheckResult(null);
      showError(message);
    } finally {
      setIsRunningAttachmentCheck(false);
    }
  }

  if (isFormLoading || isResponseLoading) {
    return (
      <div className="min-h-screen bg-background-primary">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">
          <div className="h-28 animate-pulse rounded-2xl border border-border-primary bg-background-secondary sm:rounded-3xl" />
          <div className="h-24 animate-pulse rounded-2xl border border-border-primary bg-background-secondary sm:rounded-3xl" />
          <div className="h-64 animate-pulse rounded-2xl border border-border-primary bg-background-secondary sm:rounded-3xl" />
        </div>
      </div>
    );
  }

  if (formError || !form) {
    return (
      <div className="min-h-screen bg-background-primary">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">
          <Alert variant="error" title="Form not found">
            {formError instanceof Error ? formError.message : 'This form could not be loaded.'}
          </Alert>
        </div>
      </div>
    );
  }

  if (responseError || !submission) {
    return (
      <div className="min-h-screen bg-background-primary">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">
          <Alert variant="error" title="Submission not found">
            {responseError instanceof Error ? responseError.message : 'This submission could not be loaded.'}
          </Alert>
        </div>
      </div>
    );
  }

  const tenantQuery = form!.tenantId ? `?tenantId=${encodeURIComponent(form!.tenantId)}` : '';

  function getUploadHref(uploadId: string): string {
    return `/api/forms/${encodeURIComponent(form!.id)}/responses/${encodeURIComponent(submission!.id)}/uploads/${encodeURIComponent(uploadId)}${tenantQuery}`;
  }

  function getExportPdfHref(): string {
    return `/api/forms/${encodeURIComponent(form!.id)}/responses/${encodeURIComponent(submission!.id)}/export/pdf${tenantQuery}`;
  }

  function renderFieldCard(field: FormField, value: unknown, copyKey: string, fieldKey: string) {
    const widthClass = WIDTH_CLASS[field.layoutWidth] || WIDTH_CLASS[100];
    const copyValue = field.type === 'FILE_UPLOAD'
      ? (() => {
        const ids = toUploadIds(value);
        if (ids.length === 0) return null;
        return ids.map((id) => uploadsById.get(id)?.fileName || id).join('\n');
      })()
      : toCopyValue(field, value);

    return (
      <div key={fieldKey} className={widthClass}>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label className="block text-xs font-medium text-text-secondary">
            {field.label || field.key}
          </label>
          {copyValue && (
            <button
              type="button"
              onClick={() => void handleCopyValue(copyKey, copyValue)}
              className="inline-flex items-center gap-1 rounded border border-border-primary px-2 py-1 text-2xs text-text-secondary hover:bg-background-primary hover:text-text-primary"
              aria-label={`Copy value for ${field.label || field.key}`}
            >
              {recentlyCopiedKey === copyKey ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </button>
          )}
        </div>

        {field.subtext && (
          <p className="mb-1.5 text-xs text-text-muted">{field.subtext}</p>
        )}

        {(field.type === 'SHORT_TEXT' || field.type === 'DROPDOWN' || field.type === 'SINGLE_CHOICE') && (
          <div className="rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary">
            {isEmptyValue(value) ? (
              <span className="text-text-muted">-</span>
            ) : (
              field.type === 'SINGLE_CHOICE'
                ? (formatResponseFieldValue(field, value) || <span className="text-text-muted">-</span>)
                : (formatResponseFieldValue(field, value) || <span className="text-text-muted">-</span>)
            )}
          </div>
        )}

        {field.type === 'LONG_TEXT' && (
          <div className="min-h-24 rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary whitespace-pre-wrap">
            {formatResponseFieldValue(field, value) || <span className="text-text-muted">-</span>}
          </div>
        )}

        {field.type === 'MULTIPLE_CHOICE' && (
          <div className="min-h-10 rounded-lg border border-border-primary bg-background-primary px-3 py-2">
            {formatResponseFieldValue(field, value) ? (
              <span className="text-sm text-text-primary">{formatResponseFieldValue(field, value)}</span>
            ) : (
              <span className="text-sm text-text-muted">-</span>
            )}
          </div>
        )}

        {field.type === 'FILE_UPLOAD' && (
          <div className="rounded-lg border border-border-primary bg-background-primary px-3 py-2">
            {(() => {
              const uploadIds = toUploadIds(value);
              if (uploadIds.length === 0) {
                return <span className="text-sm text-text-muted">-</span>;
              }

              return (
                <div className="space-y-1.5">
                  {uploadIds.map((uploadId, index) => {
                    const upload = uploadsById.get(uploadId);
                    if (!upload) {
                      return (
                        <div key={`${fieldKey}-upload-${index}`} className="text-sm text-text-primary break-all">
                          {uploadId}
                        </div>
                      );
                    }

                    return (
                      <div key={`${fieldKey}-${upload.id}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <a
                          href={getUploadHref(upload.id)}
                          className="max-w-full break-all text-text-primary underline hover:text-text-secondary"
                        >
                          {upload.fileName}
                        </a>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-text-muted">{formatFileSize(upload.sizeBytes)}</span>
                          <button
                            type="button"
                            onClick={() => setUploadToDelete(upload)}
                            className="inline-flex items-center gap-1 rounded border border-border-primary px-2 py-1 text-2xs text-text-secondary hover:bg-background-elevated hover:text-text-primary"
                            aria-label={`Delete attachment ${upload.fileName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {field.type === 'SIGNATURE' && (
          (() => {
            const signatureDataUrl = extractSignatureDataUrl(value);
            return (
              <div className="rounded-lg border border-border-primary bg-white p-3">
                {signatureDataUrl ? (
                  // Signature payload is expected to be a data URL produced by the form signer.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={signatureDataUrl}
                    alt={`${field.label || field.key} signature`}
                    className="mx-auto max-h-44 w-auto max-w-full rounded object-contain"
                  />
                ) : (
                  <div className="py-3 text-center text-sm text-text-muted">No signature provided</div>
                )}
              </div>
            );
          })()
        )}

        {!['SHORT_TEXT', 'DROPDOWN', 'SINGLE_CHOICE', 'LONG_TEXT', 'MULTIPLE_CHOICE', 'FILE_UPLOAD', 'SIGNATURE', 'COMPANY_NAME_CHECK'].includes(field.type) && (
          <div className="rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary">
            {formatResponseFieldValue(field, value) || <span className="text-text-muted">-</span>}
          </div>
        )}

        {field.type === 'COMPANY_NAME_CHECK' && (() => {
          const checkResult = getSubmissionNameCheckResult(submission?.metadata, field.key);
          return (
            <div className="space-y-1.5">
              <div className="rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary">
                {formatResponseFieldValue(field, value) || <span className="text-text-muted">-</span>}
              </div>
              {checkResult && (() => {
                const described = describeNameCheckAssessment(checkResult.assessment);
                const reasons = checkResult.reasonCodes
                  .map((code) => describeNameCheckReason(code))
                  .filter((reason): reason is string => !!reason);
                return (
                  <div
                    className={
                      described.tone === 'success'
                        ? 'rounded-lg border border-status-success/40 bg-status-success/10 px-3 py-2 text-xs text-status-success'
                        : 'rounded-lg border border-status-warning/50 bg-status-warning/10 px-3 py-2 text-xs text-status-warning'
                    }
                  >
                    <p className="font-medium">{described.title}</p>
                    {reasons.length > 0 && (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {reasons.map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    )}
                    {checkResult.records.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {checkResult.records.map((record, index) => (
                          <li key={`${record.uen || 'record'}-${index}`}>
                            {record.entityName || '-'}
                            {record.uen ? ` (${record.uen})` : ''}
                            {record.entityStatus ? ` — ${record.entityStatus}` : ''}
                            {record.matchType === 'IDENTICAL' ? ' · identical' : record.matchType === 'SIMILAR_WARNING' ? ' · similar' : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-2xs text-text-muted">
                      {checkResult.source === 'server' ? 'Rechecked on submission' : 'Checked'} {new Date(checkResult.checkedAt).toLocaleString('en-SG')}
                      {checkResult.dataAsOf ? ` · data as of ${checkResult.dataAsOf}` : ''}
                    </p>
                  </div>
                );
              })()}
            </div>
          );
        })()}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-primary">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:gap-6 sm:p-6">

      {/* Header */}
      <section className="rounded-2xl border border-oak-primary/20 bg-gradient-to-br from-oak-primary/[0.06] to-background-secondary p-4 shadow-sm sm:rounded-3xl sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-1">
            <Link
              href={`/forms/${form.id}/responses`}
              className="inline-flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to Responses
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-oak-primary/10 text-oak-primary">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-text-primary sm:text-2xl">Submission response</h1>
                <p className="text-sm text-text-secondary">{form.title}</p>
              </div>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                submission.status === 'COMPLETED'
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                  : submission.status === 'SPAM'
                  ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                  : 'bg-status-warning/10 text-status-warning'
              }`}>
                {submission.status.charAt(0) + submission.status.slice(1).toLowerCase()}
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
                Review
                <select
                  value={reviewStatus}
                  onChange={(event) => void handleReviewStatusChange(event.target.value as FormResponseReviewStatus)}
                  disabled={updateReviewStatusMutation.isPending}
                  className="h-7 rounded-md border border-border-primary bg-background-primary px-2 text-xs text-text-primary"
                >
                  {FORM_RESPONSE_REVIEW_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download className="h-4 w-4" />}
              onClick={() => window.open(getExportPdfHref(), '_blank', 'noopener,noreferrer')}
            >
              Export PDF
            </Button>
            <Button
              variant="danger"
              size="sm"
              leftIcon={<Trash2 className="h-4 w-4" />}
              onClick={() => setIsDeleteResponseConfirmOpen(true)}
            >
              Delete
            </Button>
          </div>
        </div>
      </section>

      {hasUnresolvedAiWarning && aiReview && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/80 p-4 sm:rounded-3xl sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                AI warning requires review
              </div>
              <p className="mt-1 text-sm text-amber-950/80">
                Resolve hides this warning banner until AI flags a new issue on a later review.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isResolvedAiCard && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={isResolvedAiExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  onClick={() => setIsResolvedAiExpanded((current) => !current)}
                >
                  {isResolvedAiExpanded ? 'Collapse' : 'Show details'}
                </Button>
              )}
              {aiSettings.enabled && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<RefreshCw className={`h-4 w-4 ${isRerunningAiReview ? 'animate-spin' : ''}`} />}
                  onClick={handleRerunAiReview}
                  isLoading={isRerunningAiReview}
                  disabled={isRerunningAiReview}
                >
                  Rerun AI review
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRunAttachmentCheck}
                isLoading={isRunningAttachmentCheck}
                disabled={isRunningAttachmentCheck || uploadCount === 0}
              >
                Test attachment read
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Check className="h-4 w-4" />}
                onClick={openResolveReasonModal}
                isLoading={isResolvingAiWarning}
                disabled={isResolvingAiWarning}
              >
                Resolve
              </Button>
            </div>
          </div>

          {aiReview.summary && (
            <p className="mt-3 text-sm text-amber-950">{aiReview.summary}</p>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 text-sm text-amber-950 lg:grid-cols-2">
            <div>
              <div className="text-2xs uppercase tracking-wide text-amber-900/70">Model</div>
              <div>{aiReview.model || '-'}</div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-wide text-amber-900/70">Processed</div>
              <div>{aiReview.processedAt ? formatDate(aiReview.processedAt) : '-'}</div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-wide text-amber-900/70">Severity</div>
              <div>{aiReview.severity ? aiReview.severity.toUpperCase() : '-'}</div>
            </div>
          </div>

          {renderAiReviewTags(aiReview.tags, 'warning')}
          {renderAiReviewSections(aiReview.sections, 'warning')}

          {(aiReview.unsupportedAttachmentNames.length > 0 || aiReview.omittedAttachmentNames.length > 0) && (
            <div className="mt-3 space-y-1 text-xs text-amber-950/80">
              {aiReview.unsupportedAttachmentNames.length > 0 && (
                <p>Unsupported attachments skipped: {aiReview.unsupportedAttachmentNames.join(', ')}</p>
              )}
              {aiReview.omittedAttachmentNames.length > 0 && (
                <p>Attachments omitted due to limits or read errors: {aiReview.omittedAttachmentNames.join(', ')}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Meta cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {([
          { label: 'Submitted', value: formatDate(submission.submittedAt), icon: CalendarDays },
          { label: 'Respondent', value: submission.respondentName || submission.respondentEmail || 'Anonymous', icon: User },
          { label: 'Attachments', value: formatAttachmentCount(uploadCount), icon: Paperclip },
          { label: 'Locale', value: (submission as Record<string, unknown>).locale as string || 'Default', icon: FileText },
        ] as const).map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm sm:rounded-3xl">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-oak-primary/10 text-oak-primary">
                <stat.icon className="h-3.5 w-3.5" />
              </div>
              <div className="text-xs font-medium text-text-secondary">{stat.label}</div>
            </div>
            <div className="mt-2 truncate text-sm font-medium text-text-primary">{stat.value}</div>
          </div>
        ))}
      </div>

      {(aiSettings.enabled || aiReview) && !hasUnresolvedAiWarning && (
        <div className={`rounded-2xl border p-4 shadow-sm sm:rounded-3xl sm:p-5 ${
          aiReview?.status === 'completed' && aiReview.reviewRequired
              ? 'border-border-primary bg-background-elevated'
            : aiReview?.status === 'failed'
              ? 'border-border-primary bg-background-elevated'
            : aiReview?.status === 'queued' || aiReview?.status === 'processing'
                ? 'border-sky-200 bg-sky-50/70'
              : 'border-emerald-200 bg-emerald-50/70'
        }`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <button
              type="button"
              className={`min-w-0 flex-1 text-left ${isResolvedAiCard ? 'rounded-md transition hover:bg-background-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/20' : ''}`}
              onClick={isResolvedAiCard ? () => setIsResolvedAiExpanded((current) => !current) : undefined}
              aria-expanded={isResolvedAiCard ? isResolvedAiExpanded : undefined}
            >
              <div className="text-2xs uppercase tracking-wide text-text-muted">AI review</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-text-primary">
                <span>
                  {!aiReview
                    ? 'AI review not started'
                    : aiReview.status === 'queued'
                      ? 'AI review queued'
                    : aiReview.status === 'processing'
                        ? 'AI review in progress'
                        : aiReview.status === 'failed'
                          ? 'AI review did not complete'
                          : aiReview.reviewRequired
                              ? 'Warning resolved'
                              : 'No AI warnings flagged'}
                </span>
                {isResolvedAiCard && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary">
                    {isResolvedAiExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {isResolvedAiExpanded ? 'Hide details' : 'Show details'}
                  </span>
                )}
              </div>
              {aiReview?.summary && (
                <p className="mt-1 text-sm text-text-secondary">{aiReview.summary}</p>
              )}
              {!hasUnresolvedAiWarning && aiReview?.resolvedAt && (
                <p className="mt-1 text-xs text-text-secondary">
                  Warning resolved on {formatDate(aiReview.resolvedAt)}
                </p>
              )}
            </button>
            <div className="flex items-center gap-2">
              {aiSettings.enabled && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<RefreshCw className={`h-4 w-4 ${isRerunningAiReview || aiReview?.status === 'processing' ? 'animate-spin' : ''}`} />}
                  onClick={handleRerunAiReview}
                  isLoading={isRerunningAiReview}
                  disabled={isRerunningAiReview || aiReview?.status === 'queued' || aiReview?.status === 'processing'}
                >
                  Rerun AI review
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRunAttachmentCheck}
                isLoading={isRunningAttachmentCheck}
                disabled={isRunningAttachmentCheck || uploadCount === 0}
              >
                Test attachment read
              </Button>
            </div>
          </div>

          {(!isResolvedAiCard || isResolvedAiExpanded) && (
            <>
              <div className="mt-3 grid grid-cols-1 gap-3 text-sm text-text-primary lg:grid-cols-2">
                <div>
                  <div className="text-2xs uppercase tracking-wide text-text-muted">Model</div>
                  <div>{aiReview?.model || '-'}</div>
                </div>
                <div>
                  <div className="text-2xs uppercase tracking-wide text-text-muted">
                    {aiReview?.status === 'queued' ? 'Queued' : aiReview?.status === 'processing' ? 'Started' : 'Processed'}
                  </div>
                  <div>
                    {aiReview?.status === 'queued'
                      ? (aiReview.queuedAt ? formatDate(aiReview.queuedAt) : '-')
                      : aiReview?.status === 'processing'
                        ? (aiReview.startedAt ? formatDate(aiReview.startedAt) : '-')
                        : aiReview?.processedAt
                          ? formatDate(aiReview.processedAt)
                          : '-'}
                  </div>
                </div>
                <div>
                  <div className="text-2xs uppercase tracking-wide text-text-muted">Severity</div>
                  <div>{aiReview?.severity ? aiReview.severity.toUpperCase() : '-'}</div>
                </div>
              </div>

              {aiReview && renderAiReviewTags(aiReview.tags, 'default')}
              {aiReview && isResolvedAiCard && renderAiResolutionSection(aiReview.resolvedReason, aiReview.resolvedAt)}
              {aiReview && renderAiReviewSections(aiReview.sections, 'default')}

              {aiReview && (aiReview.unsupportedAttachmentNames.length > 0 || aiReview.omittedAttachmentNames.length > 0 || aiReview.error) && (
                <div className="mt-3 space-y-1 text-xs text-text-secondary">
                  {aiReview.unsupportedAttachmentNames.length > 0 && (
                    <p>Unsupported attachments skipped: {aiReview.unsupportedAttachmentNames.join(', ')}</p>
                  )}
                  {aiReview.omittedAttachmentNames.length > 0 && (
                    <p>Attachments omitted due to limits or read errors: {aiReview.omittedAttachmentNames.join(', ')}</p>
                  )}
                  {aiReview.error && (
                    <p>AI error: {aiReview.error}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {isCompanyIncorporationResponse && (
        <CompanyIncorporationReviewPanel formId={form.id} submissionId={submission.id} />
      )}

      <div className="space-y-4">
        {responsePages.length === 0 && (
          <div className="rounded-2xl border border-border-primary bg-background-secondary p-6 text-center text-sm text-text-secondary shadow-sm sm:rounded-3xl">
            No visible fields to display for this submission.
          </div>
        )}

        {responsePages.map((page, pageIndex) => (
          <section key={`page-${pageIndex}`} className="overflow-hidden rounded-2xl border border-border-primary bg-background-secondary shadow-sm sm:rounded-3xl">
            {responsePages.length > 1 && (
              <div className="border-b border-border-primary px-4 py-3">
                <h2 className="text-sm font-semibold text-text-primary">Page {pageIndex + 1}</h2>
              </div>
            )}

            <div className="grid grid-cols-12 gap-3 p-4 sm:p-5">
              {page.items.map((item) => {
                if (item.kind === 'field') {
                  const value = submissionAnswers[item.field.key];
                  const copyKey = `${submission.id}:${item.field.key}`;
                  return renderFieldCard(item.field, value, copyKey, item.field.id);
                }

                return (
                  <div key={item.sectionId} className="col-span-12">
                    <div className="rounded-xl border border-border-primary bg-background-primary p-3 sm:p-4">
                      <div className="mb-3">
                        <h3 className="text-sm font-semibold text-text-primary">{item.title}</h3>
                        {item.hint && <p className="mt-1 text-xs text-text-secondary">{item.hint}</p>}
                      </div>

                      <div className="space-y-3">
                        {Array.from({ length: item.rowCount }).map((_, rowIndex) => {
                          const rowAnswers = buildRowAnswers(submissionAnswers, rowIndex);
                          const rowFields = item.fields.filter((sectionField) => (
                            isResponseAnswerField(sectionField) &&
                            evaluateCondition(sectionField.condition, rowAnswers, { fields: item.fields })
                          ));

                          if (rowFields.length === 0) return null;

                          return (
                            <div key={`${item.sectionId}-row-${rowIndex}`} className="rounded-lg border border-border-primary/60 bg-background-secondary p-3">
                              <div className="mb-2 text-xs font-medium text-text-secondary">Entry {rowIndex + 1}</div>
                              <div className="grid grid-cols-12 gap-3">
                                {rowFields.map((sectionField) => {
                                  const value = getRepeatRowValue(submissionAnswers[sectionField.key], rowIndex);
                                  const copyKey = `${submission.id}:${item.sectionId}:${rowIndex}:${sectionField.key}`;
                                  return renderFieldCard(
                                    sectionField,
                                    value,
                                    copyKey,
                                    `${sectionField.id}-${rowIndex}`
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <Modal
        isOpen={isResolveReasonModalOpen}
        onClose={() => {
          if (isResolvingAiWarning) return;
          setIsResolveReasonModalOpen(false);
          setResolveReason('');
        }}
        title="Resolve AI warning"
        description="Provide a reason for resolving this AI warning. The reason will be shown in the AI section for auditability."
        size="lg"
      >
        <ModalBody className="space-y-3">
          <label className="block text-sm font-medium text-text-primary" htmlFor="resolve-ai-reason">
            Resolution reason
          </label>
          <textarea
            id="resolve-ai-reason"
            value={resolveReason}
            onChange={(event) => setResolveReason(event.target.value)}
            placeholder="Explain why this warning was reviewed and resolved."
            className="min-h-32 w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary outline-none transition focus:border-border-strong focus:ring-2 focus:ring-oak-primary/20"
            maxLength={2000}
          />
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>Required. Stored with the resolved AI review.</span>
            <span>{resolveReason.trim().length}/2000</span>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setIsResolveReasonModalOpen(false);
              setResolveReason('');
            }}
            disabled={isResolvingAiWarning}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Check className="h-4 w-4" />}
            onClick={handleResolveAiWarning}
            isLoading={isResolvingAiWarning}
            disabled={isResolvingAiWarning || !resolveReason.trim()}
          >
            Resolve warning
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={isAttachmentCheckOpen}
        onClose={closeAttachmentCheckModal}
        title="AI attachment check"
        description="Uses the same model, connector, and attachment pipeline as form AI review, but asks only what the model can visibly read."
        size="4xl"
      >
        <ModalBody className="max-h-[75vh] space-y-4 overflow-y-auto">
          {isRunningAttachmentCheck && (
            <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-4 text-sm text-sky-900">
              Running attachment check...
            </div>
          )}

          {attachmentCheckError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {attachmentCheckError}
            </div>
          )}

          {attachmentCheckResult && (
            <>
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-border-primary bg-background-elevated p-3 text-sm text-text-primary sm:grid-cols-3">
                <div>
                  <div className="text-2xs uppercase tracking-wide text-text-muted">Model</div>
                  <div>{attachmentCheckResult.model}</div>
                </div>
                <div>
                  <div className="text-2xs uppercase tracking-wide text-text-muted">Provider</div>
                  <div>{attachmentCheckResult.provider}</div>
                </div>
                <div>
                  <div className="text-2xs uppercase tracking-wide text-text-muted">Attachments checked</div>
                  <div>{attachmentCheckResult.attachmentCount}</div>
                </div>
              </div>

              {attachmentCheckResult.summary && (
                <div className="rounded-lg border border-border-primary bg-background-elevated p-4 text-sm text-text-primary">
                  {attachmentCheckResult.summary}
                </div>
              )}

              {(attachmentCheckResult.unsupportedAttachmentNames.length > 0 || attachmentCheckResult.omittedAttachmentNames.length > 0) && (
                <div className="rounded-lg border border-border-primary bg-background-elevated p-4 text-sm text-text-secondary">
                  {attachmentCheckResult.unsupportedAttachmentNames.length > 0 && (
                    <p>Unsupported attachments skipped: {attachmentCheckResult.unsupportedAttachmentNames.join(', ')}</p>
                  )}
                  {attachmentCheckResult.omittedAttachmentNames.length > 0 && (
                    <p className={attachmentCheckResult.unsupportedAttachmentNames.length > 0 ? 'mt-2' : undefined}>
                      Attachments omitted due to limits or read errors: {attachmentCheckResult.omittedAttachmentNames.join(', ')}
                    </p>
                  )}
                </div>
              )}

              {attachmentCheckResult.attachments.length === 0 && !isRunningAttachmentCheck && (
                <div className="rounded-lg border border-border-primary bg-background-elevated p-4 text-sm text-text-secondary">
                  No attachment diagnostics were returned.
                </div>
              )}

              <div className="space-y-3">
                {attachmentCheckResult.attachments.map((attachment) => (
                  <section key={`${attachment.attachmentIndex}-${attachment.fileName}`} className="rounded-lg border border-border-primary bg-background-elevated p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text-primary">{attachment.fileName}</div>
                        <div className="mt-1 text-xs text-text-secondary">
                          Attachment {attachment.attachmentIndex}
                          {attachment.fieldLabel ? ` • ${attachment.fieldLabel}` : ''}
                          {attachment.fieldKey ? ` (${attachment.fieldKey})` : ''}
                        </div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium uppercase ${getAttachmentReadabilityClasses(attachment.readability)}`}>
                        {attachment.readability}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 text-sm text-text-primary sm:grid-cols-2">
                      <div>
                        <div className="text-2xs uppercase tracking-wide text-text-muted">Document type</div>
                        <div>{attachment.documentType || '-'}</div>
                      </div>
                    </div>

                    {attachment.visibleTextSummary && (
                      <p className="mt-3 text-sm text-text-primary">{attachment.visibleTextSummary}</p>
                    )}

                    {attachment.extractedFields.length > 0 && (
                      <div className="mt-3 rounded-md border border-border-primary/70 bg-background-secondary/40 p-3">
                        <div className="text-2xs uppercase tracking-wide text-text-muted">Extracted fields</div>
                        <dl className="mt-2 space-y-2 text-sm text-text-primary">
                          {attachment.extractedFields.map((field, index) => (
                            <div key={`${attachment.attachmentIndex}-${index}`} className="grid gap-1 sm:grid-cols-[minmax(0,180px)_1fr] sm:gap-3">
                              <dt className="font-medium">{field.label}</dt>
                              <dd>{field.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}

                    {attachment.notes.length > 0 && (
                      <div className="mt-3 rounded-md border border-border-primary/70 bg-background-secondary/40 p-3">
                        <div className="text-2xs uppercase tracking-wide text-text-muted">Notes</div>
                        <ul className="mt-2 space-y-1 text-sm text-text-primary">
                          {attachment.notes.map((note, index) => (
                            <li key={`${attachment.attachmentIndex}-note-${index}`} className="flex gap-2">
                              <span className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
                              <span>{note}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={closeAttachmentCheckModal}>
            Close
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleRunAttachmentCheck}
            isLoading={isRunningAttachmentCheck}
            disabled={isRunningAttachmentCheck || uploadCount === 0}
          >
            Run check
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={isDeleteResponseConfirmOpen}
        onClose={() => setIsDeleteResponseConfirmOpen(false)}
        onConfirm={handleDeleteResponse}
        title="Delete response"
        description={`Are you sure you want to delete this response? This will also remove ${formatAttachmentCount(uploadCount)} linked to it. This action cannot be undone.`}
        confirmLabel="Delete response"
        isLoading={deleteResponseMutation.isPending}
      />

      <ConfirmDialog
        isOpen={!!uploadToDelete}
        onClose={() => setUploadToDelete(null)}
        onConfirm={handleDeleteUpload}
        title="Delete attachment"
        description={uploadToDelete ? `Are you sure you want to delete "${uploadToDelete.fileName}" from this response? This action cannot be undone.` : undefined}
        confirmLabel="Delete attachment"
        isLoading={deleteUploadMutation.isPending}
      />
      </div>
    </div>
  );
}
