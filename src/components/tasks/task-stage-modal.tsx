'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Circle,
  FileUp,
  Link2,
  X,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CompanySelect } from '@/components/ui/company-select';
import { toCompanySearchOption } from '@/hooks/use-company-search';
import { attachGeneratedDocumentsRequest } from '@/hooks/use-esigning';
import { cn } from '@/lib/utils';
import { withTaskLaunchContext } from '@/lib/task-launch-context';
import type { TaskStageTransition } from '@/hooks/use-tasks';
import type {
  TaskGeneratedDocumentResource,
  TaskEsigningEnvelopeResource,
  TaskResource,
  TaskResourcesResponse,
  TaskStageDetail,
} from '@/services/tasks/types';
import { TaskResourcesPanel } from './task-resources-panel';
import {
  PipelineStageLinkedOutcome,
  PipelineStageMetadata,
  PipelineStageModalFooter,
  PipelineStageModalFrame,
  PipelineStageNotes,
  type StageNotesSaveStatus,
} from './task-stage-modal-layout';

interface TaskStageModalProps {
  isOpen: boolean;
  stage?: TaskStageDetail | null;
  isLoading?: boolean;
  error?: Error | null;
  onClose: () => void;
  onUpdateMetadata: (payload: { notes?: string | null; assigneeId?: string | null }) => void | Promise<void>;
  onTransition: (transition: TaskStageTransition) => void | Promise<void>;
  onStartBizFileReview?: (file: File) => void | Promise<void>;
  isMutating?: boolean;
  /** Companies already known here, such as the task's company, so its name shows before any search. */
  companies?: Array<{ id: string; name: string; uen?: string | null }>;
  taskCompanyId?: string | null;
  taskDueDate?: string | null;
  onNavigateStage?: (direction: 'previous' | 'next') => void;
  hasPreviousStage?: boolean;
  hasNextStage?: boolean;
  resources?: TaskResourcesResponse;
  isResourcesLoading?: boolean;
  resourcesError?: Error | null;
  onRetryResources?: () => void;
}

interface EsigningDocumentSelectionOption {
  resource: TaskGeneratedDocumentResource;
  stageName: string;
}

function isGeneratedDocumentResource(resource: TaskResource): resource is TaskGeneratedDocumentResource {
  return resource.kind === 'generatedDocument';
}

function isAvailableEsigningEnvelopeResource(resource: TaskResource): resource is TaskEsigningEnvelopeResource {
  return resource.kind === 'esigningEnvelope' && resource.state === 'available';
}

function statusLabel(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isSelectableEsigningDocument(resource: TaskGeneratedDocumentResource) {
  return resource.state === 'available' && resource.status === 'FINALIZED' && Boolean(resource.id);
}

function EsigningDocumentSelection({
  options,
  selectedIds,
  isLoading,
  error,
  disabled,
  onToggle,
  onToggleAll,
}: {
  options: EsigningDocumentSelectionOption[];
  selectedIds: string[];
  isLoading: boolean;
  error?: Error | null;
  disabled: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  const selectedIdSet = new Set(selectedIds);
  const selectableOptions = options.filter(({ resource }) => isSelectableEsigningDocument(resource));
  const selectableIdSet = new Set(selectableOptions.map(({ resource }) => resource.id!));
  const selectedSelectableCount = selectedIds.filter((id) => selectableIdSet.has(id)).length;
  const isAllSelected = selectableOptions.length > 0
    && selectableOptions.every(({ resource }) => selectedIdSet.has(resource.id!));
  const isPartiallySelected = selectedSelectableCount > 0 && !isAllSelected;

  return (
    <section
      data-testid="esigning-document-selection"
      className="rounded-lg border border-oak-primary/25 bg-oak-primary/5 p-4"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Documents to send</h3>
          <p className="mt-0.5 text-xs text-text-secondary">
            Select the finalized documents to include in this signing request.
          </p>
        </div>
        {!isLoading && !error && selectableOptions.length > 0 ? (
          <span className="shrink-0 text-xs font-medium text-oak-primary" aria-live="polite">
            {selectedSelectableCount} of {selectableOptions.length} selected
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <p role="status" className="mt-3 text-xs text-text-secondary">Loading task documents…</p>
      ) : error ? (
        <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">
          Task documents could not be loaded. Try again before opening the workspace.
        </p>
      ) : options.length === 0 ? (
        <p className="mt-3 text-xs text-text-secondary">
          No finalized generated documents are available to send yet.
        </p>
      ) : (
        <div className="mt-3 space-y-1.5">
          <label className="flex cursor-pointer items-center gap-3 rounded-md border-b border-oak-primary/15 px-2 py-2 text-sm font-medium text-text-primary">
            <input
              type="checkbox"
              aria-label="Select all documents"
              aria-checked={isPartiallySelected ? 'mixed' : isAllSelected ? 'true' : 'false'}
              checked={isAllSelected}
              ref={(input) => {
                if (input) input.indeterminate = isPartiallySelected;
              }}
              onChange={onToggleAll}
              disabled={disabled || selectableOptions.length === 0}
              className="h-4 w-4 rounded border-border-secondary text-oak-primary focus:ring-oak-primary/30"
            />
            <span>Select all</span>
          </label>
          {options.map(({ resource, stageName }) => {
            const documentId = resource.id!;
            const isSelectable = isSelectableEsigningDocument(resource);
            const isSelected = selectedIdSet.has(documentId);
            return (
              <label
                key={documentId}
                className={cn(
                  'flex items-start gap-3 rounded-md px-2 py-2 text-sm transition-colors',
                  isSelectable
                    ? 'cursor-pointer text-text-primary hover:bg-background-secondary'
                    : 'cursor-not-allowed text-text-muted',
                )}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${resource.title || resource.label}`}
                  checked={isSelected}
                  onChange={() => onToggle(documentId)}
                  disabled={disabled || !isSelectable}
                  className="mt-0.5 h-4 w-4 rounded border-border-secondary text-oak-primary focus:ring-oak-primary/30"
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{resource.title || resource.label}</span>
                  <span className="mt-0.5 block text-xs text-text-secondary">
                    {stageName} · {resource.status ? statusLabel(resource.status) : 'Not ready'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}

function launchHref(stage: TaskStageDetail) {
  if (!stage.launch.href) return null;
  return withTaskLaunchContext(stage.launch.href, {
    ...stage.launch.context,
    returnTo: stage.launch.context.returnTo ?? '/tasks',
  });
}

function primaryActionLabel(stage: TaskStageDetail) {
  if (stage.actionType === 'MANUAL' || stage.status === 'SKIPPED') {
    return stage.status === 'COMPLETED' || stage.status === 'SKIPPED'
      ? 'Reopen stage'
      : 'Complete stage';
  }
  return {
    COMPANY_PROFILE: 'Create company',
    DOCUMENT_GENERATION: 'Open document generator',
    ESIGNING: 'Open e-signing workspace',
  }[stage.actionType];
}

export function TaskStageModal({
  isOpen,
  stage,
  isLoading = false,
  error,
  onClose,
  onUpdateMetadata,
  onTransition,
  onStartBizFileReview,
  isMutating = false,
  companies = [],
  taskCompanyId,
  taskDueDate,
  onNavigateStage,
  hasPreviousStage = false,
  hasNextStage = false,
  resources,
  isResourcesLoading = false,
  resourcesError,
  onRetryResources,
}: TaskStageModalProps) {
  const [notes, setNotes] = useState('');
  const [notesSaveStatus, setNotesSaveStatus] = useState<StageNotesSaveStatus>('idle');
  const onUpdateMetadataRef = useRef(onUpdateMetadata);
  const [showSkip, setShowSkip] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [skipError, setSkipError] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [bizFile, setBizFile] = useState<File | null>(null);
  const [bizFileError, setBizFileError] = useState('');
  const [isUploadingBizFile, setIsUploadingBizFile] = useState(false);
  const [selectedGeneratedDocumentIds, setSelectedGeneratedDocumentIds] = useState<string[]>([]);
  const [documentSelectionError, setDocumentSelectionError] = useState('');
  const selectionStageIdRef = useRef<string | null>(null);
  const persistedStageId = stage?.id;
  const persistedStageNotes = stage?.notes ?? '';
  const knownCompanyOptions = useMemo(() => companies.map(toCompanySearchOption), [companies]);
  const isLinkedCompanySelected = Boolean(
    taskCompanyId
    && selectedCompanyId
    && selectedCompanyId === taskCompanyId,
  );
  const isReplacementCompanySelected = Boolean(
    taskCompanyId
    && selectedCompanyId
    && selectedCompanyId !== taskCompanyId,
  );
  const companySelectionState = isLinkedCompanySelected
    ? 'unchanged'
    : isReplacementCompanySelected
      ? 'replacement'
      : selectedCompanyId
        ? 'new'
        : 'empty';

  const taskEsigningDocumentOptions = useMemo<EsigningDocumentSelectionOption[]>(() => {
    if (!stage || stage.actionType !== 'ESIGNING' || !resources) return [];
    const seenIds = new Set<string>();
    return resources.stages
      .filter((resourceStage) => resourceStage.position < stage.position)
      .flatMap((resourceStage) => resourceStage.resources
        .filter(isGeneratedDocumentResource)
        .flatMap((resource) => {
          if (!resource.id || seenIds.has(resource.id)) return [];
          seenIds.add(resource.id);
          return [{ resource, stageName: resourceStage.name }];
        }))
      .sort((left, right) => left.resource.title?.localeCompare(right.resource.title ?? '') ?? 0);
  }, [resources, stage]);
  const selectableTaskEsigningDocuments = useMemo(
    () => taskEsigningDocumentOptions.filter(({ resource }) => isSelectableEsigningDocument(resource)),
    [taskEsigningDocumentOptions],
  );
  const hasLinkedEsigningEnvelope = Boolean(
    stage?.actionType === 'ESIGNING'
    && stage.outcome?.type === 'ESIGNING_ENVELOPE'
    && stage.outcome.esigningEnvelopeId,
  );
  const linkedEsigningEnvelopeResource = useMemo(() => {
    if (!stage || stage.actionType !== 'ESIGNING' || !resources) return null;
    const resourceStage = resources.stages.find(({ id }) => id === stage.id);
    return resourceStage?.resources.find(isAvailableEsigningEnvelopeResource) ?? null;
  }, [resources, stage]);
  const linkedEsigningEnvelopeId = stage?.actionType === 'ESIGNING'
    && stage.outcome?.type === 'ESIGNING_ENVELOPE'
    ? stage.outcome.esigningEnvelopeId ?? ''
    : '';
  const isLinkedEsigningDraft = Boolean(
    hasLinkedEsigningEnvelope
    && linkedEsigningEnvelopeResource?.status === 'DRAFT',
  );
  const linkedEsigningGeneratedDocumentIds = useMemo(
    () => linkedEsigningEnvelopeResource?.generatedDocumentIds ?? [],
    [linkedEsigningEnvelopeResource?.generatedDocumentIds],
  );
  const linkedEsigningEnvelopeHasDocuments = Boolean(
    linkedEsigningEnvelopeResource && linkedEsigningEnvelopeResource.documents.length > 0,
  );
  const isTaskEsigningDocumentSelectionReady = Boolean(
    stage?.actionType === 'ESIGNING'
    && resources
    && !isResourcesLoading
    && !resourcesError
    && (!hasLinkedEsigningEnvelope || isLinkedEsigningDraft),
  );
  const [isAttachingGeneratedDocuments, setIsAttachingGeneratedDocuments] = useState(false);
  const attachGeneratedDocuments = {
    isPending: isAttachingGeneratedDocuments,
    mutateAsync: async (documentIds: string[]) => {
      setIsAttachingGeneratedDocuments(true);
      try {
        return await attachGeneratedDocumentsRequest(linkedEsigningEnvelopeId, documentIds);
      } finally {
        setIsAttachingGeneratedDocuments(false);
      }
    },
  };

  useEffect(() => {
    onUpdateMetadataRef.current = onUpdateMetadata;
  }, [onUpdateMetadata]);

  useEffect(() => {
    setNotes(stage?.notes ?? '');
    setNotesSaveStatus('idle');
    setShowSkip(false);
    setSkipReason('');
    setSkipError('');
    setSelectedCompanyId(taskCompanyId ?? '');
    setBizFile(null);
    setBizFileError('');
    setIsUploadingBizFile(false);
    selectionStageIdRef.current = null;
    setDocumentSelectionError('');
    setSelectedGeneratedDocumentIds([]);
  }, [stage?.actionType, stage?.id, stage?.isRequired, stage?.notes, taskCompanyId]);

  useEffect(() => {
    if (!stage || stage.actionType !== 'ESIGNING' || !isTaskEsigningDocumentSelectionReady) {
      selectionStageIdRef.current = null;
      setSelectedGeneratedDocumentIds([]);
      return;
    }

    const availableIds = selectableTaskEsigningDocuments
      .map(({ resource }) => resource.id)
      .filter((id): id is string => Boolean(id));
    const availableIdSet = new Set(availableIds);
    setSelectedGeneratedDocumentIds((current) => {
      if (selectionStageIdRef.current !== stage.id) {
        if (availableIds.length === 0) return current;
        selectionStageIdRef.current = stage.id;
        return hasLinkedEsigningEnvelope
          ? availableIds.filter((id) => linkedEsigningGeneratedDocumentIds.includes(id))
          : availableIds;
      }
      return current.filter((id) => availableIdSet.has(id));
    });
  }, [
    hasLinkedEsigningEnvelope,
    isTaskEsigningDocumentSelectionReady,
    linkedEsigningGeneratedDocumentIds,
    selectableTaskEsigningDocuments,
    stage,
  ]);

  useEffect(() => {
    if (!persistedStageId || notes === persistedStageNotes) return;
    let isCurrent = true;
    const timeoutId = window.setTimeout(() => {
      setNotesSaveStatus('saving');
      void Promise.resolve(onUpdateMetadataRef.current({ notes: notes.trim() || null }))
        .then(() => {
          if (isCurrent) setNotesSaveStatus('saved');
        })
        .catch(() => {
          if (isCurrent) setNotesSaveStatus('error');
        });
    }, 600);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
    };
  }, [notes, persistedStageId, persistedStageNotes]);

  const resolvedLaunchHref = useMemo(() => stage ? launchHref(stage) : null, [stage]);
  const taskEsigningLaunchHref = useMemo(() => {
    if (!resolvedLaunchHref || !isTaskEsigningDocumentSelectionReady || hasLinkedEsigningEnvelope) {
      return resolvedLaunchHref;
    }
    const [path, query = ''] = resolvedLaunchHref.split('?');
    const params = new URLSearchParams(query);
    params.delete('generatedDocumentId');
    params.delete('generatedDocumentIds');
    selectedGeneratedDocumentIds.forEach((documentId) => params.append('generatedDocumentIds', documentId));
    return `${path}?${params.toString()}`;
  }, [hasLinkedEsigningEnvelope, isTaskEsigningDocumentSelectionReady, resolvedLaunchHref, selectedGeneratedDocumentIds]);
  const canCreateCompany = stage?.actionType === 'COMPANY_PROFILE'
    && Boolean(resolvedLaunchHref);
  const createCompanyHref = useMemo(() => {
    if (!stage || !canCreateCompany) return null;
    return withTaskLaunchContext('/companies/new', {
      ...stage.launch.context,
      returnTo: stage.launch.context.returnTo ?? '/tasks',
    });
  }, [canCreateCompany, stage]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      setBizFile(acceptedFiles[0] ?? null);
      setBizFileError('');
    },
    onDropRejected: (rejections) => {
      setBizFile(null);
      const code = rejections[0]?.errors[0]?.code;
      setBizFileError(code === 'file-too-large'
        ? 'The BizFile must be 10MB or smaller.'
        : 'Choose a PDF, PNG, JPG, or WebP file.');
    },
    accept: {
      'application/pdf': ['.pdf'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/webp': ['.webp'],
    },
    maxSize: 10 * 1024 * 1024,
    multiple: false,
    disabled: isMutating || isUploadingBizFile,
  });

  if (!isOpen) return null;

  const runAction = (action: () => void | Promise<void>) => {
    try {
      void Promise.resolve(action()).catch(() => undefined);
    } catch {
      // The owning workspace supplies the recoverable mutation error.
    }
  };

  const renderPrimaryAction = () => {
    if (!stage) return null;
    const label = primaryActionLabel(stage);
    const isBlocked = stage.blockers.length > 0;
    const canOpenLinkedDraft = isLinkedEsigningDraft && (
      linkedEsigningEnvelopeHasDocuments || selectedGeneratedDocumentIds.length > 0
    );

    if (
      stage.actionType === 'ESIGNING'
      && isTaskEsigningDocumentSelectionReady
      && selectedGeneratedDocumentIds.length === 0
      && !canOpenLinkedDraft
    ) {
      return (
        <Button
          data-testid="stage-primary-action"
          disabled
          leftIcon={<ArrowUpRight />}
        >
          Select documents to continue
        </Button>
      );
    }

    if (stage.status === 'SKIPPED' || (
      stage.actionType === 'MANUAL' && stage.status === 'COMPLETED'
    )) {
      return (
        <Button
          data-testid="stage-primary-action"
          onClick={() => runAction(() => onTransition({ action: 'reopen' }))}
          isLoading={isMutating}
          leftIcon={<CheckCircle2 />}
        >
          {label}
        </Button>
      );
    }
    if (stage.actionType === 'MANUAL') {
      return (
        <Button
          data-testid="stage-primary-action"
          onClick={() => runAction(() => onTransition({ action: 'complete' }))}
          disabled={isBlocked}
          isLoading={isMutating}
          leftIcon={<CheckCircle2 />}
        >
          {label}
        </Button>
      );
    }
    if (stage.actionType === 'COMPANY_PROFILE' && selectedCompanyId) {
      if (isLinkedCompanySelected) {
        return (
          <Button
            data-testid="stage-primary-action"
            disabled
            leftIcon={<Link2 />}
          >
            Company already linked
          </Button>
        );
      }
      return (
        <Button
          data-testid="stage-primary-action"
          onClick={() => runAction(() => onTransition({
            action: 'linkOutcome',
            outcome: { type: 'COMPANY', companyId: selectedCompanyId },
          }))}
          isLoading={isMutating}
          leftIcon={<Link2 />}
        >
          {taskCompanyId ? 'Replace linked company' : 'Link selected company'}
        </Button>
      );
    }
    if (stage.actionType === 'COMPANY_PROFILE' && !canCreateCompany) {
      return (
        <Button
          data-testid="stage-primary-action"
          disabled
          leftIcon={<Link2 />}
        >
          Select an existing company
        </Button>
      );
    }
    if (stage.actionType === 'COMPANY_PROFILE') {
      return (
        <Button
          data-testid="stage-primary-action"
          disabled
          leftIcon={<Link2 />}
        >
          Select an existing company
        </Button>
      );
    }
    if (isLinkedEsigningDraft && linkedEsigningEnvelopeId && taskEsigningLaunchHref) {
      return (
        <Button
          data-testid="stage-primary-action"
          onClick={() => {
            const linkedDocumentIds = new Set(linkedEsigningGeneratedDocumentIds);
            const documentIdsToAttach = selectedGeneratedDocumentIds.filter((id) => !linkedDocumentIds.has(id));
            setDocumentSelectionError('');
            if (documentIdsToAttach.length === 0) {
              window.location.assign(taskEsigningLaunchHref);
              return;
            }
            void attachGeneratedDocuments.mutateAsync(documentIdsToAttach)
              .then(() => {
                window.location.assign(taskEsigningLaunchHref);
              })
              .catch((attachError) => {
                setDocumentSelectionError(
                  attachError instanceof Error
                    ? attachError.message
                    : 'Could not add the selected documents to the signing request.',
                );
              });
          }}
          disabled={isBlocked || isMutating || attachGeneratedDocuments.isPending}
          isLoading={attachGeneratedDocuments.isPending}
          leftIcon={<ArrowUpRight />}
        >
          {label}
        </Button>
      );
    }
    if (isBlocked || !taskEsigningLaunchHref) {
      return (
        <Button
          data-testid="stage-primary-action"
          disabled
          leftIcon={<ArrowUpRight />}
        >
          {label}
        </Button>
      );
    }
    return (
      <a
        data-testid="stage-primary-action"
        href={taskEsigningLaunchHref}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-oak-primary px-5 text-sm font-medium text-white transition-colors hover:bg-oak-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 focus-visible:ring-offset-2"
      >
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        {label}
      </a>
    );
  };

  return (
    <PipelineStageModalFrame
      isOpen={isOpen}
      stage={stage}
      onClose={onClose}
      isMutating={isMutating}
      aside={(
        <TaskResourcesPanel
          data={resources}
          activeStageId={stage?.id}
          isLoading={isResourcesLoading}
          error={resourcesError}
          onRetry={onRetryResources ?? (() => undefined)}
        />
      )}
      footer={stage ? (
        <PipelineStageModalFooter
          isRequired={stage.isRequired}
          isMutating={isMutating}
          hasPreviousStage={hasPreviousStage}
          hasNextStage={hasNextStage}
          onNavigateStage={onNavigateStage}
          primaryAction={renderPrimaryAction()}
        />
      ) : undefined}
    >
      {isLoading ? <div role="status" className="py-8 text-center text-sm text-text-secondary">Loading stage…</div> : null}
      {error ? <Alert variant="error">{error.message}</Alert> : null}
      {stage?.actionType === 'COMPANY_PROFILE' && stage.status === 'FAILED' ? (
        <Alert variant="warning" title="Linked company no longer available">
          The company previously linked to this stage is no longer available, so the stage was marked as failed. Select a company below to link this stage again.
        </Alert>
      ) : null}
      {stage ? (
        <>
          <PipelineStageLinkedOutcome stage={stage} />
          <PipelineStageMetadata stage={stage} taskDueDate={taskDueDate} />

          {stage.actionType === 'ESIGNING' && isTaskEsigningDocumentSelectionReady && (resources || isResourcesLoading || resourcesError) ? (
            <EsigningDocumentSelection
              options={taskEsigningDocumentOptions}
              selectedIds={selectedGeneratedDocumentIds}
              isLoading={isResourcesLoading}
              error={resourcesError}
              disabled={isMutating || attachGeneratedDocuments.isPending}
              onToggle={(documentId) => {
                  setSelectedGeneratedDocumentIds((current) => (
                  current.includes(documentId)
                    ? current.filter((id) => id !== documentId)
                    : [...current, documentId]
                  ));
                  setDocumentSelectionError('');
                }}
              onToggleAll={() => {
                const selectableIds = selectableTaskEsigningDocuments
                  .map(({ resource }) => resource.id)
                  .filter((id): id is string => Boolean(id));
                setSelectedGeneratedDocumentIds((current) => (
                  current.length === selectableIds.length ? [] : selectableIds
                  ));
                  setDocumentSelectionError('');
                }}
              />
          ) : null}
          {documentSelectionError ? <Alert variant="error">{documentSelectionError}</Alert> : null}

          {stage.actionType === 'COMPANY_PROFILE' && stage.status !== 'SKIPPED' ? (
              <>
                {canCreateCompany ? (
                  <div className="space-y-2">
                    <div>
                      <h4 className="text-base font-semibold text-text-primary">
                        1. Create a new company profile
                      </h4>
                      <p className="mt-0.5 text-sm text-text-muted">BizFile or manual entry</p>
                    </div>
                    <div
                      data-testid="company-profile-create-option"
                    >
                      <section
                        data-testid="company-profile-create-panel"
                        className="rounded-lg border border-border-primary bg-background-primary p-4"
                      >
                      <div className="flex items-start gap-2">
                        <FileUp className="mt-0.5 h-4 w-4 text-oak-primary" aria-hidden="true" />
                        <div>
                          <h3 className="text-sm font-semibold text-text-primary">Upload BizFile</h3>
                          <p className="mt-0.5 text-xs text-text-muted">Extract and review company details before creating the profile.</p>
                        </div>
                      </div>
                      <div
                        {...getRootProps()}
                        data-testid="company-profile-dropzone"
                        className={cn(
                          'mt-3 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-4 text-center transition-colors',
                          isDragActive
                            ? 'border-oak-primary bg-oak-primary/5'
                            : 'border-border-secondary hover:border-oak-primary/60 hover:bg-background-elevated',
                        )}
                      >
                        <input {...getInputProps({ 'aria-label': 'Upload BizFile file' })} />
                        <FileUp className="h-6 w-6 text-text-muted" aria-hidden="true" />
                        <p className="mt-1.5 text-sm font-medium text-text-primary">
                          {isDragActive ? 'Drop the file here' : 'Drop a file or click to browse'}
                        </p>
                        <p className="mt-1 text-xs text-text-muted">PDF, PNG, JPG, or WebP · max 10MB</p>
                      </div>
                      {bizFile ? (
                        <div className="mt-2 flex items-center gap-3 rounded-lg border border-border-primary bg-background-secondary px-3 py-2">
                          <FileUp className="h-4 w-4 shrink-0 text-oak-primary" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{bizFile.name}</span>
                          <button
                            type="button"
                            aria-label={`Remove ${bizFile.name}`}
                            onClick={() => setBizFile(null)}
                            disabled={isUploadingBizFile}
                            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-background-elevated hover:text-text-primary"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      ) : null}
                      {bizFileError ? <Alert variant="error" className="mt-3">{bizFileError}</Alert> : null}
                      <div
                        data-testid="company-profile-action-row"
                        className="mt-3 grid gap-2 sm:grid-cols-3"
                      >
                        <Button
                          className="w-full disabled:text-white/90 disabled:opacity-70 sm:col-span-2"
                          onClick={() => {
                            if (!bizFile || !onStartBizFileReview) return;
                            setBizFileError('');
                            setIsUploadingBizFile(true);
                            try {
                              void Promise.resolve(onStartBizFileReview(bizFile))
                                .catch((uploadError) => {
                                  setBizFileError(uploadError instanceof Error ? uploadError.message : 'Failed to upload the BizFile.');
                                })
                                .finally(() => setIsUploadingBizFile(false));
                            } catch (uploadError) {
                              setBizFileError(uploadError instanceof Error ? uploadError.message : 'Failed to upload the BizFile.');
                              setIsUploadingBizFile(false);
                            }
                          }}
                          disabled={!bizFile || !onStartBizFileReview}
                          isLoading={isUploadingBizFile}
                          leftIcon={<FileUp />}
                        >
                          Upload and review BizFile
                        </Button>
                        <a
                          href={createCompanyHref ?? undefined}
                          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-border-primary bg-background-secondary px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-background-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 focus-visible:ring-offset-2 sm:col-span-1"
                        >
                          <Building2 className="h-4 w-4" aria-hidden="true" />
                          Enter company manually
                        </a>
                      </div>
                      </section>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <h4 className="text-base font-semibold text-text-primary">
                    2. Or link an existing company
                  </h4>
                  <div
                    data-testid="company-profile-existing-option"
                    data-selection-state={companySelectionState}
                  >
                    <CompanySelect
                      value={selectedCompanyId}
                      onChange={(companyId) => setSelectedCompanyId(companyId)}
                      label="Existing company"
                      placeholder="Search by company name or UEN"
                      disabled={isMutating}
                      pinned={knownCompanyOptions}
                      allowReselect
                      enabled={isOpen}
                      className={cn(
                        isLinkedCompanySelected
                          && '[&>div]:border-emerald-300 [&>div]:bg-emerald-50/60 dark:[&>div]:border-emerald-800 dark:[&>div]:bg-emerald-950/30',
                        isReplacementCompanySelected
                          && '[&>div]:border-amber-300 [&>div]:bg-amber-50/60 dark:[&>div]:border-amber-800 dark:[&>div]:bg-amber-950/30',
                      )}
                    />
                    <p className="mt-1 text-xs text-text-muted">Search by company name or UEN</p>
                  </div>
                </div>
              </>
          ) : null}

            {stage.checklistItems.length > 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-text-primary">Checklist</h3>
                <div className="space-y-1 rounded-lg border border-border-primary">
                  {stage.checklistItems.map((item) => (
                    <label key={item.id} className="flex min-h-11 items-center gap-3 border-b border-border-primary px-3 py-2 last:border-b-0">
                      <input
                        type="checkbox"
                        checked={item.isCompleted}
                        onChange={(event) => runAction(() => onTransition({ action: 'checklist', checklistItemId: item.id, isCompleted: event.target.checked }))}
                        disabled={isMutating}
                        className="h-4 w-4 rounded border-border-secondary text-oak-primary focus:ring-oak-primary"
                      />
                      {item.isCompleted ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <Circle className="h-4 w-4 text-text-muted" aria-hidden="true" />}
                      <span className={cn('text-sm', item.isCompleted ? 'text-text-secondary line-through' : 'text-text-primary')}>{item.label}</span>
                    </label>
                  ))}
                </div>
              </section>
            ) : null}

            <PipelineStageNotes
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              saveStatus={notesSaveStatus}
            />

            {stage.blockers.length > 0 ? (
              <Alert variant="warning" title="Action blocked">
                <ul className="list-disc space-y-1 pl-4">
                  {stage.blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}
                </ul>
              </Alert>
            ) : null}

            {!stage.isRequired && !['COMPLETED', 'SKIPPED'].includes(stage.status) ? (
              <section className="rounded-lg border border-dashed border-border-secondary p-3">
                {!showSkip ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-text-secondary">This stage is optional.</p>
                    <Button variant="ghost" size="xs" onClick={() => setShowSkip(true)}>Skip stage</Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label htmlFor="stage-skip-reason" className="block text-xs font-medium text-text-secondary">Skip reason</label>
                    <textarea
                      id="stage-skip-reason"
                      aria-label="Skip reason"
                      value={skipReason}
                      onChange={(event) => {
                        setSkipReason(event.target.value);
                        if (skipError) setSkipError('');
                      }}
                      rows={2}
                      className="input w-full resize-y px-3 py-2 text-sm"
                    />
                    {skipError ? <p className="text-xs text-red-500">{skipError}</p> : null}
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="xs" onClick={() => setShowSkip(false)}>Keep stage</Button>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => {
                          if (!skipReason.trim()) {
                            setSkipError('Skip reason is required');
                            return;
                          }
                          runAction(() => onTransition({ action: 'skip', reason: skipReason.trim() }));
                        }}
                      >
                        Confirm skip
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            ) : null}
        </>
      ) : null}
    </PipelineStageModalFrame>
  );
}
