'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CheckCircle2,
  Clock,
  Layers,
  RotateCcw,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { isPlainTableRowClick } from '@/components/ui/data-table';
import { CompanySelect } from '@/components/ui/company-select';
import { DatePicker, type DatePickerValue } from '@/components/ui/date-picker';
import {
  MobileCard,
  CardDetailsGrid,
  CardDetailItem,
} from '@/components/ui/responsive-table';
import { useUserPreferences, useUpsertUserPreference } from '@/hooks/use-user-preferences';
import { useColumnResize } from '@/hooks/use-column-resize';
import type { DocumentGenerationBatchListItem } from '@/types/document-generation-batch';

type BatchStatus = DocumentGenerationBatchListItem['status'];
type SortField = 'companyName' | 'itemCount' | 'status' | 'createdByName' | 'updatedAt';
type SortOrder = 'asc' | 'desc';

const statusConfig: Record<BatchStatus, { color: string; label: string; icon: typeof Clock }> = {
  DRAFT: { color: 'badge-warning', label: 'Draft', icon: Clock },
  PARTIAL: { color: 'badge-info', label: 'Partial', icon: Layers },
  COMPLETED: { color: 'badge-success', label: 'Complete', icon: CheckCircle2 },
};

const COLUMN_IDS = ['company', 'documents', 'status', 'createdBy', 'updated', 'actions'] as const;
type ColumnId = (typeof COLUMN_IDS)[number];

const COLUMN_LABELS: Record<ColumnId, string> = {
  company: 'Company',
  documents: 'Documents',
  status: 'Status',
  createdBy: 'Created By',
  updated: 'Updated',
  actions: 'Actions',
};

const COLUMN_SORT_FIELDS: Partial<Record<ColumnId, SortField>> = {
  company: 'companyName',
  documents: 'itemCount',
  status: 'status',
  createdBy: 'createdByName',
  updated: 'updatedAt',
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...Object.entries(statusConfig).map(([value, config]) => ({
    value,
    label: config.label,
  })),
];

const COLUMN_PREF_KEY = 'generated-documents:batches:columns:v1';
const DEFAULT_COLUMN_WIDTHS: Record<ColumnId, number> = {
  company: 240,
  documents: 280,
  status: 140,
  createdBy: 160,
  updated: 160,
  actions: 120,
};
const MINIMUM_COLUMN_WIDTHS: Record<ColumnId, number> = {
  company: 160,
  documents: 180,
  status: 110,
  createdBy: 120,
  updated: 120,
  actions: 90,
};

function progressSummary(batch: DocumentGenerationBatchListItem): string {
  const { counts } = batch;
  if (counts.GENERATED > 0) {
    return `${counts.GENERATED} generated${counts.FAILED > 0 ? ` · ${counts.FAILED} failed` : ''}`;
  }
  if (counts.READY === batch.itemCount) {
    return 'Ready to generate';
  }
  const pending = counts.NOT_STARTED + counts.NEEDS_INPUT + counts.PREVIEWED;
  if (pending > 0) {
    return `${pending} need${pending === 1 ? 's' : ''} attention · ${counts.READY} ready`;
  }
  return `${counts.READY} of ${batch.itemCount} ready`;
}

function resumeBatchHref(batchId: string): string {
  return `/generated-documents/generate?batch=${batchId}`;
}

function toLocalDateString(date?: Date): string | undefined {
  if (!date) return undefined;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLocalDate(value?: string): Date | undefined {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

function InlineTextFilter({
  ariaLabel,
  value,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="flex h-9 w-full items-center gap-2 rounded-lg border border-border-primary bg-background-secondary/30 transition-colors hover:border-oak-primary/50 focus-within:ring-2 focus-within:ring-oak-primary/30">
      <input
        type="text"
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value || undefined)}
        placeholder="All"
        className="min-w-0 flex-1 bg-transparent px-3 text-xs text-text-primary outline-none placeholder:text-text-secondary"
      />
      {value ? (
        <button
          type="button"
          aria-label={`Clear ${ariaLabel.toLowerCase()}`}
          onClick={() => onChange(undefined)}
          className="mr-1 rounded p-0.5 transition-colors hover:bg-background-tertiary"
        >
          <X className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export interface GenerationBatchTableProps {
  batches: DocumentGenerationBatchListItem[];
  onDiscard: (batchId: string) => void | Promise<void>;
  isDiscarding?: boolean;
}

function SortHeader({
  label,
  field,
  sortField,
  sortOrder,
  onSort,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortOrder: SortOrder;
  onSort: (field: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        'inline-flex items-center gap-1 select-none transition-colors hover:text-text-primary',
        active && 'text-text-primary',
      )}
    >
      <span>{label}</span>
      <span className="flex-shrink-0">
        {active ? (
          sortOrder === 'asc'
            ? <ArrowUp className="h-3.5 w-3.5" />
            : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 text-text-muted" />
        )}
      </span>
    </button>
  );
}

export function GenerationBatchTable({
  batches,
  onDiscard,
  isDiscarding = false,
}: GenerationBatchTableProps) {
  const [companyFilterId, setCompanyFilterId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createdByFilter, setCreatedByFilter] = useState('');
  const [updatedFrom, setUpdatedFrom] = useState<string | undefined>(undefined);
  const [updatedTo, setUpdatedTo] = useState<string | undefined>(undefined);
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [batchToDiscard, setBatchToDiscard] = useState<DocumentGenerationBatchListItem | null>(null);
  const router = useRouter();

  const [columnWidths, setColumnWidths] = useState<Partial<Record<ColumnId, number>>>({});
  const { data: preferenceMap } = useUserPreferences([COLUMN_PREF_KEY]);
  const saveColumnPreference = useUpsertUserPreference<Record<ColumnId, number>>();
  const preferenceValue = preferenceMap?.[COLUMN_PREF_KEY]?.value;
  const preferenceValueKey = JSON.stringify(preferenceValue ?? null);

  useEffect(() => {
    const restored = JSON.parse(preferenceValueKey) as unknown;
    if (!restored || typeof restored !== 'object' || Array.isArray(restored)) return;
    const nextWidths: Partial<Record<ColumnId, number>> = {};
    for (const columnId of COLUMN_IDS) {
      const width = (restored as Record<string, unknown>)[columnId];
      if (typeof width === 'number' && Number.isFinite(width)) {
        nextWidths[columnId] = Math.max(MINIMUM_COLUMN_WIDTHS[columnId], width);
      }
    }
    setColumnWidths(nextWidths);
  }, [preferenceValueKey]);

  const persistWidth = useCallback((columnId: ColumnId, width: number) => {
    setColumnWidths((current) => {
      const nextWidths: Record<ColumnId, number> = {
        ...DEFAULT_COLUMN_WIDTHS,
        ...current,
        [columnId]: width,
      };
      saveColumnPreference.mutate({ key: COLUMN_PREF_KEY, value: nextWidths });
      return nextWidths;
    });
  }, [saveColumnPreference]);

  const { startResize, resizeWithKeyboard } = useColumnResize<ColumnId>({
    getWidth: (columnId) => columnWidths[columnId],
    getDefaultWidth: (columnId) => DEFAULT_COLUMN_WIDTHS[columnId],
    clampWidth: (width, columnId) => Math.max(MINIMUM_COLUMN_WIDTHS[columnId], width),
    onResize: (columnId, width) => setColumnWidths((current) => ({ ...current, [columnId]: width })),
    onResizeEnd: persistWidth,
  });

  const handleSort = useCallback((field: SortField) => {
    setSortField((current) => {
      if (current === field) {
        setSortOrder((order) => (order === 'asc' ? 'desc' : 'asc'));
        return current;
      }
      setSortOrder(field === 'updatedAt' ? 'desc' : 'asc');
      return field;
    });
  }, []);

  const handleRowClick = useCallback((
    event: React.MouseEvent<HTMLTableRowElement>,
    batch: DocumentGenerationBatchListItem,
  ) => {
    if (!isPlainTableRowClick(event)) return;

    router.push(resumeBatchHref(batch.id));
  }, [router]);

  const filtered = useMemo(() => {
    return batches.filter((batch) => {
      if (companyFilterId && batch.primaryCompanyId !== companyFilterId) return false;
      if (statusFilter && batch.status !== statusFilter) return false;
      if (createdByFilter) {
        const query = createdByFilter.trim().toLowerCase();
        const name = `${batch.createdBy.firstName} ${batch.createdBy.lastName}`.toLowerCase();
        if (!name.includes(query)) return false;
      }
      if (updatedFrom || updatedTo) {
        const updatedAt = new Date(batch.updatedAt).getTime();
        if (updatedFrom && updatedAt < new Date(`${updatedFrom}T00:00:00.000`).getTime()) return false;
        if (updatedTo && updatedAt > new Date(`${updatedTo}T23:59:59.999`).getTime()) return false;
      }
      return true;
    });
  }, [batches, companyFilterId, statusFilter, createdByFilter, updatedFrom, updatedTo]);

  const sorted = useMemo(() => {
    const result = [...filtered];
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'companyName':
          cmp = (a.companyName ?? '').localeCompare(b.companyName ?? '');
          break;
        case 'itemCount':
          cmp = a.itemCount - b.itemCount;
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'createdByName':
          cmp = `${a.createdBy.firstName} ${a.createdBy.lastName}`.localeCompare(
            `${b.createdBy.firstName} ${b.createdBy.lastName}`,
          );
          break;
        case 'updatedAt':
        default:
          cmp = a.updatedAt.localeCompare(b.updatedAt);
          break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [filtered, sortField, sortOrder]);

  if (batches.length === 0) return null;

  const emptyState = (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Layers className="h-8 w-8 text-text-muted" aria-hidden="true" />
      <p className="mt-2 text-sm text-text-secondary">
        No draft batches match your filters.
      </p>
    </div>
  );

  return (
    <>
      {/* Mobile card view */}
      <div className="space-y-3 md:hidden">
        {sorted.length === 0 ? emptyState : sorted.map((batch, index) => {
          const status = statusConfig[batch.status] ?? statusConfig.DRAFT;
          const StatusIcon = status.icon;
          return (
            <MobileCard
              key={batch.id}
              title={batch.companyName ?? 'Company not selected'}
              subtitle={`${batch.itemCount} document${batch.itemCount === 1 ? '' : 's'} · ${progressSummary(batch)}`}
              badge={
                <span className={cn('badge inline-flex items-center gap-1', status.color)}>
                  <StatusIcon className="h-3 w-3" aria-hidden="true" />
                  {status.label}
                </span>
              }
              className={index % 2 === 1 ? 'bg-oak-row-alt' : undefined}
              onCardClick={() => router.push(resumeBatchHref(batch.id))}
              details={
                <CardDetailsGrid>
                  <CardDetailItem
                    label="Created By"
                    value={`${batch.createdBy.firstName} ${batch.createdBy.lastName}`}
                    icon={<User className="h-3 w-3" aria-hidden="true" />}
                  />
                  <CardDetailItem
                    label="Updated"
                    value={formatDate(batch.updatedAt)}
                    icon={<Clock className="h-3 w-3" aria-hidden="true" />}
                  />
                </CardDetailsGrid>
              }
              actions={
                <div className="flex items-center gap-1">
                  <Link
                    href={resumeBatchHref(batch.id)}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-2 text-text-tertiary transition-colors hover:bg-background-elevated hover:text-text-primary"
                    aria-label={`Resume ${batch.companyName ?? 'batch'} (${batch.itemCount} documents)`}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => setBatchToDiscard(batch)}
                    disabled={isDiscarding}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-2 text-text-tertiary transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950 dark:hover:text-red-400"
                    aria-label={`Discard unfinished work for ${batch.companyName ?? 'this batch'}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              }
            />
          );
        })}
      </div>

      {/* Desktop table view */}
      <div className="table-container hidden overflow-x-auto md:block">
        <table
          className="table w-full min-w-max"
        >
          <colgroup>
            {COLUMN_IDS.map((columnId) => (
              <col
                key={columnId}
                style={columnId === 'actions'
                  ? undefined
                  : { width: `${columnWidths[columnId] ?? DEFAULT_COLUMN_WIDTHS[columnId]}px` }}
              />
            ))}
          </colgroup>
          <thead className="border-b border-border-primary bg-background-tertiary">
            <tr data-filter-row className="h-14 bg-background-secondary/50">
              {COLUMN_IDS.map((columnId) => (
                <th key={columnId} className="max-w-0">
                  {columnId === 'company' ? (
                    <CompanySelect
                      value={companyFilterId}
                      onChange={(companyId) => setCompanyFilterId(companyId || '')}
                      placeholder="All companies"
                      className="text-xs"
                    />
                  ) : columnId === 'status' ? (
                    <SearchableSelect
                      variant="table-filter"
                      options={STATUS_FILTER_OPTIONS}
                      value={statusFilter}
                      onChange={(value) => setStatusFilter(value || '')}
                      placeholder="All statuses"
                      className="text-xs"
                      showChevron={false}
                      showKeyboardHints={false}
                    />
                  ) : columnId === 'createdBy' ? (
                    <InlineTextFilter
                      ariaLabel="Filter batches by creator"
                      value={createdByFilter}
                      onChange={(value) => setCreatedByFilter(value ?? '')}
                    />
                  ) : columnId === 'updated' ? (
                    <DatePicker
                      value={
                        updatedFrom || updatedTo
                          ? {
                              mode: 'range' as const,
                              range: {
                                from: parseLocalDate(updatedFrom),
                                to: parseLocalDate(updatedTo),
                              },
                            }
                          : undefined
                      }
                      onChange={(value: DatePickerValue | undefined) => {
                        const range = value?.mode === 'range' ? value.range : undefined;
                        setUpdatedFrom(toLocalDateString(range?.from));
                        setUpdatedTo(toLocalDateString(range?.to));
                      }}
                      placeholder="All dates"
                      size="sm"
                      defaultTab="range"
                      className="text-xs"
                    />
                  ) : null}
                </th>
              ))}
            </tr>
            <tr data-column-header-row className="h-[38px] border-t border-border-primary">
              {COLUMN_IDS.map((columnId) => (
                <th
                  key={columnId}
                  className={cn(
                    'relative whitespace-nowrap px-4 py-2.5 text-xs font-medium text-text-secondary',
                    columnId === 'actions' && 'text-right',
                  )}
                >
                  {columnId === 'actions' ? (
                    <span>{COLUMN_LABELS[columnId]}</span>
                  ) : COLUMN_SORT_FIELDS[columnId] ? (
                    <SortHeader
                      label={COLUMN_LABELS[columnId]}
                      field={COLUMN_SORT_FIELDS[columnId]!}
                      sortField={sortField}
                      sortOrder={sortOrder}
                      onSort={handleSort}
                    />
                  ) : (
                    <span>{COLUMN_LABELS[columnId]}</span>
                  )}
                  {columnId !== 'actions' && (
                    <span
                      role="separator"
                      aria-label={`Resize ${COLUMN_LABELS[columnId]} column`}
                      aria-orientation="vertical"
                      tabIndex={0}
                      className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none select-none border-r border-transparent hover:border-oak-primary focus:border-oak-primary focus:outline-none"
                      onPointerDown={(event) => startResize(event, columnId)}
                      onKeyDown={(event) => resizeWithKeyboard(event, columnId)}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_IDS.length} className="px-4 py-12 text-center">
                  {emptyState}
                </td>
              </tr>
            ) : sorted.map((batch, index) => {
              const status = statusConfig[batch.status] ?? statusConfig.DRAFT;
              const StatusIcon = status.icon;
              return (
                <tr
                  key={batch.id}
                  onClick={(event) => handleRowClick(event, batch)}
                  className={cn(
                    'border-b border-border-primary transition-colors cursor-pointer',
                    index % 2 === 1
                      ? 'bg-oak-row-alt hover:bg-oak-row-alt-hover'
                      : 'hover:bg-background-tertiary/50',
                  )}
                >
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                      <span className="truncate font-medium text-text-primary">
                        {batch.companyName ?? 'Company not selected'}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="block text-sm text-text-primary">
                      {batch.itemCount} document{batch.itemCount === 1 ? '' : 's'}
                    </span>
                    <span className="block text-xs text-text-muted">{progressSummary(batch)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('badge inline-flex items-center gap-1', status.color)}>
                      <StatusIcon className="h-3 w-3" aria-hidden="true" />
                      {status.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <User className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                      <span className="truncate text-text-primary">
                        {batch.createdBy.firstName} {batch.createdBy.lastName}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{formatDate(batch.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={resumeBatchHref(batch.id)}
                        className="rounded p-1.5 text-text-tertiary transition-colors hover:bg-background-elevated hover:text-text-primary"
                        aria-label={`Resume ${batch.companyName ?? 'batch'} (${batch.itemCount} documents)`}
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setBatchToDiscard(batch)}
                        disabled={isDiscarding}
                        className="rounded p-1.5 text-text-tertiary transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950 dark:hover:text-red-400"
                        aria-label={`Discard unfinished work for ${batch.companyName ?? 'this batch'}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        isOpen={batchToDiscard !== null}
        onClose={() => setBatchToDiscard(null)}
        onConfirm={() => {
          if (!batchToDiscard) return;
          void onDiscard(batchToDiscard.id);
          setBatchToDiscard(null);
        }}
        title="Discard unfinished batch?"
        description={
          batchToDiscard && batchToDiscard.counts.GENERATED > 0
            ? 'Generated documents will be kept in the normal list. Only the unfinished batch state will be removed.'
            : 'All incomplete batch work will be removed. This action cannot be undone.'
        }
        confirmLabel="Discard"
        variant="danger"
      />
    </>
  );
}
