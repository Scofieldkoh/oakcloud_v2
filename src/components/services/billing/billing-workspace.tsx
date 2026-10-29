'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle, Receipt } from 'lucide-react';
import { Pagination } from '@/components/ui/pagination';
import { Alert } from '@/components/ui/alert';
import { ListEmptyState } from '@/components/ui/empty-state';
import { BulkActionsToolbar } from '@/components/ui/bulk-actions-toolbar';
import { useBillingOccurrences, useMarkBillingOccurrencesAsBilled, useResetBillingOverride, useUpdateBillingOccurrence } from '@/hooks/use-billing-occurrences';
import { useServiceRosterFamilies } from '@/hooks/use-service-roster-families';
import { useUpsertUserPreference, useUserPreference } from '@/hooks/use-user-preferences';
import type { BillingOccurrenceDto } from '@/services/billing';
import { addCalendarDays, currentDateInSingapore, type DateOnly } from '@/services/service-schedule';
import {
  BILLING_COLUMN_IDS,
  BILLING_TABLE_PREFERENCE_KEY,
  defaultBillingTablePreference,
  parseBillingTablePreference,
  type BillingColumnId,
  type BillingTablePreference,
} from '@/lib/validations/services-preferences';
import { ServiceColumnModal } from '@/components/services/shared/service-column-modal';
import { BillingCoveragePanel } from './billing-coverage-panel';
import { BillingFilters, type BillingFilterState } from './billing-filters';
import { BillingOccurrenceDialog } from './billing-occurrence-dialog';
import { BillingTable, billingColumnLabels, type BillingInlineFilters } from './billing-table';

interface BillingWorkspaceProps {
  workspaceId?: string;
  canEdit?: boolean;
}

function isDateRangeValid(from: string, to: string): boolean {
  return Boolean(from && to && from <= to);
}

const BILLING_STATUSES = ['OPEN', 'BILLED', 'WAIVED', 'CANCELLED'] as const;
const BILLING_TIMINGS = ['UPCOMING', 'DUE', 'OVERDUE'] as const;
const BILLING_SORT_FIELDS = ['expectedDate', 'company', 'family', 'service', 'status', 'amount'] as const;

function readQuery(value: string | null): string {
  return value?.trim() ?? '';
}

function readDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function readPage(value: string | null): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function readList<T extends string>(value: string | null, allowed: readonly T[], fallback: T[] = []): T[] {
  if (value === null) return fallback;
  return value.split(',').filter((item, index, values): item is T => allowed.includes(item as T) && values.indexOf(item) === index);
}

export interface BillingUrlState {
  filters: BillingFilterState;
  dateRangeActive: boolean;
  dateRangeEnabled: boolean;
  inlineFilters: BillingInlineFilters;
  page: number;
  sortBy: BillingTablePreference['sortBy'];
  sortOrder: BillingTablePreference['sortOrder'];
}

export function parseBillingUrlState(searchKey: string, preference: BillingTablePreference = defaultBillingTablePreference, today: DateOnly = currentDateInSingapore()): BillingUrlState {
  const params = new URLSearchParams(searchKey);
  const defaultTo = addCalendarDays(today, 30);
  const dateRangeDisabled = params.get('dateRange') === 'none';
  const from = readDate(params.get('from'));
  const to = readDate(params.get('to'));
  const resolvedFrom = dateRangeDisabled ? '' : from ?? today;
  const resolvedTo = dateRangeDisabled ? '' : to ?? defaultTo;
  const sortCandidate = params.get('sortBy');
  const sortBy = BILLING_SORT_FIELDS.includes(sortCandidate as BillingTablePreference['sortBy'])
    ? sortCandidate as BillingTablePreference['sortBy']
    : preference.sortBy;
  return {
    filters: {
      query: readQuery(params.get('query')),
      statuses: readList(params.get('statuses'), BILLING_STATUSES),
      timing: readList(params.get('timing'), BILLING_TIMINGS),
      from: resolvedFrom,
      to: resolvedTo,
      familyIds: params.get('familyIds')?.split(',').map((value) => value.trim()).filter(Boolean) ?? [],
    },
    dateRangeActive: !dateRangeDisabled && isDateRangeValid(resolvedFrom, resolvedTo),
    dateRangeEnabled: !dateRangeDisabled,
    inlineFilters: {
      expectedDate: readDate(params.get('expectedDate')) || undefined,
      billedDate: readDate(params.get('billedDate')) || undefined,
      timing: readList(params.get('timingFilter'), BILLING_TIMINGS)[0],
      status: readList(params.get('statusFilter'), BILLING_STATUSES)[0],
      companyId: readQuery(params.get('companyId')) || undefined,
      familyId: readQuery(params.get('familyId')) || undefined,
      service: readQuery(params.get('serviceNameQuery')) || readQuery(params.get('serviceQuery')) || undefined,
      feeLine: readQuery(params.get('feeLineQuery')) || readQuery(params.get('feeQuery')) || undefined,
      period: readQuery(params.get('periodQuery')) || undefined,
      amountMin: readQuery(params.get('amountMin')) || undefined,
      amountMax: readQuery(params.get('amountMax')) || undefined,
      reference: readQuery(params.get('referenceQuery')) || undefined,
    },
    page: readPage(params.get('page')),
    sortBy,
    sortOrder: params.get('sortOrder') === 'desc' ? 'desc' : params.has('sortOrder') ? 'asc' : preference.sortOrder,
  };
}

export function BillingWorkspace({ workspaceId: _workspaceId, canEdit = true }: BillingWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalSearchKey = searchParams.toString();
  const [optimisticSearchKey, setOptimisticSearchKey] = useState<string | null>(null);
  const [selectedOccurrence, setSelectedOccurrence] = useState<BillingOccurrenceDto | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [tablePreference, setTablePreference] = useState<BillingTablePreference>(defaultBillingTablePreference);
  const effectiveSearchKey = optimisticSearchKey ?? canonicalSearchKey;

  const familiesQuery = useServiceRosterFamilies();
  const preferenceQuery = useUserPreference<unknown>(BILLING_TABLE_PREFERENCE_KEY);
  const preferenceMutation = useUpsertUserPreference<BillingTablePreference>();
  const occurrenceMutation = useUpdateBillingOccurrence();
  const bulkBilledMutation = useMarkBillingOccurrencesAsBilled();
  const resetMutation = useResetBillingOverride();

  useEffect(() => {
    setOptimisticSearchKey(null);
  }, [canonicalSearchKey]);

  useEffect(() => {
    if (preferenceQuery.data?.value !== undefined) {
      setTablePreference(parseBillingTablePreference(preferenceQuery.data.value));
    }
  }, [preferenceQuery.data?.value]);

  const urlState = useMemo(() => parseBillingUrlState(effectiveSearchKey, tablePreference), [effectiveSearchKey, tablePreference]);
  const { filters, inlineFilters, page } = urlState;
  const legacySearchFilters = useMemo(() => {
    const params = new URLSearchParams(effectiveSearchKey);
    return {
      companyQuery: readQuery(params.get('companyQuery')) || undefined,
      serviceQuery: params.has('serviceQuery') && !params.has('serviceNameQuery') ? readQuery(params.get('serviceQuery')) || undefined : undefined,
      feeQuery: params.has('feeQuery') && !params.has('feeLineQuery') ? readQuery(params.get('feeQuery')) || undefined : undefined,
    };
  }, [effectiveSearchKey]);

  const replaceUrl = useCallback((next: Partial<Record<string, string | undefined>>) => {
    const params = new URLSearchParams(effectiveSearchKey);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key);
      else params.set(key, value);
    }
    const nextKey = params.toString();
    setOptimisticSearchKey(nextKey);
    router.replace(nextKey ? `${pathname}?${nextKey}` : pathname, { scroll: false });
  }, [effectiveSearchKey, pathname, router]);

  const search = useMemo(() => ({
    ...(urlState.dateRangeEnabled ? { from: filters.from as DateOnly, to: filters.to as DateOnly } : {}),
    query: filters.query.trim() || undefined,
    ...legacySearchFilters,
    companyId: inlineFilters.companyId,
    serviceNameQuery: inlineFilters.service,
    feeLineQuery: inlineFilters.feeLine,
    periodQuery: inlineFilters.period,
    referenceQuery: inlineFilters.reference,
    expectedDate: inlineFilters.expectedDate as DateOnly | undefined,
    billedDate: inlineFilters.billedDate as DateOnly | undefined,
    amountMin: inlineFilters.amountMin,
    amountMax: inlineFilters.amountMax,
    statuses: inlineFilters.status ? [inlineFilters.status] : filters.statuses,
    timing: inlineFilters.timing ? [inlineFilters.timing] : filters.timing,
    familyId: inlineFilters.familyId,
    familyIds: inlineFilters.familyId ? [] : filters.familyIds,
    page,
    limit: tablePreference.pageSize,
    sortBy: urlState.sortBy,
    sortOrder: urlState.sortOrder,
  }), [urlState.dateRangeEnabled, filters.from, filters.to, filters.query, legacySearchFilters, inlineFilters.companyId, inlineFilters.service, inlineFilters.feeLine, inlineFilters.period, inlineFilters.reference, inlineFilters.expectedDate, inlineFilters.billedDate, inlineFilters.amountMin, inlineFilters.amountMax, inlineFilters.status, inlineFilters.timing, inlineFilters.familyId, filters.statuses, filters.timing, filters.familyIds, page, tablePreference.pageSize, urlState.sortBy, urlState.sortOrder]);
  const safeSearch = useMemo(() => {
    if (!urlState.dateRangeEnabled) return search;
    if (isDateRangeValid(filters.from, filters.to)) return search;
    const fallback = (filters.from || currentDateInSingapore()) as DateOnly;
    return { ...search, from: fallback, to: fallback };
  }, [urlState.dateRangeEnabled, filters.from, filters.to, search]);
  const occurrenceQuery = useBillingOccurrences(safeSearch);
  const items = useMemo(() => occurrenceQuery.data?.items ?? [], [occurrenceQuery.data?.items]);
  const families = familiesQuery.data ?? [];
  const selectableItems = useMemo(() => items.filter((item) => item.status === 'OPEN'), [items]);
  const isAllSelected = selectableItems.length > 0 && selectableItems.every((item) => selectedIds.has(item.id));
  const isIndeterminate = selectedIds.size > 0 && !isAllSelected;

  useEffect(() => {
    const available = new Set(selectableItems.map((item) => item.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [selectableItems]);

  const savePreference = useCallback((next: BillingTablePreference) => {
    setTablePreference(next);
    preferenceMutation.mutate({ key: BILLING_TABLE_PREFERENCE_KEY, value: next });
  }, [preferenceMutation]);

  const updatePreference = useCallback((change: Partial<BillingTablePreference>) => {
    savePreference({ ...tablePreference, ...change });
  }, [savePreference, tablePreference]);

  const handleFilterChange = (next: BillingFilterState) => {
    const change: Partial<Record<string, string | undefined>> = {
      query: next.query.trim() || undefined,
      statuses: next.statuses.length > 0 ? next.statuses.join(',') : undefined,
      timing: next.timing.length > 0 ? next.timing.join(',') : undefined,
      familyIds: next.familyIds.length > 0 ? next.familyIds.join(',') : undefined,
      page: '1',
    };
    if (next.from !== filters.from || next.to !== filters.to) {
      if (next.from && next.to) {
        change.from = next.from;
        change.to = next.to;
        change.dateRange = undefined;
      } else {
        change.from = undefined;
        change.to = undefined;
        change.dateRange = 'none';
      }
    }
    replaceUrl(change);
  };

  const handleSort = (sortBy: NonNullable<Parameters<NonNullable<React.ComponentProps<typeof BillingTable>['onSort']>>[0]>) => {
    const sortOrder = urlState.sortBy === sortBy && urlState.sortOrder === 'asc' ? 'desc' : 'asc';
    replaceUrl({ sortBy, sortOrder });
    updatePreference({ sortBy, sortOrder });
  };

  const handleColumnWidthChange = (columnId: BillingColumnId, width: number) => {
    setTablePreference((current) => ({ ...current, columnWidths: { ...current.columnWidths, [columnId]: width } }));
  };

  const handleColumnResizeEnd = (columnId: BillingColumnId, width: number) => {
    savePreference({ ...tablePreference, columnWidths: { ...tablePreference.columnWidths, [columnId]: width } });
  };

  const toggleColumn = (columnId: BillingColumnId) => {
    updatePreference({ columnVisibility: { ...tablePreference.columnVisibility, [columnId]: !tablePreference.columnVisibility[columnId] } });
  };

  const moveColumn = (columnId: BillingColumnId, direction: -1 | 1) => {
    const currentIndex = tablePreference.columnOrder.indexOf(columnId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= tablePreference.columnOrder.length) return;
    const nextOrder = [...tablePreference.columnOrder];
    [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
    updatePreference({ columnOrder: nextOrder });
  };

  const handleInlineFilterChange = (change: Partial<BillingInlineFilters>) => {
    replaceUrl({
      expectedDate: change.expectedDate === undefined ? inlineFilters.expectedDate : change.expectedDate || undefined,
      billedDate: change.billedDate === undefined ? inlineFilters.billedDate : change.billedDate || undefined,
      timingFilter: change.timing === undefined ? inlineFilters.timing : change.timing || undefined,
      statusFilter: change.status === undefined ? inlineFilters.status : change.status || undefined,
      companyId: change.companyId === undefined ? inlineFilters.companyId : change.companyId || undefined,
      familyId: change.familyId === undefined ? inlineFilters.familyId : change.familyId || undefined,
      serviceNameQuery: change.service === undefined ? inlineFilters.service : change.service.trim() || undefined,
      feeLineQuery: change.feeLine === undefined ? inlineFilters.feeLine : change.feeLine.trim() || undefined,
      periodQuery: change.period === undefined ? inlineFilters.period : change.period.trim() || undefined,
      amountMin: change.amountMin === undefined ? inlineFilters.amountMin : change.amountMin.trim() || undefined,
      amountMax: change.amountMax === undefined ? inlineFilters.amountMax : change.amountMax.trim() || undefined,
      referenceQuery: change.reference === undefined ? inlineFilters.reference : change.reference.trim() || undefined,
      page: '1',
    });
  };

  const hasActiveFilters = Boolean(
    filters.query.trim()
    || filters.statuses.length > 0
    || filters.timing.length > 0
    || filters.familyIds.length > 0
    || (urlState.dateRangeActive && filters.from && filters.to)
    || Object.values(inlineFilters).some(Boolean)
    || Object.values(legacySearchFilters).some(Boolean),
  );

  const clearAllFilters = () => {
    replaceUrl({
      query: undefined,
      statuses: undefined,
      timing: undefined,
      familyIds: undefined,
      expectedDate: undefined,
      billedDate: undefined,
      timingFilter: undefined,
      statusFilter: undefined,
      companyId: undefined,
      familyId: undefined,
      serviceNameQuery: undefined,
      feeLineQuery: undefined,
      periodQuery: undefined,
      amountMin: undefined,
      amountMax: undefined,
      referenceQuery: undefined,
      companyQuery: undefined,
      serviceQuery: undefined,
      feeQuery: undefined,
      ...(urlState.dateRangeActive ? { from: undefined, to: undefined, dateRange: 'none' } : {}),
      page: '1',
    });
  };

  const toggleBillingSelection = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (selectableItems.some((item) => item.id === id)) next.add(id);
      return next;
    });
  };

  const toggleAllBillingSelection = () => {
    setSelectedIds((current) => {
      if (isAllSelected) return new Set([...current].filter((id) => !selectableItems.some((item) => item.id === id)));
      return new Set([...current, ...selectableItems.map((item) => item.id)]);
    });
  };

  const markSelectedAsBilled = async () => {
    const selected = selectableItems.filter((item) => selectedIds.has(item.id));
    if (selected.length === 0) return;
    await bulkBilledMutation.mutateAsync(selected);
    setSelectedIds(new Set());
  };

  const clearMutationState = () => {
    occurrenceMutation.reset?.();
    resetMutation.reset?.();
  };

  const openOccurrence = (occurrence: BillingOccurrenceDto) => {
    clearMutationState();
    setSelectedOccurrence(occurrence);
  };

  const closeOccurrence = () => {
    setSelectedOccurrence(null);
    clearMutationState();
  };

  const applyOccurrenceUpdate = (id: string, input: Parameters<NonNullable<React.ComponentProps<typeof BillingOccurrenceDialog>['onSave']>>[0]) => {
    occurrenceMutation.mutate({ id, data: input }, { onSuccess: closeOccurrence });
  };

  const resetOccurrenceOverrides = (id: string, input: Parameters<NonNullable<React.ComponentProps<typeof BillingOccurrenceDialog>['onReset']>>[0]) => {
    resetMutation.mutate({ id, data: input }, { onSuccess: closeOccurrence });
  };

  return (
    <section aria-label="Billing workspace" className="min-w-0 max-w-full space-y-4">
      <BillingCoveragePanel />

      <div className="min-w-0 max-w-full space-y-4">
        <BillingFilters
          value={filters}
          families={families}
          onChange={handleFilterChange}
          dateRangeActive={urlState.dateRangeActive}
          onAdjustColumns={() => setColumnsOpen(true)}
          hiddenColumnCount={BILLING_COLUMN_IDS.filter((column) => column !== 'actions' && tablePreference.columnVisibility[column] === false).length}
        />

        <ServiceColumnModal
          isOpen={columnsOpen}
          onClose={() => setColumnsOpen(false)}
          columns={tablePreference.columnOrder.map((id) => ({ id, label: billingColumnLabels[id], locked: id === 'actions' }))}
          visibility={tablePreference.columnVisibility as Record<BillingColumnId, boolean>}
          onToggle={toggleColumn}
          onMove={moveColumn}
          onShowAll={() => updatePreference({ columnVisibility: { ...defaultBillingTablePreference.columnVisibility } })}
          onResetWidths={() => updatePreference({ columnWidths: {} })}
        />

        {occurrenceQuery.error ? <Alert variant="error">Unable to load billing tracking rows.</Alert> : null}
        {bulkBilledMutation.error ? <Alert variant="error">Unable to mark the selected billing occurrences as billed. Your selection is still available to retry.</Alert> : null}
        {occurrenceQuery.isLoading && !occurrenceQuery.data ? (
          <div role="status" className="rounded-xl border border-border-primary bg-background-secondary p-8 text-center text-sm text-text-secondary">Loading billing occurrences…</div>
        ) : (
          <BillingTable
            items={items}
            families={families}
            isFetching={occurrenceQuery.isFetching}
            canEdit={canEdit}
            selectedIds={selectedIds}
            isAllSelected={isAllSelected}
            isIndeterminate={isIndeterminate}
            columnWidths={tablePreference.columnWidths}
            columnOrder={tablePreference.columnOrder}
            columnVisibility={tablePreference.columnVisibility as Record<BillingColumnId, boolean>}
            sortBy={urlState.sortBy}
            sortOrder={urlState.sortOrder}
            inlineFilters={inlineFilters}
            onInlineFilterChange={handleInlineFilterChange}
            onSort={handleSort}
            onColumnWidthChange={handleColumnWidthChange}
            onColumnResizeEnd={handleColumnResizeEnd}
            onToggleOne={toggleBillingSelection}
            onToggleAll={toggleAllBillingSelection}
            onEdit={openOccurrence}
            emptyState={(
              <ListEmptyState
                icon={Receipt}
                noun="billing occurrences"
                filtered={hasActiveFilters}
                onClearFilters={clearAllFilters}
                emptyDescription="Billing occurrences appear here when a client service has fee lines."
              />
            )}
          />
        )}
        {occurrenceQuery.data ? <Pagination page={occurrenceQuery.data.page} totalPages={occurrenceQuery.data.totalPages} total={occurrenceQuery.data.total} limit={occurrenceQuery.data.limit} onPageChange={(nextPage) => replaceUrl({ page: String(nextPage) })} onLimitChange={(limit) => { updatePreference({ pageSize: limit as BillingTablePreference['pageSize'] }); replaceUrl({ page: '1' }); }} pageSizeOptions={[10, 20, 50, 100]} /> : null}
      </div>

      <BulkActionsToolbar
        selectedCount={selectedIds.size}
        onClearSelection={() => setSelectedIds(new Set())}
        actions={[{
          id: 'mark-as-billed',
          label: 'Mark as billed',
          icon: CheckCircle,
          description: 'Change the selected open billing occurrences to Billed',
          isLoading: bulkBilledMutation.isPending,
        }]}
        onAction={(actionId) => {
          if (actionId === 'mark-as-billed') void markSelectedAsBilled();
        }}
        itemLabel="billing occurrence"
      />

      <BillingOccurrenceDialog occurrence={selectedOccurrence} isOpen={Boolean(selectedOccurrence)} onClose={closeOccurrence} isSaving={occurrenceMutation.isPending} isResetting={resetMutation.isPending} errorMessage={occurrenceMutation.error?.message ?? resetMutation.error?.message ?? null} onSave={(input) => selectedOccurrence && applyOccurrenceUpdate(selectedOccurrence.id, input)} onReset={(input) => selectedOccurrence && resetOccurrenceOverrides(selectedOccurrence.id, input)} />
    </section>
  );
}
