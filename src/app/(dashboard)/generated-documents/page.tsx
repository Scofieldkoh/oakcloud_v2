'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  Plus,
  AlertCircle,
  Search,
  X,
  Clock,
  CheckCircle,
  Archive,
  CalendarDays,
  Download,
  Trash2,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DocumentDeleteDialog } from '@/components/documents/document-delete-dialog';
import { useToast } from '@/components/ui/toast';
import { usePermissions } from '@/hooks/use-permissions';
import { useSelection } from '@/hooks/use-selection';
import { FilterChip } from '@/components/ui/filter-chip';
import { ListEmptyState } from '@/components/ui/empty-state';
import { BulkActionsToolbar } from '@/components/ui/bulk-actions-toolbar';
import { cn } from '@/lib/utils';
import {
  readSessionListSnapshot,
  writeSessionListSnapshot,
} from '@/hooks/use-session-query-restore';
import {
  DocumentTable,
  type GeneratedDocument,
  type GeneratedDocumentFilters,
  type GeneratedDocumentSortField,
  type GeneratedDocumentSortOrder,
} from '@/components/documents/document-table';
import { GenerationBatchTable } from '@/components/documents/generation-batch';
import { Pagination } from '@/components/ui/pagination';
import type { DocumentGenerationBatchListItem } from '@/types/document-generation-batch';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';
import { useUrlListParams } from '@/hooks/use-url-list-params';
import { parseUrlParams, urlParam, type UrlParamSpec } from '@/lib/url-list-params';

// ============================================================================
// Types
// ============================================================================

interface DocumentListResponse {
  documents: GeneratedDocument[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_LABELS: Record<GeneratedDocument['status'], string> = {
  DRAFT: 'Draft',
  FINALIZED: 'Finalized',
  ARCHIVED: 'Archived',
};

function generatedDocumentsListKey(
  page: number,
  searchQuery: string,
  filters: GeneratedDocumentFilters,
): readonly unknown[] {
  return [
    'generated-documents',
    page,
    searchQuery,
    filters.title,
    filters.companyId,
    filters.companyName,
    filters.templateName,
    filters.status,
    filters.createdBy,
    filters.signedFrom,
    filters.signedTo,
    filters.updatedFrom,
    filters.updatedTo,
    filters.sortBy,
    filters.sortOrder,
  ];
}

function isDocumentListResponse(value: unknown): value is DocumentListResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DocumentListResponse>;
  return (
    !!candidate.documents &&
    Array.isArray(candidate.documents) &&
    typeof candidate.total === 'number'
  );
}

function toLocalDateString(date?: Date): string | undefined {
  if (!date) return undefined;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface DocumentListParams extends Omit<GeneratedDocumentFilters, 'sortBy' | 'sortOrder'> {
  query: string;
  page: number;
  sortBy: GeneratedDocumentSortField;
  sortOrder: GeneratedDocumentSortOrder;
}

/** Search, filters, sort and page kept in the /generated-documents URL. */
const DOCUMENT_LIST_PARAMS: UrlParamSpec<DocumentListParams> = {
  query: urlParam.string('', { key: 'q' }),
  title: urlParam.optional(),
  companyId: urlParam.optional(),
  companyName: urlParam.optional(),
  templateName: urlParam.optional(),
  status: urlParam.optional<GeneratedDocument['status']>(),
  createdBy: urlParam.optional(),
  signedFrom: urlParam.optional(),
  signedTo: urlParam.optional(),
  updatedFrom: urlParam.optional(),
  updatedTo: urlParam.optional(),
  sortBy: urlParam.choice<GeneratedDocumentSortField>('updatedAt'),
  sortOrder: urlParam.choice<GeneratedDocumentSortOrder>('desc'),
  page: urlParam.int(1),
};

/** Older links use `company` for the company name, and any sort order other than asc means desc. */
function documentListParamsFromUrl(searchParams: URLSearchParams): DocumentListParams {
  const params = parseUrlParams(DOCUMENT_LIST_PARAMS, searchParams);
  return {
    ...params,
    companyName: params.companyName ?? (searchParams.get('company') || undefined),
    sortOrder: params.sortOrder === 'asc' ? 'asc' : 'desc',
  };
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function GeneratedDocumentsPage() {
  const { params: listParams, setParams: setListParams, updateParams } = useUrlListParams(
    '/generated-documents',
    DOCUMENT_LIST_PARAMS,
    documentListParamsFromUrl,
  );
  const { query: searchQuery, page } = listParams;
  // A stable object, so the fetch only reruns when a filter changes.
  const filters = useMemo<GeneratedDocumentFilters>(() => {
    const { query: _query, page: _page, ...rest } = listParams;
    return rest;
  }, [listParams]);
  const { success, error: toastError } = useToast();
  const { can } = usePermissions();

  // Permission checks
  const canCreate = can.createDocument;
  const canUpdate = can.updateDocument;
  const canDelete = can.deleteDocument;
  const canExport = can.exportDocument;

  // The list snapshot for the URL's list state, restored when this page is
  // mounted cold (e.g. browser Back).
  const [initialListSnapshot] = useState<DocumentListResponse | undefined>(() => {
    const snapshot = readSessionListSnapshot<DocumentListResponse>(
      generatedDocumentsListKey(page, searchQuery, filters),
    );
    return isDocumentListResponse(snapshot) ? snapshot : undefined;
  });

  // State
  const [documents, setDocuments] = useState<GeneratedDocument[]>(
    () => initialListSnapshot?.documents ?? [],
  );
  const [total, setTotal] = useState(() => initialListSnapshot?.total ?? 0);
  const [isLoading, setIsLoading] = useState(() => initialListSnapshot === undefined);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null);
  const [draftToDiscard, setDraftToDiscard] = useState<string | null>(null);
  const [batches, setBatches] = useState<DocumentGenerationBatchListItem[]>([]);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [isDiscardingBatch, setIsDiscardingBatch] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);

  // Selection state for bulk operations
  const {
    selectedIds,
    selectedCount,
    isAllSelected,
    isIndeterminate,
    toggleOne,
    toggleAll,
    clear: clearSelection,
  } = useSelection(documents);

  const limit = 20; // More items per page for list view
  const firstFetchRef = useRef(true);

  // Fetch documents
  const fetchDocuments = useCallback(async () => {
    const hasRestoredSnapshot = firstFetchRef.current && initialListSnapshot !== undefined;
    firstFetchRef.current = false;
    if (!hasRestoredSnapshot) setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('query', searchQuery);
      if (filters.title) params.set('title', filters.title);
      if (filters.companyId) params.set('companyId', filters.companyId);
      if (filters.companyName) params.set('companyName', filters.companyName);
      if (filters.templateName) params.set('templateName', filters.templateName);
      if (filters.status) params.set('status', filters.status);
      if (filters.createdBy) params.set('createdBy', filters.createdBy);
      if (filters.signedFrom) params.set('signedFrom', filters.signedFrom);
      if (filters.signedTo) params.set('signedTo', filters.signedTo);
      if (filters.updatedFrom) params.set('updatedFrom', filters.updatedFrom);
      if (filters.updatedTo) params.set('updatedTo', filters.updatedTo);
      if (filters.sortBy) params.set('sortBy', filters.sortBy);
      if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);
      params.set('page', page.toString());
      params.set('limit', limit.toString());

      const response = await fetch(`/api/generated-documents?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }

      const data: DocumentListResponse = await response.json();
      setDocuments(data.documents);
      setTotal(data.total);
      writeSessionListSnapshot(
        generatedDocumentsListKey(page, searchQuery, filters),
        data,
      );
    } catch (err) {
      console.error('Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, filters, page, initialListSnapshot]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const fetchBatches = useCallback(async () => {
    setBatchesError(null);
    try {
      const response = await fetch('/api/document-generation-batches');
      if (!response.ok) throw new Error('Failed to load resumable batches');
      const data = await response.json();
      setBatches(data.batches ?? []);
    } catch (err) {
      console.error('Fetch batches error:', err);
      setBatchesError(err instanceof Error ? err.message : 'Failed to load resumable batches');
    }
  }, []);

  useEffect(() => {
    void fetchBatches();
  }, [fetchBatches]);

  const handleDiscardBatch = useCallback(async (batchId: string) => {
    setIsDiscardingBatch(true);
    try {
      const response = await fetch(
        `/api/document-generation-batches/${encodeURIComponent(batchId)}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      if (!response.ok) throw new Error('Failed to discard batch');
      setBatches((previous) => previous.filter((batch) => batch.id !== batchId));
      success('Unfinished batch discarded');
      void fetchDocuments();
    } catch (err) {
      console.error('Discard batch error:', err);
      toastError(err instanceof Error ? err.message : 'Failed to discard batch');
    } finally {
      setIsDiscardingBatch(false);
    }
  }, [fetchDocuments, success, toastError]);

  // Filter handlers
  const handleFilterChange = useCallback((patch: Partial<GeneratedDocumentFilters>) => {
    updateParams(patch as Partial<DocumentListParams>);
  }, [updateParams]);

  const handleSearchChange = useCallback((value: string) => {
    updateParams({ query: value });
  }, [updateParams]);
  const search = useDebouncedSearch(searchQuery, handleSearchChange);

  const handleSortChange = useCallback((field: GeneratedDocumentSortField) => {
    setListParams((previous) => ({
      ...previous,
      sortBy: field,
      sortOrder:
        previous.sortBy === field && previous.sortOrder === 'asc' ? 'desc' : 'asc',
      page: 1,
    }));
  }, [setListParams]);

  const clearAllFilters = useCallback(() => {
    setListParams((previous) => ({
      ...parseUrlParams(DOCUMENT_LIST_PARAMS, new URLSearchParams()),
      sortBy: previous.sortBy,
      sortOrder: previous.sortOrder,
    }));
    search.commitNow('');
  }, [search, setListParams]);

  const today = toLocalDateString(new Date());
  const isUpdatedToday = Boolean(
    today && filters.updatedFrom === today && filters.updatedTo === today,
  );

  const toggleUpdatedToday = useCallback(() => {
    setListParams((previous) => {
      const active = previous.updatedFrom === today && previous.updatedTo === today;
      return active
        ? { ...previous, updatedFrom: undefined, updatedTo: undefined, page: 1 }
        : { ...previous, updatedFrom: today, updatedTo: today, page: 1 };
    });
  }, [today, setListParams]);

  // Handle delete
  const handleDelete = async (reason: string) => {
    if (!documentToDelete || !reason) return;

    try {
      const params = new URLSearchParams();
      params.set('reason', reason);
      const url = `/api/generated-documents/${documentToDelete}?${params}`;

      const response = await fetch(url, { method: 'DELETE' });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // If already deleted, still remove from UI and show success
        if (errorData.error === 'Document is already deleted') {
          success('Document removed from list');
          setDocuments((prev) => prev.filter((d) => d.id !== documentToDelete));
          setTotal((prev) => prev - 1);
          return;
        }
        throw new Error(errorData.error || 'Failed to delete document');
      }

      success('Document moved to the Recycle Bin');
      setDocuments((prev) => prev.filter((d) => d.id !== documentToDelete));
      setTotal((prev) => prev - 1);
    } catch (err) {
      console.error('Delete error:', err);
      toastError(err instanceof Error ? err.message : 'Failed to delete document');
    } finally {
      setDeleteDialogOpen(false);
      setDocumentToDelete(null);
    }
  };

  const handleDiscardDraft = async () => {
    if (!draftToDiscard) return;

    try {
      const params = new URLSearchParams({ reason: 'Discarded document generation draft' });
      const response = await fetch(`/api/generated-documents/${draftToDiscard}?${params}`, {
        method: 'DELETE',
      });
      const errorData = response.ok ? null : await response.json().catch(() => ({}));
      if (!response.ok && errorData?.error !== 'Document is already deleted') {
        throw new Error(errorData?.error || 'Failed to discard draft');
      }

      setDocuments((previous) => previous.filter((document) => document.id !== draftToDiscard));
      setTotal((previous) => Math.max(0, previous - 1));
      success('Draft discarded');
    } catch (err) {
      console.error('Discard draft error:', err);
      toastError(err instanceof Error ? err.message : 'Failed to discard draft');
    } finally {
      setDraftToDiscard(null);
    }
  };

  // Handle export
  const handleExport = async (documentId: string) => {
    try {
      const response = await fetch(`/api/generated-documents/${documentId}/export/pdf`);
      if (!response.ok) {
        throw new Error('Failed to export document');
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `document-${documentId}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Export error:', err);
      toastError('Failed to export document');
    }
  };

  // Handle bulk download (ZIP of PDFs)
  const handleBulkDownload = async () => {
    if (selectedCount === 0) return;
    setIsBulkDownloading(true);
    try {
      const response = await fetch('/api/generated-documents/bulk-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds: Array.from(selectedIds) }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to download documents');
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `documents-${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(blobUrl);

      success(`Downloaded ${selectedCount} document${selectedCount > 1 ? 's' : ''}`);
    } catch (err) {
      console.error('Bulk download error:', err);
      toastError(err instanceof Error ? err.message : 'Failed to download documents');
    } finally {
      setIsBulkDownloading(false);
    }
  };

  // Handle bulk delete
  const handleBulkDeleteConfirm = async (reason: string) => {
    if (!reason || selectedCount === 0) return;

    try {
      const response = await fetch('/api/generated-documents/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), reason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete documents');
      }

      const firstFailure: string | undefined = data.failed?.[0]?.error;
      if (firstFailure) {
        toastError(`${data.message}. ${firstFailure}`);
      } else {
        success(data.message || `Deleted ${data.deleted} documents`);
      }
      setBulkDeleteDialogOpen(false);
      clearSelection();
      void fetchDocuments();
    } catch (err) {
      console.error('Bulk delete error:', err);
      toastError(err instanceof Error ? err.message : 'Failed to delete documents');
    }
  };

  // Active filter chips
  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; value: string; onRemove: () => void }> = [];

    if (searchQuery.trim()) {
      chips.push({
        key: 'query',
        label: 'Search',
        value: searchQuery,
        onRemove: () => handleSearchChange(''),
      });
    }
    if (filters.title) {
      chips.push({
        key: 'title',
        label: 'Title',
        value: filters.title,
        onRemove: () => handleFilterChange({ title: undefined }),
      });
    }
    if (filters.companyId || filters.companyName) {
      chips.push({
        key: 'company',
        label: 'Company',
        value: filters.companyName || filters.companyId || '',
        onRemove: () => handleFilterChange({ companyId: undefined, companyName: undefined }),
      });
    }
    if (filters.templateName) {
      chips.push({
        key: 'template',
        label: 'Template',
        value: filters.templateName,
        onRemove: () => handleFilterChange({ templateName: undefined }),
      });
    }
    if (filters.status) {
      chips.push({
        key: 'status',
        label: 'Status',
        value: STATUS_LABELS[filters.status] || filters.status,
        onRemove: () => handleFilterChange({ status: undefined }),
      });
    }
    if (filters.createdBy) {
      chips.push({
        key: 'createdBy',
        label: 'Created By',
        value: filters.createdBy,
        onRemove: () => handleFilterChange({ createdBy: undefined }),
      });
    }
    if (filters.signedFrom || filters.signedTo) {
      chips.push({
        key: 'signedOn',
        label: 'Signed On',
        value: `${filters.signedFrom || '...'} to ${filters.signedTo || '...'}`,
        onRemove: () => handleFilterChange({ signedFrom: undefined, signedTo: undefined }),
      });
    }
    if (filters.updatedFrom || filters.updatedTo) {
      chips.push({
        key: 'updated',
        label: 'Updated',
        value: `${filters.updatedFrom || '...'} to ${filters.updatedTo || '...'}`,
        onRemove: () => handleFilterChange({ updatedFrom: undefined, updatedTo: undefined }),
      });
    }

    return chips;
  }, [
    filters,
    handleFilterChange,
    handleSearchChange,
    searchQuery,
  ]);

  const quickFilterClassName = (active: boolean) => cn(
    'inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30',
    active
      ? 'bg-oak-primary text-white hover:bg-oak-dark'
      : 'text-text-secondary hover:bg-background-tertiary hover:text-text-primary',
  );

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">
            Generated Documents
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Manage and export your generated documents
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canCreate && (
            <Link href="/generated-documents/generate">
              <Button variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>
                Generate Document
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Toolbar: search + quick filters */}
      <div className="mb-4">
        <div className="flex flex-col gap-3 rounded-lg border border-border-primary bg-background-secondary p-4 lg:flex-row lg:items-center">
          <label className="relative block flex-1">
            <span className="sr-only">Search documents</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search documents"
              value={search.draft}
              onChange={(event) => search.setDraft(event.target.value)}
              placeholder="Search by title, company, or template..."
              className="h-10 w-full rounded-lg border border-border-primary bg-background-primary pl-10 pr-9 text-sm text-text-primary transition-colors placeholder:text-text-muted hover:border-oak-primary/50 focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
            />
            {search.draft && (
              <button
                type="button"
                onClick={() => search.commitNow('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={filters.status === 'DRAFT'}
              aria-label="Show drafts"
              title="Show drafts"
              onClick={() => handleFilterChange({
                status: filters.status === 'DRAFT' ? undefined : 'DRAFT',
              })}
              className={quickFilterClassName(filters.status === 'DRAFT')}
            >
              <Clock className="h-4 w-4" aria-hidden="true" />
              <span className="hidden xl:inline">Draft</span>
            </button>
            <button
              type="button"
              aria-pressed={filters.status === 'FINALIZED'}
              aria-label="Show finalized documents"
              title="Show finalized documents"
              onClick={() => handleFilterChange({
                status: filters.status === 'FINALIZED' ? undefined : 'FINALIZED',
              })}
              className={quickFilterClassName(filters.status === 'FINALIZED')}
            >
              <CheckCircle className="h-4 w-4" aria-hidden="true" />
              <span className="hidden xl:inline">Finalized</span>
            </button>
            <button
              type="button"
              aria-pressed={filters.status === 'ARCHIVED'}
              aria-label="Show archived documents"
              title="Show archived documents"
              onClick={() => handleFilterChange({
                status: filters.status === 'ARCHIVED' ? undefined : 'ARCHIVED',
              })}
              className={quickFilterClassName(filters.status === 'ARCHIVED')}
            >
              <Archive className="h-4 w-4" aria-hidden="true" />
              <span className="hidden xl:inline">Archived</span>
            </button>
            <button
              type="button"
              aria-pressed={isUpdatedToday}
              aria-label="Show documents updated today"
              title="Show documents updated today"
              onClick={toggleUpdatedToday}
              className={quickFilterClassName(isUpdatedToday)}
            >
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              <span className="hidden xl:inline">Updated today</span>
            </button>
          </div>
        </div>
      </div>

      {/* Active filter chips */}
      {activeFilterChips.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-sm text-text-secondary font-medium">Active filters:</span>
          {activeFilterChips.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              value={chip.value}
              onRemove={chip.onRemove}
            />
          ))}
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-sm text-oak-primary hover:text-oak-primary/80 font-medium transition-colors ml-2"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Draft batches */}
      {batchesError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-status-error/30 bg-status-error/5 p-3">
          <p className="text-sm text-status-error">{batchesError}</p>
          <Button variant="secondary" size="sm" onClick={() => void fetchBatches()}>
            Retry
          </Button>
        </div>
      )}
      {batches.length > 0 && (
        <section aria-labelledby="draft-batches-heading" className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="draft-batches-heading" className="text-base font-semibold text-text-primary">
              Draft batches
            </h2>
            <span className="text-xs text-text-muted">
              {batches.length} unfinished batch{batches.length === 1 ? '' : 'es'}
            </span>
          </div>
          <GenerationBatchTable
            batches={batches}
            onDiscard={handleDiscardBatch}
            isDiscarding={isDiscardingBatch}
          />
        </section>
      )}

      {/* Document Table */}
      <div>
        <DocumentTable
          documents={documents}
          onDelete={(id) => {
            setDocumentToDelete(id);
            setDeleteDialogOpen(true);
          }}
          onExport={handleExport}
          onDiscardDraft={setDraftToDiscard}
          isLoading={isLoading}
          canEdit={canUpdate}
          canDelete={canDelete}
          canExport={canExport}
          canCreate={canCreate}
          filters={filters}
          onFilterChange={handleFilterChange}
          onSortChange={handleSortChange}
          selectable={canDelete || canExport}
          selectedIds={selectedIds}
          onToggleOne={toggleOne}
          onToggleAll={toggleAll}
          isAllSelected={isAllSelected}
          isIndeterminate={isIndeterminate}
          emptyState={(
            <ListEmptyState
              icon={FileText}
              noun="documents"
              filtered={activeFilterChips.length > 0}
              onClearFilters={clearAllFilters}
              createAction={canCreate ? <Link href="/generated-documents/generate" className="btn-primary btn-sm inline-flex">Generate Document</Link> : undefined}
              emptyDescription="Generate a document from a template to get started."
            />
          )}
        />
      </div>

      {/* Pagination */}
      {!isLoading && totalPages > 0 && (
        <div className="mt-4">
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            limit={limit}
            onPageChange={(nextPage) => updateParams({ page: nextPage })}
            onLimitChange={() => {
              updateParams({ page: 1 });
              // Note: limit is a const, so we need to refetch with new limit
              // For now, we'll keep the current behavior
            }}
          />
        </div>
      )}

      {/* Delete confirmation dialog */}
      <DocumentDeleteDialog
        isOpen={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setDocumentToDelete(null);
        }}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        isOpen={draftToDiscard !== null}
        onClose={() => setDraftToDiscard(null)}
        onConfirm={handleDiscardDraft}
        title="Discard Draft"
        description="Discard this saved draft? This action cannot be undone."
        confirmLabel="Discard Draft"
        variant="danger"
      />

      {/* Bulk Delete Confirmation Dialog */}
      <DocumentDeleteDialog
        isOpen={bulkDeleteDialogOpen}
        onClose={() => setBulkDeleteDialogOpen(false)}
        onConfirm={handleBulkDeleteConfirm}
        count={selectedCount}
      />

      {/* Floating Bulk Actions Toolbar */}
      {(canDelete || canExport) && (
        <BulkActionsToolbar
          selectedCount={selectedCount}
          onClearSelection={clearSelection}
          itemLabel="document"
          actions={[
            ...(canExport ? [{
              id: 'download',
              label: 'Download',
              icon: Download,
              description: 'Download selected documents as ZIP',
              variant: 'default' as const,
              isLoading: isBulkDownloading,
            }] : []),
            ...(canDelete ? [{
              id: 'delete',
              label: 'Delete',
              icon: Trash2,
              description: 'Delete selected documents',
              variant: 'danger' as const,
            }] : []),
          ]}
          onAction={(actionId) => {
            if (actionId === 'download') {
              void handleBulkDownload();
            } else if (actionId === 'delete') {
              setBulkDeleteDialogOpen(true);
            }
          }}
        />
      )}
    </div>
  );
}
