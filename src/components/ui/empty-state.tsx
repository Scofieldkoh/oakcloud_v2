'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Buttons or links for the next step, such as Clear filters or Add company. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Standard "nothing here" message for lists and tables: an icon, a title, one
 * line saying why, and the next step. Use "No matching …" with a Clear filters
 * action when filters or a search are set, and "No … yet" with a create action
 * when the list is truly empty.
 */
export function EmptyState({ icon: Icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <div role="status" className={cn('px-4 py-10 text-center', className)}>
      {Icon ? (
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-oak-primary/10 text-oak-primary">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
      ) : null}
      <p className={cn('text-base font-semibold text-text-primary', Icon && 'mt-3')}>{title}</p>
      {description ? <p className="mx-auto mt-1.5 max-w-md text-sm text-text-secondary">{description}</p> : null}
      {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface ListEmptyStateProps {
  icon?: LucideIcon;
  /** Plural noun in lower case, such as "companies". */
  noun: string;
  /** True when a search or filter is narrowing the list. */
  filtered: boolean;
  onClearFilters?: () => void;
  /** Shown when nothing exists yet, such as an Add company link. */
  createAction?: ReactNode;
  /** Shown when nothing exists yet. */
  emptyDescription?: ReactNode;
  className?: string;
}

/** Empty list: "No matching …" with Clear filters when filtered, else "No … yet" with the create action. */
export function ListEmptyState({ icon, noun, filtered, onClearFilters, createAction, emptyDescription, className }: ListEmptyStateProps) {
  if (filtered) {
    return (
      <EmptyState
        icon={icon}
        title={`No matching ${noun}`}
        description={`No ${noun} match your current search and filters.`}
        actions={onClearFilters ? <Button variant="secondary" size="sm" onClick={onClearFilters}>Clear filters</Button> : undefined}
        className={className}
      />
    );
  }
  return <EmptyState icon={icon} title={`No ${noun} yet`} description={emptyDescription} actions={createAction} className={className} />;
}
