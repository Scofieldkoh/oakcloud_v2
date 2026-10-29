'use client';

import { useState } from 'react';
import { useSession } from '@/hooks/use-auth';
import {
  usePurgeData,
  usePurgeRecords,
  useRestoreRecords,
  type PurgeableEntity,
  type PurgeableUser,
  type PurgeableCompany,
  type PurgeableContact,
  type PurgeableGeneratedDocument,
  type PurgeableProcessingDocument,
  type PurgeableDocumentTemplate,
  type PurgeableTemplatePartial,
} from '@/hooks/use-admin';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { BulkActionsToolbar } from '@/components/ui/bulk-actions-toolbar';
import { useToast } from '@/components/ui/toast';
import { Pagination } from '@/components/ui/pagination';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Trash2,
  AlertTriangle,
  Users,
  Building2,
  Contact,
  RefreshCw,
  RotateCcw,
  FileText,
  FileStack,
  LayoutTemplate,
  Puzzle,
} from 'lucide-react';
import { MobileCollapsibleSection } from '@/components/ui/collapsible-section';
import { MobileCard, CardDetailsGrid, CardDetailItem } from '@/components/ui/responsive-table';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

type TabType =
  | 'users'
  | 'companies'
  | 'contacts'
  | 'generatedDocuments'
  | 'processingDocuments'
  | 'documentTemplates'
  | 'templatePartials';

const TABS: {
  id: TabType;
  label: string;
  /** Plural noun for messages, e.g. "No soft-deleted templates found". */
  noun: string;
  icon: React.ReactNode;
  entityType: PurgeableEntity;
}[] = [
  { id: 'users', label: 'Users', noun: 'users', icon: <Users className="w-4 h-4" />, entityType: 'user' },
  { id: 'companies', label: 'Companies', noun: 'companies', icon: <Building2 className="w-4 h-4" />, entityType: 'company' },
  { id: 'contacts', label: 'Contacts', noun: 'contacts', icon: <Contact className="w-4 h-4" />, entityType: 'contact' },
  { id: 'generatedDocuments', label: 'Generated Docs', noun: 'documents', icon: <FileText className="w-4 h-4" />, entityType: 'generatedDocument' },
  { id: 'processingDocuments', label: 'Processing Docs', noun: 'processing documents', icon: <FileStack className="w-4 h-4" />, entityType: 'processingDocument' },
  { id: 'documentTemplates', label: 'Templates', noun: 'templates', icon: <LayoutTemplate className="w-4 h-4" />, entityType: 'documentTemplate' },
  { id: 'templatePartials', label: 'Partials', noun: 'partials', icon: <Puzzle className="w-4 h-4" />, entityType: 'templatePartial' },
];

const PURGE_ALL_ORDER: { entityType: PurgeableEntity; key: TabType }[] = [
  { entityType: 'processingDocument', key: 'processingDocuments' },
  { entityType: 'generatedDocument', key: 'generatedDocuments' },
  { entityType: 'documentTemplate', key: 'documentTemplates' },
  { entityType: 'templatePartial', key: 'templatePartials' },
  { entityType: 'company', key: 'companies' },
  { entityType: 'contact', key: 'contacts' },
  { entityType: 'user', key: 'users' },
];

function EngineBadge({ engine }: { engine: 'A4' | 'OAKDOC' }) {
  return (
    <span className="badge bg-background-tertiary text-text-secondary text-xs">
      {engine === 'OAKDOC' ? 'Word' : 'A4'}
    </span>
  );
}

export default function DataPurgePage() {
  const { data: session } = useSession();
  const { success, error: showError } = useToast();

  const [activeTab, setActiveTab] = useState<TabType>('users');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [purgeAllOpen, setPurgeAllOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const { data, isLoading, error, refetch } = usePurgeData();
  const purgeMutation = usePurgeRecords();
  const restoreMutation = useRestoreRecords();

  // Only SUPER_ADMIN can access this page
  if (!session?.isSuperAdmin) {
    return (
      <div className="p-4 sm:p-6">
        <Alert variant="error">You do not have permission to access this page.</Alert>
      </div>
    );
  }

  const currentTab = TABS.find((t) => t.id === activeTab) ?? TABS[0];
  const currentEntityType = currentTab.entityType;
  const allRecords = data?.records?.[activeTab] || [];
  const totalSoftDeleted = data
    ? Object.values(data.stats).reduce((sum, count) => sum + count, 0)
    : 0;

  // Client-side pagination
  const totalRecords = allRecords.length;
  const totalPages = Math.ceil(totalRecords / limit);
  const startIndex = (page - 1) * limit;
  const currentRecords = allRecords.slice(startIndex, startIndex + limit);

  const toggleSelection = (id: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedIds(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === currentRecords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentRecords.map((r) => r.id)));
    }
  };

  // Compute selection states
  const isAllSelected = currentRecords.length > 0 && selectedIds.size === currentRecords.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < currentRecords.length;

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSelectedIds(new Set());
    setPage(1); // Reset to first page when changing tabs
  };

  const handlePurge = async (reason?: string) => {
    if (selectedIds.size === 0 || !reason) return;

    try {
      const result = await purgeMutation.mutateAsync({
        entityType: currentEntityType,
        entityIds: Array.from(selectedIds),
        reason,
      });
      if (result.failedCount > 0) {
        showError(`Permanently deleted ${result.deletedCount} record(s), but ${result.failedCount} failed. ${result.failedRecords?.[0]?.error ?? ''}`.trim());
      } else {
        success(`Permanently deleted ${result.deletedCount} record(s)`);
      }
      setSelectedIds(new Set());
      setConfirmDialogOpen(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to purge records');
    }
  };

  const handleRestore = async () => {
    if (selectedIds.size === 0) return;

    try {
      const result = await restoreMutation.mutateAsync({
        entityType: currentEntityType,
        entityIds: Array.from(selectedIds),
      });
      success(`Restored ${result.restoredCount} record(s)`);
      setSelectedIds(new Set());
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to restore records');
    }
  };

  const handlePurgeAll = async (reason?: string) => {
    if (!reason || !data) return;

    setPurgeAllOpen(false);

    let totalDeleted = 0;
    let failedCount = 0;

    for (const { entityType, key } of PURGE_ALL_ORDER) {
      const ids = (data.records[key] || []).map((r) => r.id);
      if (ids.length === 0) continue;

      try {
        const result = await purgeMutation.mutateAsync({
          entityType,
          entityIds: ids,
          reason,
        });
        totalDeleted += result.deletedCount ?? 0;
        failedCount += result.failedCount ?? 0;
      } catch {
        failedCount += 1;
      }
    }

    await refetch();

    if (failedCount > 0) {
      showError(`Permanently deleted ${totalDeleted} record(s), but ${failedCount} record(s) failed.`);
    } else {
      success(`Permanently deleted ${totalDeleted} record(s)`);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">
            Data Purge
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Permanently delete soft-deleted records. This action cannot be undone.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className="w-4 h-4" />}
            onClick={() => refetch()}
            isLoading={isLoading}
          >
            Refresh
          </Button>
          <Button
            variant="danger"
            size="sm"
            leftIcon={<Trash2 className="w-4 h-4" />}
            onClick={() => setPurgeAllOpen(true)}
            disabled={totalSoftDeleted === 0}
          >
            Purge all
          </Button>
        </div>
      </div>

      {/* Warning Banner */}
      <Alert variant="warning" className="mb-6">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Permanent Deletion Warning</p>
            <p className="text-sm mt-1">
              Records purged from this page will be permanently deleted from the database. This includes related data
              such as documents, assignments, and audit logs. This action cannot be reversed.
            </p>
          </div>
        </div>
      </Alert>

      {/* Stats Cards */}
      {data && (
        <MobileCollapsibleSection title="Statistics" count={TABS.length} className="mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {TABS.map((tab) => {
              const count = data.stats[tab.id as keyof typeof data.stats];
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={cn(
                    'card card-interactive p-4 text-left',
                    activeTab === tab.id && 'ring-2 ring-oak-primary'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'p-2 rounded-lg',
                        count > 0 ? 'bg-status-error/10 text-status-error' : 'bg-background-tertiary text-text-muted'
                      )}
                    >
                      {tab.icon}
                    </div>
                    <div>
                      <p className="text-2xl font-semibold text-text-primary">{count}</p>
                      <p className="text-sm text-text-secondary">{tab.label}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </MobileCollapsibleSection>
      )}

      {/* Error State */}
      {error && (
        <Alert variant="error" className="mb-4">
          {error instanceof Error ? error.message : 'Failed to load data'}
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12 text-text-secondary">Loading soft-deleted records...</div>
      )}

      {/* Records - Mobile Card View */}
      {data && (
        <div className="md:hidden space-y-3">
          {/* Select All */}
          {currentRecords.length > 0 && (
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                size="sm"
                checked={isAllSelected}
                indeterminate={isIndeterminate}
                onChange={toggleSelectAll}
                aria-label="Select all records"
              />
              <span className="text-sm text-text-secondary">
                {isAllSelected ? 'Deselect all' : 'Select all'}
              </span>
            </div>
          )}

          {currentRecords.length === 0 ? (
            <div className="card p-8 text-center text-text-secondary">
              No soft-deleted {currentTab.noun} found
            </div>
          ) : (
            currentRecords.map((record) => {
              const isSelected = selectedIds.has(record.id);
              return (
                <MobileCard
                  key={record.id}
                  isSelected={isSelected}
                  selectable
                  onToggle={() => toggleSelection(record.id)}
                  title={
                    activeTab === 'users' ? `${(record as PurgeableUser).firstName} ${(record as PurgeableUser).lastName}` :
                    activeTab === 'companies' ? (record as PurgeableCompany).name :
                    activeTab === 'contacts' ? (record as PurgeableContact).fullName :
                    activeTab === 'generatedDocuments' ? (record as PurgeableGeneratedDocument).title :
                    activeTab === 'documentTemplates' ? (record as PurgeableDocumentTemplate).name :
                    activeTab === 'templatePartials' ? (record as PurgeableTemplatePartial).displayName || (record as PurgeableTemplatePartial).name :
                    (record as PurgeableProcessingDocument).document?.fileName || 'Unnamed'
                  }
                  subtitle={
                    <span className="text-xs text-text-tertiary">
                      Deleted {format(new Date(record.deletedAt), 'MMM d, yyyy HH:mm')}
                    </span>
                  }
                  badge={
                    activeTab === 'users' ? (
                      <span className="badge bg-background-tertiary text-text-secondary text-xs">
                        {(record as PurgeableUser).role}
                      </span>
                    ) : activeTab === 'processingDocuments' ? (
                      <span className="badge bg-background-tertiary text-text-secondary text-xs">
                        {(record as PurgeableProcessingDocument).pipelineStatus}
                      </span>
                    ) : activeTab === 'documentTemplates' || activeTab === 'templatePartials' ? (
                      <EngineBadge engine={(record as PurgeableDocumentTemplate | PurgeableTemplatePartial).documentEngine} />
                    ) : null
                  }
                  details={
                    <CardDetailsGrid>
                      {activeTab === 'users' && (
                        <>
                          <CardDetailItem label="Email" value={(record as PurgeableUser).email} fullWidth />
                          <CardDetailItem label="Workspace" value={(record as PurgeableUser).tenant?.name || '—'} />
                        </>
                      )}
                      {activeTab === 'companies' && (
                        <>
                          <CardDetailItem label="UEN" value={(record as PurgeableCompany).uen} />
                          <CardDetailItem label="Workspace" value={(record as PurgeableCompany).tenant?.name || '—'} />
                          <CardDetailItem
                            label="Related"
                            value={`${(record as PurgeableCompany)._count.documents} docs, ${(record as PurgeableCompany)._count.officers} officers`}
                            fullWidth
                          />
                        </>
                      )}
                      {activeTab === 'contacts' && (
                        <>
                          <CardDetailItem label="Email" value={(record as PurgeableContact).email || '—'} fullWidth />
                          <CardDetailItem label="Workspace" value={(record as PurgeableContact).tenant?.name || '—'} />
                        </>
                      )}
                      {activeTab === 'generatedDocuments' && (
                        <>
                          <CardDetailItem label="Template" value={(record as PurgeableGeneratedDocument).template?.name || '—'} />
                          <CardDetailItem label="Company" value={(record as PurgeableGeneratedDocument).company?.name || '—'} />
                          <CardDetailItem
                            label="Created By"
                            value={`${(record as PurgeableGeneratedDocument).createdBy.firstName} ${(record as PurgeableGeneratedDocument).createdBy.lastName}`}
                          />
                          <CardDetailItem label="Workspace" value={(record as PurgeableGeneratedDocument).tenant?.name || '—'} />
                        </>
                      )}
                      {activeTab === 'documentTemplates' && (
                        <>
                          <CardDetailItem label="Documents" value={String((record as PurgeableDocumentTemplate)._count.generatedDocuments)} />
                          <CardDetailItem label="Workspace" value={(record as PurgeableDocumentTemplate).tenant?.name || '—'} />
                        </>
                      )}
                      {activeTab === 'templatePartials' && (
                        <>
                          <CardDetailItem label="Name" value={(record as PurgeableTemplatePartial).name} />
                          <CardDetailItem label="Workspace" value={(record as PurgeableTemplatePartial).tenant?.name || '—'} />
                        </>
                      )}
                      {activeTab === 'processingDocuments' && (
                        <>
                          <CardDetailItem label="Vendor" value={(record as PurgeableProcessingDocument).currentRevision?.vendorName || '—'} />
                          <CardDetailItem label="Doc #" value={(record as PurgeableProcessingDocument).currentRevision?.documentNumber || '—'} />
                          <CardDetailItem label="Category" value={(record as PurgeableProcessingDocument).currentRevision?.documentCategory || '—'} />
                          <CardDetailItem label="Company" value={(record as PurgeableProcessingDocument).document?.company?.name || '—'} />
                        </>
                      )}
                    </CardDetailsGrid>
                  }
                />
              );
            })
          )}

          {/* Mobile Pagination */}
          {totalRecords > 0 && (
            <div className="p-4">
              <Pagination
                page={page}
                totalPages={totalPages}
                total={totalRecords}
                limit={limit}
                onPageChange={setPage}
                onLimitChange={(newLimit) => {
                  setLimit(newLimit);
                  setPage(1);
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Records - Desktop Table */}
      {data && (
        <div className="hidden md:block card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-10">
                    <Checkbox
                      size="sm"
                      checked={isAllSelected}
                      indeterminate={isIndeterminate}
                      onChange={toggleSelectAll}
                      aria-label="Select all records"
                    />
                  </th>
                  {activeTab === 'users' && (
                    <>
                      <th>User</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Workspace</th>
                      <th>Deleted At</th>
                    </>
                  )}
                  {activeTab === 'companies' && (
                    <>
                      <th>Company</th>
                      <th>UEN</th>
                      <th>Related Data</th>
                      <th>Workspace</th>
                      <th>Deleted At</th>
                    </>
                  )}
                  {activeTab === 'contacts' && (
                    <>
                      <th>Contact</th>
                      <th>Email</th>
                      <th>Workspace</th>
                      <th>Deleted At</th>
                    </>
                  )}
                  {activeTab === 'generatedDocuments' && (
                    <>
                      <th>Document</th>
                      <th>Template</th>
                      <th>Company</th>
                      <th>Created By</th>
                      <th>Workspace</th>
                      <th>Deleted At</th>
                    </>
                  )}
                  {activeTab === 'documentTemplates' && (
                    <>
                      <th>Template</th>
                      <th>Editor</th>
                      <th>Generated documents</th>
                      <th>Workspace</th>
                      <th>Deleted At</th>
                    </>
                  )}
                  {activeTab === 'templatePartials' && (
                    <>
                      <th>Partial</th>
                      <th>Name</th>
                      <th>Editor</th>
                      <th>Workspace</th>
                      <th>Deleted At</th>
                    </>
                  )}
                  {activeTab === 'processingDocuments' && (
                    <>
                      <th>File Name</th>
                      <th>Vendor / Doc #</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th>Company</th>
                      <th>Deleted At</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {currentRecords.length === 0 ? (
                  <tr>
                    <td colSpan={activeTab === 'generatedDocuments' || activeTab === 'processingDocuments' ? 7 : activeTab === 'contacts' ? 5 : 6} className="text-center py-8 text-text-secondary">
                      No soft-deleted {currentTab.noun} found
                    </td>
                  </tr>
                ) : (
                  currentRecords.map((record) => (
                    <tr
                      key={record.id}
                      className={cn(selectedIds.has(record.id) && 'bg-oak-primary/5')}
                    >
                      <td>
                        <Checkbox
                          size="sm"
                          checked={selectedIds.has(record.id)}
                          onChange={() => toggleSelection(record.id)}
                          aria-label={`Select record`}
                        />
                      </td>

                      {activeTab === 'users' && (
                        <>
                          <td className="font-medium text-text-primary">
                            {(record as PurgeableUser).firstName} {(record as PurgeableUser).lastName}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableUser).email}
                          </td>
                          <td>
                            <span className="badge bg-background-tertiary text-text-secondary">
                              {(record as PurgeableUser).role}
                            </span>
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableUser).tenant?.name || '—'}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {format(new Date(record.deletedAt), 'MMM d, yyyy HH:mm')}
                          </td>
                        </>
                      )}

                      {activeTab === 'companies' && (
                        <>
                          <td className="font-medium text-text-primary">
                            {(record as PurgeableCompany).name}
                          </td>
                          <td className="font-mono text-sm text-text-secondary">
                            {(record as PurgeableCompany).uen}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableCompany)._count.documents} docs,{' '}
                            {(record as PurgeableCompany)._count.officers} officers,{' '}
                            {(record as PurgeableCompany)._count.shareholders} shareholders
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableCompany).tenant?.name || '—'}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {format(new Date(record.deletedAt), 'MMM d, yyyy HH:mm')}
                          </td>
                        </>
                      )}

                      {activeTab === 'contacts' && (
                        <>
                          <td className="font-medium text-text-primary">
                            {(record as PurgeableContact).fullName}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableContact).email || '—'}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableContact).tenant?.name || '—'}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {format(new Date(record.deletedAt), 'MMM d, yyyy HH:mm')}
                          </td>
                        </>
                      )}

                      {activeTab === 'generatedDocuments' && (
                        <>
                          <td className="font-medium text-text-primary">
                            {(record as PurgeableGeneratedDocument).title}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableGeneratedDocument).template?.name || '—'}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableGeneratedDocument).company?.name || '—'}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableGeneratedDocument).createdBy.firstName}{' '}
                            {(record as PurgeableGeneratedDocument).createdBy.lastName}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableGeneratedDocument).tenant?.name || '—'}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {format(new Date(record.deletedAt), 'MMM d, yyyy HH:mm')}
                          </td>
                        </>
                      )}

                      {activeTab === 'documentTemplates' && (
                        <>
                          <td className="font-medium text-text-primary">
                            {(record as PurgeableDocumentTemplate).name}
                          </td>
                          <td>
                            <EngineBadge engine={(record as PurgeableDocumentTemplate).documentEngine} />
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableDocumentTemplate)._count.generatedDocuments}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableDocumentTemplate).tenant?.name || '—'}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {format(new Date(record.deletedAt), 'MMM d, yyyy HH:mm')}
                          </td>
                        </>
                      )}

                      {activeTab === 'templatePartials' && (
                        <>
                          <td className="font-medium text-text-primary">
                            {(record as PurgeableTemplatePartial).displayName || (record as PurgeableTemplatePartial).name}
                          </td>
                          <td className="font-mono text-sm text-text-secondary">
                            {(record as PurgeableTemplatePartial).name}
                          </td>
                          <td>
                            <EngineBadge engine={(record as PurgeableTemplatePartial).documentEngine} />
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableTemplatePartial).tenant?.name || '—'}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {format(new Date(record.deletedAt), 'MMM d, yyyy HH:mm')}
                          </td>
                        </>
                      )}

                      {activeTab === 'processingDocuments' && (
                        <>
                          <td className="font-medium text-text-primary max-w-[200px] truncate">
                            {(record as PurgeableProcessingDocument).document?.fileName || '—'}
                          </td>
                          <td className="text-sm text-text-secondary">
                            <div>{(record as PurgeableProcessingDocument).currentRevision?.vendorName || '—'}</div>
                            <div className="text-xs text-text-muted">
                              {(record as PurgeableProcessingDocument).currentRevision?.documentNumber || '—'}
                            </div>
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableProcessingDocument).currentRevision?.documentCategory || '—'}
                          </td>
                          <td>
                            <span className="badge bg-background-tertiary text-text-secondary text-xs">
                              {(record as PurgeableProcessingDocument).pipelineStatus}
                            </span>
                          </td>
                          <td className="text-sm text-text-secondary">
                            {(record as PurgeableProcessingDocument).document?.company?.name || '—'}
                          </td>
                          <td className="text-sm text-text-secondary">
                            {format(new Date(record.deletedAt), 'MMM d, yyyy HH:mm')}
                          </td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalRecords > 0 && (
            <div className="p-4 border-t border-border-primary">
              <Pagination
                page={page}
                totalPages={totalPages}
                total={totalRecords}
                limit={limit}
                onPageChange={setPage}
                onLimitChange={(newLimit) => {
                  setLimit(newLimit);
                  setPage(1);
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Floating Bulk Actions Toolbar */}
      <BulkActionsToolbar
        selectedCount={selectedIds.size}
        onClearSelection={() => setSelectedIds(new Set())}
        itemLabel="record"
        actions={[
          {
            id: 'restore',
            label: 'Restore',
            icon: RotateCcw,
            description: 'Restore selected records',
            variant: 'default',
            isLoading: restoreMutation.isPending,
          },
          {
            id: 'purge',
            label: 'Purge',
            icon: Trash2,
            description: 'Permanently delete selected records',
            variant: 'danger',
            isLoading: purgeMutation.isPending,
          },
        ]}
        onAction={(actionId) => {
          if (actionId === 'restore') {
            handleRestore();
          } else if (actionId === 'purge') {
            setConfirmDialogOpen(true);
          }
        }}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialogOpen}
        onClose={() => setConfirmDialogOpen(false)}
        onConfirm={handlePurge}
        title={`Permanently Delete ${selectedIds.size} ${currentTab.noun}?`}
        description={activeTab === 'documentTemplates'
          ? `This will permanently remove ${selectedIds.size} template(s). Documents generated from them are kept but lose their template link. This action cannot be undone.`
          : `This will permanently remove ${selectedIds.size} record(s) and all related data from the database. This action cannot be undone.`}
        confirmLabel="Permanently Delete"
        variant="danger"
        requireReason
        reasonLabel="Reason for deletion"
        reasonPlaceholder="Enter the reason for permanently deleting these records..."
        reasonMinLength={10}
        isLoading={purgeMutation.isPending}
      />

      {/* Purge All Confirm Dialog */}
      <ConfirmDialog
        isOpen={purgeAllOpen}
        onClose={() => setPurgeAllOpen(false)}
        onConfirm={handlePurgeAll}
        title="Permanently Delete All Soft-Deleted Records?"
        description={`This will permanently remove all ${totalSoftDeleted} soft-deleted record(s) across every category and their related data. This action cannot be undone.`}
        confirmLabel="Permanently Delete All"
        variant="danger"
        requireReason
        reasonLabel="Reason for deletion"
        reasonPlaceholder="Enter the reason for permanently deleting all records..."
        reasonMinLength={10}
        isLoading={purgeMutation.isPending}
      />
    </div>
  );
}
