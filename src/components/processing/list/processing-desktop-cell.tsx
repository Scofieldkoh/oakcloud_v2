/** One cell of the desktop Document Processing table. */

import Link from 'next/link';
import {
  FileText,
  FileStack,
  ArrowUpRight,
} from 'lucide-react';
import {
  type ProcessingDocumentListItem,
} from '@/hooks/use-processing-documents';
import { cn } from '@/lib/utils';
import { DocumentTags } from '@/components/processing/document-tags';
import { type ColumnId, StatusBadge, duplicateStatusConfig, formatCategory, formatCurrency, formatDate, pipelineStatusConfig, revisionStatusConfig } from '@/components/processing/list/processing-list-config';

export interface ProcessingCellContext {
  activeTenantId: string | undefined;
  effectiveCompanyId: string | undefined;
}

export function renderProcessingDesktopCell(
  doc: ProcessingDocumentListItem,
  columnId: ColumnId,
  { activeTenantId, effectiveCompanyId }: ProcessingCellContext,
) {
  switch (columnId) {
    case 'open':
      return (
        <td key={columnId} className="px-2 py-2">
          <Link
            href={`/processing/${doc.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-8 h-8 rounded hover:bg-background-tertiary text-text-secondary hover:text-text-primary transition-colors"
            aria-label={`Open &quot;${doc.document.fileName}&quot; in new tab`}
            title={`Open &quot;${doc.document.fileName}&quot; in new tab`}
          >
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </td>
      );
    case 'document':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-1.5 rounded bg-background-tertiary flex-shrink-0">
              {doc.isContainer ? (
                <FileStack className="w-4 h-4 text-text-secondary" />
              ) : (
                <FileText className="w-4 h-4 text-text-secondary" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Link
                href={`/processing/${doc.id}`}
                className="text-sm font-medium text-text-primary hover:underline block truncate"
                title={doc.document.fileName}
              >
                {doc.document.fileName}
              </Link>
              {!doc.isContainer && (
                <p className="text-xs text-text-muted truncate">
                  Pages {doc.pageFrom}-{doc.pageTo}
                </p>
              )}
            </div>
          </div>
        </td>
      );
    case 'company':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <span className="text-sm text-text-primary block truncate" title={doc.document.company?.name || undefined}>
            {doc.document.company?.name || '-'}
          </span>
        </td>
      );
    case 'pipeline':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <div className="min-w-0">
            <StatusBadge status={doc.pipelineStatus} config={pipelineStatusConfig[doc.pipelineStatus]} />
          </div>
        </td>
      );
    case 'status':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <div className="min-w-0">
            {doc.currentRevision ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium max-w-full truncate',
                  revisionStatusConfig[doc.currentRevision.status].color
                )}
                title={revisionStatusConfig[doc.currentRevision.status].label}
              >
                {revisionStatusConfig[doc.currentRevision.status].label}
              </span>
            ) : (
              <span className="text-sm text-text-primary">-</span>
            )}
          </div>
        </td>
      );
    case 'duplicate':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <div className="min-w-0">
            <StatusBadge status={doc.duplicateStatus} config={duplicateStatusConfig[doc.duplicateStatus]} />
          </div>
        </td>
      );
    case 'tags':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <DocumentTags
            documentId={doc.id}
            companyId={effectiveCompanyId || doc.document.companyId}
            tenantId={activeTenantId}
            readOnly={true}
            limit={3}
            className="flex-nowrap"
          />
        </td>
      );
    case 'category':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <span
            className="text-sm text-text-primary block truncate"
            title={formatCategory(doc.currentRevision?.documentCategory)}
          >
            {formatCategory(doc.currentRevision?.documentCategory)}
          </span>
        </td>
      );
    case 'subCategory':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <span
            className="text-sm text-text-primary block truncate"
            title={formatCategory(doc.currentRevision?.documentSubCategory)}
          >
            {formatCategory(doc.currentRevision?.documentSubCategory)}
          </span>
        </td>
      );
    case 'vendor':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <span
            className="text-sm text-text-primary block truncate"
            title={doc.currentRevision?.vendorName || undefined}
          >
            {doc.currentRevision?.vendorName || '-'}
          </span>
        </td>
      );
    case 'docNumber':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <span className="text-sm text-text-primary block truncate" title={doc.currentRevision?.documentNumber || undefined}>
            {doc.currentRevision?.documentNumber || '-'}
          </span>
        </td>
      );
    case 'docDate':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <span className="text-sm text-text-primary block truncate" title={doc.currentRevision?.documentDate ? formatDate(doc.currentRevision.documentDate) : undefined}>
            {doc.currentRevision?.documentDate ? formatDate(doc.currentRevision.documentDate) : '-'}
          </span>
        </td>
      );
    case 'currency':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <span className="text-sm text-text-primary block truncate" title={doc.currentRevision?.currency || undefined}>
            {doc.currentRevision?.currency || '-'}
          </span>
        </td>
      );
    case 'homeCurrency':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <span className="text-sm text-text-primary block truncate" title={doc.currentRevision?.homeCurrency || undefined}>
            {doc.currentRevision?.homeCurrency || '-'}
          </span>
        </td>
      );
    case 'subtotal':
      return (
        <td key={columnId} className="px-3 py-2 text-right max-w-0">
          <span className="text-sm text-text-primary block truncate" title={doc.currentRevision ? formatCurrency(doc.currentRevision.subtotal, doc.currentRevision.currency) : undefined}>
            {doc.currentRevision ? formatCurrency(doc.currentRevision.subtotal, doc.currentRevision.currency) : '-'}
          </span>
        </td>
      );
    case 'tax':
      return (
        <td key={columnId} className="px-3 py-2 text-right max-w-0">
          <span className="text-sm text-text-primary block truncate" title={doc.currentRevision ? formatCurrency(doc.currentRevision.taxAmount, doc.currentRevision.currency) : undefined}>
            {doc.currentRevision ? formatCurrency(doc.currentRevision.taxAmount, doc.currentRevision.currency) : '-'}
          </span>
        </td>
      );
    case 'total':
      return (
        <td key={columnId} className="px-3 py-2 text-right max-w-0">
          <span className="text-sm text-text-primary block truncate" title={doc.currentRevision ? formatCurrency(doc.currentRevision.totalAmount, doc.currentRevision.currency) : undefined}>
            {doc.currentRevision
              ? formatCurrency(doc.currentRevision.totalAmount, doc.currentRevision.currency)
              : '-'}
          </span>
        </td>
      );
    case 'homeSubtotal':
      return (
        <td key={columnId} className="px-3 py-2 text-right max-w-0">
          <span className="text-sm text-text-primary block truncate" title={doc.currentRevision?.homeCurrency ? formatCurrency(doc.currentRevision.homeSubtotal, doc.currentRevision.homeCurrency) : undefined}>
            {doc.currentRevision?.homeCurrency
              ? formatCurrency(doc.currentRevision.homeSubtotal, doc.currentRevision.homeCurrency)
              : '-'}
          </span>
        </td>
      );
    case 'homeTax':
      return (
        <td key={columnId} className="px-3 py-2 text-right max-w-0">
          <span className="text-sm text-text-primary block truncate" title={doc.currentRevision?.homeCurrency ? formatCurrency(doc.currentRevision.homeTaxAmount, doc.currentRevision.homeCurrency) : undefined}>
            {doc.currentRevision?.homeCurrency
              ? formatCurrency(doc.currentRevision.homeTaxAmount, doc.currentRevision.homeCurrency)
              : '-'}
          </span>
        </td>
      );
    case 'homeTotal':
      return (
        <td key={columnId} className="px-3 py-2 text-right max-w-0">
          <span className="text-sm text-text-primary block truncate" title={doc.currentRevision?.homeCurrency ? formatCurrency(doc.currentRevision.homeEquivalent, doc.currentRevision.homeCurrency) : undefined}>
            {doc.currentRevision?.homeCurrency
              ? formatCurrency(doc.currentRevision.homeEquivalent, doc.currentRevision.homeCurrency)
              : '-'}
          </span>
        </td>
      );
    case 'uploaded':
      return (
        <td key={columnId} className="px-3 py-2 max-w-0">
          <span className="text-sm text-text-primary block truncate" title={formatDate(doc.createdAt)}>{formatDate(doc.createdAt)}</span>
        </td>
      );
    default:
      return null;
  }
}
