'use client';

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDateShort, cn } from '@/lib/utils';
import {
  FileText,
  Eye,
  Pencil,
  Trash2,
  Download,
  Clock,
  CheckCircle,
  Archive,
  Building2,
  User,
  RotateCcw,
  Square,
  CheckSquare,
  MinusSquare,
} from 'lucide-react';
import type { GeneratedDocumentStatus } from '@/generated/prisma';
import { PrefetchLink } from '@/components/ui/prefetch-link';
import { EmptyState } from '@/components/ui/empty-state';
import { MobileCard, CardDetailsGrid, CardDetailItem } from '@/components/ui/responsive-table';
import { TableBody, TableCell, TableEmptyState, TableFilterCell, TableFilterRow, TableHead, TableHeaderCell, TableHeaderRow, TableRoot, TableRow, TableSelectFilter, TableSelectionButton, TableShell, TableTextFilter, TableViewport } from '@/components/ui/data-table';
import { CompanySelect } from '@/components/ui/company-select';
import { DatePicker, type DatePickerValue } from '@/components/ui/date-picker';
import { useUserPreferences, useUpsertUserPreference } from '@/hooks/use-user-preferences';
import { useColumnResize } from '@/hooks/use-column-resize';
import { isActiveGenerationSessionMetadata } from '@/lib/document-generation-session';

// ============================================================================
// Types
// ============================================================================

export type GeneratedDocumentSortField =
  | 'title'
  | 'companyName'
  | 'templateName'
  | 'status'
  | 'signedAt'
  | 'createdByName'
  | 'createdAt'
  | 'updatedAt'
  | 'finalizedAt';

export type GeneratedDocumentSortOrder = 'asc' | 'desc';

export interface GeneratedDocumentFilters {
  title?: string;
  companyId?: string;
  companyName?: string;
  templateName?: string;
  status?: GeneratedDocumentStatus | '';
  createdBy?: string;
  signedFrom?: string;
  signedTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  sortBy?: GeneratedDocumentSortField;
  sortOrder?: GeneratedDocumentSortOrder;
}

export interface GeneratedDocument {
  id: string;
  title: string;
  status: GeneratedDocumentStatus;
  content: string;
  useLetterhead: boolean;
  createdAt: string;
  updatedAt: string;
  signedAt?: string | null;
  metadata?: unknown;
  finalizedAt?: string;
  template?: {
    id: string;
    name: string;
    category: string;
  } | null;
  company?: {
    id: string;
    name: string;
    uen: string;
  } | null;
  createdBy: {
    firstName: string;
    lastName: string;
  };
  _count?: {
    comments: number;
    drafts: number;
  };
}

interface DocumentTableProps {
  documents: GeneratedDocument[];
  /** Shown when there are no documents; defaults to a plain empty message with Generate Document. */
  emptyState?: ReactNode;
  onDelete?: (id: string) => void;
  onExport?: (id: string) => void;
  onDiscardDraft?: (id: string) => void;
  isLoading?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canExport?: boolean;
  canCreate?: boolean;
  filters?: GeneratedDocumentFilters;
  onFilterChange?: (patch: Partial<GeneratedDocumentFilters>) => void;
  onSortChange?: (field: GeneratedDocumentSortField) => void;
  /** Whether to show selection checkboxes */
  selectable?: boolean;
  /** Set of currently selected document IDs */
  selectedIds?: Set<string>;
  /** Handler for toggling a single item */
  onToggleOne?: (id: string) => void;
  /** Handler for toggling all items */
  onToggleAll?: () => void;
  /** Whether all items are selected */
  isAllSelected?: boolean;
  /** Whether some but not all items are selected */
  isIndeterminate?: boolean;
}

// ============================================================================
// Status Config
// ============================================================================

const statusConfig: Record<GeneratedDocumentStatus, { color: string; label: string; icon: typeof Clock }> = {
  DRAFT: { color: 'badge-warning', label: 'Draft', icon: Clock },
  FINALIZED: { color: 'badge-success', label: 'Finalized', icon: CheckCircle },
  ARCHIVED: { color: 'badge-neutral', label: 'Archived', icon: Archive },
};

const COLUMN_IDS = [
  'document',
  'company',
  'template',
  'status',
  'signedOn',
  'createdBy',
  'updated',
  'actions',
] as const;
type ColumnId = (typeof COLUMN_IDS)[number];

const COLUMN_LABELS: Record<ColumnId, string> = {
  document: 'Document',
  company: 'Company',
  template: 'Template',
  status: 'Status',
  signedOn: 'Signed On',
  createdBy: 'Created By',
  updated: 'Updated',
  actions: 'Actions',
};

const COLUMN_SORT_FIELDS: Partial<Record<ColumnId, GeneratedDocumentSortField>> = {
  document: 'title',
  company: 'companyName',
  template: 'templateName',
  status: 'status',
  signedOn: 'signedAt',
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

const COLUMN_PREF_KEY = 'generated-documents:list:columns:v1';
const DEFAULT_COLUMN_WIDTHS: Record<ColumnId, number> = {
  document: 616,
  company: 285,
  template: 330,
  status: 144,
  signedOn: 188,
  createdBy: 160,
  updated: 158,
  actions: 110,
};
const MINIMUM_COLUMN_WIDTHS: Record<ColumnId, number> = {
  document: 140,
  company: 120,
  template: 120,
  status: 100,
  signedOn: 110,
  createdBy: 110,
  updated: 110,
  actions: 80,
};

const CHECKBOX_COLUMN_WIDTH = 44;

function toLocalDateString(date?: Date): string | undefined {
  if (!date) return undefined;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value?: string): Date | undefined {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

// ============================================================================
// Small building blocks
// ============================================================================

// ============================================================================
// Action Icons Component
// ============================================================================

interface DocumentActionsProps {
  documentId: string;
  documentTitle: string;
  status: string;
  isGenerationSession: boolean;
  onDelete?: (id: string) => void;
  onExport?: (id: string) => void;
  onDiscardDraft?: (id: string) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  canExport?: boolean;
}

function DocumentActions({
  documentId,
  documentTitle,
  status,
  isGenerationSession,
  onDelete,
  onExport,
  onDiscardDraft,
  canEdit,
  canDelete,
  canExport,
}: DocumentActionsProps) {
  if (isGenerationSession) {
    return (
      <div className="flex items-center gap-1">
        {canEdit && (
          <Link
            href={`/generated-documents/generate?draft=${documentId}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-background-elevated text-text-tertiary hover:text-text-primary transition-colors"
            aria-label={`Resume ${documentTitle}`}
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
          </Link>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => onDiscardDraft?.(documentId)}
            className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-red-50 dark:hover:bg-red-950 text-text-tertiary hover:text-red-600 dark:hover:text-red-400 transition-colors"
            aria-label={`Discard ${documentTitle}`}
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {/* View */}
      <Link
        href={`/generated-documents/${documentId}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-background-elevated text-text-tertiary hover:text-text-primary transition-colors"
        aria-label={`View ${documentTitle}`}
      >
        <Eye className="w-4 h-4" aria-hidden="true" />
      </Link>

      {/* Edit (only for drafts) */}
      {canEdit && status === 'DRAFT' && (
        <Link
          href={`/generated-documents/${documentId}/edit`}
          className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-background-elevated text-text-tertiary hover:text-text-primary transition-colors"
          aria-label={`Edit ${documentTitle}`}
        >
          <Pencil className="w-4 h-4" aria-hidden="true" />
        </Link>
      )}

      {/* Export PDF */}
      {canExport && (
        <button
          type="button"
          onClick={() => onExport?.(documentId)}
          className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-background-elevated text-text-tertiary hover:text-text-primary transition-colors"
          aria-label={`Export ${documentTitle} as PDF`}
        >
          <Download className="w-4 h-4" aria-hidden="true" />
        </button>
      )}

      {/* Delete */}
      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete?.(documentId)}
          className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-red-50 dark:hover:bg-red-950 text-text-tertiary hover:text-red-600 dark:hover:text-red-400 transition-colors"
          aria-label={`Delete ${documentTitle}`}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Document Table Component
// ============================================================================

export function DocumentTable({
  documents,
  onDelete,
  onExport,
  onDiscardDraft,
  isLoading,
  canEdit = true,
  canDelete = true,
  canExport = true,
  canCreate = true,
  filters = {},
  onFilterChange,
  onSortChange,
  selectable = false,
  selectedIds = new Set(),
  onToggleOne,
  onToggleAll,
  isAllSelected = false,
  isIndeterminate = false,
  emptyState,
}: DocumentTableProps) {
  const router = useRouter();
  const emptyContent = emptyState ?? (
    <EmptyState
      icon={FileText}
      title="No documents found"
      actions={canCreate ? <Link href="/generated-documents/generate" className="btn-primary btn-sm inline-flex">Generate Document</Link> : undefined}
    />
  );
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

  const getDetailHref = useCallback((doc: GeneratedDocument) => {
    const isGenerationSession = isActiveGenerationSessionMetadata(doc.metadata);
    return isGenerationSession && canEdit
      ? `/generated-documents/generate?draft=${doc.id}`
      : `/generated-documents/${doc.id}`;
  }, [canEdit]);

  if (isLoading) {
    const skeletonColumns = ['Document', 'Company', 'Template', 'Status', 'Signed On', 'Created By', 'Updated', 'Actions'];
    return (
      <TableShell>
        <TableViewport>
          <TableRoot>
            <TableHead>
              <TableHeaderRow hasFilters={false}>
                {skeletonColumns.map((label) => (
                  <TableHeaderCell key={label} label={label} align={label === 'Actions' ? 'right' : 'left'} />
                ))}
              </TableHeaderRow>
            </TableHead>
            <TableBody>
              {Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index} index={index}>
                  {skeletonColumns.map((label) => (
                    <TableCell key={label} className={label === 'Actions' ? 'text-right' : undefined}>
                      <div className={`skeleton h-4 ${label === 'Document' ? 'w-48' : label === 'Company' ? 'w-32' : label === 'Actions' ? 'ml-auto w-24' : 'w-20'}`} />
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
      <div className="md:hidden space-y-3">
        {documents.length === 0 ? (
          <div className="card">{emptyContent}</div>
        ) : (
          <>
            {selectable && (
              <div className="flex items-center gap-2 px-1">
                <button
                  onClick={onToggleAll}
                  className="p-2 hover:bg-background-secondary rounded transition-colors flex items-center gap-2"
                  aria-label={isAllSelected ? 'Deselect all documents' : 'Select all documents'}
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
            {documents.map((doc, index) => {
              const status = statusConfig[doc.status] || statusConfig.DRAFT;
              const StatusIcon = status.icon;
              const isGenerationSession = isActiveGenerationSessionMetadata(doc.metadata);
              const isSelected = selectedIds.has(doc.id);

              return (
                <MobileCard
                  key={doc.id}
                  isSelected={isSelected}
                  selectable={selectable}
                  onToggle={() => onToggleOne?.(doc.id)}
                  selectionLabel={isSelected ? `Deselect ${doc.title}` : `Select ${doc.title}`}
                  title={doc.title}
                subtitle={doc.template?.name}
                badge={
                  <span className={cn('badge inline-flex items-center gap-1', status.color)}>
                    <StatusIcon className="w-3 h-3" />
                    {status.label}
                  </span>
                }
                onCardClick={() => router.push(getDetailHref(doc))}
                className={index % 2 === 1 ? 'bg-oak-row-alt' : undefined}
                details={
                  <CardDetailsGrid>
                    <CardDetailItem
                      label="Company"
                      value={doc.company?.name || '—'}
                      icon={<Building2 className="w-3 h-3" />}
                    />
                    <CardDetailItem
                      label="Signed On"
                      value={doc.signedAt ? formatDateShort(doc.signedAt) : '—'}
                      icon={<CheckCircle className="w-3 h-3" />}
                    />
                    <CardDetailItem
                      label="Created By"
                      value={`${doc.createdBy.firstName} ${doc.createdBy.lastName}`}
                      icon={<User className="w-3 h-3" />}
                    />
                    <CardDetailItem
                      label="Updated"
                      value={formatDateShort(doc.updatedAt)}
                      icon={<Clock className="w-3 h-3" />}
                    />
                  </CardDetailsGrid>
                }
                actions={
                  <div className="flex items-center gap-1">
                    {isGenerationSession && canEdit ? (
                      <Link
                        href={`/generated-documents/generate?draft=${doc.id}`}
                        className="p-2 rounded hover:bg-background-elevated text-text-tertiary hover:text-text-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                        aria-label={`Resume ${doc.title}`}
                      >
                        <RotateCcw className="w-4 h-4" aria-hidden="true" />
                      </Link>
                    ) : (
                      <Link
                        href={`/generated-documents/${doc.id}`}
                        className="p-2 rounded hover:bg-background-elevated text-text-tertiary hover:text-text-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                        aria-label={`View ${doc.title}`}
                      >
                        <Eye className="w-4 h-4" aria-hidden="true" />
                      </Link>
                    )}
                    {!isGenerationSession && canEdit && doc.status === 'DRAFT' && (
                      <Link
                        href={`/generated-documents/${doc.id}/edit`}
                        className="p-2 rounded hover:bg-background-elevated text-text-tertiary hover:text-text-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                        aria-label={`Edit ${doc.title}`}
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </Link>
                    )}
                    {!isGenerationSession && canExport && (
                      <button
                        type="button"
                        onClick={() => onExport?.(doc.id)}
                        className="p-2 rounded hover:bg-background-elevated text-text-tertiary hover:text-text-primary transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                        aria-label={`Export ${doc.title} as PDF`}
                      >
                        <Download className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => isGenerationSession ? onDiscardDraft?.(doc.id) : onDelete?.(doc.id)}
                        className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-950 text-text-tertiary hover:text-red-600 dark:hover:text-red-400 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                        aria-label={`${isGenerationSession ? 'Discard' : 'Delete'} ${doc.title}`}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                }
              />
            );
          })}
          </>
        )}
      </div>

      {/* Desktop Table View */}
      <TableShell className="hidden md:block">
        <TableViewport>
          <TableRoot>
          <colgroup>
            {selectable && <col style={{ width: `${CHECKBOX_COLUMN_WIDTH}px` }} />}
            {COLUMN_IDS.map((columnId) => (
              <col
                key={columnId}
                style={columnId === 'actions'
                  ? undefined
                  : { width: `${columnWidths[columnId] ?? DEFAULT_COLUMN_WIDTHS[columnId]}px` }}
              />
            ))}
          </colgroup>
          <TableHead>
            {/* Inline filter row - moved above headers */}
            <TableFilterRow>
              {selectable && <TableFilterCell className="w-11" />}
              {COLUMN_IDS.map((columnId) => (
                <TableFilterCell key={columnId}>
                  {columnId === 'document' ? (
                    <TableTextFilter
                      ariaLabel="Filter documents by title"
                      value={filters.title}
                      onChange={(value) => onFilterChange?.({ title: value })}
                    />
                  ) : columnId === 'company' ? (
                    <CompanySelect
                      value={filters.companyId || ''}
                      onChange={(companyId, company) => onFilterChange?.({
                        companyId: companyId || undefined,
                        companyName: company?.name || undefined,
                      })}
                      placeholder="All companies"
                      className="text-xs"
                      variant="table-filter"
                    />
                  ) : columnId === 'template' ? (
                    <TableTextFilter
                      ariaLabel="Filter documents by template"
                      value={filters.templateName}
                      onChange={(value) => onFilterChange?.({ templateName: value })}
                    />
                  ) : columnId === 'status' ? (
                    <TableSelectFilter
                      options={STATUS_FILTER_OPTIONS}
                      value={filters.status || ''}
                      onChange={(value) => onFilterChange?.({
                        status: value ? value as GeneratedDocumentStatus : undefined,
                      })}
                      placeholder="All statuses"
                      ariaLabel="All statuses"
                    />
                  ) : columnId === 'signedOn' ? (
                    <DatePicker
                      value={
                        filters.signedFrom || filters.signedTo
                          ? {
                              mode: 'range' as const,
                              range: {
                                from: parseLocalDate(filters.signedFrom),
                                to: parseLocalDate(filters.signedTo),
                              },
                            }
                          : undefined
                      }
                      onChange={(value: DatePickerValue | undefined) => {
                        const range = value?.mode === 'range' ? value.range : undefined;
                        onFilterChange?.({
                          signedFrom: toLocalDateString(range?.from),
                          signedTo: toLocalDateString(range?.to),
                        });
                      }}
                      placeholder="All dates"
                      size="sm"
                      defaultTab="range"
                      className="text-xs"
                      variant="table-filter"
                    />
                  ) : columnId === 'createdBy' ? (
                    <TableTextFilter
                      ariaLabel="Filter documents by creator"
                      value={filters.createdBy}
                      onChange={(value) => onFilterChange?.({ createdBy: value })}
                    />
                  ) : columnId === 'updated' ? (
                    <DatePicker
                      value={
                        filters.updatedFrom || filters.updatedTo
                          ? {
                              mode: 'range' as const,
                              range: {
                                from: parseLocalDate(filters.updatedFrom),
                                to: parseLocalDate(filters.updatedTo),
                              },
                            }
                          : undefined
                      }
                      onChange={(value: DatePickerValue | undefined) => {
                        const range = value?.mode === 'range' ? value.range : undefined;
                        onFilterChange?.({
                          updatedFrom: toLocalDateString(range?.from),
                          updatedTo: toLocalDateString(range?.to),
                        });
                      }}
                      placeholder="All dates"
                      size="sm"
                      defaultTab="range"
                      className="text-xs"
                      variant="table-filter"
                    />
                  ) : null}
                </TableFilterCell>
              ))}
            </TableFilterRow>

            {/* Column header row - below filters */}
            <TableHeaderRow>
              {selectable && (
                <TableHeaderCell className="w-11 px-2 text-center">
                  <TableSelectionButton
                    selected={isAllSelected}
                    indeterminate={isIndeterminate}
                    onClick={() => onToggleAll?.()}
                    ariaLabel={isAllSelected ? 'Deselect all documents' : 'Select all documents'}
                  />
                </TableHeaderCell>
              )}
              {COLUMN_IDS.map((columnId) => {
                const sortField = COLUMN_SORT_FIELDS[columnId];
                const sorted = Boolean(sortField && filters.sortBy === sortField);
                const isResizable = columnId !== 'actions';
                return (
                  <TableHeaderCell
                    key={columnId}
                    label={COLUMN_LABELS[columnId]}
                    align={columnId === 'actions' ? 'right' : 'left'}
                    sorted={sorted}
                    sortOrder={filters.sortOrder}
                    onSort={sortField && onSortChange ? () => onSortChange(sortField) : undefined}
                    resizable={isResizable}
                    onResizePointerDown={isResizable ? (event) => startResize(event, columnId) : undefined}
                    onResizeKeyDown={isResizable ? (event) => resizeWithKeyboard(event, columnId) : undefined}
                    resizeAriaLabel={`Resize ${COLUMN_LABELS[columnId]} column`}
                  />
                );
              })}
            </TableHeaderRow>
          </TableHead>
          <TableBody>
            {documents.length === 0 ? (
              <TableEmptyState colSpan={COLUMN_IDS.length + (selectable ? 1 : 0)} message={emptyContent} />
            ) : documents.map((doc, index) => {
                const status = statusConfig[doc.status] || statusConfig.DRAFT;
                const StatusIcon = status.icon;
                const isGenerationSession = isActiveGenerationSessionMetadata(doc.metadata);
                const isSelected = selectedIds.has(doc.id);

                return (
                  <TableRow
                    key={doc.id}
                    index={index}
                    selected={isSelected}
                    interactive
                    onActivate={() => router.push(getDetailHref(doc))}
                    aria-label={`Open ${doc.title}`}
                  >
                    {selectable && (
                      <td className="w-11 px-3 py-2">
                        <TableSelectionButton
                          selected={isSelected}
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleOne?.(doc.id);
                          }}
                          ariaLabel={isSelected ? `Deselect ${doc.title}` : `Select ${doc.title}`}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <PrefetchLink
                        href={getDetailHref(doc)}
                        className="font-medium text-text-primary hover:text-oak-light transition-colors"
                      >
                        {doc.title}
                      </PrefetchLink>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">
                      {doc.company ? (
                        <span className="truncate max-w-[200px] block">{doc.company.name}</span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-secondary max-w-0">
                      {doc.template ? (
                        <span className="truncate block" title={doc.template.name}>
                          {doc.template.name}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`badge ${status.color} inline-flex items-center gap-1`}>
                        <StatusIcon className="w-3 h-3" aria-hidden="true" />
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">
                      {doc.signedAt ? (
                        formatDateShort(doc.signedAt)
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-secondary">
                      {doc.createdBy.firstName} {doc.createdBy.lastName}
                    </td>
                    <td className="px-3 py-2 text-text-secondary">
                      {formatDateShort(doc.updatedAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DocumentActions
                        documentId={doc.id}
                        documentTitle={doc.title}
                        status={doc.status}
                        isGenerationSession={isGenerationSession}
                        onDelete={onDelete}
                        onExport={onExport}
                        onDiscardDraft={onDiscardDraft}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        canExport={canExport}
                      />
                    </td>
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
