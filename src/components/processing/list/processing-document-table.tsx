'use client';

/** The desktop Document Processing table: header filters, resizable columns, rows and paging. */

import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
} from 'lucide-react';
import {
  type ProcessingDocumentSearchParams,
  type ProcessingDocumentListItem,
} from '@/hooks/use-processing-documents';
import { type ProcessingFilterValues } from '@/components/processing/processing-filters';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { CompanySelect } from '@/components/ui/company-select';
import { DatePicker } from '@/components/ui/date-picker';
import { AmountFilter } from '@/components/ui/amount-filter';
import { Pagination } from '@/components/ui/pagination';
import { TableBody, TableEmptyState, TableFilterCell, TableFilterRow, TableHead, TableHeaderCell, TableHeaderRow, TableRoot, TableRow, TableSelectionButton, TableShell, TableTextFilter, TableViewport } from '@/components/ui/data-table';
import type { PipelineStatus, DuplicateStatus, RevisionStatus, DocumentCategory, DocumentSubCategory } from '@/generated/prisma';
import { CATEGORY_LABELS, SUBCATEGORY_LABELS } from '@/lib/document-categories';
import { SUPPORTED_CURRENCIES } from '@/lib/validations/exchange-rate';
import { COLUMN_LABELS, COLUMN_SORT_FIELDS, type ColumnId, DEFAULT_COLUMN_WIDTHS, RIGHT_ALIGNED_COLUMNS, duplicateStatusConfig, pipelineStatusConfig, revisionStatusConfig, toLocalDateString } from '@/components/processing/list/processing-list-config';
import type { ReactNode, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ProcessingDocumentSearchResult } from '@/hooks/use-processing-documents';
import type { useAvailableTags } from '@/hooks/use-document-tags';

interface ProcessingDocumentTableProps {
  data: ProcessingDocumentSearchResult;
  isFetching: boolean;
  emptyState: ReactNode;
  params: ProcessingDocumentSearchParams;
  visibleColumnIds: ColumnId[];
  columnWidths: Partial<Record<ColumnId, number>>;
  startResize: (event: ReactPointerEvent<HTMLElement>, columnId: ColumnId) => void;
  resizeColumnByKeyboard: (event: ReactKeyboardEvent<HTMLElement>, columnId: ColumnId) => void;
  selectedIds: string[];
  selectionState: 'none' | 'partial' | 'all';
  tagsData: ReturnType<typeof useAvailableTags>['data'];
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  handleSort: (field: string) => void;
  handleFiltersChange: (filters: Partial<ProcessingFilterValues>) => void;
  handlePageChange: (page: number) => void;
  renderDesktopCell: (doc: ProcessingDocumentListItem, columnId: ColumnId) => ReactNode;
}

export function ProcessingDocumentTable({
  data,
  isFetching,
  emptyState,
  params,
  visibleColumnIds,
  columnWidths,
  startResize,
  resizeColumnByKeyboard,
  selectedIds,
  selectionState,
  tagsData,
  toggleSelect,
  toggleSelectAll,
  handleSort,
  handleFiltersChange,
  handlePageChange,
  renderDesktopCell,
}: ProcessingDocumentTableProps) {
  const router = useRouter();

  return (
    <TableShell className="relative hidden lg:block" isFetching={isFetching}>
      <TableViewport>
        <TableRoot>
          <colgroup>
            <col style={{ width: '40px' }} />
            {visibleColumnIds.map((id) => (
              <col
                key={id}
                style={
                  id === 'open'
                    ? { width: '44px' }
                    : (columnWidths[id] ?? DEFAULT_COLUMN_WIDTHS[id])
                      ? { width: `${columnWidths[id] ?? DEFAULT_COLUMN_WIDTHS[id]}px` }
                      : undefined
                }
              />
            ))}
          </colgroup>
          <TableHead>
            {/* Inline filter row - moved above headers */}
            <TableFilterRow>
              <TableFilterCell className="w-10" />
              {visibleColumnIds.map((columnId) => (
                <TableFilterCell key={columnId}>
                  {columnId === 'open' ? null : columnId === 'document' ? (
                    <TableTextFilter
                      ariaLabel="Filter documents by file name"
                      value={params.fileName}
                      onChange={(value) => handleFiltersChange({ fileName: value })}
                    />
                  ) : columnId === 'company' ? (
                    <CompanySelect
                      value={params.companyId || ''}
                      onChange={(companyId) => handleFiltersChange({ companyId: companyId || undefined })}
                      placeholder="All"
                      className="text-xs"
                      variant="table-filter"
                    />
                  ) : columnId === 'pipeline' ? (
                    <SearchableSelect
                      variant="table-filter"
                      options={[
                        { value: '', label: 'All' },
                        ...Object.entries(pipelineStatusConfig).map(([value, config]) => ({
                          value,
                          label: config.label
                        }))
                      ]}
                      value={params.pipelineStatus || ''}
                      onChange={(value) => handleFiltersChange({ pipelineStatus: value as PipelineStatus || undefined })}
                      placeholder="All"
                      className="text-xs"
                      showChevron={false}
                      showKeyboardHints={false}
                    />
                  ) : columnId === 'status' ? (
                    <SearchableSelect
                      variant="table-filter"
                      options={[
                        { value: '', label: 'All' },
                        ...Object.entries(revisionStatusConfig).map(([value, config]) => ({
                          value,
                          label: config.label
                        }))
                      ]}
                      value={params.revisionStatus || ''}
                      onChange={(value) => handleFiltersChange({ revisionStatus: value as RevisionStatus || undefined })}
                      placeholder="All"
                      className="text-xs"
                      showChevron={false}
                      showKeyboardHints={false}
                    />
                  ) : columnId === 'duplicate' ? (
                    <SearchableSelect
                      variant="table-filter"
                      options={[
                        { value: '', label: 'All' },
                        ...Object.entries(duplicateStatusConfig).map(([value, config]) => ({
                          value,
                          label: config.label
                        }))
                      ]}
                      value={params.duplicateStatus || ''}
                      onChange={(value) => handleFiltersChange({ duplicateStatus: value as DuplicateStatus || undefined })}
                      placeholder="All"
                      className="text-xs"
                      showChevron={false}
                      showKeyboardHints={false}
                    />
                  ) : columnId === 'tags' ? (
                    <SearchableSelect
                      variant="table-filter"
                      options={[
                        { value: '', label: 'All' },
                        ...tagsData?.map(tag => ({
                          value: tag.id,
                          label: tag.name
                        })) || []
                      ]}
                      value={params.tagIds?.[0] || ''}
                      onChange={(value) => handleFiltersChange({ tagIds: value ? [value] : undefined })}
                      placeholder="All"
                      className="text-xs"
                      showChevron={false}
                      showKeyboardHints={false}
                    />
                  ) : columnId === 'vendor' ? (
                    <TableTextFilter
                      ariaLabel="Filter documents by vendor"
                      value={params.vendorName}
                      onChange={(value) => handleFiltersChange({ vendorName: value })}
                    />
                  ) : columnId === 'docNumber' ? (
                    <TableTextFilter
                      ariaLabel="Filter documents by document number"
                      value={params.documentNumber}
                      onChange={(value) => handleFiltersChange({ documentNumber: value })}
                    />
                  ) : columnId === 'docDate' ? (
                    <DatePicker
                      value={
                        params.documentDateFrom || params.documentDateTo
                          ? {
                            mode: 'range' as const,
                            range: {
                              from: params.documentDateFrom ? new Date(params.documentDateFrom) : undefined,
                              to: params.documentDateTo ? new Date(params.documentDateTo) : undefined,
                            }
                          }
                          : undefined
                      }
                      onChange={(value) => {
                        if (!value || value.mode !== 'range') {
                          handleFiltersChange({ documentDateFrom: undefined, documentDateTo: undefined });
                        } else if (value.range) {
                          handleFiltersChange({
                            documentDateFrom: value.range.from ? toLocalDateString(value.range.from) : undefined,
                            documentDateTo: value.range.to ? toLocalDateString(value.range.to) : undefined,
                          });
                        }
                      }}
                      placeholder="All dates"
                      size="sm"
                      defaultTab="range"
                      className="text-xs"
                      variant="table-filter"
                    />
                  ) : columnId === 'uploaded' ? (
                    <DatePicker
                      value={
                        params.uploadDatePreset === 'TODAY'
                          ? {
                            mode: 'range' as const,
                            range: {
                              from: new Date(new Date().setHours(0, 0, 0, 0)),
                              to: new Date(new Date().setHours(23, 59, 59, 999)),
                            }
                          }
                          : params.uploadDateFrom || params.uploadDateTo
                            ? {
                              mode: 'range' as const,
                              range: {
                                from: params.uploadDateFrom ? new Date(params.uploadDateFrom) : undefined,
                                to: params.uploadDateTo ? new Date(params.uploadDateTo) : undefined,
                              }
                            }
                            : undefined
                      }
                      onChange={(value) => {
                        if (!value || value.mode !== 'range') {
                          handleFiltersChange({ uploadDateFrom: undefined, uploadDateTo: undefined, uploadDatePreset: undefined });
                        } else if (value.range) {
                          // Check if selected range is today
                          const today = new Date();
                          const todayStart = new Date(today.setHours(0, 0, 0, 0));
                          const _todayEnd = new Date(today.setHours(23, 59, 59, 999));
                          const selectedFrom = value.range.from ? new Date(value.range.from.setHours(0, 0, 0, 0)) : null;
                          const selectedTo = value.range.to ? new Date(value.range.to.setHours(0, 0, 0, 0)) : null;

                          const isToday = selectedFrom && selectedTo &&
                            selectedFrom.getTime() === todayStart.getTime() &&
                            selectedTo.getTime() === todayStart.getTime();

                          handleFiltersChange({
                            uploadDateFrom: value.range.from ? toLocalDateString(value.range.from) : undefined,
                            uploadDateTo: value.range.to ? toLocalDateString(value.range.to) : undefined,
                            uploadDatePreset: isToday ? 'TODAY' : undefined,
                          });
                        }
                      }}
                      placeholder="All dates"
                      size="sm"
                      defaultTab="range"
                      className="text-xs"
                      variant="table-filter"
                    />
                  ) : columnId === 'category' ? (
                    <SearchableSelect
                      variant="table-filter"
                      options={[
                        { value: '', label: 'All' },
                        ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
                          value,
                          label
                        }))
                      ]}
                      value={params.documentCategory || ''}
                      onChange={(value) => handleFiltersChange({ documentCategory: value as DocumentCategory || undefined })}
                      placeholder="All"
                      className="text-xs"
                      showChevron={false}
                      showKeyboardHints={false}
                    />
                  ) : columnId === 'subCategory' ? (
                    <SearchableSelect
                      variant="table-filter"
                      options={[
                        { value: '', label: 'All' },
                        ...Object.entries(SUBCATEGORY_LABELS).map(([value, label]) => ({
                          value,
                          label
                        }))
                      ]}
                      value={params.documentSubCategory || ''}
                      onChange={(value) => handleFiltersChange({ documentSubCategory: value as DocumentSubCategory || undefined })}
                      placeholder="All"
                      className="text-xs"
                      showChevron={false}
                      showKeyboardHints={false}
                    />
                  ) : columnId === 'currency' ? (
                    <SearchableSelect
                      variant="table-filter"
                      options={[
                        { value: '', label: 'All' },
                        ...SUPPORTED_CURRENCIES.map((code) => ({
                          value: code,
                          label: code
                        }))
                      ]}
                      value={params.currency || ''}
                      onChange={(value) => handleFiltersChange({ currency: value || undefined })}
                      placeholder="All"
                      className="text-xs"
                      showChevron={false}
                      showKeyboardHints={false}
                    />
                  ) : columnId === 'homeCurrency' ? (
                    <SearchableSelect
                      variant="table-filter"
                      options={[
                        { value: '', label: 'All' },
                        ...SUPPORTED_CURRENCIES.map((code) => ({
                          value: code,
                          label: code
                        }))
                      ]}
                      value={params.homeCurrency || ''}
                      onChange={(value) => handleFiltersChange({ homeCurrency: value || undefined })}
                      placeholder="All"
                      className="text-xs"
                      showChevron={false}
                      showKeyboardHints={false}
                    />
                  ) : columnId === 'subtotal' ? (
                    <AmountFilter
                      value={params.subtotal !== undefined ? { mode: 'single', single: params.subtotal } :
                        params.subtotalFrom !== undefined || params.subtotalTo !== undefined ?
                          { mode: 'range', range: { from: params.subtotalFrom, to: params.subtotalTo } } : undefined}
                      onChange={(value) => handleFiltersChange({ subtotalFilter: value })}
                      placeholder="All amounts"
                      size="sm"
                      className="text-xs"
                      showChevron={false}
                      variant="table-filter"
                    />
                  ) : columnId === 'tax' ? (
                    <AmountFilter
                      value={params.tax !== undefined ? { mode: 'single', single: params.tax } :
                        params.taxFrom !== undefined || params.taxTo !== undefined ?
                          { mode: 'range', range: { from: params.taxFrom, to: params.taxTo } } : undefined}
                      onChange={(value) => handleFiltersChange({ taxFilter: value })}
                      placeholder="All amounts"
                      size="sm"
                      className="text-xs"
                      showChevron={false}
                      variant="table-filter"
                    />
                  ) : columnId === 'total' ? (
                    <AmountFilter
                      value={params.total !== undefined ? { mode: 'single', single: params.total } :
                        params.totalFrom !== undefined || params.totalTo !== undefined ?
                          { mode: 'range', range: { from: params.totalFrom, to: params.totalTo } } : undefined}
                      onChange={(value) => handleFiltersChange({ totalFilter: value })}
                      placeholder="All amounts"
                      size="sm"
                      className="text-xs"
                      showChevron={false}
                      variant="table-filter"
                    />
                  ) : columnId === 'homeSubtotal' ? (
                    <AmountFilter
                      value={params.homeSubtotal !== undefined ? { mode: 'single', single: params.homeSubtotal } :
                        params.homeSubtotalFrom !== undefined || params.homeSubtotalTo !== undefined ?
                          { mode: 'range', range: { from: params.homeSubtotalFrom, to: params.homeSubtotalTo } } : undefined}
                      onChange={(value) => handleFiltersChange({ homeSubtotalFilter: value })}
                      placeholder="All amounts"
                      size="sm"
                      className="text-xs"
                      showChevron={false}
                      variant="table-filter"
                    />
                  ) : columnId === 'homeTax' ? (
                    <AmountFilter
                      value={params.homeTax !== undefined ? { mode: 'single', single: params.homeTax } :
                        params.homeTaxFrom !== undefined || params.homeTaxTo !== undefined ?
                          { mode: 'range', range: { from: params.homeTaxFrom, to: params.homeTaxTo } } : undefined}
                      onChange={(value) => handleFiltersChange({ homeTaxFilter: value })}
                      placeholder="All amounts"
                      size="sm"
                      className="text-xs"
                      showChevron={false}
                      variant="table-filter"
                    />
                  ) : columnId === 'homeTotal' ? (
                    <AmountFilter
                      value={params.homeTotal !== undefined ? { mode: 'single', single: params.homeTotal } :
                        params.homeTotalFrom !== undefined || params.homeTotalTo !== undefined ?
                          { mode: 'range', range: { from: params.homeTotalFrom, to: params.homeTotalTo } } : undefined}
                      onChange={(value) => handleFiltersChange({ homeTotalFilter: value })}
                      placeholder="All amounts"
                      size="sm"
                      className="text-xs"
                      showChevron={false}
                      variant="table-filter"
                    />
                  ) : null}
                </TableFilterCell>
              ))}
            </TableFilterRow>

            {/* Column header row - below filters */}
            <TableHeaderRow>
              <TableHeaderCell className="w-10 text-center">
                <TableSelectionButton
                  selected={selectionState === 'all'}
                  indeterminate={selectionState === 'partial'}
                  onClick={() => toggleSelectAll()}
                  ariaLabel={selectionState === 'all' ? 'Deselect all documents' : 'Select all documents'}
                />
              </TableHeaderCell>
              {visibleColumnIds.map((columnId) => {
                if (columnId === 'open') {
                  return (
                    <TableHeaderCell key={columnId} align="center" className="w-[44px]" title="Open in new tab">
                      <ArrowUpRight className="inline-block h-4 w-4 text-text-muted" />
                    </TableHeaderCell>
                  );
                }
                const sortField = COLUMN_SORT_FIELDS[columnId];
                const sorted = Boolean(sortField && params.sortBy === sortField);
                return (
                  <TableHeaderCell
                    key={columnId}
                    style={(columnWidths[columnId] ?? DEFAULT_COLUMN_WIDTHS[columnId]) ? { width: `${columnWidths[columnId] ?? DEFAULT_COLUMN_WIDTHS[columnId]}px` } : undefined}
                    label={COLUMN_LABELS[columnId]}
                    align={RIGHT_ALIGNED_COLUMNS.has(columnId) ? 'right' : 'left'}
                    sorted={sorted}
                    sortOrder={params.sortOrder}
                    onSort={sortField ? () => handleSort(sortField) : undefined}
                    sortAriaLabel={sortField ? `Sort by ${COLUMN_LABELS[columnId]}` : undefined}
                    resizable
                    onResizePointerDown={(event) => startResize(event, columnId)}
                    onResizeKeyDown={(event) => resizeColumnByKeyboard(event, columnId)}
                    resizeAriaLabel={`Resize ${COLUMN_LABELS[columnId]} column`}
                  />
                );
              })}
            </TableHeaderRow>
          </TableHead>
          <TableBody>
            {data.documents.length === 0 ? (
              <TableEmptyState colSpan={visibleColumnIds.length + 1} message={emptyState} />
            ) : (
              data.documents.map((doc, index) => {
                const isSelected = selectedIds.includes(doc.id);
                return (
                  <TableRow
                    key={doc.id}
                    index={index}
                    selected={isSelected}
                    interactive
                    onActivate={() => router.push(`/processing/${doc.id}`)}
                  >
                    <td className="w-10 px-3 py-2">
                      <TableSelectionButton
                        selected={isSelected}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSelect(doc.id);
                        }}
                        ariaLabel={isSelected ? `Deselect ${doc.document.fileName}` : `Select ${doc.document.fileName}`}
                      />
                    </td>
                    {visibleColumnIds.map((columnId) => renderDesktopCell(doc, columnId))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </TableRoot>
      </TableViewport>

      {/* Pagination */}
      {data.totalPages > 0 && (
        <div className="border-t border-border-primary">
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            limit={data.limit}
            onPageChange={handlePageChange}
            onLimitChange={(newLimit) => {
              handleFiltersChange({ limit: newLimit, page: 1 });
            }}
          />
        </div>
      )}
    </TableShell>
  );
}
