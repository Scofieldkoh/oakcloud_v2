'use client';

import { memo, useState, useCallback, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Users, MoreHorizontal, ExternalLink, Pencil, Trash2, Building2, ArrowUpRight, Square, CheckSquare, MinusSquare } from 'lucide-react';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';
import { PrefetchLink } from '@/components/ui/prefetch-link';
import { EmptyState } from '@/components/ui/empty-state';
import { useColumnResize } from '@/hooks/use-column-resize';
import { MobileCard, CardDetailsGrid, CardDetailItem } from '@/components/ui/responsive-table';
import { CountFilter, type CountFilterValue } from '@/components/ui/count-filter';
import { TableBody, TableCell, TableEmptyState, TableFilterCell, TableFilterRow, TableHead, TableHeaderCell, TableHeaderRow, TableRoot, TableRow, TableSelectFilter, TableSelectionButton, TableShell, TableTextFilter, TableViewport } from '@/components/ui/data-table';
import { buildDetailHref } from '@/lib/list-navigation';
import type { Contact, ContactType, IdentificationType } from '@/generated/prisma';

interface ContactWithCount extends Contact {
  _count?: {
    companyRelations: number;
  };
  /** Display email (default first, then company-specific fallback) */
  defaultEmail?: string | null;
  /** Display phone (default first, then company-specific fallback) */
  defaultPhone?: string | null;
}

/** Inline filter values for the table */
export interface ContactInlineFilters {
  fullName?: string;
  contactType?: ContactType;
  identificationType?: IdentificationType;
  identificationNumber?: string;
  nationality?: string;
  email?: string;
  phone?: string;
  companiesMin?: number;
  companiesMax?: number;
}

interface ContactTableProps {
  contacts: ContactWithCount[];
  returnTo: string;
  onDelete?: (id: string) => void;
  isLoading?: boolean;
  isFetching?: boolean;
  canEdit?: boolean | ((contactId: string) => boolean);
  canDelete?: boolean | ((contactId: string) => boolean);
  canCreate?: boolean;
  /** Enable selection mode */
  selectable?: boolean;
  /** Set of selected IDs */
  selectedIds?: Set<string>;
  /** Callback when selection changes */
  onToggleOne?: (id: string) => void;
  /** Callback when select all is toggled */
  onToggleAll?: () => void;
  /** Whether all items are selected */
  isAllSelected?: boolean;
  /** Whether some items are selected */
  isIndeterminate?: boolean;
  /** Current sort field */
  sortBy?: string;
  /** Current sort direction */
  sortOrder?: 'asc' | 'desc';
  /** Handler for sorting */
  onSort?: (field: string) => void;
  /** Inline filter values */
  inlineFilters?: ContactInlineFilters;
  /** Shown when there are no contacts; defaults to a plain empty message with Add Contact. */
  emptyState?: ReactNode;
  /** Handler for inline filter changes */
  onInlineFilterChange?: (filters: Partial<ContactInlineFilters>) => void;
  /** Persisted column widths */
  columnWidths?: Record<string, number>;
  /** Handler for column width changes */
  onColumnWidthChange?: (columnId: string, width: number) => void;
}

// Column definitions
const COLUMN_IDS = [
  'open',
  'name',
  'type',
  'idNumber',
  'nationality',
  'email',
  'phone',
  'companies',
  'actions',
] as const;
type ColumnId = (typeof COLUMN_IDS)[number];

const COLUMN_LABELS: Record<ColumnId, string> = {
  open: '',
  name: 'Name',
  type: 'Type',
  idNumber: 'ID Number',
  nationality: 'Nationality',
  email: 'Email',
  phone: 'Phone',
  companies: 'Companies',
  actions: '',
};

const COLUMN_SORT_FIELDS: Partial<Record<ColumnId, string>> = {
  name: 'fullName',
  type: 'contactType',
  nationality: 'nationality',
  companies: 'companyRelationsCount',
};

const DEFAULT_COLUMN_WIDTHS: Partial<Record<ColumnId, number>> = {
  open: 44,
  name: 347,
  type: 147,
  idNumber: 160,
  nationality: 206,
  email: 324,
  phone: 195,
  companies: 149,
  actions: 60,
};

const contactTypeConfig: Record<ContactType, { color: string; label: string }> = {
  INDIVIDUAL: { color: 'badge-info', label: 'Individual' },
  CORPORATE: { color: 'badge-neutral', label: 'Corporate' },
};

const idTypeLabels: Record<IdentificationType, string> = {
  NRIC: 'NRIC',
  FIN: 'FIN',
  PASSPORT: 'Passport',
  UEN: 'UEN',
  OTHER: 'Other',
};

const CONTACT_TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'CORPORATE', label: 'Corporate' },
];

interface ContactActionsDropdownProps {
  contactId: string;
  detailHref: string;
  contactName?: string;
  onDelete?: (id: string) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

const ContactActionsDropdown = memo(function ContactActionsDropdown({
  contactId,
  detailHref,
  contactName,
  onDelete,
  canEdit,
  canDelete,
}: ContactActionsDropdownProps) {
  const hasAnyAction = canEdit || canDelete;

  if (!hasAnyAction) {
    return null;
  }

  return (
    <Dropdown>
      <DropdownTrigger asChild aria-label={`Actions for ${contactName || 'contact'}`}>
        <button className="p-1 rounded hover:bg-background-elevated text-text-tertiary hover:text-text-primary transition-colors">
          <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
        </button>
      </DropdownTrigger>
      <DropdownMenu>
        <Link href={detailHref}>
          <DropdownItem icon={<ExternalLink className="w-4 h-4" />}>View Details</DropdownItem>
        </Link>
        {canEdit && (
          <Link href={`/contacts/${contactId}/edit`}>
            <DropdownItem icon={<Pencil className="w-4 h-4" />}>Edit</DropdownItem>
          </Link>
        )}
        {canDelete && (
          <>
            <DropdownSeparator />
            <DropdownItem
              icon={<Trash2 className="w-4 h-4" />}
              destructive
              onClick={() => onDelete?.(contactId)}
            >
              Delete
            </DropdownItem>
          </>
        )}
      </DropdownMenu>
    </Dropdown>
  );
});

export function ContactTable({
  contacts,
  returnTo,
  onDelete,
  isLoading,
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
}: ContactTableProps) {
  const router = useRouter();
  const emptyContent = emptyState ?? (
    <EmptyState
      icon={Users}
      title="No contacts found"
      actions={canCreate ? <Link href="/contacts/new" className="btn-primary btn-sm inline-flex">Add Contact</Link> : undefined}
    />
  );

  const handleRowClick = useCallback((
    event: MouseEvent<HTMLTableRowElement>,
    contact: ContactWithCount,
  ) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest('a,button,input,select,textarea,[role="button"]')) return;

    router.push(buildDetailHref(`/contacts/${contact.id}`, returnTo));
  }, [returnTo, router]);

  const checkCanEdit = (contactId: string): boolean => {
    if (typeof canEdit === 'function') return canEdit(contactId);
    return canEdit;
  };

  const checkCanDelete = (contactId: string): boolean => {
    if (typeof canDelete === 'function') return canDelete(contactId);
    return canDelete;
  };

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

  // Helper function to get ID display
  const getIdDisplay = (contact: ContactWithCount) => {
    if (contact.identificationNumber) {
      const prefix = contact.identificationType ? `${idTypeLabels[contact.identificationType]}: ` : '';
      return prefix + contact.identificationNumber;
    }
    if (contact.corporateUen) {
      return `UEN: ${contact.corporateUen}`;
    }
    return '-';
  };

  // Shared sortable/resizable table header.
  const renderHeaderCell = (columnId: ColumnId) => {
    const label = COLUMN_LABELS[columnId];
    const sortField = COLUMN_SORT_FIELDS[columnId];
    const isActive = Boolean(sortField && sortBy === sortField);
    const width = columnWidths[columnId];
    const canSort = Boolean(sortField && onSort);
    const isResizable = !['open', 'actions'].includes(columnId);
    const sortLabel = isActive
      ? `Sort by ${label}, currently ${sortOrder === 'asc' ? 'ascending' : 'descending'}`
      : `Sort by ${label}`;

    return (
      <TableHeaderCell
        key={columnId}
        style={width ? { width: `${width}px` } : undefined}
        label={label}
        sorted={isActive}
        sortOrder={sortOrder}
        onSort={canSort ? () => onSort?.(sortField!) : undefined}
        sortAriaLabel={sortLabel}
        resizable={isResizable}
        onResizePointerDown={isResizable ? (event) => startResize(event, columnId) : undefined}
        onResizeKeyDown={isResizable ? (event) => resizeWithKeyboard(event, columnId) : undefined}
        resizeAriaLabel={`Resize ${label || columnId} column`}
        className={columnId === 'actions' ? 'px-2' : undefined}
      />
    );
  };

  // Render filter cell for a column
  const renderFilterCell = (columnId: ColumnId) => {
    if (!onInlineFilterChange) return null;

    switch (columnId) {
      case 'open':
        return null;

      case 'name':
        return (
          <TableTextFilter
            ariaLabel="Filter contacts by name"
            value={inlineFilters.fullName}
            onChange={(fullName) => onInlineFilterChange({ fullName })}
          />
        );

      case 'type':
        return (
          <TableSelectFilter
            options={CONTACT_TYPE_OPTIONS}
            value={inlineFilters.contactType || ''}
            onChange={(value) => onInlineFilterChange({ contactType: value as ContactType || undefined })}
            placeholder="All"
            ariaLabel="Filter contacts by type"
          />
        );

      case 'idNumber':
        return (
          <TableTextFilter
            ariaLabel="Filter contacts by ID number"
            value={inlineFilters.identificationNumber}
            onChange={(identificationNumber) => onInlineFilterChange({ identificationNumber })}
          />
        );

      case 'nationality':
        return (
          <TableTextFilter
            ariaLabel="Filter contacts by nationality"
            value={inlineFilters.nationality}
            onChange={(nationality) => onInlineFilterChange({ nationality })}
          />
        );

      case 'email':
        return (
          <TableTextFilter
            ariaLabel="Filter contacts by email"
            value={inlineFilters.email}
            onChange={(email) => onInlineFilterChange({ email })}
          />
        );

      case 'phone':
        return (
          <TableTextFilter
            ariaLabel="Filter contacts by phone"
            value={inlineFilters.phone}
            onChange={(phone) => onInlineFilterChange({ phone })}
          />
        );

      case 'companies':
        return (
          <CountFilter
            value={{
              min: inlineFilters.companiesMin,
              max: inlineFilters.companiesMax,
            }}
            onChange={(value: CountFilterValue) =>
              onInlineFilterChange({ companiesMin: value.min, companiesMax: value.max })
            }
            placeholder="All"
            label="companies"
            size="sm"
            className="text-xs w-full min-w-0"
            variant="table-filter"
          />
        );

      case 'actions':
        return null;

      default:
        return null;
    }
  };

  if (isLoading) {
    const skeletonColumns = ['Open', 'Name', 'Type', 'ID Number', 'Nationality', 'Email', 'Phone', 'Companies', 'Actions'];
    return (
      <TableShell>
        <TableViewport>
          <TableRoot>
            <TableHead>
              <TableHeaderRow hasFilters={false}>
                {selectable ? <TableHeaderCell className="w-10"><div className="skeleton h-4 w-4" /></TableHeaderCell> : null}
                {skeletonColumns.map((label) => (
                  <TableHeaderCell key={label} label={label === 'Open' || label === 'Actions' ? undefined : label}>
                    {label === 'Open' || label === 'Actions' ? <span className="sr-only">{label}</span> : undefined}
                  </TableHeaderCell>
                ))}
              </TableHeaderRow>
            </TableHead>
            <TableBody>
              {Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index} index={index}>
                  {selectable ? <TableCell><div className="skeleton h-4 w-4" /></TableCell> : null}
                  {skeletonColumns.map((label) => (
                    <TableCell key={label}>
                      <div className={`skeleton h-4 ${label === 'Name' ? 'w-40' : label === 'Open' || label === 'Actions' ? 'w-8' : 'w-20'}`} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </TableRoot>
        </TableViewport>
      </TableShell>
    );
  }

  return (
    <>
      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        {selectable && contacts.length > 0 && (
          <div className="flex items-center gap-2 px-1">
            <button
              onClick={onToggleAll}
              className="p-2 hover:bg-background-secondary rounded transition-colors flex items-center gap-2"
              aria-label={isAllSelected ? 'Deselect all contacts' : 'Select all contacts'}
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
        {contacts.length === 0 ? (
          <div className="card">{emptyContent}</div>
        ) : (
          contacts.map((contact) => {
          const isSelected = selectedIds.has(contact.id);
          const detailHref = buildDetailHref(`/contacts/${contact.id}`, returnTo);
          return (
            <MobileCard
              key={contact.id}
              isSelected={isSelected}
              selectable={selectable}
              onToggle={() => onToggleOne?.(contact.id)}
              title={
                <PrefetchLink
                  href={detailHref}
                  prefetchType="contact"
                  prefetchId={contact.id}
                  className="font-medium text-text-primary hover:text-oak-light transition-colors block truncate"
                >
                  {contact.fullName}{contact.alias && `, ${contact.alias}`}
                </PrefetchLink>
              }
              subtitle={contact.nationality || getIdDisplay(contact)}
              badge={
                <span className={`badge ${contactTypeConfig[contact.contactType].color}`}>
                  {contactTypeConfig[contact.contactType].label}
                </span>
              }
              selectionLabel={isSelected ? `Deselect ${contact.fullName}` : `Select ${contact.fullName}`}
              actions={
                <ContactActionsDropdown
                  contactId={contact.id}
                  detailHref={detailHref}
                  contactName={contact.fullName}
                  onDelete={onDelete}
                  canEdit={checkCanEdit(contact.id)}
                  canDelete={checkCanDelete(contact.id)}
                />
              }
              onCardClick={() => router.push(detailHref)}
              details={
                <CardDetailsGrid>
                  {contact.defaultEmail && (
                    <CardDetailItem
                      label="Email"
                      value={<span className="truncate">{contact.defaultEmail}</span>}
                    />
                  )}
                  {contact.defaultPhone && (
                    <CardDetailItem
                      label="Phone"
                      value={contact.defaultPhone}
                    />
                  )}
                  <CardDetailItem
                    label="Companies"
                    value={
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>{contact._count?.companyRelations || 0}</span>
                      </div>
                    }
                  />
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
              {/* Inline filter row (above header) */}
              {onInlineFilterChange && (
                <TableFilterRow>
                  {selectable && <TableFilterCell className="w-10" />}
                  {COLUMN_IDS.map((columnId) => (
                    <TableFilterCell
                      key={columnId}
                      className={columnId === 'open' ? 'w-[44px] px-2' : columnId === 'actions' ? 'px-2' : undefined}
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
                      ariaLabel={isAllSelected ? 'Deselect all contacts' : 'Select all contacts'}
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
                    renderHeaderCell(columnId)
                  )
                )}
              </TableHeaderRow>
            </TableHead>
            <TableBody>
              {contacts.length === 0 ? (
                <TableEmptyState
                  colSpan={COLUMN_IDS.length + (selectable ? 1 : 0)}
                  message={emptyContent}
                />
              ) : (
                contacts.map((contact, index) => {
                  const isSelected = selectedIds.has(contact.id);
                  const detailHref = buildDetailHref(`/contacts/${contact.id}`, returnTo);
                  return (
                    <TableRow
                      key={contact.id}
                      index={index}
                      selected={isSelected}
                      interactive
                      onClick={(event) => handleRowClick(event, contact)}
                    >
                      {selectable && (
                        <td className="w-10 px-3 py-2">
                          <TableSelectionButton
                            selected={isSelected}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleOne?.(contact.id);
                            }}
                            ariaLabel={isSelected ? `Deselect ${contact.fullName}` : `Select ${contact.fullName}`}
                          />
                        </td>
                      )}
                      {/* Open in new tab */}
                      <td className="px-2 py-2">
                        <Link
                          href={detailHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-8 h-8 rounded hover:bg-background-tertiary text-text-secondary hover:text-text-primary transition-colors"
                          aria-label={`Open "${contact.fullName}" in new tab`}
                          title={`Open "${contact.fullName}" in new tab`}
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </Link>
                      </td>
                    {/* Name */}
                    <td className="px-3 py-2 max-w-0">
                      <PrefetchLink
                        href={detailHref}
                        prefetchType="contact"
                        prefetchId={contact.id}
                        className="font-medium text-text-primary hover:text-oak-light transition-colors block truncate"
                      >
                        {contact.fullName}{contact.alias && `, ${contact.alias}`}
                      </PrefetchLink>
                    </td>
                    {/* Type */}
                    <td className="px-3 py-2 max-w-0">
                      <span className={`badge ${contactTypeConfig[contact.contactType].color}`}>
                        {contactTypeConfig[contact.contactType].label}
                      </span>
                    </td>
                    {/* ID Number */}
                    <td className="px-3 py-2 text-text-secondary max-w-0">
                      {contact.identificationNumber ? (
                        <span className="block truncate">
                          {contact.identificationType && (
                            <span className="text-text-tertiary text-xs mr-1">
                              {idTypeLabels[contact.identificationType]}:
                            </span>
                          )}
                          {contact.identificationNumber}
                        </span>
                      ) : contact.corporateUen ? (
                        <span className="block truncate">
                          <span className="text-text-tertiary text-xs mr-1">UEN:</span>
                          {contact.corporateUen}
                        </span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    {/* Nationality */}
                    <td className="px-3 py-2 text-text-secondary max-w-0">
                      <span className="block truncate">{contact.nationality || '-'}</span>
                    </td>
                    {/* Email */}
                    <td className="px-3 py-2 text-text-secondary max-w-0">
                      {contact.defaultEmail ? (
                        <span className="truncate block" title={contact.defaultEmail}>
                          {contact.defaultEmail}
                        </span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    {/* Phone */}
                    <td className="px-3 py-2 text-text-secondary max-w-0">
                      {contact.defaultPhone ? (
                        <span className="block truncate">{contact.defaultPhone}</span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    {/* Companies */}
                    <td className="px-3 py-2 max-w-0">
                      <div className="flex items-center gap-1.5 text-text-secondary">
                        <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{contact._count?.companyRelations || 0}</span>
                      </div>
                    </td>
                    {/* Actions */}
                    <td className="px-2 py-2">
                      <ContactActionsDropdown
                        contactId={contact.id}
                        detailHref={detailHref}
                        contactName={contact.fullName}
                        onDelete={onDelete}
                        canEdit={checkCanEdit(contact.id)}
                        canDelete={checkCanDelete(contact.id)}
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
