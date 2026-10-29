'use client';

import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TemplatePartial } from '@/generated/prisma';
import type {
  UpdateTemplatePartialInput,
  SearchTemplatePartialsInput,
  TemplatePartialCategoryValue,
} from '@/lib/validations/template-partial';

// ============================================================================
// Types
// ============================================================================

export interface TemplatePartialWithRelations extends TemplatePartial {
  createdBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
  _count?: {
    usedInTemplates: number;
  };
}

export interface SearchPartialsResult {
  partials: TemplatePartialWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PartialUsageInfo {
  templateId: string;
  templateName: string;
  category: string;
}

export interface PartialUsageResult {
  partialId: string;
  usageCount: number;
  serviceVariantCount: number;
  templates: PartialUsageInfo[];
  serviceVariants: Array<{
    id: string;
    name: string;
    isActive: boolean;
  }>;
}

// ============================================================================
// Query Keys
// ============================================================================

export const partialKeys = {
  all: ['template-partials'] as const,
  lists: () => [...partialKeys.all, 'list'] as const,
  list: (params: SearchTemplatePartialsInput) => [...partialKeys.lists(), params] as const,
  allList: () => [...partialKeys.all, 'all'] as const,
  details: () => [...partialKeys.all, 'detail'] as const,
  detail: (id: string) => [...partialKeys.details(), id] as const,
  usage: (id: string) => [...partialKeys.all, 'usage', id] as const,
};

// ============================================================================
// API Functions
// ============================================================================

async function fetchPartials(
  params: SearchTemplatePartialsInput,
  tenantId?: string
): Promise<SearchPartialsResult> {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set('search', params.search);
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);
  if (params.editor) searchParams.set('editor', params.editor);
  if (params.category) searchParams.set('category', params.category);
  if (params.name) searchParams.set('name', params.name);
  if (params.reference) searchParams.set('reference', params.reference);
  if (params.description) searchParams.set('description', params.description);
  if (params.usage) searchParams.set('usage', params.usage);
  if (params.createdBy) searchParams.set('createdBy', params.createdBy);
  if (params.updatedFrom) searchParams.set('updatedFrom', params.updatedFrom);
  if (params.updatedTo) searchParams.set('updatedTo', params.updatedTo);
  if (tenantId) searchParams.set('tenantId', tenantId);

  const response = await fetch(`/api/template-partials?${searchParams}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch partials');
  }
  return response.json();
}

export type TemplatePartialSummary =
  Pick<TemplatePartial, 'id' | 'name' | 'displayName' | 'header' | 'description' | 'placeholders' | 'version' | 'category'>
  & { documentEngine: 'A4' | 'OAKDOC'; fieldTags?: string[] };

async function fetchAllPartials(tenantId?: string): Promise<{ partials: TemplatePartialSummary[] }> {
  const searchParams = new URLSearchParams({ all: 'true' });
  if (tenantId) searchParams.set('tenantId', tenantId);
  const response = await fetch(`/api/template-partials?${searchParams}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch partials');
  }
  return response.json();
}

async function fetchPartial(id: string, tenantId?: string): Promise<TemplatePartialWithRelations> {
  const searchParams = new URLSearchParams({ includeUsage: 'true' });
  if (tenantId) searchParams.set('tenantId', tenantId);
  const response = await fetch(`/api/template-partials/${id}?${searchParams}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch partial');
  }
  return response.json();
}

async function fetchPartialUsage(id: string, tenantId?: string): Promise<PartialUsageResult> {
  const searchParams = new URLSearchParams();
  if (tenantId) searchParams.set('tenantId', tenantId);
  const queryStr = searchParams.toString();
  const response = await fetch(`/api/template-partials/${id}/usage${queryStr ? `?${queryStr}` : ''}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch partial usage');
  }
  return response.json();
}

export interface WordPartialInput {
  /** Existing partial to replace with a new version; omit to create one. */
  id?: string;
  expectedRevision?: number;
  name?: string;
  displayName?: string;
  header?: string;
  description?: string;
  category?: TemplatePartialCategoryValue;
  file: File;
  /** Stored placeholders (custom fields) to save with a new version. */
  placeholders?: unknown[];
}

export async function saveWordPartial(input: WordPartialInput): Promise<TemplatePartial> {
  const form = new FormData();
  form.set('file', input.file);
  if (input.placeholders) form.set('placeholders', JSON.stringify(input.placeholders));
  if (input.id) {
    form.set('expectedRevision', String(input.expectedRevision ?? ''));
  } else {
    form.set('name', input.name ?? '');
    if (input.displayName) form.set('displayName', input.displayName);
    if (input.header) form.set('header', input.header);
    if (input.description) form.set('description', input.description);
    if (input.category) form.set('category', input.category);
  }
  const response = await fetch(
    input.id ? `/api/template-partials/${input.id}/oakdoc` : '/api/template-partials/oakdoc',
    { method: input.id ? 'PUT' : 'POST', body: form },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to save the Word partial');
  }
  return response.json();
}

async function updatePartial(
  data: UpdateTemplatePartialInput & { reason?: string; tenantId?: string }
): Promise<TemplatePartial> {
  const { id, reason, tenantId, ...updates } = data;
  const response = await fetch(`/api/template-partials/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...updates, reason, tenantId }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update partial');
  }
  return response.json();
}

async function deletePartial(id: string, reason?: string, tenantId?: string): Promise<void> {
  const searchParams = new URLSearchParams();
  if (reason) searchParams.set('reason', reason);
  if (tenantId) searchParams.set('tenantId', tenantId);
  const queryStr = searchParams.toString();
  const response = await fetch(`/api/template-partials/${id}${queryStr ? `?${queryStr}` : ''}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete partial');
  }
}

async function duplicatePartial(id: string, name: string, tenantId?: string): Promise<TemplatePartial> {
  const response = await fetch(`/api/template-partials/${id}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, tenantId }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to duplicate partial');
  }
  return response.json();
}

// ============================================================================
// Hooks
// ============================================================================

export interface UseTemplatePartialsOptions extends Partial<SearchTemplatePartialsInput> {
  tenantId?: string;
}

export function useTemplatePartials(options: UseTemplatePartialsOptions = {}) {
  const { tenantId, ...params } = options;
  const fullParams: SearchTemplatePartialsInput = {
    page: params.page ?? 1,
    limit: params.limit ?? 20,
    sortBy: params.sortBy ?? 'name',
    sortOrder: params.sortOrder ?? 'asc',
    search: params.search,
    editor: params.editor,
    category: params.category,
    name: params.name,
    reference: params.reference,
    description: params.description,
    usage: params.usage,
    createdBy: params.createdBy,
    updatedFrom: params.updatedFrom,
    updatedTo: params.updatedTo,
  };

  return useQuery({
    queryKey: [...partialKeys.list(fullParams), tenantId],
    queryFn: () => fetchPartials(fullParams, tenantId),
    enabled: tenantId !== undefined ? !!tenantId : true,
    // Keep the current rows on screen while a filter, sort or page change loads.
    placeholderData: keepPreviousData,
  });
}

export function useAllTemplatePartials(tenantId?: string, enabled = true) {
  return useQuery({
    queryKey: [...partialKeys.allList(), tenantId],
    queryFn: () => fetchAllPartials(tenantId),
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: enabled && (tenantId !== undefined ? !!tenantId : true),
  });
}

export interface PartialTextResult {
  text: string;
  revision: number;
}

export async function fetchPartialText(id: string): Promise<PartialTextResult> {
  const response = await fetch(`/api/template-partials/${encodeURIComponent(id)}/text`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to load the partial text');
  }
  return response.json();
}

/** A Word partial's current wording as plain text, loaded on demand. */
export function usePartialText(id: string | null, enabled = true) {
  return useQuery({
    queryKey: [...partialKeys.detail(id || ''), 'text'],
    queryFn: () => fetchPartialText(id!),
    // Refetch when the user comes back from editing the partial in another tab.
    staleTime: 0,
    enabled: enabled && !!id,
  });
}

export function useTemplatePartial(id: string | null, tenantId?: string) {
  return useQuery({
    queryKey: [...partialKeys.detail(id || ''), tenantId],
    queryFn: () => fetchPartial(id!, tenantId),
    enabled: !!id && (tenantId !== undefined ? !!tenantId : true),
  });
}

export function usePartialUsage(id: string | null, tenantId?: string) {
  return useQuery({
    queryKey: [...partialKeys.usage(id || ''), tenantId],
    queryFn: () => fetchPartialUsage(id!, tenantId),
    enabled: !!id && (tenantId !== undefined ? !!tenantId : true),
  });
}

/** Create a Word partial, or upload a new version of one. */
export function useSaveWordPartial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveWordPartial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: partialKeys.all });
    },
  });
}

export function useUpdatePartial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updatePartial,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: partialKeys.all });
      queryClient.setQueryData(partialKeys.detail(data.id), data);
    },
  });
}

export function useDeletePartial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason, tenantId }: { id: string; reason?: string; tenantId?: string }) =>
      deletePartial(id, reason, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: partialKeys.all });
    },
  });
}

export function useDuplicatePartial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name, tenantId }: { id: string; name: string; tenantId?: string }) =>
      duplicatePartial(id, name, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: partialKeys.all });
    },
  });
}
