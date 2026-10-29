import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api-error-handler';
import { getAvailableProvidersForWorkspace } from '@/lib/ai';
import { AI_MODELS, PROVIDER_NAMES } from '@/lib/ai/models';
import type { AIProvider } from '@/lib/ai/types';

/**
 * GET /api/ai-models
 * Get available AI models for the current tenant
 */
export async function GET() {
  try {
    const session = await requireAuth();
    const availableProviders = await getAvailableProvidersForWorkspace(session.tenantId);

    // Filter models to only those with available providers
    const availableModels = Object.values(AI_MODELS)
      .filter((model) => availableProviders.includes(model.provider))
      .map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        providerName: PROVIDER_NAMES[model.provider as AIProvider],
        description: model.description,
        inputPricePerMillion: model.inputPricePerMillion,
        outputPricePerMillion: model.outputPricePerMillion,
      }));

    // Group models by provider
    const modelsByProvider: Record<string, typeof availableModels> = {};
    for (const model of availableModels) {
      if (!modelsByProvider[model.provider]) {
        modelsByProvider[model.provider] = [];
      }
      modelsByProvider[model.provider].push(model);
    }

    return NextResponse.json({
      success: true,
      data: {
        models: availableModels,
        modelsByProvider,
        availableProviders,
      },
    });
  } catch (error) {
    console.error('Error fetching AI models:', error);
    return handleApiError(error, 'ai-models');
  }
}
