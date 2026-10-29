'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useId,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SelectKeyboardHints, SelectPopoverMessage, nextHighlightedIndex, selectPopoverVerticalStyle, useSelectPopoverPosition } from '@/components/ui/select-popover';
import { TABLE_FILTER_CONTAINER_CLASS, TABLE_FILTER_TEXT_CLASS, TABLE_FILTER_PLACEHOLDER_CLASS, TABLE_FILTER_PLACEHOLDER_TEXT_CLASS } from '@/components/ui/table-filter-styles';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
}

export interface SearchableSelectProps {
  /** Available options */
  options: SelectOption[];
  /** Currently selected value */
  value: string;
  /** Callback when value changes */
  onChange: (value: string) => void;
  /** Placeholder text when no value selected */
  placeholder?: string;
  /** Whether the select is disabled */
  disabled?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Visual treatment for the select trigger */
  variant?: 'default' | 'table-filter';
  /** Additional class name */
  className?: string;
  /** Label for the select */
  label?: string;
  /** Accessible label when the visible placeholder is intentionally generic */
  ariaLabel?: string;
  /** Allow clearing the selection */
  clearable?: boolean;
  /** Show keyboard hints footer */
  showKeyboardHints?: boolean;
  /** Show chevron icon */
  showChevron?: boolean;
  /** Whether options are loading */
  loading?: boolean;
  /** Group options by this field (must match option.group) */
  groupBy?: string;
  /** Additional class name for the input container */
  containerClassName?: string;
  /** Minimum popover width in pixels; useful for narrow triggers with long labels */
  popoverMinWidth?: number;
  /** Blur callback — fires when focus leaves the select input */
  onBlur?: () => void;
  /** Error message associated with the select input */
  error?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  size = 'sm',
  variant = 'default',
  className,
  label,
  clearable = true,
  showKeyboardHints = true,
  showChevron = true,
  loading = false,
  groupBy,
  containerClassName,
  popoverMinWidth,
  ariaLabel,
  onBlur,
  error,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { position, openAbove } = useSelectPopoverPosition(containerRef, isOpen, 280);
  const [mounted, setMounted] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Generate unique IDs for ARIA relationships
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const labelId = label ? `${baseId}-label` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;

  // Mount check for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Detect touch-first devices to avoid force-focusing inputs on open (iOS Safari zoom/jump).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsTouchDevice(
      typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: none) and (pointer: coarse)').matches,
    );
  }, []);

  // Filter options based on search
  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const searchLower = search.toLowerCase();
    return options.filter(
      (opt) =>
        opt.value.toLowerCase().includes(searchLower) ||
        opt.label.toLowerCase().includes(searchLower) ||
        opt.description?.toLowerCase().includes(searchLower)
    );
  }, [options, search]);

  // Get selected option
  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  // Reset highlighted index when filtered options change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [filteredOptions.length]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen && inputRef.current && !isTouchDevice) {
      inputRef.current.focus();
      // Select all text when opening with existing value
      if (selectedOption) {
        inputRef.current.select();
      }
    }
  }, [isOpen, selectedOption, isTouchDevice]);

  // Reset search when closing
  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setHighlightedIndex(-1);
    }
  }, [isOpen]);

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
      }
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

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
    (optionValue: string) => {
      onChange(optionValue);
      setIsOpen(false);
    },
    [onChange]
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange('');
      setSearch('');
    },
    [onChange]
  );

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    if (!isOpen) {
      setIsOpen(true);
    }
  }, [isOpen]);

  const handleInputFocus = useCallback(() => {
    if (!isOpen) {
      setIsOpen(true);
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
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
          const next = nextHighlightedIndex(e.key, highlightedIndex, filteredOptions.length, -1);
          if (next !== null) {
            e.preventDefault();
            setHighlightedIndex(next);
          }
          break;
        }
        case 'Enter':
          e.preventDefault();
          if (isOpen && filteredOptions[highlightedIndex]) {
            handleSelect(filteredOptions[highlightedIndex].value);
          } else if (!isOpen) {
            setIsOpen(true);
          }
          break;
        case 'Tab':
          // Typing until one option is left, then Tab, picks it (focus still moves on).
          if (isOpen && search.trim() && filteredOptions.length === 1) {
            handleSelect(filteredOptions[0].value);
          }
          setIsOpen(false);
          break;
        case 'Escape':
          setIsOpen(false);
          break;
      }
    },
    [isOpen, filteredOptions, highlightedIndex, handleSelect, search]
  );

  const sizeClasses = {
    sm: 'h-8 text-sm',
    md: 'h-9 text-sm',
    lg: 'h-10 text-sm',
  };
  const triggerSizeClasses = variant === 'table-filter' ? '' : sizeClasses[size];

  // Display value in input: show search when typing, otherwise show selected label
  const inputValue = isOpen ? search : (selectedOption?.label || '');

  const getOptionId = useCallback(
    (index: number) => `${baseId}-option-${index}`,
    [baseId]
  );

  const getOptionKey = useCallback(
    (optionValue: string, index: number) => `${optionValue}-${index}`,
    []
  );

  // Get the active option ID for aria-activedescendant
  const activeOptionId = filteredOptions[highlightedIndex]
    ? getOptionId(highlightedIndex)
    : undefined;
  const viewportWidth = mounted && typeof window !== 'undefined' ? window.innerWidth : 0;
  const popoverWidth = viewportWidth > 0
    ? Math.min(
      Math.max(position.width, popoverMinWidth ?? position.width),
      Math.max(position.width, viewportWidth - 16)
    )
    : position.width;
  const popoverLeft = viewportWidth > 0
    ? Math.min(Math.max(8, position.left), Math.max(8, viewportWidth - popoverWidth - 8))
    : position.left;

  return (
    <div className={cn('relative', className)}>
      {label && (
        <label id={labelId} className="block text-xs font-medium text-text-secondary mb-2">
          {label}
        </label>
      )}

      {/* Trigger / Input */}
      <div
        ref={containerRef}
        className={cn(
          'w-full flex items-center gap-2',
          variant === 'table-filter'
            ? TABLE_FILTER_CONTAINER_CLASS
            : 'rounded-lg border bg-[#F4F7F6] border-[#D8E3DF] hover:border-[#294D44]/50 focus-within:ring-2 focus-within:ring-[#294D44]/20 focus-within:border-[#294D44] transition-colors',
          triggerSizeClasses,
          disabled && 'opacity-50 cursor-not-allowed',
          isOpen && (variant === 'table-filter'
            ? 'ring-2 ring-oak-primary/30 border-oak-primary'
            : 'ring-2 ring-[#294D44]/20 border-[#294D44]'),
          error && 'border-status-error',
          containerClassName
        )}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={isOpen ? activeOptionId : undefined}
          aria-autocomplete="list"
          aria-labelledby={ariaLabel ? undefined : labelId}
          aria-label={ariaLabel ?? (!label ? placeholder : undefined)}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? errorId : undefined}
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'flex-1 bg-transparent outline-none px-3 min-w-0',
            variant === 'table-filter'
              ? cn(
                  value ? TABLE_FILTER_TEXT_CLASS : TABLE_FILTER_PLACEHOLDER_TEXT_CLASS,
                  TABLE_FILTER_PLACEHOLDER_CLASS,
                )
              : cn('placeholder:text-text-muted', !value ? 'text-text-secondary' : 'text-text-primary'),
            triggerSizeClasses
          )}
        />
        {clearable && value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            aria-label={label ? `Clear ${label}` : 'Clear selection'}
            className="p-0.5 hover:bg-background-tertiary rounded transition-colors mr-1"
          >
            <X className="w-3.5 h-3.5 text-text-muted" aria-hidden="true" />
          </button>
        )}
        {showChevron && (
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            className="pr-3 flex items-center"
            tabIndex={-1}
            aria-hidden="true"
          >
            <ChevronDown
              className={cn(
                'w-4 h-4 text-text-muted transition-transform flex-shrink-0',
                isOpen && 'rotate-180'
              )}
            />
          </button>
        )}
      </div>

      {error ? <p id={errorId} className="mt-1.5 text-xs text-status-error">{error}</p> : null}

      {/* Popover */}
      {isOpen &&
        mounted &&
        position.width > 0 &&
        createPortal(
          <div
            ref={popoverRef}
            data-searchable-select-popover
            className={cn(
              'fixed z-[100] bg-background-elevated rounded-xl border border-border-primary shadow-elevation-2',
              'animate-fade-in flex',
              openAbove ? 'flex-col-reverse' : 'flex-col'
            )}
            style={{
              ...selectPopoverVerticalStyle(position, openAbove),
              left: popoverLeft,
              width: popoverWidth,
              maxHeight: 280,
            }}
          >
            {/* Options List */}
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label={label || placeholder}
              className="flex-1 overflow-y-auto py-1"
            >
              {loading ? (
                <SelectPopoverMessage kind="loading">Loading…</SelectPopoverMessage>
              ) : options.length === 0 ? (
                <SelectPopoverMessage kind="empty">No options available</SelectPopoverMessage>
              ) : filteredOptions.length === 0 ? (
                <SelectPopoverMessage kind="empty">No matches found</SelectPopoverMessage>
              ) : (
                (() => {
                  // Group options if groupBy is specified
                  if (groupBy) {
                    const groups = new Map<string, SelectOption[]>();
                    filteredOptions.forEach((opt) => {
                      const groupName = opt.group || 'Other';
                      if (!groups.has(groupName)) {
                        groups.set(groupName, []);
                      }
                      groups.get(groupName)!.push(opt);
                    });

                    let flatIndex = 0;
                    return Array.from(groups.entries()).map(([groupName, groupOptions]) => (
                      <div key={groupName}>
                        <div className="px-3 py-1.5 text-xs font-medium text-white uppercase tracking-wide bg-oak-light">
                          {groupName}
                        </div>
                        {groupOptions.map((option) => {
                          const currentIndex = flatIndex++;
                          return (
                            <div
                              key={getOptionKey(option.value, currentIndex)}
                              id={getOptionId(currentIndex)}
                              role="option"
                              aria-selected={option.value === value}
                              title={option.description || undefined}
                              data-index={currentIndex}
                              onClick={() => handleSelect(option.value)}
                              className={cn(
                                'px-3 py-2 cursor-pointer transition-colors flex items-center gap-2',
                                currentIndex === highlightedIndex && 'bg-background-tertiary',
                                option.value === value && 'text-oak-primary',
                                currentIndex !== highlightedIndex &&
                                option.value !== value &&
                                'hover:bg-background-secondary'
                              )}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="text-sm truncate">{option.label}</div>
                                {option.description && (
                                  <div className="text-xs text-text-muted truncate">
                                    {option.description}
                                  </div>
                                )}
                              </div>
                              {option.value === value && (
                                <Check className="w-4 h-4 text-oak-primary flex-shrink-0" aria-hidden="true" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ));
                  }

                  // Regular ungrouped rendering
                  return filteredOptions.map((option, index) => (
                    <div
                      key={getOptionKey(option.value, index)}
                      id={getOptionId(index)}
                      role="option"
                      aria-selected={option.value === value}
                      title={option.description || undefined}
                      data-index={index}
                      onClick={() => handleSelect(option.value)}
                      className={cn(
                        'px-3 py-2 cursor-pointer transition-colors flex items-center gap-2',
                        index === highlightedIndex && 'bg-background-tertiary',
                        option.value === value && 'text-oak-primary',
                        index !== highlightedIndex &&
                        option.value !== value &&
                        'hover:bg-background-secondary'
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{option.label}</div>
                        {option.description && (
                          <div className="text-xs text-text-muted truncate">
                            {option.description}
                          </div>
                        )}
                      </div>
                      {option.value === value && (
                        <Check className="w-4 h-4 text-oak-primary flex-shrink-0" aria-hidden="true" />
                      )}
                    </div>
                  ));
                })()
              )}
            </div>

            {/* Footer hint */}
            {showKeyboardHints && <SelectKeyboardHints openAbove={openAbove} />}
          </div>,
          document.body
        )}
    </div>
  );
}

export default SearchableSelect;
