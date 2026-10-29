import { NextRequest, NextResponse } from 'next/server';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { requireAuth } from '@/lib/auth';
import {
  getBestAvailableModelForWorkspace,
  getAvailableProvidersForWorkspace,
  PROVIDER_NAMES,
  getDefaultModelId,
  AI_MODELS,
} from '@/lib/ai';
import type { AIModel, AIProvider } from '@/lib/ai';
import { resolveConnector } from '@/services/connector.service';
import { prisma } from '@/lib/prisma';

type ConnectorProvider = 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'OPENROUTER';
type ModelDefaultGroup = 'general' | 'ocr' | 'research';
type SelectorModel = {
  id: string;
  name: string;
  provider: AIProvider;
  description: string;
  providerModelId: string;
  supportsJson: boolean;
  supportsVision: boolean;
  supportsTemperature?: boolean;
  supportsJsonResponseFormat?: boolean;
  available: boolean;
  providerConfigured: boolean;
};

const MODEL_DEFAULT_GROUPS: ModelDefaultGroup[] = ['general', 'ocr', 'research'];

const PROVIDER_TO_CONNECTOR_PROVIDER: Record<AIProvider, ConnectorProvider> = {
  openai: 'OPENAI',
  anthropic: 'ANTHROPIC',
  google: 'GOOGLE',
  openrouter: 'OPENROUTER',
};

async function resolveConnectorSafely(
  tenantId: string | null,
  provider: AIProvider
): Promise<{ connectorId: string; settings: Record<string, unknown> | null } | null> {
  try {
    const resolved = await resolveConnector(
      tenantId,
      'AI_PROVIDER',
      PROVIDER_TO_CONNECTOR_PROVIDER[provider]
    );
    if (!resolved) return null;
    return {
      connectorId: resolved.connector.id,
      settings:
        resolved.connector.settings && typeof resolved.connector.settings === 'object'
          ? (resolved.connector.settings as Record<string, unknown>)
          : null,
    };
  } catch (error) {
    console.error(`Error resolving ${provider} connector for AI models:`, error);
    return null;
  }
}

function readConnectorModelDefaults(
  settings: Record<string, unknown> | null
): Partial<Record<ModelDefaultGroup, string>> {
  if (!settings) return {};

  const defaults: Partial<Record<ModelDefaultGroup, string>> = {};
  const modelDefaults = settings.modelDefaults;
  if (modelDefaults && typeof modelDefaults === 'object' && !Array.isArray(modelDefaults)) {
    for (const group of MODEL_DEFAULT_GROUPS) {
      const value = (modelDefaults as Record<string, unknown>)[group];
      if (typeof value === 'string' && value.trim()) {
        defaults[group] = value.trim();
      }
    }
  }

  if (!defaults.general && typeof settings.defaultModel === 'string' && settings.defaultModel.trim()) {
    defaults.general = settings.defaultModel.trim();
  }

  return defaults;
}

function readConnectorModels(
  provider: AIProvider,
  settings: Record<string, unknown> | null,
  overrides: Map<string, boolean>,
  providerConfigured: boolean
): SelectorModel[] | null {
  if (!settings || !Array.isArray(settings.models)) return null;

  const models: Array<SelectorModel | null> = settings.models
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const id = typeof item.modelId === 'string' ? item.modelId.trim() : '';
      if (!id) return null;
      const registryModel = AI_MODELS[id as AIModel];
      const providerModelId =
        typeof item.providerModelId === 'string' && item.providerModelId.trim()
          ? item.providerModelId.trim()
          : registryModel?.providerModelId || id;
      const name =
        typeof item.name === 'string' && item.name.trim()
          ? item.name.trim()
          : registryModel?.name || providerModelId;

      const selectorModel: SelectorModel = {
        id,
        name,
        provider,
        description:
          typeof item.description === 'string' ? item.description : registryModel?.description || '',
        providerModelId,
        supportsJson:
          typeof item.supportsJson === 'boolean' ? item.supportsJson : registryModel?.supportsJson ?? true,
        supportsVision:
          typeof item.supportsVision === 'boolean'
            ? item.supportsVision
            : registryModel?.supportsVision ?? true,
        supportsTemperature:
          typeof item.supportsTemperature === 'boolean'
            ? item.supportsTemperature
            : registryModel?.supportsTemperature,
        supportsJsonResponseFormat:
          typeof item.supportsJsonResponseFormat === 'boolean'
            ? item.supportsJsonResponseFormat
            : registryModel?.supportsJsonResponseFormat,
        available: providerConfigured && (overrides.get(id) ?? (typeof item.isEnabled === 'boolean' ? item.isEnabled : true)),
        providerConfigured,
      };
      return selectorModel;
    });
  return models.filter((item): item is SelectorModel => Boolean(item));
}

function readLegacyCustomModels(
  provider: AIProvider,
  settings: Record<string, unknown> | null,
  providerConfigured: boolean
): SelectorModel[] {
  if (!settings || !Array.isArray(settings.customModels)) return [];

  const models: Array<SelectorModel | null> = settings.customModels
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const id = typeof item.modelId === 'string' ? item.modelId.trim() : '';
      if (!id) return null;
      const providerModelId =
        typeof item.providerModelId === 'string' && item.providerModelId.trim()
          ? item.providerModelId.trim()
          : id;
      const selectorModel: SelectorModel = {
        id,
        name:
          typeof item.name === 'string' && item.name.trim() ? item.name.trim() : providerModelId,
        provider,
        description: typeof item.description === 'string' ? item.description : '',
        providerModelId,
        supportsJson: typeof item.supportsJson === 'boolean' ? item.supportsJson : true,
        supportsVision: typeof item.supportsVision === 'boolean' ? item.supportsVision : true,
        supportsTemperature:
          typeof item.supportsTemperature === 'boolean' ? item.supportsTemperature : true,
        supportsJsonResponseFormat:
          typeof item.supportsJsonResponseFormat === 'boolean'
            ? item.supportsJsonResponseFormat
            : false,
        available: providerConfigured && (typeof item.isEnabled === 'boolean' ? item.isEnabled : true),
        providerConfigured,
      };
      return selectorModel;
    });
  return models.filter((item): item is SelectorModel => Boolean(item));
}

async function isMistralOcrAvailable(tenantId: string | null): Promise<boolean> {
  try {
    const mistralConnector = await resolveConnector(tenantId, 'AI_PROVIDER', 'MISTRAL');
    return Boolean(mistralConnector) || Boolean(process.env.MISTRAL_API_KEY?.trim());
  } catch (error) {
    console.error('Error resolving Mistral connector for AI models:', error);
    return Boolean(process.env.MISTRAL_API_KEY?.trim());
  }
}

/**
 * GET /api/ai/models
 *
 * Returns available AI models and provider status.
 * Used by the frontend to populate model selector components.
 * Now connector-aware: checks both env vars AND tenant connectors.
 *
 * Query params:
 * - tenantId: Optional tenant ID for SUPER_ADMIN to check a specific tenant's providers
 */
export async function GET(request: NextRequest) {
  try {
    // Require authentication
    const session = await requireAuth();

    // Get tenantId from query params (for SUPER_ADMIN) or session
    const { searchParams } = new URL(request.url);
    const queryTenantId = searchParams.get('tenantId');

    // SUPER_ADMIN can specify a tenant, otherwise use session's tenant
    let tenantId: string | null = session.tenantId;
    if (session.isSuperAdmin && queryTenantId) {
      tenantId = queryTenantId;
    }

    // Get available providers for this tenant (includes both connectors and env vars)
    const availableProviders = await getAvailableProvidersForWorkspace(tenantId);

    // Resolve active connector per provider (if any), so model overrides can be applied.
    const providerList: AIProvider[] = ['openai', 'anthropic', 'google', 'openrouter'];
    const resolvedConnectors = await Promise.all(
      providerList.map(async (provider) => {
        const resolved = await resolveConnectorSafely(tenantId, provider);
        return { provider, resolved };
      })
    );
    const connectorIdByProvider = new Map<AIProvider, string>();
    const settingsByConnectorId = new Map<string, Record<string, unknown> | null>();
    for (const item of resolvedConnectors) {
      if (item.resolved) {
        connectorIdByProvider.set(item.provider, item.resolved.connectorId);
        settingsByConnectorId.set(item.resolved.connectorId, item.resolved.settings);
      }
    }
    const mistralOcrAvailable = await isMistralOcrAvailable(tenantId);

    const connectorIds = Array.from(new Set(Array.from(connectorIdByProvider.values())));
    const connectorOverrides = connectorIds.length > 0
      ? await prisma.connectorModelConfig.findMany({
          where: {
            connectorId: { in: connectorIds },
          },
          select: {
            connectorId: true,
            modelId: true,
            isEnabled: true,
          },
        })
      : [];
    const overrideByConnectorAndModel = new Map(
      connectorOverrides.map((item) => [`${item.connectorId}:${item.modelId}`, item.isEnabled])
    );

    // Get all models and mark availability based on workspace providers + editable connector model lists.
    const models: SelectorModel[] = [];
    const modelIds = new Set<string>();
    for (const provider of providerList) {
      const providerConfigured = availableProviders.includes(provider);
      const connectorId = connectorIdByProvider.get(provider);
      const providerOverrides = new Map<string, boolean>();
      if (connectorId) {
        for (const [key, enabled] of overrideByConnectorAndModel.entries()) {
          const [keyConnectorId, modelId] = key.split(':');
          if (keyConnectorId === connectorId) providerOverrides.set(modelId, enabled);
        }
      }

      const settings = connectorId ? settingsByConnectorId.get(connectorId) ?? null : null;
      const connectorModels = readConnectorModels(
        provider,
        settings,
        providerOverrides,
        providerConfigured
      );
      const providerModels =
        connectorModels ??
        Object.values(AI_MODELS)
          .filter((model) => model.provider === provider)
          .map((model) => ({
            ...model,
            available: providerConfigured && (providerOverrides.get(model.id) ?? true),
            providerConfigured,
          }));

      for (const model of [...providerModels, ...readLegacyCustomModels(provider, settings, providerConfigured)]) {
        if (modelIds.has(model.id)) continue;
        modelIds.add(model.id);
        models.push(model);
      }
    }

    const availableModelIds = new Set<string>(models.filter((m) => m.available).map((m) => m.id));
    const connectorDefaultCandidates: Partial<Record<ModelDefaultGroup, string>> = {};
    for (const [connectorId, settings] of settingsByConnectorId.entries()) {
      const defaults = readConnectorModelDefaults(settings);
      for (const group of MODEL_DEFAULT_GROUPS) {
        const candidate = defaults[group];
        if (!candidate || !availableModelIds.has(candidate)) continue;

        const model = models.find((item) => item.id === candidate);
        if (model && connectorIdByProvider.get(model.provider) === connectorId) {
          connectorDefaultCandidates[group] = candidate;
        }
      }
    }

    // Build provider status based on tenant's available providers
    const providers = providerList.map((provider) => ({
      provider,
      available: availableProviders.includes(provider),
      configured: availableProviders.includes(provider),
    }));

    // Get best available model for this tenant and reconcile with connector model overrides
    const bestAvailableModel = await getBestAvailableModelForWorkspace(tenantId);
    const configuredDefault = getDefaultModelId();

    // Prefer configured default, then best available, then first available model
    const defaultModel = (
      [
        connectorDefaultCandidates.general,
        configuredDefault,
        bestAvailableModel,
        ...Array.from(availableModelIds),
      ]
        .find((modelId): modelId is string => !!modelId && availableModelIds.has(modelId))
      || null
    );

    const defaultModels: Record<ModelDefaultGroup, string | null> = {
      general: defaultModel,
      ocr: (connectorDefaultCandidates.ocr && availableModelIds.has(connectorDefaultCandidates.ocr))
        ? connectorDefaultCandidates.ocr
        : null,
      research:
        (connectorDefaultCandidates.research && availableModelIds.has(connectorDefaultCandidates.research))
          ? connectorDefaultCandidates.research
          : null,
    };

    const groupedModels = {
      openai: models.filter((m) => m.provider === 'openai'),
      anthropic: models.filter((m) => m.provider === 'anthropic'),
      google: models.filter((m) => m.provider === 'google'),
      openrouter: models.filter((m) => m.provider === 'openrouter'),
    };

    // Format for frontend consumption
    const response = {
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        providerName: PROVIDER_NAMES[m.provider],
        description: m.description,
        available: m.available,
        supportsJson: m.supportsJson,
        supportsVision: m.supportsVision,
        isDefault: m.id === defaultModel,
      })),
      providers: providers.map((p) => ({
        id: p.provider,
        name: PROVIDER_NAMES[p.provider],
        available: p.available,
        configured: p.configured,
      })),
      defaultModel,
      defaultModels,
      grouped: {
        openai: groupedModels.openai.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          available: m.available,
        })),
        anthropic: groupedModels.anthropic.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          available: m.available,
        })),
        google: groupedModels.google.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          available: m.available,
        })),
        openrouter: groupedModels.openrouter.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          available: m.available,
        })),
      },
      mistralOcrAvailable,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching AI models:', error);
    return routeErrorResponse(error);
  }
}
