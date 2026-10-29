'use client';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useDropzone } from 'react-dropzone';
import {
  FileText,
  AlertCircle,
  Upload,
  RefreshCw,
  Play,
} from 'lucide-react';
import {
  useProcessingDocuments,
  useSelectAllProcessingDocuments,
  useDocumentNavigation,
  type ProcessingDocumentListItem,
} from '@/hooks/use-processing-documents';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { BulkActionsToolbar } from '@/components/processing/bulk-actions-toolbar';
import { ProcessingFilters, type ProcessingFilterValues } from '@/components/processing/processing-filters';
import { ProcessingToolbar } from '@/components/processing/processing-toolbar';
import { FilterChip } from '@/components/ui/filter-chip';
import { ListEmptyState } from '@/components/ui/empty-state';
import { useAvailableTags } from '@/hooks/use-document-tags';
import { useActiveCompanyId } from '@/components/ui/company-selector';
import { useUserPreferences, useUpsertUserPreference } from '@/hooks/use-user-preferences';
import { useColumnResize } from '@/hooks/use-column-resize';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { COLUMN_IDS, COLUMN_PREF_KEY, COLUMN_VISIBILITY_PREF_KEY, type ColumnId, DEFAULT_COLUMN_WIDTHS, processingListStats } from '@/components/processing/list/processing-list-config';
import { applyProcessingFilters, PROCESSING_LIST_PARAMS, processingParamsFromUrl } from '@/components/processing/list/processing-list-url';
import { useUrlListParams } from '@/hooks/use-url-list-params';
import { buildProcessingFilterChips } from '@/components/processing/list/processing-filter-chips';
import { renderProcessingDesktopCell } from '@/components/processing/list/processing-desktop-cell';
import { ProcessingStatsCards } from '@/components/processing/list/processing-stats-cards';
import { ProcessingMobileList } from '@/components/processing/list/processing-mobile-list';
import { ProcessingDocumentTable } from '@/components/processing/list/processing-document-table';
import { ProcessingColumnModal } from '@/components/processing/list/processing-column-modal';

export default function ProcessingDocumentsPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const { data: session } = useSession();

  // Get active tenant ID (from store for SUPER_ADMIN, from session for others)
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  // Get active company from sidebar selector
  const activeCompanyId = useActiveCompanyId();

  // Handle file drop - redirect to upload page with files
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      // Store files in sessionStorage to pass to upload page
      const fileData = acceptedFiles.map(file => ({
        name: file.name,
        size: file.size,
        type: file.type,
      }));
      sessionStorage.setItem('pendingUploadFiles', JSON.stringify(fileData));

      // Create a DataTransfer object to temporarily hold files
      const dataTransfer = new DataTransfer();
      acceptedFiles.forEach(file => dataTransfer.items.add(file));

      // Store the FileList in a global variable (will be picked up by upload page)
      (window as Window & { __pendingUploadFiles?: FileList }).__pendingUploadFiles = dataTransfer.files;

      // Navigate to upload page
      router.push('/processing/upload');
    }
  }, [router]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/tiff': ['.tif', '.tiff'],
    },
    maxSize: 50 * 1024 * 1024, // 50MB
    noClick: true, // Don't open file picker on click
    noKeyboard: true, // Don't open on keyboard events
  });

  const { params, setParams } = useUrlListParams('/processing', PROCESSING_LIST_PARAMS, processingParamsFromUrl);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedDocumentMap, setSelectedDocumentMap] = useState<Record<string, ProcessingDocumentListItem>>({});
  const [expandedMobileCardIds, setExpandedMobileCardIds] = useState<string[]>([]);
  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);

  // Determine effective company ID: URL filter takes priority, then sidebar selector
  // If sidebar has "All Companies" selected (activeCompanyId is undefined), show all companies
  const effectiveCompanyId = params.companyId || activeCompanyId;

  const { data: preferenceMap } = useUserPreferences([
    COLUMN_PREF_KEY,
    COLUMN_VISIBILITY_PREF_KEY,
  ]);
  const columnPref = preferenceMap?.[COLUMN_PREF_KEY];
  const visibilityPref = preferenceMap?.[COLUMN_VISIBILITY_PREF_KEY];
  const saveColumnPref = useUpsertUserPreference<Record<string, number | boolean>>();
  const selectAllFilteredDocuments = useSelectAllProcessingDocuments();
  const [columnWidths, setColumnWidths] = useState<Partial<Record<ColumnId, number>>>({});
  const [columnVisibility, setColumnVisibility] = useState<Partial<Record<ColumnId, boolean>>>({});

  useEffect(() => {
    const value = columnPref?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    setColumnWidths(value as Partial<Record<ColumnId, number>>);
  }, [columnPref?.value]);

  useEffect(() => {
    const value = visibilityPref?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    setColumnVisibility(value as Partial<Record<ColumnId, boolean>>);
  }, [visibilityPref?.value]);

  const isColumnVisible = useCallback((columnId: ColumnId) => {
    if (columnId === 'open') return true;
    return columnVisibility[columnId] !== false;
  }, [columnVisibility]);
  const visibleColumnIds = useMemo(() => COLUMN_IDS.filter((id) => isColumnVisible(id)), [isColumnVisible]);
  const hiddenColumnCount = useMemo(() => {
    return COLUMN_IDS.filter((id) => id !== 'open' && !isColumnVisible(id)).length;
  }, [isColumnVisible]);

  const renderDesktopCell = (doc: ProcessingDocumentListItem, columnId: ColumnId) =>
    renderProcessingDesktopCell(doc, columnId, { activeTenantId, effectiveCompanyId });

  const { startResize, resizeWithKeyboard: resizeColumnByKeyboard } = useColumnResize<ColumnId>({
    getWidth: (columnId) => columnWidths[columnId] ?? DEFAULT_COLUMN_WIDTHS[columnId],
    getDefaultWidth: () => 120,
    clampWidth: (width) => Math.max(30, width),
    onResize: (columnId, width) => setColumnWidths((prev) => ({ ...prev, [columnId]: width })),
    onResizeEnd: (columnId, width) => {
      const nextWidths = { ...columnWidths, [columnId]: width };
      setColumnWidths(nextWidths);
      saveColumnPref.mutate({ key: COLUMN_PREF_KEY, value: nextWidths });
    },
  });

  const resetColumns = useCallback(() => {
    setColumnWidths({});
    saveColumnPref.mutate({ key: COLUMN_PREF_KEY, value: {} });
  }, [saveColumnPref]);

  const showAllColumns = useCallback(() => {
    setColumnVisibility({});
    saveColumnPref.mutate({ key: COLUMN_VISIBILITY_PREF_KEY, value: {} });
  }, [saveColumnPref]);

  const toggleColumnVisibility = useCallback((columnId: ColumnId) => {
    if (columnId === 'open') return;
    const next = { ...columnVisibility, [columnId]: columnVisibility[columnId] === false ? true : false };
    setColumnVisibility(next);
    saveColumnPref.mutate({ key: COLUMN_VISIBILITY_PREF_KEY, value: next });
  }, [columnVisibility, saveColumnPref]);

  // Pass tenantId and effective companyId to filter documents
  const { data, isLoading, isFetching, error, refetch } = useProcessingDocuments(
    {
      ...params,
      companyId: effectiveCompanyId,
      tenantId: activeTenantId,
    },
    { restoreSession: true },
  );

  // Get pending approval count for "Approve" button visibility
  const { data: pendingNavData, refetch: refetchPendingCount } = useDocumentNavigation(
    'pending-count', // Dummy ID, not used when start=true
    'needs-review',
    {
      tenantId: activeTenantId,
      companyId: effectiveCompanyId,
      start: true,
    },
    true // enabled
  );
  const pendingApprovalCount = pendingNavData?.total ?? 0;

  // Fetch tags for filter dropdown (uses effectiveCompanyId if available, otherwise just tenant tags)
  const { data: tagsData } = useAvailableTags(effectiveCompanyId, activeTenantId);

  const selectionScopeKey = useMemo(() => JSON.stringify({
    tenantId: activeTenantId,
    companyId: effectiveCompanyId,
    pipelineStatus: params.pipelineStatus,
    duplicateStatus: params.duplicateStatus,
    revisionStatus: params.revisionStatus,
    needsReview: params.needsReview,
    isContainer: params.isContainer,
    uploadDatePreset: params.uploadDatePreset,
    uploadDateFrom: params.uploadDateFrom,
    uploadDateTo: params.uploadDateTo,
    documentDateFrom: params.documentDateFrom,
    documentDateTo: params.documentDateTo,
    search: params.search,
    vendorName: params.vendorName,
    documentNumber: params.documentNumber,
    fileName: params.fileName,
    documentCategory: params.documentCategory,
    documentSubCategory: params.documentSubCategory,
    tagIds: params.tagIds,
    currency: params.currency,
    homeCurrency: params.homeCurrency,
    subtotal: params.subtotal,
    subtotalFrom: params.subtotalFrom,
    subtotalTo: params.subtotalTo,
    tax: params.tax,
    taxFrom: params.taxFrom,
    taxTo: params.taxTo,
    total: params.total,
    totalFrom: params.totalFrom,
    totalTo: params.totalTo,
    homeSubtotal: params.homeSubtotal,
    homeSubtotalFrom: params.homeSubtotalFrom,
    homeSubtotalTo: params.homeSubtotalTo,
    homeTax: params.homeTax,
    homeTaxFrom: params.homeTaxFrom,
    homeTaxTo: params.homeTaxTo,
    homeTotal: params.homeTotal,
    homeTotalFrom: params.homeTotalFrom,
    homeTotalTo: params.homeTotalTo,
  }), [
    activeTenantId,
    effectiveCompanyId,
    params.pipelineStatus,
    params.duplicateStatus,
    params.revisionStatus,
    params.needsReview,
    params.isContainer,
    params.uploadDatePreset,
    params.uploadDateFrom,
    params.uploadDateTo,
    params.documentDateFrom,
    params.documentDateTo,
    params.search,
    params.vendorName,
    params.documentNumber,
    params.fileName,
    params.documentCategory,
    params.documentSubCategory,
    params.tagIds,
    params.currency,
    params.homeCurrency,
    params.subtotal,
    params.subtotalFrom,
    params.subtotalTo,
    params.tax,
    params.taxFrom,
    params.taxTo,
    params.total,
    params.totalFrom,
    params.totalTo,
    params.homeSubtotal,
    params.homeSubtotalFrom,
    params.homeSubtotalTo,
    params.homeTax,
    params.homeTaxFrom,
    params.homeTaxTo,
    params.homeTotal,
    params.homeTotalFrom,
    params.homeTotalTo,
  ]);
  const previousSelectionScopeKeyRef = useRef(selectionScopeKey);

  // Reset page and selection when tenant or sidebar company changes
  useEffect(() => {
    setParams((prev) => ({ ...prev, page: 1 }));
    setSelectedIds([]);
    setSelectedDocumentMap({});
  }, [activeTenantId, activeCompanyId, setParams]);

  useEffect(() => {
    if (previousSelectionScopeKeyRef.current !== selectionScopeKey) {
      setSelectedIds([]);
      setSelectedDocumentMap({});
    }
    previousSelectionScopeKeyRef.current = selectionScopeKey;
  }, [selectionScopeKey]);

  // Collapse expanded mobile cards when params change
  useEffect(() => {
    setExpandedMobileCardIds([]);
  }, [params]);

  useEffect(() => {
    if (!data?.documents || selectedIds.length === 0) return;

    setSelectedDocumentMap((prev) => {
      const next = { ...prev };

      for (const document of data.documents) {
        if (selectedIds.includes(document.id)) {
          next[document.id] = document;
        }
      }

      for (const id of Object.keys(next)) {
        if (!selectedIds.includes(id)) {
          delete next[id];
        }
      }

      return next;
    });
  }, [data?.documents, selectedIds]);

  // Selection handlers
  const toggleSelectAll = useCallback(() => {
    if (!data?.documents) return;
    const allIds = data.documents.map((d) => d.id);
    const allSelected = allIds.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) =>
      allSelected
        ? prev.filter((id) => !allIds.includes(id))
        : Array.from(new Set([...prev, ...allIds]))
    );
    setSelectedDocumentMap((prev) => {
      const next = { ...prev };
      if (allSelected) {
        for (const id of allIds) {
          delete next[id];
        }
      } else {
        for (const document of data.documents) {
          next[document.id] = document;
        }
      }
      return next;
    });
  }, [data?.documents, selectedIds]);

  const toggleSelect = useCallback((id: string) => {
    const currentDocument = data?.documents?.find((document) => document.id === id);

    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]
    );
    setSelectedDocumentMap((prev) => {
      const next = { ...prev };
      if (id in next) {
        delete next[id];
      } else if (currentDocument) {
        next[id] = currentDocument;
      }
      return next;
    });
  }, [data?.documents]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectedDocumentMap({});
  }, []);

  const handleSelectAllFiltered = useCallback(async () => {
    const result = await selectAllFilteredDocuments.mutateAsync({
      ...params,
      companyId: effectiveCompanyId,
      tenantId: activeTenantId,
    });

    setSelectedIds(result.ids);
    setSelectedDocumentMap(
      Object.fromEntries(result.documents.map((document) => [document.id, document]))
    );
  }, [activeTenantId, effectiveCompanyId, params, selectAllFilteredDocuments]);

  const toggleMobileCardExpanded = useCallback((id: string) => {
    setExpandedMobileCardIds((prev) =>
      prev.includes(id) ? prev.filter((existingId) => existingId !== id) : [...prev, id]
    );
  }, []);

  // Get selected documents for bulk actions summary
  const selectedDocuments = useMemo(() => {
    if (selectedIds.length === 0) return [];
    return selectedIds
      .map((id) => selectedDocumentMap[id])
      .filter((document): document is ProcessingDocumentListItem => Boolean(document));
  }, [selectedDocumentMap, selectedIds]);

  const handleReviewNext = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('filter', 'needs-review');
      params.set('start', 'true');
      if (activeTenantId) params.set('tenantId', activeTenantId);
      if (effectiveCompanyId) params.set('companyId', effectiveCompanyId);

      const response = await fetch(`/api/processing-documents/navigation?${params}`);
      if (!response.ok) return;
      const result = await response.json();
      const nextId = result?.data?.currentDocumentId as string | null | undefined;
      if (nextId) router.push(`/processing/${nextId}`);
    } catch {
      // ignore
    }
  }, [activeTenantId, effectiveCompanyId, router]);

  // Keyboard shortcuts (standardized): Ctrl+R refresh, F1 primary create, F2 secondary action
  useKeyboardShortcuts([
    {
      key: 'r',
      ctrl: true,
      handler: () => {
        refetch();
        refetchPendingCount();
      },
      description: 'Refresh list',
    },
    ...(can.createDocument ? [{
      key: 'F1',
      handler: () => router.push('/processing/upload'),
      description: 'Upload documents',
    }] : []),
    ...(pendingApprovalCount > 0 ? [{
      key: 'F2',
      handler: handleReviewNext,
      description: 'Approve next document',
    }] : []),
  ]);

  // Selection state
  const selectionState = useMemo(() => {
    if (!data?.documents || data.documents.length === 0) return 'none';
    const allIds = data.documents.map((d) => d.id);
    const selectedCount = allIds.filter((id) => selectedIds.includes(id)).length;
    if (selectedCount === 0) return 'none';
    if (selectedCount === allIds.length) return 'all';
    return 'partial';
  }, [data?.documents, selectedIds]);

  const allFilteredSelected = useMemo(() => {
    if (!data || data.total === 0) return false;
    return selectedIds.length === data.total;
  }, [data, selectedIds.length]);

  const handlePageChange = (page: number) => {
    setParams((prev) => ({ ...prev, page }));
  };

  // Handler for the new ProcessingFilters component
  const handleFiltersChange = useCallback((filters: Partial<ProcessingFilterValues>) => {
    setParams((prev) => applyProcessingFilters(prev, filters));
  }, [setParams]);

  const handleSort = useCallback((field: string) => {
    setParams((prev) => {
      const isSame = (prev.sortBy || 'createdAt') === field;
      const nextOrder: 'asc' | 'desc' = isSame ? (prev.sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';
      return { ...prev, page: 1, sortBy: field, sortOrder: nextOrder };
    });
  }, [setParams]);

  const handleSearchChange = useCallback((query: string) => {
    setParams((prev) => ({
      ...prev,
      search: query || undefined,
      page: 1,
    }));
  }, [setParams]);

  // Calculate stats from data
  const stats = useMemo(() => processingListStats(data), [data]);

  // Generate active filter chips
  const activeFilterChips = useMemo(
    () => buildProcessingFilterChips(params, tagsData, handleFiltersChange),
    [params, handleFiltersChange, tagsData]
  );

  // Clear all filters
  const handleClearAllFilters = useCallback(() => {
    setParams({
      page: 1,
      limit: params.limit,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      search: params.search, // Keep search
    });
  }, [params.limit, params.sortBy, params.sortOrder, params.search, setParams]);

  const emptyState = (
    <ListEmptyState
      icon={FileText}
      noun="documents"
      filtered={activeFilterChips.length > 0 || Boolean(params.search)}
      onClearFilters={() => {
        handleClearAllFilters();
        handleSearchChange('');
      }}
      emptyDescription="Upload invoices, receipts or statements to start processing."
      createAction={can.createDocument ? (
        <Link href="/processing/upload" className="btn-primary btn-sm inline-flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Upload documents
        </Link>
      ) : undefined}
    />
  );

  return (
    <div {...getRootProps()} className="p-4 sm:p-6 relative">
      <input {...getInputProps()} />

      {/* Drag overlay */}
      {isDragActive && (
        <div className="fixed inset-0 z-50 bg-oak-primary/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="bg-background-secondary border-2 border-dashed border-oak-primary rounded-lg shadow-xl p-12 max-w-md">
            <div className="flex flex-col items-center text-center">
              <div className="p-4 rounded-lg bg-oak-primary/10 mb-4">
                <Upload className="w-12 h-12 text-oak-primary" />
              </div>
              <p className="text-lg font-semibold text-text-primary mb-2">Drop files to upload</p>
              <p className="text-sm text-text-secondary">
                You&apos;ll be redirected to the upload page with files attached
              </p>
              <div className="mt-4 text-xs text-text-muted">
                PDF, PNG, JPG, TIFF • Max 50MB per file
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">Document Vault</h1>
          <p className="text-text-secondary text-sm mt-1">
            AI-powered document extraction, classification, and revision workflow
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => { refetch(); refetchPendingCount(); }}
            className="btn-secondary btn-sm flex items-center gap-2 whitespace-nowrap"
            title="Refresh list (Ctrl+R)"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden xl:inline">Refresh (Ctrl+R)</span>
            <span className="xl:hidden">Refresh</span>
          </button>
          {pendingApprovalCount > 0 && (
            <button
              onClick={handleReviewNext}
              className="btn-secondary btn-sm flex items-center gap-2 whitespace-nowrap"
              title="Approve next document pending approval (F2)"
            >
              <Play className="w-4 h-4" />
              <span className="hidden xl:inline">Approve ({pendingApprovalCount}) (F2)</span>
              <span className="xl:hidden">Approve ({pendingApprovalCount})</span>
            </button>
          )}
          {can.createDocument && (
            <Link href="/processing/upload" className="btn-primary btn-sm flex items-center gap-2 whitespace-nowrap" title="Upload documents (F1)">
              <Upload className="w-4 h-4" />
              <span className="hidden xl:inline">Upload (F1)</span>
              <span className="xl:hidden">Upload</span>
            </Link>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <ProcessingStatsCards stats={stats} isFetching={isFetching} />
      )}

      {/* Filters - Desktop: Integrated in table. Mobile: Separate panel */}
      <div className="mb-4 lg:hidden">
        <ProcessingFilters
          onFilterChange={handleFiltersChange}
          initialFilters={{
            pipelineStatus: params.pipelineStatus,
            duplicateStatus: params.duplicateStatus,
            revisionStatus: params.revisionStatus,
            needsReview: params.needsReview,
            isContainer: params.isContainer,
            companyId: params.companyId,
            uploadDatePreset: params.uploadDatePreset,
            uploadDateFrom: params.uploadDateFrom,
            uploadDateTo: params.uploadDateTo,
            documentDateFrom: params.documentDateFrom,
            documentDateTo: params.documentDateTo,
            vendorName: params.vendorName,
            documentNumber: params.documentNumber,
            fileName: params.fileName,
            tagIds: params.tagIds,
            currency: params.currency,
            homeCurrency: params.homeCurrency,
          }}
          onSearchChange={handleSearchChange}
          initialSearch={params.search || ''}
          tags={tagsData?.map(t => ({ id: t.id, name: t.name, color: t.color })) || []}
          activeCompanyId={effectiveCompanyId}
          activeTenantId={activeTenantId}
        />
      </div>

      {!error && data && data.total > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-secondary">
            {selectedIds.length > 0
              ? `${selectedIds.length.toLocaleString()} selected`
              : `${data.total.toLocaleString()} filtered result${data.total === 1 ? '' : 's'}`}
          </span>

          {data.documents.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAll}
              className="btn-ghost btn-sm"
            >
              {selectionState === 'all' ? 'Deselect this page' : `Select this page (${data.documents.length})`}
            </button>
          )}

          {data.total > data.documents.length && (
            <button
              type="button"
              onClick={() => void handleSelectAllFiltered()}
              disabled={selectAllFilteredDocuments.isPending || allFilteredSelected}
              className="btn-secondary btn-sm"
            >
              {selectAllFilteredDocuments.isPending
                ? 'Selecting...'
                : allFilteredSelected
                  ? `All ${data.total.toLocaleString()} filtered selected`
                  : `Select all filtered (${data.total.toLocaleString()})`}
            </button>
          )}

          {selectAllFilteredDocuments.isError && (
            <span className="text-status-error text-xs">
              {selectAllFilteredDocuments.error instanceof Error
                ? selectAllFilteredDocuments.error.message
                : 'Failed to select all filtered documents'}
            </span>
          )}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card border-status-error bg-status-error/5 mb-4">
          <div className="flex items-center gap-3 text-status-error">
            <AlertCircle className="w-5 h-5" />
            <p>{error instanceof Error ? error.message : 'Failed to load documents'}</p>
          </div>
        </div>
      )}

      {/* Loading State - Only show full loading spinner on initial load (no data yet) */}
      {isLoading && !data && (
        <div className="card p-8 flex items-center justify-center">
          <RefreshCw className="w-6 h-6 animate-spin text-oak-light" />
          <span className="ml-3 text-text-secondary">Loading documents...</span>
        </div>
      )}

      {/* Document Cards - Mobile View */}
      {!error && data && (
        <ProcessingMobileList
          data={data}
          isFetching={isFetching}
          emptyState={emptyState}
          selectedIds={selectedIds}
          expandedMobileCardIds={expandedMobileCardIds}
          toggleSelect={toggleSelect}
          toggleMobileCardExpanded={toggleMobileCardExpanded}
          handlePageChange={handlePageChange}
        />
      )}

      {/* Desktop Toolbar */}
      <div className="hidden lg:block mb-4">
        <ProcessingToolbar
          search={params.search || ''}
          onSearchChange={handleSearchChange}
          quickFilters={{
            needsReview: params.needsReview,
            uploadDatePreset: params.uploadDatePreset,
            duplicateStatus: params.duplicateStatus,
          }}
          onQuickFilterChange={(filters) => {
            handleFiltersChange(filters);
          }}
          onAdjustColumns={() => setIsColumnModalOpen(true)}
          hiddenColumnCount={hiddenColumnCount}
        />
      </div>

      {/* Active Filter Chips - Desktop Only */}
      {activeFilterChips.length > 0 && (
        <div className="hidden lg:flex items-center gap-2 mb-4 flex-wrap">
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
            onClick={handleClearAllFilters}
            className="text-sm text-oak-primary hover:text-oak-primary/80 font-medium transition-colors ml-2"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Document Table - Desktop View */}
      {!error && data && (
        <ProcessingDocumentTable
          data={data}
          isFetching={isFetching}
          emptyState={emptyState}
          params={params}
          visibleColumnIds={visibleColumnIds}
          columnWidths={columnWidths}
          startResize={startResize}
          resizeColumnByKeyboard={resizeColumnByKeyboard}
          selectedIds={selectedIds}
          selectionState={selectionState}
          tagsData={tagsData}
          toggleSelect={toggleSelect}
          toggleSelectAll={toggleSelectAll}
          handleSort={handleSort}
          handleFiltersChange={handleFiltersChange}
          handlePageChange={handlePageChange}
          renderDesktopCell={renderDesktopCell}
        />
      )}

      {/* Bulk Actions Toolbar */}
      <BulkActionsToolbar
        selectedIds={selectedIds}
        selectedDocuments={selectedDocuments}
        onClearSelection={clearSelection}
      />

      <ProcessingColumnModal
        isOpen={isColumnModalOpen}
        onClose={() => setIsColumnModalOpen(false)}
        isColumnVisible={isColumnVisible}
        toggleColumnVisibility={toggleColumnVisibility}
        showAllColumns={showAllColumns}
        resetColumns={resetColumns}
      />
    </div>
  );
}
