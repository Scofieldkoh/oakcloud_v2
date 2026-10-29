'use client';

import { useQuery } from '@tanstack/react-query';
import { taskKeys } from '@/hooks/use-tasks';
import type { TaskResourcesResponse } from '@/services/tasks/types';

async function fetchTaskResources(taskId: string): Promise<TaskResourcesResponse> {
  const response = await fetch(`/api/tasks/${taskId}/resources`);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'Task resources request failed');
  }
  return response.json() as Promise<TaskResourcesResponse>;
}

export function useTaskResources(taskId: string, isModalOpen: boolean) {
  return useQuery({
    queryKey: taskKeys.resources(taskId),
    queryFn: () => fetchTaskResources(taskId),
    enabled: Boolean(taskId && isModalOpen),
    staleTime: 15_000,
    refetchInterval: (query) => (
      query.state.status !== 'error' && query.state.data?.hasPendingResources
        ? 10_000
        : false
    ),
  });
}
