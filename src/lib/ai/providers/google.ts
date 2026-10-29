/**
 * Google Provider
 *
 * Implementation for Google Gemini models.
 */

import type { AIRequestOptions, AIResponse, AICredentials, AIModel } from '../types';
import { getModelConfig } from '../models';

// Lazy load Google Generative AI SDK to reduce initial bundle size
let googleInstance: import('@google/generative-ai').GoogleGenerativeAI | null = null;

async function getGoogleAI(credentials?: AICredentials['google']) {
  // If custom credentials provided, create a new instance
  if (credentials?.apiKey) {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    return new GoogleGenerativeAI(credentials.apiKey);
  }

  // Fall back to singleton with env var
  if (!googleInstance) {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    googleInstance = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');
  }
  return googleInstance;
}

/**
 * Check if Google AI is configured (via env var)
 */
export function isGoogleConfigured(): boolean {
  return !!process.env.GOOGLE_AI_API_KEY;
}

// Type for Google content parts
type GoogleContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/**
 * Call Google Gemini API (supports vision)
 * @param options - Request options
 * @param credentials - Optional custom credentials (from connector)
 */
export async function callGoogle(
  options: AIRequestOptions,
  credentials?: AICredentials['google']
): Promise<AIResponse> {
  // Allow either env var or provided credentials
  if (!isGoogleConfigured() && !credentials?.apiKey) {
    throw new Error('Google AI API key not configured');
  }

  const modelConfig = options.modelConfig ?? getModelConfig(options.model as AIModel);
  if (modelConfig.provider !== 'google') {
    throw new Error(`Model ${options.model} is not a Google model`);
  }

  const googleAI = await getGoogleAI(credentials);
  const model = googleAI.getGenerativeModel({
    model: modelConfig.providerModelId,
    generationConfig: {
      temperature: options.temperature ?? 0.1,
      maxOutputTokens: options.maxTokens,
      ...(options.jsonMode && { responseMimeType: 'application/json' }),
    },
    ...(options.systemPrompt && { systemInstruction: options.systemPrompt }),
  });

  // Build content parts (images + text)
  let contentParts: GoogleContentPart[];

  if (options.images && options.images.length > 0) {
    contentParts = [];

    // Add images first
    for (const image of options.images) {
      contentParts.push({
        inlineData: {
          mimeType: image.mimeType,
          data: image.base64,
        },
      });
    }

    // Add text prompt
    contentParts.push({ text: options.userPrompt });
  } else {
    contentParts = [{ text: options.userPrompt }];
  }

  const result = await model.generateContent(contentParts);
  const response = result.response;
  const content = response.text();

  if (!content) {
    throw new Error('No response from Google AI');
  }

  // Extract usage metadata if available
  const usageMetadata = response.usageMetadata;

  return {
    content,
    model: options.model,
    provider: 'google',
    usage: usageMetadata
      ? {
          inputTokens: usageMetadata.promptTokenCount || 0,
          outputTokens: usageMetadata.candidatesTokenCount || 0,
          totalTokens: usageMetadata.totalTokenCount || 0,
        }
      : undefined,
    finishReason: response.candidates?.[0]?.finishReason ?? undefined,
  };
}
