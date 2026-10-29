'use client';

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { MoreHorizontal, Pencil, ExternalLink, AlertTriangle, History, Briefcase } from 'lucide-react';
import { useColumnResize } from '@/hooks/use-column-resize';
import { EmptyState } from '@/components/ui/empty-state';
import { MobileCard, CardDetailItem, CardDetailsGrid } from '@/components/ui/responsive-table';
import { Checkbox } from '@/components/ui/checkbox';
import { TableBody, TableEmptyState, TableFilterCell, TableFilterRow, TableHead, TableHeaderCell, TableHeaderRow, TableRoot, TableRow, TableShell, TableTextFilter, TableViewport } from '@/components/ui/data-table';
import { Dropdown, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown';
import { cn } from '@/lib/utils';
import type { ServiceRosterItem } from '@/services/service-roster';

export const SERVICE_ROSTER_COLUMNS = [
  'company',
  'family',
  'service',
  'status',
  'cadence',
  'nextDeadline',
  'startEnd',
  'warnings',
  'billing',
  'actions',
] as const;

export type ServiceRosterColumnId = (typeof SERVICE_ROSTER_COLUMNS)[number];
export type ServiceRosterSortBy = 'company' | 'family' | 'service' | 'status' | 'nextDeadline' | 'startDate';

export interface ServiceRosterColumnWidths {
  [key: string]: number | undefined;
}

export interface ServiceRosterInlineFilters {
  company?: string;
  family?: string;
  service?: string;
  status?: string;
  cadence?: string;
  nextDeadline?: string;
  startEnd?: string;
  warnings?: string;
  billing?: string;
}

interface ServiceRosterTableProps {
  items: ServiceRosterItem[];
  /** Replaces the default empty message, such as a ListEmptyState with Clear filters. */
  emptyState?: ReactNode;
  canEdit: boolean;
  canSelect: boolean;
  selectedIds: ReadonlySet<string>;
  selectionState: 'none' | 'partial' | 'all';
  onToggleSelectAll: () => void;
  onToggleSelect: (item: ServiceRosterItem) => void;
  isFetching?: boolean;
  sortBy: ServiceRosterSortBy;
  sortOrder: 'asc' | 'desc';
  onSort: (sortBy: ServiceRosterSortBy) => void;
  inlineFilters: ServiceRosterInlineFilters;
  onInlineFilterChange: (filters: Partial<ServiceRosterInlineFilters>) => void;
  columnWidths: ServiceRosterColumnWidths;
  columnOrder: ServiceRosterColumnId[];
  columnVisibility: Record<ServiceRosterColumnId, boolean>;
  onColumnWidthChange: (columnId: ServiceRosterColumnId, width: number) => void;
  onColumnResizeEnd: (columnId: ServiceRosterColumnId, width: number) => void;
  onEdit: (item: ServiceRosterItem) => void;
  onOpen: (item: ServiceRosterItem) => void;
  onTrigger?: (item: ServiceRosterItem) => void;
}

export const columnLabels: Record<ServiceRosterColumnId, string> = {
  company: 'Company',
  family: 'Family',
  service: 'Service',
  status: 'Status',
  cadence: 'Cadence',
  nextDeadline: 'Next deadline',
  startEnd: 'Start/end',
  warnings: 'Warnings',
  billing: 'Billing',
  actions: 'Actions',
};

export const defaultWidths: Record<ServiceRosterColumnId, number> = {
  company: 379,
  family: 216,
  service: 266,
  status: 100,
  cadence: 130,
  nextDeadline: 140,
  startEnd: 224,
  warnings: 120,
  billing: 170,
  actions: 82,
};

const SERVICE_SELECTION_COLUMN_WIDTH = 48;

const sortFields: Partial<Record<ServiceRosterColumnId, ServiceRosterSortBy>> = {
  company: 'company',
  family: 'family',
  service: 'service',
  status: 'status',
  nextDeadline: 'nextDeadline',
  startEnd: 'startDate',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatCadence(item: ServiceRosterItem): string {
  if (item.customCadenceLabel) return item.customCadenceLabel;
  return item.cadence.replaceAll('_', ' ').toLowerCase().replace(/^./, (value) => value.toUpperCase());
}

function statusClass(status: ServiceRosterItem['status']): string {
  if (status === 'ACTIVE') return 'badge-success';
  if (status === 'PAUSED') return 'badge-warning';
  return 'badge-neutral';
}

function statusLabel(status: ServiceRosterItem['status']): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function FamilyCell({ item }: { item: ServiceRosterItem }) {
  return (
    <span className="block max-w-full truncate text-sm text-text-primary" title={item.family.name}>
      {item.family.name}
    </span>
  );
}

function CompanyCell({ item }: { item: ServiceRosterItem }) {
  return (
    <div className="min-w-0" title={item.company.name}>
      <span className="block truncate font-medium text-text-primary">{item.company.name}</span>
    </div>
  );
}

function WarningCell({ item }: { item: ServiceRosterItem }) {
  const ruleWarning = item.hasRuleWarning ? (
    <span className="inline-flex items-center gap-1 text-status-warning" title={item.warning.reasons[0] ?? 'Review service configuration'}>
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="text-xs">Review</span>
    </span>
  ) : null;
  if (!ruleWarning) return <span className="text-text-muted">—</span>;
  return <div className="flex flex-col items-start gap-1">{ruleWarning}</div>;
}

function BillingIndicator({ item }: { item: ServiceRosterItem }) {
  if (!item.billingDisposition) return null;
  if (item.billingCoverageIssue) {
    const issueLabel = item.billingCoverageIssue.type === 'MISSING_START_DATE'
      ? 'Missing start'
      : item.billingCoverageIssue.type === 'MISSING_DISPOSITION'
        ? 'Missing disposition'
        : item.billingCoverageIssue.type.replaceAll('_', ' ').toLowerCase().replace(/^./, (value) => value.toUpperCase());
    return (
      <Link
        href={`/billing?serviceId=${encodeURIComponent(item.id)}`}
        aria-label={`Billing warning for ${item.serviceName}`}
        className="inline-flex min-h-11 items-center gap-1 text-status-warning hover:underline sm:min-h-8"
        title={item.billingCoverageIssue.type.replaceAll('_', ' ').toLowerCase()}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="text-xs">{issueLabel}</span>
      </Link>
    );
  }
  if (item.billingDisposition === 'NOT_REQUIRED') {
    return <span className="badge badge-neutral" aria-label="Billing: no billing required">No billing required</span>;
  }
  if (item.billingDisposition === 'UNREVIEWED') {
    return <Link href={`/billing?serviceId=${encodeURIComponent(item.id)}`} className="badge badge-warning" aria-label="Billing: missing disposition">Missing disposition</Link>;
  }
  if (!item.nextBilling) return <span className="badge badge-success" aria-label="Billing: configured">Covered</span>;
  if (item.nextBilling.status === 'BILLED') return <span className="badge badge-success" aria-label="Billing: billed">Billed</span>;
  const timingLabel = item.nextBilling.timingState ?? 'UPCOMING';
  const timingStateLabel = timingLabel.charAt(0) + timingLabel.slice(1).toLowerCase();
  return <span className="badge badge-success" aria-label={`Billing: open, ${timingStateLabel.toLowerCase()}`}>Open · {timingStateLabel}</span>;
}

function ServiceActions({ item, canEdit, onEdit, onTrigger }: { item: ServiceRosterItem; canEdit: boolean; onEdit: (item: ServiceRosterItem) => void; onTrigger?: (item: ServiceRosterItem) => void }) {
  const companyHref = `/companies/${item.companyId}?tab=services`;
  return (
    <Dropdown>
      <DropdownTrigger asChild aria-label={`Actions for ${item.serviceName}`}>
        <button type="button" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-text-tertiary hover:bg-background-tertiary hover:text-text-primary sm:min-h-8 sm:min-w-8">
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownTrigger>
      <DropdownMenu>
        <Link href={companyHref}>
          <DropdownItem icon={<ExternalLink className="h-4 w-4" />}>View company Services</DropdownItem>
        </Link>
        {canEdit ? (
          <>
            <DropdownSeparator />
            {onTrigger ? <DropdownItem icon={<History className="h-4 w-4" />} onClick={() => onTrigger(item)}>Trigger historical cycle</DropdownItem> : null}
            <DropdownItem icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(item)}>Edit service</DropdownItem>
          </>
        ) : null}
      </DropdownMenu>
    </Dropdown>
  );
}

function InlineFilterRow({ columns, canSelect, filters, onChange }: { columns: ServiceRosterColumnId[]; canSelect: boolean; filters: ServiceRosterInlineFilters; onChange: (filters: Partial<ServiceRosterInlineFilters>) => void }) {
  return (
    <TableFilterRow>
      {canSelect ? <TableFilterCell className="w-12 px-2" aria-hidden="true" /> : null}
      {columns.map((column) => (
        <TableFilterCell key={column}>
          {column === 'actions' ? null : (
            <TableTextFilter
              ariaLabel={`Filter ${columnLabels[column]}`}
              value={filters[column]}
              onChange={(value) => onChange({ [column]: value })}
            />
          )}
        </TableFilterCell>
      ))}
    </TableFilterRow>
  );
}

function DesktopCell({ item, column, canEdit, onEdit, onTrigger }: { item: ServiceRosterItem; column: ServiceRosterColumnId; canEdit: boolean; onEdit: (item: ServiceRosterItem) => void; onTrigger?: (item: ServiceRosterItem) => void }) {
  switch (column) {
    case 'company': return <td className="max-w-0 px-3 py-2 align-middle"><CompanyCell item={item} /></td>;
    case 'family': return <td className="max-w-0 px-3 py-2 align-middle"><FamilyCell item={item} /></td>;
    case 'service': return <td className="max-w-0 px-3 py-2 align-middle"><span className="block truncate text-sm text-text-primary" title={item.serviceName}>{item.serviceName}</span></td>;
    case 'status': return <td className="px-3 py-2 align-middle"><span className={cn('badge', statusClass(item.status))}>{statusLabel(item.status)}</span></td>;
    case 'cadence': return <td className="px-3 py-2 align-middle text-sm text-text-secondary">{formatCadence(item)}</td>;
    case 'nextDeadline': return <td className="px-3 py-2 align-middle text-sm text-text-secondary">{formatDate(item.nextDeadline?.operativeDueDate ?? null)}</td>;
    case 'startEnd': return <td className="px-3 py-2 align-middle text-sm text-text-secondary"><span className="whitespace-nowrap">{formatDate(item.startDate)}</span><span className="mx-1 text-text-muted">–</span><span className="whitespace-nowrap">{formatDate(item.endDate)}</span></td>;
    case 'warnings': return <td className="px-3 py-2 align-middle"><WarningCell item={item} /></td>;
    case 'billing': return <td className="px-3 py-2 align-middle"><BillingIndicator item={item} /></td>;
    case 'actions': return <td className="px-3 py-2 align-middle"><ServiceActions item={item} canEdit={canEdit} onEdit={onEdit} onTrigger={onTrigger} /></td>;
  }
}

function DesktopRow({ item, index, columns, canEdit, canSelect, isSelected, onToggleSelect, onEdit, onOpen, onTrigger }: { item: ServiceRosterItem; index: number; columns: ServiceRosterColumnId[]; canEdit: boolean; canSelect: boolean; isSelected: boolean; onToggleSelect: (item: ServiceRosterItem) => void; onEdit: (item: ServiceRosterItem) => void; onOpen: (item: ServiceRosterItem) => void; onTrigger?: (item: ServiceRosterItem) => void }) {
  return (
    <TableRow
      index={index}
      selected={isSelected}
      interactive
      onActivate={() => onOpen(item)}
      aria-label={`View ${item.serviceName} for ${item.company.name}`}
      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oak-primary/30"
    >
      {canSelect ? (
        <td className="w-12 px-2 text-center align-middle">
          <div className="flex justify-center">
            <Checkbox
              checked={isSelected}
              onChange={() => onToggleSelect(item)}
              aria-label={`Select ${item.serviceName} for ${item.company.name}`}
              size="sm"
            />
          </div>
        </td>
      ) : null}
      {columns.map((column) => <DesktopCell key={column} item={item} column={column} canEdit={canEdit} onEdit={onEdit} onTrigger={onTrigger} />)}
    </TableRow>
  );
}

function MobileRosterCard({ item, canEdit, canSelect, isSelected, onToggleSelect, onEdit, onOpen, onTrigger }: { item: ServiceRosterItem; canEdit: boolean; canSelect: boolean; isSelected: boolean; onToggleSelect: (item: ServiceRosterItem) => void; onEdit: (item: ServiceRosterItem) => void; onOpen: (item: ServiceRosterItem) => void; onTrigger?: (item: ServiceRosterItem) => void }) {
  return (
    <MobileCard
      selectable={canSelect}
      isSelected={isSelected}
      onToggle={() => onToggleSelect(item)}
      selectionLabel={`Select ${item.serviceName} for ${item.company.name}`}
      title={<CompanyCell item={item} />}
      subtitle={<span title={item.serviceName}>{item.serviceName}</span>}
      badge={<span className={cn('badge', statusClass(item.status))}>{statusLabel(item.status)}</span>}
      actions={<ServiceActions item={item} canEdit={canEdit} onEdit={onEdit} onTrigger={onTrigger} />}
      onCardClick={() => onOpen(item)}
      details={(
        <CardDetailsGrid>
          <CardDetailItem label="Family" value={<FamilyCell item={item} />} />
          <CardDetailItem label="Cadence" value={formatCadence(item)} />
          <CardDetailItem label="Next deadline" value={formatDate(item.nextDeadline?.operativeDueDate ?? null)} />
          <CardDetailItem label="Start/end" value={`${formatDate(item.startDate)} – ${formatDate(item.endDate)}`} />
          <CardDetailItem label="Warnings" value={<WarningCell item={item} />} />
          <CardDetailItem label="Billing" value={<BillingIndicator item={item} />} fullWidth />
        </CardDetailsGrid>
      )}
    />
  );
}

export function ServiceRosterTable({
  items,
  canEdit,
  canSelect,
  selectedIds,
  selectionState,
  onToggleSelectAll,
  onToggleSelect,
  isFetching,
  sortBy,
  sortOrder,
  onSort,
  inlineFilters,
  onInlineFilterChange,
  columnWidths,
  columnOrder,
  columnVisibility,
  onColumnWidthChange,
  onColumnResizeEnd,
  onEdit,
  onOpen,
  onTrigger,
  emptyState,
}: ServiceRosterTableProps) {
  const emptyContent = emptyState ?? <EmptyState icon={Briefcase} title="No services found" />;
  const visibleColumns = useMemo(() => columnOrder.filter((column) => columnVisibility[column]), [columnOrder, columnVisibility]);
  const { startResize, resizeWithKeyboard } = useColumnResize<ServiceRosterColumnId>({
    getWidth: (columnId) => columnWidths[columnId],
    getDefaultWidth: (columnId) => defaultWidths[columnId],
    clampWidth: (width) => Math.min(800, Math.max(96, Math.round(width))),
    onResize: (columnId, width) => onColumnWidthChange(columnId, width),
    onResizeEnd: (columnId, width) => onColumnResizeEnd(columnId, width),
  });

  return (
    <>
      <div className="space-y-3 md:hidden" aria-label="Services roster cards">
        {canSelect ? (
          <div className="flex items-center gap-2 px-1 text-sm text-text-secondary">
            <Checkbox
              size="sm"
              checked={selectionState === 'all'}
              indeterminate={selectionState === 'partial'}
              onChange={onToggleSelectAll}
              aria-label="Select all services"
            />
            <span>Select all visible services</span>
          </div>
        ) : null}
        {items.length === 0 ? <div className="rounded-xl border border-border-primary bg-background-secondary">{emptyContent}</div> : items.map((item) => <MobileRosterCard key={item.id} item={item} canEdit={canEdit} canSelect={canSelect} isSelected={selectedIds.has(item.id)} onToggleSelect={onToggleSelect} onEdit={onEdit} onOpen={onOpen} onTrigger={onTrigger} />)}
      </div>
      <TableShell className="hidden md:block" isFetching={isFetching}>
        <TableViewport>
          <TableRoot aria-label="Services roster table">
          <colgroup>
            {canSelect ? <col style={{ width: `${SERVICE_SELECTION_COLUMN_WIDTH}px` }} /> : null}
            {visibleColumns.map((columnId) => <col key={columnId} style={columnId === 'actions' ? undefined : { width: `${columnWidths[columnId] ?? defaultWidths[columnId]}px` }} />)}
          </colgroup>
          <TableHead>
            <InlineFilterRow columns={visibleColumns} canSelect={canSelect} filters={inlineFilters} onChange={onInlineFilterChange} />
            <TableHeaderRow>
              {canSelect ? (
                <TableHeaderCell className="w-12 px-2 text-center">
                  <Checkbox
                    checked={selectionState === 'all'}
                    indeterminate={selectionState === 'partial'}
                    onChange={onToggleSelectAll}
                    aria-label="Select all services"
                    size="sm"
                  />
                </TableHeaderCell>
              ) : null}
              {visibleColumns.map((columnId) => {
                const field = sortFields[columnId];
                const active = field === sortBy;
                return (
                  <TableHeaderCell
                    key={columnId}
                    label={columnLabels[columnId]}
                    sorted={active}
                    sortOrder={sortOrder}
                    onSort={field ? () => onSort(field) : undefined}
                    sortAriaLabel={field ? (active ? `Sort by ${columnLabels[columnId]}, currently ${sortOrder === 'asc' ? 'ascending' : 'descending'}` : `Sort by ${columnLabels[columnId]}`) : undefined}
                    resizable={columnId !== 'actions'}
                    onResizePointerDown={columnId !== 'actions' ? (event) => startResize(event, columnId) : undefined}
                    onResizeKeyDown={columnId !== 'actions' ? (event) => resizeWithKeyboard(event, columnId) : undefined}
                    resizeAriaLabel={`Resize ${columnLabels[columnId]} column`}
                  />
                );
              })}
            </TableHeaderRow>
          </TableHead>
          <TableBody>
            {items.length === 0 ? (
              <TableEmptyState colSpan={visibleColumns.length + (canSelect ? 1 : 0)} message={emptyContent} />
            ) : items.map((item, index) => <DesktopRow key={item.id} item={item} index={index} columns={visibleColumns} canEdit={canEdit} canSelect={canSelect} isSelected={selectedIds.has(item.id)} onToggleSelect={onToggleSelect} onEdit={onEdit} onOpen={onOpen} onTrigger={onTrigger} />)}
          </TableBody>
          </TableRoot>
        </TableViewport>
      </TableShell>
    </>
  );
}
