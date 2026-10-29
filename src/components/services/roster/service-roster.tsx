'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Briefcase, Search, X } from 'lucide-react';
import { Pagination } from '@/components/ui/pagination';
import { Alert } from '@/components/ui/alert';
import { ListEmptyState } from '@/components/ui/empty-state';
import { useClientService } from '@/hooks/use-client-services';
import { useServicesWorkspaceSettings } from '@/hooks/use-services-workspace-settings';
import { useServiceRoster, type ServiceRosterSearchInput } from '@/hooks/use-service-roster';
import { useServiceRosterFamilies } from '@/hooks/use-service-roster-families';
import { useUpsertUserPreference, useUserPreference } from '@/hooks/use-user-preferences';
import type { ServiceRosterItem } from '@/services/service-roster';
import { FamilyFilterChips, type ServiceFamilyFilter } from '@/components/services/shared/family-filter-chips';
import { ServiceColumnModal } from '@/components/services/shared/service-column-modal';
import { ServiceFilterToolbar, quickFilterClass } from '@/components/services/shared/service-filter-toolbar';
import { AddClientServiceDialog } from './add-client-service-dialog';
import {
  SERVICE_ROSTER_COLUMNS,
  columnLabels,
  ServiceRosterTable,
  type ServiceRosterColumnId,
  type ServiceRosterColumnWidths,
  type ServiceRosterInlineFilters,
  type ServiceRosterSortBy,
} from './service-roster-table';
import { ClientServiceEditor } from '@/components/companies/company-detail/client-service-editor';
import { ManualCycleDialog } from '@/components/services/deadlines/manual-cycle-dialog';
import { ServiceBulkActionsToolbar, type ServiceBulkNotice } from './service-bulk-actions-toolbar';
import { SEARCH_DEBOUNCE_MS } from '@/hooks/use-debounced-search';
import { ActiveFilterBar, type ActiveFilter } from '@/components/ui/active-filter-bar';

const TABLE_PREFERENCE_KEY = 'services.roster.table.v1';
const STATUS_VALUES = ['ACTIVE', 'PAUSED', 'ENDED'] as const;
type ServiceStatus = (typeof STATUS_VALUES)[number];
const SERVICE_ROSTER_PAGE_SIZES = [10, 20, 50, 100] as const;
const SORT_VALUES: ServiceRosterSortBy[] = ['company', 'family', 'service', 'status', 'nextDeadline', 'startDate'];

export interface ServiceRosterPreference {
  version: 1;
  columnWidths: ServiceRosterColumnWidths;
  columnOrder: ServiceRosterColumnId[];
  columnVisibility: Record<ServiceRosterColumnId, boolean>;
  sortBy: ServiceRosterSortBy;
  sortOrder: 'asc' | 'desc';
  pageSize: number;
}

const defaultColumnVisibility = Object.fromEntries(
  SERVICE_ROSTER_COLUMNS.map((column) => [column, true]),
) as Record<ServiceRosterColumnId, boolean>;

export const defaultServiceRosterPreference: ServiceRosterPreference = {
  version: 1,
  columnWidths: {},
  columnOrder: [...SERVICE_ROSTER_COLUMNS],
  columnVisibility: defaultColumnVisibility,
  sortBy: 'company',
  sortOrder: 'asc',
  pageSize: 20,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseServiceRosterPreference(value: unknown): ServiceRosterPreference {
  if (!isRecord(value) || value.version !== 1) return defaultServiceRosterPreference;

  const rawOrder = Array.isArray(value.columnOrder) ? value.columnOrder : [];
  const columnOrder = [
    ...rawOrder.filter((column): column is ServiceRosterColumnId => typeof column === 'string' && SERVICE_ROSTER_COLUMNS.includes(column as ServiceRosterColumnId)),
    ...SERVICE_ROSTER_COLUMNS,
  ].filter((column, index, all) => all.indexOf(column) === index);
  const columnWidths: ServiceRosterColumnWidths = {};
  if (isRecord(value.columnWidths)) {
    for (const column of SERVICE_ROSTER_COLUMNS) {
      const width = value.columnWidths[column];
      if (typeof width === 'number' && Number.isFinite(width)) {
        columnWidths[column] = Math.min(800, Math.max(96, Math.round(width)));
      }
    }
  }
  const columnVisibility = { ...defaultColumnVisibility };
  if (isRecord(value.columnVisibility)) {
    for (const column of SERVICE_ROSTER_COLUMNS) {
      if (typeof value.columnVisibility[column] === 'boolean') {
        columnVisibility[column] = value.columnVisibility[column] as boolean;
      }
    }
  }
  columnVisibility.actions = true;
  const pageSize = SERVICE_ROSTER_PAGE_SIZES.includes(value.pageSize as (typeof SERVICE_ROSTER_PAGE_SIZES)[number])
    ? value.pageSize as number
    : defaultServiceRosterPreference.pageSize;
  const sortBy = typeof value.sortBy === 'string' && SORT_VALUES.includes(value.sortBy as ServiceRosterSortBy)
    ? value.sortBy as ServiceRosterSortBy
    : defaultServiceRosterPreference.sortBy;
  const sortOrder = value.sortOrder === 'desc' ? 'desc' : 'asc';

  return { version: 1, columnWidths, columnOrder, columnVisibility, sortBy, sortOrder, pageSize };
}

interface ServiceRosterProps {
  workspaceId?: string;
  canEdit?: boolean;
  families?: ServiceFamilyFilter[];
  addServiceDialogOpen?: boolean;
  onAddServiceDialogOpenChange?: (open: boolean) => void;
}

function readStatuses(value: string | null): ServiceStatus[] {
  if (value === null) return [];
  return value.split(',').filter((status): status is ServiceStatus => STATUS_VALUES.includes(status as ServiceStatus));
}

function readPage(value: string | null): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function readLimit(value: string | null): number {
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
}

function readSortBy(value: string | null): ServiceRosterSortBy {
  return value && SORT_VALUES.includes(value as ServiceRosterSortBy) ? value as ServiceRosterSortBy : 'company';
}

function readQuery(value: string | null): string {
  return value?.trim() ?? '';
}

function readIds(value: string | null): string[] {
  return [...new Set((value ?? '').split(',').map((part) => part.trim()).filter(Boolean))];
}

function ServiceEditorLauncher({ item, onClose, readOnly = false }: { item: ServiceRosterItem; onClose: () => void; readOnly?: boolean }) {
  const service = useClientService(item.id);
  if (!service.data) {
    return service.isLoading ? <p role="status" className="sr-only">Loading service editor…</p> : null;
  }
  return <ClientServiceEditor service={service.data} isOpen onClose={onClose} readOnly={readOnly} />;
}

function ManualCycleLauncher({ item, canApply, onClose, onApplied }: { item: ServiceRosterItem; canApply: boolean; onClose: () => void; onApplied: () => void }) {
  return <ManualCycleDialog clientServiceId={item.id} isOpen canApply={canApply} onClose={onClose} onApplied={onApplied} />;
}

export function ServiceRoster({ workspaceId, canEdit = true, families: providedFamilies, addServiceDialogOpen, onAddServiceDialogOpenChange }: ServiceRosterProps) {
  const workspaceSettings = useServicesWorkspaceSettings();
  const canTrigger = canEdit
    && workspaceSettings.data?.workspaceEnabled === true
    && workspaceSettings.data?.deadlineWritesEnabled === true;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalSearchKey = searchParams.toString();
  const preference = useUserPreference<ServiceRosterPreference>(TABLE_PREFERENCE_KEY);
  const savePreference = useUpsertUserPreference<ServiceRosterPreference>();
  const parsedPreference = useMemo(
    () => parseServiceRosterPreference(preference.data?.value),
    [preference.data?.value],
  );
  const preferenceReady = useRef(false);
  const resizeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPreferencePatch = useRef<Partial<ServiceRosterPreference>>({});
  const [columnWidths, setColumnWidths] = useState<ServiceRosterColumnWidths>({});
  const [columnOrder, setColumnOrder] = useState<ServiceRosterColumnId[]>(defaultServiceRosterPreference.columnOrder);
  const [columnVisibility, setColumnVisibility] = useState<Record<ServiceRosterColumnId, boolean>>(defaultServiceRosterPreference.columnVisibility);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [optimisticSearchKey, setOptimisticSearchKey] = useState<string | null>(null);
  const effectiveSearchKey = optimisticSearchKey ?? canonicalSearchKey;
  useEffect(() => {
    setOptimisticSearchKey(null);
  }, [canonicalSearchKey]);
  const urlState = useMemo(() => {
    const params = new URLSearchParams(effectiveSearchKey);
    return {
      query: readQuery(params.get('query')),
      companyQuery: readQuery(params.get('companyQuery')),
      familyQuery: readQuery(params.get('familyQuery')),
      serviceQuery: readQuery(params.get('serviceQuery')),
      statusQuery: readQuery(params.get('statusQuery')),
      cadenceQuery: readQuery(params.get('cadenceQuery')),
      nextDeadlineQuery: readQuery(params.get('nextDeadlineQuery')),
      startEndQuery: readQuery(params.get('startEndQuery')),
      warningQuery: readQuery(params.get('warningQuery')),
      billingQuery: readQuery(params.get('billingQuery')),
      statuses: readStatuses(params.get('statuses')),
      familyIds: readIds(params.get('familyIds')),
      archived: params.get('archived') === 'true',
      page: readPage(params.get('page')),
      limit: readLimit(params.get('limit') ?? (preference.data?.value ? String(parsedPreference.pageSize) : null)),
      sortBy: readSortBy(params.get('sortBy') ?? (preference.data?.value ? parsedPreference.sortBy : null)),
      sortOrder: params.has('sortOrder')
        ? params.get('sortOrder') === 'desc' ? 'desc' as const : 'asc' as const
        : preference.data?.value ? parsedPreference.sortOrder : 'asc' as const,
    };
  }, [effectiveSearchKey, parsedPreference, preference.data?.value]);
  const {
    query,
    companyQuery,
    familyQuery,
    serviceQuery,
    statusQuery,
    cadenceQuery,
    nextDeadlineQuery,
    startEndQuery,
    warningQuery,
    billingQuery,
    statuses,
    familyIds,
    archived,
    page,
    limit,
    sortBy,
    sortOrder,
  } = urlState;
  const inlineFilters: ServiceRosterInlineFilters = {
    company: companyQuery || undefined,
    family: familyQuery || undefined,
    service: serviceQuery || undefined,
    status: statusQuery || undefined,
    cadence: cadenceQuery || undefined,
    nextDeadline: nextDeadlineQuery || undefined,
    startEnd: startEndQuery || undefined,
    warnings: warningQuery || undefined,
    billing: billingQuery || undefined,
  };
  const [uncontrolledAddOpen, setUncontrolledAddOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceRosterItem | null>(null);
  const [viewing, setViewing] = useState<ServiceRosterItem | null>(null);
  const [triggering, setTriggering] = useState<ServiceRosterItem | null>(null);
  const [queryDraft, setQueryDraft] = useState(query);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedServices, setSelectedServices] = useState<Record<string, ServiceRosterItem>>({});
  const [bulkNotice, setBulkNotice] = useState<ServiceBulkNotice | null>(null);
  const addOpen = addServiceDialogOpen ?? uncontrolledAddOpen;
  const setAddOpen = useCallback((open: boolean) => {
    if (onAddServiceDialogOpenChange) onAddServiceDialogOpenChange(open);
    else setUncontrolledAddOpen(open);
  }, [onAddServiceDialogOpenChange]);

  const rosterSearch: ServiceRosterSearchInput = {
    query: query.trim() || undefined,
    companyQuery: companyQuery || undefined,
    familyQuery: familyQuery || undefined,
    serviceQuery: serviceQuery || undefined,
    statusQuery: statusQuery || undefined,
    cadenceQuery: cadenceQuery || undefined,
    nextDeadlineQuery: nextDeadlineQuery || undefined,
    startEndQuery: startEndQuery || undefined,
    warningQuery: warningQuery || undefined,
    billingQuery: billingQuery || undefined,
    statuses,
    familyIds,
    archived,
    page,
    limit,
    sortBy,
    sortOrder,
  };
  const roster = useServiceRoster(rosterSearch);
  const familyFacets = useServiceRosterFamilies();
  useEffect(() => {
    if (preference.isLoading || preferenceReady.current) return;
    const restored = parseServiceRosterPreference(preference.data?.value);
    setColumnWidths(restored.columnWidths);
    setColumnOrder(restored.columnOrder);
    setColumnVisibility(restored.columnVisibility);
    preferenceReady.current = true;
  }, [preference.data?.value, preference.isLoading]);

  const items = useMemo(() => roster.data?.items ?? [], [roster.data?.items]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectionState = useMemo((): 'none' | 'partial' | 'all' => {
    const selectedVisibleCount = items.reduce((count, item) => count + (selectedIdSet.has(item.id) ? 1 : 0), 0);
    if (items.length > 0 && selectedVisibleCount === items.length) return 'all';
    return selectedVisibleCount > 0 ? 'partial' : 'none';
  }, [items, selectedIdSet]);
  const selectedItems = useMemo(
    () => selectedIds.map((id) => selectedServices[id]).filter((item): item is ServiceRosterItem => Boolean(item)),
    [selectedIds, selectedServices],
  );
  const families = useMemo(
    () => providedFamilies ?? familyFacets.data ?? [],
    [familyFacets.data, providedFamilies],
  );
  const selectionScopeKey = useMemo(() => JSON.stringify({
    workspaceId,
    canEdit,
    query,
    companyQuery,
    familyQuery,
    serviceQuery,
    statusQuery,
    cadenceQuery,
    nextDeadlineQuery,
    startEndQuery,
    warningQuery,
    billingQuery,
    statuses,
    familyIds,
    archived,
  }), [
    archived,
    billingQuery,
    canEdit,
    cadenceQuery,
    companyQuery,
    familyIds,
    familyQuery,
    nextDeadlineQuery,
    query,
    serviceQuery,
    startEndQuery,
    statusQuery,
    statuses,
    warningQuery,
    workspaceId,
  ]);
  const previousSelectionScopeKey = useRef(selectionScopeKey);

  useEffect(() => {
    if (previousSelectionScopeKey.current === selectionScopeKey) return;
    previousSelectionScopeKey.current = selectionScopeKey;
    setSelectedIds([]);
    setSelectedServices({});
    setBulkNotice(null);
  }, [selectionScopeKey]);

  useEffect(() => {
    if (items.length === 0) return;
    setSelectedServices((current) => {
      let next = current;
      for (const item of items) {
        if (!selectedIdSet.has(item.id) || current[item.id] === item) continue;
        if (next === current) next = { ...current };
        next[item.id] = item;
      }
      return next;
    });
  }, [items, selectedIdSet]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectedServices({});
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (items.length === 0) return;
    const visibleIds = new Set(items.map((item) => item.id));
    const allSelected = items.every((item) => selectedIdSet.has(item.id));
    setSelectedIds((current) => allSelected
      ? current.filter((id) => !visibleIds.has(id))
      : [...new Set([...current, ...items.map((item) => item.id)])]);
    setSelectedServices((current) => {
      const next = { ...current };
      if (allSelected) {
        for (const id of visibleIds) delete next[id];
      } else {
        for (const item of items) next[item.id] = item;
      }
      return next;
    });
  }, [items, selectedIdSet]);

  const toggleSelect = useCallback((item: ServiceRosterItem) => {
    const selected = selectedIdSet.has(item.id);
    setSelectedIds((current) => selected ? current.filter((id) => id !== item.id) : [...current, item.id]);
    setSelectedServices((current) => {
      if (selected) {
        const next = { ...current };
        delete next[item.id];
        return next;
      }
      return { ...current, [item.id]: item };
    });
  }, [selectedIdSet]);

  const replaceUrl = useCallback((next: Partial<Record<string, string | undefined>>) => {
    const params = new URLSearchParams(effectiveSearchKey);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    setOptimisticSearchKey(params.toString());
    router.replace(nextUrl, { scroll: false });
  }, [effectiveSearchKey, pathname, router]);

  useEffect(() => {
    if (!preference.data?.value) return;
    const next: Partial<Record<string, string>> = {};
    if (!new URLSearchParams(canonicalSearchKey).has('limit')) next.limit = String(parsedPreference.pageSize);
    if (!new URLSearchParams(canonicalSearchKey).has('sortBy')) next.sortBy = parsedPreference.sortBy;
    if (!new URLSearchParams(canonicalSearchKey).has('sortOrder')) next.sortOrder = parsedPreference.sortOrder;
    if (Object.keys(next).length > 0) replaceUrl(next);
  }, [canonicalSearchKey, parsedPreference, preference.data?.value, replaceUrl]);

  const currentPreference = useMemo((): ServiceRosterPreference => ({
    version: 1,
    columnWidths,
    columnOrder,
    columnVisibility,
    sortBy,
    sortOrder,
    pageSize: limit,
  }), [columnOrder, columnVisibility, columnWidths, limit, sortBy, sortOrder]);
  const currentPreferenceRef = useRef<ServiceRosterPreference>(currentPreference);
  currentPreferenceRef.current = currentPreference;

  const persistPreference = useCallback((overrides: Partial<ServiceRosterPreference> = {}, debounce = false) => {
    if (!preferenceReady.current) return;
    if (debounce) {
      pendingPreferencePatch.current = { ...pendingPreferencePatch.current, ...overrides };
      if (resizeSaveTimer.current) clearTimeout(resizeSaveTimer.current);
      resizeSaveTimer.current = setTimeout(() => {
        const value = {
          ...currentPreferenceRef.current,
          ...pendingPreferencePatch.current,
        };
        pendingPreferencePatch.current = {};
        savePreference.mutate({ key: TABLE_PREFERENCE_KEY, value });
        resizeSaveTimer.current = null;
      }, 250);
      return;
    }
    if (resizeSaveTimer.current) {
      clearTimeout(resizeSaveTimer.current);
      resizeSaveTimer.current = null;
    }
    const value = {
      ...currentPreferenceRef.current,
      ...pendingPreferencePatch.current,
      ...overrides,
    };
    pendingPreferencePatch.current = {};
    currentPreferenceRef.current = value;
    savePreference.mutate({ key: TABLE_PREFERENCE_KEY, value });
  }, [savePreference]);

  useEffect(() => () => {
    if (resizeSaveTimer.current) clearTimeout(resizeSaveTimer.current);
    resizeSaveTimer.current = null;
    pendingPreferencePatch.current = {};
  }, []);

  const toggleStatus = (status: ServiceStatus) => {
    const nextStatuses = statuses.includes(status) ? statuses.filter((value) => value !== status) : [...statuses, status];
    replaceUrl({ statuses: nextStatuses.length > 0 ? nextStatuses.join(',') : undefined, page: '1' });
  };

  const toggleFamily = (familyId: string) => {
    const nextFamilyIds = familyIds.includes(familyId) ? familyIds.filter((id) => id !== familyId) : [...familyIds, familyId];
    replaceUrl({ familyIds: nextFamilyIds.length > 0 ? nextFamilyIds.join(',') : undefined, page: '1' });
  };

  const updateQuery = useCallback((value: string) => {
    replaceUrl({ query: value.trim() || undefined, page: '1' });
  }, [replaceUrl]);

  useEffect(() => {
    setQueryDraft(query);
  }, [query]);

  useEffect(() => {
    if (queryDraft.trim() === query) return undefined;
    const timer = window.setTimeout(() => updateQuery(queryDraft), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, queryDraft, updateQuery]);

  const updateInlineFilter = (next: Partial<ServiceRosterInlineFilters>) => {
    replaceUrl({
      companyQuery: next.company === undefined ? companyQuery || undefined : next.company.trim() || undefined,
      familyQuery: next.family === undefined ? familyQuery || undefined : next.family.trim() || undefined,
      serviceQuery: next.service === undefined ? serviceQuery || undefined : next.service.trim() || undefined,
      statusQuery: next.status === undefined ? statusQuery || undefined : next.status.trim() || undefined,
      cadenceQuery: next.cadence === undefined ? cadenceQuery || undefined : next.cadence.trim() || undefined,
      nextDeadlineQuery: next.nextDeadline === undefined ? nextDeadlineQuery || undefined : next.nextDeadline.trim() || undefined,
      startEndQuery: next.startEnd === undefined ? startEndQuery || undefined : next.startEnd.trim() || undefined,
      warningQuery: next.warnings === undefined ? warningQuery || undefined : next.warnings.trim() || undefined,
      billingQuery: next.billing === undefined ? billingQuery || undefined : next.billing.trim() || undefined,
      page: '1',
    });
  };

  const updateSort = (nextSortBy: ServiceRosterSortBy) => {
    const nextOrder = sortBy === nextSortBy && sortOrder === 'asc' ? 'desc' : 'asc';
    replaceUrl({ sortBy: nextSortBy, sortOrder: nextOrder });
    persistPreference({ sortBy: nextSortBy, sortOrder: nextOrder });
  };

  const updateColumns = (columnId: ServiceRosterColumnId, width: number) => {
    setColumnWidths((current) => ({ ...current, [columnId]: Math.round(width) }));
  };

  const finishColumnResize = (columnId: ServiceRosterColumnId, width: number) => {
    const nextWidths = { ...columnWidths, [columnId]: Math.round(width) };
    setColumnWidths(nextWidths);
    persistPreference({ columnWidths: nextWidths }, true);
  };

  const toggleColumnVisibility = (columnId: ServiceRosterColumnId) => {
    if (columnId === 'actions') return;
    const nextVisibility = { ...columnVisibility, [columnId]: !columnVisibility[columnId] };
    setColumnVisibility(nextVisibility);
    persistPreference({ columnVisibility: nextVisibility });
  };

  const moveColumn = (columnId: ServiceRosterColumnId, direction: -1 | 1) => {
    const index = columnOrder.indexOf(columnId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= columnOrder.length) return;
    const nextOrder = [...columnOrder];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex]!, nextOrder[index]!];
    setColumnOrder(nextOrder);
    persistPreference({ columnOrder: nextOrder });
  };

  const filterBadges: ActiveFilter[] = [];
  if (statuses.length > 0) filterBadges.push({ key: 'status', label: 'Status', value: statuses.map((status) => status.charAt(0) + status.slice(1).toLowerCase()).join(', '), onRemove: () => replaceUrl({ statuses: undefined, page: '1' }) });
  for (const family of families.filter((item) => familyIds.includes(item.id))) filterBadges.push({ key: `family-${family.id}`, label: 'Family', value: family.name, onRemove: () => toggleFamily(family.id) });
  if (archived) filterBadges.push({ key: 'archived', label: 'Archive', value: 'Included', onRemove: () => replaceUrl({ archived: undefined, page: '1' }) });
  if (query.trim()) filterBadges.push({ key: 'query', label: 'Search', value: query.trim(), onRemove: () => updateQuery('') });
  const inlineFilterBadges: Array<[keyof ServiceRosterInlineFilters, string]> = [
    ['company', 'Company'],
    ['family', 'Family'],
    ['service', 'Service'],
    ['status', 'Status'],
    ['cadence', 'Cadence'],
    ['nextDeadline', 'Next deadline'],
    ['startEnd', 'Start/end'],
    ['warnings', 'Warnings'],
    ['billing', 'Billing'],
  ];
  for (const [key, label] of inlineFilterBadges) {
    const value = inlineFilters[key];
    if (value) filterBadges.push({ key: `inline-${key}`, label, value, onRemove: () => updateInlineFilter({ [key]: '' }) });
  }
  const clearAllFilters = () => {
    setQueryDraft('');
    replaceUrl({
      statuses: undefined,
      familyIds: undefined,
      archived: undefined,
      query: undefined,
      companyQuery: undefined,
      familyQuery: undefined,
      serviceQuery: undefined,
      statusQuery: undefined,
      cadenceQuery: undefined,
      nextDeadlineQuery: undefined,
      startEndQuery: undefined,
      warningQuery: undefined,
      billingQuery: undefined,
      page: '1',
    });
  };
  const hiddenColumnCount = SERVICE_ROSTER_COLUMNS.filter((column) => column !== 'actions' && !columnVisibility[column]).length;
  const total = roster.data?.total ?? 0;
  const totalPages = roster.data?.totalPages ?? 0;

  return (
    <section aria-label="Services" className="space-y-4">
      <ServiceFilterToolbar label="Service filters" onAdjustColumns={() => setColumnsOpen(true)} hiddenColumnCount={hiddenColumnCount}>
        <label className="relative flex min-h-11 min-w-[220px] flex-1 items-center rounded-lg border border-border-primary bg-background-primary focus-within:border-oak-primary focus-within:ring-2 focus-within:ring-oak-primary/20 sm:min-h-8">
          <Search className="ml-3 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          <span className="sr-only">Search services</span>
          <input type="text" role="searchbox" aria-label="Search services" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="Search companies or services" className="h-11 min-w-0 flex-1 bg-transparent px-2 text-sm text-text-primary outline-none placeholder:text-text-muted sm:h-8" />
          {queryDraft ? <button type="button" aria-label="Clear search" onClick={() => { setQueryDraft(''); if (query) updateQuery(''); }} className="mr-2 flex min-h-11 min-w-11 items-center justify-center rounded text-text-muted hover:bg-background-tertiary sm:min-h-8 sm:min-w-8"><X className="h-4 w-4" aria-hidden="true" /></button> : null}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_VALUES.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={statuses.includes(status)}
              onClick={() => toggleStatus(status)}
              className={quickFilterClass(statuses.includes(status))}
            >
              {status.charAt(0) + status.slice(1).toLowerCase()}
            </button>
          ))}
          <FamilyFilterChips families={families} selectedIds={familyIds} onToggle={toggleFamily} />
          <button
            type="button"
            aria-pressed={archived}
            onClick={() => replaceUrl({ archived: archived ? undefined : 'true', page: '1' })}
            className={quickFilterClass(archived)}
          >
            Archived
          </button>
        </div>
      </ServiceFilterToolbar>
      {!providedFamilies && familyFacets.error ? (
        <Alert variant="error" title="Family filters unavailable" compact>
          <div className="flex flex-wrap items-center gap-2">
            <span>{familyFacets.error instanceof Error ? familyFacets.error.message : 'Unable to load family filters.'}</span>
            <button
              type="button"
              aria-label="Retry family filters"
              onClick={() => familyFacets.refetch()}
              className="min-h-11 rounded-md border border-current px-3 text-sm font-medium hover:bg-black/10 dark:hover:bg-white/10 sm:min-h-8"
            >
              Retry
            </button>
          </div>
        </Alert>
      ) : null}

      <ServiceColumnModal
        isOpen={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        columns={columnOrder.map((id) => ({ id, label: columnLabels[id], locked: id === 'actions' }))}
        visibility={columnVisibility}
        onToggle={toggleColumnVisibility}
        onMove={moveColumn}
        onShowAll={() => {
          const next = { ...defaultColumnVisibility };
          setColumnVisibility(next);
          persistPreference({ columnVisibility: next });
        }}
        onResetWidths={() => {
          setColumnWidths({});
          persistPreference({ columnWidths: {} });
        }}
      />

      <ActiveFilterBar filters={filterBadges} onClearAll={clearAllFilters} />

      {bulkNotice ? (
        <Alert variant={bulkNotice.variant} title={bulkNotice.title} onClose={() => setBulkNotice(null)}>
          {bulkNotice.details}
        </Alert>
      ) : null}

      {roster.error ? <Alert variant="error">Unable to load services. {roster.error instanceof Error ? roster.error.message : ''}</Alert> : null}
      {roster.isLoading && !roster.data ? <div role="status" className="rounded-xl border border-border-primary bg-background-secondary p-8 text-center text-sm text-text-secondary">Loading services…</div> : null}
      {roster.data && !roster.error ? (
        <ServiceRosterTable
          items={items}
          emptyState={(
            <ListEmptyState
              icon={Briefcase}
              noun="services"
              filtered={filterBadges.length > 0}
              onClearFilters={clearAllFilters}
              emptyDescription="Services appear here when they are added on a company's Services tab or activated from a service agreement."
            />
          )}
          canEdit={canEdit}
          canSelect={canEdit}
          selectedIds={selectedIdSet}
          selectionState={selectionState}
          onToggleSelectAll={toggleSelectAll}
          onToggleSelect={toggleSelect}
          isFetching={roster.isFetching}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={updateSort}
          inlineFilters={inlineFilters}
          onInlineFilterChange={updateInlineFilter}
          columnWidths={columnWidths}
          columnOrder={columnOrder}
          columnVisibility={columnVisibility}
          onColumnWidthChange={updateColumns}
          onColumnResizeEnd={finishColumnResize}
          onEdit={setEditing}
          onOpen={setViewing}
          onTrigger={canTrigger ? setTriggering : undefined}
        />
      ) : null}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        pageSizeOptions={SERVICE_ROSTER_PAGE_SIZES}
        onPageChange={(nextPage) => replaceUrl({ page: String(nextPage) })}
        onLimitChange={(nextLimit) => {
          const safeLimit = SERVICE_ROSTER_PAGE_SIZES.includes(nextLimit as (typeof SERVICE_ROSTER_PAGE_SIZES)[number])
            ? nextLimit
            : defaultServiceRosterPreference.pageSize;
          replaceUrl({ limit: String(safeLimit), page: '1' });
          persistPreference({ pageSize: safeLimit });
        }}
      />

      {selectedItems.length > 0 ? (
        <ServiceBulkActionsToolbar
          selectedServices={selectedItems}
          onSelectionChange={(nextItems) => {
            setSelectedIds(nextItems.map((item) => item.id));
            setSelectedServices(Object.fromEntries(nextItems.map((item) => [item.id, item])));
          }}
          onRefresh={roster.refetch}
          onNotice={setBulkNotice}
          onClearSelection={clearSelection}
        />
      ) : null}

      <AddClientServiceDialog isOpen={addOpen} onClose={() => setAddOpen(false)} onCreated={() => roster.refetch?.()} />
      {editing ? <ServiceEditorLauncher item={editing} onClose={() => { setEditing(null); roster.refetch?.(); }} /> : null}
      {viewing ? <ServiceEditorLauncher item={viewing} onClose={() => setViewing(null)} readOnly /> : null}
      {canTrigger && triggering ? <ManualCycleLauncher item={triggering} canApply={canTrigger} onClose={() => setTriggering(null)} onApplied={() => { setTriggering(null); roster.refetch?.(); }} /> : null}
    </section>
  );
}
