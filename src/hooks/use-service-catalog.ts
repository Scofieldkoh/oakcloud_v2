'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateServiceFamilyInput,
  CreateServiceVariantInput,
  UpdateServiceFamilyInput,
  UpdateServiceVariantInput,
} from '@/lib/validations/service-catalog';
import type {
  ServiceCatalogDto,
  ServiceFamilyDto,
  ServiceVariantDto,
} from '@/services/service-catalog/types';

export interface ServiceCatalogFilters {
  query?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export const serviceCatalogKeys = {
  list: (workspaceId: string | undefined, filters: ServiceCatalogFilters) =>
    ['service-catalog', workspaceId, filters] as const,
  selectable: (workspaceId: string | undefined) =>
    ['service-catalog-selectable', workspaceId] as const,
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    const message =
      typeof body.error === 'string'
        ? body.error
        : body.error?.message ?? 'Service catalog request failed';
    throw new Error(message);
  }
  return body as T;
}

async function fetchServiceCatalog(
  workspaceId: string,
  filters: ServiceCatalogFilters,
): Promise<ServiceCatalogDto> {
  const params = new URLSearchParams({ tenantId: workspaceId });
  if (filters.query) params.set('query', filters.query);
  if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive));
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  return parseResponse(
    await fetch(`/api/service-catalog?${params.toString()}`),
  );
}

export function useServiceCatalog(
  workspaceId: string | undefined,
  filters: ServiceCatalogFilters,
  enabled = true,
) {
  return useQuery({
    queryKey: serviceCatalogKeys.list(workspaceId, filters),
    queryFn: () => fetchServiceCatalog(workspaceId!, filters),
    enabled: Boolean(workspaceId && enabled),
  });
}

export function useSelectableServiceVariants(workspaceId: string | undefined) {
  return useQuery({
    queryKey: serviceCatalogKeys.selectable(workspaceId),
    queryFn: async () => {
      const result = await parseResponse<{ variants: ServiceVariantDto[] }>(
        await fetch('/api/service-catalog?selectable=true'),
      );
      return result.variants;
    },
    enabled: Boolean(workspaceId),
  });
}

function useCatalogInvalidation(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['service-catalog', workspaceId],
      }),
      queryClient.invalidateQueries({
        queryKey: serviceCatalogKeys.selectable(workspaceId),
      }),
      // Client-facing service options include variant deadline-rule
      // associations and must not retain a pre-edit association set.
      queryClient.invalidateQueries({
        queryKey: ['client-service-catalog-options'],
      }),
    ]);
  };
}

export function useCreateServiceFamily(workspaceId: string | undefined) {
  const invalidate = useCatalogInvalidation(workspaceId);
  return useMutation({
    mutationFn: async (input: CreateServiceFamilyInput) =>
      parseResponse<ServiceFamilyDto>(
        await fetch('/api/service-catalog/families', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...input,
            displayColor: input.displayColor.trim().toUpperCase(),
            tenantId: workspaceId,
          }),
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useUpdateServiceFamily(workspaceId: string | undefined) {
  const invalidate = useCatalogInvalidation(workspaceId);
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: UpdateServiceFamilyInput;
    }) =>
      parseResponse<ServiceFamilyDto>(
        await fetch(`/api/service-catalog/families/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...input,
            ...(input.displayColor === undefined
              ? {}
              : { displayColor: input.displayColor.trim().toUpperCase() }),
            tenantId: workspaceId,
          }),
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useArchiveServiceFamily(workspaceId: string | undefined) {
  const invalidate = useCatalogInvalidation(workspaceId);
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const params = new URLSearchParams({ reason });
      if (workspaceId) params.set('tenantId', workspaceId);
      return parseResponse<{ id: string; archived: true }>(
        await fetch(`/api/service-catalog/families/${id}?${params}`, {
          method: 'DELETE',
        }),
      );
    },
    onSuccess: invalidate,
  });
}

export function useCreateServiceVariant(workspaceId: string | undefined) {
  const invalidate = useCatalogInvalidation(workspaceId);
  return useMutation({
    mutationFn: async (input: CreateServiceVariantInput) =>
      parseResponse<ServiceVariantDto>(
        await fetch('/api/service-catalog/variants', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, tenantId: workspaceId }),
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useUpdateServiceVariant(workspaceId: string | undefined) {
  const invalidate = useCatalogInvalidation(workspaceId);
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: UpdateServiceVariantInput;
    }) =>
      parseResponse<ServiceVariantDto>(
        await fetch(`/api/service-catalog/variants/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, tenantId: workspaceId }),
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useArchiveServiceVariant(workspaceId: string | undefined) {
  const invalidate = useCatalogInvalidation(workspaceId);
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const params = new URLSearchParams({ reason });
      if (workspaceId) params.set('tenantId', workspaceId);
      return parseResponse<{ id: string; archived: true }>(
        await fetch(`/api/service-catalog/variants/${id}?${params}`, {
          method: 'DELETE',
        }),
      );
    },
    onSuccess: invalidate,
  });
}
