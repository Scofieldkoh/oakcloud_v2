/** Reads and writes the Document Processing list filters in the page URL. */

import {
  type ProcessingDocumentSearchParams,
} from '@/hooks/use-processing-documents';
import { type ProcessingFilterValues } from '@/components/processing/processing-filters';
import { type AmountFilterValue } from '@/components/ui/amount-filter';
import type { PipelineStatus, DuplicateStatus, RevisionStatus, DocumentCategory, DocumentSubCategory } from '@/generated/prisma';
import { buildListUrl, parseUrlParams, urlParam, type UrlParamSpec } from '@/lib/url-list-params';

type ProcessingUrlParams = Omit<ProcessingDocumentSearchParams, 'tenantId'>;

/** List filters, sort and paging kept in the /processing URL, in URL order. */
const PROCESSING_LIST_PARAMS: UrlParamSpec<ProcessingUrlParams> = {
  page: urlParam.int(1),
  limit: urlParam.int(20),
  sortBy: urlParam.string('createdAt'),
  sortOrder: urlParam.choice<'asc' | 'desc'>('desc'),
  pipelineStatus: urlParam.optional<PipelineStatus>(),
  duplicateStatus: urlParam.optional<DuplicateStatus>(),
  revisionStatus: urlParam.optional<RevisionStatus>(),
  needsReview: urlParam.flag(),
  isContainer: urlParam.optionalBoolean(),
  companyId: urlParam.optional(),
  uploadDatePreset: urlParam.optional<'TODAY'>(),
  uploadDateFrom: urlParam.optional(),
  uploadDateTo: urlParam.optional(),
  documentDateFrom: urlParam.optional(),
  documentDateTo: urlParam.optional(),
  search: urlParam.optional(),
  vendorName: urlParam.optional(),
  documentNumber: urlParam.optional(),
  fileName: urlParam.optional(),
  documentCategory: urlParam.optional<DocumentCategory>(),
  documentSubCategory: urlParam.optional<DocumentSubCategory>(),
  tagIds: urlParam.list(),
  currency: urlParam.optional(),
  homeCurrency: urlParam.optional(),
  subtotal: urlParam.optionalNumber(),
  subtotalFrom: urlParam.optionalNumber(),
  subtotalTo: urlParam.optionalNumber(),
  tax: urlParam.optionalNumber(),
  taxFrom: urlParam.optionalNumber(),
  taxTo: urlParam.optionalNumber(),
  total: urlParam.optionalNumber(),
  totalFrom: urlParam.optionalNumber(),
  totalTo: urlParam.optionalNumber(),
  homeSubtotal: urlParam.optionalNumber(),
  homeSubtotalFrom: urlParam.optionalNumber(),
  homeSubtotalTo: urlParam.optionalNumber(),
  homeTax: urlParam.optionalNumber(),
  homeTaxFrom: urlParam.optionalNumber(),
  homeTaxTo: urlParam.optionalNumber(),
  homeTotal: urlParam.optionalNumber(),
  homeTotalFrom: urlParam.optionalNumber(),
  homeTotalTo: urlParam.optionalNumber(),
};

const AMOUNT_FILTERS = ['subtotal', 'tax', 'total', 'homeSubtotal', 'homeTax', 'homeTotal'] as const;

/** The list filters, sort and page encoded in the URL. */
export function processingParamsFromUrl(searchParams: URLSearchParams): ProcessingUrlParams {
  const params = parseUrlParams(PROCESSING_LIST_PARAMS, searchParams);
  // An amount filter is either one value or a range; a single value wins.
  for (const amount of AMOUNT_FILTERS) {
    if (params[amount] !== undefined) {
      params[`${amount}From`] = undefined;
      params[`${amount}To`] = undefined;
    }
  }
  return params;
}

/** The /processing URL for the given filters, leaving defaults out. */
export function processingListUrl(params: ProcessingUrlParams): string {
  return buildListUrl('/processing', PROCESSING_LIST_PARAMS, params);
}

/** The URL param spec, for `useUrlListParams`. */
export { PROCESSING_LIST_PARAMS };

/** Merges filter changes into the current params, going back to page 1 unless a page is given. */
export function applyProcessingFilters(
  prev: ProcessingDocumentSearchParams,
  filters: Partial<ProcessingFilterValues>,
): ProcessingDocumentSearchParams {
  // Convert AmountFilterValue to flat params
  const convertAmountFilter = (filter?: AmountFilterValue) => {
    if (!filter) return { single: undefined, from: undefined, to: undefined };
    if (filter.mode === 'single') return { single: filter.single, from: undefined, to: undefined };
    return { single: undefined, from: filter.range?.from, to: filter.range?.to };
  };

  // Only convert amount filters if they are provided in the filters object
  const subtotal = 'subtotalFilter' in filters ? convertAmountFilter(filters.subtotalFilter) : undefined;
  const tax = 'taxFilter' in filters ? convertAmountFilter(filters.taxFilter) : undefined;
  const total = 'totalFilter' in filters ? convertAmountFilter(filters.totalFilter) : undefined;
  const homeSubtotal = 'homeSubtotalFilter' in filters ? convertAmountFilter(filters.homeSubtotalFilter) : undefined;
  const homeTax = 'homeTaxFilter' in filters ? convertAmountFilter(filters.homeTaxFilter) : undefined;
  const homeTotal = 'homeTotalFilter' in filters ? convertAmountFilter(filters.homeTotalFilter) : undefined;

  return {
    // Handle pagination - use provided values or defaults
    page: 'page' in filters ? filters.page ?? 1 : 1, // Reset to first page on filter change unless explicitly provided
    limit: 'limit' in filters ? filters.limit ?? prev.limit : prev.limit,
    sortBy: prev.sortBy,
    sortOrder: prev.sortOrder,
    // Merge new filter values with previous values (only update if provided)
    pipelineStatus: 'pipelineStatus' in filters ? filters.pipelineStatus : prev.pipelineStatus,
    duplicateStatus: 'duplicateStatus' in filters ? filters.duplicateStatus : prev.duplicateStatus,
    revisionStatus: 'revisionStatus' in filters ? filters.revisionStatus : prev.revisionStatus,
    needsReview: 'needsReview' in filters ? filters.needsReview : prev.needsReview,
    isContainer: 'isContainer' in filters ? filters.isContainer : prev.isContainer,
    companyId: 'companyId' in filters ? filters.companyId : prev.companyId,
    uploadDatePreset: 'uploadDatePreset' in filters ? filters.uploadDatePreset : prev.uploadDatePreset,
    uploadDateFrom: 'uploadDateFrom' in filters ? filters.uploadDateFrom : prev.uploadDateFrom,
    uploadDateTo: 'uploadDateTo' in filters ? filters.uploadDateTo : prev.uploadDateTo,
    documentDateFrom: 'documentDateFrom' in filters ? filters.documentDateFrom : prev.documentDateFrom,
    documentDateTo: 'documentDateTo' in filters ? filters.documentDateTo : prev.documentDateTo,
    vendorName: 'vendorName' in filters ? filters.vendorName : prev.vendorName,
    documentNumber: 'documentNumber' in filters ? filters.documentNumber : prev.documentNumber,
    fileName: 'fileName' in filters ? filters.fileName : prev.fileName,
    documentCategory: 'documentCategory' in filters ? filters.documentCategory : prev.documentCategory,
    documentSubCategory: 'documentSubCategory' in filters ? filters.documentSubCategory : prev.documentSubCategory,
    // Tag filter
    tagIds: 'tagIds' in filters ? filters.tagIds : prev.tagIds,
    // Currency filters
    currency: 'currency' in filters ? filters.currency : prev.currency,
    homeCurrency: 'homeCurrency' in filters ? filters.homeCurrency : prev.homeCurrency,
    // Amount filters - only update if provided
    subtotal: subtotal !== undefined ? subtotal.single : prev.subtotal,
    subtotalFrom: subtotal !== undefined ? subtotal.from : prev.subtotalFrom,
    subtotalTo: subtotal !== undefined ? subtotal.to : prev.subtotalTo,
    tax: tax !== undefined ? tax.single : prev.tax,
    taxFrom: tax !== undefined ? tax.from : prev.taxFrom,
    taxTo: tax !== undefined ? tax.to : prev.taxTo,
    total: total !== undefined ? total.single : prev.total,
    totalFrom: total !== undefined ? total.from : prev.totalFrom,
    totalTo: total !== undefined ? total.to : prev.totalTo,
    homeSubtotal: homeSubtotal !== undefined ? homeSubtotal.single : prev.homeSubtotal,
    homeSubtotalFrom: homeSubtotal !== undefined ? homeSubtotal.from : prev.homeSubtotalFrom,
    homeSubtotalTo: homeSubtotal !== undefined ? homeSubtotal.to : prev.homeSubtotalTo,
    homeTax: homeTax !== undefined ? homeTax.single : prev.homeTax,
    homeTaxFrom: homeTax !== undefined ? homeTax.from : prev.homeTaxFrom,
    homeTaxTo: homeTax !== undefined ? homeTax.to : prev.homeTaxTo,
    homeTotal: homeTotal !== undefined ? homeTotal.single : prev.homeTotal,
    homeTotalFrom: homeTotal !== undefined ? homeTotal.from : prev.homeTotalFrom,
    homeTotalTo: homeTotal !== undefined ? homeTotal.to : prev.homeTotalTo,
    // Keep search separate (handled by handleSearchChange)
    search: prev.search,
  };
}
