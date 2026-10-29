/**
 * OpenRouter Provider
 *
 * Implementation for OpenRouter models using the OpenAI-compatible API.
 * Uses the OpenAI SDK with a custom baseURL.
 */

import type { AIRequestOptions, AIResponse, AICredentials, AIModel } from '../types';
import { getModelConfig } from '../models';
import { getOpenRouterReasoningCatalog } from '../openrouter-reasoning';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Lazy-loaded singleton for env-var based calls
let openrouterInstance: import('openai').default | null = null;

function getConfiguredApiKey(credentials?: AICredentials['openrouter']): string {
  // An explicitly supplied connector credential must not silently fall back to
  // OPENROUTER_API_KEY; that can make connector tests exercise another account.
  const apiKey = credentials
    ? credentials.apiKey
    : process.env.OPENROUTER_API_KEY;
  return typeof apiKey === 'string' ? apiKey.trim() : '';
}

async function getOpenRouter(credentials?: AICredentials['openrouter']) {
  // If custom credentials provided, create a new instance
  const apiKey = getConfiguredApiKey(credentials);
  if (credentials) {
    if (!apiKey) {
      throw new Error('OpenRouter connector API key is missing');
    }

    const OpenAI = (await import('openai')).default;
    return new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'https://localhost',
        'X-Title': process.env.OPENROUTER_APP_NAME ?? 'OakCloud',
      },
    });
  }

  // Fall back to singleton with env var
  if (!openrouterInstance) {
    const OpenAI = (await import('openai')).default;
    openrouterInstance = new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'https://localhost',
        'X-Title': process.env.OPENROUTER_APP_NAME ?? 'OakCloud',
      },
    });
  }
  return openrouterInstance;
}

/**
 * Check if OpenRouter is configured (via env var)
 */
export function isOpenRouterConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

function extractOpenRouterMessageContent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any
): string | null {
  if (!message) return null;

  if (typeof message.content === 'string') {
    const trimmed = message.content.trim();
    return trimmed || null;
  }

  if (Array.isArray(message.content)) {
    const textParts = message.content
      .map((part: unknown) => {
        if (!part || typeof part !== 'object') return '';
        const contentPart = part as Record<string, unknown>;
        if (contentPart.type === 'text' && typeof contentPart.text === 'string') {
          return contentPart.text;
        }
        return '';
      })
      .filter(Boolean);

    const combinedText = textParts.join('\n').trim();
    return combinedText || null;
  }

  return null;
}

/**
 * Call OpenRouter API (supports vision)
 * @param options - Request options
 * @param credentials - Optional custom credentials (from connector)
 */
export async function callOpenRouter(
  options: AIRequestOptions,
  credentials?: AICredentials['openrouter']
): Promise<AIResponse> {
  if (!getConfiguredApiKey(credentials)) {
    throw new Error('OpenRouter API key not configured');
  }

  const modelConfig = options.modelConfig ?? getModelConfig(options.model as AIModel);
  if (modelConfig.provider !== 'openrouter') {
    throw new Error(`Model ${options.model} is not an OpenRouter model`);
  }

  const client = await getOpenRouter(credentials);

  // We use 'any' for messages to avoid complex SDK type gymnastics while ensuring runtime correctness
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  } else if (options.jsonMode) {
    messages.push({ role: 'system', content: 'You are a helpful assistant. Respond with valid JSON.' });
  }

  if (options.images && options.images.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentParts: any[] = [];

    // OpenRouter recommends putting the text prompt before file/image parts.
    contentParts.push({ type: 'text', text: options.userPrompt });

    for (const image of options.images) {
      if (image.mimeType === 'application/pdf') {
        contentParts.push({
          type: 'file',
          file: {
            filename: 'document.pdf',
            file_data: `data:application/pdf;base64,${image.base64}`,
          },
        });
      } else {
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${image.mimeType};base64,${image.base64}`,
            detail: 'high',
          },
        });
      }
    }

    messages.push({ role: 'user', content: contentParts });
  } else {
    messages.push({ role: 'user', content: options.userPrompt });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestOptions: any = {
    model: modelConfig.providerModelId,
    messages,
    max_tokens: options.maxTokens,
    ...(options.jsonMode &&
      modelConfig.supportsJsonResponseFormat !== false && {
        response_format: { type: 'json_object' },
      }),
  };

  if (modelConfig.supportsTemperature !== false) {
    requestOptions.temperature = options.temperature ?? 0.1;
  }

  if (options.reasoningEffort) {
    const catalog = await getOpenRouterReasoningCatalog();
    if (catalog?.get(modelConfig.providerModelId)?.includes(options.reasoningEffort)) {
      requestOptions.reasoning = { effort: options.reasoningEffort };
    }
  }

  let response;
  try {
    response = await client.chat.completions.create(requestOptions);
  } catch (err: unknown) {
    // Log full error details for debugging OpenRouter provider errors
    const apiErr = err as { status?: number; message?: string; error?: unknown };
    console.error('[OpenRouter] API error:', {
      model: modelConfig.providerModelId,
      status: apiErr.status,
      message: apiErr.message,
      error: apiErr.error,
      requestOptions: { ...requestOptions, messages: `[${requestOptions.messages?.length} messages]` },
    });
    throw err;
  }

  const content = extractOpenRouterMessageContent(response.choices[0]?.message);
  if (!content) {
    throw new Error('No usable response content from OpenRouter');
  }

  return {
    content,
    model: options.model,
    provider: 'openrouter',
    usage: response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
    finishReason: response.choices[0]?.finish_reason ?? undefined,
  };
}
