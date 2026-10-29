'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/hooks/use-auth';
import {
  isAcraSyncing,
  buildAcraRecordsSearchParams,
  useAcraRecords,
  useTriggerAcraSync,
  type AcraRecord,
} from '@/hooks/use-acra-records';
import { Alert } from '@/components/ui/alert';
import { Pagination } from '@/components/ui/pagination';
import { FilterChip } from '@/components/ui/filter-chip';
import { MobileCard, CardDetailsGrid, CardDetailItem } from '@/components/ui/responsive-table';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { DatePicker, type DatePickerValue } from '@/components/ui/date-picker';
import { useUserPreferences, useUpsertUserPreference } from '@/hooks/use-user-preferences';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Database,
  Download,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const COLUMN_PREF_KEY = 'acra:list:columns:v1';
const COLUMN_VISIBILITY_PREF_KEY = 'acra:list:column-visibility:v1';
const FILTER_DEBOUNCE_MS = 300;

const COLUMN_IDS = [
  'uen',
  'entityName',
  'companyTypeDescription',
  'entityStatus',
  'entityType',
  'registrationIncorporateDate',
  'address',
  'accountDueDate',
  'annualReturnDate',
  'primarySsicCode',
  'primarySsicDescription',
  'secondarySsicCode',
  'secondarySsicDescription',
  'noOfOfficers',
  'formerEntityName1',
  'uenOfAuditFirm1',
  'block',
  'streetName',
  'levelNo',
  'unitNo',
  'buildingName',
  'postalCode',
  'dataAsOf',
  'createdAt',
  'updatedAt',
] as const;
type ColumnId = (typeof COLUMN_IDS)[number];

const COLUMN_LABELS: Record<ColumnId, string> = {
  uen: 'UEN',
  entityName: 'Entity Name',
  companyTypeDescription: 'Company Type',
  entityStatus: 'Status',
  entityType: 'Type',
  registrationIncorporateDate: 'Incorp. Date',
  address: 'Address',
  accountDueDate: 'Account Due Date',
  annualReturnDate: 'Annual Return Date',
  primarySsicCode: 'Primary SSIC',
  primarySsicDescription: 'Primary SSIC Description',
  secondarySsicCode: 'Secondary SSIC',
  secondarySsicDescription: 'Secondary SSIC Description',
  noOfOfficers: 'No. of Officers',
  formerEntityName1: 'Former Entity Name 1',
  uenOfAuditFirm1: 'UEN of Audit Firm 1',
  block: 'Block',
  streetName: 'Street',
  levelNo: 'Level',
  unitNo: 'Unit',
  buildingName: 'Building',
  postalCode: 'Postal Code',
  dataAsOf: 'Data As Of',
  createdAt: 'Created',
  updatedAt: 'Updated',
};

const COLUMN_SORT_FIELDS: Record<ColumnId, string> = {
  uen: 'uen',
  entityName: 'entityName',
  companyTypeDescription: 'companyTypeDescription',
  entityStatus: 'entityStatus',
  entityType: 'entityType',
  registrationIncorporateDate: 'registrationIncorporateDate',
  address: 'address',
  accountDueDate: 'accountDueDate',
  annualReturnDate: 'annualReturnDate',
  primarySsicCode: 'primarySsicCode',
  primarySsicDescription: 'primarySsicDescription',
  secondarySsicCode: 'secondarySsicCode',
  secondarySsicDescription: 'secondarySsicDescription',
  noOfOfficers: 'noOfOfficers',
  formerEntityName1: 'formerEntityName1',
  uenOfAuditFirm1: 'uenOfAuditFirm1',
  block: 'block',
  streetName: 'streetName',
  levelNo: 'levelNo',
  unitNo: 'unitNo',
  buildingName: 'buildingName',
  postalCode: 'postalCode',
  dataAsOf: 'dataAsOf',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

const ENTITY_TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'Local Company', label: 'Local Company' },
  { value: 'Foreign Company', label: 'Foreign Company' },
];

/** Columns with a date range inline filter. */
const DATE_FILTER_COLUMNS: ColumnId[] = [
  'registrationIncorporateDate',
  'accountDueDate',
  'annualReturnDate',
  'dataAsOf',
  'createdAt',
  'updatedAt',
];

/** Columns with a free-text inline filter (everything except type and dates). */
const TEXT_FILTER_COLUMNS: ColumnId[] = COLUMN_IDS.filter(
  (id) => id !== 'entityType' && !DATE_FILTER_COLUMNS.includes(id)
);

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Convert a Date to a local YYYY-MM-DD string (browser timezone). */
function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function statusBadgeClass(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'live company') {
    return 'text-status-success bg-status-success/10';
  }
  if (normalized.startsWith('in liquidation')) {
    return 'text-status-warning bg-status-warning/10';
  }
  return 'text-text-muted bg-background-tertiary';
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium max-w-full',
        statusBadgeClass(status)
      )}
      title={status}
    >
      <span className="truncate">{status}</span>
    </span>
  );
}

function TypeBadge({ entityType }: { entityType: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium max-w-full text-text-secondary bg-background-tertiary"
      title={entityType}
    >
      <span className="truncate">{entityType}</span>
    </span>
  );
}

function InlineFilterInput({
  value,
  onChange,
  placeholder = 'All',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="w-full flex items-center gap-2 h-9 rounded-lg border bg-background-secondary/30 border-border-primary hover:border-oak-primary/50 focus-within:ring-2 focus-within:ring-oak-primary/30 transition-colors">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none px-3 min-w-0 text-xs text-text-primary placeholder:text-text-secondary"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="p-0.5 hover:bg-background-tertiary rounded transition-colors mr-1"
          aria-label="Clear filter"
        >
          <X className="w-3.5 h-3.5 text-text-muted" />
        </button>
      )}
    </div>
  );
}

export default function AcraDataPage() {
  const { data: session } = useSession();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Inline text filters are debounced so typing does not fire a query per keystroke
  const [textFilters, setTextFilters] = useState<Record<string, string>>({});
  const [debouncedTextFilters, setDebouncedTextFilters] = useState<Record<string, string>>({});
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [dateFilters, setDateFilters] = useState<Record<string, { from?: string; to?: string }>>({});

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [sortBy, setSortBy] = useState('entityName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [expandedRecordIds, setExpandedRecordIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Debounce the toolbar search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [search]);

  // Debounce the inline text filters
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedTextFilters(textFilters);
      setPage(1);
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [textFilters]);

  // Column widths + visibility persisted per user
  const [columnWidths, setColumnWidths] = useState<Partial<Record<ColumnId, number>>>({});
  const [columnVisibility, setColumnVisibility] = useState<Partial<Record<ColumnId, boolean>>>({});
  const isResizingRef = useRef(false);

  const { data: preferenceMap } = useUserPreferences([
    COLUMN_PREF_KEY,
    COLUMN_VISIBILITY_PREF_KEY,
  ]);
  const saveColumnPref = useUpsertUserPreference<Record<string, number | boolean>>();

  useEffect(() => {
    const value = preferenceMap?.[COLUMN_PREF_KEY]?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    setColumnWidths(value as Partial<Record<ColumnId, number>>);
  }, [preferenceMap]);

  useEffect(() => {
    const value = preferenceMap?.[COLUMN_VISIBILITY_PREF_KEY]?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    setColumnVisibility(value as Partial<Record<ColumnId, boolean>>);
  }, [preferenceMap]);

  const isColumnVisible = useCallback(
    (columnId: ColumnId) => columnVisibility[columnId] !== false,
    [columnVisibility]
  );
  const visibleColumnIds = useMemo(
    () => COLUMN_IDS.filter((id) => isColumnVisible(id)),
    [isColumnVisible]
  );
  const hiddenColumnCount = useMemo(
    () => COLUMN_IDS.filter((id) => !isColumnVisible(id)).length,
    [isColumnVisible]
  );

  const { data, isLoading, isFetching, error, refetch } = useAcraRecords({
    page,
    limit,
    sortBy,
    sortOrder,
    search: debouncedSearch || undefined,
    filters: {
      ...debouncedTextFilters,
      ...(entityTypeFilter ? { entityType: entityTypeFilter } : {}),
    },
    dateRanges: dateFilters,
  });

  const triggerSync = useTriggerAcraSync();
  const isSyncing = isAcraSyncing(data?.syncState);

  useKeyboardShortcuts([
    {
      key: 'r',
      ctrl: true,
      handler: () => {
        refetch();
      },
      description: 'Refresh list',
    },
  ]);

  const toggleRecordExpanded = useCallback((id: string) => {
    setExpandedRecordIds((prev) =>
      prev.includes(id) ? prev.filter((existingId) => existingId !== id) : [...prev, id]
    );
  }, []);

  const handleSort = useCallback((field: string) => {
    setSortBy((prevSortBy) => {
      if (prevSortBy === field) {
        setSortOrder((prevOrder) => (prevOrder === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortOrder('asc');
      }
      return field;
    });
    setPage(1);
  }, []);

  const handleDateRangeChange = useCallback(
    (columnId: string, value: DatePickerValue | undefined) => {
      setDateFilters((prev) => {
        const next = { ...prev };

        const range: { from?: string; to?: string } = {};
        if (value?.mode === 'range' && value.range) {
          if (value.range.from) range.from = toLocalDateString(value.range.from);
          if (value.range.to) range.to = toLocalDateString(value.range.to);
        }

        if (range.from || range.to) {
          next[columnId] = range;
        } else {
          delete next[columnId];
        }

        return next;
      });
      setPage(1);
    },
    []
  );

  const clearAllFilters = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
    setTextFilters({});
    setDebouncedTextFilters({});
    setEntityTypeFilter('');
    setDateFilters({});
    setPage(1);
  }, []);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setExportError(null);

    try {
      const searchParams = buildAcraRecordsSearchParams({
        search: debouncedSearch || undefined,
        filters: {
          ...debouncedTextFilters,
          ...(entityTypeFilter ? { entityType: entityTypeFilter } : {}),
        },
        dateRanges: dateFilters,
      });
      const response = await fetch(`/api/admin/acra-records/export?${searchParams}`);

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || 'Failed to export ACRA records');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `acra-records-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to export ACRA records');
    } finally {
      setIsExporting(false);
    }
  }, [dateFilters, debouncedSearch, debouncedTextFilters, entityTypeFilter]);

  const startResize = useCallback(
    (e: React.PointerEvent, columnId: ColumnId) => {
      e.preventDefault();
      e.stopPropagation();

      const handle = e.currentTarget as HTMLElement | null;
      const th = handle?.closest('th') as HTMLTableCellElement | null;
      const startWidth = columnWidths[columnId] ?? th?.getBoundingClientRect().width ?? 120;
      const startX = e.clientX;
      const pointerId = e.pointerId;

      isResizingRef.current = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      let latestWidth = startWidth;

      try {
        handle?.setPointerCapture(pointerId);
      } catch {
        // ignore
      }

      const onMove = (ev: globalThis.PointerEvent) => {
        const nextWidth = Math.max(30, startWidth + (ev.clientX - startX));
        latestWidth = nextWidth;
        setColumnWidths((prev) => ({ ...prev, [columnId]: nextWidth }));
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        try {
          handle?.releasePointerCapture(pointerId);
        } catch {
          // ignore
        }
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        isResizingRef.current = false;

        const nextWidths = { ...columnWidths, [columnId]: latestWidth };
        setColumnWidths(nextWidths);
        saveColumnPref.mutate({ key: COLUMN_PREF_KEY, value: nextWidths });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [columnWidths, saveColumnPref]
  );

  const startResizeIfEdge = useCallback(
    (e: React.PointerEvent, columnId: ColumnId) => {
      const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect();
      if (rect && rect.right - e.clientX > 14) return;
      startResize(e, columnId);
    },
    [startResize]
  );

  const resetColumns = useCallback(() => {
    setColumnWidths({});
    saveColumnPref.mutate({ key: COLUMN_PREF_KEY, value: {} });
  }, [saveColumnPref]);

  const showAllColumns = useCallback(() => {
    setColumnVisibility({});
    saveColumnPref.mutate({ key: COLUMN_VISIBILITY_PREF_KEY, value: {} });
  }, [saveColumnPref]);

  const toggleColumnVisibility = useCallback(
    (columnId: ColumnId) => {
      const next = {
        ...columnVisibility,
        [columnId]: columnVisibility[columnId] === false ? true : false,
      };
      setColumnVisibility(next);
      saveColumnPref.mutate({ key: COLUMN_VISIBILITY_PREF_KEY, value: next });
    },
    [columnVisibility, saveColumnPref]
  );

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; value: string; onRemove: () => void }> = [];

    if (debouncedSearch) {
      chips.push({
        key: 'search',
        label: 'Search',
        value: debouncedSearch,
        onRemove: () => setSearch(''),
      });
    }

    for (const columnId of TEXT_FILTER_COLUMNS) {
      const value = debouncedTextFilters[columnId];
      if (!value) continue;
      chips.push({
        key: columnId,
        label: COLUMN_LABELS[columnId],
        value,
        onRemove: () =>
          setTextFilters((prev) => {
            const next = { ...prev };
            delete next[columnId];
            return next;
          }),
      });
    }

    if (entityTypeFilter) {
      chips.push({
        key: 'entityType',
        label: 'Type',
        value: entityTypeFilter,
        onRemove: () => {
          setEntityTypeFilter('');
          setPage(1);
        },
      });
    }

    for (const columnId of DATE_FILTER_COLUMNS) {
      const range = dateFilters[columnId];
      if (!range?.from && !range?.to) continue;
      chips.push({
        key: `${columnId}Range`,
        label: COLUMN_LABELS[columnId],
        value: [range.from || '...', range.to || '...'].join(' - '),
        onRemove: () => handleDateRangeChange(columnId, undefined),
      });
    }

    return chips;
  }, [debouncedSearch, debouncedTextFilters, entityTypeFilter, dateFilters, handleDateRangeChange]);

  const canView =
    session?.isSuperAdmin || session?.isWorkspaceAdmin;

  if (!canView) {
    return (
      <div className="p-4 sm:p-6">
        <Alert variant="error">You do not have permission to access this page.</Alert>
      </div>
    );
  }

  const renderDesktopCell = (record: AcraRecord, columnId: ColumnId) => {
    switch (columnId) {
      case 'uen':
        return (
          <td key={columnId} className="px-4 py-3 max-w-0">
            <span className="text-sm text-text-primary block truncate font-mono" title={record.uen}>
              {record.uen}
            </span>
          </td>
        );
      case 'entityName':
        return (
          <td key={columnId} className="px-4 py-3 max-w-0">
            <span className="text-sm text-text-primary block truncate" title={record.entityName}>
              {record.entityName}
            </span>
          </td>
        );
      case 'entityStatus':
        return (
          <td key={columnId} className="px-4 py-3 max-w-0">
            <div className="min-w-0">
              <StatusBadge status={record.entityStatus} />
            </div>
          </td>
        );
      case 'entityType':
        return (
          <td key={columnId} className="px-4 py-3 max-w-0">
            <div className="min-w-0">
              <TypeBadge entityType={record.entityType} />
            </div>
          </td>
        );
      case 'dataAsOf':
      case 'createdAt':
      case 'updatedAt':
        return (
          <td key={columnId} className="px-4 py-3 max-w-0">
            <span className="text-sm text-text-secondary block truncate" title={record[columnId]}>
              {formatDate(record[columnId])}
            </span>
          </td>
        );
      default: {
        const value = record[columnId];
        return (
          <td key={columnId} className="px-4 py-3 max-w-0">
            <span className="text-sm text-text-secondary block truncate" title={value ?? undefined}>
              {value || '-'}
            </span>
          </td>
        );
      }
    }
  };

  const renderFilterCell = (columnId: ColumnId) => {
    if (columnId === 'entityType') {
      return (
        <SearchableSelect
          variant="table-filter"
          options={ENTITY_TYPE_OPTIONS}
          value={entityTypeFilter}
          onChange={(value) => {
            setEntityTypeFilter(value);
            setPage(1);
          }}
          placeholder="All"
          className="text-xs"
          showChevron={false}
          showKeyboardHints={false}
        />
      );
    }

    if (DATE_FILTER_COLUMNS.includes(columnId)) {
      const range = dateFilters[columnId];
      return (
        <DatePicker
          value={
            range?.from || range?.to
              ? {
                  mode: 'range' as const,
                  range: {
                    from: range.from ? new Date(range.from) : undefined,
                    to: range.to ? new Date(range.to) : undefined,
                  },
                }
              : undefined
          }
          onChange={(value) => handleDateRangeChange(columnId, value)}
          placeholder="All dates"
          size="sm"
          defaultTab="range"
          className="text-xs"
        />
      );
    }

    return (
      <InlineFilterInput
        value={textFilters[columnId] ?? ''}
        onChange={(value) =>
          setTextFilters((prev) => {
            const next = { ...prev };
            if (value) {
              next[columnId] = value;
            } else {
              delete next[columnId];
            }
            return next;
          })
        }
      />
    );
  };

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">ACRA Data</h1>
          <p className="text-sm text-text-secondary mt-1">
            Locally mirrored ACRA corporate entities used by the company name check
          </p>
          {data?.syncState && (
            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-text-muted">
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-background-tertiary">
                <Database className="w-3.5 h-3.5" />
                {data.syncState.entityCount.toLocaleString()} entities
              </span>
              <span className="px-2 py-1 rounded bg-background-tertiary">
                Data as of {formatDate(data.syncState.collectionLastUpdatedAt)}
              </span>
              {isSyncing && (
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-status-warning/10 text-status-warning">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Sync in progress...
                </span>
              )}
              {data.syncState.lastError && (
                <span className="px-2 py-1 rounded bg-status-error/10 text-status-error" title={data.syncState.lastError}>
                  Sync error: {data.syncState.lastError}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => triggerSync.mutate()}
            disabled={triggerSync.isPending || isSyncing}
            className="btn-secondary btn-sm flex items-center gap-2"
            title="Re-download and re-import the ACRA datasets"
          >
            <RefreshCw className={cn('w-4 h-4', (triggerSync.isPending || isSyncing) && 'animate-spin')} />
            {isSyncing ? 'Syncing...' : triggerSync.isPending ? 'Starting...' : 'Sync now'}
          </button>
        </div>
      </div>

      {/* Manual sync feedback */}
      {triggerSync.isSuccess && !isSyncing && (
        <Alert variant="success" className="mb-4">
          ACRA sync started. The dataset is being re-downloaded and imported in the background; the table refreshes automatically when it finishes.
        </Alert>
      )}
      {triggerSync.isError && (
        <Alert variant="error" className="mb-4">
          {triggerSync.error instanceof Error ? triggerSync.error.message : 'Failed to start the ACRA sync'}
        </Alert>
      )}
      {exportError && (
        <Alert variant="error" className="mb-4">
          {exportError}
        </Alert>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 p-4 bg-background-secondary border border-border-primary rounded-lg mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by entity name or UEN..."
            className="w-full pl-10 pr-10 py-2 text-sm bg-background-primary border border-border-primary rounded-lg focus:outline-none focus:ring-2 focus:ring-oak-primary/50"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 hover:bg-background-tertiary rounded"
              aria-label="Clear search"
            >
              <X className="w-4 h-4 text-text-muted" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsColumnModalOpen(true)}
          className="btn-secondary btn-sm flex items-center gap-2"
          title="Adjust columns"
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden xl:inline">Columns</span>
          {hiddenColumnCount > 0 && (
            <span className="bg-background-tertiary text-text-secondary text-2xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {hiddenColumnCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          className="btn-secondary btn-sm flex items-center gap-2"
          aria-label={isExporting ? 'Exporting ACRA records' : 'Export CSV'}
          title="Export all matching records with every database column"
        >
          <Download className="w-4 h-4" />
          <span className="hidden xl:inline">{isExporting ? 'Exporting...' : 'Export CSV'}</span>
        </button>
      </div>

      {/* Active Filter Chips */}
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

      {/* Error State */}
      {error && (
        <Alert variant="error" className="mb-4">
          {error instanceof Error ? error.message : 'Failed to load ACRA records'}
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12 text-text-secondary">Loading ACRA records...</div>
      )}

      {/* Mobile Card View */}
      {!isLoading && data && (
        <div className="lg:hidden space-y-3">
          {data.records.length === 0 ? (
            <div className="card p-8 text-center text-text-secondary">
              <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
              No ACRA records found
            </div>
          ) : (
            data.records.map((record) => {
              const isExpanded = expandedRecordIds.includes(record.id);
              return (
                <MobileCard
                  key={record.id}
                  title={record.entityName}
                  subtitle={<span className="font-mono">{record.uen}</span>}
                  badge={<StatusBadge status={record.entityStatus} />}
                  onCardClick={() => toggleRecordExpanded(record.id)}
                  actions={
                    <button
                      type="button"
                      onClick={() => toggleRecordExpanded(record.id)}
                      className="p-1 hover:bg-background-tertiary rounded transition-colors"
                      aria-label={isExpanded ? 'Collapse record details' : 'Expand record details'}
                      aria-expanded={isExpanded}
                    >
                      <ChevronDown
                        className={cn(
                          'w-4 h-4 text-text-muted transition-transform duration-150',
                          isExpanded && 'rotate-180'
                        )}
                      />
                    </button>
                  }
                  details={
                    isExpanded ? (
                      <CardDetailsGrid>
                        <CardDetailItem label="Company Type" value={record.companyTypeDescription || '-'} />
                        <CardDetailItem label="Type" value={record.entityType} />
                        <CardDetailItem label="Incorp. Date" value={record.registrationIncorporateDate || '-'} />
                        <CardDetailItem label="Account Due Date" value={record.accountDueDate || '-'} />
                        <CardDetailItem label="Annual Return Date" value={record.annualReturnDate || '-'} />
                        <CardDetailItem label="Primary SSIC" value={record.primarySsicCode || '-'} />
                        <CardDetailItem label="Primary SSIC Description" value={record.primarySsicDescription || '-'} />
                        <CardDetailItem label="Secondary SSIC" value={record.secondarySsicCode || '-'} />
                        <CardDetailItem label="Secondary SSIC Description" value={record.secondarySsicDescription || '-'} />
                        <CardDetailItem label="No. of Officers" value={record.noOfOfficers || '-'} />
                        <CardDetailItem label="Former Entity Name 1" value={record.formerEntityName1 || '-'} />
                        <CardDetailItem label="UEN of Audit Firm 1" value={record.uenOfAuditFirm1 || '-'} />
                        <CardDetailItem label="Block" value={record.block || '-'} />
                        <CardDetailItem label="Street" value={record.streetName || '-'} />
                        <CardDetailItem label="Level" value={record.levelNo || '-'} />
                        <CardDetailItem label="Unit" value={record.unitNo || '-'} />
                        <CardDetailItem label="Building" value={record.buildingName || '-'} />
                        <CardDetailItem label="Postal Code" value={record.postalCode || '-'} />
                        <CardDetailItem label="Address" value={record.address || '-'} fullWidth />
                        <CardDetailItem label="Data As Of" value={formatDate(record.dataAsOf)} />
                        <CardDetailItem label="Created" value={formatDate(record.createdAt)} />
                        <CardDetailItem label="Updated" value={formatDate(record.updatedAt)} />
                      </CardDetailsGrid>
                    ) : undefined
                  }
                />
              );
            })
          )}

          {data.totalPages > 0 && (
            <div className="mt-4">
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                limit={data.limit}
                onPageChange={setPage}
                onLimitChange={(newLimit) => {
                  setLimit(newLimit);
                  setPage(1);
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Desktop Table */}
      {!isLoading && data && (
        <div className={cn('hidden lg:block table-container overflow-hidden relative', isFetching && 'opacity-60')}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <colgroup>
                {visibleColumnIds.map((id) => (
                  <col
                    key={id}
                    style={
                      columnWidths[id]
                        ? { width: `${columnWidths[id]}px` }
                        : undefined
                    }
                  />
                ))}
              </colgroup>
              <thead className="bg-background-tertiary border-b border-border-primary">
                {/* Inline filter row */}
                <tr className="bg-background-secondary/50">
                  {visibleColumnIds.map((columnId) => (
                    <th key={columnId} className="px-4 py-2 max-w-0">
                      {renderFilterCell(columnId)}
                    </th>
                  ))}
                </tr>

                {/* Column header row */}
                <tr className="border-t border-border-primary">
                  {visibleColumnIds.map((columnId) => (
                    <th
                      key={columnId}
                      style={columnWidths[columnId] ? { width: `${columnWidths[columnId]}px` } : undefined}
                      className="relative text-xs font-medium text-text-secondary px-4 py-2.5 whitespace-nowrap text-left"
                      onPointerDown={(e) => startResizeIfEdge(e, columnId)}
                    >
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => handleSort(COLUMN_SORT_FIELDS[columnId])}
                        className={cn(
                          'inline-flex items-center gap-1 select-none hover:text-text-primary transition-colors',
                          sortBy === COLUMN_SORT_FIELDS[columnId] && 'text-text-primary'
                        )}
                      >
                        <span>{COLUMN_LABELS[columnId]}</span>
                        <span className="flex-shrink-0">
                          {sortBy === COLUMN_SORT_FIELDS[columnId] ? (
                            sortOrder === 'asc' ? (
                              <ArrowUp className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowDown className="w-3.5 h-3.5" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3.5 h-3.5 text-text-muted" />
                          )}
                        </span>
                      </button>
                      <div
                        onPointerDown={(e) => startResize(e, columnId)}
                        className="absolute top-0 -right-2 h-full w-4 cursor-col-resize hover:bg-border-secondary/60 z-10 touch-none"
                        title="Drag to resize"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.records.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumnIds.length} className="px-4 py-12 text-center">
                      <p className="text-sm text-text-secondary">No ACRA records found</p>
                    </td>
                  </tr>
                ) : (
                  data.records.map((record, index) => {
                    const isAlternate = index % 2 === 1;
                    return (
                      <tr
                        key={record.id}
                        className={cn(
                          'border-b border-border-primary transition-colors',
                          isAlternate
                            ? 'bg-oak-row-alt hover:bg-oak-row-alt-hover'
                            : 'hover:bg-background-tertiary/50'
                        )}
                      >
                        {visibleColumnIds.map((columnId) => renderDesktopCell(record, columnId))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.totalPages > 0 && (
            <div className="border-t border-border-primary">
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                limit={data.limit}
                onPageChange={setPage}
                onLimitChange={(newLimit) => {
                  setLimit(newLimit);
                  setPage(1);
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Adjust Columns Modal */}
      <Modal
        isOpen={isColumnModalOpen}
        onClose={() => setIsColumnModalOpen(false)}
        title="Adjust columns"
        description="Choose which columns to show, and reset widths if needed."
        size="lg"
      >
        <ModalBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {COLUMN_IDS.map((columnId) => (
              <Checkbox
                key={columnId}
                checked={isColumnVisible(columnId)}
                label={COLUMN_LABELS[columnId]}
                onChange={() => toggleColumnVisibility(columnId)}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-text-muted">Saved per user.</p>
        </ModalBody>
        <ModalFooter className="justify-between">
          <div className="flex items-center gap-2">
            <button type="button" onClick={showAllColumns} className="btn-secondary btn-sm">
              Show all
            </button>
            <button type="button" onClick={resetColumns} className="btn-secondary btn-sm" title="Reset column widths">
              Reset widths
            </button>
          </div>
          <button type="button" onClick={() => setIsColumnModalOpen(false)} className="btn-primary btn-sm">
            Done
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
