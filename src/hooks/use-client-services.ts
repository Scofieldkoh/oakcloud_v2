'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompanyObligationPreview } from '@/services/compliance-monitoring/writer';
import type { CompanyObligationStatus } from '@/services/compliance-monitoring/obligation-status';
import type { PostpaidQuantityInput, PostpaidQuantityPrompt } from '@/services/billing/postpaid';
import type { ClientServiceDeadlineDraftPreview, ClientServiceDeadlineImpact, ClientServiceDto, CompanyServiceActivationDto, DuplicateClientServiceMatches, ManualClientServiceCatalogOptionsResponse, PermanentDeleteClientServiceResult, ServiceAgreementActivationDto } from '@/services/client-service';
import type { ClientServiceDeadlineDraftPreviewInput, ClientServiceDeadlineImpactInput, CreateManualClientServiceRequest, SearchClientServicesInput, UpdateClientServiceInput } from '@/lib/validations/client-service';

type ClientServicesResult = { services: ClientServiceDto[]; total: number; activations: CompanyServiceActivationDto[] };

export interface ErrorResponseBody {
  error?: string;
  code?: string;
  details?: unknown;
  duplicates?: DuplicateClientServiceMatches;
}

export class HttpRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly details: unknown,
    public readonly body: ErrorResponseBody,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

export function isHttpRequestError(error: unknown, status?: number): error is HttpRequestError {
  return error instanceof HttpRequestError && (status === undefined || error.status === status);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as ErrorResponseBody;
  if (!response.ok) throw new HttpRequestError(body.error ?? 'Request failed', response.status, body.code, body.details, body);
  return body as T;
}

export function useClientServices(companyId: string, filters: Partial<SearchClientServicesInput> = {}) {
  return useQuery({
    queryKey: ['client-services', companyId, filters],
    queryFn: () => {
      const search = new URLSearchParams();
      if (filters.status) search.set('status', filters.status);
      if (filters.query) search.set('query', filters.query);
      search.set('page', String(filters.page ?? 1));
      search.set('limit', String(filters.limit ?? 50));
      return requestJson<ClientServicesResult>(`/api/companies/${companyId}/services?${search}`);
    },
  });
}

export function useClientService(serviceId: string | null) {
  return useQuery({ queryKey: ['client-service', serviceId], queryFn: () => requestJson<ClientServiceDto>(`/api/client-services/${serviceId}`), enabled: Boolean(serviceId) });
}

/**
 * No-write deadline impact preview. This intentionally bypasses the query
 * cache so debounced editor requests never invalidate workspace views.
 */
export async function previewClientServiceDeadlineImpact(
  id: string,
  input: ClientServiceDeadlineImpactInput,
  signal?: AbortSignal,
): Promise<ClientServiceDeadlineImpact> {
  return requestJson<ClientServiceDeadlineImpact>(`/api/client-services/${id}/deadline-configuration/impact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
}

/**
 * No-write draft deadline projection for the add-service flow. The service
 * does not exist yet, so the request is scoped by company and variant.
 */
export async function previewClientServiceDeadlineDraft(
  input: ClientServiceDeadlineDraftPreviewInput,
  signal?: AbortSignal,
): Promise<ClientServiceDeadlineDraftPreview> {
  return requestJson<ClientServiceDeadlineDraftPreview>('/api/client-services/deadline-configuration/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
}

/** The company's statutory obligations, optionally with a new service's coverage. */
export function useCompanyObligations(
  companyId: string,
  input: {
    profiles?: string[];
    start?: string | null;
    end?: string | null;
    serviceId?: string | null;
    fromYa?: number | null;
  },
  enabled = true,
) {
  const search = new URLSearchParams();
  if (input.profiles?.length) search.set('profiles', input.profiles.join(','));
  if (input.start) search.set('start', input.start);
  if (input.end) search.set('end', input.end);
  if (input.serviceId) search.set('serviceId', input.serviceId);
  if (input.fromYa) search.set('fromYa', String(input.fromYa));
  const query = search.toString();
  return useQuery({
    queryKey: ['company-obligations', companyId, query],
    queryFn: () => requestJson<CompanyObligationPreview>(`/api/companies/${companyId}/services/company-obligations${query ? `?${query}` : ''}`),
    enabled: enabled && Boolean(companyId),
  });
}

/** Filing statuses drive postpaid billing, so refresh the service billing views too. */
function invalidateObligationsAndBilling(client: ReturnType<typeof useQueryClient>, companyId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['company-obligations', companyId] }),
    client.invalidateQueries({ queryKey: ['client-services', companyId] }),
    client.invalidateQueries({ queryKey: ['client-service'] }),
    client.invalidateQueries({ queryKey: ['billing-occurrences'] }),
    client.invalidateQueries({ queryKey: ['billing-coverage'] }),
  ]);
}

export function useSetCompanyObligationStatus(companyId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      obligationCode: string;
      periodKey: string;
      status: CompanyObligationStatus;
      /** With Filed: quantities for the tiered postpaid fees it bills. */
      billingQuantities?: PostpaidQuantityInput[];
    }) =>
      requestJson<{ changed: number }>(`/api/companies/${companyId}/services/company-obligations`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateObligationsAndBilling(client, companyId),
  });
}

/** Tiered postpaid fees that filing this YA would bill and that need a quantity. */
export async function fetchObligationQuantityPrompts(
  companyId: string,
  input: { obligationCode: string; yearOfAssessment: number },
): Promise<PostpaidQuantityPrompt[]> {
  const query = new URLSearchParams({ obligationCode: input.obligationCode, yearOfAssessment: String(input.yearOfAssessment) });
  const body = await requestJson<{ prompts?: PostpaidQuantityPrompt[] }>(
    `/api/companies/${companyId}/services/company-obligations/quantity-prompts?${query}`,
  );
  return body.prompts ?? [];
}

export function useSetEngagementStart(companyId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { serviceId: string; yearOfAssessment: number | null }) =>
      requestJson<{ engagementStartYearOfAssessment: number | null }>(`/api/companies/${companyId}/services/company-obligations`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateObligationsAndBilling(client, companyId),
  });
}

/** Move several services' engagement start YA, for pages not tied to one company. */
export function useMoveEngagementStart() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { companyId: string; serviceIds: string[]; yearOfAssessment: number }) => {
      for (const serviceId of input.serviceIds) {
        await requestJson<{ engagementStartYearOfAssessment: number | null }>(`/api/companies/${input.companyId}/services/company-obligations`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ serviceId, yearOfAssessment: input.yearOfAssessment }),
        });
      }
    },
    onSuccess: (_result, input) => Promise.all([
      invalidateObligationsAndBilling(client, input.companyId),
      client.invalidateQueries({ queryKey: ['deadlines'] }),
    ]),
  });
}

export function useConfirmFinancialPeriod(companyId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { firstFinancialYearEnd: string }) =>
      requestJson<{ firstFinancialYearEnd: string; yearOfAssessment: number }>(`/api/companies/${companyId}/financial-periods`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['company-obligations', companyId] }),
  });
}

function useInvalidateClientServices() {
  const client = useQueryClient();
  return async (companyId: string, serviceId?: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['client-services', companyId] }),
      ...(serviceId ? [client.invalidateQueries({ queryKey: ['client-service', serviceId] })] : []),
    ]);
  };
}

export function useUpdateClientService() {
  const invalidate = useInvalidateClientServices();
  return useMutation({
    mutationFn: ({ id, companyId: _companyId, data }: { id: string; companyId: string; data: UpdateClientServiceInput }) => requestJson<ClientServiceDto>(`/api/client-services/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
    onSuccess: (service, variables) => invalidate(variables.companyId, service.id),
  });
}

export function useManualClientServiceCatalogOptions(companyId: string, enabled = true) {
  return useQuery({
    queryKey: ['client-service-catalog-options', companyId],
    queryFn: () => requestJson<ManualClientServiceCatalogOptionsResponse>(`/api/companies/${companyId}/services/catalog-options`),
    enabled: enabled && Boolean(companyId),
  });
}

export function useCreateManualClientService() {
  const invalidate = useInvalidateClientServices();
  return useMutation({
    mutationFn: ({ companyId, data }: { companyId: string; data: CreateManualClientServiceRequest }) =>
      requestJson<ClientServiceDto>(`/api/companies/${companyId}/services`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (service, variables) => invalidate(variables.companyId, service.id),
  });
}

export function useArchiveClientService() {
  const invalidate = useInvalidateClientServices();
  return useMutation({
    mutationFn: ({ id, companyId: _companyId, reason }: { id: string; companyId: string; reason: string }) => requestJson<{ id: string; archived: true }>(`/api/client-services/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) }),
    onSuccess: (_result, variables) => invalidate(variables.companyId, variables.id),
  });
}

export function useDeleteClientServicePermanently() {
  const queryClient = useQueryClient();
  const invalidateClientServices = useInvalidateClientServices();
  return useMutation({
    mutationFn: ({ id, companyId: _companyId, expectedUpdatedAt, reason }: { id: string; companyId: string; expectedUpdatedAt: string; reason: string }) => requestJson<PermanentDeleteClientServiceResult>(`/api/client-services/${id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deletionMode: 'PERMANENT', expectedUpdatedAt, reason }),
    }),
    onSuccess: (_result, variables) => Promise.all([
      invalidateClientServices(variables.companyId, variables.id),
      queryClient.invalidateQueries({ queryKey: ['service-roster'] }),
      queryClient.invalidateQueries({ queryKey: ['deadlines'] }),
      queryClient.invalidateQueries({ queryKey: ['billing-occurrences'] }),
      queryClient.invalidateQueries({ queryKey: ['billing-coverage'] }),
    ]),
  });
}

export function useRetryServiceAgreementActivation() {
  const invalidate = useInvalidateClientServices();
  return useMutation({
    mutationFn: ({ agreementId }: { agreementId: string; companyId: string }) => requestJson<ServiceAgreementActivationDto>(`/api/service-agreements/${agreementId}/retry-activation`, { method: 'POST' }),
    onSuccess: (_result, variables) => invalidate(variables.companyId),
  });
}
