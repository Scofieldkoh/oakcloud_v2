import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serviceRosterFamilyKeys, useServiceRosterFamilies } from '@/hooks/use-service-roster-families';

function createHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

describe('useServiceRosterFamilies', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('uses a stable family facet key and abort-aware request', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ families: [] }), { status: 200 }));
    const { wrapper, queryClient } = createHarness();

    renderHook(() => useServiceRosterFamilies(), { wrapper });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/client-services/families',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(queryClient.getQueryCache().findAll({ queryKey: serviceRosterFamilyKeys.all })).toHaveLength(1);
  });
});
