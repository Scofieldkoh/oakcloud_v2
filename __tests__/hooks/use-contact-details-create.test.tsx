import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ error: mocks.toastError }) }));
vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({ data: { tenantId: 'tenant-1', isSuperAdmin: false } }),
}));
vi.mock('@/components/ui/workspace-selector', () => ({
  useActiveWorkspaceId: () => 'tenant-1',
}));

import { ContactMatchReviewRequiredError } from '@/hooks/use-contacts';
import { useCreateContactWithDetails } from '@/hooks/use-contact-details';

describe('useCreateContactWithDetails', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('preserves a typed review match without toast or success invalidation on 409', async () => {
    const match = {
      contactId: '11111111-1111-4111-8111-111111111111',
      score: 100,
      automatic: true,
      blockedByIdentifierConflict: false,
      reasons: ['EXACT_CANONICAL_NAME'],
      conflicts: [],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: vi.fn().mockResolvedValue({
        error: 'Review the matching contact before continuing',
        code: 'CONTACT_MATCH_REVIEW_REQUIRED',
        match,
      }),
    }));
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateContactWithDetails('company-1'), { wrapper });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          relationship: 'Director',
          contact: { contactType: 'INDIVIDUAL', firstName: 'çŽ‹å°æ˜Ž' },
        });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ContactMatchReviewRequiredError);
    expect((caught as ContactMatchReviewRequiredError).match).toEqual(match);
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
