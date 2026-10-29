/**
 * AI Service Types
 *
 * Shared types for the multi-provider AI service.
 */

// Supported AI providers
export type AIProvider = 'openai' | 'anthropic' | 'google' | 'openrouter';

// Supported AI models
export type AIModel =
  // OpenAI models
  | 'gpt-5.4'
  | 'gpt-5.4-mini'
  | 'o4-mini-deep-research'
  // Anthropic models
  | 'claude-opus-4.6'
  | 'claude-sonnet-4.6'
  // Google models
  | 'gemini-3.1'
  | 'gemini-3-flash'
  // OpenRouter models
  | 'qwen3-vl-235b-a22b-thinking'
  | 'bytedance-seed/seed-2.0-mini'
  | 'perplexity/sonar-pro-search';

// Model configuration
export interface AIModelConfig {
  id: AIModel | string;
  name: string;
  provider: AIProvider;
  providerModelId: string; // The actual model ID used by the provider API
  description: string;
  maxTokens: number;
  inputPricePerMillion: number; // Price per million input tokens in USD
  outputPricePerMillion: number; // Price per million output tokens in USD
  supportsJson: boolean;
  supportsVision: boolean;
  supportsTemperature?: boolean; // Whether the model supports custom temperature (default: true)
  supportsJsonResponseFormat?: boolean; // Whether the model supports response_format: { type: 'json_object' } (default: true)
  isDefault?: boolean;
  enabled?: boolean; // When false, model is hidden from available/usable lists (default: true)
}

// Image input for vision models
export interface AIImageInput {
  /** Base64-encoded image data (without data URL prefix) */
  base64: string;
  /** MIME type of the image (e.g., 'image/png', 'image/jpeg', 'application/pdf') */
  mimeType: string;
}

// AI request options
export interface AIRequestOptions {
  reasoningEffort?: import('./reasoning-settings').ReasoningEffort;
  model: AIModel | string;
  modelConfig?: AIModelConfig;
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /** Images to include with the request (for vision models) */
  images?: AIImageInput[];
}

// AI response
export interface AIResponse {
  content: string;
  model: AIModel | string;
  provider: AIProvider;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    pagesProcessed?: number;
    batchMode?: boolean;
  };
  finishReason?: string;
}

// Provider availability status
export interface ProviderStatus {
  provider: AIProvider;
  available: boolean;
  configured: boolean;
  error?: string;
}

// Model availability including provider status
export interface ModelAvailability extends AIModelConfig {
  available: boolean;
  providerConfigured: boolean;
}

// Credentials for AI providers (from connectors)
export interface AICredentials {
  openai: {
    apiKey: string;
    organization?: string;
  };
  anthropic: {
    apiKey: string;
  };
  google: {
    apiKey: string;
  };
  openrouter: {
    apiKey: string;
  };
}
