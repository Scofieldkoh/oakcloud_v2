'use client';

import type { KeyboardEvent, PointerEvent } from 'react';
import { TableBody, TableHead, TableHeaderCell, TableHeaderRow, TableRoot, TableRow, TableViewport } from '@/components/ui/data-table';
import { EnvelopeStatusBadge, formatEsigningDateTime } from '@/components/esigning/esigning-shared';
import { cn } from '@/lib/utils';
import type { EsigningEnvelopeListItem } from '@/types/esigning';
import {
  DEFAULT_ESIGNING_COLUMN_WIDTHS,
  ESIGNING_TABLE_COLUMNS,
  ESIGNING_TABLE_COLUMN_LABELS,
  ESIGNING_TABLE_SORT_FIELDS,
  getEnvelopeSearchMatchContext,
  type EnvelopeSortBy,
  type EsigningTableColumnId,
} from './esigning-list-config';
import { EmailDeliveryWarningBadge, EnvelopeActionsDropdown, type EnvelopeActionHandlers } from './esigning-envelope-actions';

interface EnvelopeTableViewProps {
  envelopes: EsigningEnvelopeListItem[];
  searchQuery: string;
  sortBy: EnvelopeSortBy;
  sortOrder: 'asc' | 'desc';
  onSort: (sortBy: EnvelopeSortBy) => void;
  columnWidths: Partial<Record<EsigningTableColumnId, number>>;
  onResizePointerDown: (event: PointerEvent<HTMLElement>, columnId: EsigningTableColumnId) => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLSpanElement>, columnId: EsigningTableColumnId) => void;
  actions: EnvelopeActionHandlers;
}

/** Envelope list table view: a resizable table on desktop and a stacked list on phones. */
export function EnvelopeTableView({
  envelopes,
  searchQuery,
  sortBy,
  sortOrder,
  onSort,
  columnWidths,
  onResizePointerDown,
  onResizeKeyDown,
  actions,
}: EnvelopeTableViewProps) {
  return (
    <>
      <TableViewport className="hidden md:block">
        <TableRoot>
          <colgroup>
            {ESIGNING_TABLE_COLUMNS.map((columnId) => (
              <col
                key={columnId}
                style={{
                  width: `${columnWidths[columnId] ?? DEFAULT_ESIGNING_COLUMN_WIDTHS[columnId]}px`,
                }}
              />
            ))}
            <col />
          </colgroup>
          <TableHead>
            <TableHeaderRow hasFilters={false}>
              {ESIGNING_TABLE_COLUMNS.map((columnId) => {
                const sortField = ESIGNING_TABLE_SORT_FIELDS[columnId];
                const active = sortBy === sortField;
                return (
                  <TableHeaderCell
                    key={columnId}
                    label={ESIGNING_TABLE_COLUMN_LABELS[columnId]}
                    sorted={active}
                    sortOrder={sortOrder}
                    onSort={() => onSort(sortField)}
                    resizable
                    onResizePointerDown={(event) => onResizePointerDown(event, columnId)}
                    onResizeKeyDown={(event) => onResizeKeyDown(event, columnId)}
                    resizeAriaLabel={`Resize ${ESIGNING_TABLE_COLUMN_LABELS[columnId]} column`}
                    resizeTestId={`esigning-resize-${columnId}`}
                  />
                );
              })}
              <TableHeaderCell className="w-12 px-2">
                <span className="sr-only">Actions</span>
              </TableHeaderCell>
            </TableHeaderRow>
          </TableHead>
          <TableBody>
            {envelopes.map((envelope, index) => {
              const matchContext = getEnvelopeSearchMatchContext(envelope, searchQuery);
              const active = envelope.status === 'SENT' || envelope.status === 'IN_PROGRESS';
              const progress = envelope.signerCount > 0
                ? Math.round((envelope.completedSignerCount / envelope.signerCount) * 100)
                : 0;
              return (
                <TableRow
                  key={envelope.id}
                  index={index}
                  interactive
                  onActivate={() => window.location.assign(`/esigning/${envelope.id}`)}
                  aria-label={`Open ${envelope.title}`}
                  className="h-[58px] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oak-primary/30"
                >
                  <td className="px-3 py-2 align-middle">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <EnvelopeStatusBadge status={envelope.status} />
                      <EmailDeliveryWarningBadge envelope={envelope} />
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-text-primary" title={envelope.title}>
                        {envelope.title}
                      </div>
                      {matchContext ? (
                        <div className="mt-0.5 truncate text-[11px] text-text-muted" title={matchContext}>
                          {matchContext}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="truncate text-xs text-text-secondary" title={envelope.companyName ?? 'No company'}>
                      {envelope.companyName ?? 'No company'}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    {active ? (
                      <div>
                        <div className="text-xs font-medium text-text-secondary">
                          {envelope.completedSignerCount} / {envelope.signerCount} signed
                        </div>
                        <div className="mt-1 h-1 w-20 overflow-hidden rounded-full bg-background-tertiary">
                          <div className="h-full rounded-full bg-oak-primary" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-text-secondary">
                        {envelope.documentCount} docs · {envelope.signerCount} signers
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle text-xs text-text-muted">
                    {formatEsigningDateTime(envelope.updatedAt)}
                  </td>
                  <td
                    className="px-2 py-2 text-left align-middle"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <EnvelopeActionsDropdown envelope={envelope} {...actions} />
                  </td>
                </TableRow>
              );
            })}
          </TableBody>
        </TableRoot>
      </TableViewport>

      <div className="divide-y divide-border-primary md:hidden">
        {envelopes.map((envelope, index) => {
          const matchContext = getEnvelopeSearchMatchContext(envelope, searchQuery);
          const isAlternate = index % 2 === 1;
          const active = envelope.status === 'SENT' || envelope.status === 'IN_PROGRESS';
          return (
            <article
              key={envelope.id}
              tabIndex={0}
              role="link"
              aria-label={`Open ${envelope.title}`}
              onClick={() => window.location.assign(`/esigning/${envelope.id}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  window.location.assign(`/esigning/${envelope.id}`);
                }
              }}
              className={cn(
                'cursor-pointer px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oak-primary/30',
                isAlternate
                  ? 'bg-oak-row-alt hover:bg-oak-row-alt-hover'
                  : 'bg-background-secondary hover:bg-background-tertiary/50'
              )}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <EnvelopeStatusBadge status={envelope.status} />
                    <EmailDeliveryWarningBadge envelope={envelope} />
                  </div>
                  <h2 className="mt-2 line-clamp-2 text-sm font-semibold text-text-primary">
                    {envelope.title}
                  </h2>
                  {matchContext ? (
                    <p className="mt-0.5 truncate text-[11px] text-text-muted">{matchContext}</p>
                  ) : null}
                  <p className="mt-1 truncate text-xs text-text-secondary">
                    {envelope.companyName ?? 'No company'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                    <span>{active ? `${envelope.completedSignerCount} / ${envelope.signerCount} signed` : `${envelope.documentCount} docs · ${envelope.signerCount} signers`}</span>
                    <span>{formatEsigningDateTime(envelope.updatedAt)}</span>
                  </div>
                </div>
                <div
                  className="-mr-1 shrink-0"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <EnvelopeActionsDropdown envelope={envelope} {...actions} />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
