'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CalendarClock, ChevronLeft, Copy, ExternalLink, History, Paperclip } from 'lucide-react';
import type { FormField } from '@/generated/prisma';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import {
  useExtendFormDraftExpiry,
  useForm,
  useFormDraft,
  useFormDraftAuditLogs,
  useGenerateFormDraftResumeLink,
} from '@/hooks/use-forms';
import { copyTextToClipboard } from '@/lib/clipboard';
import { formatChoiceAnswer, isEmptyValue } from '@/lib/form-utils';

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

function toDateTimeLocalInputValue(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toAnswerRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function formatFieldValue(field: FormField, value: unknown): string {
  if (value === null || value === undefined || isEmptyValue(value)) return '-';

  if (field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE') {
    return formatChoiceAnswer(value) || '-';
  }

  if (field.type === 'SIGNATURE') {
    return typeof value === 'string' && value.trim().length > 0 ? 'Signed' : '-';
  }

  if (field.type === 'FILE_UPLOAD') {
    if (Array.isArray(value)) {
      return `${value.length} file${value.length === 1 ? '' : 's'}`;
    }

    return typeof value === 'string' && value.trim().length > 0 ? value : '-';
  }

  if (Array.isArray(value)) {
    const text = value.map((item) => String(item)).join(', ').trim();
    return text || '-';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '-';
    }
  }

  const text = String(value).trim();
  return text || '-';
}

export default function FormDraftDetailPage() {
  const params = useParams<{ id: string; draftId: string }>();
  const formId = params.id;
  const draftId = params.draftId;
  const { success, error: showError } = useToast();
  const [isExtendExpiryOpen, setIsExtendExpiryOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [draftExpiryInput, setDraftExpiryInput] = useState('');

  const {
    data: form,
    isLoading: isFormLoading,
    error: formError,
  } = useForm(formId);
  const {
    data: draftDetail,
    isLoading: isDraftLoading,
    error: draftError,
  } = useFormDraft(formId, draftId);
  const generateDraftResumeLinkMutation = useGenerateFormDraftResumeLink(formId);
  const extendDraftExpiryMutation = useExtendFormDraftExpiry(formId);
  const {
    data: draftAuditLogs,
    isLoading: isDraftAuditLoading,
    error: draftAuditError,
  } = useFormDraftAuditLogs(formId, draftId, isAuditOpen);

  if (isFormLoading || isDraftLoading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="h-10 w-72 animate-pulse rounded bg-background-tertiary mb-4" />
        <div className="h-64 animate-pulse rounded-lg border border-border-primary bg-background-elevated" />
      </div>
    );
  }

  if (formError || draftError || !form || !draftDetail) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {formError instanceof Error
            ? formError.message
            : draftError instanceof Error
              ? draftError.message
              : 'Draft not found'}
        </div>
      </div>
    );
  }

  const draft = draftDetail.draft;
  const answers = toAnswerRecord(draft.answers);
  const populatedFields = form.fields.filter((field) => !isEmptyValue(answers[field.key]));

  async function handleCopyDraftResumeLink() {
    try {
      const result = await generateDraftResumeLinkMutation.mutateAsync({
        draftId: draft.id,
        reason: 'Generated resume link from draft detail',
      });
      if (await copyTextToClipboard(result.resumeUrl)) {
        success('Draft resume link copied');
        return;
      }

      showError('Failed to copy draft resume link');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to copy draft resume link');
    }
  }

  function openExtendExpiryModal() {
    setDraftExpiryInput(toDateTimeLocalInputValue(draft.expiresAt));
    setIsExtendExpiryOpen(true);
  }

  async function handleExtendDraftExpiry() {
    const expiresAt = new Date(draftExpiryInput);
    if (!draftExpiryInput || Number.isNaN(expiresAt.getTime())) {
      showError('Choose a valid expiry date');
      return;
    }

    try {
      await extendDraftExpiryMutation.mutateAsync({
        draftId: draft.id,
        expiresAt: expiresAt.toISOString(),
        reason: 'Extended draft expiry from draft detail',
      });
      success('Draft expiry extended');
      setIsExtendExpiryOpen(false);
      setDraftExpiryInput('');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to extend draft expiry');
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <Link href={`/forms/${form.id}/responses`} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary">
            <ChevronLeft className="w-4 h-4" />
            Back to Responses
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-text-primary sm:text-2xl">
            Draft entry {draft.code}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Review saved answers and attachments for this draft entry.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Copy className="w-4 h-4" />}
            onClick={handleCopyDraftResumeLink}
            isLoading={generateDraftResumeLinkMutation.isPending}
          >
            Copy resume link
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<CalendarClock className="w-4 h-4" />}
            onClick={openExtendExpiryModal}
          >
            Extend expiry
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<History className="w-4 h-4" />}
            onClick={() => setIsAuditOpen(true)}
          >
            Audit log
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ExternalLink className="w-4 h-4" />}
            onClick={() => window.open(`/forms/${form.id}/responses`, '_blank', 'noopener,noreferrer')}
          >
            Open Responses
          </Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border-primary bg-background-elevated p-4">
          <div className="text-xs text-text-secondary">Last saved</div>
          <div className="mt-1 text-sm font-medium text-text-primary">{formatDate(draft.lastSavedAt)}</div>
        </div>
        <div className="rounded-lg border border-border-primary bg-background-elevated p-4">
          <div className="text-xs text-text-secondary">Expires</div>
          <div className="mt-1 text-sm font-medium text-text-primary">{formatDate(draft.expiresAt)}</div>
        </div>
        <div className="rounded-lg border border-border-primary bg-background-elevated p-4">
          <div className="text-xs text-text-secondary">Attachments</div>
          <div className="mt-1 text-sm font-medium text-text-primary">{draft.uploadCount}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border-primary bg-background-elevated overflow-hidden">
        <div className="border-b border-border-primary px-4 py-3">
          <div className="text-sm font-medium text-text-primary">Saved answers</div>
        </div>

        {populatedFields.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-secondary">
            No saved answers in this draft yet.
          </div>
        ) : (
          <div className="divide-y divide-border-primary">
            {populatedFields.map((field) => (
              <div key={field.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[220px_1fr] sm:gap-4">
                <div className="text-sm font-medium text-text-primary">{field.label || field.key}</div>
                <div className="text-sm text-text-secondary whitespace-pre-wrap break-words">
                  {formatFieldValue(field, answers[field.key])}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-border-primary bg-background-elevated overflow-hidden">
        <div className="border-b border-border-primary px-4 py-3">
          <div className="text-sm font-medium text-text-primary">Attachments</div>
        </div>

        {draft.attachments.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-secondary">
            No attachments saved with this draft.
          </div>
        ) : (
          <div className="space-y-2 p-4">
            {draft.attachments.map((attachment) => {
              const href = form.tenantId
                ? `/api/forms/${encodeURIComponent(form.id)}/drafts/${encodeURIComponent(draft.id)}/uploads/${encodeURIComponent(attachment.id)}?tenantId=${encodeURIComponent(form.tenantId)}&disposition=inline`
                : `/api/forms/${encodeURIComponent(form.id)}/drafts/${encodeURIComponent(draft.id)}/uploads/${encodeURIComponent(attachment.id)}?disposition=inline`;

              return (
                <a
                  key={attachment.id}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-primary bg-background-primary px-3 py-2 hover:bg-background-elevated"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Paperclip className="h-4 w-4 text-text-muted" />
                      <p className="truncate text-sm font-medium text-text-primary">{attachment.fileName}</p>
                    </div>
                    <p className="text-xs text-text-secondary">{attachment.mimeType}</p>
                  </div>
                  <div className="shrink-0 text-xs text-text-muted">{formatDate(attachment.createdAt)}</div>
                </a>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        isOpen={isExtendExpiryOpen}
        onClose={() => {
          setIsExtendExpiryOpen(false);
          setDraftExpiryInput('');
        }}
        title="Extend draft expiry"
        description={`Set a later expiry date for draft ${draft.code}.`}
        size="sm"
      >
        <ModalBody className="space-y-3">
          <label htmlFor="draft-expiry" className="text-sm font-medium text-text-primary">
            New expiry date
          </label>
          <input
            id="draft-expiry"
            type="datetime-local"
            value={draftExpiryInput}
            onChange={(event) => setDraftExpiryInput(event.target.value)}
            className="w-full rounded-md border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-oak-primary"
          />
          <p className="text-xs text-text-secondary">
            Current expiry: {formatDate(draft.expiresAt)}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setIsExtendExpiryOpen(false);
              setDraftExpiryInput('');
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleExtendDraftExpiry}
            isLoading={extendDraftExpiryMutation.isPending}
          >
            Extend expiry
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={isAuditOpen}
        onClose={() => setIsAuditOpen(false)}
        title="Draft audit log"
        description={`Activity for draft ${draft.code}.`}
        size="lg"
      >
        <ModalBody className="space-y-3">
          {isDraftAuditLoading ? (
            <p className="text-sm text-text-secondary">Loading audit log...</p>
          ) : draftAuditError instanceof Error ? (
            <p className="text-sm text-status-error">{draftAuditError.message}</p>
          ) : !draftAuditLogs || draftAuditLogs.length === 0 ? (
            <p className="text-sm text-text-secondary">No audit log entries found for this draft.</p>
          ) : (
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {draftAuditLogs.map((log) => {
                const actor = log.user
                  ? `${log.user.firstName} ${log.user.lastName}`.trim() || log.user.email
                  : 'System / public respondent';
                const metadataText = log.metadata && typeof log.metadata === 'object'
                  ? JSON.stringify(log.metadata, null, 2)
                  : '';

                return (
                  <div key={log.id} className="rounded-lg border border-border-primary bg-background-primary p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-text-primary">{log.summary || log.action}</p>
                        <p className="text-xs text-text-secondary">{formatDate(log.createdAt)}</p>
                      </div>
                      <span className="inline-flex w-fit rounded-full bg-background-tertiary px-2 py-0.5 text-2xs font-medium text-text-secondary">
                        {log.action}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-text-secondary sm:grid-cols-2">
                      <div>Actor: {actor}</div>
                      <div>IP: {log.ipAddress || '-'}</div>
                    </div>
                    {log.reason && (
                      <p className="mt-2 text-xs text-text-secondary">Reason: {log.reason}</p>
                    )}
                    {metadataText && (
                      <pre className="mt-2 max-h-32 overflow-auto rounded bg-background-elevated p-2 text-2xs text-text-secondary">
                        {metadataText}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={() => setIsAuditOpen(false)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
