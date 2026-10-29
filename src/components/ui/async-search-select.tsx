'use client';

import { useState, useEffect, useRef, useCallback, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Search, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SelectKeyboardHints, SelectPopoverMessage, nextHighlightedIndex, selectPopoverVerticalStyle, useSelectPopoverPosition } from '@/components/ui/select-popover';
import { TABLE_FILTER_CONTAINER_CLASS, TABLE_FILTER_PLACEHOLDER_CLASS, TABLE_FILTER_TEXT_CLASS } from '@/components/ui/table-filter-styles';

export interface AsyncSearchSelectOption {
  id: string;
  label: string;
  description?: string;
}

export interface AsyncSearchSelectPagination {
  /** Current page index (0-based). */
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

export interface AsyncSearchSelectProps<T extends AsyncSearchSelectOption> {
  /** Label for the select */
  label?: string;
  /** Currently selected value ID */
  value: string;
  /** Callback when value changes */
  onChange: (id: string, item: T | null) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the select is disabled */
  disabled?: boolean;
  /** Additional class name */
  className?: string;
  /** Search results from async query */
  options: T[];
  /** Whether options are loading */
  isLoading: boolean;
  /** Search query state */
  searchQuery: string;
  /** Callback to update search query */
  onSearchChange: (query: string) => void;
  /** Custom render function for selected item */
  renderSelected?: (item: T) => ReactNode;
  /** Custom render function for option in dropdown */
  renderOption?: (item: T, isHighlighted: boolean, isSelected: boolean) => ReactNode;
  /** Icon to show in search input and options */
  icon?: ReactNode;
  /** Whether to render the magnifying-glass icon in the search input */
  showSearchIcon?: boolean;
  /** Additional classes for the search input text (font size/colour) */
  inputClassName?: string;
  /** Optional classes for the visible control height and spacing. */
  controlClassName?: string;
  /** Optional classes for the visible label spacing and styling. */
  labelClassName?: string;
  /** Text to show when there's no search query */
  emptySearchText?: string;
  /** Text to show when search returns no results */
  noResultsText?: string;
  /** Message shown in place of results when the search request failed. */
  error?: ReactNode;
  /** Retries a failed search; shows a Try again button beside `error`. */
  onRetry?: () => void;
  /** Optional server-side pagination controls for the results list. */
  pagination?: AsyncSearchSelectPagination;
  /** Allow users to click the selected value and search for a replacement. */
  allowReselect?: boolean;
  /** Canonical inline-table visual treatment. */
  variant?: 'default' | 'table-filter';
}

export function AsyncSearchSelect<T extends AsyncSearchSelectOption>({
  label,
  value,
  onChange,
  placeholder = 'Search...',
  disabled = false,
  className,
  options,
  isLoading,
  searchQuery,
  onSearchChange,
  renderSelected,
  renderOption,
  icon,
  showSearchIcon = true,
  inputClassName = 'text-sm text-text-primary placeholder:text-text-muted',
  controlClassName,
  labelClassName = 'mb-1.5',
  emptySearchText = 'Type to search',
  noResultsText = 'No matches found',
  error,
  onRetry,
  pagination,
  allowReselect = false,
  variant = 'default',
}: AsyncSearchSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedItem, setSelectedItem] = useState<T | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputId = useId();
  const labelId = `${inputId}-label`;
  const listboxId = `${inputId}-listbox`;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedControlRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusTargetRef = useRef<'selected' | 'input' | null>(null);
  const { position, openAbove } = useSelectPopoverPosition(containerRef, isOpen, 320);

  // Mount check for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset highlighted index when results change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [options.length]);

  // Keep the displayed selected item in sync when the parent controls value
  // from query results or default selections.
  useEffect(() => {
    if (!value) {
      setSelectedItem(null);
      setIsEditing(false);
      return;
    }

    if (isEditing) return;

    if (selectedItem?.id === value) {
      return;
    }

    const matchingOption = options.find((item) => item.id === value);
    if (matchingOption) {
      setSelectedItem(matchingOption);
    }
  }, [isEditing, options, selectedItem?.id, value]);

  useEffect(() => {
    if (focusTargetRef.current === 'selected' && selectedItem) {
      selectedControlRef.current?.focus();
      focusTargetRef.current = null;
    } else if (focusTargetRef.current === 'input') {
      inputRef.current?.focus();
      focusTargetRef.current = null;
    }
  }, [selectedItem]);

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
        setIsEditing(false);
        onSearchChange('');
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setIsEditing(false);
        onSearchChange('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onSearchChange]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const highlightedElement = listRef.current.querySelector(
        `[data-index="${highlightedIndex}"]`
      );
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleSelect = useCallback(
    (item: T) => {
      focusTargetRef.current = 'selected';
      setSelectedItem(item);
      setIsEditing(false);
      onChange(item.id, item);
      setIsOpen(false);
      onSearchChange('');
    },
    [onChange, onSearchChange]
  );

  const handleClear = useCallback(() => {
    focusTargetRef.current = 'input';
    setSelectedItem(null);
    setIsEditing(false);
    onChange('', null);
    onSearchChange('');
  }, [onChange, onSearchChange]);

  const handleSelectedKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      handleClear();
    }
  }, [handleClear]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'Home':
        case 'End': {
          if (!isOpen) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIsOpen(true);
            }
            break;
          }
          const next = nextHighlightedIndex(e.key, highlightedIndex, options.length);
          if (next !== null) {
            e.preventDefault();
            setHighlightedIndex(next);
          }
          break;
        }
        case 'Enter':
          e.preventDefault();
          if (isOpen && options[highlightedIndex]) {
            handleSelect(options[highlightedIndex]);
          } else if (!isOpen) {
            setIsOpen(true);
          }
          break;
        case 'Tab':
          // Typing until one result is left, then Tab, picks it (focus still moves on).
          if (isOpen && !isLoading && searchQuery.trim() && options.length === 1) {
            const [only] = options;
            setSelectedItem(only);
            onChange(only.id, only);
          }
          setIsOpen(false);
          setIsEditing(false);
          onSearchChange('');
          break;
        case 'Escape':
          setIsOpen(false);
          setIsEditing(false);
          onSearchChange('');
          break;
      }
    },
    [isOpen, isLoading, searchQuery, options, highlightedIndex, handleSelect, onChange, onSearchChange]
  );

  const defaultRenderSelected = (item: T) => (
    <div className="flex-1 flex items-center gap-2 px-3 min-w-0">
      {icon && <span className="text-text-tertiary shrink-0">{icon}</span>}
      <span className="text-sm text-text-primary truncate">{item.label}</span>
      {item.description && (
        <span className="text-xs text-text-muted truncate hidden sm:inline">
          ({item.description})
        </span>
      )}
    </div>
  );

  const defaultRenderOption = (item: T, isHighlighted: boolean, isSelected: boolean) => (
    <div
      className={cn(
        'px-3 py-2.5 cursor-pointer transition-colors flex items-center gap-3',
        isHighlighted && 'bg-background-tertiary',
        isSelected && 'text-oak-primary',
        !isHighlighted && !isSelected && 'hover:bg-background-secondary'
      )}
    >
      {icon && <span className="text-text-tertiary shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{item.label}</div>
        {item.description && (
          <div className="text-xs text-text-muted truncate">{item.description}</div>
        )}
      </div>
      {isSelected && <Check className="w-4 h-4 text-oak-primary shrink-0" />}
    </div>
  );

  return (
    <div className={cn('relative', className)}>
      {label && (
        <label id={labelId} htmlFor={inputId} className={cn(
          'block text-sm font-medium text-text-primary',
          labelClassName,
        )}>
          {label}
        </label>
      )}

      {/* Selected Item Display or Search Input */}
      <div
        ref={containerRef}
        className={cn(
          'w-full flex items-center gap-2',
          variant === 'table-filter'
            ? TABLE_FILTER_CONTAINER_CLASS
            : 'min-h-11 rounded-lg border bg-background-secondary/30 border-border-primary hover:border-oak-primary/50 focus-within:ring-2 focus-within:ring-oak-primary/30 transition-colors',
          controlClassName,
          disabled && 'opacity-50 cursor-not-allowed',
          isOpen && 'ring-2 ring-oak-primary/30 border-oak-primary'
        )}
      >
      {selectedItem && !isEditing ? (
          // Show selected item
          <div
            ref={selectedControlRef}
            id={inputId}
            role="combobox"
            aria-labelledby={label ? labelId : undefined}
            aria-label={label ? undefined : selectedItem.label}
            aria-expanded="false"
            aria-controls={listboxId}
            aria-haspopup="listbox"
            aria-readonly="true"
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : 0}
            onKeyDown={disabled ? undefined : handleSelectedKeyDown}
            onClick={disabled || !allowReselect ? undefined : () => {
              focusTargetRef.current = 'input';
              setIsEditing(true);
              setIsOpen(true);
            }}
            className={cn(
              'flex min-w-0 flex-1 items-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30',
              variant === 'table-filter' ? 'h-9 min-h-9' : 'min-h-11',
              allowReselect && 'cursor-pointer',
              controlClassName
            )}
          >
            {renderSelected ? renderSelected(selectedItem) : defaultRenderSelected(selectedItem)}
          </div>
        ) : (
          // Show search input
          <>
            {showSearchIcon && (
              <Search className="w-4 h-4 text-text-muted ml-3 shrink-0" />
            )}
            <input
              ref={inputRef}
              id={inputId}
              role="combobox"
              aria-label={label ? undefined : placeholder}
              aria-expanded={isOpen}
              aria-controls={listboxId}
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-activedescendant={isOpen && options[highlightedIndex] ? optionId(highlightedIndex) : undefined}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                onSearchChange(e.target.value);
                if (!isOpen) setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              className={cn(
                'flex-1 bg-transparent outline-none min-w-0',
                showSearchIcon ? 'pr-3' : 'px-3',
                variant === 'table-filter'
                  ? cn(TABLE_FILTER_TEXT_CLASS, TABLE_FILTER_PLACEHOLDER_CLASS)
                  : inputClassName,
              )}
            />
          </>
        )}

        {/* Clear button */}
        {selectedItem && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            aria-label={label ? `Clear ${label}` : 'Clear selection'}
            className={cn(
              'mr-1 flex items-center justify-center rounded p-1 transition-colors hover:bg-background-tertiary',
              variant === 'table-filter' ? 'h-7 w-7' : 'min-h-11 min-w-11',
              controlClassName
            )}
          >
            <X className="w-3.5 h-3.5 text-text-muted" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen &&
        (!selectedItem || isEditing) &&
        mounted &&
        position.width > 0 &&
        createPortal(
          <div
            ref={popoverRef}
            className={cn(
              'fixed z-[100] flex bg-background-elevated rounded-xl border border-border-primary shadow-elevation-2 animate-fade-in',
              openAbove ? 'flex-col-reverse' : 'flex-col',
            )}
            style={{
              ...selectPopoverVerticalStyle(position, openAbove),
              left: position.left,
              width: position.width,
              maxHeight: 320,
            }}
          >
            {/* Results List */}
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label={label ? `${label} options` : 'Options'}
              className="max-h-64 overflow-y-auto py-1"
            >
              {isLoading ? (
                <SelectPopoverMessage kind="loading">Searching…</SelectPopoverMessage>
              ) : error ? (
                <SelectPopoverMessage kind="error" onRetry={onRetry}>{error}</SelectPopoverMessage>
              ) : options.length === 0 ? (
                <SelectPopoverMessage kind="empty">{searchQuery ? noResultsText : emptySearchText}</SelectPopoverMessage>
              ) : (
                options.map((item, index) => (
                  <div
                    key={item.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={item.id === value}
                    tabIndex={-1}
                    data-index={index}
                    onClick={() => handleSelect(item)}
                    className="min-h-11"
                  >
                    {renderOption
                      ? renderOption(item, index === highlightedIndex, item.id === value)
                      : defaultRenderOption(item, index === highlightedIndex, item.id === value)}
                  </div>
                ))
              )}
            </div>

            {/* Pagination controls */}
            {pagination && (
              <div className="flex items-center justify-between border-t border-border-primary px-1.5 py-1">
                <button
                  type="button"
                  onClick={pagination.onPreviousPage}
                  disabled={!pagination.hasPreviousPage || isLoading}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-background-tertiary hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Previous
                </button>
                <span className="text-xs text-text-muted">
                  Page {pagination.page + 1}
                </span>
                <button
                  type="button"
                  onClick={pagination.onNextPage}
                  disabled={!pagination.hasNextPage || isLoading}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-background-tertiary hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Footer hint */}
            <SelectKeyboardHints openAbove={openAbove} />
          </div>,
          document.body
        )}
    </div>
  );
}
