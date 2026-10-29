/**
 * Anthropic Provider
 *
 * Implementation for Anthropic Claude models.
 */

import type { AIRequestOptions, AIResponse, AICredentials, AIModel } from '../types';
import { getModelConfig } from '../models';

// Lazy load Anthropic SDK to reduce initial bundle size
let anthropicInstance: import('@anthropic-ai/sdk').default | null = null;

async function getAnthropic(credentials?: AICredentials['anthropic']) {
  // If custom credentials provided, create a new instance
  if (credentials?.apiKey) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    return new Anthropic({
      apiKey: credentials.apiKey,
    });
  }

  // Fall back to singleton with env var
  if (!anthropicInstance) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    anthropicInstance = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicInstance;
}

/**
 * Check if Anthropic is configured (via env var)
 */
export function isAnthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Anthropic supported image media types
type AnthropicImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * Call Anthropic API (supports vision)
 * @param options - Request options
 * @param credentials - Optional custom credentials (from connector)
 */
export async function callAnthropic(
  options: AIRequestOptions,
  credentials?: AICredentials['anthropic']
): Promise<AIResponse> {
  // Allow either env var or provided credentials
  if (!isAnthropicConfigured() && !credentials?.apiKey) {
    throw new Error('Anthropic API key not configured');
  }

  const modelConfig = options.modelConfig ?? getModelConfig(options.model as AIModel);
  if (modelConfig.provider !== 'anthropic') {
    throw new Error(`Model ${options.model} is not an Anthropic model`);
  }

  const anthropic = await getAnthropic(credentials);

  // Build system prompt with JSON mode instruction if needed
  let systemPrompt = options.systemPrompt || '';
  if (options.jsonMode) {
    systemPrompt = `${systemPrompt}\n\nIMPORTANT: You must respond with valid JSON only. Do not include any text outside the JSON object.`;
  }

  // Build user message content (text + optional images/documents)
  // We use 'any' here to avoid complex SDK type gymnastics while ensuring runtime correctness
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let userContent: any;

  if (options.images && options.images.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentParts: any[] = [];

    // Add images/documents first
    for (const image of options.images) {
      if (image.mimeType === 'application/pdf') {
        // PDF documents use the document block type
        contentParts.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: image.base64,
          },
        });
      } else {
        // Images use the image block type
        contentParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mimeType as AnthropicImageMediaType,
            data: image.base64,
          },
        });
      }
    }

    // Add text prompt
    contentParts.push({ type: 'text', text: options.userPrompt });

    userContent = contentParts;
  } else {
    userContent = options.userPrompt;
  }

  const response = await anthropic.messages.create({
    model: modelConfig.providerModelId,
    max_tokens: options.maxTokens || 4096,
    system: systemPrompt || undefined,
    messages: [
      {
        role: 'user',
        content: userContent,
      },
    ],
  });

  // Extract text content from response
  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Anthropic');
  }

  return {
    content: textContent.text,
    model: options.model,
    provider: 'anthropic',
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    },
    finishReason: response.stop_reason ?? undefined,
  };
}
