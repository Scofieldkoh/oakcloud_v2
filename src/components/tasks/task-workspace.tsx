'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ListChecks, Plus } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ListEmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FilterChip } from '@/components/ui/filter-chip';
import { Pagination } from '@/components/ui/pagination';
import { useCurrentWorkspaceUsers } from '@/hooks/use-admin';
import { useSession } from '@/hooks/use-auth';
import { useCompanies } from '@/hooks/use-companies';
import { useTaskPipelines } from '@/hooks/use-task-pipelines';
import {
  useArchiveTask,
  useCreateTask,
  useTaskStage,
  useTaskStageTransition,
  useTaskStatusMutation,
  useTasks,
  useUpdateTask,
  useUpdateTaskStage,
  type TaskListParams,
  type TaskStatusAction,
} from '@/hooks/use-tasks';
import { useTaskResources } from '@/hooks/use-task-resources';
import type {
  TaskCreatePayload,
  TaskListItem,
  TaskStageSummary,
  TaskUpdatePayload,
} from '@/services/tasks/types';
import { postFormDataWithFallback } from '@/lib/browser-upload';
import { withTaskLaunchContext } from '@/lib/task-launch-context';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { TaskFilters } from './task-filters';
import { TaskFormModal } from './task-form-modal';
import { TaskList } from './task-list';
import { TaskStageModal } from './task-stage-modal';

interface SelectedStage {
  task: TaskListItem;
  stage: TaskStageSummary;
}

interface PendingConfirmation {
  task: TaskListItem;
  type: 'cancel' | 'archive';
}

function returnedStageToOpen(task: TaskListItem, returnedStageId: string) {
  const orderedStages = [...task.stages].sort((left, right) => left.position - right.position);
  const returnedStageIndex = orderedStages.findIndex((stage) => stage.id === returnedStageId);
  const returnedStage = returnedStageIndex >= 0 ? orderedStages[returnedStageIndex] : undefined;

  if (!returnedStage || returnedStage.status !== 'COMPLETED') return returnedStage;

  return orderedStages
    .slice(returnedStageIndex + 1)
    .find((stage) => stage.status !== 'COMPLETED' && stage.status !== 'SKIPPED')
    ?? returnedStage;
}

export function TaskWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [filters, setFilters] = useState<TaskListParams>({ page: 1, limit: 20 });
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingTask, setEditingTask] = useState<TaskListItem | null>(null);
  const [selectedStage, setSelectedStage] = useState<SelectedStage | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const restoredStageKeyRef = useRef<string | null>(null);
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  const taskQuery = useTasks(filters);
  const pipelineQuery = useTaskPipelines();
  const companyQuery = useCompanies({ limit: 200, sortBy: 'name', sortOrder: 'asc' });
  const ownerQuery = useCurrentWorkspaceUsers({ limit: 200, sortBy: 'firstName', sortOrder: 'asc' });
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const archiveTask = useArchiveTask();
  const statusMutation = useTaskStatusMutation();
  const stageQuery = useTaskStage(
    selectedStage?.task.id ?? '',
    selectedStage?.stage.id ?? '',
  );
  const resourcesQuery = useTaskResources(
    selectedStage?.task.id ?? '',
    Boolean(selectedStage),
  );
  const updateStage = useUpdateTaskStage();
  const transitionStage = useTaskStageTransition();

  const pipelines = useMemo(() => pipelineQuery.data ?? [], [pipelineQuery.data]);
  const companies = useMemo(
    () => companyQuery.data?.companies ?? [],
    [companyQuery.data?.companies],
  );
  const owners = useMemo(
    () => ownerQuery.data?.users ?? [],
    [ownerQuery.data?.users],
  );
  const tasks = useMemo(() => taskQuery.data?.tasks ?? [], [taskQuery.data?.tasks]);
  const returnedTaskId = searchParams.get('taskId');
  const returnedStageId = searchParams.get('taskStageId');
  const selectedStageIndex = selectedStage
    ? selectedStage.task.stages.findIndex((candidate) => candidate.id === selectedStage.stage.id)
    : -1;
  const optionQueryErrors = [
    pipelineQuery.error ? `Pipelines: ${pipelineQuery.error.message}` : null,
    companyQuery.error ? `Companies: ${companyQuery.error.message}` : null,
    ownerQuery.error ? `Owners: ${ownerQuery.error.message}` : null,
  ].filter((message): message is string => Boolean(message));
  const mutationError = (
    createTask.error
    || updateTask.error
    || archiveTask.error
    || statusMutation.error
    || updateStage.error
    || transitionStage.error
  );
  const selectedStageCompany = selectedStage?.task.company ?? null;
  const selectedStageCompanies = useMemo(
    () => (selectedStageCompany ? [selectedStageCompany] : []),
    [selectedStageCompany],
  );
  const activeFilterChips = useMemo(() => {
    const chips: Array<{
      key: string;
      label: string;
      value: string;
      onRemove: () => void;
    }> = [];
    const statusLabels: Record<NonNullable<TaskListParams['status']>, string> = {
      NOT_STARTED: 'Not started',
      IN_PROGRESS: 'In progress',
      PAUSED: 'Paused',
      COMPLETED: 'Completed',
      CANCELLED: 'Cancelled',
    };
    const dueLabels: Record<NonNullable<TaskListParams['dueBucket']>, string> = {
      overdue: 'Overdue',
      today: 'Today',
      thisWeek: 'This week',
      nextWeek: 'Next week',
    };

    if (filters.query) {
      chips.push({
        key: 'query',
        label: 'Search',
        value: filters.query,
        onRemove: () => setFilters((current) => ({ ...current, page: 1, query: undefined })),
      });
    }
    if (filters.title) {
      chips.push({
        key: 'title',
        label: 'Task',
        value: filters.title,
        onRemove: () => setFilters((current) => ({ ...current, page: 1, title: undefined })),
      });
    }
    if (filters.companyId) {
      chips.push({
        key: 'companyId',
        label: 'Company',
        value: companies.find((company) => company.id === filters.companyId)?.name ?? filters.companyId,
        onRemove: () => setFilters((current) => ({ ...current, page: 1, companyId: undefined })),
      });
    }
    if (filters.status) {
      chips.push({
        key: 'status',
        label: 'Status',
        value: statusLabels[filters.status],
        onRemove: () => setFilters((current) => ({ ...current, page: 1, status: undefined })),
      });
    }
    if (filters.pipelineId) {
      chips.push({
        key: 'pipelineId',
        label: 'Pipeline',
        value: pipelines.find((pipeline) => pipeline.id === filters.pipelineId)?.name ?? filters.pipelineId,
        onRemove: () => setFilters((current) => ({ ...current, page: 1, pipelineId: undefined })),
      });
    }
    if (filters.ownerId) {
      const owner = owners.find((candidate) => candidate.id === filters.ownerId);
      chips.push({
        key: 'ownerId',
        label: 'Owner',
        value: owner
          ? `${owner.firstName} ${owner.lastName}`.trim() || owner.email
          : filters.ownerId,
        onRemove: () => setFilters((current) => ({ ...current, page: 1, ownerId: undefined })),
      });
    }
    if (filters.ownerQuery) {
      chips.push({
        key: 'ownerQuery',
        label: 'Owner text',
        value: filters.ownerQuery,
        onRemove: () => setFilters((current) => ({
          ...current,
          page: 1,
          ownerQuery: undefined,
        })),
      });
    }
    if (filters.dueBucket) {
      chips.push({
        key: 'dueBucket',
        label: 'Due',
        value: dueLabels[filters.dueBucket],
        onRemove: () => setFilters((current) => ({ ...current, page: 1, dueBucket: undefined })),
      });
    }
    if (filters.dueDateFrom || filters.dueDateTo) {
      chips.push({
        key: 'dueDateRange',
        label: 'Due dates',
        value: `${filters.dueDateFrom ?? 'Any'} – ${filters.dueDateTo ?? 'Any'}`,
        onRemove: () => setFilters((current) => ({
          ...current,
          page: 1,
          dueDateFrom: undefined,
          dueDateTo: undefined,
        })),
      });
    }

    return chips;
  }, [companies, filters, owners, pipelines]);

  useEffect(() => {
    if (!returnedTaskId || !returnedStageId) return;
    if (taskQuery.isFetching) return;
    const restoredStageKey = `${returnedTaskId}:${returnedStageId}`;
    if (restoredStageKeyRef.current === restoredStageKey) return;

    const returnedTask = tasks.find((task) => task.id === returnedTaskId);
    const stageToOpen = returnedTask
      ? returnedStageToOpen(returnedTask, returnedStageId)
      : undefined;
    if (!returnedTask || !stageToOpen) return;

    restoredStageKeyRef.current = restoredStageKey;
    setSelectedStage({ task: returnedTask, stage: stageToOpen });
    router.replace('/tasks', { scroll: false });
  }, [returnedStageId, returnedTaskId, router, taskQuery.isFetching, tasks]);

  const closeForm = () => {
    if (createTask.isPending || updateTask.isPending) return;
    setFormMode(null);
    setEditingTask(null);
    createTask.reset();
    updateTask.reset();
  };

  const handleStatusAction = (task: TaskListItem, action: TaskStatusAction) => {
    if (action === 'cancel') {
      statusMutation.reset();
      setConfirmation({ task, type: 'cancel' });
      return;
    }
    statusMutation.mutate({ id: task.id, action });
  };

  const handleFormSubmit = async (payload: TaskCreatePayload | TaskUpdatePayload) => {
    if (formMode === 'create') {
      await createTask.mutateAsync(payload as TaskCreatePayload);
    } else if (editingTask) {
      await updateTask.mutateAsync({ id: editingTask.id, payload: payload as TaskUpdatePayload });
    }
    closeForm();
  };

  return (
    <div className="space-y-6 p-4 sm:p-6" data-testid="task-workspace">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary sm:text-2xl">Tasks</h1>
          <p className="mt-1 text-sm text-text-secondary">Track work through reusable pipelines and open each stage in context.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/pipelines"
            className="inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border-primary bg-background-elevated px-4 text-sm font-medium text-text-primary transition-colors hover:bg-background-tertiary sm:min-h-8"
          >
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            Manage pipelines
          </Link>
          <Button
            leftIcon={<Plus />}
            onClick={() => {
              createTask.reset();
              setEditingTask(null);
              setFormMode('create');
            }}
          >
            Create task
          </Button>
        </div>
      </div>

      <TaskFilters
        value={filters}
        onChange={setFilters}
        currentUserId={session?.id}
      />

      {activeFilterChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-text-secondary">Active filters:</span>
          {activeFilterChips.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              value={chip.value}
              onRemove={chip.onRemove}
            />
          ))}
          <button
            type="button"
            onClick={() => setFilters({ page: 1, limit: filters.limit ?? 20 })}
            className="ml-2 text-sm font-medium text-oak-primary transition-colors hover:text-oak-primary/80"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {optionQueryErrors.length > 0 ? (
        <Alert variant="error" title="Task options unavailable">
          <ul className="list-disc space-y-1 pl-4">
            {optionQueryErrors.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </Alert>
      ) : null}

      {mutationError && !formMode ? (
        <Alert
          variant="error"
          title="Task action failed"
          onClose={() => {
            createTask.reset();
            updateTask.reset();
            archiveTask.reset();
            statusMutation.reset();
            updateStage.reset();
            transitionStage.reset();
          }}
        >
          {mutationError.message}
        </Alert>
      ) : null}

      {taskQuery.isLoading ? (
        <div className="card p-6 text-sm text-text-secondary" role="status">Loading tasks…</div>
      ) : taskQuery.error ? (
        <Alert variant="error">{taskQuery.error.message}</Alert>
      ) : (
        <TaskList
          tasks={tasks}
          emptyState={(
            <ListEmptyState
              icon={ListChecks}
              noun="tasks"
              filtered={activeFilterChips.length > 0}
              onClearFilters={() => setFilters({ page: 1, limit: filters.limit ?? 20 })}
              emptyDescription="Create a task to track work for a client."
              createAction={(
                <Button
                  size="sm"
                  leftIcon={<Plus />}
                  onClick={() => {
                    createTask.reset();
                    setEditingTask(null);
                    setFormMode('create');
                  }}
                >
                  Create task
                </Button>
              )}
            />
          )}
          filters={filters}
          pipelines={pipelines}
          companies={companies}
          owners={owners}
          onFiltersChange={setFilters}
          onUpdateMetadata={async (task, payload) => {
            await updateTask.mutateAsync({
              id: task.id,
              payload,
            });
          }}
          onSelectStage={(task, stage) => {
            updateStage.reset();
            transitionStage.reset();
            setSelectedStage({ task, stage });
          }}
          onEdit={(task) => {
            updateTask.reset();
            setEditingTask(task);
            setFormMode('edit');
          }}
          onStatusAction={handleStatusAction}
          onArchive={(task) => {
            archiveTask.reset();
            setConfirmation({ task, type: 'archive' });
          }}
          busyTaskId={statusMutation.isPending ? statusMutation.variables?.id ?? null : null}
        />
      )}

      {taskQuery.data && taskQuery.data.total > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border-primary bg-background-elevated shadow-elevation-1 dark:bg-background-secondary dark:shadow-none">
          <Pagination
            page={taskQuery.data.page}
            totalPages={taskQuery.data.totalPages}
            total={taskQuery.data.total}
            limit={taskQuery.data.limit}
            onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
            onLimitChange={(limit) => setFilters((current) => ({ ...current, page: 1, limit }))}
            showJumpToPage={taskQuery.data.totalPages > 1}
          />
        </div>
      ) : null}

      <TaskFormModal
        isOpen={Boolean(formMode)}
        mode={formMode ?? 'create'}
        pipelines={pipelines}
        owners={owners}
        initialTask={editingTask}
        onClose={closeForm}
        onSubmit={handleFormSubmit}
        isSubmitting={createTask.isPending || updateTask.isPending}
        error={(formMode === 'create' ? createTask.error : updateTask.error) ?? null}
      />

      <TaskStageModal
        isOpen={Boolean(selectedStage)}
        stage={stageQuery.data}
        isLoading={stageQuery.isLoading}
        error={stageQuery.error ?? updateStage.error ?? transitionStage.error ?? null}
        resources={resourcesQuery.data}
        isResourcesLoading={resourcesQuery.isLoading}
        resourcesError={resourcesQuery.error}
        onRetryResources={() => void resourcesQuery.refetch()}
        onClose={() => {
          updateStage.reset();
          transitionStage.reset();
          setSelectedStage(null);
        }}
        onUpdateMetadata={async (payload) => {
          if (!selectedStage) return;
          await updateStage.mutateAsync({
            taskId: selectedStage.task.id,
            stageId: selectedStage.stage.id,
            payload,
          });
        }}
        onTransition={async (transition) => {
          if (!selectedStage) return;
          await transitionStage.mutateAsync({
            taskId: selectedStage.task.id,
            stageId: selectedStage.stage.id,
            transition,
          });
        }}
        onNavigateStage={(direction) => {
          if (!selectedStage || selectedStageIndex < 0) return;
          const nextIndex = direction === 'previous'
            ? selectedStageIndex - 1
            : selectedStageIndex + 1;
          const nextStage = selectedStage.task.stages[nextIndex];
          if (!nextStage) return;
          updateStage.reset();
          transitionStage.reset();
          setSelectedStage({ task: selectedStage.task, stage: nextStage });
        }}
        hasPreviousStage={selectedStageIndex > 0}
        hasNextStage={Boolean(
          selectedStage
          && selectedStageIndex >= 0
          && selectedStageIndex < selectedStage.task.stages.length - 1
        )}
        onStartBizFileReview={async (file) => {
          if (!selectedStage || !stageQuery.data) return;
          if (session?.isSuperAdmin && !activeTenantId) {
            throw new Error('Select a workspace before uploading a BizFile.');
          }

          const formData = new FormData();
          formData.append('file', file);
          formData.append('documentType', 'BIZFILE');
          if (session?.isSuperAdmin && activeTenantId) {
            formData.append('tenantId', activeTenantId);
          }

          const response = await postFormDataWithFallback('/api/documents/upload', formData);
          if (!response.ok) {
            let message = 'Failed to upload the BizFile.';
            try {
              const body = await response.json();
              if (typeof body?.error === 'string') message = body.error;
            } catch {
              message = `Failed to upload the BizFile (HTTP ${response.status}).`;
            }
            throw new Error(message);
          }

          const body = await response.json();
          if (typeof body?.documentId !== 'string') {
            throw new Error('The BizFile upload did not return a document ID.');
          }

          await resourcesQuery.refetch();

          const reviewHref = withTaskLaunchContext(
            `/companies/upload?documentId=${encodeURIComponent(body.documentId)}&fileName=${encodeURIComponent(file.name)}`,
            {
              ...stageQuery.data.launch.context,
              returnTo: stageQuery.data.launch.context.returnTo ?? '/tasks',
            },
          );
          router.push(reviewHref);
        }}
        isMutating={updateStage.isPending || transitionStage.isPending}
        companies={selectedStageCompanies}
        taskCompanyId={selectedStage?.task.company?.id ?? null}
        taskDueDate={selectedStage?.task.dueDate ?? null}
      />

      <ConfirmDialog
        isOpen={confirmation?.type === 'cancel'}
        onClose={() => {
          statusMutation.reset();
          setConfirmation(null);
        }}
        onConfirm={async () => {
          if (!confirmation) return;
          await statusMutation.mutateAsync({ id: confirmation.task.id, action: 'cancel' });
          setConfirmation(null);
        }}
        title="Cancel task?"
        description="The task remains available for inspection but cannot continue."
        confirmLabel="Cancel task"
        variant="warning"
        isLoading={statusMutation.isPending}
      >
        {statusMutation.error ? (
          <Alert variant="error" title="Cancellation failed">
            {statusMutation.error.message}
          </Alert>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={confirmation?.type === 'archive'}
        onClose={() => {
          archiveTask.reset();
          setConfirmation(null);
        }}
        onConfirm={async (reason) => {
          if (!confirmation || !reason) return;
          await archiveTask.mutateAsync({ id: confirmation.task.id, reason });
          setConfirmation(null);
        }}
        title="Delete task?"
        description="This soft-deletes the task and preserves its audit history."
        confirmLabel="Delete task"
        requireReason
        reasonMinLength={1}
        isLoading={archiveTask.isPending}
      >
        {archiveTask.error ? (
          <Alert variant="error" title="Delete failed">
            {archiveTask.error.message}
          </Alert>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
