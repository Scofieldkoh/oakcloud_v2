'use client';

import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { ServiceFilterToolbar } from '@/components/services/shared/service-filter-toolbar';
import { useSession } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';

/** Search box, quick filters and Columns button above a library table. */
export function LibraryToolbar({
  label,
  searchLabel,
  searchPlaceholder,
  search,
  onSearchChange,
  onSearchClear,
  hiddenColumnCount,
  onAdjustColumns,
  children,
}: {
  label: string;
  searchLabel: string;
  searchPlaceholder: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  hiddenColumnCount: number;
  onAdjustColumns: () => void;
  children?: ReactNode;
}) {
  return (
    <ServiceFilterToolbar label={label} onAdjustColumns={onAdjustColumns} hiddenColumnCount={hiddenColumnCount}>
      <label className="relative flex min-h-11 min-w-[220px] flex-1 items-center rounded-lg border border-border-primary bg-background-primary focus-within:border-oak-primary focus-within:ring-2 focus-within:ring-oak-primary/20 sm:min-h-8">
        <Search className="ml-3 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        <span className="sr-only">{searchLabel}</span>
        <input
          type="text"
          role="searchbox"
          aria-label={searchLabel}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-11 min-w-0 flex-1 bg-transparent px-2 text-sm text-text-primary outline-none placeholder:text-text-muted sm:h-8"
        />
        {search ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={onSearchClear}
            className="mr-2 flex min-h-11 min-w-11 items-center justify-center rounded text-text-muted hover:bg-background-tertiary sm:min-h-8 sm:min-w-8"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {children}
      </div>
    </ServiceFilterToolbar>
  );
}

type Permissions = ReturnType<typeof usePermissions>['can'];

/** Page frame shared by the Document Templates and Partials pages. */
export function TemplateLibraryShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  /** Header buttons, such as New Word Template; given the user's permissions. */
  actions?: (can: Permissions) => ReactNode;
  children: (context: { activeTenantId: string; can: Permissions; isSuperAdmin: boolean }) => ReactNode;
}) {
  const { data: session } = useSession();
  const { can } = usePermissions();
  const isSuperAdmin = session?.isSuperAdmin ?? false;
  const activeTenantId = useActiveWorkspaceId(isSuperAdmin, session?.tenantId);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">{title}</h1>
          <p className="text-sm text-text-secondary mt-1">{description}</p>
        </div>
        {activeTenantId && actions ? <div className="flex flex-wrap items-center gap-3">{actions(can)}</div> : null}
      </div>
      {activeTenantId ? children({ activeTenantId, can, isSuperAdmin }) : null}
    </div>
  );
}
