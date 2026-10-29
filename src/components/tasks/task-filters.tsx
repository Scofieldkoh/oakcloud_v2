'use client';

import { CalendarDays, CircleDot, Search, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskListParams } from '@/hooks/use-tasks';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';

interface TaskFiltersProps {
  value: TaskListParams;
  onChange: (value: TaskListParams) => void;
  currentUserId?: string;
  className?: string;
}

export function TaskFilters({
  value,
  onChange,
  currentUserId,
  className,
}: TaskFiltersProps) {
  const toggle = (patch: Partial<TaskListParams>) => {
    onChange({ ...value, ...patch, page: 1 });
  };
  const search = useDebouncedSearch(value.query ?? '', (query) => toggle({ query: query || undefined }));
  const quickFilterClassName = (
    active: boolean,
    disabled = false,
  ) => cn(
    'inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30',
    active
      ? 'bg-oak-primary text-white hover:bg-oak-dark'
      : 'text-text-secondary hover:bg-background-tertiary hover:text-text-primary',
    disabled && 'cursor-not-allowed opacity-50',
  );

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border-primary bg-background-secondary p-4 lg:flex-row lg:items-center',
        className,
      )}
      data-testid="task-filters"
    >
      <label className="relative block flex-1">
        <span className="sr-only">Search tasks</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          aria-label="Search tasks"
          value={search.draft}
          onChange={(event) => search.setDraft(event.target.value)}
          placeholder="Search tasks"
          className="h-10 w-full rounded-lg border border-border-primary bg-background-primary pl-10 pr-3 text-sm text-text-primary transition-colors placeholder:text-text-muted hover:border-oak-primary/50 focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={Boolean(currentUserId && value.ownerId === currentUserId)}
          disabled={!currentUserId}
          onClick={() => toggle({
            ownerId: value.ownerId === currentUserId ? undefined : currentUserId,
          })}
          className={quickFilterClassName(
            Boolean(currentUserId && value.ownerId === currentUserId),
            !currentUserId,
          )}
        >
          <UserRound className="h-4 w-4" aria-hidden="true" />
          Owned by me
        </button>
        <button
          type="button"
          aria-pressed={value.dueBucket === 'thisWeek'}
          onClick={() => toggle({
            dueBucket: value.dueBucket === 'thisWeek' ? undefined : 'thisWeek',
            dueDateFrom: undefined,
            dueDateTo: undefined,
          })}
          className={quickFilterClassName(value.dueBucket === 'thisWeek')}
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          Due this week
        </button>
        <button
          type="button"
          aria-pressed={value.status === 'IN_PROGRESS'}
          onClick={() => toggle({
            status: value.status === 'IN_PROGRESS' ? undefined : 'IN_PROGRESS',
          })}
          className={quickFilterClassName(value.status === 'IN_PROGRESS')}
        >
          <CircleDot className="h-4 w-4" aria-hidden="true" />
          In Progress
        </button>
      </div>
    </div>
  );
}
