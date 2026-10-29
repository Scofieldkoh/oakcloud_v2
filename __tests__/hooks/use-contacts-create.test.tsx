import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactMatchReviewRequiredError, useCreateContact } from '@/hooks/use-contacts';

describe('useCreateContact', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws a typed error carrying a review match for a 409 response', async () => {
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
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateContact(), { wrapper });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ contactType: 'INDIVIDUAL', firstName: '王小明' });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ContactMatchReviewRequiredError);
    expect((caught as ContactMatchReviewRequiredError).match).toEqual(match);
  });
});
