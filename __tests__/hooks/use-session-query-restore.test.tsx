import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  readSessionListSnapshot,
  sessionListStorageKey,
  usePersistSessionListSnapshot,
  useSessionListRestore,
  writeSessionListSnapshot,
} from '@/hooks/use-session-query-restore';

const QUERY_KEY = [
  'companies-page-bootstrap',
  { query: 'acme', page: 1, tenantId: 't1' },
  ['columns:v1'],
] as const;

const SNAPSHOT = {
  companies: {
    companies: [{ id: 'c1', name: 'Acme' }],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  },
  stats: null,
  preferences: {},
};

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('session list restore cache', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('round-trips a snapshot for the same query key', () => {
    writeSessionListSnapshot(QUERY_KEY, SNAPSHOT);

    expect(readSessionListSnapshot(QUERY_KEY)).toEqual(SNAPSHOT);
  });

  it('reads the same snapshot regardless of object key order in the query key', () => {
    const ordered = ['key', { a: 1, b: 2 }] as const;
    const reordered = ['key', { b: 2, a: 1 }] as const;

    writeSessionListSnapshot(ordered, SNAPSHOT);

    expect(readSessionListSnapshot(reordered)).toEqual(SNAPSHOT);
  });

  it('returns undefined when no snapshot exists', () => {
    expect(readSessionListSnapshot(QUERY_KEY)).toBeUndefined();
  });

  it('returns undefined for a corrupt snapshot', () => {
    sessionStorage.setItem(sessionListStorageKey(QUERY_KEY), '{not valid json');

    expect(readSessionListSnapshot(QUERY_KEY)).toBeUndefined();
  });

  it('swallows storage write failures', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    expect(() => writeSessionListSnapshot(QUERY_KEY, SNAPSHOT)).not.toThrow();

    setItem.mockRestore();
  });

  it('seeds initial data from a session snapshot when the in-memory cache is cold', () => {
    const queryClient = new QueryClient();
    writeSessionListSnapshot(QUERY_KEY, SNAPSHOT);

    const { result } = renderHook(() => useSessionListRestore(queryClient, QUERY_KEY), {
      wrapper: makeWrapper(queryClient),
    });

    expect(result.current.initialData).toEqual(SNAPSHOT);
    expect(result.current.restoredFromSession).toBe(true);
  });

  it('ignores the session snapshot when the in-memory cache is already warm', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(QUERY_KEY, { ...SNAPSHOT, warmed: true });

    const { result } = renderHook(() => useSessionListRestore(queryClient, QUERY_KEY), {
      wrapper: makeWrapper(queryClient),
    });

    expect(result.current.initialData).toBeUndefined();
    expect(result.current.restoredFromSession).toBe(false);
  });

  it('does not restore data that fails the provided validator', () => {
    const queryClient = new QueryClient();
    writeSessionListSnapshot(QUERY_KEY, { not: 'a list snapshot' });

    const { result } = renderHook(
      () =>
        useSessionListRestore(queryClient, QUERY_KEY, {
          validate: (value): value is typeof SNAPSHOT =>
            !!value &&
            typeof value === 'object' &&
            'companies' in value &&
            typeof (value as { companies?: unknown }).companies === 'object',
        }),
      { wrapper: makeWrapper(queryClient) },
    );

    expect(result.current.initialData).toBeUndefined();
    expect(result.current.restoredFromSession).toBe(false);
  });

  it('persists data to session storage when data changes', () => {
    const queryClient = new QueryClient();

    renderHook(() => usePersistSessionListSnapshot(QUERY_KEY, SNAPSHOT), {
      wrapper: makeWrapper(queryClient),
    });

    expect(readSessionListSnapshot(QUERY_KEY)).toEqual(SNAPSHOT);
  });

  it('renders a session-restored snapshot immediately through useQuery and refreshes it', async () => {
    const queryClient = new QueryClient();
    writeSessionListSnapshot(QUERY_KEY, SNAPSHOT);

    const { result } = renderHook(
      () => {
        const { initialData, restoredFromSession } = useSessionListRestore(queryClient, QUERY_KEY, {
          validate: (value): value is typeof SNAPSHOT =>
            !!value && typeof value === 'object' && 'companies' in value,
        });
        return useQuery({
          queryKey: QUERY_KEY,
          queryFn: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return { ...SNAPSHOT, refreshed: true };
          },
          staleTime: 2 * 60 * 1000,
          gcTime: 10 * 60 * 1000,
          refetchOnMount: restoredFromSession ? true : false,
          initialData,
          initialDataUpdatedAt: restoredFromSession ? 0 : undefined,
        });
      },
      { wrapper: makeWrapper(queryClient) },
    );

    // The snapshot is available on the very first render while the background
    // refresh is still in flight.
    expect(result.current.data).toEqual(SNAPSHOT);
    expect(result.current.isLoading).toBe(false);

    await waitFor(() => {
      expect(result.current.data).toEqual({ ...SNAPSHOT, refreshed: true });
    });
  });

  it('hydrates the server loading state before restoring a session snapshot', async () => {
    writeSessionListSnapshot(QUERY_KEY, SNAPSHOT);

    function RestoreProbe({ queryClient }: { queryClient: QueryClient }) {
      const { initialData, restoredFromSession } = useSessionListRestore(
        queryClient,
        QUERY_KEY,
      );
      const { data } = useQuery({
        queryKey: QUERY_KEY,
        queryFn: () => new Promise<typeof SNAPSHOT>(() => {}),
        initialData,
        initialDataUpdatedAt: restoredFromSession ? 0 : undefined,
      });
      return <div>{data ? 'Restored companies' : 'Loading companies'}</div>;
    }

    function makeTree(queryClient: QueryClient) {
      return (
        <QueryClientProvider client={queryClient}>
          <RestoreProbe queryClient={queryClient} />
        </QueryClientProvider>
      );
    }

    const serverQueryClient = new QueryClient();
    let serverHtml = '';
    vi.stubGlobal('window', undefined);
    try {
      serverHtml = renderToString(makeTree(serverQueryClient));
    } finally {
      vi.unstubAllGlobals();
    }

    const clientQueryClient = new QueryClient();
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    const recoverableErrors: Error[] = [];
    let root!: ReturnType<typeof hydrateRoot>;

    await act(async () => {
      root = hydrateRoot(container, makeTree(clientQueryClient), {
        onRecoverableError: (error) => recoverableErrors.push(error as Error),
      });
    });

    await waitFor(() => {
      expect(container).toHaveTextContent('Restored companies');
    });
    expect(recoverableErrors).toHaveLength(0);

    await act(async () => root.unmount());
  });
});
