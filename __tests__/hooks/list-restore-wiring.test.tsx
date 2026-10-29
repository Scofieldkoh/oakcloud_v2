import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  processingDocumentsQueryKey,
  useProcessingDocuments,
} from '@/hooks/use-processing-documents';
import { formKeys, useForms } from '@/hooks/use-forms';
import { writeSessionListSnapshot } from '@/hooks/use-session-query-restore';

const PROCESSING_PARAMS = {
  page: 1,
  limit: 20,
  sortBy: 'createdAt' as const,
  sortOrder: 'desc' as const,
  tenantId: 't1',
};
const PROCESSING_KEY = processingDocumentsQueryKey(PROCESSING_PARAMS);
const PROCESSING_SNAPSHOT = {
  documents: [{ id: 'd1' }],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};
const PROCESSING_FRESH = {
  documents: [{ id: 'd2' }],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const FORMS_PARAMS = {
  page: 1,
  limit: 20,
  sortBy: 'updatedAt' as const,
  sortOrder: 'desc' as const,
};
const FORMS_KEY = formKeys.list(FORMS_PARAMS, 't1');
const FORMS_SNAPSHOT = {
  forms: [{ id: 'f1' }],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};
const FORMS_FRESH = {
  forms: [{ id: 'f2' }],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function seedSession(queryClient: QueryClient) {
  queryClient.setQueryData(['session-with-permissions'], {
    user: { id: 'u1', tenantId: 't1', isSuperAdmin: false },
    permissions: [],
    isSuperAdmin: false,
    isWorkspaceAdmin: false,
    internalRole: 'ADMIN',
    isAdmin: true,
    isManager: false,
    isStaff: false,
  });
}

describe('list restore wiring', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('useProcessingDocuments renders a session snapshot instantly and refreshes in the background', async () => {
    const queryClient = new QueryClient();
    writeSessionListSnapshot(PROCESSING_KEY, PROCESSING_SNAPSHOT);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: PROCESSING_FRESH }),
      })),
    );

    const { result } = renderHook(
      () => useProcessingDocuments(PROCESSING_PARAMS, { restoreSession: true }),
      { wrapper: makeWrapper(queryClient) },
    );

    expect(result.current.data).toEqual(PROCESSING_SNAPSHOT);
    expect(result.current.isLoading).toBe(false);

    await waitFor(() => {
      expect(result.current.data?.documents[0]?.id).toBe('d2');
    });
  });

  it('useProcessingDocuments ignores the session snapshot when restoreSession is disabled', async () => {
    const queryClient = new QueryClient();
    writeSessionListSnapshot(PROCESSING_KEY, PROCESSING_SNAPSHOT);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: PROCESSING_FRESH }),
      })),
    );

    const { result } = renderHook(() => useProcessingDocuments(PROCESSING_PARAMS), {
      wrapper: makeWrapper(queryClient),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it('useForms renders a session snapshot instantly and refreshes in the background', async () => {
    const queryClient = new QueryClient();
    seedSession(queryClient);
    writeSessionListSnapshot(FORMS_KEY, FORMS_SNAPSHOT);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => FORMS_FRESH,
      })),
    );

    const { result } = renderHook(() => useForms(FORMS_PARAMS, { restoreSession: true }), {
      wrapper: makeWrapper(queryClient),
    });

    expect(result.current.data).toEqual(FORMS_SNAPSHOT);
    expect(result.current.isLoading).toBe(false);

    await waitFor(() => {
      expect(result.current.data?.forms[0]?.id).toBe('f2');
    });
  });

  it('useForms ignores the session snapshot when restoreSession is disabled', async () => {
    const queryClient = new QueryClient();
    seedSession(queryClient);
    writeSessionListSnapshot(FORMS_KEY, FORMS_SNAPSHOT);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => FORMS_FRESH,
      })),
    );

    const { result } = renderHook(() => useForms(FORMS_PARAMS), {
      wrapper: makeWrapper(queryClient),
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });
});
