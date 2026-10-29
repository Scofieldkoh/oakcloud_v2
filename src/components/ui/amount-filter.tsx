'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TABLE_FILTER_PLACEHOLDER_TEXT_CLASS, TABLE_FILTER_TEXT_CLASS, TABLE_FILTER_TRIGGER_CLASS } from '@/components/ui/table-filter-styles';

export interface AmountFilterValue {
  mode: 'single' | 'range';
  single?: number;
  range?: {
    from?: number;
    to?: number;
  };
}

interface AmountFilterProps {
  value?: AmountFilterValue;
  onChange: (value: AmountFilterValue | undefined) => void;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
  showChevron?: boolean;
  variant?: 'default' | 'table-filter';
}

/**
 * AmountFilter - A reusable component for filtering numeric amounts
 *
 * Features:
 * - Single value mode: Filter for exact amount
 * - Range mode: Filter by min/max amounts
 * - Ignores currency (works with raw numbers)
 * - Supports keyboard navigation
 * - Auto-formats numbers with commas
 * - Compact inline design for table headers
 *
 * @example
 * ```tsx
 * <AmountFilter
 *   value={amountFilter}
 *   onChange={(value) => handleFiltersChange({ amountFilter: value })}
 *   placeholder="All amounts"
 *   size="sm"
 * />
 * ```
 */
export function AmountFilter({
  value,
  onChange,
  placeholder = 'All amounts',
  className,
  size = 'md',
  showChevron = true,
  variant = 'default',
}: AmountFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'single' | 'range'>(value?.mode || 'range');
  const [singleValue, setSingleValue] = useState(value?.single?.toString() || '');
  const [fromValue, setFromValue] = useState(value?.range?.from?.toString() || '');
  const [toValue, setToValue] = useState(value?.range?.to?.toString() || '');
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Update dropdown position when opened or on scroll
  useEffect(() => {
    const updatePosition = () => {
      if (isOpen && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const dropdownWidth = 288; // 18rem (w-72)
        const dropdownHeight = 320; // Approximate height (can adjust based on actual measurement)
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const spaceOnRight = viewportWidth - rect.left;
        const spaceOnLeft = rect.right;
        const spaceBelow = viewportHeight - rect.bottom;

        // Calculate horizontal position
        let left = rect.left;
        if (spaceOnRight < dropdownWidth && spaceOnLeft >= dropdownWidth) {
          // Open to the left (right-aligned with button)
          left = rect.right - dropdownWidth;
        }

        // Ensure dropdown doesn't go off-screen on the left
        if (left < 8) {
          left = 8; // 8px margin from viewport edge
        }

        // Ensure dropdown doesn't go off-screen on the right
        if (left + dropdownWidth > viewportWidth - 8) {
          left = viewportWidth - dropdownWidth - 8;
        }

        // Calculate vertical position (open above if not enough space below)
        let top = rect.bottom + 8; // Default: open below with 8px gap
        if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
          // Open above if more space there
          top = rect.top - dropdownHeight - 8;
        }

        // Ensure dropdown doesn't go off-screen vertically
        if (top < 8) {
          top = 8;
        }
        if (top + dropdownHeight > viewportHeight - 8) {
          top = viewportHeight - dropdownHeight - 8;
        }

        setDropdownPosition({
          top,
          left,
          width: rect.width,
        });
      }
    };

    if (isOpen) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true); // Capture phase for all scrolls
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isOpen]);

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen]);

  // Sync internal state with external value
  useEffect(() => {
    if (value) {
      setMode(value.mode);
      if (value.mode === 'single' && value.single !== undefined) {
        setSingleValue(value.single.toString());
      }
      if (value.mode === 'range' && value.range) {
        setFromValue(value.range.from?.toString() || '');
        setToValue(value.range.to?.toString() || '');
      }
    }
  }, [value]);

  // Parse number input (allows decimals and removes non-numeric chars)
  const parseNumber = (str: string): number | undefined => {
    const cleaned = str.replace(/[^0-9.-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? undefined : num;
  };

  // Format number for display (with commas)
  const formatNumber = (num: number | undefined): string => {
    if (num === undefined) return '';
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  // Validate range: ensure min <= max
  const isRangeValid = (): boolean => {
    if (mode !== 'range') return true;
    const from = parseNumber(fromValue);
    const to = parseNumber(toValue);
    if (from !== undefined && to !== undefined) {
      return from <= to;
    }
    return true; // Valid if one or both are empty
  };

  // Handle apply button click
  const handleApply = () => {
    if (mode === 'single') {
      const num = parseNumber(singleValue);
      if (num !== undefined) {
        onChange({ mode: 'single', single: num });
      } else {
        onChange(undefined);
      }
    } else {
      const from = parseNumber(fromValue);
      const to = parseNumber(toValue);
      // Validate range before applying
      if (from !== undefined && to !== undefined && from > to) {
        return; // Don't apply invalid range
      }
      if (from !== undefined || to !== undefined) {
        onChange({ mode: 'range', range: { from, to } });
      } else {
        onChange(undefined);
      }
    }
    setIsOpen(false);
  };

  // Handle clear button
  const handleClear = () => {
    setSingleValue('');
    setFromValue('');
    setToValue('');
    onChange(undefined);
    setIsOpen(false);
  };

  // Get display text for button
  const getDisplayText = (): string => {
    if (!value) return placeholder;

    if (value.mode === 'single' && value.single !== undefined) {
      return formatNumber(value.single);
    }

    if (value.mode === 'range') {
      const { from, to } = value.range || {};
      if (from !== undefined && to !== undefined) {
        return `${formatNumber(from)} - ${formatNumber(to)}`;
      }
      if (from !== undefined) {
        return `≥ ${formatNumber(from)}`;
      }
      if (to !== undefined) {
        return `≤ ${formatNumber(to)}`;
      }
    }

    return placeholder;
  };

  const isActive = value !== undefined;

  // Handle inline clear button click (stops propagation to prevent opening dropdown)
  const handleInlineClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleClear();
  };

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center justify-between gap-1',
          variant === 'table-filter'
            ? TABLE_FILTER_TRIGGER_CLASS
            : cn(
                'w-full rounded-lg border bg-background-secondary/30 transition-colors',
                size === 'sm' ? 'h-9 px-3 text-sm' : 'h-10 px-4 text-sm md:text-base',
                isActive
                  ? 'border-oak-primary ring-2 ring-oak-primary/30 text-text-primary font-medium'
                  : 'border-border-primary hover:border-oak-primary/50',
              ),
          isOpen && 'ring-2 ring-oak-primary/30 border-oak-primary',
          className
        )}
      >
        <span className={cn('truncate flex-1 text-left', variant === 'table-filter' ? (isActive ? TABLE_FILTER_TEXT_CLASS : TABLE_FILTER_PLACEHOLDER_TEXT_CLASS) : cn('text-text-primary', !isActive && 'text-text-secondary'))}>
          {getDisplayText()}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Clear button - only show when active */}
          {isActive && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleInlineClear}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleInlineClear(e as unknown as React.MouseEvent);
                }
              }}
              className="p-0.5 rounded hover:bg-background-tertiary transition-colors"
            >
              <X className={cn('text-text-muted hover:text-text-primary', size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
            </span>
          )}
          {showChevron && (
            <ChevronDown
              className={cn(
                'flex-shrink-0 transition-transform',
                size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4',
                isOpen && 'rotate-180',
                isActive ? 'text-oak-primary' : 'text-text-muted'
              )}
            />
          )}
        </div>
      </button>

      {/* Dropdown (portal-rendered to avoid table clipping) */}
      {isOpen && typeof window !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: '18rem', // Fixed width (w-72) to prevent shifts between modes
            maxHeight: 'calc(100vh - 16px)', // Prevent overflow on small screens
          }}
          className={cn(
            'z-50 rounded-lg border border-border-primary bg-background-primary shadow-lg overflow-auto',
            'animate-in fade-in-0 zoom-in-95'
          )}
        >
          {/* Mode Tabs */}
          <div className="flex border-b border-border-primary">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={cn(
                'flex-1 px-4 py-2 text-sm font-medium transition-colors',
                mode === 'single'
                  ? 'text-oak-primary border-b-2 border-oak-primary'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              Exact Value
            </button>
            <button
              type="button"
              onClick={() => setMode('range')}
              className={cn(
                'flex-1 px-4 py-2 text-sm font-medium transition-colors',
                mode === 'range'
                  ? 'text-oak-primary border-b-2 border-oak-primary'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              Range
            </button>
          </div>

          {/* Content - fixed min-height to prevent layout shift between modes */}
          <div className="p-4 space-y-4" style={{ minHeight: '180px' }}>
            {mode === 'single' ? (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Amount
                </label>
                <input
                  type="text"
                  value={singleValue}
                  onChange={(e) => setSingleValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleApply();
                    } else if (e.key === 'Escape') {
                      setIsOpen(false);
                    }
                  }}
                  placeholder="Enter amount"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border-primary bg-white dark:bg-background-secondary hover:border-oak-primary/50 focus:ring-2 focus:ring-oak-primary/30 focus:border-oak-primary outline-none transition-colors"
                  autoFocus
                />
                <p className="text-xs text-text-muted mt-1.5">
                  Filter for exact amount (e.g., 1000 or 1000.50)
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    From (minimum)
                  </label>
                  <input
                    type="text"
                    value={fromValue}
                    onChange={(e) => setFromValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleApply();
                      } else if (e.key === 'Escape') {
                        setIsOpen(false);
                      }
                    }}
                    placeholder="Min amount"
                    className={cn(
                      'w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-background-secondary outline-none transition-colors',
                      !isRangeValid()
                        ? 'border-red-500 focus:ring-2 focus:ring-red-500/30 focus:border-red-500'
                        : 'border-border-primary hover:border-oak-primary/50 focus:ring-2 focus:ring-oak-primary/30 focus:border-oak-primary'
                    )}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    To (maximum)
                  </label>
                  <input
                    type="text"
                    value={toValue}
                    onChange={(e) => setToValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleApply();
                      } else if (e.key === 'Escape') {
                        setIsOpen(false);
                      }
                    }}
                    placeholder="Max amount"
                    className={cn(
                      'w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-background-secondary outline-none transition-colors',
                      !isRangeValid()
                        ? 'border-red-500 focus:ring-2 focus:ring-red-500/30 focus:border-red-500'
                        : 'border-border-primary hover:border-oak-primary/50 focus:ring-2 focus:ring-oak-primary/30 focus:border-oak-primary'
                    )}
                  />
                </div>
                {!isRangeValid() ? (
                  <p className="text-xs text-red-500">
                    Minimum cannot be greater than maximum
                  </p>
                ) : (
                  <p className="text-xs text-text-muted">
                    Leave blank for open-ended range (e.g., only &quot;From&quot; for ≥ minimum)
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 p-4 border-t border-border-primary">
            <button
              type="button"
              onClick={handleClear}
              className="btn-ghost btn-sm flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!isRangeValid()}
              className={cn(
                'btn-primary btn-sm',
                !isRangeValid() && 'opacity-50 cursor-not-allowed'
              )}
            >
              Apply
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
