'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  Download,
  FileSignature,
  MoreHorizontal,
  Send,
  Trash2,
} from 'lucide-react';
import type { EsigningEnvelopeEventAction } from '@/generated/prisma';
import type {
  EsigningEnvelopeDetailDto,
  EsigningEnvelopeEventDto,
} from '@/types/esigning';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import {
  CopyDeliveryStatusBadge,
  EnvelopeStatusBadge,
  ESIGNING_ACCESS_MODE_LABELS,
  ESIGNING_RECIPIENT_TYPE_LABELS,
  ESIGNING_SIGNING_ORDER_LABELS,
  formatEsigningDateTime,
  formatEsigningFileSize,
  PdfGenerationBadge,
  RecipientStatusBadge,
} from '@/components/esigning/esigning-shared';
import { cn } from '@/lib/utils';

type EnvelopeDownloadVariant =
  | 'documents'
  | 'documents_with_certificates'
  | 'certificates';
type DocumentDownloadVariant =
  | 'original'
  | 'signed'
  | 'signed_with_certificate';

interface Props {
  envelope: EsigningEnvelopeDetailDto;
  returnHref: string;
  canCreateEsigning: boolean;
  canUpdateEsigning: boolean;
  isDuplicating: boolean;
  isSending: boolean;
  recipientActionId: string | null;
  isCopyingRecipientLink: boolean;
  isResendingRecipient: boolean;
  onSend: () => void;
  onVoid: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRetryProcessing: () => void;
  onEditRecipient: (recipientId: string) => void;
  onRemoveRecipient: (recipientId: string) => void;
  onCopyRecipientLink: (recipientId: string) => void;
  onResendRecipient: (recipientId: string) => void;
  onEnvelopeDownload: (variant: EnvelopeDownloadVariant) => void;
  onDocumentDownload: (
    document: EsigningEnvelopeDetailDto['documents'][number],
    variant: DocumentDownloadVariant
  ) => void;
}

function formatEventAction(event: EsigningEnvelopeEventDto): string {
  const name = event.recipientName ?? 'Unknown';
  const metadata = event.metadata;
  if (event.action === 'REMINDER_SENT' && metadata?.kind === 'expiry_warning') {
    return 'Expiry warning sent to sender';
  }

  const labels: Partial<Record<EsigningEnvelopeEventAction, string>> = {
    CREATED: 'Envelope created',
    SENT: 'Sent for signing',
    VIEWED: `Viewed by ${name}`,
    CONSENTED: `Consent given by ${name}`,
    SIGNED: `Signed by ${name}`,
    COMPLETED: 'Envelope completed',
    DECLINED: `Declined by ${name}`,
    VOIDED: 'Envelope voided',
    CORRECTED: `Recipient corrected: ${name}`,
    EXPIRED: 'Envelope expired',
    REMINDER_SENT: `Reminder sent to ${name}`,
    PDF_GENERATION_FAILED: 'Document processing failed',
  };
  return labels[event.action] ?? event.action.replace(/_/g, ' ');
}

export function EsigningEnvelopeDetailView({
  envelope,
  returnHref,
  canCreateEsigning,
  canUpdateEsigning,
  isDuplicating,
  isSending,
  recipientActionId,
  isCopyingRecipientLink,
  isResendingRecipient,
  onSend,
  onVoid,
  onDuplicate,
  onDelete,
  onRetryProcessing,
  onEditRecipient,
  onRemoveRecipient,
  onCopyRecipientLink,
  onResendRecipient,
  onEnvelopeDownload,
  onDocumentDownload,
}: Props) {
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [activityRecipientId, setActivityRecipientId] = useState<string>('all');
  const activityRecipients = useMemo(() => {
    const recipientIdsWithActivity = new Set(
      envelope.events
        .map((event) => event.recipientId)
        .filter((recipientId): recipientId is string => Boolean(recipientId))
    );

    return envelope.recipients.filter((recipient) =>
      recipientIdsWithActivity.has(recipient.id)
    );
  }, [envelope.events, envelope.recipients]);
  const filteredEvents = useMemo(
    () =>
      activityRecipientId === 'all'
        ? envelope.events
        : envelope.events.filter((event) => event.recipientId === activityRecipientId),
    [activityRecipientId, envelope.events]
  );
  const visibleEvents = useMemo(
    () => (showAllActivity ? filteredEvents : filteredEvents.slice(0, 6)),
    [filteredEvents, showAllActivity]
  );
  const selectedActivityRecipient =
    activityRecipientId === 'all'
      ? null
      : envelope.recipients.find((recipient) => recipient.id === activityRecipientId) ?? null;
  const latestEmailFailure = envelope.emailDelivery.failures[0] ?? null;
  const signingModeLabel = `${ESIGNING_SIGNING_ORDER_LABELS[envelope.signingOrder]} signing`;
  const downloadsReady = envelope.pdfGenerationStatus === 'COMPLETED';
  const hasEnvelopeActions =
    (envelope.canDuplicate && canCreateEsigning) ||
    envelope.canDelete ||
    envelope.canRetryCompletionProcessing;

  return (
    <div className="min-h-screen min-w-0 overflow-x-hidden bg-background-primary">
      <div className="flex w-full min-w-0 max-w-[1600px] flex-col gap-3 p-3 sm:gap-5 sm:p-6">
        <div>
          <Link
            href={returnHref}
            className="inline-flex items-center gap-2 rounded-full border border-border-primary bg-background-secondary px-3 py-1.5 text-sm text-text-secondary hover:bg-background-tertiary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </div>

        <section
          data-testid="envelope-detail-header"
          className="min-w-0 rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm sm:p-6"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-oak-primary/10 text-oak-primary">
                  <FileSignature className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h1
                    className="break-words text-lg font-semibold leading-6 text-text-primary sm:text-2xl sm:leading-8"
                    title={envelope.title}
                  >
                    {envelope.title}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <EnvelopeStatusBadge status={envelope.status} />
                    <span className="inline-flex items-center rounded-full border border-border-primary bg-background-primary px-2.5 py-1 text-xs font-medium text-text-secondary">
                      {signingModeLabel}
                    </span>
                    {envelope.emailDelivery.status === 'failed' ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        Email failed
                      </span>
                    ) : null}
                    {envelope.pdfGenerationStatus &&
                    envelope.pdfGenerationStatus !== 'COMPLETED' ? (
                      <PdfGenerationBadge status={envelope.pdfGenerationStatus} />
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-text-secondary sm:text-sm">
                    <p>
                      Certificate{' '}
                      <span className="break-all font-medium text-text-primary">
                        {envelope.certificateId}
                      </span>
                    </p>
                    <p>Updated {formatEsigningDateTime(envelope.updatedAt)}</p>
                  </div>
                </div>
              </div>

              {envelope.pdfGenerationError ? (
                <Alert variant="warning" className="mt-4">
                  {envelope.pdfGenerationError}
                </Alert>
              ) : null}
              {latestEmailFailure ? (
                <Alert
                  variant="warning"
                  title="Some e-signing emails failed to send"
                  className="mt-4"
                >
                  Last failure: {latestEmailFailure.to} - {latestEmailFailure.error}
                </Alert>
              ) : null}
            </div>

            <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-2 [&>button]:max-w-full sm:w-auto sm:justify-end">
              {envelope.canSend && canUpdateEsigning ? (
                <Button
                  size="sm"
                  leftIcon={<Send className="h-4 w-4" />}
                  isLoading={isSending}
                  onClick={onSend}
                >
                  Send envelope
                </Button>
              ) : null}
              {envelope.canVoid && canUpdateEsigning ? (
                <Button size="sm" variant="secondary" onClick={onVoid}>
                  Void
                </Button>
              ) : null}
              {downloadsReady ? (
                <Dropdown>
                  <DropdownTrigger
                    className="whitespace-nowrap"
                    aria-label="Envelope download options"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download
                  </DropdownTrigger>
                  <DropdownMenu align="right">
                    <DropdownItem onClick={() => onEnvelopeDownload('documents')}>
                      Document only
                    </DropdownItem>
                    <DropdownItem
                      onClick={() =>
                        onEnvelopeDownload('documents_with_certificates')
                      }
                    >
                      Document + Certificate
                    </DropdownItem>
                    <DropdownItem onClick={() => onEnvelopeDownload('certificates')}>
                      Certificate only
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
              ) : null}

              {hasEnvelopeActions ? (
                <Dropdown>
                  <DropdownTrigger asChild aria-label="More envelope actions">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-primary bg-background-elevated text-text-secondary hover:bg-background-tertiary hover:text-text-primary">
                      <MoreHorizontal className="h-4 w-4" />
                    </span>
                  </DropdownTrigger>
                  <DropdownMenu align="right">
                    {envelope.canRetryCompletionProcessing ? (
                      <DropdownItem onClick={onRetryProcessing}>
                        {envelope.pdfGenerationStatus === 'FAILED'
                          ? 'Retry processing'
                          : 'Resume processing'}
                      </DropdownItem>
                    ) : null}
                    {envelope.canRetryCompletionProcessing &&
                    ((envelope.canDuplicate && canCreateEsigning) ||
                      envelope.canDelete) ? (
                      <DropdownSeparator />
                    ) : null}
                    {envelope.canDuplicate && canCreateEsigning ? (
                      <DropdownItem
                        icon={<Copy className="h-4 w-4" />}
                        disabled={isDuplicating}
                        onClick={onDuplicate}
                      >
                        Duplicate
                      </DropdownItem>
                    ) : null}
                    {envelope.canDelete ? (
                      <DropdownItem
                        destructive
                        icon={<Trash2 className="h-4 w-4" />}
                        onClick={onDelete}
                      >
                        Delete envelope
                      </DropdownItem>
                    ) : null}
                  </DropdownMenu>
                </Dropdown>
              ) : null}
            </div>
          </div>
        </section>

        <div className="grid min-w-0 gap-3 sm:gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)] lg:items-start">
          <div className="min-w-0 space-y-3 sm:space-y-5">
            <section
              data-testid="envelope-detail-recipients"
              className="min-w-0 rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-text-primary">Recipients</h2>
                <span className="text-sm tabular-nums text-text-muted">
                  {envelope.recipientCount}
                </span>
              </div>

              <div className="mt-3 divide-y divide-border-primary">
                {envelope.recipients.map((recipient) => (
                  <div
                    key={recipient.id}
                    data-testid="envelope-detail-recipient-row"
                    className="flex flex-col gap-2 py-3 first:pt-1 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: recipient.colorTag }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="break-words font-medium text-text-primary">
                          {recipient.name}
                        </div>
                        <div className="mt-1 break-all text-sm text-text-secondary">
                          {recipient.email || 'No email'}
                        </div>
                        <div className="mt-1 text-xs text-text-muted">
                          {ESIGNING_ACCESS_MODE_LABELS[recipient.accessMode]}
                          {envelope.signingOrder !== 'PARALLEL' &&
                          recipient.type === 'SIGNER' &&
                          recipient.signingOrder
                            ? ` · Signing order ${recipient.signingOrder}`
                            : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">
                      {recipient.type === 'CC' ? (
                        <CopyDeliveryStatusBadge
                          status={recipient.copyDeliveryStatus}
                        />
                      ) : (
                        <RecipientStatusBadge
                          status={recipient.status}
                          accessMode={recipient.accessMode}
                        />
                      )}
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
                          recipient.type === 'SIGNER'
                            ? 'border-oak-primary/20 bg-oak-primary/10 text-oak-primary'
                            : 'border-border-primary bg-background-primary text-text-secondary'
                        )}
                      >
                        {ESIGNING_RECIPIENT_TYPE_LABELS[recipient.type]}
                      </span>
                      {['SENT', 'IN_PROGRESS'].includes(envelope.status) &&
                      canUpdateEsigning &&
                      recipient.status !== 'SIGNED' &&
                      recipient.status !== 'DECLINED' ? (
                        <>
                          <Button size="xs" variant="secondary" onClick={() => onEditRecipient(recipient.id)}>
                            Edit
                          </Button>
                          {recipient.type === 'SIGNER' &&
                          ['NOTIFIED', 'VIEWED'].includes(recipient.status) ? (
                            <>
                              <Button
                                size="xs"
                                variant="secondary"
                                disabled={recipientActionId === recipient.id && isCopyingRecipientLink}
                                onClick={() => onCopyRecipientLink(recipient.id)}
                              >
                                Copy link
                              </Button>
                              <Button
                                size="xs"
                                variant="secondary"
                                disabled={recipientActionId === recipient.id && isResendingRecipient}
                                onClick={() => onResendRecipient(recipient.id)}
                              >
                                Resend
                              </Button>
                            </>
                          ) : null}
                          <Button
                            size="xs"
                            variant="danger"
                            onClick={() => onRemoveRecipient(recipient.id)}
                          >
                            Remove
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section
              data-testid="envelope-detail-documents"
              className="min-w-0 rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-text-primary">Documents</h2>
                <span className="text-sm tabular-nums text-text-muted">
                  {envelope.documentCount}
                </span>
              </div>

              <div className="mt-3 divide-y divide-border-primary">
                {envelope.documents.map((doc) => (
                  <div
                    key={doc.id}
                    data-testid="envelope-detail-document-row"
                    className="flex min-w-0 flex-col items-stretch gap-2 py-3 first:pt-1 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0">
                      <div
                        className="truncate font-medium text-text-primary"
                        title={doc.fileName}
                      >
                        {doc.fileName}
                      </div>
                      <div className="mt-1 text-xs text-text-secondary">
                        {doc.pageCount}{' '}
                        {doc.pageCount === 1 ? 'page' : 'pages'} ·{' '}
                        {formatEsigningFileSize(doc.fileSize)}
                      </div>
                    </div>

                    <Dropdown className="w-full shrink-0 sm:w-auto">
                      <DropdownTrigger
                        className="w-full justify-center whitespace-nowrap sm:w-auto"
                        aria-label={`Download options for ${doc.fileName}`}
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        Download
                      </DropdownTrigger>
                      <DropdownMenu align="right">
                        <DropdownItem
                          onClick={() => onDocumentDownload(doc, 'original')}
                        >
                          Original
                        </DropdownItem>
                        {doc.signedPdfUrl ? (
                          <DropdownItem onClick={() => onDocumentDownload(doc, 'signed')}>
                            Document only
                          </DropdownItem>
                        ) : null}
                        {envelope.status === 'COMPLETED' && doc.signedPdfUrl && downloadsReady ? (
                          <DropdownItem
                            onClick={() =>
                              onDocumentDownload(doc, 'signed_with_certificate')
                            }
                          >
                            Document + Certificate
                          </DropdownItem>
                        ) : null}
                      </DropdownMenu>
                    </Dropdown>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="min-w-0 lg:sticky lg:top-6">
            <section
              data-testid="envelope-detail-activity"
              className="min-w-0 rounded-2xl border border-border-primary bg-background-secondary p-4 shadow-sm sm:p-6"
            >
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-text-primary">Activity</h2>
                <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
                  {activityRecipients.length > 0 ? (
                    <Dropdown>
                      <DropdownTrigger
                        className="w-full max-w-full whitespace-nowrap text-xs sm:w-auto sm:max-w-[190px]"
                        aria-label="Filter activity by recipient"
                      >
                        <span className="truncate">
                          {selectedActivityRecipient?.name ?? 'All recipients'}
                        </span>
                      </DropdownTrigger>
                      <DropdownMenu align="right">
                        <DropdownItem
                          onClick={() => {
                            setActivityRecipientId('all');
                            setShowAllActivity(false);
                          }}
                        >
                          All recipients
                        </DropdownItem>
                        <DropdownSeparator />
                        {activityRecipients.map((recipient) => (
                          <DropdownItem
                            key={recipient.id}
                            onClick={() => {
                              setActivityRecipientId(recipient.id);
                              setShowAllActivity(false);
                            }}
                          >
                            {recipient.name}
                          </DropdownItem>
                        ))}
                      </DropdownMenu>
                    </Dropdown>
                  ) : null}

                  {filteredEvents.length > 6 ? (
                    <button
                      type="button"
                      onClick={() => setShowAllActivity((current) => !current)}
                      className="text-xs font-medium text-oak-primary hover:underline"
                    >
                      {showAllActivity
                        ? 'Collapse activity ↑'
                        : 'Show all activity →'}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="relative mt-4">
                <div className="absolute bottom-2 left-[7px] top-2 w-px bg-border-primary/70" />
                <div className="space-y-2.5">
                  {visibleEvents.map((event) => {
                    const isCompletion = event.action === 'COMPLETED';
                    return (
                      <div key={event.id} className="relative flex gap-3">
                        <div className="relative z-10 flex w-4 shrink-0 justify-center pt-1">
                          <div
                            className={cn(
                              'rounded-full border',
                              isCompletion
                                ? 'h-3.5 w-3.5 border-oak-primary bg-oak-primary ring-2 ring-oak-primary/10'
                                : 'h-2.5 w-2.5 border-border-secondary bg-background-secondary'
                            )}
                          />
                        </div>
                        <div
                          className={cn(
                            'min-w-0 flex-1 pb-2',
                            isCompletion && 'pb-3'
                          )}
                        >
                          <div
                            className={cn(
                              'break-words text-sm text-text-primary',
                              isCompletion ? 'font-semibold' : 'font-normal'
                            )}
                          >
                            {formatEventAction(event)}
                          </div>
                          <div className="mt-0.5 text-xs text-text-muted">
                            {formatEsigningDateTime(event.createdAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {filteredEvents.length === 0 ? (
                    <p className="pl-5 text-sm text-text-muted">
                      {selectedActivityRecipient
                        ? `No activity for ${selectedActivityRecipient.name}.`
                        : 'No activity yet.'}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
