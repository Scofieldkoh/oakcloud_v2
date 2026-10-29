'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BusinessCalendarInput,
  BusinessCalendarUpdateInput,
} from '@/lib/validations/business-calendar';
import type { AdminRequestError } from './use-deadline-rules';
import { pendingReconciliationSummaryKeys, serviceAdminAssociationKeys } from './use-deadline-rules';
import type { BusinessCalendarDto, BusinessCalendarImpact, BusinessCalendarListDto } from '@/services/business-calendar';
import type { PublicHolidayRefreshResult, PublicHolidaySourceStatus } from '@/services/public-holiday/constants';

export const serviceCalendarKeys = {
  all: ['service-calendars'] as const,
  lists: (workspaceId: string | undefined) => ['service-calendars', 'list', workspaceId ?? null] as const,
  list: (workspaceId: string | undefined) => ['service-calendars', 'list', workspaceId ?? null] as const,
  details: (workspaceId: string | undefined) => ['service-calendars', 'detail', workspaceId ?? null] as const,
  detail: (workspaceId: string | undefined, id: string | undefined) => ['service-calendars', 'detail', workspaceId ?? null, id ?? null] as const,
  impacts: (workspaceId: string | undefined) => ['service-calendars', 'impact', workspaceId ?? null] as const,
  impact: (workspaceId: string | undefined, id: string | undefined) => ['service-calendars', 'impact', workspaceId ?? null, id ?? null] as const,
  publicHolidaySource: (workspaceId: string | undefined) => ['service-calendars', 'public-holiday-source', workspaceId ?? null] as const,
};

export type PublicHolidayCheckResponse = {
  result: PublicHolidayRefreshResult;
  status: PublicHolidaySourceStatus;
};

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as { error?: string | { message?: string; code?: string; details?: unknown }; code?: string; details?: unknown };
  if (!response.ok) {
    const value = body.error;
    const message = typeof value === 'string' ? value : value?.message ?? 'Business calendar request failed';
    const error = new Error(message) as AdminRequestError;
    Object.assign(error, {
      name: 'AdminRequestError',
      status: response.status,
      code: body.code ?? (typeof value === 'object' ? value.code : undefined),
      details: body.details ?? (typeof value === 'object' ? value.details : undefined),
      body,
    });
    throw error;
  }
  return body as T;
}

const tenantQuery = (workspaceId: string) => `?tenantId=${encodeURIComponent(workspaceId)}`;

function invalidateCalendarQueries(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string | undefined, id?: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: serviceCalendarKeys.lists(workspaceId) }),
    ...(id ? [queryClient.invalidateQueries({ queryKey: serviceCalendarKeys.detail(workspaceId, id) })] : []),
    queryClient.invalidateQueries({ queryKey: serviceCalendarKeys.impacts(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: serviceAdminAssociationKeys.all }),
    queryClient.invalidateQueries({ queryKey: serviceAdminAssociationKeys.selectable }),
    queryClient.invalidateQueries({ queryKey: serviceAdminAssociationKeys.clientOptions }),
    queryClient.invalidateQueries({ queryKey: pendingReconciliationSummaryKeys.detail(workspaceId) }),
  ]);
}

export function useServiceCalendars(workspaceId: string | undefined, enabled = true) {
  return useQuery<BusinessCalendarListDto>({
    queryKey: serviceCalendarKeys.list(workspaceId),
    queryFn: ({ signal }) => requestJson<BusinessCalendarListDto>(
      `/api/service-calendars${tenantQuery(workspaceId!)}`,
      { signal },
    ),
    enabled: Boolean(workspaceId && enabled),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useServiceCalendar(workspaceId: string | undefined, id: string | undefined, enabled = true) {
  return useQuery<BusinessCalendarDto>({
    queryKey: serviceCalendarKeys.detail(workspaceId, id),
    queryFn: ({ signal }) => requestJson<BusinessCalendarDto>(
      `/api/service-calendars/${encodeURIComponent(id!)}${tenantQuery(workspaceId!)}`,
      { signal },
    ),
    enabled: Boolean(workspaceId && id && enabled),
    retry: false,
  });
}

export function useCreateServiceCalendar(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<BusinessCalendarDto, AdminRequestError, BusinessCalendarInput>({
    mutationFn: (input) => requestJson<BusinessCalendarDto>('/api/service-calendars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, tenantId: workspaceId }),
    }),
    onSuccess: () => invalidateCalendarQueries(queryClient, workspaceId),
  });
}

export function useUpdateServiceCalendar(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<BusinessCalendarDto, AdminRequestError, { id: string; input: BusinessCalendarUpdateInput }>({
    mutationFn: ({ id, input }) => requestJson<BusinessCalendarDto>(
      `/api/service-calendars/${encodeURIComponent(id)}${tenantQuery(workspaceId!)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, tenantId: workspaceId }),
      },
    ),
    onSuccess: (_data, variables) => invalidateCalendarQueries(queryClient, workspaceId, variables.id),
  });
}

export function usePreviewServiceCalendarImpact(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<BusinessCalendarImpact, AdminRequestError, { id: string; input: BusinessCalendarInput }>({
    mutationFn: ({ id, input }) => requestJson<BusinessCalendarImpact>(
      `/api/service-calendars/${encodeURIComponent(id)}/impact${tenantQuery(workspaceId!)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, tenantId: workspaceId }),
      },
    ),
    onSuccess: (impact, variables) => queryClient.setQueryData(serviceCalendarKeys.impact(workspaceId, variables.id), impact),
  });
}

export function usePublicHolidaySource(workspaceId: string | undefined, enabled = true) {
  return useQuery<PublicHolidaySourceStatus>({
    queryKey: serviceCalendarKeys.publicHolidaySource(workspaceId),
    queryFn: ({ signal }) => requestJson<PublicHolidaySourceStatus>(
      `/api/service-calendars/public-holidays${tenantQuery(workspaceId!)}`,
      { signal },
    ),
    enabled: Boolean(workspaceId && enabled),
    retry: false,
  });
}

/** Check MOM for updates now; business calendars synchronize on the server. */
export function useCheckPublicHolidays(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<PublicHolidayCheckResponse, AdminRequestError, void>({
    mutationFn: () => requestJson<PublicHolidayCheckResponse>(
      `/api/service-calendars/public-holidays${tenantQuery(workspaceId!)}`,
      { method: 'POST' },
    ),
    onSuccess: (response) => {
      queryClient.setQueryData(serviceCalendarKeys.publicHolidaySource(workspaceId), response.status);
      return Promise.all([
        invalidateCalendarQueries(queryClient, workspaceId),
        queryClient.invalidateQueries({ queryKey: serviceCalendarKeys.details(workspaceId) }),
      ]);
    },
  });
}
