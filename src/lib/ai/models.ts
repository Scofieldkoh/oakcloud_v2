/**
 * AI Model Registry
 *
 * Configuration for all supported AI models.
 */

import type { AIModel, AIModelConfig, AIProvider } from './types';

export const MISTRAL_OCR_PRICE_PER_PAGE_USD = 0.003;
export const MISTRAL_OCR_BATCH_PRICE_PER_PAGE_USD =
  MISTRAL_OCR_PRICE_PER_PAGE_USD / 2;

// Model configurations
export const AI_MODELS: Record<AIModel, AIModelConfig> = {
  // OpenAI Models
  'gpt-5.4': {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'openai',
    providerModelId: 'gpt-5.4',
    description: 'Flagship OpenAI model for complex reasoning, coding, and agentic workflows',
    maxTokens: 1000000, // 1M context window
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 15.0,
    supportsJson: true,
    supportsVision: true,
    supportsTemperature: false,
  },
  'gpt-5.4-mini': {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'openai',
    providerModelId: 'gpt-5.4-mini',
    description: 'Faster, lower-cost GPT-5.4 variant for strong extraction and workflow tasks',
    maxTokens: 400000,
    inputPricePerMillion: 0.75,
    outputPricePerMillion: 4.5,
    supportsJson: true,
    supportsVision: true,
    supportsTemperature: false,
    isDefault: true,
    enabled: true,
  },
  'o4-mini-deep-research': {
    id: 'o4-mini-deep-research',
    name: 'o4 Mini Deep Research',
    provider: 'openai',
    providerModelId: 'o4-mini-deep-research',
    description: 'Faster, affordable deep research model for complex multi-step research tasks',
    maxTokens: 200000,
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 8.0,
    supportsJson: true,
    supportsVision: true,
    supportsTemperature: false,
    enabled: true,
  },
  // Anthropic Models
  'claude-opus-4.6': {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    providerModelId: 'claude-opus-4-6',
    description: 'Most intelligent Claude model for agents and coding',
    maxTokens: 200000,
    inputPricePerMillion: 5.0,
    outputPricePerMillion: 25.0,
    supportsJson: true,
    supportsVision: true,
  },
  'claude-sonnet-4.6': {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    providerModelId: 'claude-sonnet-4-6',
    description: 'Best combination of speed and intelligence',
    maxTokens: 200000,
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    supportsJson: true,
    supportsVision: true,
  },

  // Google Models
  'gemini-3.1': {
    id: 'gemini-3.1',
    name: 'Gemini 3.1 Pro',
    provider: 'google',
    providerModelId: 'gemini-3.1-pro-preview',
    description: 'Most powerful Google model (preview)',
    maxTokens: 1000000,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
    supportsJson: true,
    supportsVision: true,
  },
  'gemini-3-flash': {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    provider: 'google',
    providerModelId: 'gemini-3-flash-preview',
    description: 'Fast frontier model with strong multimodal capabilities',
    maxTokens: 1000000,
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 3.0,
    supportsJson: true,
    supportsVision: true,
  },

  // OpenRouter Models
  'qwen3-vl-235b-a22b-thinking': {
    id: 'qwen3-vl-235b-a22b-thinking',
    name: 'Qwen3 VL 235B Thinking',
    provider: 'openrouter',
    providerModelId: 'qwen/qwen3-vl-235b-a22b-thinking',
    description: 'Qwen3 large vision-language model with extended thinking',
    maxTokens: 131072,
    inputPricePerMillion: 0.014,
    outputPricePerMillion: 0.064,
    supportsJson: true,
    supportsJsonResponseFormat: false, // Does not support response_format: { type: 'json_object' }
    supportsVision: true,
    enabled: true,
  },
  'bytedance-seed/seed-2.0-mini': {
    id: 'bytedance-seed/seed-2.0-mini',
    name: 'Seed 2.0 Mini',
    provider: 'openrouter',
    providerModelId: 'bytedance-seed/seed-2.0-mini',
    description: 'ByteDance fast multimodal model with reasoning and 256K context',
    maxTokens: 262144,
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    supportsJson: true,
    supportsJsonResponseFormat: false, // OpenRouter provider may not forward this correctly
    supportsVision: true,
    enabled: true,
  },
  'perplexity/sonar-pro-search': {
    id: 'perplexity/sonar-pro-search',
    name: 'Sonar Pro Search',
    provider: 'openrouter',
    providerModelId: 'perplexity/sonar-pro-search',
    description: 'Perplexity Sonar Pro with real-time web search and multi-step reasoning',
    maxTokens: 200000,
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    supportsJson: true,
    supportsVision: true,
    enabled: true,
  },
};

// Backward-compatible model ID aliases for env/config values.
// This lets older deployments keep working while docs/config are updated.
const MODEL_ID_ALIASES: Record<string, AIModel> = {
  'gpt-5': 'gpt-5.4',
  'gpt-5.2': 'gpt-5.4',
  'gpt-5-mini': 'gpt-5.4-mini',
  'gpt-4.1': 'gpt-5.4',
  'gemini-3': 'gemini-3.1',
  'gemini-3.1-pro': 'gemini-3.1',
  'gemini-2.5-flash': 'gemini-3-flash',
};

/**
 * Normalize external model IDs (env vars, legacy config) into supported AIModel IDs.
 */
function normalizeModelId(modelId?: string): AIModel | undefined {
  if (!modelId) return undefined;
  if (AI_MODELS[modelId as AIModel]) {
    return modelId as AIModel;
  }
  return MODEL_ID_ALIASES[modelId];
}

// Get model config by ID
export function getModelConfig(modelId: AIModel): AIModelConfig {
  const config = AI_MODELS[modelId];
  if (!config) {
    throw new Error(`Unknown AI model: ${modelId}`);
  }
  return config;
}

// Get all models for a provider
export function getModelsByProvider(provider: AIProvider): AIModelConfig[] {
  return Object.values(AI_MODELS).filter((m) => m.provider === provider);
}

// Get all models grouped by provider
export function getModelsGroupedByProvider(): Record<AIProvider, AIModelConfig[]> {
  return {
    openai: getModelsByProvider('openai'),
    anthropic: getModelsByProvider('anthropic'),
    google: getModelsByProvider('google'),
    openrouter: getModelsByProvider('openrouter'),
  };
}

// Get the default model (checks env variable first, then falls back to code default)
export function getDefaultModel(): AIModelConfig {
  // Check for environment variable override
  const envDefault = normalizeModelId(process.env.DEFAULT_AI_MODEL);
  if (envDefault) {
    return AI_MODELS[envDefault];
  }

  // Fall back to code-defined default
  const defaultModel = Object.values(AI_MODELS).find((m) => m.isDefault);
  return defaultModel || AI_MODELS['gpt-5.4-mini'];
}

// Get the default model ID (for frontend)
export function getDefaultModelId(): AIModel {
  return getDefaultModel().id as AIModel;
}

// Get all model IDs
export function getAllModelIds(): AIModel[] {
  return Object.keys(AI_MODELS) as AIModel[];
}

// Provider display names
export const PROVIDER_NAMES: Record<AIProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
};

// Provider icons (for UI)
export const PROVIDER_ICONS: Record<AIProvider, string> = {
  openai: '🤖',
  anthropic: '🔮',
  google: '✨',
  openrouter: '🔀',
};

/**
 * Calculate estimated cost for AI usage
 * @param modelId - The model ID
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @returns Estimated cost in USD
 */
export function calculateCost(
  modelId: AIModel,
  inputTokens: number,
  outputTokens: number
): number {
  const config = AI_MODELS[modelId];
  if (!config) return 0;

  const inputCost = (inputTokens / 1_000_000) * config.inputPricePerMillion;
  const outputCost = (outputTokens / 1_000_000) * config.outputPricePerMillion;

  return inputCost + outputCost;
}

interface UsageCostInput {
  modelId: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  pagesProcessed?: number;
  batchMode?: boolean;
}

/**
 * Calculate usage cost across both token-priced and page-priced models.
 * For Mistral OCR, `pagesProcessed` is preferred and `totalTokens` is used
 * as a page-count fallback so existing usage UIs can keep working.
 */
export function calculateUsageCost({
  modelId,
  provider,
  inputTokens,
  outputTokens,
  totalTokens,
  pagesProcessed,
  batchMode,
}: UsageCostInput): number {
  if (modelId === 'mistral-ocr-latest' || provider === 'mistral') {
    const billablePages =
      typeof pagesProcessed === 'number' && Number.isFinite(pagesProcessed)
        ? Math.max(0, Math.trunc(pagesProcessed))
        : Math.max(0, Math.trunc(totalTokens));

    return billablePages *
      (batchMode
        ? MISTRAL_OCR_BATCH_PRICE_PER_PAGE_USD
        : MISTRAL_OCR_PRICE_PER_PAGE_USD);
  }

  if (AI_MODELS[modelId as AIModel]) {
    return calculateCost(modelId as AIModel, inputTokens, outputTokens);
  }

  return 0;
}

/**
 * Format cost for display (always 4 decimal places)
 * @param cost - Cost in USD
 * @returns Formatted cost string
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}
