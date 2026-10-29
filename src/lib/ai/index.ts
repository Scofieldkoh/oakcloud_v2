/**
 * AI Service
 *
 * Unified interface for calling multiple AI providers (OpenAI, Anthropic, Google).
 * Provides a consistent API regardless of the underlying model.
 *
 * Supports two modes:
 * 1. Environment-based: Uses API keys from environment variables
 * 2. Connector-based: Uses credentials from database connectors (tenant-aware)
 */

export * from './types';
export * from './models';
export * from './debug';
export * from './model-capabilities';

import type {
  AIModel,
  AIModelConfig,
  AIProvider,
  AIRequestOptions,
  AIResponse,
  ModelAvailability,
  ProviderStatus,
} from './types';
import { AI_MODELS, getModelConfig, getDefaultModel } from './models';
import { callOpenAI, isOpenAIConfigured } from './providers/openai';
import { callAnthropic, isAnthropicConfigured } from './providers/anthropic';
import { callGoogle, isGoogleConfigured } from './providers/google';
import { callOpenRouter, isOpenRouterConfigured } from './providers/openrouter';
import { createLogger } from '@/lib/logger';
import {
  getEffectiveDocumentInputMode,
  readConnectorModelDocumentSettings,
} from './model-capabilities';

const log = createLogger('ai');

/**
 * Extract JSON from AI response content.
 * Handles various wrapping patterns:
 * - Markdown code blocks: ```json ... ``` or ``` ... ```
 * - Thinking/reasoning tags: <think>...</think> before the JSON
 * - Plain text preamble before the first { or [
 */
export function stripMarkdownCodeBlocks(content: string): string {
  let text = content.trim();

  // Remove thinking/reasoning tags (e.g. Qwen3 <think>...</think>)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Strip markdown code block wrapper
  const codeBlockMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Extract first JSON object or array (handles preamble text)
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  return text;
}

/**
 * Check provider configuration status
 */
export function getProviderStatus(provider: AIProvider): ProviderStatus {
  switch (provider) {
    case 'openai':
      return {
        provider: 'openai',
        available: isOpenAIConfigured(),
        configured: isOpenAIConfigured(),
      };
    case 'anthropic':
      return {
        provider: 'anthropic',
        available: isAnthropicConfigured(),
        configured: isAnthropicConfigured(),
      };
    case 'google':
      return {
        provider: 'google',
        available: isGoogleConfigured(),
        configured: isGoogleConfigured(),
      };
    case 'openrouter':
      return {
        provider: 'openrouter',
        available: isOpenRouterConfigured(),
        configured: isOpenRouterConfigured(),
      };
    default:
      return {
        provider,
        available: false,
        configured: false,
        error: `Unknown provider: ${provider}`,
      };
  }
}

/**
 * Get all provider statuses
 */
export function getAllProviderStatuses(): ProviderStatus[] {
  return [
    getProviderStatus('openai'),
    getProviderStatus('anthropic'),
    getProviderStatus('google'),
    getProviderStatus('openrouter'),
  ];
}

/**
 * Get available models with their availability status
 */
export function getAvailableModels(): ModelAvailability[] {
  return Object.values(AI_MODELS)
    .filter((model) => model.enabled !== false)
    .map((model) => {
      const providerStatus = getProviderStatus(model.provider);
      return {
        ...model,
        available: providerStatus.available,
        providerConfigured: providerStatus.configured,
      };
    });
}

/**
 * Get only models that are currently usable (provider is configured)
 */
export function getUsableModels(): ModelAvailability[] {
  return getAvailableModels().filter((m) => m.available);
}

/**
 * Check if a specific model is available
 */
export function isModelAvailable(modelId: AIModel): boolean {
  const model = AI_MODELS[modelId];
  if (!model) return false;
  return getProviderStatus(model.provider).available;
}

/**
 * Get the best available model (prefers default if available)
 */
export function getBestAvailableModel(): AIModel | null {
  // First, try the default model
  const defaultModel = getDefaultModel();
  if (isModelAvailable(defaultModel.id as AIModel)) {
    return defaultModel.id as AIModel;
  }

  // Otherwise, return the first available model
  const usableModels = getUsableModels();
  if (usableModels.length > 0) {
    return usableModels[0].id as AIModel;
  }

  return null;
}

/**
 * Main AI call function - routes to the appropriate provider
 */
export async function callAI(options: AIRequestOptions): Promise<AIResponse> {
  const modelConfig = options.modelConfig ?? getModelConfig(options.model as AIModel);

  // Check if the provider is configured
  const providerStatus = getProviderStatus(modelConfig.provider);
  if (!providerStatus.configured) {
    throw new Error(
      `${modelConfig.provider.charAt(0).toUpperCase() + modelConfig.provider.slice(1)} API key not configured. ` +
        `Please set the appropriate environment variable.`
    );
  }

  // Route to the appropriate provider
  switch (modelConfig.provider) {
    case 'openai':
      return callOpenAI(options);
    case 'anthropic':
      return callAnthropic(options);
    case 'google':
      return callGoogle(options);
    case 'openrouter':
      return callOpenRouter(options);
    default:
      throw new Error(`Unknown provider: ${modelConfig.provider}`);
  }
}

/**
 * Convenience function for JSON extraction tasks
 */
export async function extractJSON<T = unknown>(
  options: Omit<AIRequestOptions, 'jsonMode'>
): Promise<{ data: T; response: AIResponse }> {
  const response = await callAI({
    ...options,
    jsonMode: true,
  });

  try {
    // Strip markdown code blocks if present (some models wrap JSON in ```json ... ```)
    const cleanedContent = stripMarkdownCodeBlocks(response.content);
    const data = JSON.parse(cleanedContent) as T;
    return { data, response };
  } catch (error) {
    throw new Error(
      `Failed to parse AI response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Create a preconfigured AI caller for a specific use case
 */
export function createAICaller(defaultOptions: Partial<AIRequestOptions>) {
  return async function call(options: Omit<AIRequestOptions, 'model'> & { model?: AIModel | string }) {
    const mergedOptions: AIRequestOptions = {
      ...defaultOptions,
      ...options,
      model: options.model || defaultOptions.model || getBestAvailableModel() || 'gpt-5.4-mini',
    };
    return callAI(mergedOptions);
  };
}

// ============================================================================
// Connector-aware AI calls (tenant-aware using database connectors)
// ============================================================================

/**
 * Map AI provider name to connector provider enum value
 */
function mapProviderToConnectorProvider(provider: AIProvider): 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'OPENROUTER' {
  switch (provider) {
    case 'openai':
      return 'OPENAI';
    case 'anthropic':
      return 'ANTHROPIC';
    case 'google':
      return 'GOOGLE';
    case 'openrouter':
      return 'OPENROUTER';
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function hasEditableModelList(settings: unknown): boolean {
  return Boolean(
    settings &&
      typeof settings === 'object' &&
      !Array.isArray(settings) &&
      Array.isArray((settings as Record<string, unknown>).models)
  );
}

function readConnectorModelConfig(
  settings: unknown,
  modelId: string,
  provider: AIProvider
): { config: AIModelConfig; isEnabled: boolean } | null {
  const settingsObject =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const modelArrays = [settingsObject.models, settingsObject.customModels];

  for (const value of modelArrays) {
    if (!Array.isArray(value)) continue;

    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const model = item as Record<string, unknown>;
      const entryModelId = typeof model.modelId === 'string' ? model.modelId.trim() : '';
      if (entryModelId !== modelId) continue;

      const registryModel = AI_MODELS[entryModelId as AIModel];
      const providerModelId =
        typeof model.providerModelId === 'string' && model.providerModelId.trim()
          ? model.providerModelId.trim()
          : registryModel?.providerModelId || entryModelId;
      const name =
        typeof model.name === 'string' && model.name.trim()
          ? model.name.trim()
          : registryModel?.name || providerModelId;

      return {
        isEnabled: typeof model.isEnabled === 'boolean' ? model.isEnabled : true,
        config: {
          id: entryModelId,
          name,
          provider,
          providerModelId,
          description:
            typeof model.description === 'string'
              ? model.description
              : registryModel?.description || '',
          maxTokens: registryModel?.maxTokens || 4096,
          inputPricePerMillion: registryModel?.inputPricePerMillion || 0,
          outputPricePerMillion: registryModel?.outputPricePerMillion || 0,
          supportsJson:
            typeof model.supportsJson === 'boolean'
              ? model.supportsJson
              : registryModel?.supportsJson ?? true,
          supportsVision:
            typeof model.supportsVision === 'boolean'
              ? model.supportsVision
              : registryModel?.supportsVision ?? true,
          supportsTemperature:
            typeof model.supportsTemperature === 'boolean'
              ? model.supportsTemperature
              : registryModel?.supportsTemperature,
          supportsJsonResponseFormat:
            typeof model.supportsJsonResponseFormat === 'boolean'
              ? model.supportsJsonResponseFormat
              : registryModel?.supportsJsonResponseFormat,
        },
      };
    }
  }

  return null;
}

/**
 * Options for connector-aware AI calls
 */
export interface ConnectorAIOptions extends AIRequestOptions {
  /** Tenant ID for connector resolution (null for system-level calls) */
  tenantId: string | null;
  /** User ID who triggered the call (for usage tracking) */
  userId?: string | null;
  /** Explicit connector to use, instead of resolving a workspace/system fallback */
  connectorId?: string;
  /** Required when an explicit system connector is used by a super admin */
  isSuperAdmin?: boolean;
  /** Preferred provider (if not specified, uses model's default provider) */
  preferredProvider?: AIProvider;
  /** Operation type for usage tracking (e.g., 'bizfile_extraction') */
  operation?: string;
  /** Additional metadata for usage tracking */
  usageMetadata?: Record<string, unknown>;
}

/**
 * Call AI using connector credentials (tenant-aware)
 *
 * Resolution order:
 * 1. Tenant connector for the provider â†’ use if exists & enabled
 * 2. System connector for the provider â†’ use if exists & enabled & tenant has access
 * 3. Fall back to environment variables
 * 4. Throw error if no provider available
 */
export async function callAIWithConnector(options: ConnectorAIOptions): Promise<AIResponse> {
  // Lazy import to avoid circular dependencies
  const { getConnectorById, resolveConnector } = await import('@/services/connector.service');
  const { logConnectorUsage } = await import('@/services/connector-usage.service');
  const { logAIRequestStart, logAIResponse, logAIError } = await import('./debug');

  const staticModelConfig = AI_MODELS[options.model as AIModel];
  const providerList: AIProvider[] = options.preferredProvider
    ? [options.preferredProvider]
    : staticModelConfig
      ? [staticModelConfig.provider]
      : ['openai', 'anthropic', 'google', 'openrouter'];

  // Some administrative probes must exercise the connector selected in the UI.
  // Generic resolution can otherwise select a different workspace/system connector
  // or fall through to environment credentials, producing misleading results.
  const explicitConnector = options.connectorId
    ? await getConnectorById(options.connectorId, {
        tenantId: options.tenantId,
        userId: options.userId ?? 'system',
        isSuperAdmin: options.isSuperAdmin ?? false,
      })
    : null;

  if (options.connectorId && !explicitConnector) {
    throw new Error('Connector not found');
  }

  let explicitProvider: AIProvider | null = null;
  let explicitResolved: Awaited<ReturnType<typeof resolveConnector>> | null = null;
  if (explicitConnector) {
    if (explicitConnector.type !== 'AI_PROVIDER') {
      throw new Error('The selected connector is not an AI provider.');
    }

    explicitProvider = mapConnectorProviderToAIProvider(explicitConnector.provider);
    if (!explicitProvider) {
      throw new Error(`Unsupported AI connector provider: ${explicitConnector.provider}`);
    }
    if (options.preferredProvider && options.preferredProvider !== explicitProvider) {
      throw new Error('The selected connector does not match the requested AI provider.');
    }
    if (!explicitConnector.isEnabled) {
      throw new Error('The selected connector is disabled. Enable it before testing model input.');
    }

    explicitResolved = {
      connector: explicitConnector,
      source: explicitConnector.workspaceId ? 'workspace' : 'system',
    };
  }

  let provider = providerList[0];
  let connectorProvider = mapProviderToConnectorProvider(provider);
  let resolved:
    | Awaited<ReturnType<typeof resolveConnector>>
    | null = null;
  let modelConfig: AIModelConfig | undefined = staticModelConfig;

  for (const candidateProvider of providerList) {
    const candidateConnectorProvider = mapProviderToConnectorProvider(candidateProvider);
    const candidateResolved = explicitResolved
      ? candidateProvider === explicitProvider
        ? explicitResolved
        : null
      : await resolveConnector(options.tenantId, 'AI_PROVIDER', candidateConnectorProvider);
    if (!candidateResolved) {
      if (staticModelConfig && candidateProvider === staticModelConfig.provider) {
        provider = candidateProvider;
        connectorProvider = candidateConnectorProvider;
      }
      continue;
    }

    const connectorModel = readConnectorModelConfig(
      candidateResolved.connector.settings,
      options.model,
      candidateProvider
    );
    if (connectorModel) {
      if (!connectorModel.isEnabled) {
        throw new Error(`Model "${options.model}" is disabled for this connector.`);
      }
      provider = candidateProvider;
      connectorProvider = candidateConnectorProvider;
      resolved = candidateResolved;
      modelConfig = connectorModel.config;
      break;
    }

    if (hasEditableModelList(candidateResolved.connector.settings)) {
      continue;
    }

    if (staticModelConfig && candidateProvider === staticModelConfig.provider) {
      provider = candidateProvider;
      connectorProvider = candidateConnectorProvider;
      resolved = candidateResolved;
      modelConfig = staticModelConfig;
      break;
    }
  }

  if (!modelConfig) {
    throw new Error(`Model "${options.model}" is not configured for any connector.`);
  }
  const requestOptions = { ...options, modelConfig };
  if (provider === 'openrouter' && resolved && !requestOptions.reasoningEffort) {
    const { getConfiguredReasoningEffort } = await import('./reasoning-settings');
    requestOptions.reasoningEffort = getConfiguredReasoningEffort(resolved.connector.settings, options.model, options.operation);
  }

  // Start debug logging if enabled
  const debugContext = logAIRequestStart(
    { ...options, tenantId: options.tenantId, userId: options.userId },
    provider
  );

  // Try to resolve a connector for this tenant/provider
  if (resolved) {
    if (debugContext) {
      debugContext.connectorSource = resolved.source;
      debugContext.connectorId = resolved.connector.id;
      debugContext.connectorName = resolved.connector.name;
    }

    // Credentials are already decrypted by resolveConnector
    const credentials = resolved.connector.credentials as Record<string, unknown>;

    // Verify the requested model is not disabled for this connector
    {
      const { prisma } = await import('@/lib/prisma');
      const modelOverride = await prisma.connectorModelConfig.findUnique({
        where: {
          connectorId_modelId: {
            connectorId: resolved.connector.id,
            modelId: options.model,
          },
        },
      });
      // A row with isEnabled: false means the model is explicitly disabled
      if (modelOverride && !modelOverride.isEnabled) {
        throw new Error(
          `Model "${options.model}" is disabled for this connector.`
        );
      }
    }

    const startTime = Date.now();
    let response: AIResponse | undefined;
    let error: Error | null = null;

    try {
      switch (provider) {
        case 'openai':
          response = await callOpenAI(requestOptions, {
            apiKey: credentials.apiKey as string,
            organization: credentials.organization as string | undefined,
          });
          break;
        case 'anthropic':
          response = await callAnthropic(requestOptions, {
            apiKey: credentials.apiKey as string,
          });
          break;
        case 'google':
          response = await callGoogle(requestOptions, {
            apiKey: credentials.apiKey as string,
          });
          break;
        case 'openrouter':
          response = await callOpenRouter(requestOptions, {
            apiKey: credentials.apiKey as string,
          });
          break;
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      // Log error for debug
      logAIError(debugContext, error);
      throw error;
    } finally {
      const latencyMs = Date.now() - startTime;

      // Log debug response if available
      if (response) {
        logAIResponse(debugContext, response);
      }

      // Log usage (non-blocking)
      logConnectorUsage({
        connectorId: resolved.connector.id,
        tenantId: options.tenantId,
        userId: options.userId,
        model: options.model,
        provider,
        inputTokens: response?.usage?.inputTokens ?? 0,
        outputTokens: response?.usage?.outputTokens ?? 0,
        totalTokens: response?.usage?.totalTokens ?? 0,
        latencyMs,
        operation: options.operation,
        success: !error,
        errorMessage: error?.message,
        metadata: options.usageMetadata,
      }).catch((err) => {
        log.error('Failed to log connector usage:', err);
      });
    }

    return response!;
  }

  // No connector found, fall back to environment variables
  if (debugContext) {
    debugContext.connectorSource = 'env';
    debugContext.connectorId = null;
    debugContext.connectorName = null;
  }
  const providerStatus = getProviderStatus(provider);
  if (!providerStatus.configured) {
    throw new Error(
      `No AI provider available. ` +
        `No ${connectorProvider} connector configured for this tenant, ` +
        `and no environment variable fallback is set.`
    );
  }

  // Use environment-based call (no usage tracking for env-based calls)
  return callAI(requestOptions);
}

/**
 * Get available AI providers for a tenant
 * Returns providers that have either:
 * 1. A tenant-specific connector
 * 2. A system connector with tenant access
 * 3. Environment variable configuration
 */
export async function getAvailableProvidersForWorkspace(
  tenantId: string | null
): Promise<AIProvider[]> {
  const { getAvailableConnectors } = await import('@/services/connector.service');

  const availableProviders = new Set<AIProvider>();

  // Check connector-based providers
  try {
    const resolvedConnectors = await getAvailableConnectors(tenantId, 'AI_PROVIDER');

    for (const resolved of resolvedConnectors) {
      switch (resolved.connector.provider) {
        case 'OPENAI':
          availableProviders.add('openai');
          break;
        case 'ANTHROPIC':
          availableProviders.add('anthropic');
          break;
        case 'GOOGLE':
          availableProviders.add('google');
          break;
        case 'OPENROUTER':
          availableProviders.add('openrouter');
          break;
      }
    }
  } catch (error) {
    log.error('Error getting connectors for tenant:', error);
  }

  // Check environment-based providers as fallback
  if (isOpenAIConfigured()) availableProviders.add('openai');
  if (isAnthropicConfigured()) availableProviders.add('anthropic');
  if (isGoogleConfigured()) availableProviders.add('google');
  if (isOpenRouterConfigured()) availableProviders.add('openrouter');

  return Array.from(availableProviders);
}

/**
 * Check if a specific provider is available for a tenant
 */
export async function isProviderAvailableForWorkspace(
  tenantId: string | null,
  provider: AIProvider
): Promise<boolean> {
  const availableProviders = await getAvailableProvidersForWorkspace(tenantId);
  return availableProviders.includes(provider);
}

function mapConnectorProviderToAIProvider(provider: string): AIProvider | null {
  switch (provider) {
    case 'OPENAI':
      return 'openai';
    case 'ANTHROPIC':
      return 'anthropic';
    case 'GOOGLE':
      return 'google';
    case 'OPENROUTER':
      return 'openrouter';
    default:
      return null;
  }
}

function readEnabledConnectorModelIds(settings: unknown): string[] | null {
  const settingsObject =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : null;
  if (!settingsObject) return null;

  const modelList = Array.isArray(settingsObject.models)
    ? settingsObject.models
    : Array.isArray(settingsObject.customModels)
      ? settingsObject.customModels
      : null;
  if (!modelList) return null;

  const enabledModelIds = modelList
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => item.isEnabled !== false)
    .map((item) => (typeof item.modelId === 'string' ? item.modelId.trim() : ''))
    .filter(Boolean);

  const defaults =
    settingsObject.modelDefaults &&
    typeof settingsObject.modelDefaults === 'object' &&
    !Array.isArray(settingsObject.modelDefaults)
      ? (settingsObject.modelDefaults as Record<string, unknown>)
      : null;
  const generalDefault =
    typeof defaults?.general === 'string' ? defaults.general.trim() : '';

  if (generalDefault && enabledModelIds.includes(generalDefault)) {
    return [generalDefault, ...enabledModelIds.filter((modelId) => modelId !== generalDefault)];
  }

  return enabledModelIds;
}

/**
 * Get the best available model for a tenant
 * Checks both connector and environment configurations
 */
export async function getBestAvailableModelForWorkspace(
  tenantId: string | null,
  defaultGroup?: 'businessAssistant' | 'bizfileExtraction',
  options?: { configuredOnly?: boolean }
): Promise<AIModel | string | null> {
  const availableProviders = await getAvailableProvidersForWorkspace(tenantId);

  if (availableProviders.length === 0) {
    return null;
  }

  const connectorModelsByProvider = new Map<AIProvider, string[]>();
  try {
    const { getAvailableConnectors } = await import('@/services/connector.service');
    const resolvedConnectors = await getAvailableConnectors(tenantId, 'AI_PROVIDER');

    for (const resolved of resolvedConnectors) {
      const provider = mapConnectorProviderToAIProvider(resolved.connector.provider);
      if (!provider) continue;

      const connectorModelIds = readEnabledConnectorModelIds(resolved.connector.settings);
      if (defaultGroup && availableProviders.includes(provider)) {
        const settings = resolved.connector.settings as Record<string, unknown> | null;
        const defaults = settings?.modelDefaults as Record<string, unknown> | undefined;
        const configured = defaults?.[defaultGroup];
        if (typeof configured === 'string' && connectorModelIds?.includes(configured.trim())) {
          return configured.trim();
        }
      }
      if (connectorModelIds && connectorModelIds.length > 0) {
        connectorModelsByProvider.set(provider, connectorModelIds);
      }
    }
  } catch (error) {
    log.error('Error getting connector models for tenant:', error);
  }

  if (options?.configuredOnly) return null;

  // First, try the default model if its provider is available
  const defaultModel = getDefaultModel();
  if (availableProviders.includes(defaultModel.provider)) {
    const connectorModelIds = connectorModelsByProvider.get(defaultModel.provider);
    if (connectorModelIds && !connectorModelIds.includes(defaultModel.id)) {
      return connectorModelIds[0];
    }
    return defaultModel.id as AIModel;
  }

  for (const provider of availableProviders) {
    const connectorModelIds = connectorModelsByProvider.get(provider);
    if (connectorModelIds?.[0]) {
      return connectorModelIds[0];
    }
  }

  // Otherwise, return the first model from an available provider
  const usableModels = Object.values(AI_MODELS).filter((model) =>
    availableProviders.includes(model.provider)
  );

  if (usableModels.length > 0) {
    return usableModels[0].id as AIModel;
  }

  return null;
}

export async function getDocumentInputModeForModel(
  tenantId: string | null,
  modelId: AIModel | string
): Promise<'pdf' | 'image'> {
  try {
    const { getAvailableConnectors } = await import('@/services/connector.service');
    const resolvedConnectors = await getAvailableConnectors(tenantId, 'AI_PROVIDER');

    for (const resolved of resolvedConnectors) {
      const settings = readConnectorModelDocumentSettings(resolved.connector.settings, modelId);
      if (settings) {
        return getEffectiveDocumentInputMode(settings);
      }
    }
  } catch (error) {
    log.error('Error getting connector document input mode for model:', error);
  }

  const staticModelConfig = AI_MODELS[modelId as AIModel];
  return staticModelConfig?.provider === 'openrouter' ? 'image' : 'pdf';
}
