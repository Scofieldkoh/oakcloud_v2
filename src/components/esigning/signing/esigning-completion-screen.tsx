'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, Download, ExternalLink, Loader2 } from 'lucide-react';
import type {
  EsigningCompletionDeliveryStatusDto,
  EsigningCopyDeliveryStatusDto,
} from '@/types/esigning';
import type { EsigningPostCompletionStatus } from '@/generated/prisma';
import { formatEsigningDateTime } from '@/components/esigning/esigning-shared';

interface EsigningCompletionScreenProps {
  envelopeTitle: string;
  recipientName: string;
  signedAt: string | null;
  isAllPartiesDone: boolean;
  remainingSignerCount: number;
  expiresAt: string | null;
  pdfGenerationStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | null;
  autoFilingStatus: EsigningPostCompletionStatus;
  completionDeliveryStatus: EsigningCompletionDeliveryStatusDto;
  currentRecipientDeliveryStatus: EsigningCopyDeliveryStatusDto;
  documents: Array<{ id: string; fileName: string; signedPdfUrl: string | null }>;
  downloadToken: string | null;
  certificateId: string;
}

export function EsigningCompletionScreen({
  envelopeTitle,
  recipientName,
  signedAt,
  isAllPartiesDone,
  remainingSignerCount,
  expiresAt,
  pdfGenerationStatus,
  currentRecipientDeliveryStatus,
  documents,
  certificateId,
}: EsigningCompletionScreenProps) {
  const signedDocs = documents.filter((d) => d.signedPdfUrl);
  const hasPendingSigners = !isAllPartiesDone && remainingSignerCount > 0;
  const isSignedCopyReady =
    isAllPartiesDone && pdfGenerationStatus === 'COMPLETED' && signedDocs.length > 0;
  const isSignedCopyPreparing =
    isAllPartiesDone &&
    (pdfGenerationStatus === 'PENDING' || pdfGenerationStatus === 'PROCESSING');
  const isSignedCopyFailed = isAllPartiesDone && pdfGenerationStatus === 'FAILED';

  function getCompletionCopyMessage(): string {
    if (currentRecipientDeliveryStatus === 'SENT') {
      return 'A completed copy of the signed documents has been emailed to you.';
    }
    if (currentRecipientDeliveryStatus === 'PENDING') {
      return 'A completed copy is being prepared and will be emailed to you.';
    }
    if (currentRecipientDeliveryStatus === 'RETRYING') {
      return 'We are retrying to send your completed copy. No action is needed.';
    }
    if (currentRecipientDeliveryStatus === 'FAILED') {
      return 'We could not email your completed copy. Please contact the sender.';
    }
    return 'The signed documents are available for download below.';
  }

  function getTimelineCompletionLabel(): string {
    if (currentRecipientDeliveryStatus === 'SENT') {
      return 'Completed — your copy has been sent';
    }
    if (
      currentRecipientDeliveryStatus === 'PENDING' ||
      currentRecipientDeliveryStatus === 'RETRYING'
    ) {
      return 'Completed — your copy is on its way';
    }
    if (currentRecipientDeliveryStatus === 'FAILED') {
      return 'Completed — copy delivery needs attention';
    }
    return 'Completed — signed documents ready';
  }

  return (
    <div className="min-h-screen bg-background-primary px-4 pt-8 pb-8 sm:pt-16 sm:pb-12">
      <div className="mx-auto w-full max-w-2xl">
        {/* Main card */}
        <div className="rounded-3xl border border-border-primary bg-background-secondary p-5 shadow-sm text-center sm:p-8">
          {/* Icon */}
          <div className="flex justify-center">
            <div
              className={
                isSignedCopyFailed
                  ? 'flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 border border-rose-200 sm:h-20 sm:w-20'
                  : 'flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 border border-emerald-200 sm:h-20 sm:w-20'
              }
            >
              {isSignedCopyFailed ? (
                <AlertTriangle className="h-8 w-8 text-rose-500 sm:h-10 sm:w-10" />
              ) : (
                <CheckCircle2 className="h-8 w-8 text-emerald-500 sm:h-10 sm:w-10" />
              )}
            </div>
          </div>

          {/* Title */}
          <h1 className="mt-6 text-xl font-semibold text-text-primary sm:text-2xl">
            {isAllPartiesDone ? 'Completed' : 'Your part is complete'}
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            {isAllPartiesDone
              ? getCompletionCopyMessage()
              : 'The sender has been notified. Waiting for other signers to complete their part.'}
          </p>
          {hasPendingSigners || expiresAt ? (
            <div className="mt-4 rounded-2xl border border-border-primary bg-background-primary px-4 py-3 text-left text-sm text-text-secondary">
              {hasPendingSigners ? (
                <p>
                  {remainingSignerCount} signer{remainingSignerCount === 1 ? '' : 's'} still need to
                  complete this envelope.
                </p>
              ) : null}
              {expiresAt ? (
                <p className={hasPendingSigners ? 'mt-1' : undefined}>
                  Envelope deadline: {formatEsigningDateTime(expiresAt)}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Envelope info */}
          <p className="mt-4 break-words text-xs text-text-muted">
            Envelope: <span className="font-medium text-text-secondary">{envelopeTitle}</span>
          </p>
          <p className="break-words text-xs text-text-muted">
            Recipient: <span className="font-medium text-text-secondary">{recipientName}</span>
          </p>
        </div>

        {/* Timeline */}
        <div className="mt-6 rounded-3xl border border-border-primary bg-background-secondary p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-text-primary">Signing Timeline</h2>
          <div className="relative pl-5">
            {/* Connecting line */}
            <div className="absolute left-[7px] top-2 h-[calc(100%-16px)] w-0.5 bg-border-primary" />

            {/* Step 1: Received */}
            <div className="relative mb-5 flex items-start gap-3">
              <div className="absolute -left-5 mt-0.5 h-3.5 w-3.5 rounded-full border-2 border-border-primary bg-background-tertiary" />
              <div>
                <p className="text-sm font-medium text-text-primary">
                  You received a request to sign
                </p>
                <p className="text-xs text-text-muted">Envelope sent by the sender</p>
              </div>
            </div>

            {/* Step 2: Signed */}
            <div className="relative mb-5 flex items-start gap-3">
              <div className="absolute -left-5 mt-0.5 h-3.5 w-3.5 rounded-full border-2 border-emerald-400 bg-emerald-400" />
              <div>
                <p className="text-sm font-medium text-text-primary">You signed</p>
                <p className="text-xs text-text-muted">{formatEsigningDateTime(signedAt)}</p>
              </div>
            </div>

            {/* Step 3: Completion status */}
            <div className="relative flex items-start gap-3">
              <div
                className={
                  isAllPartiesDone
                    ? 'absolute -left-5 mt-0.5 h-3.5 w-3.5 rounded-full border-2 border-emerald-400 bg-emerald-400'
                    : 'absolute -left-5 mt-0.5 h-3.5 w-3.5 rounded-full border-2 border-border-primary bg-background-tertiary'
                }
              />
              <div>
                <p className="text-sm font-medium text-text-primary">
                  {isAllPartiesDone
                    ? getTimelineCompletionLabel()
                    : 'Waiting for other signers'}
                </p>
                {!isAllPartiesDone && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                    <Clock className="h-3 w-3" />
                    Pending
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* PDF preparing state */}
        {isSignedCopyPreparing ? (
          <div className="mt-6 rounded-2xl border border-border-primary bg-background-primary px-5 py-4 text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin text-oak-primary" />
              <span>Preparing your signed document…</span>
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              This usually takes less than a minute. A copy will be emailed to you once ready.
            </p>
          </div>
        ) : null}

        {/* PDF failed state */}
        {isSignedCopyFailed ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-center">
            <div className="flex items-center justify-center gap-2 text-sm font-medium text-rose-700">
              <AlertTriangle className="h-4 w-4" />
              <span>Signed document could not be prepared</span>
            </div>
            <p className="mt-1.5 text-xs text-rose-600/80">
              Please contact the sender so they can resolve this and retry delivery.
            </p>
          </div>
        ) : null}

        {/* Action buttons */}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {isSignedCopyReady && signedDocs.map((doc) => (
            <a
              key={doc.id}
              href={doc.signedPdfUrl!}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl border border-oak-primary bg-oak-primary/5 px-5 py-2.5 text-sm font-medium text-oak-primary shadow-sm hover:bg-oak-primary/10 transition-colors"
            >
              <Download className="h-4 w-4" />
              {signedDocs.length > 1 ? `Save "${doc.fileName ?? 'Document'}"` : 'Save a Copy'}
            </a>
          ))}

          <Link
            href={`/verify/${certificateId}`}
            className="inline-flex items-center gap-2 rounded-2xl border border-border-primary bg-background-secondary px-5 py-2.5 text-sm font-medium text-text-primary shadow-sm hover:bg-background-tertiary transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            View Certificate
          </Link>
        </div>

        <p className="mt-6 text-center text-xs font-medium uppercase tracking-[0.16em] text-text-muted">
          Oaktree secure signing
        </p>
      </div>
    </div>
  );
}
