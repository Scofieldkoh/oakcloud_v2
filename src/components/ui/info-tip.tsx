'use client';

import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface InfoTipProps {
  /** The help text, shown on hover or focus. */
  content: ReactNode;
  /** What the help is about, for screen readers: "About New section". */
  label: string;
  className?: string;
}

/**
 * A small information icon beside a header whose help text shows in a
 * tooltip, instead of a hint line under the header.
 */
export function InfoTip({ content, label, className }: InfoTipProps) {
  return (
    <Tooltip content={content}>
      <button
        type="button"
        aria-label={label}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => event.currentTarget.focus()}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full p-0.5 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-oak-primary/40',
          className,
        )}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
