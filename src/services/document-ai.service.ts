/**
 * Document AI Service
 *
 * AI assistance for document and template editing, including:
 * - Content drafting
 * - Text rephrasing
 * - Legal term explanations
 * - Placeholder suggestions
 * - Document review
 */

import { callAIWithConnector, getBestAvailableModelForWorkspace } from '@/lib/ai';
import type { AIModel } from '@/lib/ai';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma';
import { createLogger } from '@/lib/logger';

// Document category type (string union instead of Prisma enum for flexibility)
export type DocumentCategory = 'RESOLUTION' | 'MINUTES' | 'CONTRACT' | 'LETTER' | 'NOTICE' | 'FORM' | 'REPORT' | 'OTHER';

const log = createLogger('document-ai');

/**
 * Strip HTML tags from content for AI processing
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

// ============================================================================
// Types
// ============================================================================

export type AIContextMode = 'template_editor' | 'document_editor';

export interface AIContext {
  mode: AIContextMode;
  templateCategory?: DocumentCategory;
  templateName?: string;
  companyContext?: CompanyContext;
  selectedText?: string;
  cursorPosition?: number;
  surroundingContent?: string;
}

export interface CompanyContext {
  name: string;
  uen: string;
  entityType: string;
  directors: Array<{ name: string; role: string }>;
  shareholders: Array<{ name: string; percentage: number }>;
}

export interface AIChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}

export interface AIChatParams {
  tenantId: string;
  userId: string;
  message: string;
  context: AIContext;
  model?: AIModel;
  conversationId?: string;
  conversationHistory?: AIChatMessage[];
}

export interface AIChatResponse {
  message: string;
  conversationId: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AIAction {
  type: 'draft' | 'rephrase' | 'explain' | 'suggest_placeholders' | 'review' | 'general';
  label: string;
  description: string;
  promptTemplate: string;
}

// ============================================================================
// System Prompts
// ============================================================================

const DOCUMENT_AI_SYSTEM_PROMPT = `You are an AI assistant helping with corporate document drafting.
You specialize in Singapore corporate secretarial documents including:
- Directors' resolutions
- Shareholders' resolutions
- Board meeting minutes
- Corporate letters and notices
- Company constitutional documents

Guidelines:
1. Use formal legal language appropriate for corporate documents
2. Reference Singapore Companies Act where relevant
3. When writing templates, use placeholder syntax: {{placeholder.name}}
4. Be concise and professional
5. For resolutions, use proper numbering and structure
6. Always include proper signature blocks when appropriate
7. IMPORTANT: Respond with plain text only. Do NOT use HTML tags, markdown formatting, or code blocks in your responses.`;

function buildContextPrompt(context: AIContext): string {
  const parts: string[] = [];

  if (context.mode === 'template_editor') {
    parts.push('You are helping edit a document TEMPLATE that will be used to generate multiple documents.');
    parts.push('Templates use Handlebars-style placeholders like {{company.name}}, {{directors}}, etc.');
    parts.push('When drafting content, include appropriate placeholders for dynamic data.');
  } else {
    parts.push('You are helping edit a specific DOCUMENT that has been generated from a template.');
    parts.push('The document has already been populated with company data.');
  }

  if (context.templateCategory) {
    parts.push(`\nDocument Category: ${context.templateCategory}`);
  }

  if (context.templateName) {
    parts.push(`Template Name: ${context.templateName}`);
  }

  if (context.companyContext) {
    const { companyContext } = context;
    parts.push(`\nCompany Context:`);
    parts.push(`- Name: ${companyContext.name}`);
    parts.push(`- UEN: ${companyContext.uen}`);
    parts.push(`- Type: ${companyContext.entityType}`);

    if (companyContext.directors.length > 0) {
      parts.push(`- Directors: ${companyContext.directors.map((d) => d.name).join(', ')}`);
    }

    if (companyContext.shareholders.length > 0) {
      parts.push(`- Shareholders: ${companyContext.shareholders.map((s) => `${s.name} (${s.percentage}%)`).join(', ')}`);
    }
  }

  if (context.selectedText) {
    parts.push(`\nSelected Text:\n"${context.selectedText}"`);
  }

  if (context.surroundingContent) {
    parts.push(`\nSurrounding Content:\n${context.surroundingContent}`);
  }

  return parts.join('\n');
}

// ============================================================================
// Predefined Actions
// ============================================================================

export const AI_ACTIONS: AIAction[] = [
  {
    type: 'draft',
    label: 'Draft Content',
    description: 'Generate new content based on your description',
    promptTemplate: 'Please draft the following: {userInput}',
  },
  {
    type: 'rephrase',
    label: 'Rephrase',
    description: 'Rewrite the selected text in a different style',
    promptTemplate: 'Please rephrase the following text{style}: {selectedText}',
  },
  {
    type: 'explain',
    label: 'Explain',
    description: 'Explain legal or technical terms',
    promptTemplate: 'Please explain the following term or concept in simple terms: {userInput}',
  },
  {
    type: 'suggest_placeholders',
    label: 'Suggest Placeholders',
    description: 'Recommend placeholders for dynamic data',
    promptTemplate:
      'Analyze the following text and suggest appropriate placeholders for dynamic data. Use Handlebars syntax like {{company.name}}, {{directors}}, etc.\n\nText: {selectedText}',
  },
  {
    type: 'review',
    label: 'Review',
    description: 'Check document for errors or improvements',
    promptTemplate:
      'Please review the following document section for completeness, accuracy, and potential improvements:\n\n{selectedText}',
  },
  {
    type: 'general',
    label: 'Ask Question',
    description: 'Ask any question about document drafting',
    promptTemplate: '{userInput}',
  },
];

// ============================================================================
// Main Chat Function
// ============================================================================

/**
 * Send a message to the AI assistant
 */
export async function sendAIChatMessage(params: AIChatParams): Promise<AIChatResponse> {
  const { tenantId, userId, message, context, model, conversationId, conversationHistory = [] } = params;

  // Get best available model if not specified
  const selectedModel = model || (await getBestAvailableModelForWorkspace(tenantId));
  if (!selectedModel) {
    throw new Error('No AI model available. Please configure an AI provider.');
  }

  // Build system prompt with context
  const systemPrompt = `${DOCUMENT_AI_SYSTEM_PROMPT}\n\n${buildContextPrompt(context)}`;

  // Build user prompt with conversation history
  let userPrompt = '';

  // Add conversation history to context
  if (conversationHistory.length > 0) {
    userPrompt += 'Previous conversation:\n';
    for (const msg of conversationHistory) {
      if (msg.role === 'user') {
        userPrompt += `User: ${msg.content}\n`;
      } else if (msg.role === 'assistant') {
        userPrompt += `Assistant: ${msg.content}\n`;
      }
    }
    userPrompt += '\nCurrent request:\n';
  }

  // Add current message
  userPrompt += message;

  try {
    const response = await callAIWithConnector({
      tenantId,
      userId,
      model: selectedModel,
      systemPrompt,
      userPrompt,
      maxTokens: 2000,
      temperature: 0.7,
      operation: 'document_ai_chat',
      usageMetadata: {
        contextMode: context.mode,
        templateCategory: context.templateCategory,
        hasSelectedText: !!context.selectedText,
      },
    });

    // Generate or reuse conversation ID
    const convId = conversationId || generateConversationId();

    return {
      message: response.content,
      conversationId: convId,
      usage: response.usage
        ? {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        }
        : undefined,
    };
  } catch (error) {
    log.error('AI chat error:', error);
    throw error;
  }
}

/**
 * Generate a unique conversation ID
 */
function generateConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// Quick Actions
// ============================================================================

/**
 * Draft content based on user description
 */
export async function draftContent(
  tenantId: string,
  userId: string,
  description: string,
  context: AIContext,
  model?: AIModel
): Promise<AIChatResponse> {
  const prompt = `Please draft the following content for a corporate document:

${description}

${context.mode === 'template_editor' ? 'Include appropriate placeholders ({{placeholder.name}}) for dynamic company data.' : ''}

Provide only the drafted content as plain text. Use proper paragraph breaks and formatting but do NOT use HTML tags.`;

  return sendAIChatMessage({
    tenantId,
    userId,
    message: prompt,
    context,
    model,
  });
}

/**
 * Rephrase selected text
 */
export async function rephraseText(
  tenantId: string,
  userId: string,
  text: string,
  style: 'formal' | 'simplified' | 'concise' | 'detailed',
  context: AIContext,
  model?: AIModel
): Promise<AIChatResponse> {
  // Strip HTML for cleaner AI processing
  const plainText = stripHtml(text);

  const styleDescriptions: Record<string, string> = {
    formal: 'in more formal legal language',
    simplified: 'in simpler, more accessible language',
    concise: 'in a more concise manner',
    detailed: 'with more detail and explanation',
  };

  const prompt = `Please rephrase the following text ${styleDescriptions[style]}:

"${plainText}"

Provide only the rephrased text as plain text, maintaining the same meaning but adjusting the style as requested.`;

  return sendAIChatMessage({
    tenantId,
    userId,
    message: prompt,
    context: { ...context, selectedText: plainText },
    model,
  });
}

/**
 * Explain a term or concept
 */
export async function explainTerm(
  tenantId: string,
  userId: string,
  term: string,
  context: AIContext,
  model?: AIModel
): Promise<AIChatResponse> {
  const prompt = `Please explain the following term or concept in the context of Singapore corporate documents:

"${term}"

Provide:
1. A brief definition
2. How it's typically used in corporate documents
3. Any relevant references to the Singapore Companies Act (if applicable)`;

  return sendAIChatMessage({
    tenantId,
    userId,
    message: prompt,
    context,
    model,
  });
}

/**
 * Suggest placeholders for text
 */
export async function suggestPlaceholders(
  tenantId: string,
  userId: string,
  text: string,
  context: AIContext,
  model?: AIModel
): Promise<AIChatResponse> {
  const prompt = `Analyze the following text from a document template and suggest appropriate placeholders for dynamic data:

"${text}"

Available placeholder categories:
- company.* (name, uen, registeredAddress, incorporationDate, entityType)
- directors (array of director objects with name, identificationNumber, nationality, appointmentDate)
- shareholders (array of shareholder objects with name, shareClass, numberOfShares, percentageHeld)
- system.* (currentDate, generatedBy)
- custom.* (any custom fields like resolutionNumber, effectiveDate)

For each suggestion:
1. Identify the text that should be replaced
2. Suggest the appropriate placeholder
3. Explain why this placeholder is appropriate

Use Handlebars syntax: {{placeholder.name}} for simple values, {{#each collection}} for arrays.`;

  return sendAIChatMessage({
    tenantId,
    userId,
    message: prompt,
    context: { ...context, selectedText: text },
    model,
  });
}

/**
 * Review document for completeness and accuracy
 */
export async function reviewDocument(
  tenantId: string,
  userId: string,
  content: string,
  context: AIContext,
  model?: AIModel
): Promise<AIChatResponse> {
  // Strip HTML for cleaner AI processing
  const plainContent = stripHtml(content);

  const prompt = `Please review the following ${context.mode === 'template_editor' ? 'document template' : 'document'} for:

1. Completeness - Are all required sections present?
2. Legal accuracy - Is the language appropriate for Singapore corporate documents?
3. Placeholder usage - Are placeholders correctly formatted? (templates only)
4. Structure - Is the document well-organized?
5. Potential issues - Any errors or areas for improvement?

Document content:
${plainContent}

Provide a structured review with specific recommendations as plain text.`;

  return sendAIChatMessage({
    tenantId,
    userId,
    message: prompt,
    context: { ...context, surroundingContent: plainContent },
    model,
  });
}

// ============================================================================
// Conversation Persistence (Optional)
// ============================================================================

export interface PersistedConversation {
  id: string;
  tenantId: string;
  userId: string;
  contextType: 'template' | 'document';
  contextId?: string;
  messages: AIChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Save conversation to database
 * Note: Requires AIConversation model in Prisma schema
 */
export async function saveConversation(
  tenantId: string,
  userId: string,
  conversationId: string,
  contextType: 'template' | 'document',
  contextId: string | undefined,
  messages: AIChatMessage[]
): Promise<void> {
  try {
    await prisma.aiConversation.upsert({
      where: { id: conversationId },
      update: {
        messages: messages as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
      create: {
        id: conversationId,
        tenantId,
        userId,
        contextType,
        contextId,
        messages: messages as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    // AIConversation model may not exist yet - log and continue
    log.debug('Could not save conversation (model may not exist):', error);
  }
}

/**
 * Load conversation from database
 */
export async function loadConversation(
  conversationId: string
): Promise<PersistedConversation | null> {
  try {
    const conversation = await prisma.aiConversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) return null;

    return {
      id: conversation.id,
      tenantId: conversation.tenantId,
      userId: conversation.userId,
      contextType: conversation.contextType as 'template' | 'document',
      contextId: conversation.contextId ?? undefined,
      messages: conversation.messages as unknown as AIChatMessage[],
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  } catch (error) {
    // AIConversation model may not exist yet
    log.debug('Could not load conversation (model may not exist):', error);
    return null;
  }
}

/**
 * Delete conversation from database
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  try {
    await prisma.aiConversation.delete({
      where: { id: conversationId },
    });
  } catch (error) {
    log.debug('Could not delete conversation:', error);
  }
}

/**
 * Get recent conversations for a context
 */
export async function getRecentConversations(
  tenantId: string,
  userId: string,
  contextType: 'template' | 'document',
  contextId?: string,
  limit: number = 10
): Promise<PersistedConversation[]> {
  try {
    const conversations = await prisma.aiConversation.findMany({
      where: {
        tenantId,
        userId,
        contextType,
        ...(contextId ? { contextId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    return conversations.map((conv) => ({
      id: conv.id,
      tenantId: conv.tenantId,
      userId: conv.userId,
      contextType: conv.contextType as 'template' | 'document',
      contextId: conv.contextId ?? undefined,
      messages: conv.messages as unknown as AIChatMessage[],
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }));
  } catch (error) {
    log.debug('Could not get conversations:', error);
    return [];
  }
}
