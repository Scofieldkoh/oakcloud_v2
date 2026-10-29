'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Plus, AlertCircle, Trash2, X, RefreshCw, UserRoundSearch, Users } from 'lucide-react';
import { ListEmptyState } from '@/components/ui/empty-state';
import { useContacts, useDeleteContact, useBulkDeleteContacts, useContactDuplicateGroups } from '@/hooks/use-contacts';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { useSelection } from '@/hooks/use-selection';
import { useUserPreference, useUpsertUserPreference } from '@/hooks/use-user-preferences';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useWorkspaceListReset } from '@/hooks/use-workspace-list-reset';
import { useUrlListParams } from '@/hooks/use-url-list-params';
import { urlParam, type UrlParamSpec } from '@/lib/url-list-params';
import { ContactTable, type ContactInlineFilters } from '@/components/contacts/contact-table';
import { ContactFilters, type FilterValues } from '@/components/contacts/contact-filters';
import { Pagination } from '@/components/ui/pagination';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { BulkActionsToolbar } from '@/components/ui/bulk-actions-toolbar';
import { useToast } from '@/components/ui/toast';
import type { ContactType, IdentificationType } from '@/generated/prisma';

const ContactDuplicateReviewModal = dynamic(
  () => import('@/components/contacts/contact-duplicate-review-modal').then((module) => module.ContactDuplicateReviewModal),
  { ssr: false },
);

// Types for search params
type SortByField = 'fullName' | 'contactType' | 'nationality' | 'companyRelationsCount' | 'createdAt' | 'updatedAt';

interface ContactPageParams {
  query: string;
  page: number;
  limit: number;
  sortBy: SortByField;
  sortOrder: 'asc' | 'desc';
  contactType?: ContactType;
  // Inline filters
  fullName?: string;
  identificationType?: IdentificationType;
  identificationNumber?: string;
  nationality?: string;
  email?: string;
  phone?: string;
  companiesMin?: number;
  companiesMax?: number;
}

/** Search, filters, sort and paging kept in the /contacts URL. */
const CONTACT_LIST_PARAMS: UrlParamSpec<ContactPageParams> = {
  query: urlParam.string('', { key: 'q' }),
  page: urlParam.int(1),
  limit: urlParam.int(20),
  sortBy: urlParam.choice<SortByField>('fullName'),
  sortOrder: urlParam.choice<'asc' | 'desc'>('asc'),
  contactType: urlParam.optional<ContactType>(),
  fullName: urlParam.optional(),
  identificationType: urlParam.optional<IdentificationType>(),
  identificationNumber: urlParam.optional(),
  nationality: urlParam.optional(),
  email: urlParam.optional(),
  phone: urlParam.optional(),
  companiesMin: urlParam.optionalInt(),
  companiesMax: urlParam.optionalInt(),
};

// Filter chip type for active filters display
interface ActiveFilterChip {
  key: string;
  label: string;
  onClear: () => void;
}

const CONTACT_SEARCH_INPUT_ID = 'contacts-search-input';

export default function ContactsPage() {
  const router = useRouter();
  const { success, error: showError } = useToast();
  const { can, isWorkspaceAdmin } = usePermissions();
  const { data: session } = useSession();
  const [duplicateReviewOpen, setDuplicateReviewOpen] = useState(false);
  const hasWorkspaceWideContactAccess = Boolean(
    isWorkspaceAdmin || session?.isSuperAdmin || session?.companyIds.length === 0,
  );
  const canReviewDuplicates = can.updateContact && hasWorkspaceWideContactAccess;
  const duplicateSummary = useContactDuplicateGroups(1, 1, canReviewDuplicates);
  const duplicateCountUnavailable = Boolean(duplicateSummary.error);

  // Get active tenant ID (from store for SUPER_ADMIN, from session for others)
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  // Column width persistence
  const COLUMN_PREF_KEY = 'contact-table-column-widths';
  const { data: columnPref } = useUserPreference<Record<string, number>>(COLUMN_PREF_KEY);
  const saveColumnPref = useUpsertUserPreference<Record<string, number>>();
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    const value = columnPref?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    setColumnWidths(value as Record<string, number>);
  }, [columnPref?.value]);

  const { params, setParams, updateParams, targetUrl } = useUrlListParams('/contacts', CONTACT_LIST_PARAMS);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<string | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  // Pass tenantId to filter contacts by selected tenant (for SUPER_ADMIN)
  const { data, isLoading, isFetching, error, refetch } = useContacts(
    {
      ...params,
      tenantId: activeTenantId,
    },
    { restoreSession: true },
  );
  const deleteContact = useDeleteContact();
  const bulkDeleteContacts = useBulkDeleteContacts();

  // Selection state for bulk operations
  const {
    selectedIds,
    selectedCount,
    isAllSelected,
    isIndeterminate,
    toggleOne,
    toggleAll,
    clear: clearSelection,
  } = useSelection(data?.contacts || []);


  const resetForWorkspaceChange = useCallback(() => {
    setParams((prev) => ({ ...prev, page: 1 }));
    clearSelection();
  }, [clearSelection, setParams]);

  useWorkspaceListReset(activeTenantId, resetForWorkspaceChange);

  const handleSearch = (query: string) => {
    updateParams({ query });
  };

  const handleFilterChange = (newFilters: FilterValues) => {
    updateParams(newFilters);
  };

  const handleInlineFilterChange = useCallback((filters: Partial<ContactInlineFilters>) => {
    updateParams(filters);
  }, [updateParams]);

  const handlePageChange = (page: number) => {
    updateParams({ page });
  };

  const handleLimitChange = (limit: number) => {
    updateParams({ limit });
  };

  const handleSort = (field: string) => {
    setParams((prev) => {
      if (prev.sortBy === field) {
        // Toggle order if same field
        return { ...prev, sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc' };
      }
      // New field, default to ascending
      return { ...prev, sortBy: field as SortByField, sortOrder: 'asc' };
    });
  };

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
    const input = document.getElementById(CONTACT_SEARCH_INPUT_ID) as HTMLInputElement | null;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  const handleDeleteClick = (id: string) => {
    setContactToDelete(id);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async (reason?: string) => {
    if (!contactToDelete || !reason) return;

    try {
      await deleteContact.mutateAsync({ id: contactToDelete, reason });
      success('Contact deleted successfully');
      setDeleteDialogOpen(false);
      setContactToDelete(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete contact');
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setContactToDelete(null);
  };

  // Bulk delete handlers
  const handleBulkDeleteClick = () => {
    if (selectedCount === 0) return;
    setBulkDeleteDialogOpen(true);
  };

  const handleBulkDeleteConfirm = async (reason?: string) => {
    if (!reason || selectedCount === 0) return;

    try {
      const result = await bulkDeleteContacts.mutateAsync({
        ids: Array.from(selectedIds),
        reason,
      });
      success(result.message);
      setBulkDeleteDialogOpen(false);
      clearSelection();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete contacts');
    }
  };

  const handleBulkDeleteCancel = () => {
    setBulkDeleteDialogOpen(false);
  };

  useKeyboardShortcuts([
    {
      key: 'r',
      ctrl: true,
      handler: handleRefresh,
      description: 'Refresh contacts',
    },
    ...(can.createContact ? [{
      key: 'F1',
      handler: () => router.push('/contacts/new'),
      description: 'Add contact',
    }] : []),
    {
      key: 'k',
      ctrl: true,
      handler: focusSearchInput,
      description: 'Focus search',
    },
  ]);

  // Build active filter chips
  const activeFilterChips: ActiveFilterChip[] = useMemo(() => {
    const chips: ActiveFilterChip[] = [];

    if (params.fullName) {
      chips.push({
        key: 'fullName',
        label: `Name: ${params.fullName}`,
        onClear: () => updateParams({ fullName: undefined }),
      });
    }
    if (params.contactType) {
      chips.push({
        key: 'contactType',
        label: `Type: ${params.contactType === 'INDIVIDUAL' ? 'Individual' : 'Corporate'}`,
        onClear: () => updateParams({ contactType: undefined }),
      });
    }
    if (params.identificationType) {
      const labels: Record<IdentificationType, string> = {
        NRIC: 'NRIC', FIN: 'FIN', PASSPORT: 'Passport', UEN: 'UEN', OTHER: 'Other'
      };
      chips.push({
        key: 'identificationType',
        label: `ID Type: ${labels[params.identificationType]}`,
        onClear: () => updateParams({ identificationType: undefined }),
      });
    }
    if (params.identificationNumber) {
      chips.push({
        key: 'identificationNumber',
        label: `ID: ${params.identificationNumber}`,
        onClear: () => updateParams({ identificationNumber: undefined }),
      });
    }
    if (params.nationality) {
      chips.push({
        key: 'nationality',
        label: `Nationality: ${params.nationality}`,
        onClear: () => updateParams({ nationality: undefined }),
      });
    }
    if (params.email) {
      chips.push({
        key: 'email',
        label: `Email: ${params.email}`,
        onClear: () => updateParams({ email: undefined }),
      });
    }
    if (params.phone) {
      chips.push({
        key: 'phone',
        label: `Phone: ${params.phone}`,
        onClear: () => updateParams({ phone: undefined }),
      });
    }
    if (params.companiesMin !== undefined || params.companiesMax !== undefined) {
      let label = 'Companies: ';
      if (params.companiesMin !== undefined && params.companiesMax !== undefined) {
        label += params.companiesMin === params.companiesMax
          ? `${params.companiesMin}`
          : `${params.companiesMin} - ${params.companiesMax}`;
      } else if (params.companiesMin !== undefined) {
        label += `≥ ${params.companiesMin}`;
      } else {
        label += `≤ ${params.companiesMax}`;
      }
      chips.push({
        key: 'companies',
        label,
        onClear: () => updateParams({ companiesMin: undefined, companiesMax: undefined }),
      });
    }

    return chips;
  }, [params, updateParams]);

  const clearAllFilters = () => {
    updateParams({
      fullName: undefined,
      contactType: undefined,
      identificationType: undefined,
      identificationNumber: undefined,
      nationality: undefined,
      email: undefined,
      phone: undefined,
      companiesMin: undefined,
      companiesMax: undefined,
    });
  };

  // Map params to inline filters
  const inlineFilters: ContactInlineFilters = useMemo(() => ({
    fullName: params.fullName,
    contactType: params.contactType,
    identificationType: params.identificationType,
    identificationNumber: params.identificationNumber,
    nationality: params.nationality,
    email: params.email,
    phone: params.phone,
    companiesMin: params.companiesMin,
    companiesMax: params.companiesMax,
  }), [params]);

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">Contacts</h1>
          <p className="text-text-secondary text-sm mt-1">
            Manage individuals and corporate contacts linked to companies
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRefresh}
            className="btn-secondary btn-sm flex items-center gap-2 whitespace-nowrap"
            aria-label="Refresh contacts"
            title="Refresh list (Ctrl+R)"
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            <span className="hidden xl:inline">Refresh (Ctrl+R)</span>
            <span className="xl:hidden">Refresh</span>
          </button>
          {canReviewDuplicates && (
            <button
              type="button"
              onClick={() => setDuplicateReviewOpen(true)}
              className="btn-secondary btn-sm flex min-h-11 items-center gap-2 whitespace-nowrap sm:min-h-0"
              aria-label={duplicateCountUnavailable
                ? 'Review duplicates, count unavailable'
                : `Review duplicates, ${duplicateSummary.data?.total ?? 0} pending`}
            >
              <UserRoundSearch className="h-4 w-4" />
              <span>Review duplicates</span>
              <span className="badge badge-warning">
                {duplicateCountUnavailable ? 'Count unavailable' : `${duplicateSummary.data?.total ?? 0} pending`}
              </span>
            </button>
          )}
          {can.createContact && (
            <Link href="/contacts/new" className="btn-primary btn-sm flex items-center gap-2 whitespace-nowrap" title="Add contact (F1)">
              <Plus className="w-4 h-4" />
              <span className="hidden xl:inline">Add Contact (F1)</span>
              <span className="xl:hidden">Add</span>
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <ContactFilters
          onSearch={handleSearch}
          onFilterChange={handleFilterChange}
          initialFilters={{
            contactType: params.contactType,
            fullName: params.fullName,
            identificationType: params.identificationType,
            identificationNumber: params.identificationNumber,
            nationality: params.nationality,
            email: params.email,
            phone: params.phone,
            companiesMin: params.companiesMin,
            companiesMax: params.companiesMax,
          }}
          initialQuery={params.query}
          searchInputId={CONTACT_SEARCH_INPUT_ID}
        />
      </div>

      {/* Active Filter Chips */}
      {activeFilterChips.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">Active filters:</span>
          {activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              onClick={chip.onClear}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-oak-primary/10 text-oak-light hover:bg-oak-primary/20 transition-colors group"
            >
              <span>{chip.label}</span>
              <X className="w-3 h-3 opacity-60 group-hover:opacity-100" />
            </button>
          ))}
          {activeFilterChips.length > 1 && (
            <button
              onClick={clearAllFilters}
              className="text-xs text-text-secondary hover:text-text-primary underline ml-2"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card border-status-error bg-status-error/5 mb-4">
          <div className="flex items-center gap-3 text-status-error">
            <AlertCircle className="w-5 h-5" />
            <p>{error instanceof Error ? error.message : 'Failed to load contacts'}</p>
          </div>
        </div>
      )}


      {/* Table */}
      <div>
        <ContactTable
          contacts={data?.contacts || []}
          returnTo={targetUrl}
          onDelete={handleDeleteClick}
          isLoading={isLoading}
          isFetching={isFetching}
          canEdit={can.updateContact}
          canDelete={can.deleteContact}
          canCreate={can.createContact}
          selectable={can.deleteContact}
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
              icon={Users}
              noun="contacts"
              filtered={activeFilterChips.length > 0 || Boolean(params.query)}
              onClearFilters={() => { clearAllFilters(); if (params.query) handleSearch(''); }}
              createAction={can.createContact ? <Link href="/contacts/new" className="btn-primary btn-sm inline-flex">Add Contact</Link> : undefined}
              emptyDescription="Contacts are added here or from a company's BizFile."
            />
          )}
        />
      </div>

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
      {can.deleteContact && (
        <BulkActionsToolbar
          selectedCount={selectedCount}
          onClearSelection={clearSelection}
          itemLabel="contact"
          actions={[
            {
              id: 'delete',
              label: 'Delete',
              icon: Trash2,
              description: 'Delete selected contacts',
              variant: 'danger',
              isLoading: bulkDeleteContacts.isPending,
            },
          ]}
          onAction={(actionId) => {
            if (actionId === 'delete') {
              handleBulkDeleteClick();
            }
          }}
        />
      )}

      {duplicateReviewOpen ? (
        <ContactDuplicateReviewModal
          open
          onClose={() => setDuplicateReviewOpen(false)}
        />
      ) : null}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        title="Delete Contact"
        description="This action cannot be undone. The contact will be soft-deleted and can be restored by an administrator."
        confirmLabel="Delete"
        variant="danger"
        requireReason
        reasonLabel="Reason for deletion"
        reasonPlaceholder="Please provide a reason for deleting this contact..."
        reasonMinLength={10}
        isLoading={deleteContact.isPending}
      />

      {/* Bulk Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={bulkDeleteDialogOpen}
        onClose={handleBulkDeleteCancel}
        onConfirm={handleBulkDeleteConfirm}
        title={`Delete ${selectedCount} Contact${selectedCount > 1 ? 's' : ''}`}
        description={`You are about to delete ${selectedCount} contact${selectedCount > 1 ? 's' : ''}. This action cannot be undone. The contacts will be soft-deleted and can be restored by an administrator.`}
        confirmLabel={`Delete ${selectedCount} Contact${selectedCount > 1 ? 's' : ''}`}
        variant="danger"
        requireReason
        reasonLabel="Reason for deletion"
        reasonPlaceholder="Please provide a reason for deleting these contacts..."
        reasonMinLength={10}
        isLoading={bulkDeleteContacts.isPending}
      />
    </div>
  );
}
