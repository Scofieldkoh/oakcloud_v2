import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deadlineKeys,
  deadlineSearchParams,
  normalizeDeadlineSearch,
  useDeadline,
  useDeadlines,
  useResetDeadlineDateOverride,
  useUpdateDeadlineOccurrence,
} from '@/hooks/use-deadlines';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

const search = {
  from: '2026-08-01',
  to: '2026-08-31',
  types: ['INTERNAL', 'STATUTORY', 'STATUTORY'] as const,
  familyIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
  companyIds: ['22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111'],
  statuses: ['OPEN'] as const,
  timing: ['OVERDUE', 'DUE'] as const,
  openOnly: true,
  mode: 'TABLE' as const,
  page: 1,
  limit: 50,
  sortBy: 'dueDate' as const,
  sortOrder: 'asc' as const,
};

describe('use deadlines hooks', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes all arrays and uses the same key for reordered filters', () => {
    const first = normalizeDeadlineSearch(search);
    const second = normalizeDeadlineSearch({ ...search, types: ['STATUTORY', 'INTERNAL'], familyIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'], companyIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'], timing: ['DUE', 'OVERDUE'] });

    expect(first).toEqual(expect.objectContaining({ types: ['STATUTORY', 'INTERNAL'], familyIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'], companyIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'], timing: ['DUE', 'OVERDUE'] }));
    expect(deadlineKeys.list(search)).toEqual(deadlineKeys.list(second));
    expect(deadlineSearchParams(search)).toContain('types=STATUTORY%2CINTERNAL');
  });

  it('does not add a date range to a table request when the table filter is cleared', () => {
    const params = deadlineSearchParams({ mode: 'TABLE', from: undefined, to: undefined });

    expect(params).not.toContain('from=');
    expect(params).not.toContain('to=');
  });

  it('fetches a normalized deadline list with the stable key', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ mode: 'TABLE', items: [], total: 0, page: 1, limit: 50, totalPages: 0 }));
    const { queryClient, wrapper } = createHarness();

    renderHook(() => useDeadlines(search), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/deadlines?'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(queryClient.getQueryCache().findAll({ queryKey: deadlineKeys.list(search) })).toHaveLength(1);
  });

  it('forwards an AbortSignal through the detail deadline fetch', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'deadline-1' }));
    const { wrapper } = createHarness();

    renderHook(() => useDeadline('deadline-1'), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    expect(fetch).toHaveBeenCalledWith(
      '/api/deadlines/deadline-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('invalidates deadlines, roster summaries, and the changed occurrence after update', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'deadline-1' }));
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateDeadlineOccurrence(), { wrapper });

    act(() => result.current.mutate({ id: 'deadline-1', data: { expectedUpdatedAt: '2026-08-10T00:00:00.000Z', status: 'COMPLETED', reason: 'Filed' } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: deadlineKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['service-roster'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['deadline', 'deadline-1'] });
  });

  it('invalidates the same consumers after resetting an override', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'deadline-1' }));
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useResetDeadlineDateOverride(), { wrapper });

    act(() => result.current.mutate({ id: 'deadline-1', data: { expectedUpdatedAt: '2026-08-10T00:00:00.000Z', reason: 'Reset' } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: deadlineKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['service-roster'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['deadline', 'deadline-1'] });
  });
});
