import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompanyOptionsPage } from '@/hooks/use-all-company-options';

function createHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper };
}

describe('useCompanyOptionsPage', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('keeps typed company search and zero-based paging server scoped', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      options: [{ id: 'company-21', name: 'Acme Twenty One', uen: 'UEN-21' }],
      hasMore: true,
      page: 1,
    }), { status: 200 }));
    const { wrapper } = createHarness();

    const { result } = renderHook(() => useCompanyOptionsPage(undefined, {
      query: '  Acme  ',
      page: 1,
      limit: 20,
    }), { wrapper });

    await waitFor(() => expect(result.current.data?.hasMore).toBe(true));
    expect(fetch).toHaveBeenCalledWith(
      '/api/companies/options?limit=20&page=1&q=Acme',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.data?.options[0]?.id).toBe('company-21');
  });
});
