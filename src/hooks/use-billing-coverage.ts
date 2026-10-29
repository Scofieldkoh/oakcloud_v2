'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BillingCoverageIssueSeverity,
  BillingCoverageIssueType,
  BillingCoverageSummary,
} from '@/services/billing';

export type BillingCoverageFilters = {
  companyIds?: readonly string[];
  types?: readonly BillingCoverageIssueType[];
  severities?: readonly BillingCoverageIssueSeverity[];
};

function uniqueSorted(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function normalizeBillingCoverageFilters(input: BillingCoverageFilters = {}) {
  return {
    companyIds: uniqueSorted(input.companyIds),
    types: uniqueSorted(input.types) as BillingCoverageIssueType[],
    severities: uniqueSorted(input.severities) as BillingCoverageIssueSeverity[],
  };
}

export const billingCoverageKeys = {
  all: ['billing-coverage'] as const,
  list: (filters: BillingCoverageFilters = {}) => [
    'billing-coverage',
    normalizeBillingCoverageFilters(filters),
  ] as const,
};

export interface BillingCoverageErrorBody {
  error?: string;
  code?: string;
  details?: unknown;
  [key: string]: unknown;
}

export class BillingCoverageHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly details: unknown,
    public readonly body: BillingCoverageErrorBody,
  ) {
    super(message);
    this.name = 'BillingCoverageHttpError';
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as BillingCoverageErrorBody;
  if (!response.ok) {
    throw new BillingCoverageHttpError(body.error ?? 'Request failed', response.status, body.code, body.details, body);
  }
  return body as T;
}

function searchParams(filters: BillingCoverageFilters): string {
  const normalized = normalizeBillingCoverageFilters(filters);
  const params = new URLSearchParams();
  if (normalized.companyIds.length > 0) params.set('companyIds', normalized.companyIds.join(','));
  if (normalized.types.length > 0) params.set('types', normalized.types.join(','));
  if (normalized.severities.length > 0) params.set('severities', normalized.severities.join(','));
  params.sort();
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

export function useBillingCoverage(filters: BillingCoverageFilters = {}) {
  const normalized = normalizeBillingCoverageFilters(filters);
  return useQuery<BillingCoverageSummary>({
    queryKey: billingCoverageKeys.list(normalized),
    queryFn: ({ signal }) => requestJson<BillingCoverageSummary>(`/api/billing-coverage${searchParams(normalized)}`, { signal }),
  });
}
export function useReconcileBillingCoverage() {
  const queryClient = useQueryClient();
  return useMutation<{ status: 'PENDING'; requestId: string; dedupeKey: string }, BillingCoverageHttpError, string>({
    mutationFn: (clientServiceId) => requestJson(`/api/client-services/${clientServiceId}/billing/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }),
    onSuccess: async (_result, clientServiceId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: billingCoverageKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['billing-occurrences'] }),
        queryClient.invalidateQueries({ queryKey: ['service-roster'] }),
        queryClient.invalidateQueries({ queryKey: ['client-service', clientServiceId] }),
      ]);
    },
  });
}
