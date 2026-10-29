'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DeadlineRuleDraftInput,
  SearchDeadlineRulesInput,
} from '@/lib/validations/deadline-rule';
import type {
  DeadlineRuleArchiveInput,
  DeadlineRuleImpactInput,
  DeadlineRulePresetCode,
  DeadlineRulePublishInput,
} from '@/services/deadline-rule';
import type {
  DeadlineRuleDto,
  DeadlineRuleImpact,
  DeadlineRuleListDto,
} from '@/services/deadline-rule';

export interface DeadlineRuleFilters extends Partial<Omit<SearchDeadlineRulesInput, 'query'>> {
  query?: string;
}

export interface AdminRequestErrorBody {
  error?: string | { message?: string; code?: string; details?: unknown };
  code?: string;
  details?: unknown;
  [key: string]: unknown;
}

export class AdminRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly details: unknown,
    public readonly body: AdminRequestErrorBody,
  ) {
    super(message);
    this.name = 'AdminRequestError';
  }
}

function normalizeFilters(input: DeadlineRuleFilters = {}): SearchDeadlineRulesInput {
  const page = Number.isSafeInteger(input.page) && input.page! >= 1 ? input.page! : 1;
  const limit = Number.isSafeInteger(input.limit) && input.limit! >= 1
    ? Math.min(input.limit!, 100)
    : 20;
  return {
    query: input.query?.trim() || undefined,
    isActive: input.isActive,
    includeArchived: input.includeArchived ?? false,
    page,
    limit,
    sortBy: input.sortBy ?? 'code',
    sortOrder: input.sortOrder ?? 'asc',
  };
}

export const deadlineRuleKeys = {
  all: ['deadline-rules'] as const,
  lists: (workspaceId: string | undefined) => ['deadline-rules', 'list', workspaceId ?? null] as const,
  list: (workspaceId: string | undefined, filters: DeadlineRuleFilters = {}) => [
    'deadline-rules',
    'list',
    workspaceId ?? null,
    normalizeFilters(filters),
  ] as const,
  details: (workspaceId: string | undefined) => ['deadline-rules', 'detail', workspaceId ?? null] as const,
  detail: (workspaceId: string | undefined, id: string | undefined) => [
    'deadline-rules',
    'detail',
    workspaceId ?? null,
    id ?? null,
  ] as const,
  impacts: (workspaceId: string | undefined) => ['deadline-rules', 'impact', workspaceId ?? null] as const,
  impact: (
    workspaceId: string | undefined,
    id: string | undefined,
    operation: 'PUBLISH' | 'ARCHIVE' = 'PUBLISH',
  ) => ['deadline-rules', 'impact', workspaceId ?? null, id ?? null, operation] as const,
};

/** Catalog and reconciliation projections consumed by service forms/rosters. */
export const serviceAdminAssociationKeys = {
  all: ['service-catalog'] as const,
  selectable: ['service-catalog-selectable'] as const,
  clientOptions: ['client-service-catalog-options'] as const,
};

export const pendingReconciliationSummaryKeys = {
  all: ['schedule-reconciliation', 'pending-summary'] as const,
  detail: (workspaceId: string | undefined) => [
    'schedule-reconciliation',
    'pending-summary',
    workspaceId ?? null,
  ] as const,
};

function queryString(workspaceId: string): string {
  return `?tenantId=${encodeURIComponent(workspaceId)}`;
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as AdminRequestErrorBody;
  if (!response.ok) {
    const errorValue = body.error;
    const message = typeof errorValue === 'string'
      ? errorValue
      : errorValue?.message ?? 'Administration request failed';
    throw new AdminRequestError(message, response.status, body.code ?? (typeof errorValue === 'object' ? errorValue.code : undefined), body.details ?? (typeof errorValue === 'object' ? errorValue.details : undefined), body);
  }
  return body as T;
}

function invalidateRuleQueries(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string | undefined, id?: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: deadlineRuleKeys.lists(workspaceId) }),
    ...(id ? [queryClient.invalidateQueries({ queryKey: deadlineRuleKeys.detail(workspaceId, id) })] : []),
    queryClient.invalidateQueries({ queryKey: deadlineRuleKeys.impacts(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: serviceAdminAssociationKeys.all }),
    queryClient.invalidateQueries({ queryKey: serviceAdminAssociationKeys.selectable }),
    queryClient.invalidateQueries({ queryKey: serviceAdminAssociationKeys.clientOptions }),
    queryClient.invalidateQueries({ queryKey: pendingReconciliationSummaryKeys.detail(workspaceId) }),
  ]);
}

export function normalizeDeadlineRuleFilters(input: DeadlineRuleFilters = {}): SearchDeadlineRulesInput {
  return normalizeFilters(input);
}

export function useDeadlineRules(
  workspaceId: string | undefined,
  filters: DeadlineRuleFilters = {},
  enabled = true,
) {
  const normalized = normalizeFilters(filters);
  return useQuery<DeadlineRuleListDto>({
    queryKey: deadlineRuleKeys.list(workspaceId, normalized),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        tenantId: workspaceId!,
        includeArchived: String(normalized.includeArchived),
        page: String(normalized.page),
        limit: String(normalized.limit),
        sortBy: normalized.sortBy,
        sortOrder: normalized.sortOrder,
      });
      if (normalized.query) params.set('query', normalized.query);
      if (normalized.isActive !== undefined) params.set('isActive', String(normalized.isActive));
      return requestJson<DeadlineRuleListDto>(`/api/service-catalog/deadline-rules?${params.toString()}`, { signal });
    },
    enabled: Boolean(workspaceId && enabled),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useDeadlineRule(workspaceId: string | undefined, id: string | undefined, enabled = true) {
  return useQuery<DeadlineRuleDto>({
    queryKey: deadlineRuleKeys.detail(workspaceId, id),
    queryFn: ({ signal }) => requestJson<DeadlineRuleDto>(
      `/api/service-catalog/deadline-rules/${encodeURIComponent(id!)}${queryString(workspaceId!)}`,
      { signal },
    ),
    enabled: Boolean(workspaceId && id && enabled),
    retry: false,
  });
}

export function useCreateDeadlineRule(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<DeadlineRuleDto, AdminRequestError, DeadlineRuleDraftInput>({
    mutationFn: (input) => requestJson<DeadlineRuleDto>('/api/service-catalog/deadline-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, tenantId: workspaceId }),
    }),
    onSuccess: () => invalidateRuleQueries(queryClient, workspaceId),
  });
}

export function useUpdateDeadlineRule(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<DeadlineRuleDto, AdminRequestError, { id: string; input: DeadlineRuleDraftInput }>({
    mutationFn: ({ id, input }) => requestJson<DeadlineRuleDto>(
      `/api/service-catalog/deadline-rules/${encodeURIComponent(id)}${queryString(workspaceId!)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, tenantId: workspaceId }),
      },
    ),
    onSuccess: (_data, variables) => invalidateRuleQueries(queryClient, workspaceId, variables.id),
  });
}

export function usePreviewDeadlineRuleImpact(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<DeadlineRuleImpact, AdminRequestError, { id: string; input: DeadlineRuleImpactInput }>({
    mutationFn: ({ id, input }) => requestJson<DeadlineRuleImpact>(
      `/api/service-catalog/deadline-rules/${encodeURIComponent(id)}/impact${queryString(workspaceId!)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, tenantId: workspaceId }),
      },
    ),
    onSuccess: (impact, variables) => {
      queryClient.setQueryData(deadlineRuleKeys.impact(workspaceId, variables.id, impact.operation), impact);
    },
  });
}

export function usePublishDeadlineRule(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<DeadlineRuleDto, AdminRequestError, { id: string; input: DeadlineRulePublishInput }>({
    mutationFn: ({ id, input }) => requestJson<DeadlineRuleDto>(
      `/api/service-catalog/deadline-rules/${encodeURIComponent(id)}/publish${queryString(workspaceId!)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, tenantId: workspaceId }),
      },
    ),
    onSuccess: (_data, variables) => invalidateRuleQueries(queryClient, workspaceId, variables.id),
  });
}

export function useApplyDeadlineRulePreset(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<DeadlineRuleDto, AdminRequestError, { code: DeadlineRulePresetCode }>({
    mutationFn: ({ code }) => requestJson<DeadlineRuleDto>(
      `/api/service-catalog/deadline-rules/presets${queryString(workspaceId!)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, tenantId: workspaceId }),
      },
    ),
    onSuccess: (data) => invalidateRuleQueries(queryClient, workspaceId, data.id),
  });
}

export function useArchiveDeadlineRule(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<DeadlineRuleDto, AdminRequestError, { id: string; input: DeadlineRuleArchiveInput }>({
    mutationFn: ({ id, input }) => requestJson<DeadlineRuleDto>(
      `/api/service-catalog/deadline-rules/${encodeURIComponent(id)}/archive${queryString(workspaceId!)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, tenantId: workspaceId }),
      },
    ),
    onSuccess: (_data, variables) => invalidateRuleQueries(queryClient, workspaceId, variables.id),
  });
}
