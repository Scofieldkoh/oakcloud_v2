'use client';

import {
  useEffect,
  useId,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckSquare,
  MinusSquare,
  Square,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { TABLE_FILTER_NATIVE_INPUT_CLASS } from '@/components/ui/table-filter-styles';

export const TABLE_INTERACTIVE_TARGET_SELECTOR =
  'a,button,input,select,textarea,label,[role="button"],[role="menuitem"],[role="separator"],[data-prevent-row-click="true"]';

export type TableSortOrder = 'asc' | 'desc';

/**
 * True when a click or key press on a clickable row or card belongs to a
 * control inside it rather than to the row itself. Pass the row as
 * `container` so events from menus and dialogs portalled out of the row
 * (which React still bubbles through it) never activate the row.
 */
export function isTableInteractiveTarget(
  target: EventTarget | null,
  container?: Element | null,
  selector: string = TABLE_INTERACTIVE_TARGET_SELECTOR,
): boolean {
  // Element, not HTMLElement: clicks on an icon inside a button land on its
  // SVG, which must still count as a click on the button.
  if (!(target instanceof Element)) return false;
  if (container && !container.contains(target)) return true;
  return Boolean(target.closest(selector));
}

export function isPlainTableRowClick(event: MouseEvent<HTMLElement>): boolean {
  return (
    !event.defaultPrevented
    && event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && !isTableInteractiveTarget(event.target, event.currentTarget)
  );
}

interface TableShellProps extends HTMLAttributes<HTMLDivElement> {
  isFetching?: boolean;
}

export function TableShell({
  isFetching = false,
  className,
  children,
  ...props
}: TableShellProps) {
  return (
    <div
      className={cn(
        'table-container w-full min-w-0 max-w-full overflow-hidden',
        isFetching && 'opacity-60',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TableViewport({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('w-full overflow-x-auto', className)} {...props}>
      {children}
    </div>
  );
}

export function TableRoot({
  className,
  children,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn('w-full min-w-max border-collapse text-sm [&_tbody>tr>td]:px-3 [&_tbody>tr>td]:py-2 [&_tbody>tr>td]:text-sm [&_tbody>tr>td]:text-text-primary', className)}
      {...props}
    >
      {children}
    </table>
  );
}

export function TableHead({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('bg-background-tertiary border-b border-border-primary', className)}
      {...props}
    >
      {children}
    </thead>
  );
}

export function TableBody({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={className} {...props}>
      {children}
    </tbody>
  );
}

export function TableFilterRow({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      data-filter-row
      className={cn('h-14 bg-background-secondary/50', className)}
      {...props}
    >
      {children}
    </tr>
  );
}

interface TableHeaderRowProps extends HTMLAttributes<HTMLTableRowElement> {
  hasFilters?: boolean;
}

export function TableHeaderRow({
  hasFilters = true,
  className,
  children,
  ...props
}: TableHeaderRowProps) {
  return (
    <tr
      data-column-header-row
      className={cn(
        'h-[38px]',
        hasFilters && 'border-t border-border-primary',
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TableFilterCell({
  className,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn('max-w-0 px-3 py-2 align-middle', className)} {...props}>
      {children}
    </th>
  );
}

interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  label?: ReactNode;
  align?: 'left' | 'center' | 'right';
  sorted?: boolean;
  sortOrder?: TableSortOrder;
  onSort?: () => void;
  sortAriaLabel?: string;
  resizable?: boolean;
  onResizePointerDown?: (event: React.PointerEvent<HTMLSpanElement>) => void;
  onResizeKeyDown?: (event: KeyboardEvent<HTMLSpanElement>) => void;
  resizeAriaLabel?: string;
  resizeTestId?: string;
}

export function TableHeaderCell({
  label,
  children,
  align = 'left',
  sorted = false,
  sortOrder = 'asc',
  onSort,
  sortAriaLabel,
  resizable = false,
  onResizePointerDown,
  onResizeKeyDown,
  resizeAriaLabel,
  resizeTestId,
  className,
  ...props
}: TableHeaderCellProps) {
  const content = children ?? label;
  const alignmentClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const contentId = useId();
  // Name the header from its content only, so the resize handle's label is not read as part of it.
  const labelledBy = resizable && !props['aria-label'] && !props['aria-labelledby'] ? contentId : undefined;

  return (
    <th
      scope="col"
      aria-labelledby={labelledBy}
      aria-sort={sorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : onSort ? 'none' : undefined}
      className={cn(
        'relative whitespace-nowrap px-3 py-2 text-xs font-medium text-text-secondary',
        alignmentClass,
        className,
      )}
      {...props}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          aria-label={sortAriaLabel}
          className={cn(
            'inline-flex items-center gap-1 select-none transition-colors hover:text-text-primary',
            sorted && 'text-text-primary',
          )}
        >
          <span id={contentId}>{content}</span>
          {sorted ? (
            sortOrder === 'asc' ? (
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            )
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
          )}
        </button>
      ) : labelledBy ? (
        <span id={contentId}>{content}</span>
      ) : (
        content
      )}

      {resizable && (
        <TableColumnResizeHandle
          ariaLabel={resizeAriaLabel ?? 'Resize column'}
          testId={resizeTestId}
          onPointerDown={onResizePointerDown}
          onKeyDown={onResizeKeyDown}
        />
      )}
    </th>
  );
}

interface TableColumnResizeHandleProps {
  ariaLabel: string;
  testId?: string;
  onPointerDown?: (event: React.PointerEvent<HTMLSpanElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLSpanElement>) => void;
}

export function TableColumnResizeHandle({
  ariaLabel,
  testId,
  onPointerDown,
  onKeyDown,
}: TableColumnResizeHandleProps) {
  return (
    <span
      role="separator"
      aria-label={ariaLabel}
      data-testid={testId}
      aria-orientation="vertical"
      tabIndex={onKeyDown ? 0 : -1}
      data-prevent-row-click="true"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none select-none border-r border-transparent transition-colors hover:border-oak-primary focus:border-oak-primary focus:outline-none"
    />
  );
}

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  index?: number;
  selected?: boolean;
  interactive?: boolean;
  zebra?: boolean;
  onActivate?: () => void;
}

export function TableRow({
  index,
  selected = false,
  interactive = false,
  zebra = true,
  onActivate,
  onClick,
  onKeyDown,
  tabIndex,
  className,
  children,
  ...props
}: TableRowProps) {
  const alternate = zebra && typeof index === 'number' && index % 2 === 1;

  const handleClick = (event: MouseEvent<HTMLTableRowElement>) => {
    onClick?.(event);
    if (onActivate && isPlainTableRowClick(event)) {
      onActivate();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    onKeyDown?.(event);
    if (
      onActivate
      && !event.defaultPrevented
      && (event.key === 'Enter' || event.key === ' ')
      && !isTableInteractiveTarget(event.target, event.currentTarget)
    ) {
      event.preventDefault();
      onActivate();
    }
  };

  return (
    <tr
      tabIndex={tabIndex ?? (onActivate ? 0 : undefined)}
      onClick={onClick || onActivate ? handleClick : undefined}
      onKeyDown={onKeyDown || onActivate ? handleKeyDown : undefined}
      className={cn(
        'border-b border-border-primary transition-colors last:border-b-0',
        selected
          ? 'bg-oak-row-selected hover:bg-oak-row-selected-hover'
          : alternate
            ? 'bg-oak-row-alt hover:bg-oak-row-alt-hover'
            : 'hover:bg-background-tertiary/50',
        (interactive || onActivate) && 'cursor-pointer',
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TableCell({
  className,
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('px-3 py-2 text-sm text-text-primary align-middle', className)}
      {...props}
    >
      {children}
    </td>
  );
}

interface TableEmptyStateProps {
  colSpan: number;
  /** A plain message, or an `EmptyState` with a title and next step. */
  message: ReactNode;
  className?: string;
}

export function TableEmptyState({ colSpan, message, className }: TableEmptyStateProps) {
  const plain = typeof message === 'string';
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn(plain ? 'px-3 py-12 text-center text-sm text-text-secondary' : 'p-0 text-center', className)}
      >
        {message}
      </td>
    </tr>
  );
}

interface TableSelectionButtonProps {
  selected?: boolean;
  indeterminate?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  className?: string;
}

export function TableSelectionButton({
  selected = false,
  indeterminate = false,
  onClick,
  disabled = false,
  ariaLabel,
  title,
  className,
}: TableSelectionButtonProps) {
  const Icon = selected ? CheckSquare : indeterminate ? MinusSquare : Square;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={selected}
      title={title}
      disabled={disabled}
      onClick={onClick}
      data-prevent-row-click="true"
      className={cn(
        'rounded p-1 transition-colors hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4',
          selected ? 'text-oak-primary' : indeterminate ? 'text-oak-light' : 'text-text-muted',
        )}
        aria-hidden="true"
      />
    </button>
  );
}

interface TableTextFilterProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  ariaLabel: string;
  debounceMs?: number;
  type?: 'search' | 'text' | 'number';
  className?: string;
}

export function TableTextFilter({
  value,
  onChange,
  placeholder = 'All',
  ariaLabel,
  debounceMs = 0,
  type = 'search',
  className,
}: TableTextFilterProps) {
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  useEffect(() => {
    if (debounceMs <= 0 || draft === (value ?? '')) return;
    const timeout = window.setTimeout(() => onChange(draft || undefined), debounceMs);
    return () => window.clearTimeout(timeout);
  }, [debounceMs, draft, onChange, value]);

  const update = (next: string) => {
    setDraft(next);
    if (debounceMs <= 0) onChange(next || undefined);
  };

  return (
    <div className={cn('relative w-full min-w-0', className)}>
      <input
        type={type}
        value={draft}
        onChange={(event) => update(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          TABLE_FILTER_NATIVE_INPUT_CLASS,
          // The clear button below replaces the browser's own search clear icon.
          '[&::-webkit-search-cancel-button]:appearance-none',
          draft && 'pr-8',
        )}
      />
      {draft ? (
        <button
          type="button"
          onClick={() => update('')}
          aria-label={`Clear ${ariaLabel}`}
          data-prevent-row-click="true"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 transition-colors hover:bg-background-tertiary"
        >
          <X className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

interface TableSelectFilterProps {
  options: SelectOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  clearable?: boolean;
}

export function TableSelectFilter({
  options,
  value,
  onChange,
  placeholder = 'All',
  ariaLabel,
  className,
  clearable = true,
}: TableSelectFilterProps) {
  return (
    <SearchableSelect
      variant="table-filter"
      options={options}
      value={value ?? ''}
      onChange={onChange}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      clearable={clearable}
      className={cn('w-full min-w-0 text-xs', className)}
      showChevron={false}
      showKeyboardHints={false}
    />
  );
}
