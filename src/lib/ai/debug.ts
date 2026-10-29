/**
 * AI Debug Logger
 *
 * Provides detailed logging for AI calls when AI_DEBUG=true
 * Writes debug logs to docs/AI_DEBUG.md file
 */

import { createLogger } from '@/lib/logger';
import type { AIRequestOptions, AIResponse } from './types';
import { calculateUsageCost } from './models';
import { stripMarkdownCodeBlocks } from './index';
import * as fs from 'fs';
import * as path from 'path';

const log = createLogger('ai-debug');

// Path to the debug log file
const DEBUG_FILE_PATH = path.join(process.cwd(), 'docs', 'debug', 'AI_DEBUG.md');

// Check if AI debug mode is enabled
export function isAIDebugEnabled(): boolean {
  return process.env.AI_DEBUG === 'true';
}

// Check individual debug flags
export function shouldLogPrompts(): boolean {
  return process.env.AI_DEBUG_LOG_PROMPTS !== 'false'; // Default true
}

export function shouldLogResponses(): boolean {
  return process.env.AI_DEBUG_LOG_RESPONSES !== 'false'; // Default true
}

export function shouldLogImages(): boolean {
  return process.env.AI_DEBUG_LOG_IMAGES === 'true'; // Default false
}

// Cost estimation per 1K tokens (as of late 2024)
const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-vision': { input: 0.01, output: 0.03 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = COST_PER_1K[model] || { input: 0.001, output: 0.002 };
  return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
}

export interface AIDebugContext {
  operation: string;
  model: string;
  provider: string;
  tenantId?: string | null;
  userId?: string | null;
  connectorSource?: 'workspace' | 'tenant' | 'system' | 'env';
  connectorId?: string | null;
  connectorName?: string | null;
  startTime: number;
  coaAccountCount?: number;
  logLines: string[];
}

/**
 * Format timestamp for log entries
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Append debug log entry to the AI_DEBUG.md file
 */
function appendToDebugFile(content: string): void {
  try {
    // Ensure the docs directory exists
    const docsDir = path.dirname(DEBUG_FILE_PATH);
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }

    // Check if file exists and has the header
    let existingContent = '';
    if (fs.existsSync(DEBUG_FILE_PATH)) {
      existingContent = fs.readFileSync(DEBUG_FILE_PATH, 'utf-8');
    }

    // If file doesn't have proper header, add it
    if (!existingContent.includes('# AI Debug Log')) {
      const header = `# AI Debug Log

This file contains debug logs for AI extraction calls when \`AI_DEBUG=true\`.

---

`;
      existingContent = header;
    }

    // Append new content
    const newContent = existingContent + content + '\n';
    fs.writeFileSync(DEBUG_FILE_PATH, newContent, 'utf-8');
  } catch (error) {
    log.error('Failed to write to AI debug file:', error);
  }
}

/**
 * Log the start of an AI request
 */
export function logAIRequestStart(
  options: AIRequestOptions & { tenantId?: string | null; userId?: string | null; operation?: string },
  provider: string,
  coaAccountCount?: number
): AIDebugContext | null {
  if (!isAIDebugEnabled()) return null;

  const context: AIDebugContext = {
    operation: options.operation || 'unknown',
    model: options.model,
    provider,
    tenantId: options.tenantId ?? undefined,
    userId: options.userId ?? undefined,
    startTime: Date.now(),
    coaAccountCount,
    logLines: [],
  };

  // Build log entry
  const lines: string[] = [];
  lines.push(`## AI Request - ${formatTimestamp()}`);
  lines.push('');
  lines.push('### Request Details');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Operation | ${context.operation} |`);
  lines.push(`| Model | ${context.model} |`);
  lines.push(`| Provider | ${context.provider} |`);
  if (context.tenantId) lines.push(`| Tenant | ${context.tenantId} |`);
  if (context.userId) lines.push(`| User | ${context.userId} |`);
  lines.push(`| Temperature | ${options.temperature ?? 'default'} |`);
  lines.push(`| JSON Mode | ${options.jsonMode ?? false} |`);

  // Log image info
  if (options.images && options.images.length > 0) {
    const imageInfo = options.images.map((img, idx) => {
      const sizeKB = Math.round((img.base64?.length || 0) * 0.75 / 1024);
      return `Image ${idx + 1}: ${img.mimeType} (~${sizeKB}KB)`;
    });
    lines.push(`| Images | ${options.images.length} |`);
    if (shouldLogImages()) {
      imageInfo.forEach((info) => lines.push(`| | ${info} |`));
    }
  }

  // Log COA context presence
  if (coaAccountCount !== undefined) {
    lines.push(`| COA Context | Yes (${coaAccountCount} accounts) |`);
  } else {
    lines.push(`| COA Context | No |`);
  }
  lines.push('');

  // Log prompt
  if (shouldLogPrompts() && options.userPrompt) {
    lines.push('<details>');
    lines.push(`<summary>Prompt (${options.userPrompt.length} chars)</summary>`);
    lines.push('');
    lines.push('```');
    lines.push(options.userPrompt);
    lines.push('```');
    lines.push('</details>');
    lines.push('');
  }

  context.logLines = lines;

  // Also log to console for immediate feedback
  log.info(`AI Request started: ${context.operation} using ${context.model}`);

  return context;
}

/**
 * Log the AI response
 */
export function logAIResponse(
  context: AIDebugContext | null,
  response: AIResponse,
  error?: Error
): void {
  if (!isAIDebugEnabled() || !context) return;

  const latencyMs = Date.now() - context.startTime;
  const lines = context.logLines;

  lines.push('### Response');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Status | ${error ? '❌ Error' : '✅ Success'} |`);
  lines.push(`| Latency | ${latencyMs}ms |`);

  if (response.usage) {
    lines.push(`| Input Tokens | ${response.usage.inputTokens} |`);
    lines.push(`| Output Tokens | ${response.usage.outputTokens} |`);
    lines.push(`| Total Tokens | ${response.usage.totalTokens} |`);
    if (typeof response.usage.pagesProcessed === 'number') {
      lines.push(`| Pages Processed | ${response.usage.pagesProcessed} |`);
    }
    if (typeof response.usage.batchMode === 'boolean') {
      lines.push(`| Pricing Mode | ${response.usage.batchMode ? 'Batch' : 'Direct'} |`);
    }
    const cost = calculateUsageCost({
      modelId: context.model,
      provider: context.provider,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      totalTokens: response.usage.totalTokens,
      pagesProcessed: response.usage.pagesProcessed,
      batchMode: response.usage.batchMode,
    });
    lines.push(`| Estimated Cost | $${cost.toFixed(4)} |`);
  }
  if (context.connectorSource) lines.push(`| Connector Source | ${context.connectorSource} |`);
  if (context.connectorId) lines.push(`| Connector ID | ${context.connectorId} |`);
  if (context.connectorName) lines.push(`| Connector Name | ${context.connectorName} |`);
  lines.push('');

  if (shouldLogResponses() && response.content) {
    lines.push('<details>');
    lines.push(`<summary>Response (${response.content.length} chars)</summary>`);
    lines.push('');
    lines.push('```json');
    // Try to pretty print JSON (strip markdown code blocks if present)
    try {
      const cleanedContent = stripMarkdownCodeBlocks(response.content);
      const parsed = JSON.parse(cleanedContent);
      lines.push(JSON.stringify(parsed, null, 2));
    } catch {
      lines.push(response.content);
    }
    lines.push('```');
    lines.push('</details>');
    lines.push('');
  }

  if (error) {
    lines.push('### Error');
    lines.push(`- **Type**: ${error.constructor.name}`);
    lines.push(`- **Message**: ${error.message}`);
    lines.push(`- **Retryable**: ${isRetryableError(error)}`);
    if (error.stack) {
      lines.push('<details>');
      lines.push('<summary>Stack Trace</summary>');
      lines.push('');
      lines.push('```');
      lines.push(error.stack);
      lines.push('```');
      lines.push('</details>');
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Write to file
  appendToDebugFile(lines.join('\n'));

  // Also log to console
  log.info(`AI Response: ${error ? 'Error' : 'Success'} in ${latencyMs}ms`);
}

/**
 * Log AI error details
 */
export function logAIError(context: AIDebugContext | null, error: Error): void {
  if (!isAIDebugEnabled()) return;

  const lines: string[] = [];
  lines.push(`## AI Error - ${formatTimestamp()}`);
  lines.push('');

  if (context) {
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    lines.push(`| Operation | ${context.operation} |`);
    lines.push(`| Model | ${context.model} |`);
    lines.push(`| Provider | ${context.provider} |`);
    if (context.connectorSource) lines.push(`| Connector Source | ${context.connectorSource} |`);
    if (context.connectorId) lines.push(`| Connector ID | ${context.connectorId} |`);
    if (context.connectorName) lines.push(`| Connector Name | ${context.connectorName} |`);
    lines.push('');
  }

  lines.push('### Error Details');
  lines.push(`- **Type**: ${error.constructor.name}`);
  lines.push(`- **Message**: ${error.message}`);
  lines.push(`- **Retryable**: ${isRetryableError(error)}`);

  if (error.stack) {
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>Stack Trace</summary>');
    lines.push('');
    lines.push('```');
    lines.push(error.stack);
    lines.push('```');
    lines.push('</details>');
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // Write to file
  appendToDebugFile(lines.join('\n'));

  // Also log to console
  log.error(`AI Error: ${error.message}`);
}

/**
 * Log extraction results summary
 */
export function logExtractionResults(
  context: AIDebugContext | null,
  results: {
    documentCategory?: { value: string; confidence?: number };
    vendorName?: { value: string; confidence?: number };
    totalAmount?: { value: string; confidence?: number };
    currency?: { value: string; confidence?: number };
    lineItems?: Array<{
      lineNo: number;
      description?: { value: string };
      accountCode?: { value: string; confidence?: number };
    }>;
  }
): void {
  if (!isAIDebugEnabled()) return;

  const lines: string[] = [];
  lines.push(`## Extraction Results - ${formatTimestamp()}`);
  lines.push('');
  lines.push('### Document Fields');
  lines.push('| Field | Value | Confidence |');
  lines.push('|-------|-------|------------|');

  if (results.documentCategory) {
    lines.push(`| Document Category | ${results.documentCategory.value} | ${results.documentCategory.confidence?.toFixed(2) ?? 'N/A'} |`);
  }

  if (results.vendorName) {
    lines.push(`| Vendor | ${results.vendorName.value} | ${results.vendorName.confidence?.toFixed(2) ?? 'N/A'} |`);
  }

  if (results.totalAmount) {
    lines.push(`| Total Amount | ${results.totalAmount.value} ${results.currency?.value || ''} | ${results.totalAmount.confidence?.toFixed(2) ?? 'N/A'} |`);
  }
  lines.push('');

  if (results.lineItems && results.lineItems.length > 0) {
    lines.push('### Line Item Account Codes');
    lines.push('| Line | Account Code | Confidence | Description |');
    lines.push('|------|--------------|------------|-------------|');

    results.lineItems.forEach((item) => {
      const desc = item.description?.value || 'Unknown';
      const truncatedDesc = desc.length > 50 ? desc.substring(0, 47) + '...' : desc;
      const accountCode = item.accountCode?.value || '❌ NOT ASSIGNED';
      const confidence = item.accountCode?.confidence?.toFixed(2) ?? '-';
      lines.push(`| ${item.lineNo} | ${accountCode} | ${confidence} | ${truncatedDesc} |`);
    });
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Write to file
  appendToDebugFile(lines.join('\n'));

  // Also log to console
  log.info(`Extraction Results: ${results.lineItems?.length || 0} line items processed`);
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('timeout') ||
    message.includes('temporarily') ||
    message.includes('overloaded') ||
    message.includes('503') ||
    message.includes('429')
  );
}

/**
 * Clear the debug log file (useful for starting fresh)
 */
export function clearDebugLog(): void {
  try {
    const header = `# AI Debug Log

This file contains debug logs for AI extraction calls when \`AI_DEBUG=true\`.

**Log cleared at**: ${formatTimestamp()}

---

`;
    fs.writeFileSync(DEBUG_FILE_PATH, header, 'utf-8');
    log.info('AI debug log cleared');
  } catch (error) {
    log.error('Failed to clear AI debug log:', error);
  }
}
