/**
 * Exchange Rate React Query Hooks
 *
 * Provides hooks for fetching and mutating exchange rate data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExchangeRateType } from '@/generated/prisma';

// ============================================================================
// Types
// ============================================================================

export interface ExchangeRate {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  rate: string;
  inverseRate: string | null;
  rateType: ExchangeRateType;
  rateDate: string;
  isManualOverride: boolean;
  isSystemRate: boolean;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeRateSearchParams {
  tenantId?: string;
  sourceCurrency?: string;
  startDate?: string;
  endDate?: string;
  source?: 'MAS_DAILY' | 'MAS_MONTHLY' | 'MANUAL' | 'ALL';
  includeSystem?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedRatesResponse {
  rates: ExchangeRate[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateManualRateInput {
  tenantId?: string | null;
  sourceCurrency: string;
  targetCurrency?: string;
  rate: number;
  rateDate: string;
  reason: string;
}

export interface UpdateRateInput {
  rate?: number;
  reason?: string;
}

export interface SyncResult {
  success: boolean;
  ratesCreated: number;
  ratesUpdated: number;
  errors: string[];
  syncedAt: string;
  source?: 'MAS_DAILY' | 'MAS_MONTHLY';
}

export interface SyncParams {
  source: 'MAS_DAILY' | 'MAS_MONTHLY';
  startDate?: string; // For MAS date range sync
  endDate?: string; // For MAS date range sync
  month?: string; // For MAS monthly specific month sync (e.g., "2024-11")
}

export interface TenantRatePreference {
  preferredRateType: 'MONTHLY' | 'DAILY';
}

export interface RateLookupResult {
  currency: string;
  targetCurrency: string;
  rate: string;
  inverseRate: string;
  source: 'tenant_override' | 'system' | 'fallback';
  rateDate: string;
  rateType: ExchangeRateType;
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchExchangeRates(
  params: ExchangeRateSearchParams
): Promise<PaginatedRatesResponse> {
  const searchParams = new URLSearchParams();

  if (params.tenantId) searchParams.set('tenantId', params.tenantId);
  if (params.sourceCurrency) searchParams.set('sourceCurrency', params.sourceCurrency);
  if (params.startDate) searchParams.set('startDate', params.startDate);
  if (params.endDate) searchParams.set('endDate', params.endDate);
  if (params.source) searchParams.set('source', params.source);
  if (params.includeSystem !== undefined)
    searchParams.set('includeSystem', String(params.includeSystem));
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  const response = await fetch(`/api/admin/exchange-rates?${searchParams}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch exchange rates');
  }

  return response.json();
}

async function triggerSync(params?: SyncParams): Promise<SyncResult> {
  const response = await fetch('/api/admin/exchange-rates/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || { source: 'MAS_DAILY' }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to sync exchange rates');
  }

  return response.json();
}

async function fetchTenantRatePreference(tenantId?: string): Promise<TenantRatePreference> {
  const url = tenantId
    ? `/api/admin/exchange-rates/workspace-preference?tenantId=${tenantId}`
    : '/api/admin/exchange-rates/workspace-preference';
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch rate preference');
  }

  return response.json();
}

async function updateWorkspaceRatePreference(
  preference: 'MONTHLY' | 'DAILY',
  tenantId?: string
): Promise<TenantRatePreference> {
  const response = await fetch('/api/admin/exchange-rates/workspace-preference', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferredRateType: preference, tenantId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update rate preference');
  }

  return response.json();
}

async function createManualRate(data: CreateManualRateInput): Promise<ExchangeRate> {
  const response = await fetch('/api/admin/exchange-rates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create exchange rate');
  }

  return response.json();
}

async function updateRate(id: string, data: UpdateRateInput): Promise<ExchangeRate> {
  const response = await fetch(`/api/admin/exchange-rates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update exchange rate');
  }

  return response.json();
}

async function deleteRate(id: string, reason: string): Promise<void> {
  const response = await fetch(`/api/admin/exchange-rates/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete exchange rate');
  }
}

async function lookupRate(
  currency: string,
  date: string,
  tenantId?: string
): Promise<RateLookupResult> {
  const searchParams = new URLSearchParams({
    currency,
    date,
  });
  if (tenantId) searchParams.set('tenantId', tenantId);

  const response = await fetch(`/api/admin/exchange-rates/lookup?${searchParams}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to lookup exchange rate');
  }

  return response.json();
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Fetch exchange rates with filters and pagination.
 */
export function useExchangeRates(params: ExchangeRateSearchParams = {}) {
  return useQuery({
    queryKey: ['exchange-rates', params],
    queryFn: () => fetchExchangeRates(params),
  });
}

/**
 * Look up a specific exchange rate for a currency and date.
 */
export function useRateLookup(currency: string, date: string, tenantId?: string) {
  return useQuery({
    queryKey: ['exchange-rate-lookup', currency, date, tenantId],
    queryFn: () => lookupRate(currency, date, tenantId),
    enabled: !!currency && !!date && currency !== 'SGD',
    retry: false,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Trigger manual sync from MAS.
 */
export function useSyncExchangeRates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params?: SyncParams) => triggerSync(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
  });
}

/**
 * Sync MAS daily rates (with optional date range).
 */
export function useSyncMASDaily() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { startDate?: string; endDate?: string } | void) =>
      triggerSync({ source: 'MAS_DAILY', ...((params || {}) as object) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
  });
}

/**
 * Sync MAS monthly rates (with optional specific month).
 */
export function useSyncMASMonthly() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (month: string | void) =>
      triggerSync({ source: 'MAS_MONTHLY', month: month || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
  });
}

/**
 * Get tenant's rate preference.
 * @param tenantId - Optional tenant ID (for SUPER_ADMIN using tenant selector)
 */
export function useWorkspaceRatePreference(tenantId?: string) {
  return useQuery({
    queryKey: ['tenant-rate-preference', tenantId],
    queryFn: () => fetchTenantRatePreference(tenantId),
    retry: false,
    enabled: tenantId !== undefined ? !!tenantId : true, // Only fetch if we have a tenant context
  });
}

/**
 * Update tenant's rate preference.
 * @param tenantId - Optional tenant ID (for SUPER_ADMIN using tenant selector)
 */
export function useUpdateWorkspaceRatePreference(tenantId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (preference: 'MONTHLY' | 'DAILY') =>
      updateWorkspaceRatePreference(preference, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-rate-preference', tenantId] });
    },
  });
}

/**
 * Create a manual exchange rate override.
 */
export function useCreateManualRate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createManualRate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
  });
}

/**
 * Update an existing exchange rate.
 */
export function useUpdateRate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRateInput }) => updateRate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
  });
}

/**
 * Delete an exchange rate.
 */
export function useDeleteRate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => deleteRate(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
  });
}
