/** Builds the removable "Active filters" chips for the Document Processing list. */

import {
  type ProcessingDocumentSearchParams,
} from '@/hooks/use-processing-documents';
import { type ProcessingFilterValues } from '@/components/processing/processing-filters';
import { useAvailableTags } from '@/hooks/use-document-tags';
import type { PipelineStatus, DuplicateStatus, RevisionStatus } from '@/generated/prisma';
import { CATEGORY_LABELS, SUBCATEGORY_LABELS } from '@/lib/document-categories';

export interface ProcessingFilterChip {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

export function buildProcessingFilterChips(
  params: ProcessingDocumentSearchParams,
  tagsData: ReturnType<typeof useAvailableTags>['data'],
  handleFiltersChange: (filters: Partial<ProcessingFilterValues>) => void,
): ProcessingFilterChip[] {
  const chips: ProcessingFilterChip[] = [];

  // Quick Filters
  if (params.needsReview) {
    chips.push({
      key: 'needsReview',
      label: 'Review',
      value: 'Needs Review',
      onRemove: () => handleFiltersChange({ needsReview: undefined }),
    });
  }

  if (params.uploadDatePreset === 'TODAY') {
    chips.push({
      key: 'uploadDatePreset',
      label: 'Uploaded',
      value: 'Today',
      onRemove: () => handleFiltersChange({ uploadDatePreset: undefined, uploadDateFrom: undefined, uploadDateTo: undefined }),
    });
  }

  // Pipeline Status
  if (params.pipelineStatus) {
    const statusLabels: Record<PipelineStatus, string> = {
      UPLOADED: 'Uploaded',
      QUEUED: 'Queued',
      PROCESSING: 'Processing',
      SPLIT_PENDING: 'Split Pending',
      SPLIT_DONE: 'Split Done',
      EXTRACTION_DONE: 'Extracted',
      FAILED_RETRYABLE: 'Failed (Retry)',
      FAILED_PERMANENT: 'Failed',
      DEAD_LETTER: 'Dead Letter',
    };
    chips.push({
      key: 'pipelineStatus',
      label: 'Pipeline',
      value: statusLabels[params.pipelineStatus],
      onRemove: () => handleFiltersChange({ pipelineStatus: undefined }),
    });
  }

  // Revision Status
  if (params.revisionStatus) {
    const statusLabels: Record<RevisionStatus, string> = {
      DRAFT: 'Pending Review',
      APPROVED: 'Approved',
      SUPERSEDED: 'Superseded',
    };
    chips.push({
      key: 'revisionStatus',
      label: 'Status',
      value: statusLabels[params.revisionStatus],
      onRemove: () => handleFiltersChange({ revisionStatus: undefined }),
    });
  }

  // Duplicate Status
  if (params.duplicateStatus) {
    const statusLabels: Record<DuplicateStatus, string> = {
      NONE: 'None',
      SUSPECTED: 'Suspected',
      CONFIRMED: 'Confirmed',
      REJECTED: 'Not Duplicate',
    };
    chips.push({
      key: 'duplicateStatus',
      label: 'Duplicate',
      value: statusLabels[params.duplicateStatus],
      onRemove: () => handleFiltersChange({ duplicateStatus: undefined }),
    });
  }

  // Category
  if (params.documentCategory) {
    chips.push({
      key: 'documentCategory',
      label: 'Category',
      value: CATEGORY_LABELS[params.documentCategory] || params.documentCategory,
      onRemove: () => handleFiltersChange({ documentCategory: undefined }),
    });
  }

  // Sub-Category
  if (params.documentSubCategory) {
    chips.push({
      key: 'documentSubCategory',
      label: 'Sub-Category',
      value: SUBCATEGORY_LABELS[params.documentSubCategory] || params.documentSubCategory,
      onRemove: () => handleFiltersChange({ documentSubCategory: undefined }),
    });
  }

  // Vendor Name
  if (params.vendorName) {
    chips.push({
      key: 'vendorName',
      label: 'Vendor',
      value: params.vendorName,
      onRemove: () => handleFiltersChange({ vendorName: undefined }),
    });
  }

  // Document Number
  if (params.documentNumber) {
    chips.push({
      key: 'documentNumber',
      label: 'Doc Number',
      value: params.documentNumber,
      onRemove: () => handleFiltersChange({ documentNumber: undefined }),
    });
  }

  // File Name
  if (params.fileName) {
    chips.push({
      key: 'fileName',
      label: 'File Name',
      value: params.fileName,
      onRemove: () => handleFiltersChange({ fileName: undefined }),
    });
  }

  // Currency Filters
  if (params.currency) {
    chips.push({
      key: 'currency',
      label: 'Currency',
      value: params.currency,
      onRemove: () => handleFiltersChange({ currency: undefined }),
    });
  }

  if (params.homeCurrency) {
    chips.push({
      key: 'homeCurrency',
      label: 'Home Ccy',
      value: params.homeCurrency,
      onRemove: () => handleFiltersChange({ homeCurrency: undefined }),
    });
  }

  // Tags Filter
  if (params.tagIds && params.tagIds.length > 0) {
    const tagNames = params.tagIds.map(tagId => {
      const tag = tagsData?.find(t => t.id === tagId);
      return tag?.name || tagId;
    }).join(', ');
    chips.push({
      key: 'tags',
      label: 'Tags',
      value: tagNames,
      onRemove: () => handleFiltersChange({ tagIds: undefined }),
    });
  }

  // Date Filters
  if (params.documentDateFrom || params.documentDateTo) {
    const from = params.documentDateFrom || '...';
    const to = params.documentDateTo || '...';
    chips.push({
      key: 'documentDate',
      label: 'Doc Date',
      value: `${from} to ${to}`,
      onRemove: () => handleFiltersChange({ documentDateFrom: undefined, documentDateTo: undefined }),
    });
  }

  // Only show upload date range if preset is not active
  if ((params.uploadDateFrom || params.uploadDateTo) && params.uploadDatePreset !== 'TODAY') {
    const from = params.uploadDateFrom || '...';
    const to = params.uploadDateTo || '...';
    chips.push({
      key: 'uploadDate',
      label: 'Uploaded',
      value: `${from} to ${to}`,
      onRemove: () => handleFiltersChange({ uploadDateFrom: undefined, uploadDateTo: undefined }),
    });
  }

  // Amount Filters
  const formatAmount = (num: number) => num.toLocaleString('en-US', { maximumFractionDigits: 2 });

  if (params.subtotal !== undefined) {
    chips.push({
      key: 'subtotal',
      label: 'Subtotal',
      value: formatAmount(params.subtotal),
      onRemove: () => handleFiltersChange({ subtotalFilter: undefined }),
    });
  } else if (params.subtotalFrom !== undefined || params.subtotalTo !== undefined) {
    const from = params.subtotalFrom !== undefined ? formatAmount(params.subtotalFrom) : '...';
    const to = params.subtotalTo !== undefined ? formatAmount(params.subtotalTo) : '...';
    chips.push({
      key: 'subtotalRange',
      label: 'Subtotal',
      value: `${from} to ${to}`,
      onRemove: () => handleFiltersChange({ subtotalFilter: undefined }),
    });
  }

  if (params.tax !== undefined) {
    chips.push({
      key: 'tax',
      label: 'Tax',
      value: formatAmount(params.tax),
      onRemove: () => handleFiltersChange({ taxFilter: undefined }),
    });
  } else if (params.taxFrom !== undefined || params.taxTo !== undefined) {
    const from = params.taxFrom !== undefined ? formatAmount(params.taxFrom) : '...';
    const to = params.taxTo !== undefined ? formatAmount(params.taxTo) : '...';
    chips.push({
      key: 'taxRange',
      label: 'Tax',
      value: `${from} to ${to}`,
      onRemove: () => handleFiltersChange({ taxFilter: undefined }),
    });
  }

  if (params.total !== undefined) {
    chips.push({
      key: 'total',
      label: 'Total',
      value: formatAmount(params.total),
      onRemove: () => handleFiltersChange({ totalFilter: undefined }),
    });
  } else if (params.totalFrom !== undefined || params.totalTo !== undefined) {
    const from = params.totalFrom !== undefined ? formatAmount(params.totalFrom) : '...';
    const to = params.totalTo !== undefined ? formatAmount(params.totalTo) : '...';
    chips.push({
      key: 'totalRange',
      label: 'Total',
      value: `${from} to ${to}`,
      onRemove: () => handleFiltersChange({ totalFilter: undefined }),
    });
  }

  if (params.homeSubtotal !== undefined) {
    chips.push({
      key: 'homeSubtotal',
      label: 'Home Subtotal',
      value: formatAmount(params.homeSubtotal),
      onRemove: () => handleFiltersChange({ homeSubtotalFilter: undefined }),
    });
  } else if (params.homeSubtotalFrom !== undefined || params.homeSubtotalTo !== undefined) {
    const from = params.homeSubtotalFrom !== undefined ? formatAmount(params.homeSubtotalFrom) : '...';
    const to = params.homeSubtotalTo !== undefined ? formatAmount(params.homeSubtotalTo) : '...';
    chips.push({
      key: 'homeSubtotalRange',
      label: 'Home Subtotal',
      value: `${from} to ${to}`,
      onRemove: () => handleFiltersChange({ homeSubtotalFilter: undefined }),
    });
  }

  if (params.homeTax !== undefined) {
    chips.push({
      key: 'homeTax',
      label: 'Home Tax',
      value: formatAmount(params.homeTax),
      onRemove: () => handleFiltersChange({ homeTaxFilter: undefined }),
    });
  } else if (params.homeTaxFrom !== undefined || params.homeTaxTo !== undefined) {
    const from = params.homeTaxFrom !== undefined ? formatAmount(params.homeTaxFrom) : '...';
    const to = params.homeTaxTo !== undefined ? formatAmount(params.homeTaxTo) : '...';
    chips.push({
      key: 'homeTaxRange',
      label: 'Home Tax',
      value: `${from} to ${to}`,
      onRemove: () => handleFiltersChange({ homeTaxFilter: undefined }),
    });
  }

  if (params.homeTotal !== undefined) {
    chips.push({
      key: 'homeTotal',
      label: 'Home Total',
      value: formatAmount(params.homeTotal),
      onRemove: () => handleFiltersChange({ homeTotalFilter: undefined }),
    });
  } else if (params.homeTotalFrom !== undefined || params.homeTotalTo !== undefined) {
    const from = params.homeTotalFrom !== undefined ? formatAmount(params.homeTotalFrom) : '...';
    const to = params.homeTotalTo !== undefined ? formatAmount(params.homeTotalTo) : '...';
    chips.push({
      key: 'homeTotalRange',
      label: 'Home Total',
      value: `${from} to ${to}`,
      onRemove: () => handleFiltersChange({ homeTotalFilter: undefined }),
    });
  }

  return chips;
}
