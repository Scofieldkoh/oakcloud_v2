'use client';

import { useEffect, useMemo, useState } from 'react';
import { Send, Copy, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { EsigningEnvelopeDetailDto, EsigningManualLinkDto } from '@/types/esigning';
import type { PlacedField } from './esigning-field-canvas';
import { Button } from '@/components/ui/button';
import {
  ESIGNING_ACCESS_MODE_LABELS,
  ESIGNING_RECIPIENT_TYPE_LABELS,
  ESIGNING_SIGNING_ORDER_LABELS,
  formatEsigningDateTime,
} from '@/components/esigning/esigning-shared';
import { useToast } from '@/components/ui/toast';
import { EsigningFieldCanvas } from './esigning-field-canvas';
import { EsigningPostItTab } from '../signing/esigning-post-it-tab';

interface EsigningStepReviewProps {
  envelope: EsigningEnvelopeDetailDto;
  fields: PlacedField[];
  onSend: () => Promise<void>;
  isSending: boolean;
  onBack: () => void;
  manualLinks: EsigningManualLinkDto[];
}

export function EsigningStepReview({
  envelope,
  fields,
  onSend,
  isSending,
  onBack,
  manualLinks,
}: EsigningStepReviewProps) {
  const toast = useToast();
  const [previewRecipientId, setPreviewRecipientId] = useState<string>('ALL');
  const [previewDocumentId, setPreviewDocumentId] = useState<string>(() => envelope.documents[0]?.id ?? '');
  const [previewPage, setPreviewPage] = useState(1);
  const [activePreviewFieldIndex, setActivePreviewFieldIndex] = useState(0);
  const signerRecipients = envelope.recipients.filter((r) => r.type === 'SIGNER');
  const activePreviewRecipientId = previewRecipientId || 'ALL';
  const previewFields = useMemo(
    () =>
      (activePreviewRecipientId === 'ALL'
        ? fields
        : fields.filter((field) => field.recipientId === activePreviewRecipientId)
      ).slice().sort((left, right) => {
        const leftDocumentIndex = envelope.documents.findIndex((document) => document.id === left.documentId);
        const rightDocumentIndex = envelope.documents.findIndex((document) => document.id === right.documentId);
        return (
          leftDocumentIndex - rightDocumentIndex
          || left.pageNumber - right.pageNumber
          || left.sortOrder - right.sortOrder
        );
      }),
    [activePreviewRecipientId, envelope.documents, fields]
  );
  const activePreviewField = previewFields[activePreviewFieldIndex] ?? null;

  useEffect(() => {
    setActivePreviewFieldIndex(0);
  }, [activePreviewRecipientId]);

  useEffect(() => {
    if (previewFields.length === 0) {
      setActivePreviewFieldIndex(0);
      return;
    }
    setActivePreviewFieldIndex((current) => Math.min(current, previewFields.length - 1));
  }, [previewFields.length]);

  function goToPreviewField(index: number) {
    if (previewFields.length === 0) return;
    const nextIndex = ((index % previewFields.length) + previewFields.length) % previewFields.length;
    const field = previewFields[nextIndex];
    setActivePreviewFieldIndex(nextIndex);
    if (field.documentId !== previewDocumentId) {
      setPreviewDocumentId(field.documentId);
    }
    setPreviewPage(field.pageNumber);
  }

  function getPreviewFieldLabel(field: PlacedField | null): string {
    if (!field) return 'Field';
    if (field.type === 'SIGNATURE') return 'Sign';
    if (field.type === 'INITIALS') return 'Initial';
    if (field.type === 'DATE_SIGNED') return 'Date';
    if (field.type === 'CHECKBOX') return 'Check';
    return 'Fill';
  }

  const fieldSummaryByRecipient = new Map(
    signerRecipients.map((recipient) => {
      const recipientFields = fields.filter((field) => field.recipientId === recipient.id);
      const activeDocIds = [...new Set(recipientFields.map((f) => f.documentId))];
      const hasSignatureOnAllDocs =
        activeDocIds.length > 0 &&
        activeDocIds.every((docId) =>
          recipientFields.some((f) => f.documentId === docId && (f.type === 'SIGNATURE' || f.type === 'INITIALS'))
        );
      return [
        recipient.id,
        {
          totalCount: recipientFields.length,
          requiredCount: recipientFields.filter((field) => field.required).length,
          signatureCount: recipientFields.filter(
            (field) => field.type === 'SIGNATURE' || field.type === 'INITIALS'
          ).length,
          hasSignatureOnAllDocs,
        },
      ];
    })
  );

  // Validation — signature requirement is per-document: each document with fields for a signer needs a sig field
  const blockingIssues: string[] = [];
  if (envelope.documents.length === 0) blockingIssues.push('Upload at least one document');
  if (signerRecipients.length === 0) blockingIssues.push('Add at least one signer');
  signerRecipients.forEach((r) => {
    const summary = fieldSummaryByRecipient.get(r.id);
    if (!summary || summary.totalCount === 0) {
      blockingIssues.push(`${r.name} has no fields assigned`);
    } else {
      const recipientFields = fields.filter((f) => f.recipientId === r.id);
      const activeDocIds = [...new Set(recipientFields.map((f) => f.documentId))];
      const docsWithoutSig = activeDocIds.filter(
        (docId) => !recipientFields.some((f) => f.documentId === docId && (f.type === 'SIGNATURE' || f.type === 'INITIALS'))
      );
      if (docsWithoutSig.length > 0) {
        const docNames = docsWithoutSig
          .map((docId) => envelope.documents.find((d) => d.id === docId)?.fileName ?? docId)
          .map((name) => `"${name}"`)
          .join(', ');
        blockingIssues.push(`${r.name} has no signature field on ${docsWithoutSig.length === 1 ? 'document' : 'documents'} ${docNames}`);
      }
    }
    if (r.accessMode === 'EMAIL_WITH_CODE' && !r.hasAccessCode) {
      blockingIssues.push(`${r.name} requires an access code`);
    }
  });

  const isReady = blockingIssues.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-testid="esigning-review-layout"
        className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[25%_75%]"
      >
        <div
          data-testid="esigning-review-info-panel"
          id="review-summary"
          className="min-h-0 overflow-y-auto border-b border-border-primary p-4 sm:p-6 lg:border-b-0 lg:border-r"
        >
          <div className="space-y-4 sm:space-y-6">
        {/* Validation panel — shown at top so issues are immediately visible */}
        {!isReady && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <span className="text-sm font-semibold text-amber-800">Resolve before sending</span>
            </div>
            <ul className="list-disc list-inside space-y-1">
              {blockingIssues.map((issue, i) => (
                <li key={i} className="text-sm text-amber-700">{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Envelope summary card */}
        <section className="rounded-xl border border-border-primary bg-background-secondary p-4">
          <p className="text-xs font-medium text-text-muted">Envelope name</p>
          <h1 className="mt-1 break-words text-lg font-semibold text-text-primary">{envelope.title}</h1>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-primary pt-3">
            <span className="text-xs text-text-secondary">Signing method</span>
            <span className="inline-flex items-center rounded-full bg-oak-primary/10 px-2.5 py-1 text-xs font-medium text-oak-primary">
              {ESIGNING_SIGNING_ORDER_LABELS[envelope.signingOrder]}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {envelope.companyName && (
              <span className="text-sm text-text-secondary">{envelope.companyName}</span>
            )}
            {envelope.expiresAt && (
              <span className="text-sm text-text-secondary">
                Expires {formatEsigningDateTime(envelope.expiresAt)}
              </span>
            )}
            {envelope.reminderFrequencyDays && (
              <span className="text-sm text-text-secondary">
                Reminders every {envelope.reminderFrequencyDays} day{envelope.reminderFrequencyDays === 1 ? '' : 's'}
                {typeof envelope.reminderStartDays === 'number'
                  ? ` after ${envelope.reminderStartDays} day${envelope.reminderStartDays === 1 ? '' : 's'}`
                  : ''}
              </span>
            )}
            {typeof envelope.expiryWarningDays === 'number' && envelope.expiryWarningDays > 0 && (
              <span className="text-sm text-text-secondary">
                Sender warned {envelope.expiryWarningDays} day{envelope.expiryWarningDays === 1 ? '' : 's'} before expiry
              </span>
            )}
          </div>
          {envelope.message && (
            <p className="mt-4 rounded-2xl border border-border-primary bg-background-primary p-4 text-sm text-text-secondary whitespace-pre-wrap">
              {envelope.message}
            </p>
          )}
        </section>

        {/* Signers section */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-text-primary">Signers</h2>
          <div className="space-y-3">
            {signerRecipients.map((r, idx) => {
              const summary = fieldSummaryByRecipient.get(r.id) ?? {
                totalCount: 0,
                requiredCount: 0,
                signatureCount: 0,
                hasSignatureOnAllDocs: false,
              };
              const hasIssue = summary.totalCount === 0 || !summary.hasSignatureOnAllDocs;
              const isSequential = envelope.signingOrder === 'SEQUENTIAL';

              return (
                <div
                  key={r.id}
                  className="rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm"
                  style={{ borderLeftColor: r.colorTag, borderLeftWidth: 3 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      {isSequential && (
                        <span
                          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                          style={{ backgroundColor: r.colorTag }}
                        >
                          {idx + 1}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-text-primary">{r.name}</span>
                          {isSequential && (
                            <span className="text-xs text-text-muted">
                              Signs {idx === 0 ? '1st' : idx === 1 ? '2nd' : idx === 2 ? '3rd' : `${idx + 1}th`}
                            </span>
                          )}
                          <span className="inline-flex items-center rounded-full border border-border-primary px-2 py-0.5 text-xs text-text-secondary">
                            {ESIGNING_RECIPIENT_TYPE_LABELS[r.type]}
                          </span>
                        </div>
                        <div className="mt-0.5 text-sm text-text-secondary">{r.email}</div>
                        <div className="mt-0.5 text-xs text-text-muted">
                          {ESIGNING_ACCESS_MODE_LABELS[r.accessMode]}
                        </div>
                        <div className="mt-1 text-xs text-text-secondary">
                          {summary.requiredCount} required field{summary.requiredCount !== 1 ? 's' : ''} · {summary.signatureCount} signature{summary.signatureCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {hasIssue ? (
                        <div className="flex items-center gap-1.5 text-amber-600">
                          <AlertTriangle className="h-4 w-4" />
                          <span className="text-xs font-medium">Needs attention</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-emerald-600">
                          <CheckCircle2 className="h-4 w-4" />
                          <span className="text-xs font-medium">Ready</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Documents section */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-text-primary">Documents</h2>
          <div className="space-y-2">
            {envelope.documents.map((doc) => {
              const fieldCount = fields.filter((f) => f.documentId === doc.id).length;
              return (
                <div
                  key={doc.id}
                  className="flex flex-col gap-2 rounded-2xl border border-border-primary bg-background-secondary px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-text-primary">{doc.fileName}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-text-muted">{doc.pageCount} page{doc.pageCount === 1 ? '' : 's'}</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                        fieldCount > 0
                          ? 'border-oak-primary/20 bg-oak-primary/10 text-oak-primary'
                          : 'border-border-primary bg-background-tertiary text-text-muted'
                      }`}
                    >
                      {fieldCount} field{fieldCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Ready banner */}
        {isReady && (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-600" />
            <span className="text-sm font-medium text-emerald-800">
              Ready to send — all requirements are met.
            </span>
          </div>
        )}

        {/* Manual links */}
        {manualLinks.length > 0 && (
          <section>
            <h2 className="mb-3 text-base font-semibold text-text-primary">Manual Signing Links</h2>
            <div className="space-y-3">
              {manualLinks.map((link) => (
                <div
                  key={link.recipientId}
                  className="rounded-2xl border border-border-primary bg-background-secondary p-4"
                >
                  <div className="text-sm font-semibold text-text-primary">{link.recipientName}</div>
                  <div className="mt-0.5 text-xs text-text-secondary">{link.recipientEmail || 'No email — manual link only'}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href={link.signingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 rounded-xl border border-border-primary bg-background-primary px-3 py-2 text-xs text-text-secondary truncate"
                    >
                      {link.signingUrl}
                    </a>
                    <Button
                      variant="secondary"
                      size="xs"
                      leftIcon={<Copy className="h-3.5 w-3.5" />}
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(link.signingUrl)
                          .then(() => toast.success('Link copied'))
                          .catch(() => toast.error('Clipboard access failed'))
                      }
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

          </div>
        </div>

        <section
          data-testid="esigning-review-viewer-panel"
          className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden bg-background-secondary lg:min-h-0"
        >
          {signerRecipients.length > 0 && envelope.documents.length > 0 ? (
            <>
            <div className="flex flex-col gap-4 px-4 pt-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pt-5">
              <div>
                <h2 className="text-base font-semibold text-text-primary">Preview as signer</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Review what each signer will see before the envelope is sent.
                </p>
              </div>
              <label className="flex flex-col gap-1 text-xs text-text-secondary">
                Signer
                <select
                  value={activePreviewRecipientId}
                  onChange={(event) => setPreviewRecipientId(event.target.value)}
                   className="h-10 w-full rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary sm:min-w-52"
                >
                  <option value="ALL">All Signers</option>
                  {signerRecipients.map((recipient) => (
                    <option key={recipient.id} value={recipient.id}>
                      {recipient.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="min-h-0 flex-1 border-t border-border-primary">
              <div className="relative h-full min-h-0 mr-14">
                <div className="h-full min-h-0 overflow-hidden">
                  <EsigningFieldCanvas
                    documents={envelope.documents}
                    selectedDocumentId={previewDocumentId}
                    onDocumentChange={(documentId) => {
                      setPreviewDocumentId(documentId);
                      setPreviewPage(1);
                      const nextFieldIndex = previewFields.findIndex(
                        (field) => field.documentId === documentId
                      );
                      if (nextFieldIndex >= 0) {
                        setActivePreviewFieldIndex(nextFieldIndex);
                      }
                    }}
                    fields={previewFields}
                    onFieldsChange={() => undefined}
                    selectedFieldId={activePreviewField?.localId ?? null}
                    onFieldSelect={() => undefined}
                    placementType={null}
                    placementRecipientId={activePreviewRecipientId}
                    recipients={envelope.recipients}
                    viewerPage={previewPage}
                    onPageChange={setPreviewPage}
                    canEdit={false}
                  />
                </div>
                {previewFields.length > 0 ? (
                  <EsigningPostItTab
                    label={getPreviewFieldLabel(activePreviewField)}
                    isComplete={false}
                    currentIndex={activePreviewFieldIndex}
                    totalCount={previewFields.length}
                    onClick={() => goToPreviewField(activePreviewFieldIndex)}
                    onNext={() => goToPreviewField(activePreviewFieldIndex + 1)}
                    onPrev={() => goToPreviewField(activePreviewFieldIndex - 1)}
                  />
                ) : null}
              </div>
            </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-text-secondary">
              Add at least one signer and document to preview the envelope.
            </div>
          )}
        </section>
      </div>

      {/* Sticky footer */}
      <div className="sticky bottom-0 bg-background-secondary border-t border-border-primary px-3 py-2 flex flex-wrap items-center justify-between gap-2 sm:px-6 sm:py-3 sm:gap-4">
        <Button variant="secondary" size="sm" onClick={onBack}>
          Back
        </Button>
        <span className="hidden text-sm text-text-secondary sm:inline">
          {envelope.documents.length} docs · {signerRecipients.length} signers ·{' '}
          {ESIGNING_SIGNING_ORDER_LABELS[envelope.signingOrder]}
        </span>
        <Button
          size="sm"
          onClick={() => void onSend()}
          isLoading={isSending}
          disabled={blockingIssues.length > 0}
          leftIcon={<Send className="h-4 w-4" />}
        >
          Send Envelope
        </Button>
      </div>
    </div>
  );
}
