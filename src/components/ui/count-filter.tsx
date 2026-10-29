'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TABLE_FILTER_PLACEHOLDER_TEXT_CLASS, TABLE_FILTER_TEXT_CLASS, TABLE_FILTER_TRIGGER_CLASS } from '@/components/ui/table-filter-styles';

export interface CountFilterValue {
  min?: number;
  max?: number;
}

interface CountFilterProps {
  value?: CountFilterValue;
  onChange: (value: CountFilterValue) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
  showChevron?: boolean;
  variant?: 'default' | 'table-filter';
}

/**
 * CountFilter - A reusable component for filtering by integer count ranges
 *
 * Features:
 * - Range mode: Filter by min/max count
 * - Supports keyboard navigation
 * - Compact inline design for table headers
 */
export function CountFilter({
  value,
  onChange,
  placeholder = 'All',
  label = 'count',
  className,
  size = 'sm',
  showChevron = false,
  variant = 'default',
}: CountFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [minValue, setMinValue] = useState(value?.min?.toString() || '');
  const [maxValue, setMaxValue] = useState(value?.max?.toString() || '');
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Update dropdown position when opened or on scroll
  useEffect(() => {
    const updatePosition = () => {
      if (isOpen && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const dropdownWidth = 240;
        const dropdownHeight = 220;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const spaceOnRight = viewportWidth - rect.left;
        const spaceBelow = viewportHeight - rect.bottom;

        let left = rect.left;
        if (spaceOnRight < dropdownWidth) {
          left = rect.right - dropdownWidth;
        }
        if (left < 8) left = 8;
        if (left + dropdownWidth > viewportWidth - 8) {
          left = viewportWidth - dropdownWidth - 8;
        }

        let top = rect.bottom + 8;
        if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
          top = rect.top - dropdownHeight - 8;
        }
        if (top < 8) top = 8;
        if (top + dropdownHeight > viewportHeight - 8) {
          top = viewportHeight - dropdownHeight - 8;
        }

        setDropdownPosition({ top, left, width: rect.width });
      }
    };

    if (isOpen) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
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
    setMinValue(value?.min?.toString() || '');
    setMaxValue(value?.max?.toString() || '');
  }, [value]);

  // Parse integer input
  const parseInteger = (str: string): number | undefined => {
    const cleaned = str.replace(/[^0-9]/g, '');
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? undefined : num;
  };

  // Validate range
  const isRangeValid = (): boolean => {
    const min = parseInteger(minValue);
    const max = parseInteger(maxValue);
    if (min !== undefined && max !== undefined) {
      return min <= max;
    }
    return true;
  };

  // Handle apply
  const handleApply = () => {
    const min = parseInteger(minValue);
    const max = parseInteger(maxValue);
    if (min !== undefined && max !== undefined && min > max) {
      return;
    }
    onChange({ min, max });
    setIsOpen(false);
  };

  // Handle clear
  const handleClear = () => {
    setMinValue('');
    setMaxValue('');
    onChange({ min: undefined, max: undefined });
    setIsOpen(false);
  };

  // Get display text
  const getDisplayText = (): string => {
    if (!value?.min && !value?.max) return placeholder;

    const { min, max } = value;
    if (min !== undefined && max !== undefined) {
      if (min === max) return `${min}`;
      return `${min} - ${max}`;
    }
    if (min !== undefined) return `≥ ${min}`;
    if (max !== undefined) return `≤ ${max}`;
    return placeholder;
  };

  const isActive = value?.min !== undefined || value?.max !== undefined;

  const handleInlineClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleClear();
  };

  return (
    <div className="relative">
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
                size === 'sm' ? 'h-9 px-3 text-sm md:text-xs' : 'h-10 px-4 text-sm',
                isActive
                  ? 'border-oak-primary ring-2 ring-oak-primary/30 text-text-primary font-medium'
                  : 'border-border-primary hover:border-oak-primary/50',
              ),
          isOpen && 'ring-2 ring-oak-primary/30 border-oak-primary',
          className
        )}
      >
        <span className={cn('truncate flex-1 text-left', variant === 'table-filter' ? (isActive ? TABLE_FILTER_TEXT_CLASS : TABLE_FILTER_PLACEHOLDER_TEXT_CLASS) : (!isActive && 'text-text-secondary'))}>
          {getDisplayText()}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
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
              <X className="w-3 h-3 text-text-muted hover:text-text-primary" />
            </span>
          )}
          {showChevron && (
            <ChevronDown
              className={cn(
                'flex-shrink-0 transition-transform w-3.5 h-3.5',
                isOpen && 'rotate-180',
                isActive ? 'text-oak-primary' : 'text-text-muted'
              )}
            />
          )}
        </div>
      </button>

      {isOpen && typeof window !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: '15rem',
            maxHeight: 'calc(100vh - 16px)',
          }}
          className={cn(
            'z-50 rounded-lg border border-border-primary bg-background-primary shadow-lg overflow-auto',
            'animate-in fade-in-0 zoom-in-95'
          )}
        >
          <div className="p-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Min {label}
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApply();
                  else if (e.key === 'Escape') setIsOpen(false);
                }}
                placeholder="0"
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
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Max {label}
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={maxValue}
                onChange={(e) => setMaxValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApply();
                  else if (e.key === 'Escape') setIsOpen(false);
                }}
                placeholder="Any"
                className={cn(
                  'w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-background-secondary outline-none transition-colors',
                  !isRangeValid()
                    ? 'border-red-500 focus:ring-2 focus:ring-red-500/30 focus:border-red-500'
                    : 'border-border-primary hover:border-oak-primary/50 focus:ring-2 focus:ring-oak-primary/30 focus:border-oak-primary'
                )}
              />
            </div>
            {!isRangeValid() && (
              <p className="text-xs text-red-500">Min cannot exceed max</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 p-3 border-t border-border-primary">
            <button
              type="button"
              onClick={handleClear}
              className="btn-ghost btn-xs flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!isRangeValid()}
              className={cn(
                'btn-primary btn-xs',
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
