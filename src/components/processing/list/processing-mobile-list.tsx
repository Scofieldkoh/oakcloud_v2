'use client';

/** Document cards and paging for the Document Processing list on phones. */

import Link from 'next/link';
import {
  Copy,
} from 'lucide-react';
import { MobileCard, CardDetailsGrid, CardDetailItem } from '@/components/ui/responsive-table';
import { cn } from '@/lib/utils';
import { StatusBadge, duplicateStatusConfig, formatCategory, formatCurrency, formatDate, pipelineStatusConfig, revisionStatusConfig } from '@/components/processing/list/processing-list-config';
import type { ReactNode } from 'react';
import type { ProcessingDocumentSearchResult } from '@/hooks/use-processing-documents';

interface ProcessingMobileListProps {
  data: ProcessingDocumentSearchResult;
  isFetching: boolean;
  emptyState: ReactNode;
  selectedIds: string[];
  expandedMobileCardIds: string[];
  toggleSelect: (id: string) => void;
  toggleMobileCardExpanded: (id: string) => void;
  handlePageChange: (page: number) => void;
}

export function ProcessingMobileList({
  data,
  isFetching,
  emptyState,
  selectedIds,
  expandedMobileCardIds,
  toggleSelect,
  toggleMobileCardExpanded,
  handlePageChange,
}: ProcessingMobileListProps) {
  return (
    <div className={cn('lg:hidden space-y-3 mb-6 relative', isFetching && 'opacity-60')}>
      {data.documents.length === 0 ? (
        <div className="card">{emptyState}</div>
      ) : (
        data.documents.map((doc, index) => {
          const isSelected = selectedIds.includes(doc.id);
          const isExpanded = expandedMobileCardIds.includes(doc.id);
          const isAlternate = index % 2 === 1;
          return (
            <MobileCard
              key={doc.id}
              isSelected={isSelected}
              selectable
              onToggle={() => toggleSelect(doc.id)}
              onCardClick={() => toggleMobileCardExpanded(doc.id)}
              className={!isSelected && isAlternate ? 'bg-oak-row-alt' : undefined}
              title={
                <Link href={`/processing/${doc.id}`} className="hover:underline">
                  {doc.document.fileName}
                </Link>
              }
              details={
                <div className="space-y-3">
                  {/* Status Badges Row */}
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge
                      status={doc.pipelineStatus}
                      config={pipelineStatusConfig[doc.pipelineStatus]}
                    />
                    {doc.currentRevision && (
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                        revisionStatusConfig[doc.currentRevision.status].color
                      )}>
                        {revisionStatusConfig[doc.currentRevision.status].label}
                      </span>
                    )}
                    {doc.duplicateStatus !== 'NONE' && (
                      <StatusBadge
                        status={doc.duplicateStatus}
                        config={duplicateStatusConfig[doc.duplicateStatus]}
                      />
                    )}
                  </div>

                  <CardDetailsGrid>
                    <CardDetailItem
                      label="Company"
                      value={doc.document.company?.name || '-'}
                    />
                    <CardDetailItem
                      label="Category"
                      value={formatCategory(doc.currentRevision?.documentCategory)}
                    />
                    <CardDetailItem
                      label="Sub-Category"
                      value={formatCategory(doc.currentRevision?.documentSubCategory)}
                    />
                    <CardDetailItem
                      label="Vendor"
                      value={doc.currentRevision?.vendorName || '-'}
                    />
                  </CardDetailsGrid>

                  {isExpanded && (
                    <CardDetailsGrid className="pt-3 border-t border-border-primary">
                    <CardDetailItem
                      label="Doc #"
                      value={doc.currentRevision?.documentNumber || '-'}
                    />
                    <CardDetailItem
                      label="Doc Date"
                      value={doc.currentRevision?.documentDate
                        ? formatDate(doc.currentRevision.documentDate)
                        : '-'}
                    />
                    <CardDetailItem
                      label="Subtotal"
                      value={doc.currentRevision
                        ? formatCurrency(doc.currentRevision.subtotal, doc.currentRevision.currency)
                        : '-'}
                    />
                    <CardDetailItem
                      label="Tax"
                      value={doc.currentRevision
                        ? formatCurrency(doc.currentRevision.taxAmount, doc.currentRevision.currency)
                        : '-'}
                    />
                    <CardDetailItem
                      label="Total"
                      value={doc.currentRevision
                        ? formatCurrency(doc.currentRevision.totalAmount, doc.currentRevision.currency)
                        : '-'}
                    />
                    {doc.currentRevision?.homeCurrency && (
                      <>
                        <CardDetailItem
                          label="Home Subtotal"
                          value={formatCurrency(doc.currentRevision.homeSubtotal, doc.currentRevision.homeCurrency)}
                        />
                        <CardDetailItem
                          label="Home Tax"
                          value={formatCurrency(doc.currentRevision.homeTaxAmount, doc.currentRevision.homeCurrency)}
                        />
                        <CardDetailItem
                          label="Home Total"
                          value={formatCurrency(doc.currentRevision.homeEquivalent, doc.currentRevision.homeCurrency)}
                        />
                      </>
                    )}
                    <CardDetailItem
                      label="Uploaded"
                      value={formatDate(doc.createdAt)}
                    />
                    </CardDetailsGrid>
                  )}
                </div>
              }
              actions={
                doc.duplicateStatus === 'SUSPECTED' ? (
                  <Link
                    href={`/processing/${doc.id}?compare=true`}
                    className="btn-ghost btn-xs inline-flex items-center gap-1 text-status-warning min-h-[44px]"
                    title="Compare with suspected duplicate"
                  >
                    <Copy className="w-4 h-4" />
                    Compare
                  </Link>
                ) : undefined
              }
            />
          );
        })
      )}

      {/* Mobile Pagination */}
      {data.totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-2">
          <p className="text-xs text-text-secondary">
            {(data.page - 1) * data.limit + 1}-{Math.min(data.page * data.limit, data.total)} of {data.total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(data.page - 1)}
              disabled={data.page === 1}
              className="btn-ghost btn-xs min-h-[44px]"
            >
              Previous
            </button>
            <span className="text-xs text-text-secondary">
              {data.page}/{data.totalPages}
            </span>
            <button
              onClick={() => handlePageChange(data.page + 1)}
              disabled={data.page === data.totalPages}
              className="btn-ghost btn-xs min-h-[44px]"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
