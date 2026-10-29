'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ArchivePayload,
  ArchiveResult,
  TaskCreatePayload,
  TaskListItem,
  TaskListResponse,
  TaskEsigningPreparationSnapshot,
  TaskStageDetail,
  TaskStageOutcomePayload,
  TaskUpdatePayload,
} from '@/services/tasks/types';

export type {
  ArchivePayload,
  ArchiveResult,
  TaskCreatePayload,
  TaskListItem,
  TaskListResponse,
  TaskEsigningPreparationSnapshot,
  TaskEsigningPreparationStatus,
  TaskStageActionType,
  TaskStageDetail,
  TaskStageOutcomePayload,
  TaskStageStatus,
  TaskStatus,
  TaskUpdatePayload,
} from '@/services/tasks/types';

export type TaskDueBucket = 'today' | 'thisWeek' | 'nextWeek' | 'overdue';
export type TaskSortField =
  | 'title'
  | 'company'
  | 'pipeline'
  | 'owner'
  | 'status'
  | 'dueDate'
  | 'createdAt'
  | 'updatedAt';

export interface TaskListParams {
  query?: string;
  title?: string;
  ownerQuery?: string;
  pipelineId?: string;
  companyId?: string;
  ownerId?: string;
  status?: 'NOT_STARTED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  dueBucket?: TaskDueBucket;
  dueDateFrom?: string;
  dueDateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: TaskSortField;
  sortOrder?: 'asc' | 'desc';
}

export type TaskStatusAction = 'pause' | 'resume' | 'cancel';
export type TaskStageTransition =
  | { action: 'complete' }
  | { action: 'reopen' }
  | { action: 'skip'; reason: string }
  | {
    action: 'checklist';
    checklistItemId: string;
    isCompleted: boolean;
  }
  | { action: 'linkOutcome'; outcome: TaskStageOutcomePayload }
  | { action: 'reconcile' };

export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (params: TaskListParams) => [...taskKeys.lists(), params] as const,
  details: () => [...taskKeys.all, 'detail'] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
  resources: (taskId: string) => [...taskKeys.detail(taskId), 'resources'] as const,
  stages: (taskId: string) => [...taskKeys.detail(taskId), 'stage'] as const,
  stage: (taskId: string, stageId: string) => (
    [...taskKeys.stages(taskId), stageId] as const
  ),
  esigningPreparation: (taskId: string, stageId: string) => (
    [...taskKeys.stage(taskId, stageId), 'esigning-preparation'] as const
  ),
};

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(url, init) : await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'Task request failed');
  }
  return response.json() as Promise<T>;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function taskListUrl(params: TaskListParams) {
  const search = new URLSearchParams();
  const ordered: Array<[string, unknown]> = [
    ['q', params.query],
    ['title', params.title],
    ['ownerQuery', params.ownerQuery],
    ['pipeline', params.pipelineId],
    ['company', params.companyId],
    ['owner', params.ownerId],
    ['status', params.status],
    ['dueBucket', params.dueBucket],
    ['dueDateFrom', params.dueDateFrom],
    ['dueDateTo', params.dueDateTo],
    ['page', params.page],
    ['limit', params.limit],
    ['sortBy', params.sortBy],
    ['sortOrder', params.sortOrder],
  ];
  for (const [key, value] of ordered) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return `/api/tasks${query ? `?${query}` : ''}`;
}

export function useTasks(params: TaskListParams = {}) {
  return useQuery({
    queryKey: taskKeys.list(params),
    queryFn: () => apiRequest<TaskListResponse>(taskListUrl(params)),
    placeholderData: (previous) => previous,
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
  });
}

export function useTask(id: string) {
  return useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: () => apiRequest<TaskListItem>(`/api/tasks/${id}`),
    enabled: Boolean(id),
    staleTime: 60 * 1000,
  });
}

export const useTaskDetail = useTask;

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TaskCreatePayload) => apiRequest<TaskListItem>(
      '/api/tasks',
      jsonInit('POST', payload),
    ),
    onSuccess: () => queryClient.invalidateQueries({
      queryKey: taskKeys.lists(),
    }),
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: TaskUpdatePayload }) => (
      apiRequest<TaskListItem>(`/api/tasks/${id}`, jsonInit('PATCH', payload))
    ),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: taskKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: taskKeys.stages(task.id) }),
        queryClient.invalidateQueries({ queryKey: taskKeys.resources(task.id) }),
      ]);
    },
  });
}

export function useArchiveTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string } & ArchivePayload) => (
      apiRequest<ArchiveResult>(
        `/api/tasks/${id}`,
        jsonInit('DELETE', { reason }),
      )
    ),
    onSuccess: (_task, { id }) => Promise.all([
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(id) }),
    ]),
  });
}

export function useTaskStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: TaskStatusAction }) => (
      apiRequest<TaskListItem>(
        `/api/tasks/${id}/status`,
        jsonInit('POST', { action }),
      )
    ),
    onSuccess: (task, { id }) => {
      queryClient.setQueryData(taskKeys.detail(id), task);
      return queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

export const useUpdateTaskStatus = useTaskStatusMutation;

export function useTaskStage(taskId: string, stageId: string) {
  return useQuery({
    queryKey: taskKeys.stage(taskId, stageId),
    queryFn: () => apiRequest<TaskStageDetail>(
      `/api/tasks/${taskId}/stages/${stageId}`,
    ),
    enabled: Boolean(taskId && stageId),
    staleTime: 30 * 1000,
  });
}

export function useUpdateTaskStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, stageId, payload }: {
      taskId: string;
      stageId: string;
      payload: { notes?: string | null; assigneeId?: string | null };
    }) => apiRequest<TaskStageDetail>(
      `/api/tasks/${taskId}/stages/${stageId}`,
      jsonInit('PATCH', payload),
    ),
    onSuccess: (stage, { taskId, stageId }) => {
      queryClient.setQueryData(taskKeys.stage(taskId, stageId), stage);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) }),
        queryClient.invalidateQueries({ queryKey: taskKeys.resources(taskId) }),
      ]);
    },
  });
}

export function useTaskStageTransition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, stageId, transition }: {
      taskId: string;
      stageId: string;
      transition: TaskStageTransition;
    }) => apiRequest<unknown>(
      `/api/tasks/${taskId}/stages/${stageId}/transition`,
      jsonInit('POST', transition),
    ),
    onSuccess: async (_result, { taskId, stageId }) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: taskKeys.stage(taskId, stageId),
        }),
        queryClient.invalidateQueries({
          queryKey: taskKeys.detail(taskId),
        }),
        queryClient.invalidateQueries({
          queryKey: taskKeys.lists(),
        }),
        queryClient.invalidateQueries({
          queryKey: taskKeys.resources(taskId),
        }),
      ]);
    },
  });
}

export function useTaskEsigningPreparation(taskId: string, stageId: string) {
  return useQuery({
    queryKey: taskKeys.esigningPreparation(taskId, stageId),
    queryFn: () => apiRequest<TaskEsigningPreparationSnapshot | null>(
      `/api/tasks/${taskId}/stages/${stageId}/esigning-preparation`,
    ),
    enabled: Boolean(taskId && stageId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'QUEUED' || status === 'PROCESSING' ? 1_000 : false;
    },
  });
}

export function useEnsureTaskEsigningPreparation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, stageId }: { taskId: string; stageId: string }) => (
      apiRequest<TaskEsigningPreparationSnapshot>(
        `/api/tasks/${taskId}/stages/${stageId}/esigning-preparation`,
        jsonInit('POST', {}),
      )
    ),
    onSuccess: (preparation, { taskId, stageId }) => {
      queryClient.setQueryData(
        taskKeys.esigningPreparation(taskId, stageId),
        preparation,
      );
      return queryClient.invalidateQueries({
        queryKey: taskKeys.resources(taskId),
      });
    },
  });
}

export function useRetryTaskEsigningPreparation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, stageId }: { taskId: string; stageId: string }) => (
      apiRequest<TaskEsigningPreparationSnapshot>(
        `/api/tasks/${taskId}/stages/${stageId}/esigning-preparation/retry`,
        jsonInit('POST', {}),
      )
    ),
    onSuccess: (preparation, { taskId, stageId }) => {
      queryClient.setQueryData(
        taskKeys.esigningPreparation(taskId, stageId),
        preparation,
      );
      return queryClient.invalidateQueries({
        queryKey: taskKeys.resources(taskId),
      });
    },
  });
}
