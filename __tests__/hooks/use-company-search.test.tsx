import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompanySearch } from '@/hooks/use-company-search';

vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({
    data: {
      isSuperAdmin: false,
      tenantId: 'tenant-1',
    },
  }),
}));

vi.mock('@/components/ui/workspace-selector', () => ({
  useActiveWorkspaceId: () => 'tenant-1',
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useCompanySearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ options: [] }),
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('debounces typed company searches before fetching', async () => {
    const { result } = renderHook(
      () => useCompanySearch({ minChars: 2, debounceMs: 300 }),
      { wrapper: createWrapper() }
    );

    act(() => {
      result.current.setSearchQuery('oa');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });

    expect(fetch).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/companies/options?q=oa&limit=10&tenantId=tenant-1');
  });
});
