'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, AlertCircle, FileUp, Trash2, Download, RefreshCw, Building2 } from 'lucide-react';
import { useCompaniesPageBootstrap, useDeleteCompany, useBulkDeleteCompanies } from '@/hooks/use-companies';
import { useExportContactDetails } from '@/hooks/use-contact-details';
import { usePermissions, useCompanyPermissions } from '@/hooks/use-permissions';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { useSelection } from '@/hooks/use-selection';
import { CompanyTable, type CompanyInlineFilters } from '@/components/companies/company-table';
import { CompanyFilters, type FilterValues } from '@/components/companies/company-filters';
import { Pagination } from '@/components/ui/pagination';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { BulkActionsToolbar } from '@/components/ui/bulk-actions-toolbar';
import { FilterChip } from '@/components/ui/filter-chip';
import { ListEmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { useUpsertUserPreference } from '@/hooks/use-user-preferences';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useWorkspaceListReset } from '@/hooks/use-workspace-list-reset';
import { useUrlListParams } from '@/hooks/use-url-list-params';
import { urlParam, type UrlParamSpec } from '@/lib/url-list-params';
import { getEntityTypeLabel, getCompanyStatusLabel } from '@/lib/constants';
import type { EntityType, CompanyStatus } from '@/generated/prisma';

const COLUMN_PREF_KEY = 'companies:list:columns:v1';

interface CompanyListParams extends Omit<CompanyInlineFilters, 'companyName'> {
  query: string;
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  hasCharges?: boolean;
}

/** Search, filters, sort and paging kept in the /companies URL. */
const COMPANY_LIST_PARAMS: UrlParamSpec<CompanyListParams> = {
  query: urlParam.string('', { key: 'q' }),
  uen: urlParam.optional(),
  page: urlParam.int(1),
  limit: urlParam.int(20),
  sortBy: urlParam.string('name'),
  sortOrder: urlParam.choice<'asc' | 'desc'>('asc'),
  entityType: urlParam.optional<EntityType>(),
  status: urlParam.optional<CompanyStatus>(),
  hasCharges: urlParam.optionalBoolean(),
  companyId: urlParam.optional(),
  address: urlParam.optional(),
  hasWarnings: urlParam.optionalBoolean(),
  incorporationDateFrom: urlParam.optional(),
  incorporationDateTo: urlParam.optional(),
  officersMin: urlParam.optionalInt(),
  officersMax: urlParam.optionalInt(),
  shareholdersMin: urlParam.optionalInt(),
  shareholdersMax: urlParam.optionalInt(),
  homeCurrency: urlParam.optional(),
  financialYearEndMonth: urlParam.optionalInt(),
  paidUpCapitalMin: urlParam.optionalNumber(),
  paidUpCapitalMax: urlParam.optionalNumber(),
  issuedCapitalMin: urlParam.optionalNumber(),
  issuedCapitalMax: urlParam.optionalNumber(),
};
const COMPANY_SEARCH_INPUT_ID = 'companies-search-input';

export default function CompaniesPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const { can } = usePermissions();
  const { data: session } = useSession();

  // Get active tenant ID (from store for SUPER_ADMIN, from session for others)
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  const { params, setParams, updateParams, targetUrl } = useUrlListParams('/companies', COMPANY_LIST_PARAMS);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [companyToDelete, setCompanyToDelete] = useState<string | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  // Pass tenantId to filter companies by selected tenant (for SUPER_ADMIN)
  const companiesQueryParams = {
    ...params,
    tenantId: activeTenantId,
  };
  const {
    data: bootstrapData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useCompaniesPageBootstrap(companiesQueryParams, [COLUMN_PREF_KEY]);
  const data = bootstrapData?.companies;
  const deleteCompany = useDeleteCompany();
  const bulkDeleteCompanies = useBulkDeleteCompanies();
  const exportContactDetails = useExportContactDetails();

  // Selection state for bulk operations
  const {
    selectedIds,
    selectedCount,
    isAllSelected,
    isIndeterminate,
    toggleOne,
    toggleAll,
    clear: clearSelection,
  } = useSelection(data?.companies || []);

  // Get company IDs for per-company permission checks
  const companyIds = useMemo(
    () => data?.companies?.map((c) => c.id) || [],
    [data?.companies]
  );
  const { canEditCompany, canDeleteCompany } = useCompanyPermissions(companyIds);

  // Column width persistence
  const columnPref = bootstrapData?.preferences[COLUMN_PREF_KEY];
  const saveColumnPref = useUpsertUserPreference<Record<string, number>>();
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    const value = columnPref?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    setColumnWidths(value as Record<string, number>);
  }, [columnPref?.value]);

  const handleColumnWidthChange = useCallback((columnId: string, width: number) => {
    const nextWidths = { ...columnWidths, [columnId]: width };
    setColumnWidths(nextWidths);
    saveColumnPref.mutate({ key: COLUMN_PREF_KEY, value: nextWidths });
  }, [columnWidths, saveColumnPref]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const focusSearchInput = useCallback(() => {
    if (typeof document === 'undefined') return;
    const input = document.getElementById(COMPANY_SEARCH_INPUT_ID) as HTMLInputElement | null;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);


  const resetForWorkspaceChange = useCallback(() => {
    setParams((prev) => ({ ...prev, page: 1 }));
    clearSelection();
  }, [clearSelection, setParams]);

  useWorkspaceListReset(activeTenantId, resetForWorkspaceChange);

  const handleSearch = (query: string) => {
    updateParams({ query, companyId: undefined });
  };

  const handleFilterChange = (newFilters: FilterValues) => {
    updateParams(newFilters);
  };

  const handlePageChange = (page: number) => {
    updateParams({ page });
  };

  const handleLimitChange = (limit: number) => {
    updateParams({ limit });
  };

  // Inline filter handler - maps inline filter fields to API params
  const handleInlineFilterChange = useCallback((filters: Partial<CompanyInlineFilters>) => {
    const { companyName, ...rest } = filters;
    updateParams({
      ...rest,
      // companyName is the existing search field
      ...('companyName' in filters ? { query: companyName || '' } : {}),
    });
  }, [updateParams]);

  // Derive inline filter values from params for the table
  const inlineFilters: CompanyInlineFilters = useMemo(() => ({
    companyId: params.companyId,
    companyName: params.query || undefined,
    uen: params.uen,
    address: params.address,
    entityType: params.entityType,
    status: params.status,
    incorporationDateFrom: params.incorporationDateFrom,
    incorporationDateTo: params.incorporationDateTo,
    officersMin: params.officersMin,
    officersMax: params.officersMax,
    shareholdersMin: params.shareholdersMin,
    shareholdersMax: params.shareholdersMax,
    homeCurrency: params.homeCurrency,
    financialYearEndMonth: params.financialYearEndMonth,
    paidUpCapitalMin: params.paidUpCapitalMin,
    paidUpCapitalMax: params.paidUpCapitalMax,
    issuedCapitalMin: params.issuedCapitalMin,
    issuedCapitalMax: params.issuedCapitalMax,
    hasWarnings: params.hasWarnings,
  }), [params]);

  // Generate active filter chips
  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; value: string; onRemove: () => void }> = [];

    if (inlineFilters.companyName) {
      chips.push({
        key: 'companyName',
        label: 'Company',
        value: inlineFilters.companyName,
        onRemove: () => handleInlineFilterChange({ companyName: undefined, companyId: undefined }),
      });
    }

    if (inlineFilters.uen) {
      chips.push({
        key: 'uen',
        label: 'UEN',
        value: inlineFilters.uen,
        onRemove: () => handleInlineFilterChange({ uen: undefined }),
      });
    }

    if (inlineFilters.address) {
      chips.push({
        key: 'address',
        label: 'Address',
        value: inlineFilters.address,
        onRemove: () => handleInlineFilterChange({ address: undefined }),
      });
    }

    if (inlineFilters.hasWarnings !== undefined) {
      chips.push({
        key: 'hasWarnings',
        label: 'Warnings',
        value: inlineFilters.hasWarnings ? 'Yes' : 'No',
        onRemove: () => handleInlineFilterChange({ hasWarnings: undefined }),
      });
    }

    if (inlineFilters.entityType) {
      chips.push({
        key: 'entityType',
        label: 'Type',
        value: getEntityTypeLabel(inlineFilters.entityType, true),
        onRemove: () => handleInlineFilterChange({ entityType: undefined }),
      });
    }

    if (inlineFilters.status) {
      chips.push({
        key: 'status',
        label: 'Status',
        value: getCompanyStatusLabel(inlineFilters.status),
        onRemove: () => handleInlineFilterChange({ status: undefined }),
      });
    }

    if (inlineFilters.incorporationDateFrom || inlineFilters.incorporationDateTo) {
      const from = inlineFilters.incorporationDateFrom;
      const to = inlineFilters.incorporationDateTo;
      let value = '';
      if (from && to) {
        value = `${from} - ${to}`;
      } else if (from) {
        value = `From ${from}`;
      } else if (to) {
        value = `To ${to}`;
      }
      chips.push({
        key: 'incorporationDate',
        label: 'Incorporated',
        value,
        onRemove: () => handleInlineFilterChange({ incorporationDateFrom: undefined, incorporationDateTo: undefined }),
      });
    }

    if (inlineFilters.officersMin !== undefined || inlineFilters.officersMax !== undefined) {
      const min = inlineFilters.officersMin;
      const max = inlineFilters.officersMax;
      let value = '';
      if (min !== undefined && max !== undefined && min === max) {
        value = `${min}`;
      } else if (min !== undefined && max !== undefined) {
        value = `${min} - ${max}`;
      } else if (min !== undefined) {
        value = `≥ ${min}`;
      } else if (max !== undefined) {
        value = `≤ ${max}`;
      }
      chips.push({
        key: 'officers',
        label: 'Officers',
        value,
        onRemove: () => handleInlineFilterChange({ officersMin: undefined, officersMax: undefined }),
      });
    }

    if (inlineFilters.shareholdersMin !== undefined || inlineFilters.shareholdersMax !== undefined) {
      const min = inlineFilters.shareholdersMin;
      const max = inlineFilters.shareholdersMax;
      let value = '';
      if (min !== undefined && max !== undefined && min === max) {
        value = `${min}`;
      } else if (min !== undefined && max !== undefined) {
        value = `${min} - ${max}`;
      } else if (min !== undefined) {
        value = `≥ ${min}`;
      } else if (max !== undefined) {
        value = `≤ ${max}`;
      }
      chips.push({
        key: 'shareholders',
        label: 'Shareholders',
        value,
        onRemove: () => handleInlineFilterChange({ shareholdersMin: undefined, shareholdersMax: undefined }),
      });
    }

    if (inlineFilters.homeCurrency) {
      chips.push({
        key: 'homeCurrency',
        label: 'Currency',
        value: inlineFilters.homeCurrency,
        onRemove: () => handleInlineFilterChange({ homeCurrency: undefined }),
      });
    }

    if (inlineFilters.financialYearEndMonth) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      chips.push({
        key: 'fye',
        label: 'FYE',
        value: monthNames[inlineFilters.financialYearEndMonth - 1] || String(inlineFilters.financialYearEndMonth),
        onRemove: () => handleInlineFilterChange({ financialYearEndMonth: undefined }),
      });
    }

    if (inlineFilters.paidUpCapitalMin !== undefined || inlineFilters.paidUpCapitalMax !== undefined) {
      const min = inlineFilters.paidUpCapitalMin;
      const max = inlineFilters.paidUpCapitalMax;
      let value = '';
      if (min !== undefined && max !== undefined && min === max) {
        value = `$${min.toLocaleString()}`;
      } else if (min !== undefined && max !== undefined) {
        value = `$${min.toLocaleString()} - $${max.toLocaleString()}`;
      } else if (min !== undefined) {
        value = `≥ $${min.toLocaleString()}`;
      } else if (max !== undefined) {
        value = `≤ $${max.toLocaleString()}`;
      }
      chips.push({
        key: 'paidUpCapital',
        label: 'Paid-up Capital',
        value,
        onRemove: () => handleInlineFilterChange({ paidUpCapitalMin: undefined, paidUpCapitalMax: undefined }),
      });
    }

    if (inlineFilters.issuedCapitalMin !== undefined || inlineFilters.issuedCapitalMax !== undefined) {
      const min = inlineFilters.issuedCapitalMin;
      const max = inlineFilters.issuedCapitalMax;
      let value = '';
      if (min !== undefined && max !== undefined && min === max) {
        value = `$${min.toLocaleString()}`;
      } else if (min !== undefined && max !== undefined) {
        value = `$${min.toLocaleString()} - $${max.toLocaleString()}`;
      } else if (min !== undefined) {
        value = `≥ $${min.toLocaleString()}`;
      } else if (max !== undefined) {
        value = `≤ $${max.toLocaleString()}`;
      }
      chips.push({
        key: 'issuedCapital',
        label: 'Issued Capital',
        value,
        onRemove: () => handleInlineFilterChange({ issuedCapitalMin: undefined, issuedCapitalMax: undefined }),
      });
    }

    return chips;
  }, [inlineFilters, handleInlineFilterChange]);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    updateParams({
      query: '',
      companyId: undefined,
      uen: undefined,
      address: undefined,
      entityType: undefined,
      status: undefined,
      hasCharges: undefined,
      hasWarnings: undefined,
      incorporationDateFrom: undefined,
      incorporationDateTo: undefined,
      officersMin: undefined,
      officersMax: undefined,
      shareholdersMin: undefined,
      shareholdersMax: undefined,
      homeCurrency: undefined,
      financialYearEndMonth: undefined,
      paidUpCapitalMin: undefined,
      paidUpCapitalMax: undefined,
      issuedCapitalMin: undefined,
      issuedCapitalMax: undefined,
    });
  }, [updateParams]);

  const handleSort = (field: string) => {
    setParams((prev) => {
      if (prev.sortBy === field) {
        // Toggle order if same field
        return { ...prev, sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc' };
      }
      // New field, default to ascending
      return { ...prev, sortBy: field, sortOrder: 'asc' };
    });
  };

  const handleDeleteClick = (id: string) => {
    setCompanyToDelete(id);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async (reason?: string) => {
    if (!companyToDelete || !reason) return;

    try {
      await deleteCompany.mutateAsync({ id: companyToDelete, reason });
      success('Company deleted successfully');
      setDeleteDialogOpen(false);
      setCompanyToDelete(null);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to delete company');
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setCompanyToDelete(null);
  };

  // Bulk delete handlers
  const handleBulkDeleteClick = () => {
    if (selectedCount === 0) return;
    setBulkDeleteDialogOpen(true);
  };

  const handleBulkDeleteConfirm = async (reason?: string) => {
    if (!reason || selectedCount === 0) return;

    try {
      const result = await bulkDeleteCompanies.mutateAsync({
        ids: Array.from(selectedIds),
        reason,
      });
      success(result.message);
      setBulkDeleteDialogOpen(false);
      clearSelection();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to delete companies');
    }
  };

  const handleBulkDeleteCancel = () => {
    setBulkDeleteDialogOpen(false);
  };

  const handleExportContactDetails = async () => {
    if (selectedCount === 0) return;

    try {
      await exportContactDetails.mutateAsync(Array.from(selectedIds));
      success('Contact details exported successfully');
    } catch {
      // Error handled by mutation
    }
  };

  const isRefreshing = isFetching;

  useKeyboardShortcuts([
    {
      key: 'r',
      ctrl: true,
      handler: handleRefresh,
      description: 'Refresh companies',
    },
    ...(can.createCompany ? [{
      key: 'F1',
      handler: () => router.push('/companies/new'),
      description: 'Add company',
    }] : []),
    ...(can.createDocument ? [{
      key: 'F2',
      handler: () => router.push('/companies/upload'),
      description: 'Upload BizFile',
    }] : []),
    {
      key: 'k',
      ctrl: true,
      handler: focusSearchInput,
      description: 'Focus search',
    },
  ]);

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">Companies</h1>
          <p className="text-text-secondary text-sm mt-1">
            Manage company records, BizFile uploads, and compliance tracking
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRefresh}
            className="btn-secondary btn-sm flex items-center gap-2 whitespace-nowrap"
            aria-label="Refresh companies"
            title="Refresh list (Ctrl+R)"
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden xl:inline">Refresh (Ctrl+R)</span>
            <span className="xl:hidden">Refresh</span>
          </button>
          {can.createDocument && (
            <Link href="/companies/upload" className="btn-secondary btn-sm flex items-center gap-2 whitespace-nowrap" title="Upload BizFile (F2)">
              <FileUp className="w-4 h-4" />
              <span className="hidden xl:inline">Upload BizFile (F2)</span>
              <span className="xl:hidden">Upload</span>
            </Link>
          )}
          {can.createCompany && (
            <Link href="/companies/new" className="btn-primary btn-sm flex items-center gap-2 whitespace-nowrap" title="Add company (F1)">
              <Plus className="w-4 h-4" />
              <span className="hidden xl:inline">Add Company (F1)</span>
              <span className="xl:hidden">Add</span>
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <CompanyFilters
          onSearch={handleSearch}
          onFilterChange={handleFilterChange}
          initialFilters={{
            entityType: params.entityType,
            status: params.status,
            hasCharges: params.hasCharges,
            address: params.address,
            homeCurrency: params.homeCurrency,
            hasWarnings: params.hasWarnings,
            incorporationDateFrom: params.incorporationDateFrom,
            incorporationDateTo: params.incorporationDateTo,
            officersMin: params.officersMin,
            officersMax: params.officersMax,
            shareholdersMin: params.shareholdersMin,
            shareholdersMax: params.shareholdersMax,
            paidUpCapitalMin: params.paidUpCapitalMin,
            paidUpCapitalMax: params.paidUpCapitalMax,
            issuedCapitalMin: params.issuedCapitalMin,
            issuedCapitalMax: params.issuedCapitalMax,
            financialYearEndMonth: params.financialYearEndMonth,
          }}
          initialQuery={params.query}
          searchInputId={COMPANY_SEARCH_INPUT_ID}
        />
      </div>

      {/* Error State */}
      {error && (
        <div className="card border-status-error bg-status-error/5 mb-4">
          <div className="flex items-center gap-3 text-status-error">
            <AlertCircle className="w-5 h-5" />
            <p>{error instanceof Error ? error.message : 'Failed to load companies'}</p>
          </div>
        </div>
      )}

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
            onClick={clearAllFilters}
            className="text-sm text-text-muted hover:text-text-primary transition-colors ml-2"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Loading State - Only show on initial load when no data exists */}
      {isLoading && !data && (
        <div className="card p-8 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-oak-light border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-text-secondary">Loading companies...</span>
        </div>
      )}

      {/* Table - Only render when data exists */}
      {data && (
        <CompanyTable
          companies={data.companies}
          returnTo={targetUrl}
          onDelete={handleDeleteClick}
          isFetching={isFetching}
          canEdit={canEditCompany}
          canDelete={canDeleteCompany}
          canCreate={can.createCompany}
          selectable={can.deleteCompany || can.exportCompany}
          selectedIds={selectedIds}
          onToggleOne={toggleOne}
          onToggleAll={toggleAll}
          isAllSelected={isAllSelected}
          isIndeterminate={isIndeterminate}
          sortBy={params.sortBy}
          sortOrder={params.sortOrder}
          onSort={handleSort}
          inlineFilters={inlineFilters}
          onInlineFilterChange={handleInlineFilterChange}
          columnWidths={columnWidths}
          onColumnWidthChange={handleColumnWidthChange}
          emptyState={(
            <ListEmptyState
              icon={Building2}
              noun="companies"
              filtered={activeFilterChips.length > 0}
              onClearFilters={clearAllFilters}
              createAction={can.createCompany ? <Link href="/companies/new" className="btn-primary btn-sm inline-flex">Add Company</Link> : undefined}
              emptyDescription="Add a company or upload a BizFile to get started."
            />
          )}
        />
      )}

      {/* Pagination */}
      {data && data.totalPages > 0 && (
        <div className="mt-4">
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            limit={data.limit}
            onPageChange={handlePageChange}
            onLimitChange={handleLimitChange}
          />
        </div>
      )}

      {/* Floating Bulk Actions Toolbar */}
      {(can.deleteCompany || can.exportCompany) && (
        <BulkActionsToolbar
          selectedCount={selectedCount}
          onClearSelection={clearSelection}
          itemLabel="company"
          actions={[
            ...(can.exportCompany ? [{
              id: 'export-contacts',
              label: 'Export Contacts',
              icon: Download,
              description: 'Export contact details to Excel',
              variant: 'default' as const,
              isLoading: exportContactDetails.isPending,
            }] : []),
            ...(can.deleteCompany ? [{
              id: 'delete',
              label: 'Delete',
              icon: Trash2,
              description: 'Delete selected companies',
              variant: 'danger' as const,
              isLoading: bulkDeleteCompanies.isPending,
            }] : []),
          ]}
          onAction={(actionId) => {
            if (actionId === 'delete') {
              handleBulkDeleteClick();
            } else if (actionId === 'export-contacts') {
              handleExportContactDetails();
            }
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        title="Delete Company"
        description="This action cannot be undone. The company will be soft-deleted and can be restored by an administrator."
        confirmLabel="Delete"
        variant="danger"
        requireReason
        reasonLabel="Reason for deletion"
        reasonPlaceholder="Please provide a reason for deleting this company..."
        reasonMinLength={10}
        isLoading={deleteCompany.isPending}
      />

      {/* Bulk Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={bulkDeleteDialogOpen}
        onClose={handleBulkDeleteCancel}
        onConfirm={handleBulkDeleteConfirm}
        title={`Delete ${selectedCount} ${selectedCount > 1 ? 'Companies' : 'Company'}`}
        description={`You are about to delete ${selectedCount} ${selectedCount > 1 ? 'companies' : 'company'}. This action cannot be undone. The companies will be soft-deleted and can be restored by an administrator.`}
        confirmLabel={`Delete ${selectedCount} ${selectedCount > 1 ? 'Companies' : 'Company'}`}
        variant="danger"
        requireReason
        reasonLabel="Reason for deletion"
        reasonPlaceholder="Please provide a reason for deleting these companies..."
        reasonMinLength={10}
        isLoading={bulkDeleteCompanies.isPending}
      />
    </div>
  );
}
