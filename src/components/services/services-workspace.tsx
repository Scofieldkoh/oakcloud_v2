'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useServicesWorkspaceSettings } from '@/hooks/use-services-workspace-settings';
import { ServiceRoster } from '@/components/services/roster/service-roster';
import { DeadlineViewToggle, DeadlineWorkspace } from '@/components/services/deadlines/deadline-workspace';
import { BillingWorkspace } from '@/components/services/billing/billing-workspace';

type ServicesWorkspaceSection = 'services' | 'deadlines' | 'billing';

const pageContent: Record<ServicesWorkspaceSection, { title: string; description: string }> = {
  services: {
    title: 'Services',
    description: 'Manage active client services across your workspace.',
  },
  deadlines: {
    title: 'Deadlines',
    description: 'Monitor and update service deadlines across your workspace.',
  },
  billing: {
    title: 'Billing',
    description: 'Review billing occurrences and mark them as billed.',
  },
};

interface ServicesWorkspaceProps {
  workspaceId?: string;
  canEdit?: boolean;
  canCreate?: boolean;
}

function sectionFromPathname(pathname: string): ServicesWorkspaceSection {
  if (pathname === '/deadlines' || pathname.startsWith('/deadlines/')) return 'deadlines';
  if (pathname === '/billing' || pathname.startsWith('/billing/')) return 'billing';
  return 'services';
}

export function ServicesWorkspace({ workspaceId, canEdit = true, canCreate = true }: ServicesWorkspaceProps) {
  const pathname = usePathname();
  const settings = useServicesWorkspaceSettings();
  const section = sectionFromPathname(pathname);
  const content = pageContent[section];
  const [addServiceDialogOpen, setAddServiceDialogOpen] = useState(false);

  if (settings.isLoading) {
    return <div role="status" className="p-4 text-sm text-text-secondary sm:p-6">Loading Services workspace…</div>;
  }

  if (settings.error) {
    return <div role="alert" className="m-4 rounded-xl border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error sm:m-6">Unable to load Services workspace settings.</div>;
  }

  if (settings.data?.workspaceEnabled !== true) {
    return (
      <div role="status" className="m-4 rounded-xl border border-border-primary bg-background-secondary p-4 text-sm text-text-secondary sm:m-6">
        Services workspace is unavailable for this workspace.
      </div>
    );
  }

  return (
    <main className="p-4 sm:p-6">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary sm:text-2xl">{content.title}</h1>
          <p className="mt-1 text-sm text-text-secondary">{content.description}</p>
        </div>
        {section === 'services' && canCreate ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button className="min-h-11 sm:min-h-8" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAddServiceDialogOpen(true)}>Add service</Button>
          </div>
        ) : section === 'deadlines' ? (
          <div className="flex flex-wrap items-center gap-3">
            <DeadlineViewToggle />
          </div>
        ) : null}
      </header>

      {section === 'services' ? (
        <ServiceRoster
          workspaceId={workspaceId}
          canEdit={canEdit}
          addServiceDialogOpen={addServiceDialogOpen}
          onAddServiceDialogOpenChange={setAddServiceDialogOpen}
        />
      ) : section === 'deadlines' ? (
        <DeadlineWorkspace workspaceId={workspaceId} canEdit={canEdit} deadlineWritesEnabled={settings.data.deadlineWritesEnabled} />
      ) : (
        <BillingWorkspace workspaceId={workspaceId} canEdit={canEdit} />
      )}
    </main>
  );
}
