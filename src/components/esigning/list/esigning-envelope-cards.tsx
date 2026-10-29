'use client';

import { CheckCircle2, Circle, Clock, FileText, XCircle } from 'lucide-react';
import { ESIGNING_SIGNING_ORDER_LABELS, formatEsigningDateTime } from '@/components/esigning/esigning-shared';
import { cn } from '@/lib/utils';
import type { EsigningEnvelopeListItem } from '@/types/esigning';
import {
  CARD_STATUS_BORDER_CLASS,
  ENVELOPE_STATUS_LABELS,
  RECIPIENT_STATUS_LABELS,
  getEnvelopeSearchMatchContext,
  type RecipientStatusFilter,
  type StatusFilter,
} from './esigning-list-config';
import { EmailDeliveryWarningBadge, EnvelopeActionsDropdown, type EnvelopeActionHandlers } from './esigning-envelope-actions';

interface EnvelopeCardGridProps {
  envelopes: EsigningEnvelopeListItem[];
  searchQuery: string;
  actions: EnvelopeActionHandlers;
}

/** Envelope list card view, with signer and document previews. */
export function EnvelopeCardGrid({ envelopes, searchQuery, actions }: EnvelopeCardGridProps) {
  return (
    <div className="grid grid-cols-1 items-stretch gap-3 p-3 sm:p-4 lg:grid-cols-2">
      {envelopes.map((envelope) => {
        const signers = envelope.recipients.filter((recipient) => recipient.type === 'SIGNER');
        const active = envelope.status === 'SENT' || envelope.status === 'IN_PROGRESS';
        const progress = envelope.signerCount > 0
          ? Math.round((envelope.completedSignerCount / envelope.signerCount) * 100)
          : 0;
        const matchContext = getEnvelopeSearchMatchContext(envelope, searchQuery);
        return (
          <article
            key={envelope.id}
            role="link"
            tabIndex={0}
            aria-label={`Open ${envelope.title}`}
            onClick={() => window.location.assign(`/esigning/${envelope.id}`)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                window.location.assign(`/esigning/${envelope.id}`);
              }
            }}
            className="flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-border-primary bg-background-secondary transition-colors hover:border-oak-primary/40 hover:bg-background-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30"
          >
            <div className={cn(
              'border-t-4 px-4 pb-2.5 pt-3',
              CARD_STATUS_BORDER_CLASS[envelope.status]
            )}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <span className="sr-only">
                    {ENVELOPE_STATUS_LABELS[envelope.status as StatusFilter]}
                  </span>
                  <h2 className="line-clamp-2 text-[15px] font-semibold leading-5 text-text-primary">
                    {envelope.title}
                  </h2>
                  <p className="mt-0.5 truncate text-xs text-text-secondary" title={envelope.companyName ?? 'No company'}>
                    {envelope.companyName ?? 'No company'}
                  </p>
                  {matchContext ? (
                    <p className="mt-0.5 truncate text-[11px] text-text-muted" title={matchContext}>
                      {matchContext}
                    </p>
                  ) : null}
                  {envelope.emailDelivery.status === 'failed' ? (
                    <div className="mt-1.5">
                      <EmailDeliveryWarningBadge envelope={envelope} />
                    </div>
                  ) : null}
                </div>
                <div
                  className="-mr-1 -mt-1 shrink-0"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <EnvelopeActionsDropdown envelope={envelope} {...actions} />
                </div>
              </div>
            </div>

            <div className="flex flex-1 flex-col px-4 pb-3">
              {active ? (
                <div className="flex items-center gap-3 border-t border-border-primary pt-2.5">
                  <div className="text-xs font-medium text-text-secondary">
                    {envelope.completedSignerCount} / {envelope.signerCount} signed
                  </div>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-background-tertiary">
                    <div className="h-full rounded-full bg-oak-primary" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              ) : null}

              <div className={cn(
                'grid gap-3 pt-2.5 sm:grid-cols-2',
                active ? '' : 'border-t border-border-primary'
              )}>
                <div className="min-w-0">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    Signers ({signers.length})
                  </div>
                  <div className="space-y-1.5">
                    {signers.length === 0 ? (
                      <div className="text-xs text-text-muted">No signers assigned</div>
                    ) : signers.slice(0, 3).map((recipient) => {
                      const StatusIcon = recipient.status === 'SIGNED'
                        ? CheckCircle2
                        : recipient.status === 'DECLINED'
                          ? XCircle
                          : recipient.status === 'VIEWED' || recipient.status === 'NOTIFIED'
                            ? Clock
                            : Circle;
                      const statusClass = recipient.status === 'SIGNED'
                        ? 'text-green-600'
                        : recipient.status === 'DECLINED'
                          ? 'text-rose-600'
                          : recipient.status === 'VIEWED'
                            ? 'text-blue-600'
                            : recipient.status === 'NOTIFIED'
                              ? 'text-amber-600'
                              : 'text-text-muted';
                      const recipientStatusLabel =
                        RECIPIENT_STATUS_LABELS[recipient.status as RecipientStatusFilter]
                        ?? recipient.status;
                      return (
                        <div key={recipient.id} className="flex min-w-0 items-center gap-2">
                          <StatusIcon
                            className={cn('h-3.5 w-3.5 shrink-0', statusClass)}
                            aria-label={recipientStatusLabel}
                          />
                          <div className="min-w-0 truncate text-xs font-medium text-text-primary" title={recipient.name}>
                            {recipient.name}
                          </div>
                        </div>
                      );
                    })}
                    {signers.length > 3 ? (
                      <div className="text-[11px] font-medium text-text-muted">+{signers.length - 3} more</div>
                    ) : null}
                  </div>
                </div>

                <div className="min-w-0 border-t border-border-primary pt-3 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    Documents ({envelope.documents.length})
                  </div>
                  <div className="space-y-1.5">
                    {envelope.documents.length === 0 ? (
                      <div className="text-xs text-text-muted">No documents added</div>
                    ) : envelope.documents.slice(0, 3).map((document) => (
                      <div key={document.id} className="flex min-w-0 items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                        <span className="truncate text-xs text-text-secondary" title={document.fileName}>
                          {document.fileName}
                        </span>
                      </div>
                    ))}
                    {envelope.documents.length > 3 ? (
                      <div className="text-[11px] font-medium text-text-muted">+{envelope.documents.length - 3} more</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border-primary pt-2.5 text-[11px] text-text-muted">
                <span>{envelope.documentCount} docs · {envelope.signerCount} signers · {ESIGNING_SIGNING_ORDER_LABELS[envelope.signingOrder]}</span>
                <span>Updated {formatEsigningDateTime(envelope.updatedAt)}</span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
