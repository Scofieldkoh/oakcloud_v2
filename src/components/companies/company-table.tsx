'use client';

import { memo, useState, useCallback, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDateShort, formatCurrency, cn } from '@/lib/utils';
import { useColumnResize } from '@/hooks/use-column-resize';
import { getEntityTypeLabel, ENTITY_TYPES, COMPANY_STATUSES } from '@/lib/constants';
import { SUPPORTED_CURRENCIES } from '@/lib/validations/exchange-rate';
import { Building2, MoreHorizontal, ExternalLink, Pencil, Trash2, ArrowUpRight, AlertTriangle, Square, CheckSquare, MinusSquare } from 'lucide-react';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';
import { PrefetchLink } from '@/components/ui/prefetch-link';
import { EmptyState } from '@/components/ui/empty-state';
import { MobileCard, CardDetailsGrid, CardDetailItem } from '@/components/ui/responsive-table';
import { CompanySelect } from '@/components/ui/company-select';
import { DatePicker, type DatePickerValue } from '@/components/ui/date-picker';
import { AmountFilter, type AmountFilterValue } from '@/components/ui/amount-filter';
import { TableBody, TableCell, TableEmptyState, TableFilterCell, TableFilterRow, TableHead, TableHeaderCell, TableHeaderRow, TableRoot, TableRow, TableSelectFilter, TableSelectionButton, TableShell, TableTextFilter, TableViewport } from '@/components/ui/data-table';
import { buildDetailHref } from '@/lib/list-navigation';
import type { Company, CompanyStatus, EntityType } from '@/generated/prisma';

interface CompanyWithRelations extends Company {
  addresses?: Array<{
    id: string;
    addressType: string;
    fullAddress: string;
    isCurrent: boolean;
  }>;
  _count?: {
    documents: number;
    officers: number;
    shareholders: number;
    charges: number;
  };
  /** Whether any linked contact is marked as Point of Contact */
  hasPoc: boolean;
}

/** Month names for FYE filter */
const MONTH_NAMES = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

/** Inline filter values for the table */
export interface CompanyInlineFilters {
  companyId?: string;
  companyName?: string;
  address?: string;
  uen?: string;
  entityType?: EntityType;
  status?: CompanyStatus;
  incorporationDateFrom?: string;
  incorporationDateTo?: string;
  officersMin?: number;
  officersMax?: number;
  shareholdersMin?: number;
  shareholdersMax?: number;
  homeCurrency?: string;
  financialYearEndMonth?: number;
  paidUpCapitalMin?: number;
  paidUpCapitalMax?: number;
  issuedCapitalMin?: number;
  issuedCapitalMax?: number;
  hasWarnings?: boolean;
}

// Column definitions
const COLUMN_IDS = [
  'open',
  'warnings',
  'company',
  'address',
  'uen',
  'type',
  'status',
  'homeCurrency',
  'fye',
  'incorporated',
  'officers',
  'shareholders',
  'paidUpCapital',
  'issuedCapital',
  'actions',
] as const;
type ColumnId = (typeof COLUMN_IDS)[number];

const COLUMN_LABELS: Record<ColumnId, string> = {
  open: '',
  warnings: '',
  company: 'Company',
  address: 'Address',
  uen: 'UEN',
  type: 'Type',
  status: 'Status',
  incorporated: 'Incorporated',
  officers: 'Officers',
  shareholders: 'Shareholders',
  homeCurrency: 'Currency',
  fye: 'FYE',
  paidUpCapital: 'Paid-up Capital',
  issuedCapital: 'Issued Capital',
  actions: '',
};

const COLUMN_SORT_FIELDS: Partial<Record<ColumnId, string>> = {
  company: 'name',
  address: 'address',
  uen: 'uen',
  status: 'status',
  incorporated: 'incorporationDate',
  homeCurrency: 'homeCurrency',
  fye: 'financialYearEndMonth',
  officers: 'officersCount',
  shareholders: 'shareholdersCount',
  paidUpCapital: 'paidUpCapitalAmount',
  issuedCapital: 'issuedCapitalAmount',
};

const DEFAULT_COLUMN_WIDTHS: Partial<Record<ColumnId, number>> = {
  open: 44,
  warnings: 36,
  company: 424,
  address: 480,
  uen: 150,
  type: 243,
  status: 96,
  incorporated: 158,
  officers: 80,
  shareholders: 111,
  homeCurrency: 104,
  fye: 106,
  paidUpCapital: 130,
  issuedCapital: 130,
  actions: 50,
};

interface CompanyTableProps {
  companies: CompanyWithRelations[];
  returnTo: string;
  onDelete?: (id: string) => void;
  /** Whether data is being refetched (for opacity transition) */
  isFetching?: boolean;
  /** Function to check if user can edit a specific company, or boolean for all */
  canEdit?: boolean | ((companyId: string) => boolean);
  /** Function to check if user can delete a specific company, or boolean for all */
  canDelete?: boolean | ((companyId: string) => boolean);
  canCreate?: boolean;
  /** Whether to show selection checkboxes */
  selectable?: boolean;
  /** Set of currently selected company IDs */
  selectedIds?: Set<string>;
  /** Handler for toggling a single item */
  onToggleOne?: (id: string) => void;
  /** Handler for toggling all items */
  onToggleAll?: () => void;
  /** Whether all items are selected */
  isAllSelected?: boolean;
  /** Whether some but not all items are selected */
  isIndeterminate?: boolean;
  /** Current sort field */
  sortBy?: string;
  /** Current sort direction */
  sortOrder?: 'asc' | 'desc';
  /** Handler for sorting */
  onSort?: (field: string) => void;
  /** Current inline filter values */
  inlineFilters?: CompanyInlineFilters;
  /** Shown when there are no companies; defaults to a plain empty message with Add Company. */
  emptyState?: ReactNode;
  /** Handler for inline filter changes */
  onInlineFilterChange?: (filters: Partial<CompanyInlineFilters>) => void;
  /** Column widths for resizable columns */
  columnWidths?: Partial<Record<ColumnId, number>>;
  /** Handler for column width changes */
  onColumnWidthChange?: (columnId: ColumnId, width: number) => void;
}

/** Sortable column header backed by the shared table system. */
function SortableHeader({
  label,
  field,
  sortBy,
  sortOrder,
  onSort,
  width,
  onResize,
  onResizeKeyDown,
  columnId,
}: {
  label: string;
  field?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  width?: number;
  onResize?: (e: React.PointerEvent<HTMLElement>, columnId: ColumnId) => void;
  onResizeKeyDown?: (e: React.KeyboardEvent<HTMLElement>, columnId: ColumnId) => void;
  columnId: ColumnId;
}) {
  const isActive = Boolean(field && sortBy === field);
  const canSort = Boolean(field && onSort);
  const sortLabel = isActive
    ? `Sort by ${label}, currently ${sortOrder === 'asc' ? 'ascending' : 'descending'}`
    : `Sort by ${label}`;

  return (
    <TableHeaderCell
      style={width ? { width: `${width}px` } : undefined}
      label={label}
      sorted={isActive}
      sortOrder={sortOrder}
      onSort={canSort ? () => onSort?.(field!) : undefined}
      sortAriaLabel={sortLabel}
      resizable={Boolean(onResize)}
      onResizePointerDown={onResize ? (event) => onResize(event, columnId) : undefined}
      onResizeKeyDown={onResizeKeyDown ? (event) => onResizeKeyDown(event, columnId) : undefined}
      resizeAriaLabel={`Resize ${label || columnId} column`}
      className={columnId === 'actions' ? 'px-2' : undefined}
    />
  );
}

const statusConfig: Record<CompanyStatus, { color: string; label: string }> = {
  LIVE: { color: 'badge-success', label: 'Live' },
  STRUCK_OFF: { color: 'badge-error', label: 'Struck Off' },
  WINDING_UP: { color: 'badge-warning', label: 'Winding Up' },
  DISSOLVED: { color: 'badge-neutral', label: 'Dissolved' },
  IN_LIQUIDATION: { color: 'badge-warning', label: 'In Liquidation' },
  IN_RECEIVERSHIP: { color: 'badge-warning', label: 'In Receivership' },
  AMALGAMATED: { color: 'badge-info', label: 'Amalgamated' },
  CONVERTED: { color: 'badge-info', label: 'Converted' },
  OTHER: { color: 'badge-neutral', label: 'Other' },
};


interface CompanyActionsDropdownProps {
  companyId: string;
  detailHref: string;
  companyName?: string;
  onDelete?: (id: string) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

const CompanyActionsDropdown = memo(function CompanyActionsDropdown({ companyId, detailHref, companyName, onDelete, canEdit, canDelete }: CompanyActionsDropdownProps) {
  // If user can only view, don't show the dropdown at all - just provide the view link
  const hasAnyAction = canEdit || canDelete;

  if (!hasAnyAction) {
    return null;
  }

  return (
    <Dropdown>
      <DropdownTrigger asChild aria-label={`Actions for ${companyName || 'company'}`}>
        <button className="p-1 rounded hover:bg-background-elevated text-text-tertiary hover:text-text-primary transition-colors">
          <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
        </button>
      </DropdownTrigger>
      <DropdownMenu>
        <Link href={detailHref}>
          <DropdownItem icon={<ExternalLink className="w-4 h-4" />}>
            View Details
          </DropdownItem>
        </Link>
        {canEdit && (
          <Link href={`/companies/${companyId}/edit`}>
            <DropdownItem icon={<Pencil className="w-4 h-4" />}>
              Edit
            </DropdownItem>
          </Link>
        )}
        {canDelete && (
          <>
            <DropdownSeparator />
            <DropdownItem
              icon={<Trash2 className="w-4 h-4" />}
              destructive
              onClick={() => onDelete?.(companyId)}
            >
              Delete
            </DropdownItem>
          </>
        )}
      </DropdownMenu>
    </Dropdown>
  );
});

/**
 * Convert a Date to a local YYYY-MM-DD string.
 */
function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function CompanyTable({
  companies,
  returnTo,
  onDelete,
  isFetching,
  canEdit = true,
  canDelete = true,
  canCreate = true,
  selectable = false,
  selectedIds = new Set(),
  onToggleOne,
  onToggleAll,
  isAllSelected = false,
  isIndeterminate = false,
  sortBy,
  sortOrder,
  onSort,
  inlineFilters = {},
  onInlineFilterChange,
  columnWidths: externalColumnWidths,
  onColumnWidthChange,
  emptyState,
}: CompanyTableProps) {
  const router = useRouter();
  const emptyContent = emptyState ?? (
    <EmptyState
      icon={Building2}
      title="No companies found"
      actions={canCreate ? <Link href="/companies/new" className="btn-primary btn-sm inline-flex">Add Company</Link> : undefined}
    />
  );

  const handleRowClick = useCallback((
    event: MouseEvent<HTMLTableRowElement>,
    company: CompanyWithRelations,
  ) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest('a,button,input,select,textarea,[role="button"]')) return;

    router.push(buildDetailHref(`/companies/${company.id}`, returnTo));
  }, [returnTo, router]);

  // Internal column widths state (used if external not provided)
  const [internalColumnWidths, setInternalColumnWidths] = useState<Partial<Record<ColumnId, number>>>({});
  const savedColumnWidths: Partial<Record<ColumnId, number>> = externalColumnWidths ?? internalColumnWidths;
  const { liveWidths, startResize, resizeWithKeyboard } = useColumnResize<ColumnId>({
    getWidth: (columnId) => savedColumnWidths[columnId],
    getDefaultWidth: (columnId) => DEFAULT_COLUMN_WIDTHS[columnId] ?? 120,
    clampWidth: (width) => Math.max(30, width),
    onResizeEnd: (columnId, width) => {
      if (onColumnWidthChange) {
        onColumnWidthChange(columnId, width);
      } else {
        setInternalColumnWidths((prev) => ({ ...prev, [columnId]: width }));
      }
    },
  });
  const columnWidths = { ...savedColumnWidths, ...liveWidths };

  // Helper to check permission - supports both boolean and function
  const checkCanEdit = (companyId: string): boolean => {
    if (typeof canEdit === 'function') return canEdit(companyId);
    return canEdit;
  };

  const checkCanDelete = (companyId: string): boolean => {
    if (typeof canDelete === 'function') return canDelete(companyId);
    return canDelete;
  };

  // Note: Loading state is handled at the page level (shows spinner when isLoading && !data)
  // This component only renders when data exists, using isFetching for opacity dimming

  // Render filter cell for a column
  const renderFilterCell = (columnId: ColumnId) => {
    if (!onInlineFilterChange) return null;

    switch (columnId) {
      case 'open':
        return null;

      case 'warnings':
        return (
          <div className="flex items-center justify-center h-9">
            <button
              type="button"
              onClick={() => onInlineFilterChange({ hasWarnings: inlineFilters.hasWarnings ? undefined : true })}
              className={cn(
                'p-1 rounded transition-colors',
                inlineFilters.hasWarnings
                  ? 'text-amber-500 bg-amber-500/10'
                  : 'text-text-muted hover:text-text-secondary hover:bg-background-tertiary'
              )}
              title={inlineFilters.hasWarnings ? 'Showing companies with warnings (click to clear)' : 'Filter by warnings'}
            >
              <AlertTriangle className="w-4 h-4" />
            </button>
          </div>
        );

      case 'company':
        return (
          <CompanySelect
            value={inlineFilters.companyId || ''}
            onChange={(companyId, company) => onInlineFilterChange({
              companyId: companyId || undefined,
              companyName: company?.name || undefined,
            })}
            placeholder="All companies"
            className="text-xs"
            variant="table-filter"
          />
        );

      case 'address':
        return (
          <TableTextFilter
            ariaLabel="Filter companies by address"
            value={inlineFilters.address}
            onChange={(address) => onInlineFilterChange({ address })}
          />
        );

      case 'uen':
        return (
          <TableTextFilter
            ariaLabel="Filter companies by UEN"
            value={inlineFilters.uen}
            onChange={(uen) => onInlineFilterChange({ uen })}
          />
        );

      case 'type':
        return (
          <TableSelectFilter
            options={[
              { value: '', label: 'All' },
              ...ENTITY_TYPES.map(t => ({ value: t.value, label: t.shortLabel }))
            ]}
            value={inlineFilters.entityType || ''}
            onChange={(value) => onInlineFilterChange({ entityType: value as EntityType || undefined })}
            placeholder="All"
            ariaLabel="Filter companies by entity type"
          />
        );

      case 'status':
        return (
          <TableSelectFilter
            options={[
              { value: '', label: 'All' },
              ...COMPANY_STATUSES.map(s => ({ value: s.value, label: s.label }))
            ]}
            value={inlineFilters.status || ''}
            onChange={(value) => onInlineFilterChange({ status: value as CompanyStatus || undefined })}
            placeholder="All"
            ariaLabel="Filter companies by status"
          />
        );

      case 'incorporated':
        return (
          <DatePicker
            value={
              inlineFilters.incorporationDateFrom || inlineFilters.incorporationDateTo
                ? {
                    mode: 'range' as const,
                    range: {
                      from: inlineFilters.incorporationDateFrom ? new Date(inlineFilters.incorporationDateFrom) : undefined,
                      to: inlineFilters.incorporationDateTo ? new Date(inlineFilters.incorporationDateTo) : undefined,
                    }
                  }
                : undefined
            }
            onChange={(value: DatePickerValue | undefined) => {
              if (!value || value.mode !== 'range') {
                onInlineFilterChange({ incorporationDateFrom: undefined, incorporationDateTo: undefined });
              } else if (value.range) {
                onInlineFilterChange({
                  incorporationDateFrom: value.range.from ? toLocalDateString(value.range.from) : undefined,
                  incorporationDateTo: value.range.to ? toLocalDateString(value.range.to) : undefined,
                });
              }
            }}
            placeholder="All dates"
            size="sm"
            defaultTab="range"
            className="text-xs"
            variant="table-filter"
          />
        );

      case 'officers':
        return (
          <AmountFilter
            value={
              inlineFilters.officersMin !== undefined || inlineFilters.officersMax !== undefined
                ? {
                    mode: 'range',
                    range: {
                      from: inlineFilters.officersMin,
                      to: inlineFilters.officersMax,
                    }
                  }
                : undefined
            }
            onChange={(value: AmountFilterValue | undefined) => {
              if (!value) {
                onInlineFilterChange({ officersMin: undefined, officersMax: undefined });
              } else if (value.mode === 'single' && value.single !== undefined) {
                onInlineFilterChange({ officersMin: value.single, officersMax: value.single });
              } else if (value.mode === 'range' && value.range) {
                onInlineFilterChange({
                  officersMin: value.range.from,
                  officersMax: value.range.to,
                });
              }
            }}
            placeholder="All"
            size="sm"
            showChevron={false}
            variant="table-filter"
          />
        );

      case 'shareholders':
        return (
          <AmountFilter
            value={
              inlineFilters.shareholdersMin !== undefined || inlineFilters.shareholdersMax !== undefined
                ? {
                    mode: 'range',
                    range: {
                      from: inlineFilters.shareholdersMin,
                      to: inlineFilters.shareholdersMax,
                    }
                  }
                : undefined
            }
            onChange={(value: AmountFilterValue | undefined) => {
              if (!value) {
                onInlineFilterChange({ shareholdersMin: undefined, shareholdersMax: undefined });
              } else if (value.mode === 'single' && value.single !== undefined) {
                onInlineFilterChange({ shareholdersMin: value.single, shareholdersMax: value.single });
              } else if (value.mode === 'range' && value.range) {
                onInlineFilterChange({
                  shareholdersMin: value.range.from,
                  shareholdersMax: value.range.to,
                });
              }
            }}
            placeholder="All"
            size="sm"
            showChevron={false}
            variant="table-filter"
          />
        );

      case 'homeCurrency':
        return (
          <TableSelectFilter
            options={[
              { value: '', label: 'All' },
              ...SUPPORTED_CURRENCIES.map(currency => ({ value: currency, label: currency }))
            ]}
            value={inlineFilters.homeCurrency || ''}
            onChange={(value) => onInlineFilterChange({ homeCurrency: value || undefined })}
            placeholder="All"
            ariaLabel="Filter companies by home currency"
          />
        );

      case 'fye':
        return (
          <TableSelectFilter
            options={[
              { value: '', label: 'All' },
              ...MONTH_NAMES.map(month => ({ value: String(month.value), label: month.label.slice(0, 3) }))
            ]}
            value={inlineFilters.financialYearEndMonth ? String(inlineFilters.financialYearEndMonth) : ''}
            onChange={(value) => onInlineFilterChange({ financialYearEndMonth: value ? parseInt(value, 10) : undefined })}
            placeholder="All"
            ariaLabel="Filter companies by financial year end month"
          />
        );

      case 'paidUpCapital':
        return (
          <AmountFilter
            value={
              inlineFilters.paidUpCapitalMin !== undefined || inlineFilters.paidUpCapitalMax !== undefined
                ? {
                    mode: 'range',
                    range: {
                      from: inlineFilters.paidUpCapitalMin,
                      to: inlineFilters.paidUpCapitalMax,
                    }
                  }
                : undefined
            }
            onChange={(value: AmountFilterValue | undefined) => {
              if (!value) {
                onInlineFilterChange({ paidUpCapitalMin: undefined, paidUpCapitalMax: undefined });
              } else if (value.mode === 'single' && value.single !== undefined) {
                onInlineFilterChange({ paidUpCapitalMin: value.single, paidUpCapitalMax: value.single });
              } else if (value.mode === 'range' && value.range) {
                onInlineFilterChange({
                  paidUpCapitalMin: value.range.from,
                  paidUpCapitalMax: value.range.to,
                });
              }
            }}
            placeholder="All"
            size="sm"
            showChevron={false}
            variant="table-filter"
          />
        );

      case 'issuedCapital':
        return (
          <AmountFilter
            value={
              inlineFilters.issuedCapitalMin !== undefined || inlineFilters.issuedCapitalMax !== undefined
                ? {
                    mode: 'range',
                    range: {
                      from: inlineFilters.issuedCapitalMin,
                      to: inlineFilters.issuedCapitalMax,
                    }
                  }
                : undefined
            }
            onChange={(value: AmountFilterValue | undefined) => {
              if (!value) {
                onInlineFilterChange({ issuedCapitalMin: undefined, issuedCapitalMax: undefined });
              } else if (value.mode === 'single' && value.single !== undefined) {
                onInlineFilterChange({ issuedCapitalMin: value.single, issuedCapitalMax: value.single });
              } else if (value.mode === 'range' && value.range) {
                onInlineFilterChange({
                  issuedCapitalMin: value.range.from,
                  issuedCapitalMax: value.range.to,
                });
              }
            }}
            placeholder="All"
            size="sm"
            showChevron={false}
            variant="table-filter"
          />
        );

      default:
        return null;
    }
  };

  return (
    <>
      {/* Mobile Card View */}
      <div className={cn('lg:hidden space-y-3', isFetching && 'opacity-60')}>
        {selectable && (
          <div className="flex items-center gap-2 px-1">
            <button
              onClick={onToggleAll}
              className="p-2 hover:bg-background-secondary rounded transition-colors flex items-center gap-2"
              aria-label={isAllSelected ? 'Deselect all companies' : 'Select all companies'}
              aria-pressed={isAllSelected}
            >
              {isAllSelected ? (
                <CheckSquare className="w-5 h-5 text-oak-primary" aria-hidden="true" />
              ) : isIndeterminate ? (
                <MinusSquare className="w-5 h-5 text-oak-light" aria-hidden="true" />
              ) : (
                <Square className="w-5 h-5 text-text-muted" aria-hidden="true" />
              )}
              <span className="text-sm text-text-secondary">
                {isAllSelected ? 'Deselect all' : 'Select all'}
              </span>
            </button>
          </div>
        )}
        {companies.length === 0 ? (
          <div className="card">{emptyContent}</div>
        ) : (
          companies.map((company) => {
            const isSelected = selectedIds.has(company.id);
            const detailHref = buildDetailHref(`/companies/${company.id}`, returnTo);
            return (
              <MobileCard
                key={company.id}
                isSelected={isSelected}
                selectable={selectable}
                onToggle={() => onToggleOne?.(company.id)}
                title={
                  <PrefetchLink
                    href={detailHref}
                    prefetchType="company"
                    prefetchId={company.id}
                    className="font-medium text-text-primary hover:text-oak-light transition-colors block truncate"
                  >
                    {company.name}
                  </PrefetchLink>
                }
                subtitle={company.uen}
                badge={
                  <div className="flex items-center gap-2">
                    <span className={`badge ${statusConfig[company.status].color}`}>
                      {statusConfig[company.status].label}
                    </span>
                    {(company.financialYearEndMonth == null || company.hasPoc === false) && (
                      <span
                        className="text-amber-500"
                        title={[
                          company.financialYearEndMonth == null && 'Financial year end required',
                          company.hasPoc === false && 'Point of contact required',
                        ].filter(Boolean).join(', ')}
                      >
                        <AlertTriangle className="w-4 h-4" />
                      </span>
                    )}
                  </div>
                }
                selectionLabel={isSelected ? `Deselect ${company.name}` : `Select ${company.name}`}
                actions={
                  <CompanyActionsDropdown
                    companyId={company.id}
                    detailHref={detailHref}
                    companyName={company.name}
                    onDelete={onDelete}
                    canEdit={checkCanEdit(company.id)}
                    canDelete={checkCanDelete(company.id)}
                  />
                }
                onCardClick={() => router.push(detailHref)}
                details={
                  <CardDetailsGrid>
                    <CardDetailItem label="Type" value={getEntityTypeLabel(company.entityType, true)} />
                    <CardDetailItem label="Incorporated" value={formatDateShort(company.incorporationDate)} />
                    {company.addresses?.[0] && (
                      <CardDetailItem label="Address" value={company.addresses[0].fullAddress} fullWidth />
                    )}
                  </CardDetailsGrid>
                }
              />
            );
          })
        )}
      </div>

      {/* Desktop Table View */}
      <TableShell className="hidden lg:block" isFetching={isFetching}>
        <TableViewport>
          <TableRoot>
            <colgroup>
              {selectable && <col style={{ width: '40px' }} />}
              {COLUMN_IDS.map((id) => (
                <col
                  key={id}
                  style={
                    id === 'open'
                      ? { width: '44px' }
                      : columnWidths[id]
                        ? { width: `${columnWidths[id]}px` }
                        : undefined
                  }
                />
              ))}
            </colgroup>
            <TableHead>
              {/* Inline filter row */}
              {onInlineFilterChange && (
                <TableFilterRow>
                  {selectable && <TableFilterCell className="w-10" />}
                  {COLUMN_IDS.map((columnId) => (
                    <TableFilterCell
                      key={columnId}
                      className={columnId === 'open' || columnId === 'actions' ? 'px-2' : undefined}
                    >
                      {renderFilterCell(columnId)}
                    </TableFilterCell>
                  ))}
                </TableFilterRow>
              )}
              {/* Column header row */}
              <TableHeaderRow hasFilters={Boolean(onInlineFilterChange)}>
                {selectable && (
                  <TableHeaderCell className="w-10 text-center">
                    <TableSelectionButton
                      selected={isAllSelected}
                      indeterminate={isIndeterminate}
                      onClick={() => onToggleAll?.()}
                      ariaLabel={isAllSelected ? 'Deselect all companies' : 'Select all companies'}
                    />
                  </TableHeaderCell>
                )}
                {COLUMN_IDS.map((columnId) =>
                  columnId === 'open' ? (
                    <TableHeaderCell
                        key={columnId}
                        align="center"
                        className="w-[44px] px-2"
                        title="Open in new tab"
                      >
                        <ArrowUpRight className="inline-block h-4 w-4 text-text-muted" />
                      </TableHeaderCell>
                  ) : (
                    <SortableHeader
                      key={columnId}
                      label={COLUMN_LABELS[columnId]}
                      field={COLUMN_SORT_FIELDS[columnId]}
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={onSort}
                      width={columnWidths[columnId]}
                      onResize={columnId !== 'actions' ? startResize : undefined}
                      onResizeKeyDown={columnId !== 'actions' ? resizeWithKeyboard : undefined}
                      columnId={columnId}
                    />
                  )
                )}
              </TableHeaderRow>
            </TableHead>
            <TableBody>
              {companies.length === 0 ? (
                <TableEmptyState
                  colSpan={COLUMN_IDS.length + (selectable ? 1 : 0)}
                  message={emptyContent}
                />
              ) : (
                companies.map((company, index) => {
                  const isSelected = selectedIds.has(company.id);
                  const detailHref = buildDetailHref(`/companies/${company.id}`, returnTo);
                  return (
                    <TableRow
                      key={company.id}
                      index={index}
                      selected={isSelected}
                      interactive
                      onClick={(event) => handleRowClick(event, company)}
                    >
                      {selectable && (
                        <TableCell className="w-10">
                          <TableSelectionButton
                            selected={isSelected}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleOne?.(company.id);
                            }}
                            ariaLabel={isSelected ? `Deselect ${company.name}` : `Select ${company.name}`}
                          />
                        </TableCell>
                      )}
                      {/* Open in new tab */}
                      <td className="px-2 py-2">
                        <Link
                          href={detailHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-8 h-8 rounded hover:bg-background-tertiary text-text-secondary hover:text-text-primary transition-colors"
                          aria-label={`Open "${company.name}" in new tab`}
                          title={`Open "${company.name}" in new tab`}
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </Link>
                      </td>
                      {/* Warnings */}
                      <td className="px-1 py-2">
                        {(company.financialYearEndMonth == null || company.hasPoc === false) && (
                          <span
                            className="inline-flex items-center justify-center text-amber-500"
                            title={[
                              company.financialYearEndMonth == null && 'Financial year end required',
                              company.hasPoc === false && 'Point of contact required',
                            ].filter(Boolean).join(', ')}
                          >
                            <AlertTriangle className="w-4 h-4" />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-0">
                        <PrefetchLink
                          href={detailHref}
                          prefetchType="company"
                          prefetchId={company.id}
                          className="font-medium text-text-primary hover:text-oak-light transition-colors block truncate"
                        >
                          {company.name}
                        </PrefetchLink>
                      </td>
                      <td className="px-3 py-2 text-text-secondary max-w-0">
                        <span className="block truncate">
                          {company.addresses?.[0]?.fullAddress || '-'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary max-w-0">
                        <span className="block truncate">{company.uen}</span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary max-w-0">
                        <span className="block truncate">{getEntityTypeLabel(company.entityType, true)}</span>
                      </td>
                      <td className="px-3 py-2 max-w-0">
                        <span className={`badge ${statusConfig[company.status].color}`}>
                          {statusConfig[company.status].label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary max-w-0">
                        <span className="block truncate">{company.homeCurrency || '-'}</span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary max-w-0">
                        <span className="block truncate">
                          {company.financialYearEndMonth
                            ? `${company.financialYearEndDay || ''} ${MONTH_NAMES.find(m => m.value === company.financialYearEndMonth)?.label.slice(0, 3) || ''}`.trim() || '-'
                            : '-'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary max-w-0">
                        <span className="block truncate">{formatDateShort(company.incorporationDate)}</span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary max-w-0">
                        {company._count?.officers || 0}
                      </td>
                      <td className="px-3 py-2 text-text-secondary max-w-0">
                        {company._count?.shareholders || 0}
                      </td>
                      <td className="px-3 py-2 text-text-secondary max-w-0 text-right">
                        <span className="block truncate">
                          {company.paidUpCapitalAmount != null
                            ? formatCurrency(Number(company.paidUpCapitalAmount), company.paidUpCapitalCurrency || 'SGD')
                            : '-'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary max-w-0 text-right">
                        <span className="block truncate">
                          {company.issuedCapitalAmount != null
                            ? formatCurrency(Number(company.issuedCapitalAmount), company.issuedCapitalCurrency || 'SGD')
                            : '-'}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <CompanyActionsDropdown
                          companyId={company.id}
                          detailHref={detailHref}
                          companyName={company.name}
                          onDelete={onDelete}
                          canEdit={checkCanEdit(company.id)}
                          canDelete={checkCanDelete(company.id)}
                        />
                      </td>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </TableRoot>
        </TableViewport>
      </TableShell>
    </>
  );
}
