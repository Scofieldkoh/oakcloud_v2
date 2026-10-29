'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FilterChipProps {
  /** Label for the filter (e.g., "Currency", "Date") */
  label: string;
  /** Value to display (e.g., "USD", "1 Dec 2025 - 31 Dec 2025") */
  value: string;
  /** Callback when remove button is clicked */
  onRemove: () => void;
  /** Additional class name */
  className?: string;
}

/**
 * FilterChip - A removable badge showing an active filter.
 * Used to display applied filters with quick removal option.
 */
export function FilterChip({ label, value, onRemove, className }: FilterChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
        'bg-oak-primary/10 text-oak-primary border border-oak-primary/20',
        'animate-in fade-in slide-in-from-left-1 duration-200',
        className
      )}
    >
      <span className="text-text-muted">{label}:</span>
      <span className="max-w-[200px] truncate">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          'ml-0.5 p-0.5 rounded-full',
          'hover:bg-oak-primary/20 transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-oak-primary/30'
        )}
        aria-label={`Remove ${label} filter`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

export default FilterChip;
