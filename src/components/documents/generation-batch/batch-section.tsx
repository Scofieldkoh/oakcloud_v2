'use client';

import { useId, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BatchSectionProps {
  title: string;
  /**
   * Optional completion summary rendered in the header so a collapsed section
   * still tells the user whether it needs attention.
   */
  status?: { complete: boolean; label: string } | null;
  /** Header-aligned control, e.g. an apply-to-others menu. */
  action?: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  children: ReactNode;
}

export function BatchSection({
  title,
  status = null,
  action,
  defaultOpen = true,
  collapsible = true,
  children,
}: BatchSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const headingId = `${contentId}-heading`;
  const expanded = collapsible ? open : true;

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-lg border border-border-primary bg-background-primary"
    >
      <header
        className={cn(
          'flex min-h-12 flex-wrap items-center gap-2 px-3 py-2.5 text-white',
          status && !status.complete ? 'bg-[#9b6348]' : 'bg-oak-primary',
        )}
      >
        {collapsible ? (
          <h3 id={headingId} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={expanded}
              aria-controls={contentId}
              className="flex min-h-9 w-full min-w-0 items-center gap-2 text-left"
            >
              <span className="block min-w-0 text-sm font-medium text-white">
                {title}
              </span>
              <span className="ml-auto shrink-0 text-white/70">
                {expanded
                  ? <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
              </span>
            </button>
          </h3>
        ) : (
          <div className="min-w-0 flex-1">
            <h3 id={headingId} className="text-sm font-medium text-white">{title}</h3>
          </div>
        )}

        {status && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              status.complete
                ? 'bg-white/15 text-white'
                : 'bg-status-warning/20 text-white',
            )}
          >
            {status.complete
              ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              : <AlertCircle className="h-3 w-3" aria-hidden="true" />}
            {status.label}
          </span>
        )}

        {action && <div className="shrink-0">{action}</div>}
      </header>

      {expanded && (
        <div id={contentId} className="border-t border-border-secondary p-3">
          {children}
        </div>
      )}
    </section>
  );
}
