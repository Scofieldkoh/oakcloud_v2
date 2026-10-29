'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  ChevronDown,
  FileSignature,
  Grid2X2,
  LayoutList,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { CompanySearchableSelect } from '@/components/ui/company-searchable-select';
import { Alert } from '@/components/ui/alert';
import { Pagination } from '@/components/ui/pagination';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import {
  isAllowedEsigningUploadFile,
  useEsigningWordUploadAvailability,
} from '@/components/esigning/esigning-upload-files';
import { useSession } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { useUserPreference } from '@/hooks/use-user-preferences';
import {
  useCreateEsigningEnvelope,
  useDeleteEsigningEnvelope,
  useDuplicateEsigningEnvelope,
  useEsigningEnvelopes,
  useResendEsigningEnvelope,
  useRetryEsigningEnvelopeProcessing,
  uploadEsigningDocumentRequest,
  useVoidEsigningEnvelope,
} from '@/hooks/use-esigning';
import type { EsigningEnvelopeListItem, EsigningManualLinkDto } from '@/types/esigning';
import { cn } from '@/lib/utils';
import {
  ESIGNING_COMPLETION_BCC_PREFERENCE_KEY,
  parseEsigningCompletionBccPreference,
  type EsigningCompletionBccPreference,
} from '@/lib/validations/esigning';
import {
  readTaskLaunchContext,
  withTaskLaunchContext,
} from '@/lib/task-launch-context';
import {
  useEnsureTaskEsigningPreparation,
  useRetryTaskEsigningPreparation,
  useTaskEsigningPreparation,
} from '@/hooks/use-tasks';
import {
  EMPTY_ADVANCED_FILTERS,
  STATUS_TO_TAB,
  TAB_LABELS,
  TAB_LABELS_SHORT,
  TAB_STATUSES,
  getEnvelopeTitleFromFile,
  isStatusDuplicatedByTab,
  toDateInputValue,
  type EnvelopeAdvancedFilters,
  type EnvelopeSortBy,
  type TabKey,
  type ViewMode,
} from './list/esigning-list-config';
import { type EnvelopeActionHandlers } from './list/esigning-envelope-actions';
import { EnvelopeCardGrid } from './list/esigning-envelope-cards';
import { EnvelopeTableView } from './list/esigning-envelope-table';
import { EnvelopeFilterChips } from './list/esigning-list-filter-chips';
import { EnvelopeFilterPanel } from './list/esigning-list-filter-panel';
import { useEsigningColumnWidths } from './list/use-esigning-column-widths';

export { EmailDeliveryWarningBadge, EnvelopeActionsDropdown } from './list/esigning-envelope-actions';

export function EsigningListPage() {
  const searchParams = useSearchParams();
  const taskContext = useMemo(
    () => readTaskLaunchContext(searchParams),
    [searchParams],
  );
  const generatedDocumentId = searchParams.get('generatedDocumentId') ?? undefined;
  const selectedGeneratedDocumentIds = useMemo(
    () => Array.from(new Set(searchParams.getAll('generatedDocumentIds').filter(Boolean))),
    [searchParams],
  );
  const configuredSigningOrder = searchParams.get('signingOrder');
  const signingOrder = (
    configuredSigningOrder
    && ['PARALLEL', 'SEQUENTIAL', 'MIXED'].includes(configuredSigningOrder)
  )
    ? configuredSigningOrder as 'PARALLEL' | 'SEQUENTIAL' | 'MIXED'
    : 'PARALLEL';
  const expiresInDays = Number(searchParams.get('expiresInDays'));
  const { can } = usePermissions();
  const toast = useToast();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);
  const completionBccPreference = useUserPreference<EsigningCompletionBccPreference>(
    ESIGNING_COMPLETION_BCC_PREFERENCE_KEY,
  );
  const { columnWidths, startColumnResize, resizeColumnByKeyboard } = useEsigningColumnWidths();
  const defaultCompletionBccEmails = useMemo(
    () => parseEsigningCompletionBccPreference(completionBccPreference.data?.value).emails,
    [completionBccPreference.data?.value],
  );
  const wordUploadEnabled = useEsigningWordUploadAvailability(activeTenantId);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [isStarting, setIsStarting] = useState(false);
  const [isDraggingOnHero, setIsDraggingOnHero] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [sortBy, setSortBy] = useState<EnvelopeSortBy>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [companyId, setCompanyId] = useState<string>('');
  const [appliedFilters, setAppliedFilters] = useState<EnvelopeAdvancedFilters>(EMPTY_ADVANCED_FILTERS);
  const [draftFilters, setDraftFilters] = useState<EnvelopeAdvancedFilters>(EMPTY_ADVANCED_FILTERS);
  const [draftCompanyId, setDraftCompanyId] = useState('');
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EsigningEnvelopeListItem | null>(null);
  const [voidTarget, setVoidTarget] = useState<EsigningEnvelopeListItem | null>(null);
  const [retryTargetId, setRetryTargetId] = useState<string | null>(null);
  const [manualLinks, setManualLinks] = useState<EsigningManualLinkDto[]>([]);
  const [isLinksModalOpen, setIsLinksModalOpen] = useState(false);
  const ensuredTaskRef = useRef<string | null>(null);
  const selectedTaskDocumentsRef = useRef<string | null>(null);
  const openedPreparedEnvelopeRef = useRef<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);

  const activeStatuses = TAB_STATUSES[activeTab];
  const envelopesQuery = useEsigningEnvelopes({
    query: debouncedQuery || undefined,
    status: appliedFilters.status || undefined,
    statuses: appliedFilters.status
      ? undefined
      : activeStatuses.length > 0
        ? activeStatuses
        : undefined,
    companyId: companyId || undefined,
    documentName: appliedFilters.documentName || undefined,
    recipientQuery: appliedFilters.recipientQuery || undefined,
    recipientStatus: appliedFilters.recipientStatus || undefined,
    signingOrder: appliedFilters.signingOrder || undefined,
    createdFrom: appliedFilters.createdFrom || undefined,
    createdTo: appliedFilters.createdTo || undefined,
    sentFrom: appliedFilters.sentFrom || undefined,
    sentTo: appliedFilters.sentTo || undefined,
    completedFrom: appliedFilters.completedFrom || undefined,
    completedTo: appliedFilters.completedTo || undefined,
    createdBy: appliedFilters.createdBy,
    sortBy,
    sortOrder,
    page,
    limit,
  });
  const createEnvelope = useCreateEsigningEnvelope();
  const deleteEnvelope = useDeleteEsigningEnvelope();
  const duplicateEnvelope = useDuplicateEsigningEnvelope();
  const resendEnvelope = useResendEsigningEnvelope();
  const voidEnvelope = useVoidEsigningEnvelope(voidTarget?.id ?? '');
  const retryProcessing = useRetryEsigningEnvelopeProcessing(retryTargetId ?? '');
  const preparationQuery = useTaskEsigningPreparation(
    taskContext?.taskId ?? '',
    taskContext?.taskStageId ?? '',
  );
  const ensurePreparation = useEnsureTaskEsigningPreparation();
  const retryPreparation = useRetryTaskEsigningPreparation();
  const preparation = ensurePreparation.data ?? preparationQuery.data;

  const envelopes = useMemo(
    () => (envelopesQuery.data?.envelopes ?? []) as EsigningEnvelopeListItem[],
    [envelopesQuery.data?.envelopes]
  );

  const statusCounts = useMemo(
    () =>
      envelopesQuery.data?.statusCounts ?? {
        DRAFT: 0,
        SENT: 0,
        IN_PROGRESS: 0,
        COMPLETED: 0,
        VOIDED: 0,
        DECLINED: 0,
        EXPIRED: 0,
      },
    [envelopesQuery.data?.statusCounts]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery]);

  useEffect(() => {
    if (!isFilterPanelOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(event.target as Node)) {
        setIsFilterPanelOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFilterPanelOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isFilterPanelOpen]);

  const companyOptions = useMemo(
    () => envelopesQuery.data?.companyOptions ?? [],
    [envelopesQuery.data?.companyOptions]
  );

  const tabCounts = useMemo<Record<TabKey, number>>(
    () => ({
      all: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
      attention: statusCounts.DRAFT + statusCounts.DECLINED,
      waiting: statusCounts.SENT + statusCounts.IN_PROGRESS,
      completed: statusCounts.COMPLETED,
      voided: statusCounts.VOIDED + statusCounts.EXPIRED,
    }),
    [statusCounts]
  );

  const totalResults = envelopesQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalResults / limit));
  const selectedCompanyName = companyOptions.find((company) => company.id === companyId)?.name ?? '';
  const advancedFilterCount = useMemo(() => {
    let count = companyId ? 1 : 0;
    if (appliedFilters.status) count += 1;
    if (appliedFilters.documentName) count += 1;
    if (appliedFilters.recipientQuery) count += 1;
    if (appliedFilters.recipientStatus) count += 1;
    if (appliedFilters.signingOrder) count += 1;
    if (appliedFilters.createdFrom || appliedFilters.createdTo) count += 1;
    if (appliedFilters.sentFrom || appliedFilters.sentTo) count += 1;
    if (appliedFilters.completedFrom || appliedFilters.completedTo) count += 1;
    if (appliedFilters.createdBy === 'me') count += 1;
    return count;
  }, [appliedFilters, companyId]);

  const hasAppliedFilters = advancedFilterCount > 0;

  const handleSort = (nextSortBy: EnvelopeSortBy) => {
    setSortOrder((currentOrder) =>
      sortBy === nextSortBy
        ? currentOrder === 'asc'
          ? 'desc'
          : 'asc'
        : nextSortBy === 'updatedAt'
          ? 'desc'
          : 'asc'
    );
    setSortBy(nextSortBy);
    setPage(1);
  };

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setAppliedFilters((current) => ({ ...current, status: '' }));
    setDraftFilters((current) => ({ ...current, status: '' }));
    setPage(1);
  };

  const handleCompanyChange = (nextCompanyId: string) => {
    setCompanyId(nextCompanyId);
    setDraftCompanyId(nextCompanyId);
    setPage(1);
  };

  const openFilterPanel = () => {
    setDraftFilters({ ...appliedFilters });
    setDraftCompanyId(companyId);
    setIsFilterPanelOpen(true);
  };

  const applyFilterPanel = () => {
    const nextFilters = { ...draftFilters };
    if (nextFilters.status) {
      const targetTab = STATUS_TO_TAB[nextFilters.status];
      setActiveTab(targetTab);
      if (isStatusDuplicatedByTab(nextFilters.status, targetTab)) {
        nextFilters.status = '';
      }
    }
    setAppliedFilters(nextFilters);
    setCompanyId(draftCompanyId);
    setPage(1);
    setIsFilterPanelOpen(false);
  };

  const clearAllFilters = () => {
    setCompanyId('');
    setDraftCompanyId('');
    setAppliedFilters({ ...EMPTY_ADVANCED_FILTERS });
    setDraftFilters({ ...EMPTY_ADVANCED_FILTERS });
    setPage(1);
  };

  const applySavedView = (
    tab: TabKey,
    nextFilters: Partial<EnvelopeAdvancedFilters> = {}
  ) => {
    const filters = { ...EMPTY_ADVANCED_FILTERS, ...nextFilters };
    setActiveTab(tab);
    setAppliedFilters(filters);
    setDraftFilters(filters);
    setCompanyId('');
    setDraftCompanyId('');
    setPage(1);
  };

  const applyCompletedThisMonthView = () => {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    applySavedView('completed', {
      completedFrom: toDateInputValue(monthStart),
      completedTo: toDateInputValue(today),
    });
  };

  const handleStart = useCallback(async (files?: File[]) => {
    if (isStarting) {
      return;
    }

    const uploadFiles = files ?? [];
    const invalidFile = uploadFiles.find(
      (file) => !isAllowedEsigningUploadFile(file, { wordUploadEnabled })
    );
    if (invalidFile) {
      toast.error(
        wordUploadEnabled
          ? 'Upload PDF, DOCX, or DOC documents.'
          : 'Word upload requires a valid SharePoint or OneDrive connector. Upload PDF documents instead.'
      );
      return;
    }

    let createdEnvelope: { id: string } | null = null;
    try {
      setIsStarting(true);
      const title = uploadFiles[0] ? getEnvelopeTitleFromFile(uploadFiles[0]) : 'New Envelope';
      const expiresAt = Number.isInteger(expiresInDays) && expiresInDays > 0
        ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
        : undefined;
      createdEnvelope = await createEnvelope.mutateAsync({
        title,
        completionCopyEmails: defaultCompletionBccEmails,
        signingOrder,
        expiresAt,
        taskContext,
        ...(selectedGeneratedDocumentIds.length > 0
          ? { generatedDocumentIds: selectedGeneratedDocumentIds }
          : { generatedDocumentId }),
      });
      const destination = withTaskLaunchContext(
        `/esigning/${createdEnvelope.id}`,
        taskContext
      );

      if (uploadFiles.length > 0) {
        try {
          for (const file of uploadFiles) {
            await uploadEsigningDocumentRequest(createdEnvelope.id, file, activeTenantId);
          }
        } catch (uploadError) {
          let compensationFailed = false;
          try {
            await deleteEnvelope.mutateAsync(createdEnvelope.id);
          } catch (deleteError) {
            compensationFailed = true;
            toast.error(
              deleteError instanceof Error
                ? `Upload failed and the new draft could not be removed: ${deleteError.message}`
                : 'Upload failed and the new draft could not be removed.'
            );
          }

          if (compensationFailed) {
            toast.error(
              uploadError instanceof Error
                ? `Opening the draft so you can recover it. ${uploadError.message}`
                : 'Opening the draft so you can recover it.'
            );
            window.location.assign(destination);
          }
          throw uploadError;
        }
      }

      window.location.assign(destination);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create envelope');
    } finally {
      setIsStarting(false);
    }
  }, [
    activeTenantId,
    createEnvelope,
    defaultCompletionBccEmails,
    deleteEnvelope,
    expiresInDays,
    generatedDocumentId,
    isStarting,
    selectedGeneratedDocumentIds,
    signingOrder,
    taskContext,
    toast,
    wordUploadEnabled,
  ]);

  useEffect(() => {
    if (!taskContext || selectedGeneratedDocumentIds.length > 0 || !can.createEsigning) return;
    const launchKey = `${taskContext.taskId}:${taskContext.taskStageId}`;
    if (ensuredTaskRef.current === launchKey) return;
    ensuredTaskRef.current = launchKey;
    void ensurePreparation.mutateAsync({
      taskId: taskContext.taskId,
      stageId: taskContext.taskStageId,
    }).catch((error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to prepare E-signing');
    });
  }, [can.createEsigning, ensurePreparation, selectedGeneratedDocumentIds, taskContext, toast]);

  useEffect(() => {
    if (!taskContext || selectedGeneratedDocumentIds.length === 0 || !can.createEsigning) return;
    const launchKey = `${taskContext.taskId}:${taskContext.taskStageId}:${selectedGeneratedDocumentIds.join(',')}`;
    if (selectedTaskDocumentsRef.current === launchKey) return;
    selectedTaskDocumentsRef.current = launchKey;
    void handleStart();
  }, [can.createEsigning, handleStart, selectedGeneratedDocumentIds, taskContext]);

  useEffect(() => {
    if (
      !taskContext
      || selectedGeneratedDocumentIds.length > 0
      || preparation?.status !== 'READY'
      || !preparation.esigningEnvelopeId
      || openedPreparedEnvelopeRef.current === preparation.esigningEnvelopeId
    ) {
      return;
    }
    openedPreparedEnvelopeRef.current = preparation.esigningEnvelopeId;
    window.location.assign(withTaskLaunchContext(
      `/esigning/${preparation.esigningEnvelopeId}`,
      taskContext,
    ));
  }, [preparation, selectedGeneratedDocumentIds, taskContext]);

  async function handleRetryPdf(envelopeId: string) {
    try {
      setRetryTargetId(envelopeId);
      const targetEnvelope = envelopes.find((envelope) => envelope.id === envelopeId);
      await retryProcessing.mutateAsync();
      toast.success(
        targetEnvelope?.pdfGenerationStatus === 'FAILED'
          ? 'PDF generation retried'
          : 'PDF generation triggered'
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to trigger PDF generation'
      );
    } finally {
      setRetryTargetId(null);
    }
  }

  async function handleDuplicateEnvelope(envelope: EsigningEnvelopeListItem) {
    try {
      const duplicated = await duplicateEnvelope.mutateAsync(envelope.id);
      toast.success('Envelope duplicated');
      window.location.assign(`/esigning/${duplicated.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to duplicate envelope');
    }
  }

  function handleDownload(
    envelopeId: string,
    tenantId: string,
    variant: 'documents' | 'documents_with_certificates' | 'certificates'
  ) {
    const queryParams = new URLSearchParams({ variant, tenantId });
    window.open(`/api/esigning/envelopes/${envelopeId}/download?${queryParams.toString()}`, '_blank', 'noreferrer');
  }

  async function handleResendEnvelope(envelope: EsigningEnvelopeListItem) {
    try {
      const result = await resendEnvelope.mutateAsync(envelope.id);
      if (result.manualLinks.length > 0) {
        setManualLinks(result.manualLinks);
        setIsLinksModalOpen(true);
      }

      const signerLabel =
        envelope.resendableRecipientCount === 1 ? '1 signer' : `${envelope.resendableRecipientCount} signers`;
      toast.success(`Resent active signing request to ${signerLabel}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to resend active signing requests');
    }
  }

  const envelopeActions: EnvelopeActionHandlers = {
    onDuplicate: (target) => void handleDuplicateEnvelope(target),
    onResend: (target) => void handleResendEnvelope(target),
    onDelete: setDeleteTarget,
    onVoid: setVoidTarget,
    onRetryPdf: (envelopeId) => void handleRetryPdf(envelopeId),
    onDownload: handleDownload,
  };

  if (!can.readEsigning) {
    return (
      <div className="p-6">
        <Alert variant="error" title="Access denied">
          You do not have permission to view e-signing envelopes.
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-primary">
      <div className="flex w-full flex-col gap-4 p-4 sm:p-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-oak-primary">
              E-Signing
            </div>
            <h1 className="mt-1 text-2xl font-semibold leading-tight text-text-primary">Envelopes</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Prepare, send and track documents for signature.
            </p>
          </div>
          {can.createEsigning && !taskContext ? (
            <Button
              size="md"
              className="self-start sm:self-auto"
              leftIcon={<Plus className="h-4 w-4" />}
              isLoading={isStarting}
              onClick={() => void handleStart()}
            >
              New envelope
            </Button>
          ) : null}
        </header>

        {taskContext ? (
          <section className="rounded-2xl border border-border-primary bg-background-secondary p-5 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-oak-primary/10 text-oak-primary">
              <RefreshCw
                className={cn(
                  'h-5 w-5',
                  (isStarting || !preparation || preparation.status === 'QUEUED' || preparation.status === 'PROCESSING')
                    && 'animate-spin',
                )}
              />
            </div>
            <h2 className="mt-3 text-base font-semibold text-text-primary">
              {selectedGeneratedDocumentIds.length > 0
                ? 'Preparing selected documents'
                : preparation?.status === 'WAITING'
                ? 'E-signing is waiting'
                : preparation?.status === 'FAILED_RETRYABLE'
                  ? 'Preparation needs attention'
                  : preparation?.status === 'FAILED_PERMANENT'
                    ? 'E-signing cannot be prepared'
                    : preparation?.status === 'READY'
                      ? 'Opening prepared envelope'
                      : 'Preparing E-signing'}
            </h2>
            <p className="mx-auto mt-1.5 max-w-xl text-sm text-text-secondary">
              {selectedGeneratedDocumentIds.length > 0
                ? `${selectedGeneratedDocumentIds.length} ${selectedGeneratedDocumentIds.length === 1 ? 'document is' : 'documents are'} being added to a new signing workspace.`
                : preparation?.status === 'WAITING' && preparation.blockingStage
                ? `Complete or skip ${preparation.blockingStage.name} before the generated document is attached.`
                : preparation?.status === 'WAITING'
                  ? 'Finalize the preceding generated document to continue.'
                  : preparation?.lastError
                    ? preparation.lastError
                    : 'The draft envelope and generated document are being prepared in the background.'}
            </p>
            {preparation?.status === 'FAILED_RETRYABLE' ? (
              <Button
                className="mt-3"
                variant="secondary"
                isLoading={retryPreparation.isPending}
                onClick={() => void retryPreparation.mutateAsync({
                  taskId: taskContext.taskId,
                  stageId: taskContext.taskStageId,
                }).catch((error) => {
                  toast.error(error instanceof Error ? error.message : 'Failed to retry preparation');
                })}
              >
                Retry preparation
              </Button>
            ) : null}
          </section>
        ) : can.createEsigning ? (
          <section
            onDragOver={(event) => {
              event.preventDefault();
              setIsDraggingOnHero(true);
            }}
            onDragLeave={() => setIsDraggingOnHero(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDraggingOnHero(false);
              const files = Array.from(event.dataTransfer.files);
              if (files.length > 0) {
                void handleStart(files);
              }
            }}
            className={cn(
              'flex min-h-[160px] flex-col justify-center gap-3 rounded-2xl border border-dashed px-5 py-6 transition-colors sm:flex-row sm:items-center sm:justify-between',
              isDraggingOnHero
                ? 'border-oak-primary bg-oak-primary/5'
                : 'border-border-secondary bg-background-secondary'
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-oak-primary/10 text-oak-primary">
                <FileSignature className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">
                  {wordUploadEnabled
                    ? 'Drop PDF or Word files here to create a new envelope'
                    : 'Drop PDF files here to create a new envelope'}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Files are added to a new draft before you assign recipients.
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 self-start sm:self-auto"
              isLoading={isStarting}
              onClick={() => uploadInputRef.current?.click()}
            >
              Browse files
            </Button>
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              className="hidden"
              aria-label="Upload documents to a new envelope"
              accept={wordUploadEnabled
                ? '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                : '.pdf,application/pdf'}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                if (files.length > 0) {
                  void handleStart(files);
                }
              }}
            />
          </section>
        ) : null}

        {envelopesQuery.error ? (
          <Alert variant="error" title="Unable to load envelopes">
            {envelopesQuery.error instanceof Error ? envelopesQuery.error.message : 'Unknown error'}
          </Alert>
        ) : null}

        <section className="relative">
          <div className="flex overflow-x-auto border-b border-border-primary px-2 sm:px-4">
            {(Object.keys(TAB_LABELS) as TabKey[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => handleTabChange(tab)}
                className={cn(
                  'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-3 text-sm font-medium transition-colors sm:px-4',
                  activeTab === tab
                    ? 'text-oak-primary after:absolute after:bottom-0 after:left-3 after:right-3 after:h-0.5 after:bg-oak-primary sm:after:left-4 sm:after:right-4'
                    : 'text-text-secondary hover:text-text-primary'
                )}
              >
                <span className="sm:hidden">{TAB_LABELS_SHORT[tab]}</span>
                <span className="hidden sm:inline">{TAB_LABELS[tab]}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    activeTab === tab
                      ? 'bg-oak-primary/10 text-oak-primary'
                      : 'bg-background-tertiary text-text-muted'
                  )}
                >
                  {tabCounts[tab]}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 p-3 sm:p-4 lg:flex-row lg:items-center">
            <div className="min-w-0 lg:flex-[1_1_360px]">
              <FormInput
                inputSize="md"
                className="h-10 text-sm"
                aria-label="Search envelopes, documents, recipients or companies"
                placeholder="Search envelopes, documents, recipients or companies..."
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                leftIcon={<Search className="h-4 w-4" />}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:flex-nowrap">
              <CompanySearchableSelect
                companies={companyOptions}
                value={companyId}
                onChange={handleCompanyChange}
                placeholder="Company"
                clearable
                size="lg"
                className="col-span-2 w-full sm:col-span-1 sm:w-[440px] sm:max-w-full"
                containerClassName="h-10"
              />

              <div ref={filterPanelRef} className="relative">
                <button
                  type="button"
                  aria-expanded={isFilterPanelOpen}
                  aria-haspopup="dialog"
                  onClick={() => {
                    if (isFilterPanelOpen) {
                      setIsFilterPanelOpen(false);
                    } else {
                      openFilterPanel();
                    }
                  }}
                  className={cn(
                    'flex h-10 w-full items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors sm:w-auto',
                    isFilterPanelOpen || advancedFilterCount > 0
                      ? 'border-oak-primary/40 bg-oak-primary/5 text-oak-primary'
                      : 'border-border-primary bg-background-primary text-text-secondary hover:bg-background-tertiary'
                  )}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Filters
                  {advancedFilterCount > 0 ? (
                    <span className="rounded-full bg-oak-primary/10 px-1.5 py-0.5 text-[10px] font-semibold">
                      {advancedFilterCount}
                    </span>
                  ) : null}
                </button>

                {isFilterPanelOpen ? (
                  <EnvelopeFilterPanel
                    companyOptions={companyOptions}
                    draftCompanyId={draftCompanyId}
                    onDraftCompanyChange={setDraftCompanyId}
                    draftFilters={draftFilters}
                    setDraftFilters={setDraftFilters}
                    onReset={() => {
                      setDraftFilters({ ...EMPTY_ADVANCED_FILTERS });
                      setDraftCompanyId('');
                    }}
                    onApply={applyFilterPanel}
                  />
                ) : null}
              </div>

              <Dropdown>
                <DropdownTrigger asChild>
                  <button
                    type="button"
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border-primary bg-background-primary px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-background-tertiary sm:w-auto"
                    aria-label="Saved views"
                  >
                    <Bookmark className="h-4 w-4" />
                    <span>Saved views</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownTrigger>
                <DropdownMenu>
                  <DropdownItem onClick={() => applySavedView('waiting', { createdBy: 'me' })}>
                    My active envelopes
                  </DropdownItem>
                  <DropdownItem onClick={() => applySavedView('waiting')}>
                    Awaiting recipients
                  </DropdownItem>
                  <DropdownItem onClick={() => applySavedView('attention')}>
                    Needs attention
                  </DropdownItem>
                  <DropdownItem onClick={applyCompletedThisMonthView}>
                    Completed this month
                  </DropdownItem>
                </DropdownMenu>
              </Dropdown>

              <div className="col-span-2 flex h-10 items-center rounded-lg border border-border-primary bg-background-primary p-0.5 sm:col-span-1 sm:ml-auto">
                <button
                  type="button"
                  aria-label="Table view"
                  title="Table view"
                  onClick={() => setViewMode('table')}
                  className={cn(
                    'flex h-8 w-9 items-center justify-center rounded-md transition-colors',
                    viewMode === 'table'
                      ? 'bg-oak-primary/10 text-oak-primary'
                      : 'text-text-muted hover:bg-background-tertiary hover:text-text-primary'
                  )}
                >
                  <LayoutList className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Card view"
                  title="Card view"
                  onClick={() => setViewMode('card')}
                  className={cn(
                    'flex h-8 w-9 items-center justify-center rounded-md transition-colors',
                    viewMode === 'card'
                      ? 'bg-oak-primary/10 text-oak-primary'
                      : 'text-text-muted hover:bg-background-tertiary hover:text-text-primary'
                  )}
                >
                  <Grid2X2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {hasAppliedFilters ? (
            <EnvelopeFilterChips
              companyId={companyId}
              selectedCompanyName={selectedCompanyName}
              onClearCompany={() => handleCompanyChange('')}
              appliedFilters={appliedFilters}
              activeTab={activeTab}
              onRemove={(patch) => {
                setAppliedFilters((current) => ({ ...current, ...patch }));
                setPage(1);
              }}
              onClearAll={clearAllFilters}
            />
          ) : null}

          <div
            className={cn(
              viewMode === 'table'
                ? 'mt-2 overflow-hidden rounded-xl border border-border-primary bg-background-secondary'
                : 'border-t border-border-primary'
            )}
          >
            {envelopesQuery.isLoading ? (
              <div className="px-4 py-12 text-center text-sm text-text-secondary">
                Loading e-signing envelopes...
              </div>
            ) : envelopes.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-oak-primary/10 text-oak-primary">
                  <FileSignature className="h-4 w-4" />
                </div>
                <h2 className="mt-3 text-base font-semibold text-text-primary">
                  {query.trim() || hasAppliedFilters || activeTab !== 'all'
                    ? 'No matching envelopes'
                    : 'No envelopes yet'}
                </h2>
                <p className="mx-auto mt-1.5 max-w-md text-sm text-text-secondary">
                  {query.trim() || hasAppliedFilters || activeTab !== 'all'
                    ? 'No envelopes match your current search and filters.'
                    : 'Create a new envelope when you are ready to prepare documents for signature.'}
                </p>
                {query.trim() || hasAppliedFilters || activeTab !== 'all' ? (
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {hasAppliedFilters || activeTab !== 'all' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          clearAllFilters();
                          handleTabChange('all');
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : null}
                    {query.trim() ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<X className="h-4 w-4" />}
                        onClick={() => {
                          setQuery('');
                          setDebouncedQuery('');
                          setPage(1);
                        }}
                      >
                        Clear search
                      </Button>
                    ) : null}
                  </div>
                ) : can.createEsigning ? (
                  <Button
                    className="mt-4"
                    size="sm"
                    leftIcon={<Plus className="h-4 w-4" />}
                    onClick={() => void handleStart()}
                  >
                    New envelope
                  </Button>
                ) : null}
              </div>
            ) : viewMode === 'table' ? (
              <EnvelopeTableView
                envelopes={envelopes}
                searchQuery={debouncedQuery}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={handleSort}
                columnWidths={columnWidths}
                onResizePointerDown={startColumnResize}
                onResizeKeyDown={resizeColumnByKeyboard}
                actions={envelopeActions}
              />
            ) : (
              <EnvelopeCardGrid envelopes={envelopes} searchQuery={debouncedQuery} actions={envelopeActions} />
            )}

            {!envelopesQuery.isLoading && totalResults > 0 ? (
              <div className="border-t border-border-primary px-3 py-3 sm:px-4">
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  total={totalResults}
                  limit={limit}
                  onPageChange={setPage}
                  onLimitChange={(nextLimit) => {
                    setLimit(nextLimit);
                    setPage(1);
                  }}
                />
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) {
            return;
          }

          try {
            await deleteEnvelope.mutateAsync(deleteTarget.id);
            toast.success(
              deleteTarget.status === 'COMPLETED'
                ? 'Envelope permanently deleted'
                : 'Draft deleted'
            );
            setDeleteTarget(null);
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : deleteTarget.status === 'COMPLETED'
                  ? 'Failed to delete envelope'
                  : 'Failed to delete draft'
            );
          }
        }}
        title={
          deleteTarget?.status === 'COMPLETED'
            ? 'Delete completed envelope?'
            : 'Delete draft envelope?'
        }
        description={
          deleteTarget
            ? deleteTarget.status === 'COMPLETED'
              ? `This permanently removes "${deleteTarget.title}", its signed documents, certificates, and download access.`
              : `This permanently removes "${deleteTarget.title}" and its uploaded source files.`
            : undefined
        }
        confirmLabel={deleteTarget?.status === 'COMPLETED' ? 'Delete envelope' : 'Delete draft'}
        isLoading={deleteEnvelope.isPending}
      />

      <ConfirmDialog
        isOpen={Boolean(voidTarget)}
        onClose={() => setVoidTarget(null)}
        onConfirm={async (reason) => {
          if (!voidTarget) {
            return;
          }

          try {
            await voidEnvelope.mutateAsync(reason ?? null);
            toast.success('Envelope voided');
            setVoidTarget(null);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to void envelope');
          }
        }}
        title="Void envelope?"
        description={
          voidTarget
            ? `Signers will lose access to "${voidTarget.title}" immediately.`
            : undefined
        }
        confirmLabel="Void envelope"
        requireReason
        reasonLabel="Void reason"
        reasonPlaceholder="Explain why the envelope is being cancelled"
        reasonMinLength={3}
        isLoading={voidEnvelope.isPending}
      />

      <Modal
        isOpen={isLinksModalOpen}
        onClose={() => setIsLinksModalOpen(false)}
        title="Manual signing links"
        size="xl"
      >
        <ModalBody className="min-w-0 space-y-3">
          <Alert variant="info">
            Share these links securely with recipients whose access mode uses manual delivery.
          </Alert>
          {manualLinks.map((link) => (
            <div
              key={link.recipientId}
              className="min-w-0 rounded-2xl border border-border-primary bg-background-primary p-4"
            >
              <div className="min-w-0">
                <div className="min-w-0">
                  <div className="font-medium text-text-primary">{link.recipientName}</div>
                  <div className="break-all text-sm text-text-secondary">{link.recipientEmail || 'No email — manual link only'}</div>
                  <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <a
                      href={link.signingUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={link.signingUrl}
                      className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-border-primary bg-background-secondary px-3 py-2 text-xs text-text-secondary hover:border-oak-primary/40 hover:text-text-primary"
                    >
                      {link.signingUrl}
                    </a>
                    <Button
                      className="shrink-0"
                      variant="secondary"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(link.signingUrl)
                          .then(() => toast.success('Manual link copied'))
                          .catch(() => toast.error('Clipboard access failed'))
                      }
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </ModalBody>
        <ModalFooter>
          <Button onClick={() => setIsLinksModalOpen(false)}>Done</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
