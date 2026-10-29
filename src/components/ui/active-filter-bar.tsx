'use client';

import { cn } from '@/lib/utils';
import { FilterChip } from './filter-chip';

export interface ActiveFilter {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

interface ActiveFilterBarProps {
  filters: ActiveFilter[];
  onClearAll: () => void;
  className?: string;
}

/** Removable chips for the filters in use, with a Clear all link. Renders nothing when no filter is set. */
export function ActiveFilterBar({ filters, onClearAll, className }: ActiveFilterBarProps) {
  if (filters.length === 0) return null;
  return (
    <div aria-label="Active filters" className={cn('flex flex-wrap items-center gap-2', className)}>
      {filters.map((filter) => (
        <FilterChip key={filter.key} label={filter.label} value={filter.value} onRemove={filter.onRemove} />
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-2 text-sm font-medium text-oak-primary transition-colors hover:text-oak-primary/80"
      >
        Clear all
      </button>
    </div>
  );
}
