/**
 * Connector hooks for TanStack Query
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ============================================================================
// Types
// ============================================================================

export interface Connector {
  id: string;
  workspaceId: string | null;
  name: string;
  type: 'AI_PROVIDER' | 'STORAGE';
  provider:
    | 'OPENAI'
    | 'ANTHROPIC'
    | 'GOOGLE'
    | 'OPENROUTER'
    | 'MISTRAL'
    | 'ONEDRIVE'
    | 'SHAREPOINT';
  credentials: Record<string, unknown>;
  credentialsMasked?: boolean;
  settings: Record<string, unknown> | null;
  isEnabled: boolean;
  isDefault: boolean;
  callCount: number;
  lastUsedAt: string | null;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorsResponse {
  connectors: Connector[];
  total: number;
  page: number;
  limit: number;
}

export interface ConnectorSearchParams {
  tenantId?: string;
  type?: 'AI_PROVIDER' | 'STORAGE';
  provider?:
    | 'OPENAI'
    | 'ANTHROPIC'
    | 'GOOGLE'
    | 'OPENROUTER'
    | 'MISTRAL'
    | 'ONEDRIVE'
    | 'SHAREPOINT';
  isEnabled?: boolean;
  includeSystem?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateConnectorData {
  tenantId?: string | null;
  name: string;
  type: 'AI_PROVIDER' | 'STORAGE';
  provider:
    | 'OPENAI'
    | 'ANTHROPIC'
    | 'GOOGLE'
    | 'OPENROUTER'
    | 'MISTRAL'
    | 'ONEDRIVE'
    | 'SHAREPOINT';
  credentials: Record<string, unknown>;
  settings?: Record<string, unknown> | null;
  isEnabled?: boolean;
  isDefault?: boolean;
}

export interface UpdateConnectorData {
  name?: string;
  credentials?: Record<string, unknown>;
  settings?: Record<string, unknown> | null;
  isEnabled?: boolean;
  isDefault?: boolean;
}

export interface ConnectorModelConfig {
  reasoningEfforts?: import('@/lib/ai/reasoning-settings').ReasoningEffort[] | null;
  modelId: string;
  name: string;
  description: string;
  providerModelId: string;
  isEnabled: boolean;
  hasOverride: boolean;
  supportsPdfInput?: boolean;
  documentInputMode: 'auto' | 'pdf' | 'image';
  lastPdfInputTest?: {
    success: boolean;
    testedAt: string;
    error?: string;
  };
}

export interface UpsertConnectorModelData {
  modelId: string;
  name?: string;
  description?: string;
  providerModelId?: string;
  isEnabled?: boolean;
  supportsJson?: boolean;
  supportsVision?: boolean;
  supportsTemperature?: boolean;
  supportsJsonResponseFormat?: boolean;
  supportsPdfInput?: boolean;
  documentInputMode?: 'auto' | 'pdf' | 'image';
}

export interface TestResult {
  success: boolean;
  error?: string;
  latencyMs?: number;
}

export interface WorkspaceAccessEntry {
  workspaceId: string;
  workspaceName: string;
  isEnabled: boolean;
}

export interface WorkspaceAccessResponse {
  workspaceAccess: WorkspaceAccessEntry[];
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch connectors with optional filtering
 */
export function useConnectors(params?: ConnectorSearchParams) {
  return useQuery<ConnectorsResponse>({
    queryKey: ['connectors', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.tenantId) searchParams.set('tenantId', params.tenantId);
      if (params?.type) searchParams.set('type', params.type);
      if (params?.provider) searchParams.set('provider', params.provider);
      if (params?.isEnabled !== undefined) searchParams.set('isEnabled', String(params.isEnabled));
      if (params?.includeSystem !== undefined)
        searchParams.set('includeSystem', String(params.includeSystem));
      if (params?.page) searchParams.set('page', params.page.toString());
      if (params?.limit) searchParams.set('limit', params.limit.toString());

      const res = await fetch(`/api/connectors?${searchParams}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch connectors');
      }
      return res.json();
    },
  });
}

/**
 * Fetch a single connector by ID
 */
export function useConnector(id: string | undefined) {
  return useQuery<Connector>({
    queryKey: ['connector', id],
    queryFn: async () => {
      if (!id) throw new Error('Connector ID required');
      const res = await fetch(`/api/connectors/${id}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch connector');
      }
      return res.json();
    },
    enabled: !!id,
  });
}

/**
 * Create a new connector
 */
export function useCreateConnector() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateConnectorData) => {
      const res = await fetch('/api/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create connector');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
}

/**
 * Update an existing connector
 */
export function useUpdateConnector(id: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateConnectorData) => {
      if (!id) throw new Error('Connector ID required');
      const res = await fetch(`/api/connectors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update connector');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
      queryClient.invalidateQueries({ queryKey: ['connector', id] });
    },
  });
}

/**
 * Delete a connector
 */
export function useDeleteConnector() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch(`/api/connectors/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete connector');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
}

/**
 * Test a connector connection
 */
export function useTestConnector() {
  const queryClient = useQueryClient();

  return useMutation<TestResult, Error, string>({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/connectors/${id}/test`, {
        method: 'POST',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to test connector');
      }
      return res.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['connector', id] });
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
}

/**
 * Toggle connector enabled state
 */
export function useToggleConnector(id: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (isEnabled: boolean) => {
      if (!id) throw new Error('Connector ID required');
      const res = await fetch(`/api/connectors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to toggle connector');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
      queryClient.invalidateQueries({ queryKey: ['connector', id] });
    },
  });
}

// ============================================================================
// Workspace Access Hooks (SUPER_ADMIN only)
// ============================================================================

/**
 * Get workspace access list for a system connector
 */
export function useWorkspaceAccess(connectorId: string | undefined) {
  return useQuery<WorkspaceAccessResponse>({
    queryKey: ['connector-workspace-access', connectorId],
    queryFn: async () => {
      if (!connectorId) throw new Error('Connector ID required');
      const res = await fetch(`/api/connectors/${connectorId}/access`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch workspace access');
      }
      return res.json();
    },
    enabled: !!connectorId,
  });
}

/**
 * Update workspace access for a system connector
 */
export function useUpdateWorkspaceAccess(connectorId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      workspaceAccess: Array<{ workspaceId: string; isEnabled: boolean }>
    ) => {
      if (!connectorId) throw new Error('Connector ID required');
      const res = await fetch(`/api/connectors/${connectorId}/access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceAccess }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update workspace access');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-workspace-access', connectorId] });
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Get display name for provider
 */
export function getProviderDisplayName(
  provider:
    | 'OPENAI'
    | 'ANTHROPIC'
    | 'GOOGLE'
    | 'OPENROUTER'
    | 'MISTRAL'
    | 'ONEDRIVE'
    | 'SHAREPOINT'
): string {
  const names: Record<string, string> = {
    OPENAI: 'OpenAI',
    ANTHROPIC: 'Anthropic',
    GOOGLE: 'Google AI',
    OPENROUTER: 'OpenRouter',
    MISTRAL: 'Mistral OCR',
    ONEDRIVE: 'OneDrive',
    SHAREPOINT: 'SharePoint',
  };
  return names[provider] || provider;
}

/**
 * Get display name for connector type
 */
export function getTypeDisplayName(type: 'AI_PROVIDER' | 'STORAGE'): string {
  const names: Record<string, string> = {
    AI_PROVIDER: 'AI Provider',
    STORAGE: 'Storage/ Email',
  };
  return names[type] || type;
}

/**
 * Get provider icon class/emoji (for UI)
 */
export function getProviderIcon(
  provider:
    | 'OPENAI'
    | 'ANTHROPIC'
    | 'GOOGLE'
    | 'OPENROUTER'
    | 'MISTRAL'
    | 'ONEDRIVE'
    | 'SHAREPOINT'
): string {
  const icons: Record<string, string> = {
    OPENAI: 'ðŸ¤–',
    ANTHROPIC: 'ðŸ§ ',
    GOOGLE: 'ðŸ”®',
    ONEDRIVE: 'â˜ï¸',
    SHAREPOINT: 'ðŸ“‚',
  };
  return icons[provider] || 'ðŸ”Œ';
}

/**
 * Parse test result string
 */
export function parseTestResult(result: string | null): {
  success: boolean;
  error?: string;
} {
  if (!result) return { success: false };
  if (result === 'success') return { success: true };
  if (result.startsWith('error:')) {
    return { success: false, error: result.substring(6) };
  }
  return { success: false, error: result };
}

/**
 * Get providers for a type
 */
export function getProvidersForType(
  type: 'AI_PROVIDER' | 'STORAGE'
): Array<
  'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'OPENROUTER' | 'MISTRAL' | 'ONEDRIVE' | 'SHAREPOINT'
> {
  if (type === 'AI_PROVIDER') {
    return ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'OPENROUTER', 'MISTRAL'];
  }
  return ['ONEDRIVE', 'SHAREPOINT'];
}

/**
 * Get required credential fields for a provider
 */
export function getCredentialFields(
  provider:
    | 'OPENAI'
    | 'ANTHROPIC'
    | 'GOOGLE'
    | 'OPENROUTER'
    | 'MISTRAL'
    | 'ONEDRIVE'
    | 'SHAREPOINT'
): Array<{ key: string; label: string; type: 'text' | 'password'; required: boolean; helpText?: string }> {
  switch (provider) {
    case 'OPENAI':
      return [
        { key: 'apiKey', label: 'API Key', type: 'password', required: true },
        { key: 'organization', label: 'Organization ID', type: 'text', required: false },
      ];
    case 'ANTHROPIC':
      return [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }];
    case 'GOOGLE':
      return [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }];
    case 'OPENROUTER':
      return [{ key: 'apiKey', label: 'API Key', type: 'password', required: true, helpText: 'Get your API key from openrouter.ai/keys' }];
    case 'MISTRAL':
      return [{ key: 'apiKey', label: 'API Key', type: 'password', required: true, helpText: 'Get your OCR API key from console.mistral.ai' }];
    case 'ONEDRIVE':
      return [
        { key: 'clientId', label: 'Client ID', type: 'text', required: true },
        { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
        { key: 'tenantId', label: 'Microsoft Tenant ID', type: 'text', required: true },
      ];
    case 'SHAREPOINT':
      return [
        { key: 'clientId', label: 'Client ID', type: 'text', required: true },
        { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
        { key: 'tenantId', label: 'Microsoft Tenant ID', type: 'text', required: true },
        { key: 'siteId', label: 'SharePoint Site ID', type: 'text', required: true, helpText: 'Format: {hostname},{site-collection-id},{web-id}' },
        { key: 'driveId', label: 'Document Library ID', type: 'text', required: false, helpText: 'Optional - defaults to root document library' },
      ];
    default:
      return [];
  }
}

// ============================================================================
// Usage Tracking Types & Hooks
// ============================================================================

export interface UsageLog {
  id: string;
  connectorId: string;
  connectorName?: string;
  tenantId: string | null;
  tenantName?: string;
  userId: string | null;
  userName?: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  costUsd: number;
  latencyMs: number | null;
  operation: string | null;
  success: boolean;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface UsageStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number | null;
}

export interface UsageResponse {
  logs: UsageLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  stats: UsageStats;
}

export interface UsageSearchParams {
  connectorId: string;
  startDate?: string;
  endDate?: string;
  model?: string;
  operation?: string;
  success?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'costCents' | 'totalTokens' | 'latencyMs';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Fetch usage logs for a connector
 */
export function useConnectorUsage(params: UsageSearchParams | null) {
  return useQuery<UsageResponse>({
    queryKey: ['connector-usage', params],
    queryFn: async () => {
      if (!params?.connectorId) throw new Error('Connector ID required');

      const searchParams = new URLSearchParams();
      if (params.startDate) searchParams.set('startDate', params.startDate);
      if (params.endDate) searchParams.set('endDate', params.endDate);
      if (params.model) searchParams.set('model', params.model);
      if (params.operation) searchParams.set('operation', params.operation);
      if (params.success !== undefined) searchParams.set('success', String(params.success));
      if (params.page) searchParams.set('page', params.page.toString());
      if (params.limit) searchParams.set('limit', params.limit.toString());
      if (params.sortBy) searchParams.set('sortBy', params.sortBy);
      if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

      const res = await fetch(`/api/connectors/${params.connectorId}/usage?${searchParams}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch usage logs');
      }
      return res.json();
    },
    enabled: !!params?.connectorId,
  });
}

/**
 * Export usage logs as CSV
 */
export function useExportUsage() {
  return useMutation({
    mutationFn: async (params: UsageSearchParams) => {
      const searchParams = new URLSearchParams();
      searchParams.set('export', 'csv');
      if (params.startDate) searchParams.set('startDate', params.startDate);
      if (params.endDate) searchParams.set('endDate', params.endDate);
      if (params.model) searchParams.set('model', params.model);
      if (params.operation) searchParams.set('operation', params.operation);
      if (params.success !== undefined) searchParams.set('success', String(params.success));

      const res = await fetch(`/api/connectors/${params.connectorId}/usage?${searchParams}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to export usage');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `connector-usage-${params.connectorId}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      return { success: true };
    },
  });
}

/**
 * Format cost for display
 */
export function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}

/**
 * Format tokens for display
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

/**
 * Format latency for display
 */
export function formatLatency(ms: number | null): string {
  if (ms === null) return 'N/A';
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${ms}ms`;
}

// ============================================================================
// Connector Model Config Hooks
// ============================================================================

/**
 * Fetch model configs for an AI connector
 */
export function useConnectorModels(connectorId: string | undefined) {
  return useQuery<ConnectorModelConfig[]>({
    queryKey: ['connector-models', connectorId],
    queryFn: async () => {
      if (!connectorId) throw new Error('Connector ID required');
      const res = await fetch(`/api/connectors/${connectorId}/models`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch model configs');
      }
      return res.json();
    },
    enabled: !!connectorId,
  });
}

/**
 * Toggle a model's enabled state for a connector
 */
export function useToggleConnectorModel(connectorId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<ConnectorModelConfig, Error, { modelId: string; isEnabled: boolean }>({
    mutationFn: async ({ modelId, isEnabled }) => {
      if (!connectorId) throw new Error('Connector ID required');
      const res = await fetch(`/api/connectors/${connectorId}/models`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, isEnabled }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to toggle model');
      }
      return res.json();
    },
    onSuccess: (_model, data) => {
      queryClient.setQueryData<ConnectorModelConfig[]>(['connector-models', connectorId], (models) =>
        models?.map((model) =>
          model.modelId === data.modelId ? { ...model, isEnabled: data.isEnabled } : model
        )
      );
      queryClient.invalidateQueries({ queryKey: ['connector-models', connectorId] });
    },
  });
}

/**
 * Add or update a model for a connector
 */
export function useAddConnectorModel(connectorId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<ConnectorModelConfig, Error, UpsertConnectorModelData>({
    mutationFn: async (data) => {
      if (!connectorId) throw new Error('Connector ID required');
      const res = await fetch(`/api/connectors/${connectorId}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to add model');
      }
      return res.json();
    },
    onSuccess: (model) => {
      queryClient.setQueryData<ConnectorModelConfig[]>(['connector-models', connectorId], (models) => {
        if (!models) return [model];
        const existingIndex = models.findIndex((item) => item.modelId === model.modelId);
        if (existingIndex === -1) return [...models, model];
        return models.map((item) => (item.modelId === model.modelId ? model : item));
      });
      queryClient.invalidateQueries({ queryKey: ['connector-models', connectorId] });
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
}

/**
 * Test whether a connector model accepts PDF file input.
 */
export function useTestConnectorModelPdf(connectorId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<
    { success: boolean; model: ConnectorModelConfig; error?: string },
    Error,
    { modelId: string }
  >({
    mutationFn: async ({ modelId }) => {
      if (!connectorId) throw new Error('Connector ID required');
      const res = await fetch(`/api/connectors/${connectorId}/models/pdf-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to test PDF input');
      }
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.setQueryData<ConnectorModelConfig[]>(['connector-models', connectorId], (models) =>
        models?.map((model) =>
          model.modelId === result.model.modelId ? result.model : model
        )
      );
      queryClient.invalidateQueries({ queryKey: ['connector-models', connectorId] });
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
}

/**
 * Remove a model from a connector
 */
export function useDeleteConnectorModel(connectorId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: async (modelId) => {
      if (!connectorId) throw new Error('Connector ID required');
      const searchParams = new URLSearchParams({ modelId });
      const res = await fetch(`/api/connectors/${connectorId}/models?${searchParams}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to remove model');
      }
      return res.json();
    },
    onSuccess: (_result, modelId) => {
      queryClient.setQueryData<ConnectorModelConfig[]>(['connector-models', connectorId], (models) =>
        models?.filter((model) => model.modelId !== modelId)
      );
      queryClient.invalidateQueries({ queryKey: ['connector-models', connectorId] });
      queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
  });
}
