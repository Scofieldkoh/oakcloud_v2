'use client';

import type { ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export const quickFilterButtonClass =
  'btn-sm inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 focus-visible:ring-offset-2 sm:min-h-8';

export function ServiceFilterToolbar({
  label,
  children,
  onAdjustColumns,
  hiddenColumnCount = 0,
  className,
}: {
  label: string;
  children: ReactNode;
  onAdjustColumns?: () => void;
  hiddenColumnCount?: number;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border-primary bg-background-secondary p-4 lg:flex-row lg:items-center',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {onAdjustColumns ? (
        <button
          type="button"
          onClick={onAdjustColumns}
          className="btn-secondary btn-sm inline-flex min-h-11 shrink-0 items-center gap-2 self-start sm:min-h-8 lg:self-auto"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          <span>Columns</span>
          {hiddenColumnCount > 0 ? (
            <span className="min-w-[18px] rounded-full bg-background-tertiary px-1.5 py-0.5 text-center text-2xs text-text-secondary">
              {hiddenColumnCount}
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  );
}

export function quickFilterClass(selected: boolean): string {
  return cn(
    quickFilterButtonClass,
    selected
      ? 'bg-oak-primary text-white hover:bg-oak-dark'
      : 'btn-ghost text-text-secondary hover:text-text-primary',
  );
}
