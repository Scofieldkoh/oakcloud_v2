/**
 * Processing Documents Hooks
 *
 * React hooks for document processing operations, including
 * listing, viewing, extraction, revision management, and duplicate handling.
 *
 * @module hooks/use-processing-documents
 */

'use client';

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  usePersistSessionListSnapshot,
  useSessionListRestore,
} from '@/hooks/use-session-query-restore';
import type {
  PipelineStatus,
  DuplicateStatus,
  RevisionStatus,
  DocumentCategory,
  DocumentSubCategory,
} from '@/generated/prisma';

// Types
// Tag item for list display
export interface ProcessingDocumentTagItem {
  id: string;
  tagId: string;
  name: string;
  color: string;
  scope: 'tenant' | 'company';
}

export interface ProcessingDocumentListItem {
  id: string;
  documentId: string;
  isContainer: boolean;
  parentProcessingDocId: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  pageCount: number | null;
  pipelineStatus: PipelineStatus;
  duplicateStatus: DuplicateStatus;
  currentRevisionId: string | null;
  lockVersion: number;
  createdAt: string;
  document: {
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    companyId: string | null;
    company?: {
      id: string;
      name: string;
    };
  };
  currentRevision?: {
    id: string;
    revisionNumber: number;
    status: RevisionStatus;
    documentCategory: DocumentCategory | null;
    documentSubCategory: string | null;
    vendorName: string | null;
    documentNumber: string | null;
    documentDate: string | null;
    currency: string;
    subtotal: string | null;
    taxAmount: string | null;
    totalAmount: string;
    homeCurrency: string | null;
    homeSubtotal: string | null;
    homeTaxAmount: string | null;
    homeEquivalent: string | null;
  };
  // Tags removed - fetched lazily
}

export interface ProcessingDocumentDetail {
  id: string;
  documentId: string;
  isContainer: boolean;
  parentDocumentId: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  pageCount: number | null;
  pipelineStatus: PipelineStatus;
  duplicateStatus: DuplicateStatus;
  currentRevisionId: string | null;
  lockVersion: number;
  createdAt: string;
  pages: number;
  // Versioning
  version: number;
  rootDocumentId: string | null;
  // File details
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  // Tenant info
  tenantId: string;
  // Company info
  company?: {
    id: string;
    name: string;
  };
}

export interface RevisionSummary {
  id: string;
  revisionNumber: number;
  status: RevisionStatus;
  documentCategory: DocumentCategory | null;
  vendorName: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  totalAmount: string;
  currency: string;
  homeEquivalent: string | null;
  validationStatus: string;
  lineItemCount: number;
}

export interface ProcessingDocumentSearchParams {
  pipelineStatus?: PipelineStatus;
  duplicateStatus?: DuplicateStatus;
  revisionStatus?: RevisionStatus; // Filter by revision status (DRAFT = pending review, APPROVED)
  needsReview?: boolean;
  isContainer?: boolean;
  companyId?: string;
  tenantId?: string; // For SUPER_ADMIN to filter by specific tenant
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  // Date range filters
  uploadDatePreset?: 'TODAY';
  uploadDateFrom?: string; // ISO date string (createdAt filter)
  uploadDateTo?: string;
  documentDateFrom?: string; // ISO date string (revision.documentDate filter)
  documentDateTo?: string;
  // Text search filters
  search?: string; // General search (fileName, vendorName, documentNumber)
  vendorName?: string;
  documentNumber?: string;
  fileName?: string;
  // Category filters
  documentCategory?: DocumentCategory;
  documentSubCategory?: DocumentSubCategory;
  // Tag filter
  tagIds?: string[]; // Filter by document tags
  // Currency filters
  currency?: string; // Filter by document currency (e.g., SGD, USD)
  homeCurrency?: string; // Filter by home currency
  // Amount filters - single value mode
  subtotal?: number;
  tax?: number;
  total?: number;
  homeSubtotal?: number;
  homeTax?: number;
  homeTotal?: number;
  // Amount filters - range mode
  subtotalFrom?: number;
  subtotalTo?: number;
  taxFrom?: number;
  taxTo?: number;
  totalFrom?: number;
  totalTo?: number;
  homeSubtotalFrom?: number;
  homeSubtotalTo?: number;
  homeTaxFrom?: number;
  homeTaxTo?: number;
  homeTotalFrom?: number;
  homeTotalTo?: number;
}

export interface ProcessingDocumentSearchResult {
  documents: ProcessingDocumentListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function isProcessingDocumentSearchResult(
  value: unknown,
): value is ProcessingDocumentSearchResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProcessingDocumentSearchResult>;
  return (
    !!candidate.documents &&
    Array.isArray(candidate.documents) &&
    typeof candidate.total === 'number' &&
    typeof candidate.totalPages === 'number'
  );
}

const SELECT_ALL_FETCH_PAGE_SIZE = 200;

// API functions
async function fetchProcessingDocuments(
  params: ProcessingDocumentSearchParams
): Promise<ProcessingDocumentSearchResult> {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      // Handle arrays (like tagIds) by joining with commas
      if (Array.isArray(value)) {
        if (value.length > 0) {
          searchParams.set(key, value.join(','));
        }
      } else {
        searchParams.set(key, String(value));
      }
    }
  });

  const response = await fetch(`/api/processing-documents?${searchParams}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch processing documents');
  }
  const result = await response.json();
  return result.data;
}

async function fetchAllProcessingDocuments(
  params: ProcessingDocumentSearchParams
): Promise<ProcessingDocumentListItem[]> {
  const firstPage = await fetchProcessingDocuments({
    ...params,
    page: 1,
    limit: SELECT_ALL_FETCH_PAGE_SIZE,
  });

  if (firstPage.totalPages <= 1) {
    return firstPage.documents;
  }

  const remainingPages = Array.from(
    { length: firstPage.totalPages - 1 },
    (_value, index) => index + 2
  );

  const remainingResults = await Promise.all(
    remainingPages.map((page) =>
      fetchProcessingDocuments({
        ...params,
        page,
        limit: SELECT_ALL_FETCH_PAGE_SIZE,
      })
    )
  );

  return [
    ...firstPage.documents,
    ...remainingResults.flatMap((result) => result.documents),
  ];
}

async function fetchProcessingDocument(id: string): Promise<{
  document: ProcessingDocumentDetail;
  currentRevision: RevisionSummary | null;
}> {
  const response = await fetch(`/api/processing-documents/${id}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch processing document');
  }
  const result = await response.json();
  return result.data;
}

async function fetchRevisionHistory(documentId: string): Promise<{
  id: string;
  revisionNumber: number;
  status: RevisionStatus;
  revisionType: string;
  documentCategory: DocumentCategory | null;
  vendorName: string | null;
  totalAmount: string;
  currency: string;
  createdAt: string;
  approvedAt: string | null;
  supersededAt: string | null;
}[]> {
  const response = await fetch(`/api/processing-documents/${documentId}/revisions`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch revision history');
  }
  const result = await response.json();
  return result.data.revisions;
}

interface TriggerExtractionOptions {
  documentId: string;
  model?: string;
  context?: string;
  batchMode?: boolean;
}

async function triggerExtraction(options: TriggerExtractionOptions): Promise<{
  extractionId?: string;
  revisionId?: string;
  jobId?: string;
  estimatedCompletionSeconds?: number;
}> {
  const { documentId, model, context, batchMode } = options;
  const body: { model?: string; context?: string; batchMode?: boolean } = {};
  if (model) body.model = model;
  if (context) body.context = context;
  if (batchMode) body.batchMode = true;

  const response = await fetch(`/api/processing-documents/${documentId}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to trigger extraction');
  }
  const result = await response.json();
  return result.data;
}

async function reconcileProcessingDocument(documentId: string): Promise<{ status: string }> {
  const response = await fetch(`/api/processing-documents/${documentId}/reconcile`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to reconcile document');
  }
  const result = await response.json();
  return result.data;
}

async function acquireLock(
  documentId: string,
  lockVersion: number
): Promise<{ lockedAt: string; lockVersion: number }> {
  const response = await fetch(`/api/processing-documents/${documentId}/lock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': lockVersion.toString(),
    },
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to acquire lock');
  }
  const result = await response.json();
  return result.data;
}

async function releaseLock(
  documentId: string,
  lockVersion: number
): Promise<{ lockVersion: number }> {
  const response = await fetch(`/api/processing-documents/${documentId}/unlock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': lockVersion.toString(),
    },
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to release lock');
  }
  const result = await response.json();
  return result.data;
}

async function approveRevision(
  documentId: string,
  revisionId: string,
  lockVersion: number,
  body?: {
    aliasLearning?: {
      vendor?: 'AUTO' | 'FORCE' | 'SKIP';
      customer?: 'AUTO' | 'FORCE' | 'SKIP';
    };
  }
): Promise<{ revisionId: string; lockVersion: number }> {
  const response = await fetch(
    `/api/processing-documents/${documentId}/revisions/${revisionId}/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': lockVersion.toString(),
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to approve revision');
  }
  const result = await response.json();
  return result.data;
}

async function recordDuplicateDecision(
  documentId: string,
  suspectedOfId: string,
  decision: 'CONFIRM_DUPLICATE' | 'REJECT_DUPLICATE' | 'MARK_AS_NEW_VERSION',
  reason?: string
): Promise<{ documentId: string; suspectedOfId: string; decision: string }> {
  const response = await fetch(`/api/processing-documents/${documentId}/duplicate-decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suspectedOfId, decision, reason }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to record duplicate decision');
  }
  const result = await response.json();
  return result.data;
}

// Hooks
export function processingDocumentsQueryKey(
  params: ProcessingDocumentSearchParams,
): readonly unknown[] {
  return [
    'processing-documents',
    params.pipelineStatus,
    params.duplicateStatus,
    params.revisionStatus,
    params.needsReview,
    params.isContainer,
    params.companyId,
    params.tenantId,
    params.page,
    params.limit,
    params.sortBy,
    params.sortOrder,
    // Date filter parameters
    params.uploadDatePreset,
    params.uploadDateFrom,
    params.uploadDateTo,
    params.documentDateFrom,
    params.documentDateTo,
    // Text search filters
    params.search,
    params.vendorName,
    params.documentNumber,
    params.fileName,
    // Category filters
    params.documentCategory,
    params.documentSubCategory,
    // Tag filter
    params.tagIds,
    // Currency filters
    params.currency,
    params.homeCurrency,
    // Amount filters - single value
    params.subtotal,
    params.tax,
    params.total,
    params.homeSubtotal,
    params.homeTax,
    params.homeTotal,
    // Amount filters - range
    params.subtotalFrom,
    params.subtotalTo,
    params.taxFrom,
    params.taxTo,
    params.totalFrom,
    params.totalTo,
    params.homeSubtotalFrom,
    params.homeSubtotalTo,
    params.homeTaxFrom,
    params.homeTaxTo,
    params.homeTotalFrom,
    params.homeTotalTo,
  ];
}

export function useProcessingDocuments(
  params: ProcessingDocumentSearchParams = {},
  options: { restoreSession?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const restoreSession = options.restoreSession === true;
  const queryKey = processingDocumentsQueryKey(params);
  const { initialData, restoredFromSession } = useSessionListRestore<ProcessingDocumentSearchResult>(
    queryClient,
    queryKey,
    { enabled: restoreSession, validate: isProcessingDocumentSearchResult },
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchProcessingDocuments(params),
    // Processing status changes frequently while extraction jobs are running.
    staleTime: 15 * 1000,
    gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache
    refetchOnMount: 'always',
    placeholderData: (previousData) => previousData, // Keep previous data visible while fetching
    initialData,
    initialDataUpdatedAt: restoredFromSession ? 0 : undefined,
  });

  usePersistSessionListSnapshot(queryKey, restoreSession ? query.data : undefined);

  return query;
}

export function useSelectAllProcessingDocuments() {
  return useMutation({
    mutationFn: async (params: ProcessingDocumentSearchParams) => {
      const documents = await fetchAllProcessingDocuments(params);
      return {
        ids: documents.map((document) => document.id),
        documents,
      };
    },
  });
}

export function useProcessingDocument(id: string) {
  return useQuery({
    queryKey: ['processing-document', id],
    queryFn: () => fetchProcessingDocument(id),
    enabled: !!id,
    staleTime: 2 * 60 * 1000, // Serve cached data immediately, then refresh on mount/focus.
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnMount: 'always',
  });
}

// ============================================================================
// Consolidated View Hook - Single API call for initial page load
// ============================================================================

/**
 * Consolidated document view data returned by the /view endpoint
 * Combines document, revision, and pages in a single request
 * Tags are loaded separately for better performance
 */
export interface ProcessingDocumentViewData {
  document: ProcessingDocumentDetail & {
    company: { id: string; name: string; homeCurrency: string } | null;
  };
  currentRevision: RevisionWithLineItems | null;
  pages: DocumentPagesResult;
  // Tags removed - loaded lazily via separate endpoint
}

/**
 * Fetch consolidated document view data for initial page load
 * This replaces multiple individual API calls with a single request
 */
async function fetchProcessingDocumentView(id: string): Promise<ProcessingDocumentViewData> {
  const response = await fetch(`/api/processing-documents/${id}/view`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch document view');
  }
  const result = await response.json();
  return result.data;
}

/**
 * Hook for fetching consolidated document view data
 *
 * Replaces the need for multiple hooks on initial page load:
 * - useProcessingDocument (document + revision summary)
 * - useDocumentPages (page metadata)
 * - useRevisionWithLineItems (full revision)
 *
 * Tags are loaded separately via useDocumentTags for better performance
 *
 * @param id - Processing document ID
 * @returns Consolidated view data with document, revision, and pages
 */
export function useProcessingDocumentView(id: string) {
  return useQuery({
    queryKey: ['processing-document-view', id],
    queryFn: () => fetchProcessingDocumentView(id),
    enabled: !!id,
    // The detail page is used to monitor live extraction progress, so always refresh on reopen.
    staleTime: 0,
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnMount: 'always',
  });
}

/**
 * Prefetch the next document view data for faster navigation during approval workflow
 * This should be called after the current document finishes loading
 */
export function usePrefetchNextDocument() {
  const queryClient = useQueryClient();

  return useCallback((nextDocumentId: string | null | undefined) => {
    if (!nextDocumentId) return;

    // Prefetch the document view data
    queryClient.prefetchQuery({
      queryKey: ['processing-document-view', nextDocumentId],
      queryFn: () => fetchProcessingDocumentView(nextDocumentId),
      staleTime: 30_000,
    });
  }, [queryClient]);
}

export function useRevisionHistory(documentId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['revision-history', documentId],
    queryFn: () => fetchRevisionHistory(documentId),
    enabled: !!documentId && enabled,
    staleTime: 2 * 60 * 1000, // Serve cached data immediately, then refresh on mount/focus.
    refetchOnMount: 'always',
  });
}

export function useTriggerExtraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (options: TriggerExtractionOptions) => triggerExtraction(options),
    onSuccess: (_, options) => {
      queryClient.invalidateQueries({ queryKey: ['processing-document', options.documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-document-view', options.documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-documents'] });
    },
  });
}

export function useReconcileProcessingDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (documentId: string) => reconcileProcessingDocument(documentId),
    onSuccess: (_, documentId) => {
      queryClient.invalidateQueries({ queryKey: ['processing-document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-document-view', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-documents'] });
    },
  });
}

export function useAcquireLock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, lockVersion }: { documentId: string; lockVersion: number }) =>
      acquireLock(documentId, lockVersion),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: ['processing-document', documentId] });
    },
  });
}

export function useReleaseLock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, lockVersion }: { documentId: string; lockVersion: number }) =>
      releaseLock(documentId, lockVersion),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: ['processing-document', documentId] });
    },
  });
}

export function useApproveRevision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      revisionId,
      lockVersion,
      body,
    }: {
      documentId: string;
      revisionId: string;
      lockVersion: number;
      body?: {
        aliasLearning?: {
          vendor?: 'AUTO' | 'FORCE' | 'SKIP';
          customer?: 'AUTO' | 'FORCE' | 'SKIP';
        };
      };
    }) => approveRevision(documentId, revisionId, lockVersion, body),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: ['processing-document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-document-view', documentId] });
      queryClient.invalidateQueries({ queryKey: ['revision-history', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-documents'] });
    },
  });
}

export function useRecordDuplicateDecision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      suspectedOfId,
      decision,
      reason,
    }: {
      documentId: string;
      suspectedOfId: string;
      decision: 'CONFIRM_DUPLICATE' | 'REJECT_DUPLICATE' | 'MARK_AS_NEW_VERSION';
      reason?: string;
    }) => recordDuplicateDecision(documentId, suspectedOfId, decision, reason),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: ['processing-document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-documents'] });
      queryClient.invalidateQueries({ queryKey: ['duplicate-comparison', documentId] });
    },
  });
}

// Page types
export interface DocumentPageInfo {
  id: string;
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  dpi: number;
  imageUrl: string;
  fingerprint: string | null;
  ocrProvider: string | null;
  textAcquisition: string | null;
  createdAt: string;
}

export interface DocumentPagesResult {
  documentId: string;
  pageCount: number;
  pages: DocumentPageInfo[];
  // PDF-specific fields for client-side rendering
  isPdf: boolean;
  pdfUrl: string | null;
}

// Fetch document pages
async function fetchDocumentPages(documentId: string): Promise<DocumentPagesResult> {
  const response = await fetch(`/api/processing-documents/${documentId}/pages`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch document pages');
  }
  const result = await response.json();
  return result.data;
}

export function useDocumentPages(documentId: string) {
  return useQuery({
    queryKey: ['document-pages', documentId],
    queryFn: () => fetchDocumentPages(documentId),
    enabled: !!documentId,
    staleTime: 5 * 60 * 1000, // 5 minutes - pages rarely change
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnMount: 'always',
  });
}

// Line item types
export interface LineItemData {
  id: string;
  lineNo: number;
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  amount: string;
  gstAmount: string | null;
  taxCode: string | null;
  accountCode: string | null;
  evidenceJson: Record<string, unknown> | null;
  // Phase 2: Home currency line item fields
  homeAmount: string | null;
  homeGstAmount: string | null;
  isHomeAmountOverride: boolean;
  isHomeGstOverride: boolean;
}

export interface CounterpartyIdentityDraft {
  identificationType?: 'NRIC' | 'FIN' | 'PASSPORT' | 'UEN' | 'OTHER';
  identificationNumber?: string;
  fullAddress?: string;
  email?: string;
  phone?: string;
  confidence: Partial<Record<'identificationNumber' | 'fullAddress' | 'email' | 'phone', number>>;
}

export interface RevisionWithLineItems {
  id: string;
  revisionNumber: number;
  status: RevisionStatus;
  documentCategory: DocumentCategory | null;
  documentSubCategory: string | null;
  vendorName: string | null;
  counterpartyIdentity: CounterpartyIdentityDraft | null;
  documentNumber: string | null;
  documentDate: string | null;
  dueDate: string | null;
  currency: string;
  subtotal: string | null;
  taxAmount: string | null;
  totalAmount: string;
  gstTreatment: string | null;
  validationStatus: string;
  validationIssues: Record<string, unknown> | null;
  headerEvidenceJson: Record<string, unknown> | null;
  // Phase 2: Home currency header fields
  homeCurrency: string | null;
  homeExchangeRate: string | null;
  homeExchangeRateSource: string | null;
  exchangeRateDate: string | null;
  homeSubtotal: string | null;
  homeTaxAmount: string | null;
  homeEquivalent: string | null;
  isHomeExchangeRateOverride: boolean;
  lineItems: LineItemData[];
}

// Fetch revision with line items
async function fetchRevisionWithLineItems(
  documentId: string,
  revisionId: string,
  revalidate: boolean = false
): Promise<RevisionWithLineItems> {
  const url = revalidate
    ? `/api/processing-documents/${documentId}/revisions/${revisionId}?revalidate=true`
    : `/api/processing-documents/${documentId}/revisions/${revisionId}`;
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch revision');
  }
  const result = await response.json();
  return result.data;
}

export function useRevisionWithLineItems(documentId: string, revisionId: string | null, revalidate: boolean = true) {
  return useQuery({
    queryKey: ['revision-line-items', documentId, revisionId, revalidate],
    queryFn: () => fetchRevisionWithLineItems(documentId, revisionId!, revalidate),
    enabled: !!documentId && !!revisionId,
    staleTime: 2 * 60 * 1000, // Serve cached data immediately, then refresh on mount/focus.
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnMount: 'always',
  });
}

// Update revision with line item changes
async function updateRevision(
  documentId: string,
  revisionId: string,
  lockVersion: number,
  data: {
    headerUpdates?: Partial<{
      documentCategory: string;
      documentSubCategory: string | null;
      vendorName: string;
      counterpartyIdentity: CounterpartyIdentityDraft;
      documentNumber: string;
      documentDate: string;
      dueDate: string;
      currency: string;
      subtotal: string;
      taxAmount: string;
      totalAmount: string;
      gstTreatment: string;
      supplierGstNo: string;
      // Phase 2: Home currency header fields
      homeCurrency: string;
      homeExchangeRate: string;
      homeExchangeRateSource: string;
      exchangeRateDate: string;
      homeSubtotal: string;
      homeTaxAmount: string;
      homeEquivalent: string;
      isHomeExchangeRateOverride: boolean;
    }>;
    itemsToUpsert?: Array<{
      id?: string;
      lineNo: number;
      description: string;
      quantity?: string;
      unitPrice?: string;
      amount: string;
      gstAmount?: string;
      taxCode?: string;
      accountCode?: string;
      // Phase 2: Home currency line item fields
      homeAmount?: string;
      homeGstAmount?: string;
      isHomeAmountOverride?: boolean;
      isHomeGstOverride?: boolean;
    }>;
    itemsToDelete?: string[];
  }
): Promise<{ revisionId: string; lockVersion: number }> {
  const response = await fetch(`/api/processing-documents/${documentId}/revisions/${revisionId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': lockVersion.toString(),
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to update revision');
  }
  const result = await response.json();
  return result.data;
}

export function useUpdateRevision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      revisionId,
      lockVersion,
      data,
    }: {
      documentId: string;
      revisionId: string;
      lockVersion: number;
      data: Parameters<typeof updateRevision>[3];
    }) => updateRevision(documentId, revisionId, lockVersion, data),
    onSuccess: (_, { documentId, revisionId }) => {
      queryClient.invalidateQueries({ queryKey: ['revision-line-items', documentId, revisionId] });
      queryClient.invalidateQueries({ queryKey: ['processing-document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['revision-history', documentId] });
    },
  });
}

// Bulk operations
type BulkOperation = 'APPROVE' | 'TRIGGER_EXTRACTION' | 'DELETE';

interface BulkResult {
  documentId: string;
  success: boolean;
  error?: string;
}

interface BulkOperationResponse {
  operation: BulkOperation;
  results: BulkResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

async function executeBulkOperation(
  operation: BulkOperation,
  documentIds: string[]
): Promise<BulkOperationResponse> {
  const response = await fetch('/api/processing-documents/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, documentIds }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to execute bulk operation');
  }
  const result = await response.json();
  return result.data;
}

export function useBulkOperation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ operation, documentIds }: { operation: BulkOperation; documentIds: string[] }) =>
      executeBulkOperation(operation, documentIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processing-documents'] });
    },
  });
}

// Bulk download types and hook
interface DownloadInfo {
  documentId: string;
  fileName: string;
  downloadUrl: string;
  mimeType: string;
  fileSize: number;
}

interface BulkDownloadResponse {
  downloads: DownloadInfo[];
  errors: { documentId: string; error: string }[];
  summary: {
    total: number;
    available: number;
    failed: number;
  };
}

async function fetchBulkDownloadInfo(documentIds: string[]): Promise<BulkDownloadResponse> {
  const response = await fetch('/api/processing-documents/bulk-download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentIds }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to get download info');
  }
  const result = await response.json();
  return result.data;
}

export function useBulkDownload() {
  return useMutation({
    mutationFn: (documentIds: string[]) => fetchBulkDownloadInfo(documentIds),
  });
}

// ============================================================================
// Document Navigation (for review workflow)
// ============================================================================

export interface DocumentNavigationResult {
  total: number;
  currentIndex: number;
  currentDocumentId: string | null;
  prevId: string | null;
  nextId: string | null;
}

/**
 * Hook for navigating between documents that need review
 * Filters by: DRAFT status, suspected duplicate, or validation WARNINGS/INVALID
 */
export function useDocumentNavigation(
  currentDocumentId: string,
  filter: 'all' | 'needs-review' = 'needs-review',
  options?: {
    tenantId?: string | null;
    companyId?: string;
    start?: boolean;
  },
  enabled: boolean = true
) {
  return useQuery({
    queryKey: ['document-navigation', currentDocumentId, filter, options?.tenantId ?? null, options?.companyId ?? null, options?.start ?? false],
    queryFn: async (): Promise<DocumentNavigationResult> => {
      const params = new URLSearchParams();
      params.set('filter', filter);
      if (options?.start) params.set('start', 'true');
      if (!options?.start) params.set('currentDocumentId', currentDocumentId);
      if (options?.tenantId) params.set('tenantId', options.tenantId);
      if (options?.companyId) params.set('companyId', options.companyId);

      const response = await fetch(`/api/processing-documents/navigation?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch documents for navigation');
      }
      const result = await response.json();
      return result.data as DocumentNavigationResult;
    },
    enabled: !!currentDocumentId && enabled,
    // For start=true (count queries on list page), use short staleTime for accurate counts
    // For navigation within detail page, use longer staleTime for performance
    staleTime: options?.start ? 30_000 : 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnMount: 'always',
  });
}

// ============================================================================
// Duplicate Comparison
// ============================================================================

export interface DuplicateComparisonData {
  currentDocument: {
    id: string;
    fileName?: string;
    pipelineStatus: string;
    approvalStatus: string;
    createdAt: string;
    revision: RevisionWithLineItems | null;
    pdfUrl: string;
    pages: Array<{
      pageNumber: number;
      imageUrl: string;
      width: number;
      height: number;
    }>;
  };
  duplicateDocument: {
    id: string;
    fileName?: string;
    pipelineStatus: string;
    approvalStatus: string;
    createdAt: string;
    revision: RevisionWithLineItems | null;
    pdfUrl: string;
    pages: Array<{
      pageNumber: number;
      imageUrl: string;
      width: number;
      height: number;
    }>;
  };
  comparison: {
    duplicateScore: number | null;
    duplicateReason: string | null;
    fieldComparison: Array<{
      field: string;
      currentValue: string | null;
      duplicateValue: string | null;
      isMatch: boolean;
    }>;
  };
}

async function fetchDuplicateComparison(documentId: string): Promise<DuplicateComparisonData> {
  const response = await fetch(`/api/processing-documents/${documentId}/duplicate-of`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch duplicate comparison');
  }
  const result = await response.json();
  return result.data;
}

/**
 * Hook for fetching duplicate comparison data for side-by-side view
 */
export function useDuplicateComparison(documentId: string, enabled = true) {
  return useQuery({
    queryKey: ['duplicate-comparison', documentId],
    queryFn: () => fetchDuplicateComparison(documentId),
    enabled: enabled && !!documentId,
    staleTime: 30_000,
    retry: false, // Don't retry if no duplicate exists
  });
}

// ============================================================================
// Page Rotation
// ============================================================================

async function updatePageRotation(
  documentId: string,
  pageNumber: number,
  rotation: number
): Promise<{ id: string; pageNumber: number; rotation: number }> {
  const response = await fetch(`/api/processing-documents/${documentId}/pages/${pageNumber}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rotation }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to update page rotation');
  }
  const result = await response.json();
  return result.data;
}

/**
 * Hook for updating page rotation
 */
export function useUpdatePageRotation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      pageNumber,
      rotation,
    }: {
      documentId: string;
      pageNumber: number;
      rotation: number;
    }) => updatePageRotation(documentId, pageNumber, rotation),
    onSuccess: (_, { documentId }) => {
      // Invalidate document pages to reflect the new rotation
      queryClient.invalidateQueries({ queryKey: ['document-pages', documentId] });
    },
  });
}

// ============================================================================
// Create New Revision (for editing approved documents)
// ============================================================================

interface CreateRevisionInput {
  basedOnRevisionId?: string;
  reason?: string;
  patch?: {
    set?: Partial<{
      documentCategory: string;
      vendorName: string;
      documentNumber: string;
      documentDate: string;
      dueDate: string;
      currency: string;
      subtotal: string;
      taxAmount: string;
      totalAmount: string;
      gstTreatment: string;
      supplierGstNo: string;
    }>;
    itemsToUpsert?: Array<{
      lineNo: number;
      description: string;
      quantity?: string;
      unitPrice?: string;
      amount: string;
      gstAmount?: string;
      taxCode?: string;
      accountCode?: string;
    }>;
    itemsToDelete?: number[];
  };
}

interface CreateRevisionResult {
  revision: {
    id: string;
    revisionNumber: number;
    status: string;
    revisionType: string;
    basedOnRevisionId: string | null;
  };
  document: {
    lockVersion: number;
  };
}

async function createRevision(
  documentId: string,
  lockVersion: number,
  input: CreateRevisionInput
): Promise<CreateRevisionResult> {
  const response = await fetch(`/api/processing-documents/${documentId}/revisions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': lockVersion.toString(),
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to create revision');
  }
  const result = await response.json();
  return result.data;
}

/**
 * Hook for creating a new revision from an existing one (for editing approved documents)
 */
export function useCreateRevision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      lockVersion,
      input,
    }: {
      documentId: string;
      lockVersion: number;
      input: CreateRevisionInput;
    }) => createRevision(documentId, lockVersion, input),
    onSuccess: (data, { documentId }) => {
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ['processing-document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['revision-history', documentId] });
      queryClient.invalidateQueries({
        queryKey: ['revision-line-items', documentId, data.revision.id],
      });
      queryClient.invalidateQueries({ queryKey: ['processing-documents'] });
    },
  });
}

// ============================================================================
// Document Links
// ============================================================================

export interface DocumentLink {
  id: string;
  documentId: string;
  fileName: string;
  pipelineStatus: string;
  documentCategory: string | null;
  vendorName: string | null;
  documentNumber: string | null;
  totalAmount: string | null;
  currency: string | null;
  revisionStatus: string | null;
  linkId: string;
  linkType: string;
  linkTypeLabel: string;
  linkDirection: 'source' | 'target';
  notes: string | null;
  linkedAt: string;
}

export interface LinkableDocument {
  id: string;
  fileName: string;
  documentCategory: string | null;
  vendorName: string | null;
  documentNumber: string | null;
  totalAmount: string | null;
  currency: string | null;
  createdAt: string;
}

async function fetchDocumentLinks(documentId: string): Promise<DocumentLink[]> {
  const response = await fetch(`/api/processing-documents/${documentId}/links`);
  if (!response.ok) {
    throw new Error('Failed to fetch document links');
  }
  const result = await response.json();
  return result.data.links;
}

async function searchLinkableDocuments(
  documentId: string,
  searchQuery: string
): Promise<LinkableDocument[]> {
  const response = await fetch(
    `/api/processing-documents/${documentId}/links?search=${encodeURIComponent(searchQuery)}`
  );
  if (!response.ok) {
    throw new Error('Failed to search linkable documents');
  }
  const result = await response.json();
  return result.data.documents;
}

async function createDocumentLink(
  documentId: string,
  targetDocumentId: string,
  linkType: string,
  notes?: string
): Promise<{ link: DocumentLink }> {
  const response = await fetch(`/api/processing-documents/${documentId}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetDocumentId, linkType, notes }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to create link');
  }
  const result = await response.json();
  return result.data;
}

async function deleteDocumentLink(
  documentId: string,
  linkId: string
): Promise<void> {
  const response = await fetch(
    `/api/processing-documents/${documentId}/links/${linkId}`,
    { method: 'DELETE' }
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to delete link');
  }
}

/**
 * Hook to fetch document links
 */
export function useDocumentLinks(documentId: string | null) {
  return useQuery({
    queryKey: ['document-links', documentId],
    queryFn: () => fetchDocumentLinks(documentId!),
    enabled: !!documentId,
  });
}

/**
 * Hook to search for linkable documents
 */
export function useLinkableDocuments(documentId: string | null, searchQuery: string) {
  return useQuery({
    queryKey: ['linkable-documents', documentId, searchQuery],
    queryFn: () => searchLinkableDocuments(documentId!, searchQuery),
    enabled: !!documentId && searchQuery.length >= 0, // Always enabled when documentId exists
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to create a document link
 */
export function useCreateDocumentLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      targetDocumentId,
      linkType,
      notes,
    }: {
      documentId: string;
      targetDocumentId: string;
      linkType: string;
      notes?: string;
    }) => createDocumentLink(documentId, targetDocumentId, linkType, notes),
    onSuccess: (_, { documentId, targetDocumentId }) => {
      // Invalidate links for both documents
      queryClient.invalidateQueries({ queryKey: ['document-links', documentId] });
      queryClient.invalidateQueries({ queryKey: ['document-links', targetDocumentId] });
      queryClient.invalidateQueries({ queryKey: ['linkable-documents', documentId] });
    },
  });
}

/**
 * Hook to delete a document link
 */
export function useDeleteDocumentLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      linkId,
    }: {
      documentId: string;
      linkId: string;
    }) => deleteDocumentLink(documentId, linkId),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: ['document-links', documentId] });
      queryClient.invalidateQueries({ queryKey: ['linkable-documents', documentId] });
    },
  });
}

// ============================================================================
// Bulk ZIP Download
// ============================================================================

/**
 * Hook for downloading multiple documents as a ZIP file
 */
export function useBulkDownloadZip() {
  return useMutation({
    mutationFn: async (documentIds: string[]) => {
      const response = await fetch('/api/processing-documents/bulk-download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to download ZIP');
      }
      return response.blob();
    },
  });
}

// ============================================================================
// Bulk Excel Export
// ============================================================================

/**
 * Hook for exporting multiple documents to Excel
 */
export function useBulkExport() {
  return useMutation({
    mutationFn: async (documentIds: string[]) => {
      const response = await fetch('/api/processing-documents/bulk-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to export');
      }
      return response.blob();
    },
  });
}

// ============================================================================
// Single Document Export
// ============================================================================

/**
 * Hook for exporting a single document to Excel with optional linked documents
 */
export function useDocumentExport() {
  return useMutation({
    mutationFn: async ({
      documentId,
      includeLinked,
    }: {
      documentId: string;
      includeLinked: boolean;
    }) => {
      const url = `/api/processing-documents/${documentId}/export${includeLinked ? '?includeLinked=true' : ''}`;
      const response = await fetch(url);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to export');
      }
      return response.blob();
    },
  });
}

// ============================================================================
// AI Models (for extraction model selection)
// ============================================================================

export interface AvailableAIModel {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  description: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

export interface AIModelsResponse {
  models: AvailableAIModel[];
  modelsByProvider: Record<string, AvailableAIModel[]>;
  availableProviders: string[];
}

async function fetchAvailableAIModels(): Promise<AIModelsResponse> {
  const response = await fetch('/api/ai-models');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch AI models');
  }
  const result = await response.json();
  return result.data;
}

/**
 * Hook to fetch available AI models for the current tenant
 */
export function useAvailableAIModels() {
  return useQuery({
    queryKey: ['ai-models'],
    queryFn: fetchAvailableAIModels,
    staleTime: 5 * 60 * 1000, // 5 minutes - models don't change often
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}



// ============================================================================
// Bulk Merge Documents
// ============================================================================

interface BulkMergeResult {
  success: boolean;
  mergedDocumentId: string;
  sourceDocumentIds: string[];
  pageCount: number;
  sourceDocumentsDeleted: boolean;
}

/**
 * Hook for merging multiple documents into a single PDF
 */
export function useBulkMerge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentIds: string[]): Promise<BulkMergeResult> => {
      const response = await fetch('/api/processing-documents/bulk-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to merge documents');
      }
      const result = await response.json();
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processing-documents'] });
    },
  });
}

// ============================================================================
// Append Pages
// ============================================================================

interface AppendPagesResult {
  documentId: string;
  pagesAdded: number;
  newPageCount: number;
  newPages: Array<{ id: string; pageNumber: number }>;
}

/**
 * Hook for appending pages (PDFs or images) to an existing document
 */
export function useAppendPages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      documentId,
      files,
    }: {
      documentId: string;
      files: File[];
    }): Promise<AppendPagesResult> => {
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));

      const response = await fetch(`/api/processing-documents/${documentId}/pages/append`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to append pages');
      }

      const result = await response.json();
      return result.data;
    },
    onSuccess: (_, { documentId }) => {
      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ['document-pages', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-document-view', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-document', documentId] });
    },
  });
}

// ============================================================================
// Reorder Pages
// ============================================================================

interface ReorderPagesResult {
  documentId: string;
  pageCount: number;
  reordered: boolean;
  pageMapping?: Array<{ oldPageNumber: number; newPageNumber: number }>;
  message?: string;
}

/**
 * Hook for reordering pages within a document
 */
export function useReorderPages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      documentId,
      newOrder,
    }: {
      documentId: string;
      newOrder: number[]; // Array of page numbers in new order (1-indexed)
    }): Promise<ReorderPagesResult> => {
      const response = await fetch(`/api/processing-documents/${documentId}/pages/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newOrder }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to reorder pages');
      }

      const result = await response.json();
      return result.data;
    },
    onSuccess: (_, { documentId }) => {
      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ['document-pages', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-document-view', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-document', documentId] });
    },
  });
}

// Result type for delete pages
interface DeletePagesResult {
  documentId: string;
  pagesDeleted: number;
  newPageCount: number;
  deletedPageNumbers: number[];
}

/**
 * Hook to delete pages from a processing document
 */
export function useDeletePages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      documentId,
      pageNumbers,
    }: {
      documentId: string;
      pageNumbers: number[]; // Array of page numbers to delete (1-indexed)
    }): Promise<DeletePagesResult> => {
      const response = await fetch(`/api/processing-documents/${documentId}/pages/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageNumbers }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to delete pages');
      }

      const result = await response.json();
      return result.data;
    },
    onSuccess: (_, { documentId }) => {
      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ['document-pages', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-document-view', documentId] });
      queryClient.invalidateQueries({ queryKey: ['processing-document', documentId] });
    },
  });
}
