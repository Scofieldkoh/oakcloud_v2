import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskResources } from '@/hooks/use-task-resources';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useTaskResources', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not request resources until the modal is open', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      task: { id: 'task-1' },
      stages: [],
      hasPendingResources: false,
    }));
    const { wrapper } = createHarness();

    const { rerender } = renderHook(
      ({ open }) => useTaskResources('task-1', open),
      { wrapper, initialProps: { open: false } },
    );
    expect(fetch).not.toHaveBeenCalled();

    rerender({ open: true });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/tasks/task-1/resources'));
  });

  it('polls pending resources every ten seconds and stops after they become terminal', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ task: { id: 'task-1' }, stages: [], hasPendingResources: true }))
      .mockResolvedValueOnce(jsonResponse({ task: { id: 'task-1' }, stages: [], hasPendingResources: false }));
    const { wrapper } = createHarness();
    renderHook(() => useTaskResources('task-1', true), { wrapper });

    await act(async () => {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
