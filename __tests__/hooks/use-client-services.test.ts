import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import {
  HttpRequestError,
  isHttpRequestError,
  previewClientServiceDeadlineDraft,
  previewClientServiceDeadlineImpact,
  useCreateManualClientService,
  useDeleteClientServicePermanently,
  useManualClientServiceCatalogOptions,
  useUpdateClientService,
} from '@/hooks/use-client-services';
import type { CreateManualClientServiceRequest } from '@/lib/validations/client-service';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

const variantId = '11111111-1111-4111-8111-111111111111';
const createData: CreateManualClientServiceRequest = {
  serviceVariantId: variantId,
  serviceCadence: 'ANNUALLY',
  startDate: '2026-08-01',
  feeLines: [{ description: 'Annual service fee', amount: '0.00', currency: 'SGD', billingFrequency: 'ANNUALLY' }],
};

describe('client service hook error boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves stable codes, details, and duplicate bodies across the hook boundary', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      error: 'A matching client service already exists.',
      code: 'DUPLICATE_CLIENT_SERVICE',
      duplicates: { total: 1 },
    }, 409));
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useUpdateClientService(), { wrapper });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: 'service-1', companyId: 'company-1', data: { expectedUpdatedAt: '2026-07-30T00:00:00.000Z', status: 'PAUSED' } });
      } catch (error) {
        caught = error;
      }
    });

    expect(isHttpRequestError(caught, 409)).toBe(true);
    expect(caught).toMatchObject({
      status: 409,
      code: 'DUPLICATE_CLIENT_SERVICE',
      body: { duplicates: { total: 1 } },
    });
    expect(caught).toBeInstanceOf(HttpRequestError);
  });

  it('retains field-addressable validation details from the server', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      error: 'The service could not be created.',
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { 'feeLines.0.amount': 'Enter a non-negative amount with at most two decimals.' } },
    }, 400));
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useUpdateClientService(), { wrapper });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: 'service-1', companyId: 'company-1', data: { expectedUpdatedAt: '2026-07-30T00:00:00.000Z', status: 'PAUSED' } });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { 'feeLines.0.amount': 'Enter a non-negative amount with at most two decimals.' } },
    });
  });

  it('loads company-scoped catalog options with a stable query key', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ variants: [] }));
    const { queryClient, wrapper } = createHarness();

    renderHook(() => useManualClientServiceCatalogOptions('company-1'), { wrapper });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/companies/company-1/services/catalog-options', undefined));
    expect(queryClient.getQueryCache().findAll({ queryKey: ['client-service-catalog-options', 'company-1'] })).toHaveLength(1);
  });

  it('posts the create payload and invalidates the company list and new detail', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'service-1', source: 'MANUAL' }, 201));
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateManualClientService(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ companyId: 'company-1', data: createData });
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/companies/company-1/services',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: expect.stringContaining('"serviceVariantId"'),
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client-services', 'company-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client-service', 'service-1'] });
  });

  it('permanently deletes a service and invalidates every related workspace view', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'service-1', deleted: true, deletedCounts: {} }));
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteClientServicePermanently(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'service-1',
        companyId: 'company-1',
        expectedUpdatedAt: '2026-07-30T00:00:00.000Z',
        reason: 'Created against the wrong company',
      });
    });

    expect(fetch).toHaveBeenCalledWith('/api/client-services/service-1', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deletionMode: 'PERMANENT',
        expectedUpdatedAt: '2026-07-30T00:00:00.000Z',
        reason: 'Created against the wrong company',
      }),
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client-services', 'company-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client-service', 'service-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['service-roster'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['deadlines'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['billing-occurrences'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['billing-coverage'] });
  });

  it('preserves duplicate bodies on creation failures', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      error: 'A matching client service already exists.',
      code: 'DUPLICATE_CLIENT_SERVICE',
      duplicates: { total: 1 },
    }, 409));
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useCreateManualClientService(), { wrapper });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ companyId: 'company-1', data: createData });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toMatchObject({ status: 409, code: 'DUPLICATE_CLIENT_SERVICE', body: { duplicates: { total: 1 } } });
  });

  it('previews deadline impact without a query-cache write and forwards an abort signal', async () => {
    const impact = {
      clientServiceId: 'service-1',
      expectedUpdatedAt: '2026-07-30T00:00:00.000Z',
      proposedConfigHash: 'a'.repeat(64),
      previewFingerprint: 'f'.repeat(64),
      counts: { created: 0, recalculated: 0, cancelled: 0, preserved: 0, noChange: 0, inapplicable: 0, missingInput: 0, conflicts: 0, warnings: 0 },
      samples: [],
      warnings: [],
      projectedDeadlines: [],
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(impact));
    const { queryClient } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const controller = new AbortController();

    const result = await previewClientServiceDeadlineImpact('service-1', {
      expectedUpdatedAt: '2026-07-30T00:00:00.000Z',
      deadlineRules: [],
      scheduleSnapshot: { status: 'ACTIVE', serviceCadence: 'MONTHLY', customCadenceLabel: null, startDate: '2026-08-01', endDate: null, fieldValues: {} },
    }, controller.signal);

    expect(result.previewFingerprint).toBe('f'.repeat(64));
    expect(fetch).toHaveBeenCalledWith(
      '/api/client-services/service-1/deadline-configuration/impact',
      expect.objectContaining({
        method: 'POST',
        signal: controller.signal,
      }),
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('previews a draft deadline projection before the service exists', async () => {
    const draft = {
      companyId: 'company-1',
      serviceVariantId: 'variant-1',
      today: '2026-08-27',
      horizonEnd: '2027-08-27',
      counts: { applicable: 1, disabled: 0, inapplicable: 0, missingInput: 0, warnings: 0 },
      warnings: [],
      projectedDeadlines: [],
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(draft));

    const result = await previewClientServiceDeadlineDraft({
      companyId: 'company-1',
      serviceVariantId: 'variant-1',
      deadlineRules: [],
      scheduleSnapshot: { status: 'ACTIVE', serviceCadence: 'ANNUALLY', customCadenceLabel: null, startDate: '2026-08-01', endDate: null, fieldValues: {} },
    });

    expect(result.counts.applicable).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/client-services/deadline-configuration/preview',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
