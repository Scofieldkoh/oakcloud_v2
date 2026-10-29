'use client';

import { AlertCircle, ArrowRight, Check, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BatchItemStatus } from '@/types/document-generation-batch';
import type { EditableBatchItem } from './batch-workspace-state';
import { completenessFor, type CompletenessMap } from './batch-completeness';

export const ITEM_STATUS_LABELS: Record<BatchItemStatus, string> = {
  NOT_STARTED: 'Not started',
  NEEDS_INPUT: 'Needs input',
  PREVIEWED: 'Awaiting review',
  READY: 'Ready',
  GENERATING: 'Generating',
  GENERATED: 'Generated',
  FAILED: 'Failed',
  BLOCKED: 'Blocked',
};

export interface BatchDocumentQueueProps {
  items: EditableBatchItem[];
  activeItemId: string | null;
  onSelect: (itemId: string) => void;
  disabled?: boolean;
  /** Derived required-value completeness, keyed by item key. */
  completeness?: CompletenessMap;
  /** Configure mode reports missing input; review mode reports approval. */
  mode?: 'configure' | 'review';
  onNextIncomplete?: () => void;
}

function statusToneClass(status: BatchItemStatus): string {
  switch (status) {
    case 'GENERATED':
    case 'READY':
      return 'bg-status-success/10 text-status-success';
    case 'FAILED':
      return 'bg-status-error/10 text-status-error';
    case 'BLOCKED':
      return 'bg-status-warning/10 text-status-warning';
    case 'GENERATING':
      return 'bg-oak-primary/10 text-oak-primary';
    default:
      return 'bg-background-tertiary text-text-secondary';
  }
}

export function BatchDocumentQueue({
  items,
  activeItemId,
  onSelect,
  disabled = false,
  completeness,
  mode = 'configure',
  onNextIncomplete,
}: BatchDocumentQueueProps) {
  const displayTitle = (item: EditableBatchItem) => mode === 'review'
    ? (item.status === 'GENERATED' || item.previewFingerprint
      ? item.generatedDocumentTitle || item.configuration.title || item.templateName
      : item.configuration.title || item.templateName)
    : item.configuration.title || item.templateName;

  const pendingCount = items.filter((item) => {
    if (item.status === 'GENERATED') return false;
    if (mode === 'review') return !item.reviewedFingerprint;
    return !completenessFor(completeness ?? {}, item.key).isComplete;
  }).length;

  const heading = mode === 'review' ? 'Review queue' : 'Document queue';
  const pendingLabel = mode === 'review'
    ? `${pendingCount} awaiting approval`
    : `${pendingCount} need input`;

  return (
    <nav aria-label={heading} className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-xs font-medium text-text-secondary">{heading}</h2>
        <p
          className={cn(
            'text-xs font-medium',
            pendingCount === 0 ? 'text-status-success' : 'text-status-warning',
          )}
          aria-live="polite"
        >
          {pendingCount === 0 ? 'All complete' : pendingLabel}
        </p>
      </div>

      {/* Compact switcher keeps the form above the fold on small screens. */}
      <label className="block lg:hidden">
        <span className="sr-only">Select document</span>
        <select
          value={activeItemId ?? ''}
          onChange={(event) => onSelect(event.target.value)}
          disabled={disabled}
          className="min-h-11 w-full rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
        >
          {items.map((item, index) => {
            const itemCompleteness = completenessFor(completeness ?? {}, item.key);
            const suffix = item.status === 'GENERATED'
              ? 'generated'
              : mode === 'review'
                ? item.reviewedFingerprint ? 'approved' : 'not approved'
                : itemCompleteness.isComplete
                  ? 'complete'
                  : `${itemCompleteness.missing.length} missing`;
            return (
              <option key={item.key} value={item.key}>
                {index + 1}. {displayTitle(item)} — {suffix}
              </option>
            );
          })}
        </select>
      </label>

      <ul className="hidden space-y-1 lg:block">
        {items.map((item, index) => {
          const active = item.key === activeItemId;
          const itemCompleteness = completenessFor(completeness ?? {}, item.key);
          const approved = Boolean(item.reviewedFingerprint) || item.status === 'GENERATED';
          const done = mode === 'review' ? approved : itemCompleteness.isComplete;
          const errorCount = item.validationDiagnostics
            ? item.validationDiagnostics.errors.length
              + item.validationDiagnostics.fieldErrors.length
            : 0;
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onSelect(item.key)}
                disabled={disabled}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex min-h-11 w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
                  active
                    ? 'border-oak-primary bg-oak-primary/5 ring-1 ring-oak-primary/30'
                    : done
                      ? 'border-status-success/30 bg-status-success/5 hover:bg-status-success/10'
                      : 'border-border-primary bg-background-primary hover:bg-background-tertiary',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                    done
                      ? 'bg-status-success text-white'
                      : 'bg-background-tertiary text-text-secondary',
                  )}
                >
                  {done ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-primary">
                    {displayTitle(item)}
                  </span>
                  <span className="block truncate text-xs text-text-muted">
                    {item.templateName}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-xs font-medium',
                        statusToneClass(item.status),
                      )}
                    >
                      {ITEM_STATUS_LABELS[item.status]}
                    </span>
                    {item.status !== 'GENERATED' && itemCompleteness.requiredTotal > 0 && (
                      <span
                        className={cn(
                          'text-xs font-medium',
                          itemCompleteness.isComplete
                            ? 'text-status-success'
                            : 'text-status-warning',
                        )}
                      >
                        {itemCompleteness.requiredFilled}/{itemCompleteness.requiredTotal} fields
                      </span>
                    )}
                    {mode === 'review' && approved && item.status !== 'GENERATED' && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-status-success">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Approved
                      </span>
                    )}
                    {errorCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-status-error">
                        <AlertCircle className="h-3 w-3" aria-hidden="true" />
                        {errorCount} error{errorCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {onNextIncomplete && pendingCount > 0 && (
        <button
          type="button"
          onClick={onNextIncomplete}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-border-primary bg-background-primary text-sm font-medium text-oak-primary transition-colors hover:bg-oak-primary/5 lg:min-h-9"
        >
          {mode === 'review' ? 'Next unapproved' : 'Next incomplete'}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </nav>
  );
}
