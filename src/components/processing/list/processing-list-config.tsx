/** Columns, status badges, formatters and statistics for the Document Processing list. */

import {
  Upload,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Copy,
  FileStack,
} from 'lucide-react';
import type { PipelineStatus, DuplicateStatus, RevisionStatus } from '@/generated/prisma';
import { cn } from '@/lib/utils';
import type { ProcessingDocumentSearchResult } from '@/hooks/use-processing-documents';

/**
 * Convert a Date to a local YYYY-MM-DD string.
 * Unlike toISOString().split('T')[0] which uses UTC,
 * this uses the browser's local timezone.
 */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const COLUMN_PREF_KEY = 'processing:list:columns:v1';
export const COLUMN_VISIBILITY_PREF_KEY = 'processing:list:column-visibility:v1';
export const COLUMN_IDS = [
  'open',
  'document',
  'company',
  'pipeline',
  'status',
  'duplicate',
  'tags',
  'category',
  'subCategory',
  'vendor',
  'docNumber',
  'docDate',
  'currency',
  'subtotal',
  'tax',
  'total',
  'homeCurrency',
  'homeSubtotal',
  'homeTax',
  'homeTotal',
  'uploaded',
] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];

export const COLUMN_LABELS: Record<ColumnId, string> = {
  open: 'Open',
  document: 'Document',
  company: 'Company',
  pipeline: 'Pipeline',
  status: 'Status',
  duplicate: 'Duplicate',
  tags: 'Tags',
  category: 'Category',
  subCategory: 'Sub-Category',
  vendor: 'Vendor',
  docNumber: 'Doc #',
  docDate: 'Doc Date',
  currency: 'Currency',
  subtotal: 'Subtotal',
  tax: 'Tax',
  total: 'Total',
  homeCurrency: 'Home Ccy',
  homeSubtotal: 'Home Subtotal',
  homeTax: 'Home Tax',
  homeTotal: 'Home Total',
  uploaded: 'Uploaded',
};

export const DEFAULT_COLUMN_WIDTHS: Partial<Record<ColumnId, number>> = {
  document: 455,
  company: 395,
  pipeline: 154,
  status: 135,
  duplicate: 120,
  tags: 163,
  category: 215,
  subCategory: 170,
  vendor: 345,
  docNumber: 250,
  docDate: 147,
  currency: 108,
  subtotal: 147,
  tax: 141,
  total: 141,
  homeTax: 152,
  homeTotal: 150,
  uploaded: 157,
};

export const RIGHT_ALIGNED_COLUMNS = new Set<ColumnId>([
  'subtotal',
  'tax',
  'total',
  'homeSubtotal',
  'homeTax',
  'homeTotal',
]);

export const COLUMN_SORT_FIELDS: Partial<Record<ColumnId, string>> = {
  document: 'fileName',
  company: 'companyName',
  pipeline: 'pipelineStatus',
  status: 'revisionStatus',
  duplicate: 'duplicateStatus',
  category: 'documentCategory',
  subCategory: 'documentSubCategory',
  vendor: 'vendorName',
  docNumber: 'documentNumber',
  docDate: 'documentDate',
  currency: 'currency',
  homeCurrency: 'homeCurrency',
  subtotal: 'subtotal',
  tax: 'taxAmount',
  total: 'totalAmount',
  homeSubtotal: 'homeSubtotal',
  homeTax: 'homeTaxAmount',
  homeTotal: 'homeEquivalent',
  uploaded: 'createdAt',
};

// Revision status display config
export const revisionStatusConfig: Record<
  RevisionStatus,
  { label: string; color: string }
> = {
  DRAFT: { label: 'Pending Review', color: 'text-status-warning bg-status-warning/10' },
  APPROVED: { label: 'Approved', color: 'text-oak-primary bg-oak-primary/10' },
  SUPERSEDED: { label: 'Superseded', color: 'text-text-muted bg-background-tertiary' },
};

// Pipeline status display config
export const pipelineStatusConfig: Record<
  PipelineStatus,
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  UPLOADED: { label: 'Uploaded', color: 'text-text-secondary bg-background-tertiary', icon: Upload },
  QUEUED: { label: 'Queued', color: 'text-status-info bg-status-info/10', icon: Clock },
  PROCESSING: { label: 'Processing', color: 'text-status-info bg-status-info/10', icon: RefreshCw },
  SPLIT_PENDING: { label: 'Split Pending', color: 'text-status-warning bg-status-warning/10', icon: FileStack },
  SPLIT_DONE: { label: 'Split Done', color: 'text-status-success bg-status-success/10', icon: FileStack },
  EXTRACTION_DONE: { label: 'Extracted', color: 'text-status-success bg-status-success/10', icon: CheckCircle },
  FAILED_RETRYABLE: { label: 'Failed (Retry)', color: 'text-status-warning bg-status-warning/10', icon: AlertTriangle },
  FAILED_PERMANENT: { label: 'Failed', color: 'text-status-error bg-status-error/10', icon: XCircle },
  DEAD_LETTER: { label: 'Dead Letter', color: 'text-status-error bg-status-error/10', icon: XCircle },
};

// Duplicate status display config
export const duplicateStatusConfig: Record<
  DuplicateStatus,
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  NONE: { label: 'None', color: 'text-text-muted bg-background-tertiary', icon: Clock },
  SUSPECTED: { label: 'Suspected', color: 'text-status-warning bg-status-warning/10', icon: AlertTriangle },
  CONFIRMED: { label: 'Confirmed', color: 'text-status-error bg-status-error/10', icon: Copy },
  REJECTED: { label: 'Not Duplicate', color: 'text-status-success bg-status-success/10', icon: CheckCircle },
};

export function StatusBadge({
  config,
}: {
  status: string;
  config: { label: string; color: string; icon: React.ComponentType<{ className?: string }> };
}) {
  const Icon = config.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium max-w-full', config.color)} title={config.label}>
      <Icon className="w-3 h-3 flex-shrink-0" />
      <span className="truncate">{config.label}</span>
    </span>
  );
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Currency symbols mapping - SGD displayed as "S$"
export const CURRENCY_SYMBOLS: Record<string, string> = {
  SGD: 'S$',
  USD: 'US$',
  EUR: 'â‚¬',
  GBP: ' £',
  JPY: ' ¥',
  CNY: ' ¥',
  HKD: 'HK$',
  AUD: 'A$',
  MYR: 'RM',
};

export function formatCurrency(amount: string | null | undefined, currency: string): string {
  if (!amount) return '-';
  const num = parseFloat(amount);
  if (isNaN(num)) return '-';

  const isNegative = num < 0;
  const absNum = Math.abs(num);

  const formatted = new Intl.NumberFormat('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absNum);

  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
  return isNegative ? `(${symbol}${formatted})` : `${symbol}${formatted}`;
}

// Format enum values to proper case (e.g., VENDOR_INVOICE -> Vendor Invoice)
export function formatCategory(value: string | null | undefined): string {
  if (!value) return '-';
  return value
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/** Counts shown in the Statistics cards, for the page of documents on screen. */
export function processingListStats(data: ProcessingDocumentSearchResult | undefined) {
  if (!data?.documents) return null;
  const docs = data.documents;
  return {
    total: data.total,
    queued: docs.filter((d) => d.pipelineStatus === 'QUEUED').length,
    processing: docs.filter((d) => d.pipelineStatus === 'PROCESSING').length,
    pendingReview: docs.filter((d) =>
      d.currentRevision?.status === 'DRAFT' &&
      d.pipelineStatus === 'EXTRACTION_DONE'
    ).length,
    approved: docs.filter((d) => d.currentRevision?.status === 'APPROVED').length,
    failed: docs.filter((d) =>
      d.pipelineStatus === 'FAILED_RETRYABLE' ||
      d.pipelineStatus === 'FAILED_PERMANENT' ||
      d.pipelineStatus === 'DEAD_LETTER'
    ).length,
  };
}

export type ProcessingListStats = NonNullable<ReturnType<typeof processingListStats>>;
