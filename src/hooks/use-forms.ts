'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Form, FormStatus } from '@/generated/prisma';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import {
  usePersistSessionListSnapshot,
  useSessionListRestore,
} from '@/hooks/use-session-query-restore';
import type { CreateFormInput, FormFieldInput, UpdateFormInput } from '@/lib/validations/form-builder';
import type {
  DeleteFormDraftResult,
  DeleteFormResponseResult,
  DeleteFormResponseUploadResult,
  FormListItem,
  FormListResult,
  FormDetail,
  FormResponsesResult,
  FormResponseDetailResult,
  FormDraftDetailResult,
  FormWarningListItem,
  RecentFormSubmissionItem,
  GenerateFormDraftResumeLinkResult,
  ExtendFormDraftExpiryResult,
  UpdateFormResponseTagsResult,
  UpdateFormResponseReviewStatusResult,
} from '@/services/form-builder.service';
import type { FormResponseReviewStatus } from '@/lib/form-utils';

export type { FormListItem, FormListResult, FormDetail, FormResponsesResult, FormResponseDetailResult };

function isFormListResult(value: unknown): value is FormListResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FormListResult>;
  return (
    !!candidate.forms &&
    Array.isArray(candidate.forms) &&
    typeof candidate.total === 'number' &&
    typeof candidate.totalPages === 'number'
  );
}

export type RecentFormSubmission = Omit<RecentFormSubmissionItem, 'submittedAt' | 'status'> & {
  submittedAt: string;
  status: string;
};

export type FormDraftAuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  summary: string | null;
  reason: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
};

export type FormWarningSummary = Omit<FormWarningListItem, 'latestSubmittedAt'> & {
  latestSubmittedAt: string;
};

export interface FormListParams {
  query?: string;
  status?: FormStatus;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface FormResponsesParams {
  page?: number;
  limit?: number;
  draftPage?: number;
  draftLimit?: number;
  submissionSortBy?: string;
  submissionSortOrder?: 'asc' | 'desc';
  submissionFilters?: Record<string, string>;
}

function withTenant(path: string, tenantId?: string | null): string {
  if (!tenantId) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}tenantId=${encodeURIComponent(tenantId)}`;
}

async function fetchForms(params: FormListParams, tenantId?: string | null): Promise<FormListResult> {
  const searchParams = new URLSearchParams();
  if (params.query) searchParams.set('query', params.query);
  if (params.status) searchParams.set('status', params.status);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  const basePath = `/api/forms${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const response = await fetch(withTenant(basePath, tenantId));

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch forms');
  }

  return response.json();
}

async function fetchForm(id: string, tenantId?: string | null): Promise<FormDetail> {
  const response = await fetch(withTenant(`/api/forms/${id}`, tenantId));
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch form');
  }

  return response.json();
}

async function fetchFormResponses(
  id: string,
  params: FormResponsesParams,
  tenantId?: string | null
): Promise<FormResponsesResult> {
  const searchParams = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 20),
    draftPage: String(params.draftPage ?? 1),
    draftLimit: String(params.draftLimit ?? 20),
  });
  if (params.submissionSortBy) searchParams.set('submissionSortBy', params.submissionSortBy);
  if (params.submissionSortOrder) searchParams.set('submissionSortOrder', params.submissionSortOrder);
  if (params.submissionFilters && Object.keys(params.submissionFilters).length > 0) {
    searchParams.set('submissionFilters', JSON.stringify(params.submissionFilters));
  }
  const response = await fetch(withTenant(`/api/forms/${id}/responses?${searchParams.toString()}`, tenantId));
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch responses');
  }

  return response.json();
}

async function fetchFormResponse(
  id: string,
  submissionId: string,
  tenantId?: string | null
): Promise<FormResponseDetailResult> {
  const response = await fetch(withTenant(`/api/forms/${id}/responses/${submissionId}`, tenantId));
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch response');
  }

  return response.json();
}

async function fetchFormDraft(
  id: string,
  draftId: string,
  tenantId?: string | null
): Promise<FormDraftDetailResult> {
  const response = await fetch(withTenant(`/api/forms/${id}/drafts/${draftId}`, tenantId));
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch draft');
  }

  return response.json();
}

async function fetchFormDraftAuditLogs(
  id: string,
  draftId: string,
  tenantId?: string | null
): Promise<FormDraftAuditLog[]> {
  const response = await fetch(withTenant(`/api/forms/${id}/drafts/${draftId}/audit`, tenantId));
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch draft audit log');
  }

  return response.json();
}

async function deleteFormResponseRequest(
  id: string,
  submissionId: string,
  tenantId?: string | null,
  reason?: string
): Promise<DeleteFormResponseResult> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (reason) params.set('reason', reason);

  const response = await fetch(`/api/forms/${id}/responses/${submissionId}${params.toString() ? `?${params.toString()}` : ''}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete response');
  }

  return response.json();
}

async function updateFormResponseTagsRequest(
  id: string,
  submissionId: string,
  tags: string[],
  tenantId?: string | null
): Promise<UpdateFormResponseTagsResult> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);

  const response = await fetch(`/api/forms/${id}/responses/${submissionId}${params.toString() ? `?${params.toString()}` : ''}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update response tags');
  }

  return response.json();
}

async function updateFormResponseReviewStatusRequest(
  id: string,
  submissionId: string,
  reviewStatus: FormResponseReviewStatus,
  tenantId?: string | null
): Promise<UpdateFormResponseReviewStatusResult> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);

  const response = await fetch(`/api/forms/${id}/responses/${submissionId}${params.toString() ? `?${params.toString()}` : ''}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewStatus }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update response review status');
  }

  return response.json();
}

async function deleteFormResponseUploadRequest(
  id: string,
  submissionId: string,
  uploadId: string,
  tenantId?: string | null,
  reason?: string
): Promise<DeleteFormResponseUploadResult> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (reason) params.set('reason', reason);

  const response = await fetch(
    `/api/forms/${id}/responses/${submissionId}/uploads/${uploadId}${params.toString() ? `?${params.toString()}` : ''}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete attachment');
  }

  return response.json();
}

async function deleteFormDraftRequest(
  id: string,
  draftId: string,
  tenantId?: string | null,
  reason?: string
): Promise<DeleteFormDraftResult> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (reason) params.set('reason', reason);

  const response = await fetch(`/api/forms/${id}/drafts/${draftId}${params.toString() ? `?${params.toString()}` : ''}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete draft');
  }

  return response.json();
}

async function generateFormDraftResumeLinkRequest(
  id: string,
  draftId: string,
  tenantId?: string | null,
  reason?: string
): Promise<GenerateFormDraftResumeLinkResult> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);

  const response = await fetch(`/api/forms/${id}/drafts/${draftId}${params.toString() ? `?${params.toString()}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to generate resume link');
  }

  return response.json();
}

async function extendFormDraftExpiryRequest(
  id: string,
  draftId: string,
  expiresAt: string,
  tenantId?: string | null,
  reason?: string
): Promise<ExtendFormDraftExpiryResult> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);

  const response = await fetch(`/api/forms/${id}/drafts/${draftId}${params.toString() ? `?${params.toString()}` : ''}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresAt, reason }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to extend draft expiry');
  }

  return response.json();
}

async function fetchRecentFormSubmissions(
  limit: number,
  tenantId?: string | null
): Promise<RecentFormSubmission[]> {
  const response = await fetch(withTenant(`/api/forms/recent-submissions?limit=${limit}`, tenantId));
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch recent submissions');
  }

  const data = await response.json();
  return Array.isArray(data.submissions) ? data.submissions : [];
}

async function fetchFormsWithWarnings(
  limit: number,
  tenantId?: string | null
): Promise<FormWarningSummary[]> {
  const response = await fetch(withTenant(`/api/forms/warnings?limit=${limit}`, tenantId));
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch forms with warnings');
  }

  const data = await response.json();
  return Array.isArray(data.forms) ? data.forms : [];
}

async function createFormRequest(data: CreateFormInput & { tenantId?: string | null }): Promise<Form> {
  const response = await fetch('/api/forms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create form');
  }

  return response.json();
}

async function updateFormRequest(
  id: string,
  data: UpdateFormInput & { fields?: FormFieldInput[]; reason?: string; tenantId?: string | null }
): Promise<FormDetail> {
  const response = await fetch(`/api/forms/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update form');
  }

  return response.json();
}

async function duplicateFormRequest(
  id: string,
  title?: string,
  tenantId?: string | null
): Promise<FormDetail> {
  const response = await fetch(`/api/forms/${id}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, tenantId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to duplicate form');
  }

  return response.json();
}

async function deleteFormRequest(id: string, tenantId?: string | null, reason?: string): Promise<Form> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (reason) params.set('reason', reason);

  const response = await fetch(`/api/forms/${id}${params.toString() ? `?${params.toString()}` : ''}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete form');
  }

  return response.json();
}

async function hardDeleteFormRequest(id: string, tenantId?: string | null): Promise<Form> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);

  const response = await fetch(`/api/forms/${id}/hard-delete${params.toString() ? `?${params.toString()}` : ''}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to permanently delete form');
  }

  return response.json();
}

export const formKeys = {
  all: ['forms'] as const,
  lists: () => [...formKeys.all, 'list'] as const,
  list: (params: FormListParams, tenantId?: string | null) => [...formKeys.lists(), params, tenantId] as const,
  detail: (id: string, tenantId?: string | null) => [...formKeys.all, 'detail', id, tenantId] as const,
  // Scoped prefix for all response/draft queries belonging to a form
  allResponsesForForm: (id: string) => [...formKeys.all, 'responses', id] as const,
  responses: (id: string, params: FormResponsesParams, tenantId?: string | null) =>
    [...formKeys.all, 'responses', id, params, tenantId] as const,
  responseDetail: (id: string, submissionId: string, tenantId?: string | null) =>
    [...formKeys.all, 'response-detail', id, submissionId, tenantId] as const,
  draftDetail: (id: string, draftId: string, tenantId?: string | null) =>
    [...formKeys.all, 'draft-detail', id, draftId, tenantId] as const,
  draftAudit: (id: string, draftId: string, tenantId?: string | null) =>
    [...formKeys.all, 'draft-audit', id, draftId, tenantId] as const,
  recentSubmissions: (limit: number, tenantId?: string | null) =>
    [...formKeys.all, 'recent-submissions', limit, tenantId] as const,
  warnings: (limit: number, tenantId?: string | null) =>
    [...formKeys.all, 'warnings', limit, tenantId] as const,
};

export function useForms(
  params: FormListParams = {},
  options: { restoreSession?: boolean } = {},
) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);
  const queryClient = useQueryClient();
  const restoreSession = options.restoreSession === true;

  const normalizedParams: FormListParams = {
    page: params.page ?? 1,
    limit: params.limit ?? 20,
    sortBy: params.sortBy ?? 'updatedAt',
    sortOrder: params.sortOrder ?? 'desc',
    query: params.query,
    status: params.status,
  };

  const queryKey = formKeys.list(normalizedParams, activeTenantId);
  const { initialData, restoredFromSession } = useSessionListRestore<FormListResult>(
    queryClient,
    queryKey,
    { enabled: restoreSession, validate: isFormListResult },
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchForms(normalizedParams, activeTenantId),
    enabled: session?.isSuperAdmin ? !!activeTenantId : true,
    placeholderData: (previousData) => previousData,
    initialData,
    initialDataUpdatedAt: restoredFromSession ? 0 : undefined,
  });

  usePersistSessionListSnapshot(queryKey, restoreSession ? query.data : undefined);

  return query;
}

export function useForm(id: string | null) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useQuery({
    queryKey: formKeys.detail(id || '', activeTenantId),
    queryFn: () => fetchForm(id!, activeTenantId),
    enabled: !!id && (session?.isSuperAdmin ? !!activeTenantId : true),
    staleTime: 30_000,
  });
}

export function useFormResponses(
  id: string | null,
  params: FormResponsesParams = {}
) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  const normalizedParams: FormResponsesParams = {
    page: params.page ?? 1,
    limit: params.limit ?? 20,
    draftPage: params.draftPage ?? 1,
    draftLimit: params.draftLimit ?? 20,
    submissionSortBy: params.submissionSortBy,
    submissionSortOrder: params.submissionSortOrder ?? 'desc',
    submissionFilters: params.submissionFilters,
  };

  return useQuery({
    queryKey: formKeys.responses(id || '', normalizedParams, activeTenantId),
    queryFn: () => fetchFormResponses(id!, normalizedParams, activeTenantId),
    enabled: !!id && (session?.isSuperAdmin ? !!activeTenantId : true),
    placeholderData: (previousData) => previousData,
  });
}

export function useFormResponse(id: string | null, submissionId: string | null) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useQuery({
    queryKey: formKeys.responseDetail(id || '', submissionId || '', activeTenantId),
    queryFn: () => fetchFormResponse(id!, submissionId!, activeTenantId),
    enabled: !!id && !!submissionId && (session?.isSuperAdmin ? !!activeTenantId : true),
  });
}

export function useFormDraft(id: string | null, draftId: string | null) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useQuery({
    queryKey: formKeys.draftDetail(id || '', draftId || '', activeTenantId),
    queryFn: () => fetchFormDraft(id!, draftId!, activeTenantId),
    enabled: !!id && !!draftId && (session?.isSuperAdmin ? !!activeTenantId : true),
  });
}

export function useFormDraftAuditLogs(id: string | null, draftId: string | null, enabled: boolean = true) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useQuery({
    queryKey: formKeys.draftAudit(id || '', draftId || '', activeTenantId),
    queryFn: () => fetchFormDraftAuditLogs(id!, draftId!, activeTenantId),
    enabled: enabled && !!id && !!draftId && (session?.isSuperAdmin ? !!activeTenantId : true),
  });
}

export function useRecentFormSubmissions(limit: number = 8) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useQuery({
    queryKey: formKeys.recentSubmissions(limit, activeTenantId),
    queryFn: () => fetchRecentFormSubmissions(limit, activeTenantId),
    enabled: session?.isSuperAdmin ? !!activeTenantId : true,
    placeholderData: (previousData) => previousData,
  });
}

export function useFormsWithWarnings(limit: number = 8) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useQuery({
    queryKey: formKeys.warnings(limit, activeTenantId),
    queryFn: () => fetchFormsWithWarnings(limit, activeTenantId),
    enabled: session?.isSuperAdmin ? !!activeTenantId : true,
    placeholderData: (previousData) => previousData,
  });
}

export function useCreateForm() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: (data: CreateFormInput) =>
      createFormRequest({
        ...data,
        tenantId: activeTenantId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: formKeys.lists() });
    },
  });
}

export function useUpdateForm(id: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: (data: UpdateFormInput & { fields?: FormFieldInput[]; reason?: string }) =>
      updateFormRequest(id, {
        ...data,
        tenantId: activeTenantId,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: formKeys.lists() });
      queryClient.setQueryData(formKeys.detail(id, activeTenantId), data);
    },
  });
}

export function useDuplicateForm() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title?: string }) => duplicateFormRequest(id, title, activeTenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: formKeys.lists() });
    },
  });
}

export function useDeleteForm() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => deleteFormRequest(id, activeTenantId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: formKeys.lists() });
      queryClient.invalidateQueries({ queryKey: formKeys.all.concat(['recent-submissions'] as never[]) });
    },
  });
}

export function useHardDeleteForm() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: ({ id }: { id: string }) => hardDeleteFormRequest(id, activeTenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: formKeys.lists() });
      queryClient.invalidateQueries({ queryKey: formKeys.recentSubmissions(8, activeTenantId) });
      queryClient.invalidateQueries({ queryKey: formKeys.warnings(8, activeTenantId) });
    },
  });
}

export function useDeleteFormResponse(id: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: ({ submissionId, reason }: { submissionId: string; reason?: string }) =>
      deleteFormResponseRequest(id, submissionId, activeTenantId, reason),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: formKeys.allResponsesForForm(id) });
      queryClient.invalidateQueries({ queryKey: formKeys.detail(id, activeTenantId) });
      queryClient.removeQueries({
        queryKey: formKeys.responseDetail(id, variables.submissionId, activeTenantId),
      });
    },
  });
}

export function useUpdateFormResponseTags(id: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: ({ submissionId, tags }: { submissionId: string; tags: string[] }) =>
      updateFormResponseTagsRequest(id, submissionId, tags, activeTenantId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: formKeys.allResponsesForForm(id) });
      queryClient.invalidateQueries({
        queryKey: formKeys.responseDetail(id, variables.submissionId, activeTenantId),
      });
    },
  });
}

export function useUpdateFormResponseReviewStatus(id: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: ({ submissionId, reviewStatus }: { submissionId: string; reviewStatus: FormResponseReviewStatus }) =>
      updateFormResponseReviewStatusRequest(id, submissionId, reviewStatus, activeTenantId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: formKeys.allResponsesForForm(id) });
      queryClient.invalidateQueries({
        queryKey: formKeys.responseDetail(id, variables.submissionId, activeTenantId),
      });
    },
  });
}

export function useDeleteFormResponseUpload(id: string, submissionId: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: ({ uploadId, reason }: { uploadId: string; reason?: string }) =>
      deleteFormResponseUploadRequest(id, submissionId, uploadId, activeTenantId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: formKeys.responseDetail(id, submissionId, activeTenantId) });
      queryClient.invalidateQueries({ queryKey: formKeys.allResponsesForForm(id) });
    },
  });
}

export function useDeleteFormDraft(id: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: ({ draftId, reason }: { draftId: string; reason?: string }) =>
      deleteFormDraftRequest(id, draftId, activeTenantId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: formKeys.allResponsesForForm(id) });
    },
  });
}

export function useGenerateFormDraftResumeLink(id: string) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: ({ draftId, reason }: { draftId: string; reason?: string }) =>
      generateFormDraftResumeLinkRequest(id, draftId, activeTenantId, reason),
  });
}

export function useExtendFormDraftExpiry(id: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: ({ draftId, expiresAt, reason }: { draftId: string; expiresAt: string; reason?: string }) =>
      extendFormDraftExpiryRequest(id, draftId, expiresAt, activeTenantId, reason),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: formKeys.allResponsesForForm(id) });
      queryClient.invalidateQueries({ queryKey: formKeys.draftDetail(id, variables.draftId, activeTenantId) });
    },
  });
}
