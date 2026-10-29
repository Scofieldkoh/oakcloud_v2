'use client';

import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PaginationProps {
  /** Current page number (1-indexed) */
  page: number;
  /** Total number of pages */
  totalPages: number;
  /** Total number of records */
  total: number;
  /** Current page size */
  limit: number;
  /** Page change handler */
  onPageChange: (page: number) => void;
  /** Page size change handler */
  onLimitChange?: (limit: number) => void;
  /** Show/hide page size selector */
  showPageSize?: boolean;
  /** Show/hide jump-to-page input */
  showJumpToPage?: boolean;
  /** Additional class name */
  className?: string;
  /** Use 44px touch targets for dense mobile surfaces such as deadlines. */
  largeTouchTargets?: boolean;
  /** Optional page-size options for routes with a lower API limit. */
  pageSizeOptions?: readonly number[];
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200];

/**
 * Pagination - Table pagination component with page size selector
 *
 * Features:
 * - Compact page navigation with ellipsis for large page counts
 * - Inline jump-to-page input for fast navigation
 * - Page size selector
 * - "Showing X to Y of Z results" display
 * - Fully responsive layout
 *
 * @example
 * ```tsx
 * <Pagination
 *   page={data.page}
 *   totalPages={data.totalPages}
 *   total={data.total}
 *   limit={data.limit}
 *   onPageChange={setPage}
 *   onLimitChange={(newLimit) => {
 *     setLimit(newLimit);
 *     setPage(1);
 *   }}
 * />
 * ```
 */
export function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  onLimitChange,
  showPageSize = true,
  showJumpToPage = true,
  className,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  largeTouchTargets = false,
}: PaginationProps) {
  const pageSizeId = useId();
  const jumpInputId = useId();
  const [jumpPage, setJumpPage] = useState(String(page));

  useEffect(() => {
    setJumpPage(String(page));
  }, [page]);

  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  const getPageNumbers = (): (number | 'ellipsis')[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const pages: (number | 'ellipsis')[] = [1];

    if (page > 3) {
      pages.push('ellipsis');
    }

    const startPage = Math.max(2, page - 1);
    const endPage = Math.min(totalPages - 1, page + 1);

    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      pages.push(pageNumber);
    }

    if (page < totalPages - 2) {
      pages.push('ellipsis');
    }

    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();

  const goToPage = (nextPage: number) => {
    const maxPage = Math.max(1, totalPages);
    const clampedPage = Math.min(Math.max(nextPage, 1), maxPage);

    if (clampedPage !== page) {
      onPageChange(clampedPage);
    }

    setJumpPage(String(clampedPage));
  };

  const commitJumpPage = () => {
    const parsedPage = Number.parseInt(jumpPage, 10);

    if (Number.isNaN(parsedPage)) {
      setJumpPage(String(page));
      return;
    }

    goToPage(parsedPage);
  };

  const handleJumpSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    commitJumpPage();
  };

  const handleJumpKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setJumpPage(String(page));
      event.currentTarget.blur();
    }
  };

  return (
    <div className={cn('flex flex-col gap-4 px-4 py-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-text-secondary">
        <span>
          Showing {start} to {end} of {total.toLocaleString()} results
        </span>

        {showPageSize && onLimitChange && (
          <div className="flex items-center gap-2">
            <label htmlFor={pageSizeId} className="whitespace-nowrap">
              Per page:
            </label>
            <select
              id={pageSizeId}
              value={limit}
              onChange={(event) => onLimitChange(Number(event.target.value))}
              className={cn(largeTouchTargets ? 'min-h-11' : 'h-9', 'rounded-xl border border-border-primary bg-background-primary px-3 text-sm text-text-primary transition-colors hover:border-oak-primary/50 focus:outline-none focus:ring-2 focus:ring-oak-primary/20')}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-2xl bg-background-tertiary/80 p-1">
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page === 1}
            className={cn(
              cn('flex items-center justify-center rounded-xl transition-colors', largeTouchTargets ? 'min-h-11 min-w-11' : 'h-8 w-8'),
              page === 1
                ? 'cursor-not-allowed text-text-muted'
                : 'text-text-primary hover:bg-background-primary'
            )}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-1">
            {pageNumbers.map((pageNumber, index) => {
              if (pageNumber === 'ellipsis') {
                return (
                  <span key={`ellipsis-${index}`} className="px-1.5 text-sm text-text-muted">
                    ...
                  </span>
                );
              }

              return (
                <button
                  key={pageNumber}
                  type="button"
                  onClick={() => goToPage(pageNumber)}
                  className={cn(
                    largeTouchTargets ? 'min-h-11 min-w-11 rounded-xl px-2.5 text-sm font-medium transition-colors' : 'h-8 min-w-[32px] rounded-xl px-2.5 text-sm font-medium transition-colors',
                    pageNumber === page
                      ? 'bg-oak-primary text-white shadow-sm'
                      : 'text-text-secondary hover:bg-background-primary hover:text-text-primary'
                  )}
                  aria-label={`Go to page ${pageNumber}`}
                  aria-current={pageNumber === page ? 'page' : undefined}
                >
                  {pageNumber}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={totalPages <= 1 || page >= totalPages}
            className={cn(
              cn('flex items-center justify-center rounded-xl transition-colors', largeTouchTargets ? 'min-h-11 min-w-11' : 'h-8 w-8'),
              totalPages <= 1 || page >= totalPages
                ? 'cursor-not-allowed text-text-muted'
                : 'text-text-primary hover:bg-background-primary'
            )}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          {showJumpToPage && totalPages > 1 && (
            <>
              <div className="mx-1 hidden h-6 w-px bg-border-primary sm:block" />
              <form
                onSubmit={handleJumpSubmit}
                className="flex h-8 items-center gap-1.5 rounded-xl bg-background-primary px-2"
              >
                <label
                  htmlFor={jumpInputId}
                  className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.08em] text-text-muted"
                >
                  Pg
                </label>
                <input
                  id={jumpInputId}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={String(totalPages).length}
                  value={jumpPage}
                  onChange={(event) => {
                    const digitsOnly = event.target.value.replace(/\D/g, '');
                    setJumpPage(digitsOnly);
                  }}
                  onBlur={commitJumpPage}
                  onKeyDown={handleJumpKeyDown}
                  className="h-6 w-10 rounded-md border border-transparent bg-transparent px-1 text-center text-sm font-medium text-text-primary outline-none transition-colors focus:border-oak-primary/30 focus:bg-background-secondary"
                  aria-label={`Jump to page. Enter a number from 1 to ${totalPages}`}
                />
                <span className="text-xs font-medium text-text-muted">/ {totalPages}</span>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default Pagination;
