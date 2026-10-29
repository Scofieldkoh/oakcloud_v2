import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  taskPipelineKeys,
  useArchiveTaskPipeline,
  useCreateTaskPipeline,
  useTaskPipelines,
} from '@/hooks/use-task-pipelines';
import {
  taskKeys,
  useEnsureTaskEsigningPreparation,
  useArchiveTask,
  useUpdateTask,
  useUpdateTaskStage,
  useTaskStageTransition,
  useTasks,
} from '@/hooks/use-tasks';
import type { ArchiveResult } from '@/services/tasks/types';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('task query hooks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serializes pipeline and task list parameters into stable list queries', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        tasks: [],
        total: 0,
        page: 2,
        limit: 25,
        totalPages: 0,
      }));
    const { wrapper } = createHarness();

    renderHook(
      () => useTaskPipelines({ includeArchived: true }),
      { wrapper },
    );
    renderHook(
      () => useTasks({
        query: 'annual',
        pipelineId: 'pipeline-1',
        dueBucket: 'overdue',
        page: 2,
        limit: 25,
        sortBy: 'dueDate',
        sortOrder: 'desc',
      }),
      { wrapper },
    );

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/task-pipelines?includeArchived=true',
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/tasks?q=annual&pipeline=pipeline-1&dueBucket=overdue&page=2&limit=25&sortBy=dueDate&sortOrder=desc',
    );
  });

  it('invalidates only pipeline lists after creating a pipeline', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'pipeline-1' }, 201));
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateTaskPipeline(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        name: 'Onboarding',
        stages: [{ name: 'Manual review', actionType: 'MANUAL' }],
      });
    });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskPipelineKeys.lists(),
    });
  });

  it('returns a minimal pipeline archive result without writing partial detail data', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      id: 'pipeline-1',
      archived: true,
    }));
    const { queryClient, wrapper } = createHarness();
    const existing = { id: 'pipeline-1', name: 'Existing detail' };
    queryClient.setQueryData(taskPipelineKeys.detail('pipeline-1'), existing);
    const setQueryData = vi.spyOn(queryClient, 'setQueryData');
    const { result } = renderHook(() => useArchiveTaskPipeline(), { wrapper });

    let archiveResult: ArchiveResult | undefined;
    await act(async () => {
      archiveResult = await result.current.mutateAsync({
        id: 'pipeline-1',
        reason: 'Superseded',
      });
    });

    expect(archiveResult).toEqual({ id: 'pipeline-1', archived: true });
    expect(setQueryData).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(taskPipelineKeys.detail('pipeline-1'))).toBe(existing);
  });

  it('invalidates the changed stage, parent task detail, and task lists after transition', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'stage-1' }));
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useTaskStageTransition(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        taskId: 'task-1',
        stageId: 'stage-1',
        transition: { action: 'complete' },
      });
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskKeys.stage('task-1', 'stage-1'),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskKeys.detail('task-1'),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskKeys.lists(),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskKeys.resources('task-1'),
    });
  });

  it('invalidates task stage detail prefixes when task metadata changes', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'task-1' }));
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateTask(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'task-1',
        payload: { companyId: '11111111-1111-4111-8111-111111111111' },
      });
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskKeys.stages('task-1'),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskKeys.resources('task-1'),
    });
  });

  it('caches refreshed stage detail after stage metadata update', async () => {
    const detail = {
      id: 'stage-1',
      taskId: 'task-1',
      notes: 'Updated',
      blockers: [],
      launch: {
        href: null,
        context: { taskId: 'task-1', taskStageId: 'stage-1' },
      },
      outcomeSummary: null,
      checklistItems: [],
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(detail));
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateTaskStage(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        taskId: 'task-1',
        stageId: 'stage-1',
        payload: { notes: 'Updated' },
      });
    });

    expect(queryClient.getQueryData(taskKeys.stage('task-1', 'stage-1'))).toEqual(detail);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskKeys.resources('task-1'),
    });
  });

  it('returns a minimal task archive result without writing partial detail data', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      id: 'task-1',
      archived: true,
    }));
    const { queryClient, wrapper } = createHarness();
    const existing = { id: 'task-1', title: 'Existing detail' };
    queryClient.setQueryData(taskKeys.detail('task-1'), existing);
    const setQueryData = vi.spyOn(queryClient, 'setQueryData');
    const { result } = renderHook(() => useArchiveTask(), { wrapper });

    let archiveResult: ArchiveResult | undefined;
    await act(async () => {
      archiveResult = await result.current.mutateAsync({
        id: 'task-1',
        reason: 'Duplicate',
      });
    });

    expect(archiveResult).toEqual({ id: 'task-1', archived: true });
    expect(setQueryData).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(taskKeys.detail('task-1'))).toBe(existing);
  });

  it('ensures E-signing preparation and caches the returned status', async () => {
    const preparation = {
      id: 'preparation-1',
      taskId: 'task-1',
      taskStageId: 'stage-1',
      status: 'QUEUED',
      blockingStage: null,
      generatedDocumentId: 'document-1',
      esigningEnvelopeId: null,
      lastError: null,
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(preparation));
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useEnsureTaskEsigningPreparation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ taskId: 'task-1', stageId: 'stage-1' });
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/tasks/task-1/stages/stage-1/esigning-preparation',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(queryClient.getQueryData(
      taskKeys.esigningPreparation('task-1', 'stage-1'),
    )).toEqual(preparation);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: taskKeys.resources('task-1'),
    });
  });
});
