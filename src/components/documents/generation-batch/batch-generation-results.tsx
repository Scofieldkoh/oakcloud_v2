'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SendForEsigningButton } from '@/components/esigning/send-for-esigning-button';
import { cn } from '@/lib/utils';
import type { EditableBatchItem } from './batch-workspace-state';
import { ITEM_STATUS_LABELS } from './batch-document-queue';

export interface BatchGenerationResultsProps {
  items: EditableBatchItem[];
  onRetry: (itemId: string) => void | Promise<void>;
  /** Retries every failed item in sequence. */
  onRetryAll?: () => void | Promise<void>;
  /** Downloads every successfully generated document as one ZIP archive. */
  onDownloadAll?: () => void | Promise<void>;
  /** Returns to the review stage without leaving the batch. */
  onBackToBatch?: () => void;
  pending?: boolean;
  downloadAllPending?: boolean;
}

export function BatchGenerationResults({
  items,
  onRetry,
  onRetryAll,
  onDownloadAll,
  onBackToBatch,
  pending = false,
  downloadAllPending = false,
}: BatchGenerationResultsProps) {
  const generated = items.filter((item) => item.status === 'GENERATED').length;
  const failedItems = items.filter((item) => item.status === 'FAILED');
  const skipped = items.length - generated - failedItems.length;
  const completed = items.length > 0 && generated === items.length;
  const generatedIds = items
    .filter((item) => item.status === 'GENERATED' && item.generatedDocumentId)
    .map((item) => item.generatedDocumentId!);

  return (
    <div className="space-y-4">
      <header
        className={cn(
          'rounded-lg border p-4',
          completed
            ? 'border-status-success/30 bg-status-success/5'
            : failedItems.length > 0
              ? 'border-status-warning/40 bg-status-warning/5'
              : 'border-border-primary bg-background-secondary',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text-primary">
              {completed ? 'Batch complete' : 'Generation results'}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {generated} generated
              {failedItems.length > 0 ? `, ${failedItems.length} failed` : ''}
              {skipped > 0 ? `, ${skipped} skipped` : ''}
              {' · '}{items.length} total
            </p>
            {completed && (
              <p className="mt-1 text-sm text-text-primary">
                All documents were generated successfully.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onBackToBatch && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onBackToBatch}
                leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
              >
                Back to batch
              </Button>
            )}
            {failedItems.length > 0 && onRetryAll && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onRetryAll()}
                disabled={pending}
                leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
              >
                Retry all failed ({failedItems.length})
              </Button>
            )}
            {generated > 0 && onDownloadAll && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onDownloadAll()}
                disabled={pending || downloadAllPending}
                isLoading={downloadAllPending}
                aria-label={`Download all ${generated} generated documents`}
                leftIcon={<Download className="h-4 w-4" aria-hidden="true" />}
              >
                Download all ({generated})
              </Button>
            )}
            {generatedIds.length > 0 && (
              <SendForEsigningButton
                generatedDocumentIds={generatedIds}
                includesDrafts
                label={generatedIds.length === 1 ? 'Send for e-signing' : `Send all for e-signing (${generatedIds.length})`}
                disabled={pending}
              />
            )}
            <Link href="/generated-documents">
              <Button variant={completed ? 'primary' : 'secondary'} size="sm">
                Generated documents
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <ul className="divide-y divide-border-secondary rounded-lg border border-border-primary bg-background-primary">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center gap-3 p-4">
            {item.status === 'GENERATED' ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-status-success" aria-hidden="true" />
            ) : item.status === 'FAILED' ? (
              <XCircle className="h-5 w-5 shrink-0 text-status-error" aria-hidden="true" />
            ) : (
              <span
                className="h-5 w-5 shrink-0 rounded-full border border-border-primary"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary">
                {item.generatedDocumentTitle
                  || item.configuration.title
                  || item.templateName}
              </p>
              <p className="text-xs text-text-muted">
                {item.templateName} · {ITEM_STATUS_LABELS[item.status]}
              </p>
              {item.status === 'FAILED' && item.lastError && (
                <p className="mt-1 text-sm text-status-error" role="alert">
                  {item.lastError.message}
                </p>
              )}
              {item.status !== 'GENERATED' && item.status !== 'FAILED' && (
                <p className="mt-1 text-xs text-text-muted">
                  This document did not run because it was not ready.
                </p>
              )}
            </div>
            {item.status === 'GENERATED' && item.generatedDocumentId && (
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={item.templateEngine === 'OAKDOC'
                    ? `/api/generated-documents/${item.generatedDocumentId}?format=docx`
                    : `/api/generated-documents/${item.generatedDocumentId}/export/pdf`}
                  className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
                  aria-label={`Download ${item.configuration.title || item.templateName} as ${item.templateEngine === 'OAKDOC' ? 'DOCX' : 'PDF'}`}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {item.templateEngine === 'OAKDOC' ? 'DOCX' : 'PDF'}
                </a>
                <Link
                  href={`/generated-documents/${item.generatedDocumentId}`}
                  className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-oak-primary transition-colors hover:text-oak-dark"
                  aria-label={`Open ${item.configuration.title || item.templateName}`}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open
                </Link>
              </div>
            )}
            {item.status === 'FAILED' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onRetry(item.key)}
                disabled={pending}
                aria-label={`Retry ${item.configuration.title || item.templateName}`}
                leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
              >
                Retry
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
