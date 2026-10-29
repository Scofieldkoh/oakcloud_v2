'use client';

import { use, useCallback, useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  AlertCircle,
  Pencil,
  Trash2,
  Upload,
  ExternalLink,
} from 'lucide-react';
import {
  useCompany,
  useDeleteCompany,
  useRetrieveAcra,
  useUpdateCompany,
  useCompanyBizFile,
} from '@/hooks/use-companies';
import { useCompanyContactDetails } from '@/hooks/use-contact-details';
import { usePermissions } from '@/hooks/use-permissions';
import { getEntityTypeLabel } from '@/lib/constants';
import type { UpdateCompanyInput } from '@/lib/validations/company';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { InternalNotes } from '@/components/notes/internal-notes';
import {
  CompanyProfileTab,
  ContactDetailsTab,
  CompanyServicesTab,
  CompanyTabs,
  useTabState,
} from '@/components/companies/company-detail';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { getSafeListReturnUrl } from '@/lib/list-navigation';

// Inner component that uses useSearchParams (needs Suspense boundary)
function CompanyDetailContent({ id }: { id: string }) {
  const router = useRouter();
  const { data: company, isLoading, error, refetch } = useCompany(id);
  const deleteCompany = useDeleteCompany();
  const retrieveAcraMutation = useRetrieveAcra(id);
  const updateCompanyMutation = useUpdateCompany();
  const { success, error: toastError } = useToast();
  // Get permissions for this specific company
  const { can } = usePermissions(id);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { data: bizFileInfo } = useCompanyBizFile(id);

  // URL-persisted tab state
  const [activeTab, setActiveTab] = useTabState();

  // OPTIMIZED: Removed prefetch hooks - let tabs fetch their own data lazily
  // This prevents sequential loading where prefetch waits for company to load first

  // Get contact details to check hasPoc for the warning icon
  const { data: contactDetailsData, refetch: refetchContactDetails } = useCompanyContactDetails(id);

  // OPTIMIZED: Use counts from already-fetched company data instead of separate useCompanyLinkInfo hook
  // Build warning message based on company._count (already fetched with company data)
  const getDeleteWarning = () => {
    const counts = company?._count;
    if (!counts) {
      return 'This action cannot be undone. The company will be soft-deleted and can be restored later.';
    }

    const hasLinks = counts.officers > 0 || counts.shareholders > 0 || counts.charges > 0 || counts.documents > 0;
    if (!hasLinks) {
      return 'This action cannot be undone. The company will be soft-deleted and can be restored later.';
    }

    const parts: string[] = [];
    if (counts.officers > 0) parts.push(`${counts.officers} officer(s)`);
    if (counts.shareholders > 0) parts.push(`${counts.shareholders} shareholder(s)`);
    if (counts.charges > 0) parts.push(`${counts.charges} charge(s)`);
    if (counts.documents > 0) parts.push(`${counts.documents} document(s)`);

    return `Warning: This company has ${parts.join(', ')} linked. Deleting will remove these links, but the underlying data (contacts, documents) will remain. This action cannot be undone.`;
  };

  const handleDeleteConfirm = async (reason?: string) => {
    if (!reason) return;

    try {
      await deleteCompany.mutateAsync({ id, reason });
      success('Company deleted successfully');
      router.push(backHref);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to delete company');
    }
  };

  const handleRefresh = useCallback(() => {
    refetch();
    refetchContactDetails();
  }, [
    refetch,
    refetchContactDetails,
  ]);

  const searchParams = useSearchParams();
  const backHref = getSafeListReturnUrl(searchParams.get('returnTo'), '/companies');
  const refreshToken = searchParams.get('refresh');
  const searchParamsString = searchParams.toString();

  useEffect(() => {
    if (!refreshToken) return;

    handleRefresh();

    const params = new URLSearchParams(searchParamsString);
    params.delete('refresh');
    const next = params.toString();
    router.replace(next ? `/companies/${id}?${next}` : `/companies/${id}`);
  }, [handleRefresh, id, refreshToken, router, searchParamsString]);

  const handleRetrieveAcra = async () => {
    if (!company || isRetrievingAcra) return;

    try {
      const result = await retrieveAcraMutation.mutateAsync();

      const data: UpdateCompanyInput = { id };
      if (result.financialYearEndDay != null) data.financialYearEndDay = result.financialYearEndDay;
      if (result.financialYearEndMonth != null) data.financialYearEndMonth = result.financialYearEndMonth;
      if (result.lastArFiledDate) data.lastArFiledDate = result.lastArFiledDate;
      if (result.accountsDueDate) data.accountsDueDate = result.accountsDueDate;

      await updateCompanyMutation.mutateAsync({ id, data });

      const asOf = result.dataAsOf?.slice(0, 10);
      success(asOf ? `ACRA records retrieved (data as of ${asOf})` : 'ACRA records retrieved successfully');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to retrieve ACRA records');
    }
  };

  const isRetrievingAcra = retrieveAcraMutation.isPending || updateCompanyMutation.isPending;
  const showRetrieveAcraButton = !!company && can.updateCompany;

  useKeyboardShortcuts([
    {
      key: 'Backspace',
      ctrl: true,
      handler: () => router.push(backHref),
      description: 'Back to companies',
    },
    {
      key: 'r',
      ctrl: true,
      handler: handleRefresh,
      description: 'Refresh company',
    },
    ...(can.updateDocument ? [{
      key: 'F2',
      handler: () => router.push(`/companies/upload?companyId=${id}`),
      description: 'Update via BizFile',
    }] : []),
    ...(showRetrieveAcraButton ? [{
      key: 'F3',
      handler: handleRetrieveAcra,
      description: 'Retrieve ACRA',
    }] : []),
    ...(can.updateCompany ? [{
      key: 'e',
      ctrl: true,
      handler: () => router.push(`/companies/${id}/edit`),
      description: 'Edit company',
    }] : []),
  ], !deleteDialogOpen && !isRetrievingAcra);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-64 skeleton" />
          <div className="h-4 w-48 skeleton" />
          <div className="grid grid-cols-3 gap-6">
            <div className="h-32 skeleton rounded-lg" />
            <div className="h-32 skeleton rounded-lg" />
            <div className="h-32 skeleton rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="p-6">
        <div className="card p-8 text-center">
          <AlertCircle className="w-12 h-12 text-status-error mx-auto mb-4" />
          <h2 className="text-lg font-medium text-text-primary mb-2">Company not found</h2>
          <p className="text-text-secondary mb-4">
            {error instanceof Error ? error.message : 'The company you are looking for does not exist.'}
          </p>
          <Link href={backHref} className="btn-primary btn-sm inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Companies
          </Link>
        </div>
      </div>
    );
  }

  const statusConfig: Record<string, { color: string; label: string }> = {
    LIVE: { color: 'badge-success', label: 'Live' },
    STRUCK_OFF: { color: 'badge-error', label: 'Struck Off' },
    WINDING_UP: { color: 'badge-warning', label: 'Winding Up' },
    DISSOLVED: { color: 'badge-neutral', label: 'Dissolved' },
    IN_LIQUIDATION: { color: 'badge-warning', label: 'In Liquidation' },
    IN_RECEIVERSHIP: { color: 'badge-warning', label: 'In Receivership' },
    AMALGAMATED: { color: 'badge-info', label: 'Amalgamated' },
    CONVERTED: { color: 'badge-info', label: 'Converted' },
    OTHER: { color: 'badge-neutral', label: 'Other' },
  };

  const currentStatus = statusConfig[company.status] || { color: 'badge-neutral', label: company.status };
  return (
    <div className="p-4 sm:p-6">
      {/* Approved company identity and actions */}
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <Link
            href={backHref}
            className="mb-3 inline-flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Companies
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-text-primary"><span className="text-oak-primary">{company.name}</span> <span>({company.uen})</span></h1>
            <span className={`badge ${currentStatus.color}`}>
              {currentStatus.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary">{getEntityTypeLabel(company.entityType, true)}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {bizFileInfo ? <button type="button" onClick={() => window.open(bizFileInfo.pdfUrl, '_blank')} className="btn-secondary btn-sm flex items-center gap-2 whitespace-nowrap"><ExternalLink className="h-3.5 w-3.5" />View BizFile</button> : null}
          {can.updateDocument && (
            <Link
              href={`/companies/upload?companyId=${id}`}
              className="btn-secondary btn-sm flex items-center gap-2 whitespace-nowrap"
              title="Update via BizFile (F2)"
            >
              <Upload className="h-3.5 w-3.5" />
              Update via BizFile
            </Link>
          )}
          {can.updateCompany && <Link href={`/companies/${id}/edit`} className="btn-primary btn-sm flex items-center gap-2 whitespace-nowrap" title="Edit (Ctrl+E)"><Pencil className="h-3.5 w-3.5" />Edit</Link>}
          {can.deleteCompany && (
            <button
              onClick={() => setDeleteDialogOpen(true)}
              className="btn-danger btn-sm flex items-center gap-2 whitespace-nowrap"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <CompanyTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hasPoc={contactDetailsData?.hasPoc}
        hasFye={company.financialYearEndMonth != null}
      />

      {/* Tab Content */}
      {activeTab === 'profile' && (
        <CompanyProfileTab
          company={company}
          companyId={id}
          can={can}
          onRetrieveAcra={showRetrieveAcraButton ? handleRetrieveAcra : undefined}
          isRetrievingAcra={isRetrievingAcra}
        />
      )}
      {activeTab === 'contacts' && (
        <ContactDetailsTab
          companyId={id}
          companyName={company.name}
          canEdit={can.updateCompany}
        />
      )}
      {activeTab === 'services' && (
        <CompanyServicesTab companyId={id} canEdit={can.updateCompany} />
      )}

      {/* Internal Notes - Full Width */}
      <InternalNotes
        entityType="company"
        entityId={id}
        canEdit={can.updateCompany}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Company"
        description={`Are you sure you want to delete "${company?.name}"? ${getDeleteWarning()}`}
        confirmLabel="Delete"
        variant="danger"
        requireReason
        reasonLabel="Reason for deletion"
        reasonPlaceholder="Please provide a reason for deleting this company..."
        reasonMinLength={10}
        isLoading={deleteCompany.isPending}
      />

    </div>
  );
}

export default function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <Suspense fallback={
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-64 skeleton" />
          <div className="h-4 w-48 skeleton" />
          <div className="grid grid-cols-3 gap-6">
            <div className="h-32 skeleton rounded-lg" />
            <div className="h-32 skeleton rounded-lg" />
            <div className="h-32 skeleton rounded-lg" />
          </div>
        </div>
      </div>
    }>
      <CompanyDetailContent id={id} />
    </Suspense>
  );
}
