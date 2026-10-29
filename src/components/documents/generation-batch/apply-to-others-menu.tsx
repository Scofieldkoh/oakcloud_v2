'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { useClickOutside } from '@/hooks/use-click-outside';
import { cn } from '@/lib/utils';

export type ApplyScope = 'all' | 'incomplete';

export interface ApplyToOthersMenuProps {
  /** Section name used in the menu copy, e.g. "parties". */
  label: string;
  /** Number of other editable documents in the batch. */
  otherCount: number;
  /** Number of other documents that still need required values. */
  incompleteCount: number;
  onApply: (scope: ApplyScope) => void;
  disabled?: boolean;
  header?: boolean;
}

/**
 * Propagates one section of the active document's configuration onto the other
 * documents in the batch. Without this, configuring a batch degenerates into
 * retyping the same values N times.
 */
export function ApplyToOthersMenu({
  label,
  otherCount,
  incompleteCount,
  onApply,
  disabled = false,
  header = false,
}: ApplyToOthersMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useClickOutside<HTMLDivElement>(() => setOpen(false), open);

  if (otherCount === 0) return null;

  const apply = (scope: ApplyScope) => {
    setOpen(false);
    onApply(scope);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
          header
            ? 'border-white/50 text-white hover:bg-white/10'
            : 'border-border-primary text-oak-primary hover:bg-oak-primary/5',
          disabled && 'cursor-not-allowed opacity-40',
        )}
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        Apply to others
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`Apply ${label} to other documents`}
          className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-border-primary bg-background-elevated shadow-elevation-2"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => apply('all')}
            className="flex min-h-11 w-full flex-col justify-center px-3 py-2 text-left transition-colors hover:bg-background-tertiary"
          >
            <span className="text-sm font-medium text-text-primary">
              All {otherCount} other document{otherCount === 1 ? '' : 's'}
            </span>
            <span className="text-xs text-text-muted">
              Overwrites {label} everywhere in this batch
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => apply('incomplete')}
            disabled={incompleteCount === 0}
            className="flex min-h-11 w-full flex-col justify-center border-t border-border-secondary px-3 py-2 text-left transition-colors hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="text-sm font-medium text-text-primary">
              Only incomplete ({incompleteCount})
            </span>
            <span className="text-xs text-text-muted">
              Leaves already-complete documents untouched
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
