'use client';

import { use } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Loader2, ShieldAlert, Upload } from 'lucide-react';
import { useCompany } from '@/hooks/use-companies';
import { usePermissions } from '@/hooks/use-permissions';
import { CompanyEditWorkspace } from '@/components/companies/company-edit/company-edit-workspace';
import { CompanySharePointFolderField } from '@/components/companies/company-sharepoint-folder-field';

export default function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: company, isLoading, error } = useCompany(id);
  const { can, isLoading: permissionsLoading } = usePermissions(id);

  if (isLoading || permissionsLoading) return <div className="flex min-h-[400px] items-center justify-center p-6"><Loader2 className="h-8 w-8 animate-spin text-oak-primary" /></div>;
  if (!can.updateCompany) return <div className="p-4 sm:p-6"><div className="card p-8 text-center"><ShieldAlert className="mx-auto mb-4 h-12 w-12 text-status-warning" /><h1 className="mb-2 text-lg font-medium text-text-primary">Access denied</h1><p className="mb-4 text-sm text-text-secondary">You do not have permission to edit this company.</p><Link href={`/companies/${id}`} className="btn-primary btn-sm inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4" />Back to company</Link></div></div>;
  if (error || !company) return <div className="p-4 sm:p-6"><div className="card p-8 text-center"><AlertCircle className="mx-auto mb-4 h-12 w-12 text-status-error" /><h1 className="mb-2 text-lg font-medium text-text-primary">Company not found</h1><p className="mb-4 text-sm text-text-secondary">{error instanceof Error ? error.message : 'The company does not exist.'}</p><Link href="/companies" className="btn-primary btn-sm inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4" />Back to companies</Link></div></div>;

  return <main className="mx-auto max-w-5xl p-4 sm:p-6">
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><Link href={`/companies/${id}`} className="mb-3 inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"><ArrowLeft className="h-4 w-4" />Back to company</Link><h1 className="text-xl font-semibold text-text-primary">Edit {company.name} ({company.uen})</h1><p className="mt-1 text-sm text-text-secondary">Save each company profile section independently.</p></div>
      {can.updateDocument ? <Link href={`/companies/upload?companyId=${id}`} className="btn-secondary btn-sm inline-flex items-center gap-2"><Upload className="h-4 w-4" />Update via BizFile</Link> : null}
    </div>
    <CompanyEditWorkspace companyId={id} />
    <section className="rounded-xl border border-border-primary bg-background-secondary">
      <div className="border-b border-border-primary p-4">
        <h2 className="text-sm font-semibold text-text-primary">Additional company integrations</h2>
        <p className="mt-1 text-xs text-text-secondary">Manage the explicit SharePoint company-folder mapping used for future signed-document filing.</p>
      </div>
      <CompanySharePointFolderField company={company} canEdit={can.updateCompany} />
    </section>
  </main>;
}
