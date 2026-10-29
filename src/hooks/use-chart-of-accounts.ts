/**
 * Chart of Accounts React Query Hooks
 *
 * Provides hooks for fetching and mutating chart of accounts data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AccountType, AccountStatus, AccountingProvider } from '@/generated/prisma';

// ============================================================================
// Types
// ============================================================================

export interface ChartOfAccount {
  id: string;
  tenantId: string | null;
  companyId: string | null;
  code: string;
  name: string;
  description: string | null;
  accountType: AccountType;
  status: AccountStatus;
  parentId: string | null;
  sortOrder: number;
  isSystem: boolean;
  isTaxApplicable: boolean;
  isHeader: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  parent?: {
    id: string;
    code: string;
    name: string;
  } | null;
  _count?: {
    children: number;
  };
}

export interface AccountHierarchyNode extends ChartOfAccount {
  children: AccountHierarchyNode[];
}

export interface AccountSelectOption {
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  fullPath: string;
}

export interface AccountMapping {
  id: string;
  accountId: string;
  companyId: string;
  provider: AccountingProvider;
  externalCode: string | null;
  externalId: string | null;
  externalName: string | null;
  lastSyncedAt: string | null;
  syncStatus: string | null;
  createdAt: string;
  updatedAt: string;
  account?: {
    id: string;
    code: string;
    name: string;
    accountType: AccountType;
  };
}

export interface AccountSearchParams {
  search?: string;
  accountType?: AccountType;
  status?: AccountStatus;
  tenantId?: string | null;
  companyId?: string | null;
  includeSystem?: boolean;
  parentId?: string | null;
  topLevelOnly?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'code' | 'name' | 'accountType' | 'sortOrder' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface AccountHierarchyParams {
  tenantId?: string | null;
  companyId?: string | null;
  includeSystem?: boolean;
  accountType?: AccountType;
  status?: AccountStatus;
}

export interface AccountSelectParams {
  tenantId?: string | null;
  companyId?: string | null;
  accountType?: AccountType;
  headersOnly?: boolean;
}

export interface PaginatedAccountsResponse {
  accounts: ChartOfAccount[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateAccountInput {
  code: string;
  name: string;
  description?: string | null;
  accountType: AccountType;
  parentId?: string | null;
  sortOrder?: number;
  isTaxApplicable?: boolean;
  isHeader?: boolean;
  tenantId?: string | null;
  companyId?: string | null;
}

export interface UpdateAccountInput {
  code?: string;
  name?: string;
  description?: string | null;
  accountType?: AccountType;
  status?: AccountStatus;
  parentId?: string | null;
  sortOrder?: number;
  isTaxApplicable?: boolean;
  isHeader?: boolean;
}

export interface BulkMappingInput {
  provider: AccountingProvider;
  mappings: Array<{
    accountId: string;
    externalCode?: string | null;
    externalId?: string | null;
    externalName?: string | null;
  }>;
}

export interface UpdateMappingInput {
  externalCode?: string | null;
  externalId?: string | null;
  externalName?: string | null;
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchAccounts(params: AccountSearchParams): Promise<PaginatedAccountsResponse> {
  const searchParams = new URLSearchParams();

  if (params.search) searchParams.set('search', params.search);
  if (params.accountType) searchParams.set('accountType', params.accountType);
  if (params.status) searchParams.set('status', params.status);
  if (params.tenantId) searchParams.set('tenantId', params.tenantId);
  if (params.companyId) searchParams.set('companyId', params.companyId);
  if (params.includeSystem !== undefined) searchParams.set('includeSystem', String(params.includeSystem));
  if (params.parentId) searchParams.set('parentId', params.parentId);
  if (params.topLevelOnly !== undefined) searchParams.set('topLevelOnly', String(params.topLevelOnly));
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  const response = await fetch(`/api/chart-of-accounts?${searchParams}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch chart of accounts');
  }

  return response.json();
}

async function fetchAccountById(id: string): Promise<ChartOfAccount> {
  const response = await fetch(`/api/chart-of-accounts/${id}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch account');
  }

  return response.json();
}

async function fetchAccountHierarchy(params: AccountHierarchyParams): Promise<AccountHierarchyNode[]> {
  const searchParams = new URLSearchParams();

  if (params.tenantId) searchParams.set('tenantId', params.tenantId);
  if (params.companyId) searchParams.set('companyId', params.companyId);
  if (params.includeSystem !== undefined) searchParams.set('includeSystem', String(params.includeSystem));
  if (params.accountType) searchParams.set('accountType', params.accountType);
  if (params.status) searchParams.set('status', params.status);

  const response = await fetch(`/api/chart-of-accounts/hierarchy?${searchParams}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch account hierarchy');
  }

  return response.json();
}

async function fetchAccountsForSelect(params: AccountSelectParams): Promise<AccountSelectOption[]> {
  const searchParams = new URLSearchParams();

  if (params.tenantId) searchParams.set('tenantId', params.tenantId);
  if (params.companyId) searchParams.set('companyId', params.companyId);
  if (params.accountType) searchParams.set('accountType', params.accountType);
  if (params.headersOnly) searchParams.set('headersOnly', 'true');

  const response = await fetch(`/api/chart-of-accounts/select?${searchParams}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch accounts for select');
  }

  return response.json();
}

async function createAccount(data: CreateAccountInput): Promise<ChartOfAccount> {
  const response = await fetch('/api/chart-of-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create account');
  }

  return response.json();
}

async function updateAccount(id: string, data: UpdateAccountInput): Promise<ChartOfAccount> {
  const response = await fetch(`/api/chart-of-accounts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update account');
  }

  return response.json();
}

async function deleteAccount(id: string, reason: string): Promise<void> {
  const response = await fetch(`/api/chart-of-accounts/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete account');
  }
}

async function fetchCompanyMappings(
  companyId: string,
  provider?: AccountingProvider
): Promise<AccountMapping[]> {
  const searchParams = new URLSearchParams();
  if (provider) searchParams.set('provider', provider);

  const url = `/api/companies/${companyId}/account-mappings${searchParams.toString() ? `?${searchParams}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch company account mappings');
  }

  return response.json();
}

async function bulkUpsertMappings(
  companyId: string,
  data: BulkMappingInput
): Promise<{ success: boolean; count: number; mappings: AccountMapping[] }> {
  const response = await fetch(`/api/companies/${companyId}/account-mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update account mappings');
  }

  return response.json();
}

async function updateMapping(
  companyId: string,
  mappingId: string,
  data: UpdateMappingInput
): Promise<AccountMapping> {
  const response = await fetch(`/api/companies/${companyId}/account-mappings/${mappingId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update mapping');
  }

  return response.json();
}

async function deleteMapping(companyId: string, mappingId: string): Promise<void> {
  const response = await fetch(`/api/companies/${companyId}/account-mappings/${mappingId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete mapping');
  }
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Fetch chart of accounts with filters and pagination.
 */
export function useChartOfAccounts(params: AccountSearchParams = {}) {
  return useQuery({
    queryKey: ['chart-of-accounts', params],
    queryFn: () => fetchAccounts(params),
  });
}

/**
 * Fetch a single account by ID.
 */
export function useAccount(id: string | undefined) {
  return useQuery({
    queryKey: ['chart-of-accounts', 'detail', id],
    queryFn: () => fetchAccountById(id!),
    enabled: !!id,
  });
}

/**
 * Fetch account hierarchy (tree structure).
 */
export function useAccountHierarchy(params: AccountHierarchyParams = {}) {
  return useQuery({
    queryKey: ['chart-of-accounts', 'hierarchy', params],
    queryFn: () => fetchAccountHierarchy(params),
  });
}

/**
 * Fetch accounts for select dropdown (simplified list).
 */
export function useAccountsForSelect(params: AccountSelectParams = {}, enabled: boolean = true) {
  return useQuery({
    queryKey: ['chart-of-accounts', 'select', params],
    queryFn: () => fetchAccountsForSelect(params),
    enabled,
  });
}

/**
 * Fetch company account mappings.
 */
export function useCompanyAccountMappings(companyId: string | undefined, provider?: AccountingProvider) {
  return useQuery({
    queryKey: ['company-account-mappings', companyId, provider],
    queryFn: () => fetchCompanyMappings(companyId!, provider),
    enabled: !!companyId,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Create a new account.
 */
export function useCreateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
  });
}

/**
 * Update an existing account.
 */
export function useUpdateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAccountInput }) => updateAccount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
  });
}

/**
 * Delete an account (soft delete).
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => deleteAccount(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
  });
}

/**
 * Bulk upsert company account mappings.
 */
export function useBulkUpsertMappings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ companyId, data }: { companyId: string; data: BulkMappingInput }) =>
      bulkUpsertMappings(companyId, data),
    onSuccess: (_, { companyId }) => {
      queryClient.invalidateQueries({ queryKey: ['company-account-mappings', companyId] });
    },
  });
}

/**
 * Update a single account mapping.
 */
export function useUpdateMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      companyId,
      mappingId,
      data,
    }: {
      companyId: string;
      mappingId: string;
      data: UpdateMappingInput;
    }) => updateMapping(companyId, mappingId, data),
    onSuccess: (_, { companyId }) => {
      queryClient.invalidateQueries({ queryKey: ['company-account-mappings', companyId] });
    },
  });
}

/**
 * Delete an account mapping.
 */
export function useDeleteMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ companyId, mappingId }: { companyId: string; mappingId: string }) =>
      deleteMapping(companyId, mappingId),
    onSuccess: (_, { companyId }) => {
      queryClient.invalidateQueries({ queryKey: ['company-account-mappings', companyId] });
    },
  });
}
