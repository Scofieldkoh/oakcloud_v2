/**
 * OpenAI Provider
 *
 * Implementation for OpenAI GPT models.
 */

import type { AIRequestOptions, AIResponse, AICredentials, AIModel } from '../types';
import { getModelConfig } from '../models';

// Lazy load OpenAI SDK to reduce initial bundle size
let openaiInstance: import('openai').default | null = null;

export async function getOpenAI(credentials?: AICredentials['openai']) {
  // If custom credentials provided, create a new instance
  if (credentials?.apiKey) {
    const OpenAI = (await import('openai')).default;
    return new OpenAI({
      apiKey: credentials.apiKey,
      // Only pass organization if it has a non-empty value
      ...(credentials.organization ? { organization: credentials.organization } : {}),
    });
  }

  // Fall back to singleton with env var
  if (!openaiInstance) {
    const OpenAI = (await import('openai')).default;
    openaiInstance = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiInstance;
}

/**
 * Check if OpenAI is configured (via env var)
 */
export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export function extractOpenAIMessageContent(
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
    if (combinedText) {
      return combinedText;
    }

    const refusalParts = message.content
      .map((part: unknown) => {
        if (!part || typeof part !== 'object') return '';
        const contentPart = part as Record<string, unknown>;
        if (contentPart.type === 'refusal' && typeof contentPart.refusal === 'string') {
          return contentPart.refusal;
        }
        return '';
      })
      .filter(Boolean);

    const refusalText = refusalParts.join('\n').trim();
    if (refusalText) {
      throw new Error(`OpenAI refused the request: ${refusalText.slice(0, 1000)}`);
    }
  }

  if (typeof message.refusal === 'string' && message.refusal.trim()) {
    throw new Error(`OpenAI refused the request: ${message.refusal.trim().slice(0, 1000)}`);
  }

  return null;
}

export function describeOpenAIMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any
): string {
  if (!message) {
    return 'message=null';
  }

  const details: string[] = [];

  if (typeof message.content === 'string') {
    details.push(`content=string(${message.content.length})`);
  } else if (Array.isArray(message.content)) {
    const partTypes = message.content
      .map((part: unknown) => {
        if (!part || typeof part !== 'object') return 'unknown';
        const contentPart = part as Record<string, unknown>;
        return typeof contentPart.type === 'string' ? contentPart.type : 'unknown';
      })
      .join(',');
    details.push(`content=array[${partTypes || 'empty'}]`);
  } else if (message.content === null) {
    details.push('content=null');
  } else {
    details.push(`content=${typeof message.content}`);
  }

  if (typeof message.refusal === 'string' && message.refusal.trim()) {
    details.push(`refusal=${message.refusal.trim().slice(0, 200)}`);
  }

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    details.push(`tool_calls=${message.tool_calls.length}`);
  }

  return details.join('; ');
}


/**
 * Call OpenAI API (supports vision)
 * @param options - Request options
 * @param credentials - Optional custom credentials (from connector)
 */
export function buildOpenAIChatCompletionRequest(
  options: AIRequestOptions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const modelConfig = options.modelConfig ?? getModelConfig(options.model as AIModel);
  if (modelConfig.provider !== 'openai') {
    throw new Error(`Model ${options.model} is not an OpenAI model`);
  }

  // We use 'any' for messages to avoid complex SDK type gymnastics while ensuring runtime correctness
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  } else if (options.jsonMode) {
    // OpenAI requires "json" to appear in the messages when using response_format: json_object
    messages.push({ role: 'system', content: 'You are a helpful assistant. Respond with valid JSON.' });
  }

  // Build user message content (text + optional images/files)
  if (options.images && options.images.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentParts: any[] = [];

    // Add images/files first
    for (const image of options.images) {
      if (image.mimeType === 'application/pdf') {
        // PDFs use file type with base64 data (supported since March 2025)
        contentParts.push({
          type: 'file',
          file: {
            filename: 'document.pdf',
            file_data: `data:application/pdf;base64,${image.base64}`,
          },
        });
      } else {
        // Images use image_url type
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${image.mimeType};base64,${image.base64}`,
            detail: 'high',
          },
        });
      }
    }

    // Add text prompt
    contentParts.push({ type: 'text', text: options.userPrompt });

    messages.push({ role: 'user', content: contentParts });
  } else {
    messages.push({ role: 'user', content: options.userPrompt });
  }

  // Build request options - only include temperature if the model supports it
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestOptions: any = {
    model: modelConfig.providerModelId,
    messages,
    max_completion_tokens: options.maxTokens,
    ...(options.jsonMode && { response_format: { type: 'json_object' } }),
  };

  // Only set temperature if the model supports custom temperature values
  // Some models (e.g., GPT-5) only support the default temperature (1)
  if (modelConfig.supportsTemperature !== false) {
    requestOptions.temperature = options.temperature ?? 0.1;
  }

  return requestOptions;
}

export function parseOpenAIChatCompletionResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any,
  model: AIModel | string,
  batchMode = false
): AIResponse {
  const choice = response.choices?.[0];
  const content = extractOpenAIMessageContent(choice?.message);
  if (!content) {
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : 'unknown';
    const messageDetails = describeOpenAIMessage(choice?.message);
    throw new Error(`No usable response content from OpenAI (finish_reason=${finishReason}; ${messageDetails})`);
  }

  return {
    content,
    model,
    provider: 'openai',
    usage: response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
          batchMode,
        }
      : undefined,
    finishReason: choice?.finish_reason ?? undefined,
  };
}

export async function callOpenAI(
  options: AIRequestOptions,
  credentials?: AICredentials['openai']
): Promise<AIResponse> {
  // Allow either env var or provided credentials
  if (!isOpenAIConfigured() && !credentials?.apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const openai = await getOpenAI(credentials);
  const requestOptions = buildOpenAIChatCompletionRequest(options);

  const response = await openai.chat.completions.create(requestOptions);
  return parseOpenAIChatCompletionResponse(response, options.model);
}
