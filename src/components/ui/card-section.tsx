'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CardSectionProps {
  /** Section title displayed in the header */
  title: string;
  /** Icon element displayed before the title */
  icon?: React.ReactNode;
  /** Content to render inside the section */
  children: React.ReactNode;
  /** Whether the section is expanded by default */
  defaultOpen?: boolean;
  /** Badge text shown next to the title (e.g., count) */
  badge?: string;
  /** Additional classes for the section container */
  className?: string;
  /** Additional classes for the header button */
  headerClassName?: string;
  /** Whether the section can be collapsed (default: true) */
  collapsible?: boolean;
  /** Content to render on the right side of the header */
  rightContent?: React.ReactNode;
  /** Unique identifier for ARIA support */
  id?: string;
}

/**
 * A collapsible card section component with header, icon, and optional badge.
 * Supports ARIA attributes for accessibility.
 */
export function CardSection({
  title,
  icon,
  children,
  defaultOpen = true,
  badge,
  className,
  headerClassName,
  collapsible = true,
  rightContent,
  id,
}: CardSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const headingId = id ? `${id}-heading` : undefined;
  const contentId = id ? `${id}-content` : undefined;

  const handleToggle = () => {
    if (collapsible) {
      setIsOpen(!isOpen);
    }
  };

  const HeaderWrapper = collapsible ? 'button' : 'div';
  const headerProps = collapsible
    ? {
        type: 'button' as const,
        onClick: handleToggle,
        'aria-expanded': isOpen,
        'aria-controls': contentId,
      }
    : {};

  return (
    <section className={cn('card overflow-hidden', className)} aria-labelledby={headingId}>
      <HeaderWrapper
        {...headerProps}
        className={cn(
          'w-full p-4 flex items-center justify-between gap-3 bg-background-secondary/30 border-b border-border-primary transition-colors',
          collapsible && 'hover:bg-background-secondary/50 cursor-pointer',
          !collapsible && 'cursor-default',
          headerClassName
        )}
      >
        <div className="flex items-center gap-3">
          {icon && (
            <div className="p-1.5 rounded-md bg-oak-primary/10 text-oak-primary">
              {icon}
            </div>
          )}
          <h2 id={headingId} className="font-medium text-text-primary text-sm">
            {title}
          </h2>
          {badge && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-oak-primary/10 text-oak-primary font-medium">
              {badge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {rightContent}
          {collapsible && (
            isOpen ? (
              <ChevronUp className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            )
          )}
        </div>
      </HeaderWrapper>
      <div
        id={contentId}
        className={cn(
          'transition-all duration-200 ease-in-out overflow-hidden',
          isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="p-4">{children}</div>
      </div>
    </section>
  );
}
