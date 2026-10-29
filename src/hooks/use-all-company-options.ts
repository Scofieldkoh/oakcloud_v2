'use client';

import { useQuery } from '@tanstack/react-query';

export interface CompanyOption {
  id: string;
  name: string;
  uen?: string | null;
  primarySsicDescription?: string | null;
  homeCurrency?: string | null;
}

interface CompanyOptionsResponse {
  options: CompanyOption[];
  hasMore?: boolean;
  page?: number;
}

interface UseAllCompanyOptionsOptions {
  enabled?: boolean;
}

export interface CompanyOptionsPage {
  options: CompanyOption[];
  hasMore: boolean;
  page: number;
}

export interface CompanyOptionsPageOptions extends UseAllCompanyOptionsOptions {
  query?: string;
  page?: number;
  limit?: number;
}

/**
 * Compatibility hook for older imports.
 *
 * This intentionally uses the capped `/api/companies/options` endpoint instead
 * of paginating through the full `/api/companies` list.
 */
export function useAllCompanyOptions(
  tenantId?: string | null,
  options: UseAllCompanyOptionsOptions = {}
) {
  return useQuery({
    queryKey: ['company-options', tenantId ?? null, 'compat'],
    queryFn: async ({ signal }): Promise<CompanyOption[]> => {
      const params = new URLSearchParams({ limit: '50' });

      if (tenantId) {
        params.set('tenantId', tenantId);
      }

      const response = await fetch(`/api/companies/options?${params.toString()}`, { signal });

      if (!response.ok) {
        throw new Error('Failed to fetch company options');
      }

      const payload = await response.json() as CompanyOptionsResponse;
      return payload.options;
    },
    enabled: options.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

export function useCompanyOptionsPage(
  tenantId?: string | null,
  options: CompanyOptionsPageOptions = {},
) {
  const query = options.query?.trim() ?? '';
  const page = Number.isSafeInteger(options.page) && (options.page ?? 0) >= 0 ? options.page ?? 0 : 0;
  const limit = Number.isSafeInteger(options.limit) && (options.limit ?? 20) >= 1
    ? Math.min(options.limit ?? 20, 50)
    : 20;

  return useQuery<CompanyOptionsPage>({
    queryKey: ['company-options', tenantId ?? null, query, page, limit],
    queryFn: async ({ signal }): Promise<CompanyOptionsPage> => {
      const params = new URLSearchParams({ limit: String(limit), page: String(page) });
      if (query) params.set('q', query);
      if (tenantId) params.set('tenantId', tenantId);

      const response = await fetch(`/api/companies/options?${params.toString()}`, { signal });
      const payload = await response.json().catch(() => ({})) as CompanyOptionsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to fetch company options');
      return {
        options: payload.options ?? [],
        hasMore: payload.hasMore === true,
        page: Number.isSafeInteger(payload.page) ? payload.page! : page,
      };
    },
    enabled: options.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}
