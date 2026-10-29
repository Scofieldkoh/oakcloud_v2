import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { AI_MODELS } from '@/lib/ai/models';
import {
  type DocumentInputMode,
  type PdfInputTestResult,
  normalizeDocumentInputMode,
} from '@/lib/ai/model-capabilities';

export interface ConnectorModelEntry {
  modelId: string;
  name: string;
  description: string;
  providerModelId: string;
  isEnabled: boolean;
  supportsJson: boolean;
  supportsVision: boolean;
  supportsTemperature: boolean;
  supportsJsonResponseFormat: boolean;
  supportsPdfInput?: boolean;
  documentInputMode: DocumentInputMode;
  lastPdfInputTest?: PdfInputTestResult;
}

export function getSettingsObject(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === 'object' && !Array.isArray(settings)
    ? { ...(settings as Record<string, unknown>) }
    : {};
}

export function normalizeModel(
  raw: Partial<ConnectorModelEntry> & { modelId: string }
): ConnectorModelEntry {
  const modelId = raw.modelId.trim();
  const providerModelId = raw.providerModelId?.trim() || modelId;
  const name = raw.name?.trim() || providerModelId;

  return {
    modelId,
    name,
    description: raw.description?.trim() || '',
    providerModelId,
    isEnabled: raw.isEnabled ?? true,
    supportsJson: raw.supportsJson ?? true,
    supportsVision: raw.supportsVision ?? true,
    supportsTemperature: raw.supportsTemperature ?? true,
    supportsJsonResponseFormat: raw.supportsJsonResponseFormat ?? false,
    supportsPdfInput: raw.supportsPdfInput,
    documentInputMode: normalizeDocumentInputMode(raw.documentInputMode),
    lastPdfInputTest: raw.lastPdfInputTest,
  };
}

function readLastPdfInputTest(value: unknown): PdfInputTestResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = value as Record<string, unknown>;
  const testedAt = typeof result.testedAt === 'string' ? result.testedAt : '';
  if (!testedAt) return undefined;

  return {
    success: result.success === true,
    testedAt,
    error: typeof result.error === 'string' ? result.error : undefined,
  };
}

function readModelArray(value: unknown): ConnectorModelEntry[] | null {
  if (!Array.isArray(value)) return null;

  const models = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const modelId = typeof item.modelId === 'string' ? item.modelId.trim() : '';
      if (!modelId) return null;
      return normalizeModel({
        modelId,
        name: typeof item.name === 'string' ? item.name : undefined,
        description: typeof item.description === 'string' ? item.description : undefined,
        providerModelId: typeof item.providerModelId === 'string' ? item.providerModelId : undefined,
        isEnabled: typeof item.isEnabled === 'boolean' ? item.isEnabled : true,
        supportsJson: typeof item.supportsJson === 'boolean' ? item.supportsJson : true,
        supportsVision: typeof item.supportsVision === 'boolean' ? item.supportsVision : true,
        supportsTemperature:
          typeof item.supportsTemperature === 'boolean' ? item.supportsTemperature : true,
        supportsJsonResponseFormat:
          typeof item.supportsJsonResponseFormat === 'boolean'
            ? item.supportsJsonResponseFormat
            : false,
        supportsPdfInput:
          typeof item.supportsPdfInput === 'boolean' ? item.supportsPdfInput : undefined,
        documentInputMode: normalizeDocumentInputMode(item.documentInputMode),
        lastPdfInputTest: readLastPdfInputTest(item.lastPdfInputTest),
      });
    })
    .filter((item): item is ConnectorModelEntry => Boolean(item));

  return models;
}

function seedModelsForProvider(provider: string): ConnectorModelEntry[] {
  return Object.values(AI_MODELS)
    .filter((model) => model.provider === provider.toLowerCase())
    .map((model) =>
      normalizeModel({
        modelId: model.id,
        name: model.name,
        description: model.description,
        providerModelId: model.providerModelId,
        isEnabled: true,
        supportsJson: model.supportsJson,
        supportsVision: model.supportsVision,
        supportsTemperature: model.supportsTemperature,
        supportsJsonResponseFormat: model.supportsJsonResponseFormat,
      })
    );
}

export function readEditableModels(
  connector: { provider: string; settings: unknown },
  overrides: Array<{ modelId: string; isEnabled: boolean }> = []
): ConnectorModelEntry[] {
  const settings = getSettingsObject(connector.settings);
  const savedModels = readModelArray(settings.models);
  if (savedModels) return savedModels;

  const overrideMap = new Map(overrides.map((override) => [override.modelId, override.isEnabled]));
  const seededModels = seedModelsForProvider(connector.provider).map((model) => ({
    ...model,
    isEnabled: overrideMap.get(model.modelId) ?? model.isEnabled,
  }));
  const legacyCustomModels = readModelArray(settings.customModels) ?? [];

  const byId = new Map<string, ConnectorModelEntry>();
  for (const model of [...seededModels, ...legacyCustomModels]) {
    byId.set(model.modelId, normalizeModel(model));
  }
  return Array.from(byId.values());
}

export function toResponseModel(model: ConnectorModelEntry) {
  return {
    modelId: model.modelId,
    name: model.name,
    description: model.description,
    providerModelId: model.providerModelId,
    isEnabled: model.isEnabled,
    hasOverride: true,
    documentInputMode: model.documentInputMode,
    supportsPdfInput: model.supportsPdfInput,
    lastPdfInputTest: model.lastPdfInputTest,
  };
}

export async function persistModels(
  connector: { id: string; settings: unknown },
  models: ConnectorModelEntry[]
) {
  const settings = getSettingsObject(connector.settings);
  const nextSettings: Record<string, unknown> = {
    ...settings,
    models: models.map((model) => normalizeModel(model)),
  };
  delete nextSettings.customModels;

  await prisma.connector.update({
    where: { id: connector.id },
    data: { settings: nextSettings as Prisma.InputJsonValue },
  });

  return nextSettings;
}
