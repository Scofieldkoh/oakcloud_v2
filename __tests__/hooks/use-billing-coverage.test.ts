import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  billingCoverageKeys,
  normalizeBillingCoverageFilters,
  useBillingCoverage,
  useReconcileBillingCoverage,
} from '@/hooks/use-billing-coverage';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function createHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

describe('use billing coverage hooks', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes filters into the stable coverage query key', () => {
    const first = normalizeBillingCoverageFilters({
      companyIds: ['company-b', 'company-a', 'company-b'],
      severities: ['WARNING', 'ERROR', 'ERROR'],
    });
    const second = normalizeBillingCoverageFilters({
      companyIds: ['company-a', 'company-b'],
      severities: ['ERROR', 'WARNING'],
    });

    expect(first).toEqual(second);
    expect(billingCoverageKeys.list(first)).toEqual(['billing-coverage', first]);
  });

  it('fetches coverage with normalized query parameters', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ openIssueCount: 0, affectedServiceCount: 0, healthyActiveServiceCount: 1, issues: [] }));
    const { queryClient, wrapper } = createHarness();
    const filters = { companyIds: ['company-b'], severities: ['ERROR'] as const };

    renderHook(() => useBillingCoverage(filters), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/billing-coverage?'), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(queryClient.getQueryCache().findAll({ queryKey: billingCoverageKeys.list(filters) })).toHaveLength(1);
  });

  it('invalidates coverage, occurrences, roster indicators, and the client service after manual reconcile', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 'PENDING', requestId: 'request-1' }, 202));
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useReconcileBillingCoverage(), { wrapper });

    act(() => result.current.mutate('service-1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetch).toHaveBeenCalledWith('/api/client-services/service-1/billing/reconcile', expect.objectContaining({ method: 'POST' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: billingCoverageKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['billing-occurrences'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['service-roster'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client-service', 'service-1'] });
  });
});
