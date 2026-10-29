'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2, Save, ShieldAlert, Upload } from 'lucide-react';
import { CompanyCreateWorkspace, type CompanyCreateProfile } from '@/components/companies/company-edit/company-create-workspace';
import { useSession } from '@/hooks/use-auth';
import { useCreateCompany } from '@/hooks/use-companies';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { usePermissions } from '@/hooks/use-permissions';
import { useUnsavedNavigationGuard } from '@/hooks/use-unsaved-navigation-guard';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { createCompanyRequestSchema, type CreateCompanyRequestInput } from '@/lib/validations/company';
import { readTaskLaunchContext, withTaskLaunchContext } from '@/lib/task-launch-context';
import type { PendingSharePointSelection } from '@/components/companies/company-create-sharepoint-field';

const formId = 'add-company-form';

function createRequest(profile: CompanyCreateProfile): CreateCompanyRequestInput {
  const identity = profile.identity as Record<string, unknown>;
  const activities = profile.activities as { primary?: { code?: string; description?: string } | null; secondary?: { code?: string; description?: string } | null };
  const compliance = profile.compliance as Record<string, unknown>;
  const capital = profile.capital as Record<string, unknown>;
  const additional = profile.additional as Record<string, unknown>;

  return createCompanyRequestSchema.parse({
    ...identity,
    uen: String(identity.uen ?? '').toUpperCase(),
    primarySsicCode: activities.primary?.code ?? null,
    primarySsicDescription: activities.primary?.description ?? null,
    secondarySsicCode: activities.secondary?.code ?? null,
    secondarySsicDescription: activities.secondary?.description ?? null,
    financialYearEndDay: compliance.financialYearEndDay,
    financialYearEndMonth: compliance.financialYearEndMonth,
    fyeAsAtLastAr: compliance.fyeAsAtLastAr,
    homeCurrency: compliance.homeCurrency,
    paidUpCapitalCurrency: capital.paidUpCapitalCurrency,
    paidUpCapitalAmount: capital.paidUpCapitalAmount,
    issuedCapitalCurrency: capital.issuedCapitalCurrency,
    issuedCapitalAmount: capital.issuedCapitalAmount,
    formerName: additional.formerName,
    dateOfNameChange: additional.dateOfNameChange,
    registrationDate: additional.registrationDate,
    isGstRegistered: false,
    profileSections: profile,
  });
}

export default function NewCompanyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskContext = useMemo(() => readTaskLaunchContext(searchParams), [searchParams]);
  const returnHref = taskContext?.returnTo ?? '/companies';
  const { data: session } = useSession();
  const createCompany = useCreateCompany();
  const { can, isLoading: permissionsLoading } = usePermissions();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [sharePointSelection, setSharePointSelection] = useState<PendingSharePointSelection>({ kind: 'unmapped' });
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(null);
  const isSuperAdmin = session?.isSuperAdmin ?? false;
  const activeTenantId = useActiveWorkspaceId(isSuperAdmin, session?.tenantId);
  const isSubmitting = createCompany.isPending;

  const navigationGuard = useUnsavedNavigationGuard(isDirty && !isSubmitting);

  const handleCancel = () => navigationGuard.requestNavigation(returnHref);
  const submitForm = () => {
    const form = document.getElementById(formId);
    if (form instanceof HTMLFormElement) form.requestSubmit();
  };

  const onSubmit = async (profile: CompanyCreateProfile) => {
    setSubmitError(null);
    if (isSuperAdmin && !activeTenantId) {
      setSubmitError('Please select a tenant before creating a company');
      return;
    }
    try {
      const company = await createCompany.mutateAsync({
        ...createRequest(profile),
        ...(isSuperAdmin && activeTenantId ? { tenantId: activeTenantId } : {}),
        taskContext,
      });
      if (sharePointSelection.kind !== 'unmapped') {
        try {
          let folder = sharePointSelection.kind === 'selected' ? sharePointSelection.folder : null;
          if (!folder) {
            const rootResponse = await fetch(`/api/settings/sharepoint-filing?connectorId=${encodeURIComponent(sharePointSelection.connectorId)}`);
            const settings = await rootResponse.json() as { clientDocumentsRoot?: { itemId: string } };
            if (!settings.clientDocumentsRoot) throw new Error('Client Documents root is not configured');
            if (sharePointSelection.kind !== 'requested') throw new Error('A SharePoint folder selection is incomplete');
            const folderResponse = await fetch('/api/sharepoint/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectorId: sharePointSelection.connectorId, parentItemId: settings.clientDocumentsRoot.itemId, name: sharePointSelection.name, mode: 'client-folder' }) });
            const folderBody = await folderResponse.json();
            if (!folderResponse.ok) throw new Error(folderBody.error || 'SharePoint folder could not be created');
            folder = folderBody;
          }
          const mappingResponse = await fetch(`/api/companies/${company.id}/sharepoint-folder`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectorId: sharePointSelection.connectorId, folder }) });
          const mappingBody = await mappingResponse.json();
          if (!mappingResponse.ok) throw new Error(mappingBody.error || 'SharePoint company mapping failed');
        } catch (mappingError) {
          setCreatedCompanyId(company.id);
          setSubmitError(`Company created, but SharePoint setup needs attention: ${mappingError instanceof Error ? mappingError.message : 'mapping failed'}`);
          setIsDirty(false);
          return;
        }
      }
      setIsDirty(false);
      router.push(taskContext?.returnTo ?? `/companies/${company.id}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to create company');
    }
  };

  useKeyboardShortcuts([
    { key: 'Backspace', ctrl: true, handler: handleCancel, description: 'Cancel and go back' },
    { key: 's', ctrl: true, handler: submitForm, description: 'Create company' },
    { key: 'F2', handler: () => navigationGuard.requestNavigation(withTaskLaunchContext('/companies/upload', taskContext)), description: 'Upload BizFile' },
  ], !isSubmitting);

  if (permissionsLoading) return <div className="flex min-h-[400px] items-center justify-center p-6"><Loader2 className="h-8 w-8 animate-spin text-oak-primary" /></div>;
  if (!can.createCompany) return <div className="p-4 sm:p-6"><div className="card p-8 text-center"><ShieldAlert className="mx-auto mb-4 h-12 w-12 text-status-warning" /><h1 className="mb-2 text-lg font-medium text-text-primary">Access denied</h1><p className="mb-4 text-sm text-text-secondary">You do not have permission to create companies.</p><Link href={returnHref} className="btn-primary btn-sm inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4" />Back to companies</Link></div></div>;

  return <main className="mx-auto max-w-5xl p-4 sm:p-6">
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><Link href={returnHref} className="mb-3 inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"><ArrowLeft className="h-4 w-4" />Back to companies</Link><h1 className="text-xl font-semibold text-text-primary">Add Company</h1><p className="mt-1 text-sm text-text-secondary">Complete the company profile or upload a BizFile for automatic extraction.</p></div>
      <Link href={withTaskLaunchContext('/companies/upload', taskContext)} className="btn-secondary btn-sm inline-flex items-center gap-2"><Upload className="h-4 w-4" />Upload BizFile (F2)</Link>
    </div>

    {submitError ? <div className="card mb-4 border-status-error bg-status-error/5"><div className="flex items-center gap-3 text-status-error"><AlertCircle className="h-5 w-5" /><p>{submitError}</p></div>{createdCompanyId ? <Link className="mt-3 inline-flex text-sm text-oak-primary hover:underline" href={`/companies/${createdCompanyId}`}>Open the company to retry SharePoint setup</Link> : null}</div> : null}
    {isSuperAdmin && !activeTenantId ? <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"><p className="text-sm text-amber-800 dark:text-amber-200">Please select a tenant from the sidebar to create a company.</p></div> : null}

    <CompanyCreateWorkspace formId={formId} onSubmit={onSubmit} onSharePointSelectionChange={setSharePointSelection} onDirtyChange={setIsDirty} actions={<div className="flex items-center justify-end gap-3 pt-2"><Link href={returnHref} className="btn-secondary btn-sm" title="Cancel (Ctrl+Backspace)">Cancel (Ctrl+Backspace)</Link><button type="submit" disabled={isSubmitting} className="btn-primary btn-sm flex items-center gap-2" title="Create Company (Ctrl+S)"><Save className="h-4 w-4" />{isSubmitting ? 'Creating...' : 'Create Company (Ctrl+S)'}</button></div>} />
    {navigationGuard.dialog}
  </main>;
}
