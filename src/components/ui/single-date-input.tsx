'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { DayPicker, type DropdownProps } from 'react-day-picker';
import { format, parse, isValid } from 'date-fns';
import { Calendar, CalendarCheck, AlertCircle, ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TABLE_FILTER_CONTAINER_CLASS, TABLE_FILTER_PLACEHOLDER_CLASS, TABLE_FILTER_TEXT_CLASS } from '@/components/ui/table-filter-styles';

// Import react-day-picker styles
import 'react-day-picker/style.css';

export interface SingleDateInputProps {
  /** Optional element ID */
  id?: string;
  /** The current value as ISO date string (YYYY-MM-DD) or empty string */
  value?: string;
  /** Callback when value changes - returns ISO date string or empty string */
  onChange: (value: string) => void;
  /** Placeholder text when no date selected */
  placeholder?: string;
  /** Additional class name */
  className?: string;
  /** Additional classes for the visible input control. */
  controlClassName?: string;
  /** Visual treatment for inline table filters */
  variant?: 'default' | 'table-filter';
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Whether to show and open the calendar popover */
  showCalendar?: boolean;
  /** Label for the input */
  label?: string;
  /** Error message */
  error?: string;
  /** Hint text */
  hint?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Accessible label when visible label is omitted */
  ariaLabel?: string;
  /** Blur callback */
  onBlur?: () => void;
  /** Minimum allowed ISO date (YYYY-MM-DD) */
  minDate?: string;
  /** Maximum allowed ISO date (YYYY-MM-DD) */
  maxDate?: string;
  /** Show a quick "Today" button that fills in today's Singapore date */
  showTodayButton?: boolean;
}

const CALENDAR_START_MONTH = new Date(1900, 0, 1);
const CALENDAR_END_MONTH = new Date(2100, 11, 31);
const CALENDAR_POPOVER_WIDTH = 345;
const CALENDAR_POPOVER_HEIGHT = 360;

// Custom styles for react-day-picker v9 - using oak design system colors
const calendarStyles = `
  .rdp-single {
    --rdp-cell-size: 36px;
    --rdp-accent-color: #294d44;
    --rdp-accent-background-color: rgba(41, 77, 68, 0.15);
    --rdp-day-height: 36px;
    --rdp-day-width: 36px;
    --rdp-selected-font: 500;
    --rdp-outside-opacity: 0.4;
    margin: 0;
  }
  .rdp-single .rdp-root {
    --rdp-accent-color: #294d44;
    --rdp-accent-background-color: rgba(41, 77, 68, 0.15);
  }
  .rdp-single .rdp-month {
    margin: 0 auto;
    width: 100%;
  }
  .rdp-single .rdp-table {
    width: 100%;
  }
  .rdp-single .rdp-month_caption {
    display: flex;
    align-items: center;
    min-height: 36px;
    margin-bottom: 0.5rem;
    padding-right: 72px;
  }
  .rdp-single .rdp-caption_label {
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25rem;
    letter-spacing: 0.01em;
    color: var(--text-primary);
  }
  .rdp-single .rdp-dropdowns {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .rdp-single .rdp-dropdown_root {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .rdp-single .rdp-dropdown {
    cursor: pointer;
    font-family: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
  }
  .rdp-single .rdp-dropdown option {
    font-family: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
  }
  .rdp-single .rdp-dropdown:focus-visible ~ .rdp-caption_label {
    outline: none;
  }
  .rdp-single .rdp-dropdown_root > .rdp-caption_label {
    min-height: 2rem;
    min-width: 5.5rem;
    padding: 0 0.75rem;
    justify-content: space-between;
    gap: 0.375rem;
    font-size: 0.875rem;
    font-weight: 600;
    border: 1px solid #d8e3df;
    border-radius: 8px;
    background: #f4f7f6;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .rdp-single .rdp-months_dropdown ~ .rdp-caption_label {
    min-width: 7.25rem;
  }
  .rdp-single .rdp-dropdown_root:focus-within > .rdp-caption_label {
    border-color: #294d44;
    box-shadow: 0 0 0 2px rgba(41, 77, 68, 0.12);
  }
  .rdp-single .rdp-dropdown_root .rdp-chevron {
    fill: currentColor;
  }
  .rdp-single .rdp-nav {
    display: flex;
    align-items: center;
  }
  .rdp-single .rdp-button_previous,
  .rdp-single .rdp-button_next {
    width: 28px;
    height: 28px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
  }
  .rdp-single .rdp-button_previous:hover,
  .rdp-single .rdp-button_next:hover {
    background: var(--bg-tertiary, #f3f4f6);
    color: var(--text-primary);
  }
  .rdp-single .rdp-weekday {
    font-size: 0.75rem;
    font-weight: normal;
    color: var(--text-muted);
    width: var(--rdp-cell-size);
    height: 32px;
  }
  .rdp-single .rdp-day {
    width: var(--rdp-cell-size);
    height: var(--rdp-cell-size);
    font-size: 0.875rem;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .rdp-single .rdp-day_button {
    border: none !important;
    outline: none !important;
  }
  .rdp-single .rdp-day_button:focus {
    outline: none !important;
    box-shadow: none !important;
  }
  .rdp-single .rdp-day:hover:not(.rdp-day_selected):not(.rdp-day_disabled) {
    background: var(--bg-tertiary, #f3f4f6);
  }
  .rdp-single .rdp-day_today:not(.rdp-day_selected) {
    font-weight: 600;
    color: #294d44;
  }
  .rdp-single .rdp-day_selected,
  .rdp-single .rdp-selected {
    background: rgba(41, 77, 68, 0.15) !important;
    color: #294d44 !important;
    font-weight: 500;
    border: none !important;
  }
  .rdp-single .rdp-day_outside {
    opacity: 0.4;
    color: var(--text-muted);
  }
  .rdp-single .rdp-day_disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .rdp-single .rdp-day:focus,
  .rdp-single .rdp-day:focus-visible,
  .rdp-single .rdp-day_button:focus,
  .rdp-single .rdp-day_button:focus-visible {
    outline: 2px solid rgba(41, 77, 68, 0.3) !important;
    outline-offset: -2px;
  }
  .rdp-single *:focus {
    outline-color: #294d44 !important;
  }
  .rdp-single button:focus-visible {
    outline: 2px solid rgba(41, 77, 68, 0.5) !important;
  }
`;

function CalendarCaptionDropdown({
  options,
  value,
  onChange,
  className,
  disabled,
  'aria-label': ariaLabel,
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  const isMonthDropdown = className?.includes('months_dropdown');
  const selectedValue = typeof value === 'number' ? value : Number(value);
  const selectedOption = options?.find((option) => option.value === selectedValue) ?? options?.[0];

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
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

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return;

    const frameId = requestAnimationFrame(() => {
      const listbox = listboxRef.current;
      if (!listbox) return;

      const selectedOptionButton = listbox.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      if (!selectedOptionButton) return;

      const targetScrollTop = Math.max(
        0,
        selectedOptionButton.offsetTop - (listbox.clientHeight - selectedOptionButton.offsetHeight) / 2
      );
      listbox.scrollTop = targetScrollTop;
    });

    return () => cancelAnimationFrame(frameId);
  }, [isOpen, selectedValue]);

  const handleOptionSelect = useCallback(
    (nextValue: number) => {
      onChange?.({
        target: { value: String(nextValue) },
      } as React.ChangeEvent<HTMLSelectElement>);
      setIsOpen(false);
    },
    [onChange]
  );

  return (
    <div ref={containerRef} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'h-8 inline-flex items-center justify-between gap-2 rounded-lg border border-[#D8E3DF] bg-[#F4F7F6] px-3',
          'text-sm font-normal text-text-primary transition-colors',
          'hover:border-[#294D44]/50 focus:outline-none focus:ring-2 focus:ring-[#294D44]/20 focus:border-[#294D44]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          isMonthDropdown ? 'min-w-[7.25rem]' : 'min-w-[5.5rem]'
        )}
      >
        <span className="truncate">{selectedOption?.label ?? ''}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-text-muted transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div
          className={cn(
            'absolute left-0 top-[calc(100%+6px)] z-[140] overflow-hidden rounded-xl border border-border-primary bg-background-elevated shadow-elevation-2',
            isMonthDropdown ? 'w-[11rem]' : 'w-[6.5rem]'
          )}
        >
          <div ref={listboxRef} role="listbox" aria-label={ariaLabel} className="max-h-56 overflow-y-auto py-1">
            {options?.map((option) => {
              const isSelected = option.value === selectedValue;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  onClick={() => handleOptionSelect(option.value)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-normal transition-colors',
                    option.disabled
                      ? 'cursor-not-allowed text-text-muted/50'
                      : isSelected
                        ? 'bg-background-secondary text-oak-primary'
                        : 'text-text-primary hover:bg-background-secondary'
                  )}
                >
                  <span className="flex-1 truncate">{option.label}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 flex-shrink-0 text-oak-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Today's date in the firm's time zone, as an ISO string (YYYY-MM-DD)
function todayISODate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Format date for display in input: "11 Jan 2026"
function formatDisplayDate(date: Date): string {
  return format(date, 'd MMM yyyy');
}

// Parse ISO date string to Date object
function parseISODate(dateString: string): Date | undefined {
  if (!dateString) return undefined;
  const parsed = parse(dateString, 'yyyy-MM-dd', new Date());
  return isValid(parsed) ? parsed : undefined;
}

// Format Date to ISO string (YYYY-MM-DD)
function formatISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function clampDate(date: Date, minDate?: Date, maxDate?: Date): Date {
  if (minDate && date < minDate) return minDate;
  if (maxDate && date > maxDate) return maxDate;
  return date;
}

function isDateWithinRange(date: Date, minDate?: Date, maxDate?: Date): boolean {
  if (minDate && date < minDate) return false;
  if (maxDate && date > maxDate) return false;
  return true;
}

function getDateRangeError(date: Date, minDate?: Date, maxDate?: Date): string | null {
  if (minDate && date < minDate) {
    return `Enter a date on or after ${formatDisplayDate(minDate)}.`;
  }
  if (maxDate && date > maxDate) {
    return `Enter a date on or before ${formatDisplayDate(maxDate)}.`;
  }
  return null;
}

// Normalize compact date strings like "28sep25" or "28sept25" to "28 Sep 25"
function normalizeCompactDate(input: string): string {
  // Match patterns like: 28sep25, 28sept25, 28 sep 25, 28 sept 25, 28sep2025
  const compactPattern = /^(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s*(\d{2,4})$/i;
  const match = input.match(compactPattern);

  if (match) {
    const day = match[1];
    let month = match[2].toLowerCase();
    const year = match[3];

    // Normalize "sept" to "sep"
    if (month === 'sept') {
      month = 'sep';
    }

    // Capitalize first letter
    month = month.charAt(0).toUpperCase() + month.slice(1);

    return `${day} ${month} ${year}`;
  }

  return input;
}

// Try to parse various date formats from user input
function parseUserInput(input: string): Date | undefined {
  if (!input.trim()) return undefined;

  const trimmed = input.trim();

  // Normalize compact formats like "28sep25" to "28 Sep 25"
  const normalized = normalizeCompactDate(trimmed);

  // Try various formats
  const formats = [
    'yyyy-MM-dd',    // ISO: 2026-01-11
    'd/M/yyyy',      // 11/1/2026
    'd-M-yyyy',      // 11-1-2026
    'd MMM yyyy',    // 11 Jan 2026
    'd MMMM yyyy',   // 11 January 2026
    'dd/MM/yyyy',    // 11/01/2026
    'dd-MM-yyyy',    // 11-01-2026
    'MM/dd/yyyy',    // 01/11/2026 (US format)
    'd/M/yy',        // 11/1/26
    'd-M-yy',        // 11-1-26
    'd MMM yy',      // 11 Jan 26 (after normalization)
  ];

  for (const fmt of formats) {
    try {
      const parsed = parse(normalized, fmt, new Date());
      if (isValid(parsed)) {
        // Sanity check: year should be reasonable (1900-2100)
        const year = parsed.getFullYear();
        if (year >= 1900 && year <= 2100) {
          return parsed;
        }
      }
    } catch {
      // Continue to next format
    }
  }

  return undefined;
}

export function SingleDateInput({
  id,
  value = '',
  onChange,
  placeholder = 'dd mmm yyyy',
  className,
  controlClassName,
  variant = 'default',
  disabled,
  showCalendar = true,
  label,
  error,
  hint,
  required,
  ariaLabel,
  onBlur,
  minDate,
  maxDate,
  showTodayButton = false,
}: SingleDateInputProps) {
  const [committedValue, setCommittedValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [month, setMonth] = useState<Date>(() => parseISODate(value) || new Date());
  const [inputValue, setInputValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const suppressBlurRef = useRef(false);
  const suppressFocusOpenRef = useRef(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const isTableFilter = variant === 'table-filter';

  const selectedDate = useMemo(() => parseISODate(committedValue), [committedValue]);
  const minDateValue = useMemo(() => parseISODate(minDate || ''), [minDate]);
  const maxDateValue = useMemo(() => parseISODate(maxDate || ''), [maxDate]);

  useEffect(() => {
    setCommittedValue(value);
  }, [value]);

  // Mount check for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync input value with external value - only when not actively editing
  useEffect(() => {
    if (!isEditing) {
      if (selectedDate) {
        setInputValue(formatDisplayDate(selectedDate));
      } else {
        setInputValue('');
      }
    }
  }, [committedValue, selectedDate, isEditing]);

  useEffect(() => {
    if (error) {
      setLocalError(null);
    }
  }, [error]);

  // Update month when value changes
  useEffect(() => {
    if (selectedDate) {
      const nextMonth = clampDate(selectedDate, minDateValue, maxDateValue);
      setMonth((prevMonth) => (
        prevMonth.getFullYear() === nextMonth.getFullYear() &&
        prevMonth.getMonth() === nextMonth.getMonth() &&
        prevMonth.getDate() === nextMonth.getDate()
          ? prevMonth
          : nextMonth
      ));
    }
  }, [selectedDate, minDateValue, maxDateValue]);

  // Calculate position with scroll and resize handling
  useEffect(() => {
    const updatePosition = () => {
      if (isOpen && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Calculate horizontal position
        let left = rect.left;
        if (left + CALENDAR_POPOVER_WIDTH > viewportWidth - 16) {
          left = rect.right - CALENDAR_POPOVER_WIDTH;
        }
        if (left < 16) {
          left = 16;
        }

        // Calculate vertical position
        let top = rect.bottom + 4;
        if (top + CALENDAR_POPOVER_HEIGHT > viewportHeight - 16) {
          top = rect.top - CALENDAR_POPOVER_HEIGHT - 4;
          if (top < 16) {
            top = 16;
          }
        }

        setPosition({ top, left });
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

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        suppressFocusOpenRef.current = true;
        setIsOpen(false);
      } else if (event.key === 'Tab') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleGlobalKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isOpen]);

  const handleSelect = useCallback(
    (date: Date | undefined) => {
      if (date) {
        if (!isDateWithinRange(date, minDateValue, maxDateValue)) {
          return;
        }
        setIsEditing(false);
        setInputValue(formatDisplayDate(date));
        setLocalError(null);
        setMonth(date);
        const isoValue = formatISODate(date);
        setCommittedValue(isoValue);
        onChange(isoValue);
        setIsOpen(false);
        suppressFocusOpenRef.current = true;
        inputRef.current?.focus();
      }
    },
    [maxDateValue, minDateValue, onChange]
  );

  const handleInputFocus = useCallback(() => {
    if (suppressFocusOpenRef.current) {
      suppressFocusOpenRef.current = false;
      return;
    }

    setIsEditing(true);
    if (showCalendar && !disabled) {
      setIsOpen(true);
    }
  }, [disabled, showCalendar]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setInputValue(newValue);

      // Try to parse as user types - silently update the underlying value
      const parsed = parseUserInput(newValue);
      if (parsed && isDateWithinRange(parsed, minDateValue, maxDateValue)) {
        setLocalError(null);
        const isoValue = formatISODate(parsed);
        setCommittedValue(isoValue);
        onChange(isoValue);
        setMonth(parsed);
      } else if (parsed) {
        setLocalError(getDateRangeError(parsed, minDateValue, maxDateValue));
        setCommittedValue('');
        onChange('');
      } else if (!newValue.trim()) {
        setLocalError(null);
        setCommittedValue('');
        onChange('');
      } else {
        setLocalError(null);
      }
    },
    [maxDateValue, minDateValue, onChange]
  );

  const handleInputBlur = useCallback(() => {
    if (suppressBlurRef.current) {
      suppressBlurRef.current = false;
      return;
    }

    setIsEditing(false);
    onBlur?.();

    // On blur, format the display to the standard format
    if (selectedDate) {
      setLocalError(null);
      setInputValue(formatDisplayDate(selectedDate));
    } else if (inputValue.trim()) {
      // Try one more parse attempt
      const parsed = parseUserInput(inputValue);
      if (parsed && isDateWithinRange(parsed, minDateValue, maxDateValue)) {
        setLocalError(null);
        const isoValue = formatISODate(parsed);
        setCommittedValue(isoValue);
        onChange(isoValue);
        setInputValue(formatDisplayDate(parsed));
      } else if (parsed) {
        setLocalError(getDateRangeError(parsed, minDateValue, maxDateValue));
        setCommittedValue('');
        onChange('');
      } else {
        setLocalError('Enter a valid date.');
        setCommittedValue('');
        onChange('');
      }
    } else {
      setLocalError(null);
    }
  }, [inputValue, maxDateValue, minDateValue, onBlur, onChange, selectedDate]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Tab' || e.key === 'Escape') {
        if (e.key === 'Escape') {
          e.preventDefault();
          suppressFocusOpenRef.current = true;
        }
        setIsOpen(false);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const trimmed = inputValue.trim();
        if (!trimmed) {
          setLocalError(null);
          setCommittedValue('');
          onChange('');
          setInputValue('');
          setIsEditing(false);
          setIsOpen(false);
          return;
        }

        const parsed = parseUserInput(trimmed);
        if (parsed && isDateWithinRange(parsed, minDateValue, maxDateValue)) {
          setLocalError(null);
          const isoValue = formatISODate(parsed);
          setCommittedValue(isoValue);
          onChange(isoValue);
          setInputValue(formatDisplayDate(parsed));
          setIsEditing(false);
          setIsOpen(false);
        } else if (parsed) {
          setLocalError(getDateRangeError(parsed, minDateValue, maxDateValue));
          setCommittedValue('');
          onChange('');
          setIsOpen(false);
        } else {
          setLocalError('Enter a valid date.');
          setCommittedValue('');
          onChange('');
          setIsOpen(false);
        }
      }
    },
    [inputValue, maxDateValue, minDateValue, onChange]
  );

  const handleTodayClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      const today = parseISODate(todayISODate());
      if (today) {
        handleSelect(today);
      }
    },
    [disabled, handleSelect]
  );

  const todayOutOfRange = useMemo(() => {
    if (!showTodayButton) return false;
    const today = parseISODate(todayISODate());
    return !today || !isDateWithinRange(today, minDateValue, maxDateValue);
  }, [maxDateValue, minDateValue, showTodayButton]);

  const handleCalendarClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (showCalendar && !disabled) {
        setIsOpen(!isOpen);
      }
    },
    [disabled, isOpen, showCalendar]
  );

  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  const displayError = error || localError;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Inject custom styles */}
      <style dangerouslySetInnerHTML={{ __html: calendarStyles }} />

      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-text-secondary">
          {label}
          {required && <span className="text-status-error ml-0.5">*</span>}
        </label>
      )}

      {/* Input container */}
      <div className={cn(showTodayButton && 'flex items-stretch gap-2')}>
        <div
          ref={containerRef}
          className={cn(
            showTodayButton ? 'flex-1 min-w-0' : 'w-full',
            'flex items-center',
            isTableFilter
              ? TABLE_FILTER_CONTAINER_CLASS
              : 'h-10 rounded-lg border transition-colors bg-[#F4F7F6] dark:bg-background-secondary border-[#D8E3DF] hover:border-[#294D44]/50 focus-within:ring-2 focus-within:ring-[#294D44]/20 focus-within:border-[#294D44]',
            disabled && 'opacity-50 cursor-not-allowed',
            displayError && 'border-status-error hover:border-status-error focus-within:border-status-error focus-within:ring-status-error/30',
            controlClassName,
          )}
        >
          {/* Text input */}
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={inputValue}
            onFocus={handleInputFocus}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            aria-label={ariaLabel || label}
            aria-invalid={displayError ? 'true' : 'false'}
            aria-describedby={displayError ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            className={cn(
              'flex-1 min-w-0 h-full px-3 bg-transparent text-text-primary',
              isTableFilter ? cn(TABLE_FILTER_TEXT_CLASS, TABLE_FILTER_PLACEHOLDER_CLASS) : 'text-sm placeholder-text-muted',
              'focus:outline-none',
              disabled && 'cursor-not-allowed'
            )}
          />

          {showCalendar ? (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onClick={handleCalendarClick}
              disabled={disabled}
              className={cn(
                'h-full px-2 flex-shrink-0 flex items-center justify-center',
                'text-text-muted hover:text-text-secondary transition-colors',
                'focus:outline-none',
                disabled && 'cursor-not-allowed'
              )}
              aria-label={label ? `Open calendar for ${label}` : 'Open calendar'}
              tabIndex={-1}
            >
              <Calendar className="w-4 h-4" />
            </button>
          ) : null}
        </div>

        {showTodayButton ? (
          <Button
            variant="secondary"
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            onClick={handleTodayClick}
            disabled={disabled || todayOutOfRange}
            leftIcon={<CalendarCheck />}
            className="h-auto flex-shrink-0 px-3 border-[#D8E3DF] text-oak-primary hover:border-[#294D44]/50"
            aria-label={label ? `Set ${label} to today` : ariaLabel ? `Set ${ariaLabel} to today` : 'Set to today'}
            title={todayOutOfRange ? 'Today is outside the allowed dates' : undefined}
          >
            Today
          </Button>
        ) : null}
      </div>

      {/* Error message */}
      {displayError && (
        <div id={`${inputId}-error`} className="flex items-center gap-1.5 text-xs text-status-error">
          <AlertCircle size={14} className="flex-shrink-0" />
          {displayError}
        </div>
      )}

      {/* Hint text */}
      {hint && !displayError && (
        <div id={`${inputId}-hint`} className="text-xs text-text-muted">
          {hint}
        </div>
      )}

      {/* Popover */}
      {isOpen &&
        mounted &&
        createPortal(
          <div
            ref={popoverRef}
            onMouseDown={() => {
              suppressBlurRef.current = true;
            }}
            data-single-date-popover
            className={cn(
              'fixed z-[100] w-[345px] bg-background-elevated rounded-xl border border-border-primary shadow-elevation-2',
              'animate-fade-in px-5 py-3.5'
            )}
            style={{ top: position.top, left: position.left }}
          >
            <div className="rdp-single">
              <DayPicker
                mode="single"
                selected={selectedDate}
                onSelect={handleSelect}
                month={month}
                onMonthChange={setMonth}
                components={{ Dropdown: CalendarCaptionDropdown }}
                captionLayout="dropdown"
                navLayout="after"
                startMonth={CALENDAR_START_MONTH}
                endMonth={CALENDAR_END_MONTH}
                disabled={[
                  ...(minDateValue ? [{ before: minDateValue }] : []),
                  ...(maxDateValue ? [{ after: maxDateValue }] : []),
                ]}
                reverseYears
                showOutsideDays
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export default SingleDateInput;
