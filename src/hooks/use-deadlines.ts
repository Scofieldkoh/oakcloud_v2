'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  DeadlineSearch,
  ResetDeadlineDateOverrideInput,
  UpdateDeadlineOccurrenceInput,
} from '@/lib/validations/deadline';
import { deadlineSearchSchema } from '@/lib/validations/deadline';
import type { DeadlineListResult, DeadlineOccurrenceDto } from '@/services/deadline';
import type { PostpaidQuantityPrompt } from '@/services/billing/postpaid';
import type { WorkspaceHolidaysDto } from '@/services/business-calendar';

export type DeadlineSearchInput = Omit<Partial<DeadlineSearch>, 'types' | 'familyIds' | 'companyIds' | 'statuses' | 'timing'> & {
  types?: readonly DeadlineSearch['types'][number][];
  familyIds?: readonly string[];
  companyIds?: readonly string[];
  statuses?: readonly DeadlineSearch['statuses'][number][];
  timing?: readonly DeadlineSearch['timing'][number][];
};

export interface DeadlineErrorBody {
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
    public readonly body: DeadlineErrorBody,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

export function isHttpRequestError(error: unknown, status?: number): error is HttpRequestError {
  return error instanceof HttpRequestError && (status === undefined || error.status === status);
}

const typeOrder: Record<DeadlineSearch['types'][number], number> = {
  STATUTORY: 0,
  CLIENT: 1,
  INTERNAL: 2,
};
const statusOrder: Record<DeadlineSearch['statuses'][number], number> = {
  OPEN: 0,
  COMPLETED: 1,
  WAIVED: 2,
  CANCELLED: 3,
};
const timingOrder: Record<DeadlineSearch['timing'][number], number> = {
  UPCOMING: 0,
  DUE: 1,
  OVERDUE: 2,
};

function uniqueStrings(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function uniqueOrdered<T extends string>(
  values: readonly T[] | undefined,
  order: Record<T, number>,
): T[] {
  return [...new Set(values ?? [])].sort((left, right) => order[left] - order[right]);
}

export function normalizeDeadlineSearch(input: DeadlineSearchInput = {}): DeadlineSearch {
  return deadlineSearchSchema.parse({
    from: input.from,
    to: input.to,
    mode: input.mode ?? 'TABLE',
    types: uniqueOrdered(input.types, typeOrder),
    familyIds: uniqueStrings(input.familyIds),
    companyIds: uniqueStrings(input.companyIds),
    statuses: uniqueOrdered(input.statuses, statusOrder),
    timing: uniqueOrdered(input.timing, timingOrder),
    timingBucket: input.timingBucket,
    openOnly: input.openOnly ?? true,
    origin: input.origin,
    companyQuery: input.companyQuery?.trim() ?? '',
    serviceQuery: input.serviceQuery?.trim() ?? '',
    milestoneQuery: input.milestoneQuery?.trim() ?? '',
    page: Number.isSafeInteger(input.page) && input.page! >= 1 ? input.page : 1,
    limit: Number.isSafeInteger(input.limit) && input.limit! >= 1 ? Math.min(input.limit!, 100) : 50,
    sortBy: input.sortBy ?? 'dueDate',
    sortOrder: input.sortOrder ?? 'asc',
  });
}

export const deadlineKeys = {
  all: ['deadlines'] as const,
  list: (search: DeadlineSearchInput = {}) => [
    'deadlines',
    normalizeDeadlineSearch(search),
  ] as const,
  detail: (id: string) => ['deadline', id] as const,
  holidays: (from: string, to: string) => ['deadline-holidays', from, to] as const,
};

export function deadlineSearchParams(search: DeadlineSearchInput = {}): string {
  const normalized = normalizeDeadlineSearch(search);
  const params = new URLSearchParams();
  if (normalized.from) params.set('from', normalized.from);
  if (normalized.to) params.set('to', normalized.to);
  params.set('mode', normalized.mode);
  if (normalized.types.length > 0) params.set('types', normalized.types.join(','));
  params.set('familyIds', normalized.familyIds.join(','));
  params.set('companyIds', normalized.companyIds.join(','));
  params.set('statuses', normalized.statuses.join(','));
  params.set('timing', normalized.timing.join(','));
  if (normalized.timingBucket) params.set('timingBucket', normalized.timingBucket);
  params.set('openOnly', String(normalized.openOnly));
  if (normalized.origin) params.set('origin', normalized.origin);
  if (normalized.companyQuery) params.set('companyQuery', normalized.companyQuery);
  if (normalized.serviceQuery) params.set('serviceQuery', normalized.serviceQuery);
  if (normalized.milestoneQuery) params.set('milestoneQuery', normalized.milestoneQuery);
  params.set('page', String(normalized.page));
  params.set('limit', String(normalized.limit));
  params.set('sortBy', normalized.sortBy);
  params.set('sortOrder', normalized.sortOrder);
  params.sort();
  return params.toString();
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as DeadlineErrorBody;
  if (!response.ok) {
    throw new HttpRequestError(body.error ?? 'Request failed', response.status, body.code, body.details, body);
  }
  return body as T;
}

export function useDeadlines(search: DeadlineSearchInput = {}) {
  const normalized = normalizeDeadlineSearch(search);
  return useQuery<DeadlineListResult>({
    queryKey: deadlineKeys.list(normalized),
    queryFn: ({ signal }) => requestJson<DeadlineListResult>(`/api/deadlines?${deadlineSearchParams(normalized)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

/** Weekend days and holidays from the workspace's business calendars for a calendar range. */
export function useDeadlineHolidays(range: { from: string; to: string }) {
  return useQuery<WorkspaceHolidaysDto>({
    queryKey: deadlineKeys.holidays(range.from, range.to),
    queryFn: ({ signal }) => requestJson<WorkspaceHolidaysDto>(`/api/deadlines/holidays?${new URLSearchParams(range)}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60 * 60 * 1000,
  });
}

function useInvalidateDeadlineQueries() {
  const queryClient = useQueryClient();
  return async (id: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: deadlineKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['service-roster'] }),
      queryClient.invalidateQueries({ queryKey: deadlineKeys.detail(id) }),
      // A company filing status can raise or cancel a postpaid bill.
      queryClient.invalidateQueries({ queryKey: ['billing-occurrences'] }),
      queryClient.invalidateQueries({ queryKey: ['client-service'] }),
      queryClient.invalidateQueries({ queryKey: ['client-services'] }),
      queryClient.invalidateQueries({ queryKey: ['company-obligations'] }),
    ]);
  };
}

export function useDeadline(id: string | null) {
  return useQuery<DeadlineOccurrenceDto>({
    queryKey: id ? deadlineKeys.detail(id) : deadlineKeys.detail(''),
    queryFn: ({ signal }) => requestJson<DeadlineOccurrenceDto>(`/api/deadlines/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useUpdateDeadlineOccurrence() {
  const invalidate = useInvalidateDeadlineQueries();
  return useMutation<DeadlineOccurrenceDto, HttpRequestError, { id: string; data: UpdateDeadlineOccurrenceInput }>({
    mutationFn: ({ id, data }) => requestJson<DeadlineOccurrenceDto>(`/api/deadlines/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }),
    onSuccess: (deadline) => invalidate(deadline.id),
  });
}

export function useResetDeadlineDateOverride() {
  const invalidate = useInvalidateDeadlineQueries();
  return useMutation<DeadlineOccurrenceDto, HttpRequestError, { id: string; data: ResetDeadlineDateOverrideInput }>({
    mutationFn: ({ id, data }) => requestJson<DeadlineOccurrenceDto>(`/api/deadlines/${id}/reset-date-override`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }),
    onSuccess: (deadline) => invalidate(deadline.id),
  });
}

export type { DeadlineListResult, DeadlineOccurrenceDto };

/** Billing checks for company filings about to be marked Filed. */
export type FilingBillingChecks = {
  /** Filings that bill nothing because their YA is before a service's engagement start. */
  items: Array<{
    occurrenceId: string;
    services: Array<{ clientServiceId: string; serviceName: string; engagementStartYearOfAssessment: number }>;
  }>;
  /** Tiered postpaid fees each filing bills that need a quantity. */
  quantityPrompts: Array<{ occurrenceId: string; prompts: PostpaidQuantityPrompt[] }>;
};

export async function fetchFilingBillingChecks(ids: readonly string[], signal?: AbortSignal): Promise<FilingBillingChecks> {
  const body = await requestJson<Partial<FilingBillingChecks>>('/api/deadlines/unbilled-filings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
    signal,
  });
  return { items: body.items ?? [], quantityPrompts: body.quantityPrompts ?? [] };
}
