'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { DataGrid, type DataGridColumn } from '@/components/ui/data-grid';
import { TableSelectFilter, TableTextFilter } from '@/components/ui/data-table';
import { TableDateRangeFilter, toLocalDateString } from '@/components/ui/table-date-range-filter';
import { ActiveFilterBar, type ActiveFilter } from '@/components/ui/active-filter-bar';
import { ListEmptyState } from '@/components/ui/empty-state';
import { BulkActionsToolbar } from '@/components/ui/bulk-actions-toolbar';
import { MobileCard, CardDetailsGrid, CardDetailItem } from '@/components/ui/responsive-table';
import { ServiceColumnModal } from '@/components/services/shared/service-column-modal';
import { quickFilterClass } from '@/components/services/shared/service-filter-toolbar';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';
import { useUrlListParams } from '@/hooks/use-url-list-params';
import { useTableColumnPreference } from '@/hooks/use-table-column-preference';
import { urlParam, type UrlParamSpec } from '@/lib/url-list-params';
import {
  TEMPLATE_PARTIAL_CATEGORY_OPTIONS,
  templatePartialCategoryLabel,
  type TemplatePartialCategoryValue,
} from '@/lib/validations/template-partial';
import {
  useTemplatePartials,
  useDeletePartial,
  useDuplicatePartial,
  usePartialUsage,
  type TemplatePartialWithRelations,
} from '@/hooks/use-template-partials';
import {
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Copy,
  Code,
  FileCode,
  ChevronRight,
  Loader2,
  AlertCircle,
  Eye,
  CalendarDays,
} from 'lucide-react';
import { formatDateShort } from '@/lib/utils';
import { LibraryToolbar, TemplateLibraryShell } from '../template-library-shell';

// ============================================================================
// Helper Components
// ============================================================================

function UsageCount({ count }: { count: number }) {
  return (
    <span className={count > 0 ? 'badge badge-info inline-flex items-center gap-1' : 'badge badge-neutral inline-flex items-center gap-1'}>
      <FileCode className="w-3 h-3" aria-hidden="true" />
      {count} template{count !== 1 ? 's' : ''}
    </span>
  );
}

function PartialSyntax({ name }: { name: string }) {
  return (
    <code className="px-1.5 py-0.5 bg-background-tertiary rounded text-xs font-mono text-accent-primary">
      {'{{>'} {name} {'}}'}
    </code>
  );
}

// ============================================================================
// List state (kept in the URL) and columns (kept per user)
// ============================================================================

type PartialSortField = 'name' | 'category' | 'createdBy' | 'updatedAt';

type UsageFilter = 'used' | 'unused';

const USAGE_OPTIONS: { value: UsageFilter; label: string }[] = [
  { value: 'used', label: 'Used' },
  { value: 'unused', label: 'Unused' },
];

interface PartialListParams {
  query: string;
  name: string | undefined;
  reference: string | undefined;
  description: string | undefined;
  category: TemplatePartialCategoryValue | undefined;
  usage: UsageFilter | undefined;
  createdBy: string | undefined;
  updatedFrom: string | undefined;
  updatedTo: string | undefined;
  sortBy: PartialSortField;
  sortOrder: 'asc' | 'desc';
  page: number;
  limit: number;
}

const PARTIAL_LIST_PARAMS: UrlParamSpec<PartialListParams> = {
  query: urlParam.string('', { key: 'q' }),
  name: urlParam.optional(),
  reference: urlParam.optional(),
  description: urlParam.optional(),
  category: urlParam.optional<TemplatePartialCategoryValue>(),
  usage: urlParam.optional<UsageFilter>(),
  createdBy: urlParam.optional(),
  updatedFrom: urlParam.optional(),
  updatedTo: urlParam.optional(),
  sortBy: urlParam.choice<PartialSortField>('name'),
  sortOrder: urlParam.choice<'asc' | 'desc'>('asc'),
  page: urlParam.int(1),
  limit: urlParam.int(20),
};

const COLUMN_IDS = ['name', 'syntax', 'description', 'category', 'usage', 'createdBy', 'updated', 'actions'] as const;
type ColumnId = (typeof COLUMN_IDS)[number];
const COLUMN_LABELS: Record<ColumnId, string> = {
  name: 'Partial',
  syntax: 'Reference',
  description: 'Description',
  category: 'Category',
  usage: 'Used In',
  createdBy: 'Created By',
  updated: 'Updated',
  actions: 'Actions',
};
const COLUMN_PREFERENCE_KEY = 'template-library:partials:columns:v1';
const LOCKED_COLUMNS: ColumnId[] = ['name', 'actions'];

// ============================================================================
// Partial Templates List
// ============================================================================

function TemplatePartialsTab({
  activeTenantId,
  canCreate,
  canUpdate,
  canDelete,
  isSuperAdmin,
}: {
  activeTenantId: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const { success, error: showError } = useToast();

  // Search, filters, sort and page live in the URL; the column layout is saved per user.
  const { params, setParams, updateParams } = useUrlListParams('/template-partials/partials', PARTIAL_LIST_PARAMS);
  const search = useDebouncedSearch(params.query, (query) => updateParams({ query }));
  const columns = useTableColumnPreference(COLUMN_PREFERENCE_KEY, COLUMN_IDS, {
    locked: LOCKED_COLUMNS,
    hiddenByDefault: ['createdBy'],
  });
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal states (keep duplicate, delete, usage modals - create/edit use full page editor)
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isUsageOpen, setIsUsageOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [selectedPartial, setSelectedPartial] = useState<TemplatePartialWithRelations | null>(null);

  // Form state for duplicate modal
  const [duplicateName, setDuplicateName] = useState('');

  // Queries and mutations
  const { data, isLoading, isFetching, error } = useTemplatePartials({
    search: params.query || undefined,
    editor: 'oakdoc',
    category: params.category,
    name: params.name,
    reference: params.reference,
    description: params.description,
    usage: params.usage,
    createdBy: params.createdBy,
    updatedFrom: params.updatedFrom,
    updatedTo: params.updatedTo,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
    page: params.page,
    limit: params.limit,
    tenantId: isSuperAdmin ? activeTenantId : undefined,
  });

  const deleteMutation = useDeletePartial();
  const duplicateMutation = useDuplicatePartial();
  const { data: usageData, isLoading: usageLoading } = usePartialUsage(
    isUsageOpen ? selectedPartial?.id || null : null,
    isSuperAdmin ? activeTenantId : undefined
  );

  // Handlers - Navigate to editor page for create/edit (same as templates)
  const openCreate = () => {
    router.push('/template-partials/editor?type=partial&tab=partials');
  };

  const openEdit = (partial: TemplatePartialWithRelations) => {
    router.push(`/template-partials/editor?type=partial&tab=partials&id=${partial.id}`);
  };

  const openDuplicate = (partial: TemplatePartialWithRelations) => {
    setSelectedPartial(partial);
    setDuplicateName(`${partial.name}-copy`);
    setIsDuplicateOpen(true);
  };

  const openDelete = (partial: TemplatePartialWithRelations) => {
    setSelectedPartial(partial);
    setIsDeleteOpen(true);
  };

  const openUsage = (partial: TemplatePartialWithRelations) => {
    setSelectedPartial(partial);
    setIsUsageOpen(true);
  };

  const handleDuplicate = async () => {
    if (!selectedPartial) return;
    try {
      await duplicateMutation.mutateAsync({
        id: selectedPartial.id,
        name: duplicateName,
        tenantId: isSuperAdmin ? activeTenantId : undefined,
      });
      success('Partial duplicated successfully');
      setIsDuplicateOpen(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to duplicate partial');
    }
  };

  const handleDelete = async (reason?: string) => {
    if (!selectedPartial) return;
    try {
      await deleteMutation.mutateAsync({
        id: selectedPartial.id,
        reason,
        tenantId: isSuperAdmin ? activeTenantId : undefined,
      });
      success('Partial deleted successfully');
      setIsDeleteOpen(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete partial');
    }
  };

  const partials = useMemo(() => data?.partials ?? [], [data?.partials]);
  const selectedPartials = partials.filter((partial) => selectedIds.has(partial.id));

  const handleBulkDelete = async (reason?: string) => {
    setIsBulkDeleting(true);
    let done = 0;
    let firstError: string | undefined;
    for (const partial of selectedPartials) {
      try {
        await deleteMutation.mutateAsync({
          id: partial.id,
          reason,
          tenantId: isSuperAdmin ? activeTenantId : undefined,
        });
        done += 1;
      } catch (err) {
        firstError ??= `${partial.displayName || partial.name}: ${err instanceof Error ? err.message : 'failed'}`;
      }
    }
    setIsBulkDeleting(false);
    setIsBulkDeleteOpen(false);
    setSelectedIds(new Set());
    if (done > 0) success(`Deleted ${done} partial${done === 1 ? '' : 's'}`);
    if (firstError) showError(firstError);
  };

  // Selection is per page: changing the list clears it.
  const setListParams = useCallback((patch: Partial<PartialListParams>) => {
    setSelectedIds(new Set());
    updateParams(patch);
  }, [updateParams]);

  const toggleCategory = (category: TemplatePartialCategoryValue) => {
    setListParams({ category: params.category === category ? undefined : category });
  };
  const today = toLocalDateString(new Date());
  const updatedToday = Boolean(today && params.updatedFrom === today && params.updatedTo === today);
  const toggleUpdatedToday = () => {
    setListParams(updatedToday ? { updatedFrom: undefined, updatedTo: undefined } : { updatedFrom: today, updatedTo: today });
  };

  const handleSort = (field: string) => {
    const sortBy = field as PartialSortField;
    setListParams({
      sortBy,
      sortOrder: params.sortBy === sortBy && params.sortOrder === 'asc' ? 'desc' : 'asc',
    });
  };

  const clearAllFilters = () => {
    setSelectedIds(new Set());
    setParams((previous) => ({
      ...previous,
      query: '',
      name: undefined,
      reference: undefined,
      description: undefined,
      category: undefined,
      usage: undefined,
      createdBy: undefined,
      updatedFrom: undefined,
      updatedTo: undefined,
      page: 1,
    }));
    search.setDraft('');
  };

  const activeFilters: ActiveFilter[] = [];
  if (params.query) activeFilters.push({ key: 'query', label: 'Search', value: params.query, onRemove: () => search.commitNow('') });
  if (params.name) activeFilters.push({ key: 'name', label: 'Partial', value: params.name, onRemove: () => setListParams({ name: undefined }) });
  if (params.category) activeFilters.push({ key: 'category', label: 'Category', value: templatePartialCategoryLabel(params.category), onRemove: () => setListParams({ category: undefined }) });
  if (params.reference) activeFilters.push({ key: 'reference', label: 'Reference', value: params.reference, onRemove: () => setListParams({ reference: undefined }) });
  if (params.description) activeFilters.push({ key: 'description', label: 'Description', value: params.description, onRemove: () => setListParams({ description: undefined }) });
  if (params.usage) activeFilters.push({ key: 'usage', label: 'Used In', value: params.usage === 'used' ? 'Used' : 'Unused', onRemove: () => setListParams({ usage: undefined }) });
  if (params.createdBy) activeFilters.push({ key: 'createdBy', label: 'Created By', value: params.createdBy, onRemove: () => setListParams({ createdBy: undefined }) });
  if (params.updatedFrom || params.updatedTo) {
    activeFilters.push({
      key: 'updated',
      label: 'Updated',
      value: params.updatedFrom === params.updatedTo
        ? formatDateShort(params.updatedFrom!)
        : `${params.updatedFrom ? formatDateShort(params.updatedFrom) : '...'} to ${params.updatedTo ? formatDateShort(params.updatedTo) : '...'}`,
      onRemove: () => setListParams({ updatedFrom: undefined, updatedTo: undefined }),
    });
  }

  const partialLabel = (partial: TemplatePartialWithRelations) => partial.displayName || partial.name;

  const renderActions = (partial: TemplatePartialWithRelations) => (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => openUsage(partial)}
        title="View usage"
        aria-label={`View usage of ${partialLabel(partial)}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
      >
        <Eye className="w-4 h-4" aria-hidden="true" />
      </button>

      {(canCreate || canUpdate || canDelete) && (
        <Dropdown>
          <DropdownTrigger asChild>
            <button
              type="button"
              aria-label={`More actions for ${partialLabel(partial)}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
            >
              <MoreVertical className="w-4 h-4" aria-hidden="true" />
            </button>
          </DropdownTrigger>
          <DropdownMenu align="right">
            {canUpdate && <DropdownItem icon={<Pencil className="w-4 h-4" />} onClick={() => openEdit(partial)}>Edit</DropdownItem>}
            {canCreate && <DropdownItem icon={<Copy className="w-4 h-4" />} onClick={() => openDuplicate(partial)}>Duplicate</DropdownItem>}
            <DropdownItem icon={<FileCode className="w-4 h-4" />} onClick={() => openUsage(partial)}>View Usage</DropdownItem>
            {canDelete && <DropdownItem icon={<Trash2 className="w-4 h-4" />} destructive onClick={() => openDelete(partial)}>Delete</DropdownItem>}
          </DropdownMenu>
        </Dropdown>
      )}
    </div>
  );

  const columnDefinitions: Record<ColumnId, DataGridColumn<TemplatePartialWithRelations>> = {
    name: {
      id: 'name',
      label: COLUMN_LABELS.name,
      sortField: 'name',
      defaultWidth: 300,
      minWidth: 160,
      renderFilter: () => (
        <TableTextFilter
          ariaLabel="Filter by partial name"
          value={params.name}
          onChange={(name) => setListParams({ name })}
          debounceMs={300}
        />
      ),
      render: (partial) => (
        <span className="block truncate font-medium text-text-primary" title={partialLabel(partial)}>
          {partialLabel(partial)}
        </span>
      ),
    },
    syntax: {
      id: 'syntax',
      label: COLUMN_LABELS.syntax,
      defaultWidth: 260,
      minWidth: 140,
      renderFilter: () => (
        <TableTextFilter
          ariaLabel="Filter by reference"
          value={params.reference}
          onChange={(reference) => setListParams({ reference })}
          debounceMs={300}
        />
      ),
      render: (partial) => <span className="block truncate" title={`{{> ${partial.name} }}`}><PartialSyntax name={partial.name} /></span>,
    },
    description: {
      id: 'description',
      label: COLUMN_LABELS.description,
      defaultWidth: 200,
      minWidth: 140,
      renderFilter: () => (
        <TableTextFilter
          ariaLabel="Filter by description"
          value={params.description}
          onChange={(description) => setListParams({ description })}
          debounceMs={300}
        />
      ),
      render: (partial) => partial.description
        ? <span className="block truncate text-text-secondary" title={partial.description}>{partial.description}</span>
        : <span className="text-text-muted">—</span>,
    },
    category: {
      id: 'category',
      label: COLUMN_LABELS.category,
      sortField: 'category',
      defaultWidth: 130,
      minWidth: 110,
      renderFilter: () => (
        <TableSelectFilter
          options={[{ value: '', label: 'All categories' }, ...TEMPLATE_PARTIAL_CATEGORY_OPTIONS]}
          value={params.category ?? ''}
          onChange={(category) => setListParams({
            category: TEMPLATE_PARTIAL_CATEGORY_OPTIONS.find((option) => option.value === category)?.value,
          })}
          placeholder="All categories"
          ariaLabel="Filter by category"
        />
      ),
      render: (partial) => <span className="badge badge-neutral">{templatePartialCategoryLabel(partial.category)}</span>,
    },
    usage: {
      id: 'usage',
      label: COLUMN_LABELS.usage,
      defaultWidth: 120,
      minWidth: 110,
      renderFilter: () => (
        <TableSelectFilter
          options={[{ value: '', label: 'All' }, ...USAGE_OPTIONS]}
          value={params.usage ?? ''}
          onChange={(usage) => setListParams({ usage: (usage || undefined) as UsageFilter | undefined })}
          placeholder="All"
          ariaLabel="Filter by usage"
        />
      ),
      render: (partial) => <UsageCount count={partial._count?.usedInTemplates || 0} />,
    },
    createdBy: {
      id: 'createdBy',
      label: COLUMN_LABELS.createdBy,
      sortField: 'createdBy',
      defaultWidth: 160,
      minWidth: 110,
      renderFilter: () => (
        <TableTextFilter
          ariaLabel="Filter by creator"
          value={params.createdBy}
          onChange={(createdBy) => setListParams({ createdBy })}
          debounceMs={300}
        />
      ),
      render: (partial) => partial.createdBy
        ? <span className="text-text-secondary">{partial.createdBy.firstName} {partial.createdBy.lastName}</span>
        : <span className="text-text-muted">—</span>,
    },
    updated: {
      id: 'updated',
      label: COLUMN_LABELS.updated,
      sortField: 'updatedAt',
      defaultWidth: 140,
      minWidth: 120,
      renderFilter: () => (
        <TableDateRangeFilter
          from={params.updatedFrom}
          to={params.updatedTo}
          onChange={({ from, to }) => setListParams({ updatedFrom: from, updatedTo: to })}
        />
      ),
      render: (partial) => <span className="text-text-secondary">{formatDateShort(partial.updatedAt)}</span>,
    },
    actions: {
      id: 'actions',
      label: COLUMN_LABELS.actions,
      rightAligned: true,
      fixedWidth: 96,
      render: renderActions,
    },
  };
  const gridColumns = columns.columnOrder.map((id) => columnDefinitions[id]);
  const filtered = activeFilters.length > 0;

  return (
    <div className="space-y-4">
      <LibraryToolbar
        label="Partial filters"
        searchLabel="Search partials"
        searchPlaceholder="Search Word partials by name or description"
        search={search.draft}
        onSearchChange={search.setDraft}
        onSearchClear={() => search.commitNow('')}
        hiddenColumnCount={columns.hiddenColumnCount}
        onAdjustColumns={() => setColumnsOpen(true)}
      >
        {TEMPLATE_PARTIAL_CATEGORY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={params.category === option.value}
            onClick={() => toggleCategory(option.value)}
            className={quickFilterClass(params.category === option.value)}
          >
            {option.label}
          </button>
        ))}
        <button type="button" aria-pressed={updatedToday} onClick={toggleUpdatedToday} className={quickFilterClass(updatedToday)}>
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
          Updated today
        </button>
      </LibraryToolbar>

      <ServiceColumnModal
        isOpen={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        columns={columns.columnOrder.map((id) => ({ id, label: COLUMN_LABELS[id], locked: LOCKED_COLUMNS.includes(id) }))}
        visibility={columns.columnVisibility}
        onToggle={columns.toggleColumn}
        onMove={columns.moveColumn}
        onShowAll={columns.showAllColumns}
        onResetWidths={columns.resetColumnWidths}
      />

      <ActiveFilterBar filters={activeFilters} onClearAll={clearAllFilters} />

      {error && (
        <div className="card border-status-error bg-status-error/5">
          <div className="flex items-center gap-3 text-status-error">
            <AlertCircle className="w-5 h-5" />
            <p>{error instanceof Error ? error.message : 'Failed to load partials'}</p>
          </div>
        </div>
      )}

      {!error && (
        <DataGrid
          data={partials}
          columns={gridColumns}
          getRowKey={(partial) => partial.id}
          columnVisibility={columns.columnVisibility}
          columnWidths={columns.columnWidths}
          onColumnWidthChange={(id, width) => columns.setColumnWidth(id as ColumnId, width)}
          sortBy={params.sortBy}
          sortOrder={params.sortOrder}
          onSort={handleSort}
          selectable={canDelete}
          selectedKeys={selectedIds}
          onSelectionChange={setSelectedIds}
          onRowActivate={openEdit}
          getRowAriaLabel={(partial) => `Open ${partialLabel(partial)}`}
          getRowName={(partial) => partialLabel(partial)}
          isLoading={isLoading && !data}
          isFetching={isFetching && !isLoading}
          page={data?.page ?? params.page}
          totalPages={data?.totalPages ?? 0}
          total={data?.total ?? 0}
          limit={data?.limit ?? params.limit}
          onPageChange={(page) => {
            setSelectedIds(new Set());
            updateParams({ page });
          }}
          onLimitChange={(limit) => setListParams({ limit })}
          emptyState={(
            <ListEmptyState
              icon={Code}
              noun="Word partials"
              filtered={filtered}
              onClearFilters={clearAllFilters}
              createAction={canCreate
                ? <Button variant="primary" size="sm" leftIcon={<Plus />} onClick={openCreate}>Create your first Word partial</Button>
                : undefined}
            />
          )}
          renderMobileCard={(partial, index) => (
            <MobileCard
              key={partial.id}
              title={partialLabel(partial)}
              subtitle={<PartialSyntax name={partial.name} />}
              badge={<span className="badge badge-neutral">{templatePartialCategoryLabel(partial.category)}</span>}
              selectable={canDelete}
              isSelected={selectedIds.has(partial.id)}
              onToggle={() => {
                const next = new Set(selectedIds);
                if (next.has(partial.id)) next.delete(partial.id);
                else next.add(partial.id);
                setSelectedIds(next);
              }}
              selectionLabel={`${selectedIds.has(partial.id) ? 'Deselect' : 'Select'} ${partialLabel(partial)}`}
              onCardClick={() => openEdit(partial)}
              className={index % 2 === 1 ? 'bg-oak-row-alt' : undefined}
              actions={renderActions(partial)}
              details={(
                <CardDetailsGrid>
                  <CardDetailItem label="Used In" value={`${partial._count?.usedInTemplates || 0} templates`} />
                  <CardDetailItem label="Updated" value={formatDateShort(partial.updatedAt)} />
                </CardDetailsGrid>
              )}
            />
          )}
        />
      )}

      {/* Duplicate Modal */}
      <Modal
        isOpen={isDuplicateOpen}
        onClose={() => setIsDuplicateOpen(false)}
        title="Duplicate Partial"
      >
        <ModalBody>
          <FormInput
            label="New Name"
            value={duplicateName}
            onChange={(e) => setDuplicateName(e.target.value)}
            placeholder="signing-block-copy"
            hint="Enter a unique name for the duplicate"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsDuplicateOpen(false)} disabled={duplicateMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleDuplicate}
            isLoading={duplicateMutation.isPending}
            disabled={!duplicateName}
          >
            Duplicate
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Partial"
        description={`Are you sure you want to delete "${selectedPartial?.name}"? This action cannot be undone.`}
        variant="danger"
        confirmLabel="Delete"
        isLoading={deleteMutation.isPending}
      />

      <ConfirmDialog
        isOpen={isBulkDeleteOpen}
        onClose={() => setIsBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title="Delete Partials"
        description={`Delete ${selectedPartials.length} selected partial${selectedPartials.length === 1 ? '' : 's'}? This action cannot be undone.`}
        variant="danger"
        confirmLabel="Delete"
        isLoading={isBulkDeleting}
      />

      {canDelete && (
        <BulkActionsToolbar
          selectedCount={selectedPartials.length}
          onClearSelection={() => setSelectedIds(new Set())}
          itemLabel="partial"
          actions={[{ id: 'delete', label: 'Delete', icon: Trash2, variant: 'danger', isLoading: isBulkDeleting }]}
          onAction={() => setIsBulkDeleteOpen(true)}
        />
      )}

      {/* Usage Modal */}
      <Modal
        isOpen={isUsageOpen}
        onClose={() => setIsUsageOpen(false)}
        title={`Usage: ${selectedPartial?.name}`}
      >
        <ModalBody>
          {usageLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
            </div>
          ) : usageData?.templates.length === 0 && usageData.serviceVariants.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">
              This partial is not used in any templates or service variants yet.
            </p>
          ) : (
            <div className="space-y-4">
              {usageData?.templates.length ? <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  Used in {usageData.usageCount} template{usageData.usageCount !== 1 ? 's' : ''}:
                </p>
                {usageData.templates.map((template) => (
                <div
                  key={template.templateId}
                  className="flex items-center justify-between p-3 rounded-md bg-background-tertiary"
                >
                  <div>
                    <p className="text-sm font-medium text-text-primary">{template.templateName}</p>
                    <p className="text-xs text-text-muted capitalize">
                      {template.category.toLowerCase().replace('_', ' ')}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-text-muted" />
                </div>
                ))}
              </div> : null}
              {usageData?.serviceVariants.length ? <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  Linked to {usageData.serviceVariantCount} service variant{usageData.serviceVariantCount !== 1 ? 's' : ''}:
                </p>
                {usageData.serviceVariants.map((variant) => (
                  <div
                    key={variant.id}
                    className="flex items-center justify-between p-3 rounded-md bg-background-tertiary"
                  >
                    <p className="text-sm font-medium text-text-primary">{variant.name}</p>
                    <span className={variant.isActive ? 'badge badge-success' : 'badge badge-neutral'}>
                      {variant.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                ))}
              </div> : null}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsUsageOpen(false)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function NewPartialButton() {
  const router = useRouter();
  return (
    <Button
      variant="primary"
      size="sm"
      leftIcon={<Plus />}
      onClick={() => router.push('/template-partials/editor?type=partial&tab=partials')}
    >
      New Word partial
    </Button>
  );
}

export default function PartialTemplatesPage() {
  return (
    <TemplateLibraryShell
      title="Partials"
      description="Manage reusable Word partials used inside document templates."
      actions={(can) => (can.createDocument ? <NewPartialButton /> : null)}
    >
      {({ activeTenantId, can, isSuperAdmin }) => (
        <TemplatePartialsTab
          activeTenantId={activeTenantId}
          canCreate={can.createDocument}
          canUpdate={can.updateDocument}
          canDelete={can.deleteDocument}
          isSuperAdmin={isSuperAdmin}
        />
      )}
    </TemplateLibraryShell>
  );
}
