import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  billingOccurrenceKeys,
  billingOccurrenceSearchParams,
  normalizeBillingOccurrenceSearch,
  useBillingOccurrence,
  useBillingOccurrences,
  useMarkBillingOccurrencesAsBilled,
  useResetBillingOverride,
  useUpdateBillingOccurrence,
} from '@/hooks/use-billing-occurrences';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function createHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

const search = {
  from: '2026-08-01',
  to: '2026-08-31',
  companyIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
  familyIds: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
  statuses: ['WAIVED', 'OPEN', 'OPEN'] as const,
  timing: ['OVERDUE', 'DUE'] as const,
  page: 1,
  limit: 50,
  sortBy: 'expectedDate' as const,
  sortOrder: 'asc' as const,
};

describe('use billing occurrences hooks', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes arrays into a stable query key independent of selection order', () => {
    const first = normalizeBillingOccurrenceSearch(search);
    const second = normalizeBillingOccurrenceSearch({ ...search, companyIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'], familyIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'], statuses: ['OPEN', 'WAIVED'], timing: ['DUE', 'OVERDUE'] });

    expect(first).toEqual(second);
    expect(billingOccurrenceKeys.list(search)).toEqual(billingOccurrenceKeys.list(second));
    expect(billingOccurrenceSearchParams(search)).toContain('statuses=OPEN%2CWAIVED');
  });

  it('serializes server-side text filters for company, service, fee, and general search', () => {
    const params = billingOccurrenceSearchParams({
      ...search,
      query: 'annual return',
      companyQuery: 'Example',
      serviceQuery: 'Return',
      feeQuery: 'filing',
    });

    expect(params).toContain('query=annual+return');
    expect(params).toContain('companyQuery=Example');
    expect(params).toContain('serviceQuery=Return');
    expect(params).toContain('feeQuery=filing');
  });

  it('serializes split column filters for dates, amount range, status, and reference', () => {
    const params = billingOccurrenceSearchParams({
      ...search,
      companyId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      familyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      serviceNameQuery: 'Payroll',
      feeLineQuery: 'Monthly fee',
      periodQuery: '2026-08',
      expectedDate: '2026-08-31',
      billedDate: '2026-08-31',
      amountMin: '100.00',
      amountMax: '500.00',
      referenceQuery: 'REF-1',
    });

    expect(params).toEqual(expect.stringContaining('companyId=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'));
    expect(params).toEqual(expect.stringContaining('familyId=dddddddd-dddd-4ddd-8ddd-dddddddddddd'));
    expect(params).toEqual(expect.stringContaining('serviceNameQuery=Payroll'));
    expect(params).toEqual(expect.stringContaining('feeLineQuery=Monthly+fee'));
    expect(params).toEqual(expect.stringContaining('periodQuery=2026-08'));
    expect(params).toEqual(expect.stringContaining('expectedDate=2026-08-31'));
    expect(params).toEqual(expect.stringContaining('billedDate=2026-08-31'));
    expect(params).toEqual(expect.stringContaining('amountMin=100.00'));
    expect(params).toEqual(expect.stringContaining('amountMax=500.00'));
    expect(params).toEqual(expect.stringContaining('referenceQuery=REF-1'));
  });

  it('preserves an unbounded search when the date range is removed', () => {
    const normalized = normalizeBillingOccurrenceSearch({ ...search, from: undefined, to: undefined });
    const params = billingOccurrenceSearchParams({ ...search, from: undefined, to: undefined });

    expect(normalized.from).toBeUndefined();
    expect(normalized.to).toBeUndefined();
    expect(params).not.toContain('from=');
    expect(params).not.toContain('to=');
  });

  it('fetches a normalized list and forwards an AbortSignal', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ mode: 'TABLE', items: [], total: 0, page: 1, limit: 50, totalPages: 0 }));
    const { queryClient, wrapper } = createHarness();

    renderHook(() => useBillingOccurrences(search), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/billing-occurrences?'), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(queryClient.getQueryCache().findAll({ queryKey: billingOccurrenceKeys.list(search) })).toHaveLength(1);
  });

  it('forwards an AbortSignal through detail fetch', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'occurrence-1' }));
    const { wrapper } = createHarness();

    renderHook(() => useBillingOccurrence('occurrence-1'), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    expect(fetch).toHaveBeenCalledWith('/api/billing-occurrences/occurrence-1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('invalidates occurrence, coverage, roster, and client-service queries after update', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'occurrence-1', clientServiceId: 'service-1' }));
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateBillingOccurrence(), { wrapper });

    act(() => result.current.mutate({ id: 'occurrence-1', data: { expectedUpdatedAt: '2026-08-10T00:00:00.000Z', updateScope: 'THIS_OCCURRENCE', reason: null } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: billingOccurrenceKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['billing-occurrences', 'detail', 'occurrence-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['billing-coverage'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['service-roster'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client-service', 'service-1'] });
  });

  it('invalidates the same consumers after resetting an override', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'occurrence-1', clientServiceId: 'service-1' }));
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useResetBillingOverride(), { wrapper });

    act(() => result.current.mutate({ id: 'occurrence-1', data: { expectedUpdatedAt: '2026-08-10T00:00:00.000Z', target: 'ALL', reason: 'Reset value' } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: billingOccurrenceKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: billingOccurrenceKeys.detail('occurrence-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['billing-coverage'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['service-roster'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client-service', 'service-1'] });
  });

  it('marks multiple billing occurrences as billed without changing other fields', async () => {
    vi.mocked(fetch).mockImplementation(async (url, init) => jsonResponse({
      id: String(url).split('/').at(-1),
      clientServiceId: 'service-1',
      ...(JSON.parse(String(init?.body)) as Record<string, unknown>),
    }));
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useMarkBillingOccurrencesAsBilled(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync([
        { id: 'occurrence-1', updatedAt: '2026-08-10T00:00:00.000Z' },
        { id: 'occurrence-2', updatedAt: '2026-08-11T00:00:00.000Z' },
      ]);
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(fetch).mock.calls) {
      const body = JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
      expect(call[1]).toEqual(expect.objectContaining({ method: 'PATCH' }));
      expect(body).toEqual(expect.objectContaining({
        expectedUpdatedAt: expect.any(String),
        status: 'BILLED',
        updateScope: 'THIS_OCCURRENCE',
        reason: null,
      }));
      expect(body).not.toHaveProperty('billedDate');
      expect(body).not.toHaveProperty('externalReference');
    }
  });
});
