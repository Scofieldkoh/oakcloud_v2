/**
 * Company Search Hook for Async Search Select
 *
 * Provides a lightweight company search with debouncing for use with AsyncSearchSelect.
 * Returns companies in a format compatible with the AsyncSearchSelectOption interface.
 *
 * @module hooks/use-company-search
 */

'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import type { AsyncSearchSelectOption } from '@/components/ui/async-search-select';

export interface CompanySearchOption extends AsyncSearchSelectOption {
  id: string;
  name: string;
  label: string;
  description: string;
  uen: string | null;
  status?: string | null;
  registeredAddress?: string | null;
  incorporationDate?: string | null;
  primarySsicDescription?: string | null;
  homeCurrency?: string | null;
}

/**
 * Builds a picker option for a company the caller already knows, such as the
 * current selection, so `CompanySelect` can show it via `pinned` before any
 * search returns it.
 */
export function toCompanySearchOption(company: { id: string; name: string; uen?: string | null }): CompanySearchOption {
  return { id: company.id, name: company.name, label: company.name, description: company.uen ?? '', uen: company.uen ?? null };
}

interface CompanySearchResult {
  options: Array<{
    id: string;
    name: string;
    uen: string | null;
    status?: string | null;
    registeredAddress?: string | null;
    incorporationDate?: string | null;
    primarySsicDescription?: string | null;
    homeCurrency?: string | null;
  }>;
  hasMore?: boolean;
  page?: number;
}

interface UseCompanySearchOptions {
  /** Whether the search query is allowed to run */
  enabled?: boolean;
  /** Minimum characters before search triggers */
  minChars?: number;
  /** Maximum results to return */
  limit?: number;
  /** Debounce delay in ms */
  debounceMs?: number;
  /** Filter out specific company IDs (e.g., companies already linked) */
  excludeIds?: string[];
  /** Always-visible options prepended to the result page (e.g. current selection). */
  pinned?: CompanySearchOption[];
  /** Enable server-side paging (adds `page` to the request and returns paging state) */
  paginated?: boolean;
}

/**
 * Hook for searching companies with debounced input
 *
 * @example
 * ```tsx
 * const {
 *   searchQuery,
 *   setSearchQuery,
 *   options,
 *   isLoading,
 *   selectedCompany,
 *   setSelectedCompany,
 * } = useCompanySearch({ excludeIds: existingCompanyIds });
 *
 * return (
 *   <AsyncSearchSelect
 *     value={selectedCompany?.id ?? ''}
 *     onChange={(id, item) => setSelectedCompany(item)}
 *     options={options}
 *     isLoading={isLoading}
 *     searchQuery={searchQuery}
 *     onSearchChange={setSearchQuery}
 *   />
 * );
 * ```
 */
export function useCompanySearch(options: UseCompanySearchOptions = {}) {
  const {
    enabled = true,
    minChars = 2,
    limit = 10,
    debounceMs = 300,
    excludeIds = [],
    pinned,
    paginated = false,
  } = options;

  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<CompanySearchOption | null>(null);
  const [page, setPage] = useState(0);

  const knownRef = useRef<Map<string, CompanySearchOption>>(new Map());
  const [knownVersion, setKnownVersion] = useState(0);

  const remember = useCallback((options: CompanySearchOption[]) => {
    let changed = false;
    for (const option of options) {
      if (!knownRef.current.has(option.id)) changed = true;
      knownRef.current.set(option.id, option);
    }
    if (changed) setKnownVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
      if (paginated) {
        setPage(0);
      }
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [searchQuery, debounceMs, paginated]);

  // Only search if query meets minimum length
  const shouldSearch = debouncedSearchQuery.length >= minChars;

  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ['company-search', debouncedSearchQuery, activeTenantId, limit, paginated ? page : undefined],
    queryFn: async (): Promise<CompanySearchResult> => {
      const params = new URLSearchParams({
        q: debouncedSearchQuery,
        limit: String(limit),
      });
      if (paginated) {
        params.set('page', String(page));
      }
      if (activeTenantId) {
        params.set('tenantId', activeTenantId);
      }

      const response = await fetch(`/api/companies/options?${params}`);
      if (!response.ok) {
        throw new Error('Failed to search companies');
      }
      return response.json();
    },
    enabled: enabled && shouldSearch,
    staleTime: 30 * 1000, // 30 seconds
    placeholderData: (previousData) => previousData,
  });

  // Transform to AsyncSearchSelectOption format and filter out excluded IDs
  const companyOptions: CompanySearchOption[] = useMemo(() => {
    const mapped: CompanySearchOption[] = (data?.options ?? []).map((company) => ({
      id: company.id,
      name: company.name,
      label: company.name,
      description: company.uen || company.primarySsicDescription || '',
      uen: company.uen,
      status: company.status,
      registeredAddress: company.registeredAddress,
      incorporationDate: company.incorporationDate,
      primarySsicDescription: company.primarySsicDescription,
      homeCurrency: company.homeCurrency,
    }));
    remember(mapped);
    remember(pinned ?? []);

    const excludeSet = new Set(excludeIds);
    const byId = new Map<string, CompanySearchOption>();
    for (const option of pinned ?? []) {
      if (!excludeSet.has(option.id)) byId.set(option.id, option);
    }
    for (const option of mapped) {
      if (!excludeSet.has(option.id) && !byId.has(option.id)) byId.set(option.id, option);
    }
    return [...byId.values()];
  }, [data?.options, excludeIds, pinned, remember]);

  const known = useMemo(
    () => new Map(knownRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [knownVersion],
  );

  // Clear selection handler
  const clearSelection = useCallback(() => {
    setSelectedCompany(null);
    setSearchQuery('');
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    options: companyOptions,
    isLoading: shouldSearch && isLoading,
    selectedCompany,
    setSelectedCompany,
    clearSelection,
    page,
    setPage,
    hasMore: Boolean(data?.hasMore),
    hasPreviousPage: page > 0,
    known,
    error: queryError instanceof Error ? queryError.message : null,
    retry: refetch,
  };
}

/**
 * Hook to get companies linked to a contact (for exclusion or display)
 */
export function useContactLinkedCompanies(contactId: string | null) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useQuery({
    queryKey: ['contact-linked-companies', contactId, activeTenantId],
    queryFn: async (): Promise<Array<{ id: string; name: string; uen: string }>> => {
      const url = activeTenantId
        ? `/api/contacts/${contactId}/companies?tenantId=${activeTenantId}`
        : `/api/contacts/${contactId}/companies`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch linked companies');
      }
      return response.json();
    },
    enabled: !!contactId,
  });
}

/**
 * Prefetch company data for quick access
 */
export function usePrefetchCompanySearch() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useCallback(
    (query: string, limit: number = 10) => {
      if (query.length < 2) return;

      queryClient.prefetchQuery({
        queryKey: ['company-search', query, activeTenantId, limit],
        queryFn: async () => {
          const params = new URLSearchParams({
            q: query,
            limit: String(limit),
          });
          if (activeTenantId) {
            params.set('tenantId', activeTenantId);
          }

          const response = await fetch(`/api/companies/options?${params}`);
          if (!response.ok) {
            throw new Error('Failed to search companies');
          }
          return response.json();
        },
        staleTime: 30 * 1000,
      });
    },
    [queryClient, activeTenantId]
  );
}
