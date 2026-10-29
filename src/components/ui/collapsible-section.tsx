'use client';

import { useState, useId, ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { InfoTip } from '@/components/ui/info-tip';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
  /** Title shown in the header */
  title: string;
  /** Optional count to show as badge */
  count?: number;
  /** Content to show when expanded */
  children: ReactNode;
  /** Whether to start collapsed on mobile (default: true) */
  defaultCollapsedMobile?: boolean;
  /** Whether to start collapsed on desktop (default: false) */
  defaultCollapsedDesktop?: boolean;
  /** Optional class for the container */
  className?: string;
  /** Optional class for the content wrapper */
  contentClassName?: string;
  /**
   * `panel` is the compact form for side panels: a small uppercase title
   * on an Oaktree green bar, with a chevron, no Show/Hide text and no
   * bottom margin.
   */
  variant?: 'default' | 'panel';
  /** Panel only: help text behind an information icon beside the title. */
  info?: ReactNode;
  /** Controls beside the title (e.g. an Add button), outside the toggle. */
  action?: ReactNode;
  /** Controlled collapse state; pair with onCollapsedChange. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

/**
 * A collapsible section that can be expanded/collapsed.
 * Collapsed by default on mobile, expanded on desktop.
 */
export function CollapsibleSection({
  title,
  count,
  children,
  defaultCollapsedMobile = true,
  defaultCollapsedDesktop = false,
  className,
  contentClassName,
  variant = 'default',
  info,
  action,
  collapsed,
  onCollapsedChange,
}: CollapsibleSectionProps) {
  // Determine initial state based on screen size
  // Using a simple check - could be enhanced with useIsMobile hook
  const [localCollapsed, setLocalCollapsed] = useState(() => {
    if (typeof window === 'undefined') return defaultCollapsedMobile;
    return window.innerWidth < 768 ? defaultCollapsedMobile : defaultCollapsedDesktop;
  });
  const isCollapsed = collapsed ?? localCollapsed;
  const setIsCollapsed = (next: boolean) => {
    if (collapsed === undefined) setLocalCollapsed(next);
    onCollapsedChange?.(next);
  };

  // Generate unique IDs for ARIA relationships
  const contentId = useId();

  if (variant === 'panel') {
    const Chevron = isCollapsed ? ChevronRight : ChevronDown;
    return (
      <section className={className}>
        {/* Clicks on the bar's empty space toggle it too; the title button is the keyboard control. */}
        <div
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsCollapsed(!isCollapsed);
          }}
          className="flex h-8 cursor-pointer items-center gap-1 rounded-md bg-oak-primary pr-1 text-white"
        >
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            aria-expanded={!isCollapsed}
            aria-controls={contentId}
            title={title}
            className="flex h-full min-w-0 items-center gap-1 pl-2 text-left"
          >
            <Chevron className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true" />
            <h2 className="truncate text-xs font-semibold uppercase tracking-wide">
              {title}
            </h2>
            {count !== undefined && (
              <span className="shrink-0 rounded bg-white/20 px-1.5 text-[11px]">
                {count}
              </span>
            )}
          </button>
          {info ? <InfoTip content={info} label={`About ${title}`} /> : null}
          {action ? <div className="ml-auto">{action}</div> : null}
        </div>
        {!isCollapsed && (
          <div id={contentId} role="region" aria-label={title} className={cn('pt-1.5', contentClassName)}>
            {children}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className={cn('mb-6', className)}>
      {/* Header - always visible */}
      <button
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-expanded={!isCollapsed}
        aria-controls={contentId}
        className="w-full flex items-center justify-between gap-2 py-2 text-left group"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-secondary">{title}</span>
          {count !== undefined && (
            <span className="text-xs bg-background-tertiary text-text-muted px-1.5 py-0.5 rounded">
              {count}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-text-muted group-hover:text-text-secondary transition-colors">
          <span className="text-xs">{isCollapsed ? 'Show' : 'Hide'}</span>
          {isCollapsed ? (
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          ) : (
            <ChevronUp className="w-4 h-4" aria-hidden="true" />
          )}
        </div>
      </button>

      {/* Content - collapsible */}
      <div
        id={contentId}
        role="region"
        aria-label={title}
        className={cn(
          // Grid rows animate to the content's own height, so long content isn't clipped.
          'grid transition-all duration-200',
          isCollapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
        )}
      >
        <div className={cn('min-h-0 overflow-hidden', contentClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * A simpler version that only collapses on mobile.
 * On desktop, the toggle button is hidden and content is always visible.
 */
export function MobileCollapsibleSection({
  title,
  count,
  children,
  defaultCollapsed = true,
  className,
  contentClassName,
}: Omit<CollapsibleSectionProps, 'defaultCollapsedMobile' | 'defaultCollapsedDesktop'> & {
  defaultCollapsed?: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const contentId = useId();

  return (
    <div className={cn('mb-6', className)}>
      {/* Mobile Header - only visible on mobile */}
      <button
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-expanded={!isCollapsed}
        aria-controls={contentId}
        className="md:hidden w-full flex items-center justify-between gap-2 py-2 text-left group"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-secondary">{title}</span>
          {count !== undefined && (
            <span className="text-xs bg-background-tertiary text-text-muted px-1.5 py-0.5 rounded">
              {count}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-text-muted group-hover:text-text-secondary transition-colors">
          <span className="text-xs">{isCollapsed ? 'Show' : 'Hide'}</span>
          {isCollapsed ? (
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          ) : (
            <ChevronUp className="w-4 h-4" aria-hidden="true" />
          )}
        </div>
      </button>

      {/* Content - collapsible on mobile, always visible on desktop */}
      <div
        id={contentId}
        role="region"
        aria-label={title}
        className={cn(
          'md:block',
          // Mobile: animate collapse/expand
          isCollapsed ? 'hidden' : 'block',
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
