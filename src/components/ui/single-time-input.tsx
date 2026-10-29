'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SingleTimeInputProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  ariaLabel?: string;
  onBlur?: () => void;
  id?: string;
}

const TIME_POPOVER_WIDTH = 256;
const TIME_POPOVER_HEIGHT = 288;
const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const BASE_MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'));

function normalizeTime(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})(?::?(\d{0,2}))?$/);
  if (!match) return '';

  const hour = Number(match[1]);
  const minute = match[2] === undefined || match[2] === '' ? 0 : Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '';
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function isValidTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value) && normalizeTime(value) === value;
}

export function SingleTimeInput({
  value = '',
  onChange,
  placeholder = 'HH:MM',
  className,
  disabled,
  label,
  error,
  hint,
  required,
  ariaLabel,
  onBlur,
  id,
}: SingleTimeInputProps) {
  const [inputValue, setInputValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const suppressBlurRef = useRef(false);

  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-') || undefined;
  const selectedHour = isValidTime(value) ? value.slice(0, 2) : '';
  const selectedMinute = isValidTime(value) ? value.slice(3, 5) : '';
  const minuteOptions = useMemo(() => {
    if (!selectedMinute || BASE_MINUTES.includes(selectedMinute)) return BASE_MINUTES;
    return [...BASE_MINUTES, selectedMinute].sort((left, right) => Number(left) - Number(right));
  }, [selectedMinute]);
  const displayError = error || localError;

  useEffect(() => {
    setInputValue(value);
    if (!value || isValidTime(value)) {
      setLocalError(null);
    }
  }, [value]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = rect.left;
      if (left + TIME_POPOVER_WIDTH > viewportWidth - 16) {
        left = rect.right - TIME_POPOVER_WIDTH;
      }
      if (left < 16) left = 16;

      let top = rect.bottom + 4;
      if (top + TIME_POPOVER_HEIGHT > viewportHeight - 16) {
        top = rect.top - TIME_POPOVER_HEIGHT - 4;
        if (top < 16) top = 16;
      }

      setPosition({ top, left });
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen]);

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

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const commitTime = useCallback((nextValue: string) => {
    const normalized = normalizeTime(nextValue);
    if (!normalized) {
      setInputValue(nextValue);
      setLocalError(nextValue.trim() ? 'Enter a valid time.' : null);
      if (!nextValue.trim()) onChange('');
      return;
    }

    setInputValue(normalized);
    setLocalError(null);
    onChange(normalized);
  }, [onChange]);

  const selectTimePart = useCallback((part: 'hour' | 'minute', nextPart: string) => {
    const currentHour = selectedHour || '09';
    const currentMinute = selectedMinute || '00';
    const nextValue = part === 'hour'
      ? `${nextPart}:${currentMinute}`
      : `${currentHour}:${nextPart}`;
    commitTime(nextValue);
    inputRef.current?.focus();
  }, [commitTime, selectedHour, selectedMinute]);

  const handleInputBlur = useCallback(() => {
    if (suppressBlurRef.current) {
      suppressBlurRef.current = false;
      return;
    }
    commitTime(inputValue);
    onBlur?.();
  }, [commitTime, inputValue, onBlur]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-text-secondary">
          {label}
          {required && <span className="text-status-error ml-0.5">*</span>}
        </label>
      )}

      <div
        ref={containerRef}
        className={cn(
          'h-10 w-full flex items-center rounded-lg border',
          'bg-[#F4F7F6] dark:bg-background-secondary border-[#D8E3DF]',
          'hover:border-[#294D44]/50 transition-colors',
          'focus-within:ring-2 focus-within:ring-[#294D44]/20 focus-within:border-[#294D44]',
          disabled && 'opacity-50 cursor-not-allowed',
          displayError && 'border-status-error hover:border-status-error focus-within:border-status-error focus-within:ring-status-error/30'
        )}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="numeric"
          value={inputValue}
          onFocus={() => {
            if (!disabled) setIsOpen(true);
          }}
          onChange={(event) => {
            const nextValue = event.target.value;
            setInputValue(nextValue);
            const normalized = normalizeTime(nextValue);
            if (normalized) {
              setLocalError(null);
              onChange(normalized);
            } else if (!nextValue.trim()) {
              setLocalError(null);
              onChange('');
            } else {
              setLocalError(null);
            }
          }}
          onBlur={handleInputBlur}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          aria-label={ariaLabel}
          aria-invalid={displayError ? 'true' : undefined}
          aria-describedby={displayError ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={cn(
            'flex-1 h-full px-3 bg-transparent text-sm text-text-primary placeholder-text-muted',
            'focus:outline-none',
            disabled && 'cursor-not-allowed'
          )}
        />
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!disabled) {
              setIsOpen((current) => !current);
              inputRef.current?.focus();
            }
          }}
          disabled={disabled}
          className={cn(
            'h-full px-2 flex items-center justify-center',
            'text-text-muted hover:text-text-secondary transition-colors',
            'focus:outline-none',
            disabled && 'cursor-not-allowed'
          )}
          aria-label="Open time picker"
          tabIndex={-1}
        >
          <Clock className="w-4 h-4" />
        </button>
      </div>

      {displayError && (
        <div id={`${inputId}-error`} className="flex items-center gap-1.5 text-xs text-status-error">
          <AlertCircle size={14} className="flex-shrink-0" />
          {displayError}
        </div>
      )}

      {hint && !displayError && (
        <div id={`${inputId}-hint`} className="text-xs text-text-muted">
          {hint}
        </div>
      )}

      {isOpen && mounted && createPortal(
        <div
          ref={popoverRef}
          onMouseDown={() => {
            suppressBlurRef.current = true;
          }}
          className="fixed z-[9999] rounded-lg border border-border-primary bg-background-primary shadow-xl"
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${TIME_POPOVER_WIDTH}px`,
            maxHeight: `${TIME_POPOVER_HEIGHT}px`,
          }}
        >
          <div className="grid grid-cols-2 divide-x divide-border-primary">
            <div className="min-h-0">
              <div className="border-b border-border-primary px-3 py-2 text-xs font-medium text-text-secondary">
                Hour
              </div>
              <div className="grid max-h-60 grid-cols-3 gap-1 overflow-y-auto p-2">
                {HOURS.map((hour) => {
                  const selected = hour === selectedHour;
                  return (
                    <button
                      key={hour}
                      type="button"
                      onClick={() => selectTimePart('hour', hour)}
                      className={cn(
                        'flex h-8 items-center justify-center rounded-md text-sm transition-colors',
                        selected
                          ? 'bg-[#294D44] text-white'
                          : 'text-text-primary hover:bg-background-tertiary'
                      )}
                    >
                      {hour}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="min-h-0">
              <div className="border-b border-border-primary px-3 py-2 text-xs font-medium text-text-secondary">
                Minute
              </div>
              <div className="grid max-h-60 grid-cols-2 gap-1 overflow-y-auto p-2">
                {minuteOptions.map((minute) => {
                  const selected = minute === selectedMinute;
                  return (
                    <button
                      key={minute}
                      type="button"
                      onClick={() => selectTimePart('minute', minute)}
                      className={cn(
                        'flex h-8 items-center justify-center gap-1 rounded-md text-sm transition-colors',
                        selected
                          ? 'bg-[#294D44] text-white'
                          : 'text-text-primary hover:bg-background-tertiary'
                      )}
                    >
                      {minute}
                      {selected && <Check className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default SingleTimeInput;
