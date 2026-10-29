'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ArchivePayload,
  ArchiveResult,
  TaskPipelineCreatePayload,
  TaskPipelineDuplicatePayload,
  TaskPipelineUpdatePayload,
} from '@/services/tasks/types';

export type {
  ArchivePayload,
  ArchiveResult,
  TaskPipelineCreatePayload,
  TaskPipelineDuplicatePayload,
  TaskPipelineUpdatePayload,
} from '@/services/tasks/types';

export interface TaskPipelineStage {
  id: string;
  name: string;
  description: string | null;
  position: number;
  actionType: 'MANUAL' | 'COMPANY_PROFILE' | 'DOCUMENT_GENERATION' | 'ESIGNING';
  icon: string;
  isRequired: boolean;
  actionConfig: Record<string, unknown> | null;
}

export interface TaskPipelineVersion {
  id: string;
  version: number;
  publishedAt: string | null;
  stages: TaskPipelineStage[];
}

export interface TaskPipeline {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  versions: TaskPipelineVersion[];
}

export interface TaskPipelineListParams {
  includeArchived?: boolean;
}

export const taskPipelineKeys = {
  all: ['task-pipelines'] as const,
  lists: () => [...taskPipelineKeys.all, 'list'] as const,
  list: (params: TaskPipelineListParams) => (
    [...taskPipelineKeys.lists(), params] as const
  ),
  details: () => [...taskPipelineKeys.all, 'detail'] as const,
  detail: (id: string) => [...taskPipelineKeys.details(), id] as const,
};

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(url, init) : await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'Task pipeline request failed');
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

async function fetchTaskPipelines(
  params: TaskPipelineListParams,
): Promise<TaskPipeline[]> {
  const search = new URLSearchParams();
  if (params.includeArchived) search.set('includeArchived', 'true');
  const query = search.toString();
  return apiRequest(`/api/task-pipelines${query ? `?${query}` : ''}`);
}

export function useTaskPipelines(params: TaskPipelineListParams = {}) {
  return useQuery({
    queryKey: taskPipelineKeys.list(params),
    queryFn: () => fetchTaskPipelines(params),
    staleTime: 2 * 60 * 1000,
  });
}

export function useTaskPipeline(id: string) {
  return useQuery({
    queryKey: taskPipelineKeys.detail(id),
    queryFn: () => apiRequest<TaskPipeline>(`/api/task-pipelines/${id}`),
    enabled: Boolean(id),
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateTaskPipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TaskPipelineCreatePayload) => apiRequest<TaskPipeline>(
      '/api/task-pipelines',
      jsonInit('POST', payload),
    ),
    onSuccess: () => queryClient.invalidateQueries({
      queryKey: taskPipelineKeys.lists(),
    }),
  });
}

export function useUpdateTaskPipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: {
      id: string;
      payload: TaskPipelineUpdatePayload;
    }) => apiRequest<TaskPipeline>(
      `/api/task-pipelines/${id}`,
      jsonInit('PATCH', payload),
    ),
    onSuccess: (pipeline) => {
      queryClient.setQueryData(taskPipelineKeys.detail(pipeline.id), pipeline);
      return queryClient.invalidateQueries({
        queryKey: taskPipelineKeys.lists(),
      });
    },
  });
}

export function useDuplicateTaskPipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload = {} }: {
      id: string;
      payload?: TaskPipelineDuplicatePayload;
    }) => apiRequest<TaskPipeline>(
      `/api/task-pipelines/${id}/duplicate`,
      jsonInit('POST', payload),
    ),
    onSuccess: () => queryClient.invalidateQueries({
      queryKey: taskPipelineKeys.lists(),
    }),
  });
}

export function useArchiveTaskPipeline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string } & ArchivePayload) => (
      apiRequest<ArchiveResult>(
        `/api/task-pipelines/${id}`,
        jsonInit('DELETE', { reason }),
      )
    ),
    onSuccess: (_pipeline, { id }) => Promise.all([
      queryClient.invalidateQueries({ queryKey: taskPipelineKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: taskPipelineKeys.detail(id) }),
    ]),
  });
}
