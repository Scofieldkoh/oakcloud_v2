'use client';

import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { Button } from '@/components/ui/button';
import { useServicesWorkspaceSettings } from '@/hooks/use-services-workspace-settings';
import type { ReactNode } from 'react';
import { ServiceCatalogPanel } from './catalog/service-catalog-panel';
import { DeadlineRulesPanel } from './deadline-rules-panel';
import { BusinessCalendarPanel } from './business-calendar-panel';

/**
 * Page frame shared by the Service Catalog, Deadline Rules and Business
 * Calendar pages under Administration > Services. It owns the access and
 * workspace checks so each page renders only its own panel; the panel's own
 * heading is the page title.
 */
function ServicesAdminShell({
  title,
  children,
}: {
  title: string;
  children: (context: { workspaceId: string; featureEnabled: boolean }) => ReactNode;
}) {
  const { data: session, isLoading } = useSession();
  const workspaceId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId,
  );
  const canAdminister = Boolean(
    session && (session.isSuperAdmin || session.isWorkspaceAdmin),
  );
  const settings = useServicesWorkspaceSettings();

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="p-4 text-sm text-text-secondary sm:p-6"
      >
        Loading services administration…
      </div>
    );
  }

  if (settings.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="p-4 text-sm text-text-secondary sm:p-6"
      >
        Loading Services administration settings…
      </div>
    );
  }

  if (settings.error) {
    return (
      <main className="p-4 sm:p-6">
        <div role="alert" className="space-y-3 rounded-lg border border-status-error/30 bg-status-error/5 p-6 text-sm text-status-error">
          <p>Unable to load Services administration settings.</p>
          <Button type="button" size="sm" variant="danger" className="min-h-11 sm:min-h-8" onClick={() => void settings.refetch()}>
            Retry
          </Button>
        </div>
      </main>
    );
  }

  if (settings.data?.workspaceEnabled !== true) {
    return (
      <main className="p-4 sm:p-6">
        <div role="status" className="rounded-lg border border-border-primary bg-background-secondary p-6 text-sm text-text-secondary">
          Services administration is unavailable for this workspace.
        </div>
      </main>
    );
  }

  if (!canAdminister) {
    return (
      <main className="p-4 sm:p-6">
        <div
          role="alert"
          className="rounded-lg border border-border-primary bg-background-secondary p-6"
        >
          <h1 className="text-lg font-semibold text-text-primary">
            {title}
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Tenant Admin access is required.
          </p>
        </div>
      </main>
    );
  }

  if (!workspaceId) {
    return (
      <main className="p-4 sm:p-6">
        <div
          role="alert"
          className="rounded-lg border border-border-primary bg-background-secondary p-6"
        >
          <h1 className="text-lg font-semibold text-text-primary">
            {title}
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Select a workspace to administer services.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="p-4 sm:p-6">
      {children({ workspaceId, featureEnabled: settings.data.workspaceEnabled })}
    </main>
  );
}

export function ServiceCatalogAdminPage() {
  return (
    <ServicesAdminShell title="Service Catalog">
      {({ workspaceId }) => (
        <ServiceCatalogPanel workspaceId={workspaceId} canCreate canUpdate canDelete />
      )}
    </ServicesAdminShell>
  );
}

export function DeadlineRulesAdminPage() {
  return (
    <ServicesAdminShell title="Deadline Rules">
      {({ workspaceId, featureEnabled }) => (
        <DeadlineRulesPanel workspaceId={workspaceId} featureEnabled={featureEnabled} />
      )}
    </ServicesAdminShell>
  );
}

export function BusinessCalendarAdminPage() {
  return (
    <ServicesAdminShell title="Business Calendar">
      {({ workspaceId, featureEnabled }) => (
        <BusinessCalendarPanel workspaceId={workspaceId} featureEnabled={featureEnabled} />
      )}
    </ServicesAdminShell>
  );
}
