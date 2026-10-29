'use client';

import {
  keepPreviousData,
  useQuery,
} from '@tanstack/react-query';
import type {
  ServiceRosterItem,
  ServiceRosterResult,
} from '@/services/service-roster';
import type { ServiceRosterSearch } from '@/lib/validations/service-roster';

export type ServiceRosterSearchInput = Omit<Partial<ServiceRosterSearch>, 'familyIds' | 'statuses'> & {
  familyIds?: readonly string[];
  statuses?: readonly ServiceRosterSearch['statuses'][number][];
};

export type ServiceRosterSearchNormalized = ServiceRosterSearch;

export interface ServiceRosterErrorBody {
  error?: string;
  code?: string;
  details?: unknown;
  [key: string]: unknown;
}

export class HttpRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly details: unknown,
    public readonly body: ServiceRosterErrorBody,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

export function isHttpRequestError(error: unknown, status?: number): error is HttpRequestError {
  return error instanceof HttpRequestError && (status === undefined || error.status === status);
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

const statusOrder: Record<ServiceRosterSearch['statuses'][number], number> = {
  ACTIVE: 0,
  PAUSED: 1,
  ENDED: 2,
};

function uniqueStatuses(
  values: readonly ServiceRosterSearch['statuses'][number][] | undefined,
): ServiceRosterSearch['statuses'] {
  return [...new Set(values ?? [])].sort((left, right) => statusOrder[left] - statusOrder[right]);
}

export function normalizeServiceRosterSearch(
  input: ServiceRosterSearchInput = {},
): ServiceRosterSearchNormalized {
  const query = input.query?.trim();
  const page = Number.isSafeInteger(input.page) && input.page! >= 1 ? input.page! : 1;
  const limit = Number.isSafeInteger(input.limit) && input.limit! >= 1
    ? Math.min(input.limit!, 100)
    : 20;
  return {
    query: query || undefined,
    companyQuery: input.companyQuery?.trim() || undefined,
    familyQuery: input.familyQuery?.trim() || undefined,
    serviceQuery: input.serviceQuery?.trim() || undefined,
    statusQuery: input.statusQuery?.trim() || undefined,
    cadenceQuery: input.cadenceQuery?.trim() || undefined,
    nextDeadlineQuery: input.nextDeadlineQuery?.trim() || undefined,
    startEndQuery: input.startEndQuery?.trim() || undefined,
    warningQuery: input.warningQuery?.trim() || undefined,
    billingQuery: input.billingQuery?.trim() || undefined,
    companyId: input.companyId,
    familyIds: unique(input.familyIds),
    variantId: input.variantId,
    statuses: uniqueStatuses(input.statuses),
    archived: input.archived ?? false,
    applicability: input.applicability,
    sortBy: input.sortBy ?? 'company',
    sortOrder: input.sortOrder ?? 'asc',
    page,
    limit,
  };
}

export const serviceRosterKeys = {
  all: ['service-roster'] as const,
  list: (search: ServiceRosterSearchInput = {}) => [
    'service-roster',
    normalizeServiceRosterSearch(search),
  ] as const,
};

export function serviceRosterSearchParams(search: ServiceRosterSearchInput = {}): string {
  const normalized = normalizeServiceRosterSearch(search);
  const params = new URLSearchParams();
  params.set('archived', String(normalized.archived));
  if (normalized.applicability) params.set('applicability', normalized.applicability);
  if (normalized.companyId) params.set('companyId', normalized.companyId);
  if (normalized.companyQuery) params.set('companyQuery', normalized.companyQuery);
  if (normalized.familyQuery) params.set('familyQuery', normalized.familyQuery);
  if (normalized.familyIds.length > 0) params.set('familyIds', normalized.familyIds.join(','));
  if (normalized.limit !== undefined) params.set('limit', String(normalized.limit));
  if (normalized.page !== undefined) params.set('page', String(normalized.page));
  if (normalized.query) params.set('query', normalized.query);
  if (normalized.sortBy) params.set('sortBy', normalized.sortBy);
  if (normalized.sortOrder) params.set('sortOrder', normalized.sortOrder);
  if (normalized.serviceQuery) params.set('serviceQuery', normalized.serviceQuery);
  if (normalized.statusQuery) params.set('statusQuery', normalized.statusQuery);
  if (normalized.cadenceQuery) params.set('cadenceQuery', normalized.cadenceQuery);
  if (normalized.nextDeadlineQuery) params.set('nextDeadlineQuery', normalized.nextDeadlineQuery);
  if (normalized.startEndQuery) params.set('startEndQuery', normalized.startEndQuery);
  if (normalized.warningQuery) params.set('warningQuery', normalized.warningQuery);
  if (normalized.billingQuery) params.set('billingQuery', normalized.billingQuery);
  if (normalized.statuses.length > 0) params.set('statuses', normalized.statuses.join(','));
  if (normalized.variantId) params.set('variantId', normalized.variantId);
  params.sort();
  return params.toString();
}

async function requestJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json().catch(() => ({})) as ServiceRosterErrorBody;
  if (!response.ok) {
    throw new HttpRequestError(
      body.error ?? 'Request failed',
      response.status,
      body.code,
      body.details,
      body,
    );
  }
  return body as T;
}

export function useServiceRoster(search: ServiceRosterSearchInput = {}) {
  const normalizedSearch = normalizeServiceRosterSearch(search);
  const queryKey = serviceRosterKeys.list(normalizedSearch);
  return useQuery<ServiceRosterResult>({
    queryKey,
    queryFn: ({ signal }) => requestJson<ServiceRosterResult>(
      `/api/client-services?${serviceRosterSearchParams(normalizedSearch)}`,
      signal,
    ),
    placeholderData: keepPreviousData,
  });
}

export type { ServiceRosterItem, ServiceRosterResult };
