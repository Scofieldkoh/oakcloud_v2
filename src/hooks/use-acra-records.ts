'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface AcraRecord {
  id: string;
  uen: string;
  entityName: string;
  entityStatus: string;
  entityType: string;
  companyTypeDescription: string | null;
  registrationIncorporateDate: string | null;
  block: string | null;
  streetName: string | null;
  levelNo: string | null;
  unitNo: string | null;
  buildingName: string | null;
  postalCode: string | null;
  address: string | null;
  accountDueDate: string | null;
  annualReturnDate: string | null;
  primarySsicCode: string | null;
  primarySsicDescription: string | null;
  secondarySsicCode: string | null;
  secondarySsicDescription: string | null;
  noOfOfficers: string | null;
  formerEntityName1: string | null;
  uenOfAuditFirm1: string | null;
  dataAsOf: string;
  createdAt: string;
  updatedAt: string;
}

export interface AcraSyncSummary {
  collectionLastUpdatedAt: string | null;
  entityCount: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
}

export interface AcraRecordsResponse {
  records: AcraRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  syncState: AcraSyncSummary | null;
}

export interface AcraRecordsParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  /** Free-text inline filters keyed by field name (contains, case-insensitive). */
  filters?: Record<string, string>;
  /** Date range inline filters keyed by field name (YYYY-MM-DD bounds). */
  dateRanges?: Record<string, { from?: string; to?: string }>;
}

export function buildAcraRecordsSearchParams(params: AcraRecordsParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);
  if (params.search) searchParams.set('search', params.search);

  for (const [field, value] of Object.entries(params.filters ?? {})) {
    if (value) searchParams.set(field, value);
  }
  for (const [field, range] of Object.entries(params.dateRanges ?? {})) {
    if (range.from) searchParams.set(`${field}From`, range.from);
    if (range.to) searchParams.set(`${field}To`, range.to);
  }

  return searchParams;
}

/** Whether a sync run appears to be in progress. */
export function isAcraSyncing(syncState: AcraSyncSummary | null | undefined): boolean {
  if (!syncState?.lastStartedAt) return false;
  if (!syncState.lastCompletedAt) return true;
  return new Date(syncState.lastStartedAt) > new Date(syncState.lastCompletedAt);
}

export function useAcraRecords(params: AcraRecordsParams) {
  return useQuery<AcraRecordsResponse>({
    queryKey: ['acra-records', params],
    placeholderData: (previousData) => previousData,
    // While a sync is running, poll so the UI reflects progress and results.
    refetchInterval: (query) => (isAcraSyncing(query.state.data?.syncState) ? 15_000 : false),
    queryFn: async () => {
      const searchParams = buildAcraRecordsSearchParams(params);

      const res = await fetch(`/api/admin/acra-records?${searchParams}`);
      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.error || 'Failed to fetch ACRA records');
      }
      return res.json();
    },
  });
}

export function useTriggerAcraSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/acra-records/sync', {
        method: 'POST',
      });

      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(error?.error || 'Failed to start the ACRA sync');
      }

      return res.json() as Promise<{ message: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acra-records'] });
    },
  });
}
