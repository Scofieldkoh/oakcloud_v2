/**
 * Connector Model Configs API
 *
 * Models are user-managed per connector. The registry models are only seed data:
 * once settings.models exists, that list is the source of truth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  getSettingsObject,
  normalizeModel,
  persistModels,
  readEditableModels,
  toResponseModel,
} from '@/lib/ai/connector-model-settings';
import { Prisma } from '@/generated/prisma';
import { z } from 'zod';
import { getOpenRouterReasoningCatalog } from '@/lib/ai/openrouter-reasoning';
import { readReasoningDefaults } from '@/lib/ai/reasoning-settings';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const MODEL_DEFAULT_GROUPS = ['general', 'ocr', 'research', 'businessAssistant', 'bizfileExtraction'] as const;

const modelSchema = z.object({
  modelId: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  providerModelId: z.string().trim().optional(),
  isEnabled: z.boolean().optional(),
  supportsJson: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  supportsTemperature: z.boolean().optional(),
  supportsJsonResponseFormat: z.boolean().optional(),
  supportsPdfInput: z.boolean().optional(),
  documentInputMode: z.enum(['auto', 'pdf', 'image']).optional(),
});

const toggleModelSchema = z.object({
  modelId: z.string().trim().min(1),
  isEnabled: z.boolean(),
});

async function getAuthorizedConnector(id: string) {
  const session = await requireAuth();

  if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  const connector = await prisma.connector.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(session.isSuperAdmin ? {} : { workspaceId: session.tenantId }),
    },
  });

  if (!connector) {
    return { error: NextResponse.json({ error: 'Connector not found' }, { status: 404 }) };
  }

  if (!session.isSuperAdmin && !connector.workspaceId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { connector, session };
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const authorized = await getAuthorizedConnector(id);
    if (authorized.error) return authorized.error;
    const { connector } = authorized;

    const overrides = (await prisma.connectorModelConfig.findMany({
      where: { connectorId: id },
      select: { modelId: true, isEnabled: true },
    })) ?? [];
    const models = readEditableModels(connector, overrides);

    const catalog = connector.provider === 'OPENROUTER' ? await getOpenRouterReasoningCatalog() : null;
    return NextResponse.json(models.map((model) => ({
      ...toResponseModel(model),
      ...(connector.provider === 'OPENROUTER' ? { reasoningEfforts: catalog?.get(model.providerModelId) ?? (catalog ? [] : null) } : {}),
    })));
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const authorized = await getAuthorizedConnector(id);
    if (authorized.error) return authorized.error;
    const { connector } = authorized;

    const parsed = modelSchema.parse(await request.json());
    const overrides = (await prisma.connectorModelConfig.findMany({
      where: { connectorId: id },
      select: { modelId: true, isEnabled: true },
    })) ?? [];
    const models = readEditableModels(connector, overrides);
    const existingModel = models.find((model) => model.modelId === parsed.modelId);
    const nextModel = normalizeModel({
      ...existingModel,
      modelId: parsed.modelId,
      name: parsed.name ?? existingModel?.name,
      description: parsed.description ?? existingModel?.description,
      providerModelId: parsed.providerModelId ?? existingModel?.providerModelId,
      isEnabled: parsed.isEnabled ?? existingModel?.isEnabled ?? true,
      supportsJson: parsed.supportsJson ?? existingModel?.supportsJson,
      supportsVision: parsed.supportsVision ?? existingModel?.supportsVision,
      supportsTemperature: parsed.supportsTemperature ?? existingModel?.supportsTemperature,
      supportsJsonResponseFormat:
        parsed.supportsJsonResponseFormat ?? existingModel?.supportsJsonResponseFormat,
      supportsPdfInput: parsed.supportsPdfInput ?? existingModel?.supportsPdfInput,
      documentInputMode: parsed.documentInputMode ?? existingModel?.documentInputMode,
    });
    const nextModels = [
      ...models.filter((model) => model.modelId !== nextModel.modelId),
      nextModel,
    ];

    await persistModels(connector, nextModels);
    await prisma.connectorModelConfig.deleteMany({
      where: { connectorId: id, modelId: nextModel.modelId },
    });

    return NextResponse.json(toResponseModel(nextModel));
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const authorized = await getAuthorizedConnector(id);
    if (authorized.error) return authorized.error;
    const { connector } = authorized;

    const { modelId, isEnabled } = toggleModelSchema.parse(await request.json());
    const overrides = (await prisma.connectorModelConfig.findMany({
      where: { connectorId: id },
      select: { modelId: true, isEnabled: true },
    })) ?? [];
    const models = readEditableModels(connector, overrides);
    const model = models.find((item) => item.modelId === modelId);
    if (!model) {
      return NextResponse.json({ error: 'Model not found for this connector' }, { status: 404 });
    }

    const nextModel = normalizeModel({ ...model, isEnabled });
    const nextModels = models.map((item) => (item.modelId === modelId ? nextModel : item));

    await persistModels(connector, nextModels);
    await prisma.connectorModelConfig.deleteMany({
      where: { connectorId: id, modelId },
    });

    return NextResponse.json(toResponseModel(nextModel));
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const authorized = await getAuthorizedConnector(id);
    if (authorized.error) return authorized.error;
    const { connector } = authorized;

    const modelId = new URL(request.url).searchParams.get('modelId')?.trim();
    if (!modelId) {
      return NextResponse.json({ error: 'modelId is required' }, { status: 400 });
    }

    const overrides = await prisma.connectorModelConfig.findMany({
      where: { connectorId: id },
      select: { modelId: true, isEnabled: true },
    });
    const models = readEditableModels(connector, overrides);
    if (!models.some((model) => model.modelId === modelId)) {
      return NextResponse.json({ error: 'Model not found for this connector' }, { status: 404 });
    }

    const settings = getSettingsObject(connector.settings);
    const nextSettings: Record<string, unknown> = {
      ...settings,
      models: models.filter((model) => model.modelId !== modelId).map((model) => normalizeModel(model)),
    };
    delete nextSettings.customModels;
    if (nextSettings.reasoningDefaults) {
      nextSettings.reasoningDefaults = Object.fromEntries(Object.entries(readReasoningDefaults(nextSettings.reasoningDefaults))
        .filter(([, choice]) => choice.modelId !== modelId));
    }

    if (
      nextSettings.modelDefaults &&
      typeof nextSettings.modelDefaults === 'object' &&
      !Array.isArray(nextSettings.modelDefaults)
    ) {
      const defaults = { ...(nextSettings.modelDefaults as Record<string, unknown>) };
      for (const group of MODEL_DEFAULT_GROUPS) {
        if (defaults[group] === modelId) {
          delete defaults[group];
        }
      }
      if (Object.keys(defaults).length > 0) {
        nextSettings.modelDefaults = defaults;
      } else {
        delete nextSettings.modelDefaults;
      }
    }

    await prisma.connector.update({
      where: { id },
      data: { settings: nextSettings as Prisma.InputJsonValue },
    });
    await prisma.connectorModelConfig.deleteMany({
      where: { connectorId: id, modelId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return createErrorResponse(error);
  }
}
