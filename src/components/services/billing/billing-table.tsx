'use client';

import { CheckSquare, MinusSquare, MoreHorizontal, Receipt, Square } from 'lucide-react';
import { useColumnResize } from '@/hooks/use-column-resize';
import { EmptyState } from '@/components/ui/empty-state';
import { useMemo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { CardDetailItem, CardDetailsGrid, MobileCard } from '@/components/ui/responsive-table';
import type { SelectOption } from '@/components/ui/searchable-select';
import { TableBody, TableEmptyState, TableFilterCell, TableFilterRow, TableHead, TableHeaderCell, TableHeaderRow, TableRoot, TableRow, TableSelectFilter, TableSelectionButton, TableShell, TableTextFilter, TableViewport } from '@/components/ui/data-table';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { cn, formatCurrency } from '@/lib/utils';
import type { BillingOccurrenceDto, BillingOccurrenceTiming } from '@/services/billing';
import type { ServiceFamilyFilter } from '@/components/services/shared/family-filter-chips';
import {
  BILLING_COLUMN_WIDTH_MAX,
  BILLING_COLUMN_WIDTH_MIN,
  type BillingColumnId,
} from '@/lib/validations/services-preferences';

export interface BillingInlineFilters {
  expectedDate?: string;
  timing?: BillingOccurrenceTiming;
  companyId?: string;
  familyId?: string;
  service?: string;
  feeLine?: string;
  period?: string;
  status?: BillingOccurrenceDto['status'];
  amountMin?: string;
  amountMax?: string;
  billedDate?: string;
  reference?: string;
}

export interface BillingTableProps {
  items: BillingOccurrenceDto[];
  /** Replaces the default empty message, such as a ListEmptyState with Clear filters. */
  emptyState?: ReactNode;
  families?: ServiceFamilyFilter[];
  isFetching?: boolean;
  canEdit?: boolean;
  selectedIds?: Set<string>;
  isAllSelected?: boolean;
  isIndeterminate?: boolean;
  columnWidths: Record<string, number | undefined>;
  columnOrder: BillingColumnId[];
  columnVisibility: Record<BillingColumnId, boolean>;
  sortBy: 'expectedDate' | 'company' | 'family' | 'service' | 'status' | 'amount';
  sortOrder: 'asc' | 'desc';
  inlineFilters?: BillingInlineFilters;
  onInlineFilterChange?: (filters: Partial<BillingInlineFilters>) => void;
  onSort?: (sortBy: BillingTableProps['sortBy']) => void;
  onColumnWidthChange?: (columnId: BillingColumnId, width: number) => void;
  onColumnResizeEnd?: (columnId: BillingColumnId, width: number) => void;
  onToggleOne?: (id: string) => void;
  onToggleAll?: () => void;
  onEdit?: (occurrence: BillingOccurrenceDto) => void;
}

export const billingColumnLabels: Record<BillingColumnId, string> = {
  expectedDate: 'Expected date',
  timing: 'Timing',
  company: 'Company',
  family: 'Family',
  service: 'Service',
  feeLine: 'Fee line',
  period: 'Period',
  status: 'State',
  amount: 'Amount / currency',
  billedDate: 'Billed date',
  reference: 'Reference',
  actions: 'Actions',
};

export const defaultBillingColumnWidths: Record<BillingColumnId, number> = {
  expectedDate: 174,
  timing: 110,
  company: 303,
  family: 244,
  service: 233,
  feeLine: 373,
  period: 128,
  status: 115,
  amount: 169,
  billedDate: 135,
  reference: 170,
  actions: 100,
};

const sortableColumns: Partial<Record<BillingColumnId, BillingTableProps['sortBy']>> = {
  expectedDate: 'expectedDate',
  company: 'company',
  family: 'family',
  service: 'service',
  status: 'status',
  amount: 'amount',
};

const timingOptions: SelectOption[] = [
  { value: '', label: 'All' },
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'DUE', label: 'Due' },
  { value: 'OVERDUE', label: 'Overdue' },
];

const statusOptions: SelectOption[] = [
  { value: '', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'BILLED', label: 'Billed' },
  { value: 'WAIVED', label: 'Waived' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function displayDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function statusLabel(status: BillingOccurrenceDto['status']): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function statusClass(status: BillingOccurrenceDto['status'], timingState: BillingOccurrenceDto['timingState']): string {
  if (status === 'BILLED') return 'badge-success';
  if (status === 'WAIVED' || status === 'CANCELLED') return 'badge-neutral';
  if (timingState === 'OVERDUE') return 'badge-danger';
  if (timingState === 'DUE') return 'badge-warning';
  return 'badge-success';
}

function timingLabel(item: BillingOccurrenceDto): string {
  if (item.status !== 'OPEN' || !item.timingState) return '—';
  return item.timingState.charAt(0) + item.timingState.slice(1).toLowerCase();
}

function CompanyCell({ item }: { item: BillingOccurrenceDto }) {
  return <div className="min-w-0" title={item.company.name}><span className="block truncate font-medium text-text-primary">{item.company.name}</span></div>;
}

function SelectionIcon({ selected, indeterminate = false }: { selected: boolean; indeterminate?: boolean }) {
  if (selected) return <CheckSquare className="h-4 w-4 text-oak-primary" aria-hidden="true" />;
  if (indeterminate) return <MinusSquare className="h-4 w-4 text-oak-light" aria-hidden="true" />;
  return <Square className="h-4 w-4 text-text-muted" aria-hidden="true" />;
}

function DebouncedInlineFilter({ label, value, filterKey, onChange, type = 'search' }: { label: string; value: string | undefined; filterKey: keyof BillingInlineFilters; onChange?: BillingTableProps['onInlineFilterChange']; type?: 'search' | 'number' }) {
  return (
    <TableTextFilter
      ariaLabel={`Filter ${label}`}
      value={value}
      onChange={(nextValue) => onChange?.({ [filterKey]: nextValue })}
      debounceMs={300}
      type={type}
    />
  );
}

function SelectFilter({ label, options, value, onChange }: { label: string; options: SelectOption[]; value: string; onChange: (value: string) => void }) {
  const filterLabels: Record<string, string> = { timing: 'Timing', company: 'Company', family: 'Family', status: 'Status' };
  return (
    <TableSelectFilter
      options={options}
      value={value}
      onChange={onChange}
      placeholder="All"
      ariaLabel={`Filter ${filterLabels[label] ?? label}`}
    />
  );
}

function AmountRangeFilter({ filters, onChange }: { filters: BillingInlineFilters; onChange?: BillingTableProps['onInlineFilterChange'] }) {
  return (
    <div role="group" aria-label="Filter Amount / currency" className="flex min-w-0 items-center gap-1">
      <DebouncedInlineFilter label="Minimum amount" value={filters.amountMin} filterKey="amountMin" onChange={onChange} type="number" />
      <span aria-hidden="true" className="text-xs text-text-muted">–</span>
      <DebouncedInlineFilter label="Maximum amount" value={filters.amountMax} filterKey="amountMax" onChange={onChange} type="number" />
    </div>
  );
}

function DateFilter({ label, value, filterKey, onChange }: { label: string; value: string | undefined; filterKey: 'expectedDate' | 'billedDate'; onChange?: BillingTableProps['onInlineFilterChange'] }) {
  return <SingleDateInput value={value ?? ''} onChange={(nextValue) => onChange?.({ [filterKey]: nextValue || undefined })} ariaLabel={`Filter ${label}`} placeholder="All dates" showCalendar variant="table-filter" className="text-xs [&_input]:placeholder:text-text-muted" />;
}

function InlineFilterRow({ columns, filters, families, companyOptions, onChange, selectable }: { columns: BillingColumnId[]; filters: BillingInlineFilters; families: ServiceFamilyFilter[]; companyOptions: SelectOption[]; onChange?: BillingTableProps['onInlineFilterChange']; selectable: boolean }) {
  const familyOptions = families.map((family) => ({ value: family.id, label: family.name }));
  const filter = (column: BillingColumnId) => {
    switch (column) {
      case 'expectedDate': return <DateFilter label="Expected date" value={filters.expectedDate} filterKey="expectedDate" onChange={onChange} />;
      case 'timing': return <SelectFilter label="timing" options={timingOptions} value={filters.timing ?? ''} onChange={(value) => onChange?.({ timing: (value || undefined) as BillingOccurrenceTiming | undefined })} />;
      case 'company': return <SelectFilter label="company" options={companyOptions} value={filters.companyId ?? ''} onChange={(value) => onChange?.({ companyId: value || undefined })} />;
      case 'family': return <SelectFilter label="family" options={familyOptions} value={filters.familyId ?? ''} onChange={(value) => onChange?.({ familyId: value || undefined })} />;
      case 'service': return <DebouncedInlineFilter label="Service" value={filters.service} filterKey="service" onChange={onChange} />;
      case 'feeLine': return <DebouncedInlineFilter label="Fee line" value={filters.feeLine} filterKey="feeLine" onChange={onChange} />;
      case 'period': return <DebouncedInlineFilter label="Period" value={filters.period} filterKey="period" onChange={onChange} />;
      case 'status': return <SelectFilter label="status" options={statusOptions} value={filters.status ?? ''} onChange={(value) => onChange?.({ status: (value || undefined) as BillingOccurrenceDto['status'] | undefined })} />;
      case 'amount': return <AmountRangeFilter filters={filters} onChange={onChange} />;
      case 'billedDate': return <DateFilter label="Billed date" value={filters.billedDate} filterKey="billedDate" onChange={onChange} />;
      case 'reference': return <DebouncedInlineFilter label="Reference" value={filters.reference} filterKey="reference" onChange={onChange} />;
      default: return <span className="sr-only">{billingColumnLabels[column]} filter</span>;
    }
  };

  return (
    <TableFilterRow>
      {selectable ? <TableFilterCell className="w-12 px-2"><span className="sr-only">Selection filter</span></TableFilterCell> : null}
      {columns.map((column) => <TableFilterCell key={column} className="px-2">{filter(column)}</TableFilterCell>)}
    </TableFilterRow>
  );
}

/** Amount, with the quantity billed (or still needed) on a tiered postpaid fee. */
function AmountValue({ item }: { item: BillingOccurrenceDto }) {
  const amount = formatCurrency(item.operativeAmount, item.operativeCurrency);
  const pricing = item.feeLine.tieredPricing;
  if (!pricing) return <>{amount}</>;
  if (item.quantity == null) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {amount}
        {item.status === 'OPEN' ? <span className="badge badge-warning">Quantity needed</span> : null}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col">
      <span>{amount}</span>
      <span className="text-xs text-text-muted">{item.quantity.replace(/\.00$/, '')} × {pricing.unitLabel}</span>
    </span>
  );
}

function Cell({ item, column, canEdit, onEdit }: { item: BillingOccurrenceDto; column: BillingColumnId; canEdit: boolean; onEdit?: (occurrence: BillingOccurrenceDto) => void }) {
  switch (column) {
    case 'expectedDate': return <td className="px-3 py-2 align-middle text-sm text-text-secondary">{displayDate(item.operativeExpectedDate)}</td>;
    case 'timing': return <td className="px-3 py-2 align-middle"><span className={cn('badge', statusClass(item.status, item.timingState))}>{timingLabel(item)}</span></td>;
    case 'company': return <td className="max-w-0 px-3 py-2 align-middle"><CompanyCell item={item} /></td>;
    case 'family': return <td className="max-w-0 px-3 py-2 align-middle text-sm text-text-primary">{item.family.name || item.service.familyName || '—'}</td>;
    case 'service': return <td className="max-w-0 px-3 py-2 align-middle text-sm text-text-primary"><span className="block truncate" title={item.service.name}>{item.service.name || '—'}</span></td>;
    case 'feeLine': return <td className="max-w-0 px-3 py-2 align-middle text-sm text-text-primary"><span className="block truncate" title={item.feeLine.description}>{item.feeLine.description || 'Fee line'}</span></td>;
    case 'period': return <td className="px-3 py-2 align-middle text-sm text-text-secondary">{item.billingPeriodKey}</td>;
    case 'status': return <td className="px-3 py-2 align-middle"><span className={cn('badge', statusClass(item.status, item.timingState))}>{statusLabel(item.status)}</span></td>;
    case 'amount': return <td className="px-3 py-2 align-middle text-sm text-text-primary"><AmountValue item={item} /></td>;
    case 'billedDate': return <td className="px-3 py-2 align-middle text-sm text-text-secondary">{displayDate(item.billedDate)}</td>;
    case 'reference': return <td className="max-w-0 px-3 py-2 align-middle text-sm text-text-secondary"><span className="block truncate" title={item.externalReference ?? undefined}>{item.externalReference || '—'}</span></td>;
    case 'actions': return <td className="px-3 py-2 align-middle"><Button type="button" variant="ghost" size="sm" iconOnly className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8" aria-label={`Edit tracking for ${item.company.name}`} onClick={(event) => { event.stopPropagation(); onEdit?.(item); }} disabled={!canEdit} leftIcon={<MoreHorizontal className="h-4 w-4" />} /></td>;
  }
}

function MobileBillingCard({ item, canEdit, selected, onToggle, onEdit }: { item: BillingOccurrenceDto; canEdit: boolean; selected: boolean; onToggle?: (id: string) => void; onEdit?: (occurrence: BillingOccurrenceDto) => void }) {
  const selectable = canEdit && item.status === 'OPEN';
  return (
    <MobileCard title={<CompanyCell item={item} />} subtitle={<span title={item.service.name}>{item.service.name}</span>} badge={<span className={cn('badge', statusClass(item.status, item.timingState))}>{item.status === 'OPEN' ? timingLabel(item) : statusLabel(item.status)}</span>} isSelected={selected} selectable={selectable} onToggle={() => onToggle?.(item.id)} selectionLabel={selected ? `Deselect billing occurrence for ${item.company.name}` : `Select billing occurrence for ${item.company.name}`} onCardClick={() => canEdit && onEdit?.(item)} actions={<Button type="button" variant="ghost" size="sm" iconOnly className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8" aria-label={`Edit tracking for ${item.company.name}`} onClick={() => onEdit?.(item)} disabled={!canEdit} leftIcon={<MoreHorizontal className="h-4 w-4" />} />} details={(
      <CardDetailsGrid>
        <CardDetailItem label="Family" value={item.family.name || item.service.familyName} />
        <CardDetailItem label="Service" value={item.service.name} />
        <CardDetailItem label="Expected date" value={displayDate(item.operativeExpectedDate)} />
        <CardDetailItem label="Fee line" value={item.feeLine.description || 'Fee line'} />
        <CardDetailItem label="Period" value={item.billingPeriodKey} />
        <CardDetailItem label="Amount" value={<AmountValue item={item} />} />
        <CardDetailItem label="Billed date" value={displayDate(item.billedDate)} />
        <CardDetailItem label="Reference" value={item.externalReference || '—'} fullWidth />
      </CardDetailsGrid>
    )} />
  );
}

export function BillingTable({ items, families = [], isFetching = false, canEdit = true, selectedIds = new Set(), isAllSelected = false, isIndeterminate = false, columnWidths, columnOrder, columnVisibility, sortBy, sortOrder, inlineFilters = {}, onInlineFilterChange, onSort, onColumnWidthChange, onColumnResizeEnd, onToggleOne, onToggleAll, onEdit, emptyState }: BillingTableProps) {
  const emptyContent = emptyState ?? <EmptyState icon={Receipt} title="No billing occurrences found" />;
  const visibleColumns = useMemo(() => columnOrder.filter((column) => columnVisibility[column]), [columnOrder, columnVisibility]);
  const selectable = canEdit && Boolean(onToggleOne && onToggleAll);
  const companyOptions = useMemo(() => {
    const options = new Map<string, SelectOption>();
    for (const item of items) options.set(item.company.id, { value: item.company.id, label: item.company.name, description: item.company.uen ?? undefined });
    return [...options.values()];
  }, [items]);
  const { startResize, resizeWithKeyboard } = useColumnResize<BillingColumnId>({
    getWidth: (columnId) => columnWidths[columnId],
    getDefaultWidth: (columnId) => defaultBillingColumnWidths[columnId],
    clampWidth: (width) => Math.min(BILLING_COLUMN_WIDTH_MAX, Math.max(BILLING_COLUMN_WIDTH_MIN, Math.round(width))),
    onResize: (columnId, width) => onColumnWidthChange?.(columnId, width),
    onResizeEnd: (columnId, width) => onColumnResizeEnd?.(columnId, width),
  });

  return (
    <>
      <div role="region" className="space-y-3 md:hidden" aria-label="Billing occurrence cards">
        {selectable ? <button type="button" onClick={onToggleAll} aria-label="Select all billing occurrences" aria-pressed={isAllSelected} className="flex min-h-11 items-center gap-2 px-1 text-sm text-text-secondary"><SelectionIcon selected={isAllSelected} indeterminate={isIndeterminate} /><span>{isAllSelected ? 'Deselect all' : 'Select all'}</span></button> : null}
        {items.length === 0 ? <div className="rounded-xl border border-border-primary bg-background-secondary">{emptyContent}</div> : items.map((item) => <MobileBillingCard key={item.id} item={item} canEdit={canEdit} selected={selectedIds.has(item.id)} onToggle={onToggleOne} onEdit={onEdit} />)}
      </div>
      <TableShell className="hidden md:block" isFetching={isFetching} style={{ contain: 'inline-size paint' }}>
        <TableViewport className="max-w-full">
          <TableRoot aria-label="Billing occurrences table">
            <colgroup>{selectable ? <col style={{ width: '48px' }} /> : null}{visibleColumns.map((column) => <col key={column} style={column === 'actions' ? undefined : { width: `${columnWidths[column] ?? defaultBillingColumnWidths[column]}px` }} />)}</colgroup>
            <TableHead>
              <InlineFilterRow columns={visibleColumns} filters={inlineFilters} families={families} companyOptions={companyOptions} selectable={selectable} onChange={onInlineFilterChange} />
              <TableHeaderRow>
                {selectable ? (
                  <TableHeaderCell className="w-12 px-2 text-center">
                    <TableSelectionButton
                      selected={isAllSelected}
                      indeterminate={isIndeterminate}
                      onClick={() => onToggleAll?.()}
                      ariaLabel="Select all billing occurrences"
                    />
                  </TableHeaderCell>
                ) : null}
                {visibleColumns.map((column) => {
                  const field = sortableColumns[column];
                  const active = field === sortBy;
                  return (
                    <TableHeaderCell
                      key={column}
                      label={billingColumnLabels[column]}
                      sorted={active}
                      sortOrder={sortOrder}
                      onSort={field && onSort ? () => onSort(field) : undefined}
                      sortAriaLabel={field ? (active ? `Sort by ${billingColumnLabels[column]}, currently ${sortOrder === 'asc' ? 'ascending' : 'descending'}` : `Sort by ${billingColumnLabels[column]}`) : undefined}
                      resizable={column !== 'actions'}
                      onResizePointerDown={column !== 'actions' ? (event) => startResize(event, column) : undefined}
                      onResizeKeyDown={column !== 'actions' ? (event) => resizeWithKeyboard(event, column) : undefined}
                      resizeAriaLabel={`Resize ${billingColumnLabels[column]} column`}
                    />
                  );
                })}
              </TableHeaderRow>
            </TableHead>
            <TableBody>
              {items.length === 0 ? (
                <TableEmptyState colSpan={visibleColumns.length + (selectable ? 1 : 0)} message={emptyContent} />
              ) : items.map((item, index) => {
                const rowSelectable = selectable && item.status === 'OPEN';
                const selected = selectedIds.has(item.id);
                return (
                  <TableRow
                    key={item.id}
                    index={index}
                    selected={selected}
                    interactive={canEdit && Boolean(onEdit)}
                    onActivate={canEdit && onEdit ? () => onEdit(item) : undefined}
                  >
                    {selectable ? (
                      <td className="w-12 px-2 text-center align-middle">
                        <TableSelectionButton
                          selected={selected}
                          disabled={!rowSelectable}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (rowSelectable) onToggleOne?.(item.id);
                          }}
                          ariaLabel={selected ? `Deselect billing occurrence for ${item.company.name}` : `Select billing occurrence for ${item.company.name}`}
                          title={rowSelectable ? undefined : 'Only open billing occurrences can be marked as billed'}
                        />
                      </td>
                    ) : null}
                    {visibleColumns.map((column) => <Cell key={column} item={item} column={column} canEdit={canEdit} onEdit={onEdit} />)}
                  </TableRow>
                );
              })}
            </TableBody>
          </TableRoot>
        </TableViewport>
      </TableShell>
    </>
  );
}
