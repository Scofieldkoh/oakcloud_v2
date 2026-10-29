'use client';

import { useQuery } from '@tanstack/react-query';
import type { ServiceRosterFamily } from '@/services/service-roster';

interface ServiceRosterFamiliesResponse {
  families: ServiceRosterFamily[];
}

export const serviceRosterFamilyKeys = {
  all: ['service-roster-families'] as const,
};

export function useServiceRosterFamilies(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: serviceRosterFamilyKeys.all,
    queryFn: async ({ signal }): Promise<ServiceRosterFamily[]> => {
      const response = await fetch('/api/client-services/families', { signal });
      const body = await response.json().catch(() => ({})) as Partial<ServiceRosterFamiliesResponse> & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Failed to fetch service families');
      return Array.isArray(body.families) ? body.families : [];
    },
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}
