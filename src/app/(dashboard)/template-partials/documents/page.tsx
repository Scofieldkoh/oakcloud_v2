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
  usePersistSessionListSnapshot,
  useSessionListRestore,
} from '@/hooks/use-session-query-restore';
import {
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Copy,
  FileText,
  AlertCircle,
  Check,
  X,
  Eye,
  CalendarDays,
  CheckCircle,
  CircleOff,
  Gavel,
} from 'lucide-react';
import { cn, formatDateShort } from '@/lib/utils';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LibraryToolbar, TemplateLibraryShell } from '../template-library-shell';

// ============================================================================
// Types
// ============================================================================

interface DocumentTemplate {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
  _count?: {
    generatedDocuments: number;
  };
}

interface TemplateSearchResult {
  templates: DocumentTemplate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function isTemplateSearchResult(value: unknown): value is TemplateSearchResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TemplateSearchResult>;
  return (
    !!candidate.templates &&
    Array.isArray(candidate.templates) &&
    typeof candidate.total === 'number' &&
    typeof candidate.totalPages === 'number'
  );
}

const CATEGORIES = [
  { value: 'RESOLUTION', label: 'Resolution' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'LETTER', label: 'Letter' },
  { value: 'MINUTES', label: 'Minutes' },
  { value: 'NOTICE', label: 'Notice' },
  { value: 'CERTIFICATE', label: 'Certificate' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

type TemplateStatusFilter = 'active' | 'inactive';
type TemplateSortField = 'name' | 'category' | 'isActive' | 'version' | 'usage' | 'createdBy' | 'updatedAt';

function getCategoryLabel(category: string) {
  return CATEGORIES.find((c) => c.value === category)?.label || category;
}

// ============================================================================
// List state (kept in the URL) and columns (kept per user)
// ============================================================================

type UsageFilter = 'used' | 'unused';

const USAGE_OPTIONS: { value: UsageFilter; label: string }[] = [
  { value: 'used', label: 'Any' },
  { value: 'unused', label: 'None' },
];

interface TemplateListParams {
  query: string;
  name: string | undefined;
  description: string | undefined;
  category: string | undefined;
  status: TemplateStatusFilter | undefined;
  version: string | undefined;
  usage: UsageFilter | undefined;
  createdBy: string | undefined;
  updatedFrom: string | undefined;
  updatedTo: string | undefined;
  sortBy: TemplateSortField;
  sortOrder: 'asc' | 'desc';
  page: number;
  limit: number;
}

const TEMPLATE_LIST_PARAMS: UrlParamSpec<TemplateListParams> = {
  query: urlParam.string('', { key: 'q' }),
  name: urlParam.optional(),
  description: urlParam.optional(),
  category: urlParam.optional(),
  status: urlParam.optional<TemplateStatusFilter>(),
  version: urlParam.optional(),
  usage: urlParam.optional<UsageFilter>(),
  createdBy: urlParam.optional(),
  updatedFrom: urlParam.optional(),
  updatedTo: urlParam.optional(),
  sortBy: urlParam.choice<TemplateSortField>('name'),
  sortOrder: urlParam.choice<'asc' | 'desc'>('asc'),
  page: urlParam.int(1),
  limit: urlParam.int(20),
};

const COLUMN_IDS = ['name', 'description', 'category', 'status', 'version', 'usage', 'createdBy', 'updated', 'actions'] as const;
type ColumnId = (typeof COLUMN_IDS)[number];
const COLUMN_LABELS: Record<ColumnId, string> = {
  name: 'Template',
  description: 'Description',
  category: 'Category',
  status: 'Status',
  version: 'Version',
  usage: 'Documents',
  createdBy: 'Created By',
  updated: 'Updated',
  actions: 'Actions',
};
const COLUMN_PREFERENCE_KEY = 'template-library:documents:columns:v1';
const LOCKED_COLUMNS: ColumnId[] = ['name', 'actions'];

// ============================================================================
// Template API Functions
// ============================================================================

async function fetchTemplates(params: TemplateListParams, tenantId?: string): Promise<TemplateSearchResult> {
  const searchParams = new URLSearchParams();
  if (params.query) searchParams.set('query', params.query);
  if (params.name) searchParams.set('name', params.name);
  if (params.category) searchParams.set('category', params.category);
  if (params.status) searchParams.set('isActive', String(params.status === 'active'));
  if (params.description) searchParams.set('description', params.description);
  if (params.version && /^\d+$/.test(params.version)) searchParams.set('version', params.version);
  if (params.usage) searchParams.set('usage', params.usage);
  if (params.createdBy) searchParams.set('createdBy', params.createdBy);
  if (params.updatedFrom) searchParams.set('updatedFrom', params.updatedFrom);
  if (params.updatedTo) searchParams.set('updatedTo', params.updatedTo);
  searchParams.set('editor', 'oakdoc');
  searchParams.set('sortBy', params.sortBy);
  searchParams.set('sortOrder', params.sortOrder);
  searchParams.set('page', params.page.toString());
  searchParams.set('limit', params.limit.toString());
  if (tenantId) searchParams.set('tenantId', tenantId);

  const response = await fetch(`/api/document-templates?${searchParams}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch templates');
  }
  return response.json();
}

async function updateTemplate(
  data: {
    id: string;
    isActive?: boolean;
    expectedRevision?: number;
    tenantId?: string;
    reason?: string;
  }
): Promise<DocumentTemplate> {
  const { id, tenantId, reason, ...updates } = data;
  const response = await fetch(`/api/document-templates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...updates, tenantId, reason }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update template');
  }
  return response.json();
}

async function deleteTemplate(
  id: string,
  reason: string,
  tenantId?: string,
  expectedRevision?: number,
): Promise<void> {
  const searchParams = new URLSearchParams({ reason });
  if (tenantId) searchParams.set('tenantId', tenantId);
  if (expectedRevision !== undefined) searchParams.set('expectedRevision', String(expectedRevision));
  const response = await fetch(`/api/document-templates/${id}?${searchParams}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete template');
  }
}

async function duplicateTemplate(id: string, name: string, tenantId?: string): Promise<DocumentTemplate> {
  const response = await fetch(`/api/document-templates/${id}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, tenantId }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to duplicate template');
  }
  return response.json();
}

/** Runs `action` on each template in turn; returns how many succeeded and the first error. */
async function runForEach(
  templates: DocumentTemplate[],
  action: (template: DocumentTemplate) => Promise<unknown>,
): Promise<{ done: number; firstError?: string }> {
  let done = 0;
  let firstError: string | undefined;
  for (const template of templates) {
    try {
      await action(template);
      done += 1;
    } catch (err) {
      firstError ??= `${template.name}: ${err instanceof Error ? err.message : 'failed'}`;
    }
  }
  return { done, firstError };
}

// ============================================================================
// Document Templates List
// ============================================================================

function DocumentTemplatesTab({
  activeTenantId,
  canCreate,
  canUpdate,
  canDelete,
}: {
  activeTenantId: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { success, error: showError } = useToast();
  const queryClient = useQueryClient();

  // Search, filters, sort and page live in the URL; the column layout is saved per user.
  const { params, setParams, updateParams } = useUrlListParams('/template-partials/documents', TEMPLATE_LIST_PARAMS);
  const search = useDebouncedSearch(params.query, (query) => updateParams({ query }));
  const columns = useTableColumnPreference(COLUMN_PREFERENCE_KEY, COLUMN_IDS, {
    locked: LOCKED_COLUMNS,
    hiddenByDefault: ['createdBy'],
  });
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal states (only for delete and duplicate - create/edit use full page)
  const [deletingTemplate, setDeletingTemplate] = useState<DocumentTemplate | null>(null);
  const [duplicatingTemplate, setDuplicatingTemplate] = useState<DocumentTemplate | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<string | null>(null);

  // Form state for duplicate modal
  const [duplicateName, setDuplicateName] = useState('');

  // Query
  const queryKey = ['document-templates', params, activeTenantId] as const;
  const { initialData, restoredFromSession } = useSessionListRestore<TemplateSearchResult>(
    queryClient,
    queryKey,
    { enabled: !!activeTenantId, validate: isTemplateSearchResult },
  );
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey,
    queryFn: () => fetchTemplates(params, activeTenantId),
    enabled: !!activeTenantId,
    initialData,
    initialDataUpdatedAt: restoredFromSession ? 0 : undefined,
    placeholderData: keepPreviousData,
  });
  usePersistSessionListSnapshot(queryKey, data);

  const invalidateLists = () => {
    queryClient.invalidateQueries({ queryKey: ['document-templates'] });
  };

  // Mutations
  const deleteMutation = useMutation({
    mutationFn: ({ id, reason, revision }: { id: string; reason: string; revision: number }) =>
      deleteTemplate(id, reason, activeTenantId, revision),
    onSuccess: () => {
      invalidateLists();
      success('Template deleted successfully');
      setDeletingTemplate(null);
    },
    onError: (err: Error) => showError(err.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      duplicateTemplate(id, name, activeTenantId),
    onSuccess: () => {
      invalidateLists();
      success('Template duplicated successfully');
      setDuplicatingTemplate(null);
      setDuplicateName('');
    },
    onError: (err: Error) => showError(err.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive, revision }: { id: string; isActive: boolean; revision: number }) =>
      updateTemplate({
        id,
        isActive,
        expectedRevision: revision,
        tenantId: activeTenantId,
        reason: isActive ? 'Activated template' : 'Deactivated template',
      }),
    onSuccess: () => {
      invalidateLists();
      success('Template status updated');
    },
    onError: (err: Error) => showError(err.message),
  });

  // Handlers - Navigate to editor page for create/edit
  const openCreate = () => {
    router.push('/generated-documents/generate?editor=oakdoc');
  };

  const openTemplate = (template: DocumentTemplate) => {
    router.push(`/generated-documents/generate?editor=oakdoc&templateId=${encodeURIComponent(template.id)}`);
  };

  const handleDelete = (reason?: string) => {
    if (!deletingTemplate) return;
    deleteMutation.mutate({
      id: deletingTemplate.id,
      reason: reason || 'Deleted by user',
      revision: deletingTemplate.version,
    });
  };

  const handleDuplicate = () => {
    if (!duplicatingTemplate) return;
    const name = duplicateName.trim() || `Copy of ${duplicatingTemplate.name}`;
    duplicateMutation.mutate({ id: duplicatingTemplate.id, name });
  };

  const openDuplicateDialog = (template: DocumentTemplate) => {
    setDuplicatingTemplate(template);
    setDuplicateName(`Copy of ${template.name}`);
  };

  const templates = useMemo(() => data?.templates ?? [], [data?.templates]);
  const selectedTemplates = templates.filter((template) => selectedIds.has(template.id));

  // Selection is per page: changing the list clears it.
  const setListParams = useCallback((patch: Partial<TemplateListParams>) => {
    setSelectedIds(new Set());
    updateParams(patch);
  }, [updateParams]);

  const toggleStatus = (status: TemplateStatusFilter) => {
    setListParams({ status: params.status === status ? undefined : status });
  };
  const toggleCategory = (category: string) => {
    setListParams({ category: params.category === category ? undefined : category });
  };
  const today = toLocalDateString(new Date());
  const updatedToday = Boolean(today && params.updatedFrom === today && params.updatedTo === today);
  const toggleUpdatedToday = () => {
    setListParams(updatedToday ? { updatedFrom: undefined, updatedTo: undefined } : { updatedFrom: today, updatedTo: today });
  };

  const handleSort = (field: string) => {
    const sortBy = field as TemplateSortField;
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
      description: undefined,
      category: undefined,
      status: undefined,
      version: undefined,
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
  if (params.name) activeFilters.push({ key: 'name', label: 'Template', value: params.name, onRemove: () => setListParams({ name: undefined }) });
  if (params.category) activeFilters.push({ key: 'category', label: 'Category', value: getCategoryLabel(params.category), onRemove: () => setListParams({ category: undefined }) });
  if (params.status) activeFilters.push({ key: 'status', label: 'Status', value: params.status === 'active' ? 'Active' : 'Inactive', onRemove: () => setListParams({ status: undefined }) });
  if (params.description) activeFilters.push({ key: 'description', label: 'Description', value: params.description, onRemove: () => setListParams({ description: undefined }) });
  if (params.version) activeFilters.push({ key: 'version', label: 'Version', value: `v${params.version}`, onRemove: () => setListParams({ version: undefined }) });
  if (params.usage) activeFilters.push({ key: 'usage', label: 'Documents', value: params.usage === 'used' ? 'Any' : 'None', onRemove: () => setListParams({ usage: undefined }) });
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

  const runBulk = async (
    actionId: string,
    action: (template: DocumentTemplate) => Promise<unknown>,
    verb: string,
  ) => {
    setBulkAction(actionId);
    const { done, firstError } = await runForEach(selectedTemplates, action);
    setBulkAction(null);
    invalidateLists();
    setSelectedIds(new Set());
    if (done > 0) success(`${verb} ${done} template${done === 1 ? '' : 's'}`);
    if (firstError) showError(firstError);
  };

  const handleBulkAction = (actionId: string) => {
    if (actionId === 'delete') {
      setBulkDeleteOpen(true);
      return;
    }
    const isActive = actionId === 'activate';
    void runBulk(
      actionId,
      (template) => updateTemplate({
        id: template.id,
        isActive,
        expectedRevision: template.version,
        tenantId: activeTenantId,
        reason: isActive ? 'Activated template' : 'Deactivated template',
      }),
      isActive ? 'Activated' : 'Deactivated',
    );
  };

  const handleBulkDelete = async (reason?: string) => {
    await runBulk(
      'delete',
      (template) => deleteTemplate(template.id, reason || 'Deleted by user', activeTenantId, template.version),
      'Deleted',
    );
    setBulkDeleteOpen(false);
  };

  const renderStatus = (template: DocumentTemplate) => (
    <span className={cn('badge', template.isActive ? 'badge-success' : 'badge-neutral')}>
      {template.isActive ? 'Active' : 'Inactive'}
    </span>
  );

  const renderActions = (template: DocumentTemplate) => (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => openTemplate(template)}
        title="Open in OakDoc"
        aria-label={`Open ${template.name} in OakDoc`}
        className="inline-flex h-8 w-8 items-center justify-center rounded text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
      >
        <Eye className="w-4 h-4" aria-hidden="true" />
      </button>

      {(canCreate || canUpdate || canDelete) && (
        <Dropdown>
          <DropdownTrigger asChild>
            <button
              type="button"
              aria-label={`More actions for ${template.name}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
            >
              <MoreVertical className="w-4 h-4" aria-hidden="true" />
            </button>
          </DropdownTrigger>
          <DropdownMenu align="right">
            {canUpdate && <DropdownItem icon={<Pencil className="w-4 h-4" />} onClick={() => openTemplate(template)}>Edit</DropdownItem>}
            {canCreate && <DropdownItem icon={<Copy className="w-4 h-4" />} onClick={() => openDuplicateDialog(template)}>Duplicate</DropdownItem>}
            {canUpdate && <DropdownItem
              icon={template.isActive ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
              onClick={() => toggleActiveMutation.mutate({
                id: template.id,
                isActive: !template.isActive,
                revision: template.version,
              })}
            >{template.isActive ? 'Deactivate' : 'Activate'}</DropdownItem>}
            {canDelete && <DropdownItem icon={<Trash2 className="w-4 h-4" />} destructive onClick={() => setDeletingTemplate(template)}>Delete</DropdownItem>}
          </DropdownMenu>
        </Dropdown>
      )}
    </div>
  );

  const columnDefinitions: Record<ColumnId, DataGridColumn<DocumentTemplate>> = {
    name: {
      id: 'name',
      label: COLUMN_LABELS.name,
      sortField: 'name',
      defaultWidth: 320,
      minWidth: 160,
      renderFilter: () => (
        <TableTextFilter
          ariaLabel="Filter by template name"
          value={params.name}
          onChange={(name) => setListParams({ name })}
          debounceMs={300}
        />
      ),
      render: (template) => (
        <span className="block truncate font-medium text-text-primary" title={template.name}>
          {template.name}
        </span>
      ),
    },
    description: {
      id: 'description',
      label: COLUMN_LABELS.description,
      defaultWidth: 240,
      minWidth: 140,
      renderFilter: () => (
        <TableTextFilter
          ariaLabel="Filter by description"
          value={params.description}
          onChange={(description) => setListParams({ description })}
          debounceMs={300}
        />
      ),
      render: (template) => template.description
        ? <span className="block truncate text-text-secondary" title={template.description}>{template.description}</span>
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
          options={[{ value: '', label: 'All categories' }, ...CATEGORIES]}
          value={params.category ?? ''}
          onChange={(category) => setListParams({ category: category || undefined })}
          placeholder="All categories"
          ariaLabel="Filter by category"
        />
      ),
      render: (template) => <span className="badge badge-info">{getCategoryLabel(template.category)}</span>,
    },
    status: {
      id: 'status',
      label: COLUMN_LABELS.status,
      sortField: 'isActive',
      defaultWidth: 120,
      minWidth: 100,
      renderFilter: () => (
        <TableSelectFilter
          options={[{ value: '', label: 'All statuses' }, ...STATUS_OPTIONS]}
          value={params.status ?? ''}
          onChange={(status) => setListParams({ status: (status || undefined) as TemplateStatusFilter | undefined })}
          placeholder="All statuses"
          ariaLabel="Filter by status"
        />
      ),
      render: renderStatus,
    },
    version: {
      id: 'version',
      label: COLUMN_LABELS.version,
      sortField: 'version',
      rightAligned: true,
      defaultWidth: 90,
      minWidth: 80,
      renderFilter: () => (
        <TableTextFilter
          type="number"
          ariaLabel="Filter by version"
          value={params.version}
          onChange={(version) => setListParams({ version })}
          debounceMs={300}
        />
      ),
      render: (template) => <span className="text-text-secondary">v{template.version}</span>,
    },
    usage: {
      id: 'usage',
      label: COLUMN_LABELS.usage,
      sortField: 'usage',
      rightAligned: true,
      defaultWidth: 110,
      minWidth: 90,
      renderFilter: () => (
        <TableSelectFilter
          options={[{ value: '', label: 'All' }, ...USAGE_OPTIONS]}
          value={params.usage ?? ''}
          onChange={(usage) => setListParams({ usage: (usage || undefined) as UsageFilter | undefined })}
          placeholder="All"
          ariaLabel="Filter by documents"
        />
      ),
      render: (template) => <span className="text-text-secondary">{template._count?.generatedDocuments ?? 0}</span>,
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
      render: (template) => template.createdBy
        ? <span className="text-text-secondary">{template.createdBy.firstName} {template.createdBy.lastName}</span>
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
      render: (template) => <span className="text-text-secondary">{formatDateShort(template.updatedAt)}</span>,
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
  const selectable = canUpdate || canDelete;
  const filtered = activeFilters.length > 0;

  return (
    <div className="space-y-4">
      <LibraryToolbar
        label="Template filters"
        searchLabel="Search templates"
        searchPlaceholder="Search Word templates by name or description"
        search={search.draft}
        onSearchChange={search.setDraft}
        onSearchClear={() => search.commitNow('')}
        hiddenColumnCount={columns.hiddenColumnCount}
        onAdjustColumns={() => setColumnsOpen(true)}
      >
        <button type="button" aria-pressed={params.status === 'active'} onClick={() => toggleStatus('active')} className={quickFilterClass(params.status === 'active')}>
          <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Active
        </button>
        <button type="button" aria-pressed={params.status === 'inactive'} onClick={() => toggleStatus('inactive')} className={quickFilterClass(params.status === 'inactive')}>
          <CircleOff className="h-3.5 w-3.5" aria-hidden="true" />
          Inactive
        </button>
        <button type="button" aria-pressed={params.category === 'RESOLUTION'} onClick={() => toggleCategory('RESOLUTION')} className={quickFilterClass(params.category === 'RESOLUTION')}>
          <Gavel className="h-3.5 w-3.5" aria-hidden="true" />
          Resolutions
        </button>
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
            <p>{error instanceof Error ? error.message : 'Failed to load templates'}</p>
          </div>
        </div>
      )}

      {!error && (
        <DataGrid
          data={templates}
          columns={gridColumns}
          getRowKey={(template) => template.id}
          columnVisibility={columns.columnVisibility}
          columnWidths={columns.columnWidths}
          onColumnWidthChange={(id, width) => columns.setColumnWidth(id as ColumnId, width)}
          sortBy={params.sortBy}
          sortOrder={params.sortOrder}
          onSort={handleSort}
          selectable={selectable}
          selectedKeys={selectedIds}
          onSelectionChange={setSelectedIds}
          onRowActivate={openTemplate}
          getRowAriaLabel={(template) => `Open ${template.name}`}
          getRowName={(template) => template.name}
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
              icon={FileText}
              noun="Word templates"
              filtered={filtered}
              onClearFilters={clearAllFilters}
              createAction={canCreate
                ? <Button variant="primary" size="sm" leftIcon={<Plus />} onClick={openCreate}>Create your first Word template</Button>
                : undefined}
            />
          )}
          renderMobileCard={(template, index) => (
            <MobileCard
              key={template.id}
              title={template.name}
              subtitle={template.description || undefined}
              badge={renderStatus(template)}
              selectable={selectable}
              isSelected={selectedIds.has(template.id)}
              onToggle={() => {
                const next = new Set(selectedIds);
                if (next.has(template.id)) next.delete(template.id);
                else next.add(template.id);
                setSelectedIds(next);
              }}
              selectionLabel={`${selectedIds.has(template.id) ? 'Deselect' : 'Select'} ${template.name}`}
              onCardClick={() => openTemplate(template)}
              className={index % 2 === 1 ? 'bg-oak-row-alt' : undefined}
              actions={renderActions(template)}
              details={(
                <CardDetailsGrid>
                  <CardDetailItem label="Category" value={getCategoryLabel(template.category)} />
                  <CardDetailItem label="Version" value={`v${template.version}`} />
                  <CardDetailItem label="Documents" value={template._count?.generatedDocuments ?? 0} />
                  <CardDetailItem label="Updated" value={formatDateShort(template.updatedAt)} />
                </CardDetailsGrid>
              )}
            />
          )}
        />
      )}

      {/* Duplicate Modal */}
      <Modal
        isOpen={!!duplicatingTemplate}
        onClose={() => {
          setDuplicatingTemplate(null);
          setDuplicateName('');
        }}
        title="Duplicate Template"
        size="sm"
      >
        <ModalBody>
          <p className="text-sm text-text-secondary mb-4">
            Create a copy of &quot;{duplicatingTemplate?.name}&quot;
          </p>
          <FormInput
            label="New Template Name"
            value={duplicateName}
            onChange={(e) => setDuplicateName(e.target.value)}
            placeholder="Enter name for the copy"
          />
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setDuplicatingTemplate(null);
              setDuplicateName('');
            }}
            disabled={duplicateMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleDuplicate}
            isLoading={duplicateMutation.isPending}
          >
            Duplicate
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingTemplate}
        onClose={() => setDeletingTemplate(null)}
        onConfirm={handleDelete}
        title="Delete Template"
        description={`Are you sure you want to delete "${deletingTemplate?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        requireReason
        reasonMinLength={10}
        isLoading={deleteMutation.isPending}
      />

      <ConfirmDialog
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title="Delete Templates"
        description={`Delete ${selectedTemplates.length} selected template${selectedTemplates.length === 1 ? '' : 's'}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        requireReason
        reasonMinLength={10}
        isLoading={bulkAction === 'delete'}
      />

      {selectable && (
        <BulkActionsToolbar
          selectedCount={selectedTemplates.length}
          onClearSelection={() => setSelectedIds(new Set())}
          itemLabel="template"
          actions={[
            ...(canUpdate ? [
              { id: 'activate', label: 'Activate', icon: Check, isLoading: bulkAction === 'activate' },
              { id: 'deactivate', label: 'Deactivate', icon: X, isLoading: bulkAction === 'deactivate' },
            ] : []),
            ...(canDelete ? [{ id: 'delete', label: 'Delete', icon: Trash2, variant: 'danger' as const }] : []),
          ]}
          onAction={handleBulkAction}
        />
      )}
    </div>
  );
}

function NewTemplateButton() {
  const router = useRouter();
  return (
    <Button
      variant="primary"
      size="sm"
      leftIcon={<Plus />}
      onClick={() => router.push('/generated-documents/generate?editor=oakdoc')}
    >
      New Word Template
    </Button>
  );
}

export default function DocumentTemplatesPage() {
  return (
    <TemplateLibraryShell
      title="Document Templates"
      description="Manage the Word templates used to generate documents."
      actions={(can) => (can.createDocument ? <NewTemplateButton /> : null)}
    >
      {({ activeTenantId, can }) => (
        <DocumentTemplatesTab
          activeTenantId={activeTenantId}
          canCreate={can.createDocument}
          canUpdate={can.updateDocument}
          canDelete={can.deleteDocument}
        />
      )}
    </TemplateLibraryShell>
  );
}
