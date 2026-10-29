import { createLogger } from '@/lib/logger';
import { stripMarkdownCodeBlocks } from '@/lib/ai';
import { jsonrepair } from 'jsonrepair';
import { MISTRAL_OCR_MODEL_ID } from './constants';
export { MISTRAL_OCR_MODEL_ID, MISTRAL_OCR_MODEL_NAME } from './constants';

const log = createLogger('mistral-ocr');

export interface MistralOCRDocumentInput {
  base64: string;
  mimeType: string;
}

export interface MistralOCRUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  pagesProcessed?: number;
  docSizeBytes?: number | null;
  batchMode?: boolean;
}

export interface MistralOCRResult<T> {
  model: string;
  provider: 'mistral';
  documentAnnotation: T;
  pages: Array<{ index: number; markdown?: string }>;
  usage: MistralOCRUsage;
  raw: unknown;
}

export interface ExtractStructuredWithMistralOCROptions {
  document: MistralOCRDocumentInput;
  prompt: string;
  tenantId: string | null;
  userId?: string | null;
  operation?: string;
  usageMetadata?: Record<string, unknown>;
  schemaName?: string;
  jsonSchema?: Record<string, unknown>;
}

interface MistralOCRApiResponse {
  pages?: Array<{
    index?: number;
    markdown?: string;
  }>;
  model?: string;
  document_annotation?: string | Record<string, unknown> | null;
  usage_info?: {
    pages_processed?: number;
    doc_size_bytes?: number | null;
  };
}

type MistralBatchJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'TIMEOUT_EXCEEDED'
  | 'CANCELLATION_REQUESTED'
  | 'CANCELLED';

interface MistralBatchJobResponse {
  id: string;
  status: MistralBatchJobStatus;
  total_requests?: number;
  succeeded_requests?: number;
  failed_requests?: number;
  errors?: Array<{ message?: string }>;
  outputs?: Array<Record<string, unknown>> | null;
}

export interface SubmitMistralOCRBatchJobOptions extends ExtractStructuredWithMistralOCROptions {
  customId: string;
  metadata?: Record<string, string>;
  timeoutHours?: number;
}

interface InspectMistralOCRBatchJobOptions
  extends Omit<ExtractStructuredWithMistralOCROptions, 'document'> {
  logAIDebug?: boolean;
}

export interface MistralOCRBatchInspectionPending {
  status: 'QUEUED' | 'RUNNING' | 'CANCELLATION_REQUESTED';
  jobId: string;
  totalRequests: number;
  succeededRequests: number;
  failedRequests: number;
  raw: unknown;
}

export interface MistralOCRBatchInspectionFailed {
  status: 'FAILED' | 'TIMEOUT_EXCEEDED' | 'CANCELLED';
  jobId: string;
  errorMessage: string;
  raw: unknown;
}

export interface MistralOCRBatchInspectionSuccess<T> {
  status: 'SUCCESS';
  jobId: string;
  result: MistralOCRResult<T>;
  raw: unknown;
}

export type MistralOCRBatchInspection<T> =
  | MistralOCRBatchInspectionPending
  | MistralOCRBatchInspectionFailed
  | MistralOCRBatchInspectionSuccess<T>;

class ResolvedMistralConfig {
  apiKey: string;
  connectorId: string | null;

  constructor(apiKey: string, connectorId: string | null) {
    this.apiKey = apiKey;
    this.connectorId = connectorId;
  }
}

export class MistralOCRNotConfiguredError extends Error {
  constructor(message = 'Mistral OCR is not configured') {
    super(message);
    this.name = 'MistralOCRNotConfiguredError';
  }
}

export function isMistralOCRConfigured(): boolean {
  return Boolean(process.env.MISTRAL_API_KEY?.trim());
}

function buildDocumentAnnotationFormat(
  schemaName = 'document_annotation',
  jsonSchema: Record<string, unknown> = {
    type: 'object',
    additionalProperties: true,
  }
) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: schemaName,
      schema: jsonSchema,
    },
  };
}

function buildDocumentPayload(document: MistralOCRDocumentInput) {
  const dataUrl = `data:${document.mimeType};base64,${document.base64}`;

  if (document.mimeType.startsWith('image/')) {
    return {
      type: 'image_url' as const,
      image_url: dataUrl,
    };
  }

  return {
    type: 'document_url' as const,
    document_url: dataUrl,
  };
}

async function resolveMistralConfig(
  tenantId: string | null
): Promise<ResolvedMistralConfig> {
  const { resolveConnector } = await import('@/services/connector.service');

  const resolved = await resolveConnector(tenantId, 'AI_PROVIDER', 'MISTRAL');
  if (resolved) {
    const credentials = resolved.connector.credentials as { apiKey?: unknown };
    const apiKey =
      typeof credentials.apiKey === 'string' ? credentials.apiKey.trim() : '';

    if (!apiKey) {
      throw new Error(`Mistral connector "${resolved.connector.name}" is missing an API key`);
    }

    return new ResolvedMistralConfig(apiKey, resolved.connector.id);
  }

  const envApiKey = process.env.MISTRAL_API_KEY?.trim();
  if (envApiKey) {
    return new ResolvedMistralConfig(envApiKey, null);
  }

  throw new MistralOCRNotConfiguredError(
    'No Mistral OCR provider available. Configure a MISTRAL connector or set MISTRAL_API_KEY.'
  );
}

async function parseErrorMessage(response: Response): Promise<string> {
  const payload = await response
    .json()
    .catch(async () => ({ message: await response.text().catch(() => '') })) as
    | {
        message?: string;
        error?: string | { message?: string };
        detail?: string;
      }
    | null;

  return (
    payload?.message ||
    (typeof payload?.error === 'string' ? payload.error : payload?.error?.message) ||
    payload?.detail ||
    `Mistral OCR request failed with status ${response.status}`
  );
}

function normalizeJsonCandidate(content: string): string {
  return content
    .replace(/^\uFEFF/, '')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

function decodeSingleQuotedValue(value: string): string {
  return value
    .replace(/\\\\/g, '\\')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"');
}

function repairJsonLikeCandidate(content: string): string {
  return normalizeJsonCandidate(content)
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '')
    .replace(/(:\s*-?\d+)\.(?=\s*[,}\]])/g, '$1.0')
    .replace(/([\[,]\s*-?)\.(\d+)/g, '$10.$2')
    .replace(
      /([{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'(\s*:)/g,
      (_match, prefix: string, key: string, suffix: string) =>
        `${prefix}${JSON.stringify(decodeSingleQuotedValue(key))}${suffix}`
    )
    .replace(
      /([{,]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)(\s*:)/g,
      (_match, prefix: string, key: string, suffix: string) => `${prefix}"${key}"${suffix}`
    )
    .replace(
      /(:\s*)'([^'\\]*(?:\\.[^'\\]*)*)'(?=\s*[,}\]])/g,
      (_match, prefix: string, value: string) =>
        `${prefix}${JSON.stringify(decodeSingleQuotedValue(value))}`
    )
    .replace(
      /([\[,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'(?=\s*[,}\]])/g,
      (_match, prefix: string, value: string) =>
        `${prefix}${JSON.stringify(decodeSingleQuotedValue(value))}`
    )
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

function insertMissingCommasBetweenJsonTokens(content: string): string {
  return content.replace(
    /([}\]"0-9eElnrufsat])(\s*)(?=(?:\{|\[|"|-?\d|true\b|false\b|null\b))/g,
    '$1,$2'
  );
}

function extractJsonErrorPosition(error: Error | null): number | null {
  const syntaxError = error instanceof SyntaxError ? error : null;
  const match = syntaxError?.message.match(/position (\d+)/i);
  if (!match) return null;

  const position = parseInt(match[1], 10);
  return Number.isFinite(position) ? position : null;
}

function findPreviousNonWhitespace(content: string, startIndex: number): number {
  for (let index = Math.min(startIndex, content.length - 1); index >= 0; index -= 1) {
    if (!/\s/.test(content[index])) {
      return index;
    }
  }

  return -1;
}

function findNextNonWhitespace(content: string, startIndex: number): number {
  for (let index = Math.max(0, startIndex); index < content.length; index += 1) {
    if (!/\s/.test(content[index])) {
      return index;
    }
  }

  return -1;
}

function isJsonValueBoundaryCharacter(character: string | undefined): boolean {
  if (!character) return false;
  return /[\]}"\d.\-+eElnrufsat]/.test(character);
}

function repairJsonSyntaxError(content: string, error: Error | null): string | null {
  const errorPosition = extractJsonErrorPosition(error);
  if (errorPosition === null) {
    return null;
  }

  const nextIndex = findNextNonWhitespace(content, errorPosition);
  const previousIndex = findPreviousNonWhitespace(content, nextIndex - 1);

  if (nextIndex === -1 || previousIndex === -1) {
    return null;
  }

  const previousChar = content[previousIndex];
  const nextChar = content[nextIndex];

  if (
    isJsonValueBoundaryCharacter(previousChar) &&
    (nextChar === '{' || nextChar === '[' || nextChar === '"')
  ) {
    return `${content.slice(0, nextIndex)},${content.slice(nextIndex)}`;
  }

  return null;
}

function parseDocumentAnnotation<T>(
  annotation: string | Record<string, unknown> | null | undefined
): T {
  if (typeof annotation === 'string') {
    const attempts = new Set<string>();
    const trimmed = annotation.trim();
    const stripped = stripMarkdownCodeBlocks(trimmed);
    const normalized = normalizeJsonCandidate(stripped);
    let jsonRepairCandidate: string | null = null;

    try {
      jsonRepairCandidate = jsonrepair(normalized);
    } catch {
      jsonRepairCandidate = null;
    }

    const repaired = repairJsonLikeCandidate(stripped);
    const commaRepaired = insertMissingCommasBetweenJsonTokens(repaired);

    attempts.add(trimmed);
    attempts.add(stripped);
    attempts.add(normalized);
    if (jsonRepairCandidate) {
      attempts.add(jsonRepairCandidate);
    }
    attempts.add(repaired);
    attempts.add(commaRepaired);

    let bestError: Error | null = null;
    let bestErrorPosition = -1;
    let bestErrorCandidate = repaired;

    for (const candidate of attempts) {
      if (!candidate) continue;

      const seenRepairs = new Set<string>();
      let currentCandidate = candidate;

      for (let repairPass = 0; repairPass < 4; repairPass += 1) {
        try {
          return JSON.parse(currentCandidate) as T;
        } catch (error) {
          const currentError = error instanceof Error ? error : new Error(String(error));
          const currentErrorPosition = extractJsonErrorPosition(currentError) ?? -1;
          if (currentErrorPosition >= bestErrorPosition) {
            bestError = currentError;
            bestErrorPosition = currentErrorPosition;
            bestErrorCandidate = currentCandidate;
          }

          const repairedCandidate = repairJsonSyntaxError(currentCandidate, currentError);

          if (!repairedCandidate || repairedCandidate === currentCandidate || seenRepairs.has(repairedCandidate)) {
            break;
          }

          seenRepairs.add(repairedCandidate);
          currentCandidate = repairedCandidate;
        }
      }
    }

    const errorPosition = extractJsonErrorPosition(bestError);
    const contextSnippet =
      errorPosition !== null
        ? bestErrorCandidate.slice(
            Math.max(0, errorPosition - 80),
            Math.min(bestErrorCandidate.length, errorPosition + 80)
          )
        : bestErrorCandidate.slice(0, 160);

    throw new SyntaxError(
      `${bestError?.message || 'Failed to parse document annotation'} | context: ${contextSnippet}`
    );
  }

  if (annotation && typeof annotation === 'object') {
    return annotation as T;
  }

  throw new Error('Mistral OCR did not return a structured document annotation');
}

function extractBatchOutputBody(
  outputs: Array<Record<string, unknown>> | null | undefined
): MistralOCRApiResponse {
  const firstOutput = outputs?.[0];
  if (!firstOutput) {
    throw new Error('Mistral batch job completed without any outputs');
  }

  const candidates: unknown[] = [
    firstOutput.body,
    firstOutput.output,
    firstOutput.response && typeof firstOutput.response === 'object'
      ? (firstOutput.response as Record<string, unknown>).body
      : undefined,
    firstOutput,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') {
      const response = candidate as MistralOCRApiResponse;
      if (response.document_annotation || response.pages || response.usage_info) {
        return response;
      }
    }
  }

  throw new Error('Unable to parse Mistral batch OCR output payload');
}

export async function submitMistralOCRBatchJob(
  options: SubmitMistralOCRBatchJobOptions
): Promise<{ jobId: string }> {
  const resolvedConfig = await resolveMistralConfig(options.tenantId);

  const response = await fetch('https://api.mistral.ai/v1/batch/jobs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolvedConfig.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      endpoint: '/v1/ocr',
      model: MISTRAL_OCR_MODEL_ID,
      requests: [
        {
          custom_id: options.customId,
          body: {
            model: MISTRAL_OCR_MODEL_ID,
            document: buildDocumentPayload(options.document),
            document_annotation_format: buildDocumentAnnotationFormat(
              options.schemaName,
              options.jsonSchema
            ),
            document_annotation_prompt: options.prompt,
          },
        },
      ],
      timeout_hours: options.timeoutHours ?? 24,
      metadata: options.metadata,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const data = (await response.json()) as { id?: string };
  if (!data.id) {
    throw new Error('Mistral batch job creation did not return a job ID');
  }

  return { jobId: data.id };
}

export async function inspectMistralOCRBatchJob<T>(
  jobId: string,
  options: InspectMistralOCRBatchJobOptions
): Promise<MistralOCRBatchInspection<T>> {
  const { logConnectorUsage } = await import('@/services/connector-usage.service');
  const { logAIRequestStart, logAIResponse, logAIError } = await import('@/lib/ai/debug');
  const shouldLogAIDebug = options.logAIDebug ?? true;

  const resolvedConfig = await resolveMistralConfig(options.tenantId);
  const response = await fetch(`https://api.mistral.ai/v1/batch/jobs/${jobId}?inline=true`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${resolvedConfig.apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const job = (await response.json()) as MistralBatchJobResponse;

  if (job.status === 'QUEUED' || job.status === 'RUNNING' || job.status === 'CANCELLATION_REQUESTED') {
    return {
      status: job.status,
      jobId,
      totalRequests: job.total_requests ?? 0,
      succeededRequests: job.succeeded_requests ?? 0,
      failedRequests: job.failed_requests ?? 0,
      raw: job,
    };
  }

  if (job.status !== 'SUCCESS') {
    const error = new Error(
      job.errors?.map((entry) => entry.message).filter(Boolean).join(', ') ||
        `Mistral batch job ended with status ${job.status}`
    );
    if (shouldLogAIDebug) {
      logAIError(
        logAIRequestStart(
          {
            model: MISTRAL_OCR_MODEL_ID as never,
            userPrompt: options.prompt,
            jsonMode: true,
            tenantId: options.tenantId,
            userId: options.userId,
          },
          'mistral' as never
        ),
        error
      );
    }
    return {
      status: job.status,
      jobId,
      errorMessage: error.message,
      raw: job,
    };
  }

  const responseData = extractBatchOutputBody(job.outputs);
  const documentAnnotation = parseDocumentAnnotation<T>(responseData.document_annotation);
  const pagesProcessed = responseData.usage_info?.pages_processed ?? 0;

  const debugContext = shouldLogAIDebug
    ? logAIRequestStart(
        {
          model: MISTRAL_OCR_MODEL_ID as never,
          userPrompt: options.prompt,
          jsonMode: true,
          tenantId: options.tenantId,
          userId: options.userId,
        },
        'mistral' as never
      )
    : null;

  if (debugContext) {
    debugContext.connectorSource = resolvedConfig.connectorId ? 'tenant' : 'env';
    debugContext.connectorId = resolvedConfig.connectorId;
  }

  if (shouldLogAIDebug) {
    logAIResponse(debugContext, {
      content: JSON.stringify(documentAnnotation),
      model: MISTRAL_OCR_MODEL_ID as never,
      provider: 'mistral' as never,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: pagesProcessed,
        pagesProcessed,
        batchMode: true,
      },
    });
  }

  if (resolvedConfig.connectorId) {
    await logConnectorUsage({
      connectorId: resolvedConfig.connectorId,
      tenantId: options.tenantId,
      userId: options.userId,
      model: MISTRAL_OCR_MODEL_ID,
      provider: 'mistral',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: pagesProcessed,
      operation: options.operation,
      success: true,
      metadata: {
        ...(options.usageMetadata ?? {}),
        batchMode: true,
        batchJobId: jobId,
        pagesProcessed,
        docSizeBytes: responseData.usage_info?.doc_size_bytes ?? null,
      },
    });
  }

  const result: MistralOCRResult<T> = {
    model: MISTRAL_OCR_MODEL_ID,
    provider: 'mistral',
    documentAnnotation,
    pages: (responseData.pages || []).map((page, index) => ({
      index: page.index ?? index,
      markdown: page.markdown,
    })),
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: pagesProcessed,
      pagesProcessed,
      docSizeBytes: responseData.usage_info?.doc_size_bytes ?? null,
      batchMode: true,
    },
    raw: responseData,
  };

  return {
    status: 'SUCCESS',
    jobId,
    result,
    raw: job,
  };
}

export async function extractStructuredWithMistralOCR<T>(
  options: ExtractStructuredWithMistralOCROptions
): Promise<MistralOCRResult<T>> {
  const { logConnectorUsage } = await import('@/services/connector-usage.service');
  const { logAIRequestStart, logAIResponse, logAIError } = await import('@/lib/ai/debug');

  const resolvedConfig = await resolveMistralConfig(options.tenantId);
  const startTime = Date.now();
  const debugContext = logAIRequestStart(
    {
      model: MISTRAL_OCR_MODEL_ID as never,
      userPrompt: options.prompt,
      jsonMode: true,
      tenantId: options.tenantId,
      userId: options.userId,
    },
    'mistral' as never
  );

  if (debugContext) {
    debugContext.connectorSource = resolvedConfig.connectorId ? 'tenant' : 'env';
    debugContext.connectorId = resolvedConfig.connectorId;
  }

  let responseData: MistralOCRApiResponse | null = null;
  let error: Error | null = null;

  try {
    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedConfig.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: MISTRAL_OCR_MODEL_ID,
        document: buildDocumentPayload(options.document),
        document_annotation_format: buildDocumentAnnotationFormat(
          options.schemaName,
          options.jsonSchema
        ),
        document_annotation_prompt: options.prompt,
      }),
    });

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }

    responseData = (await response.json()) as MistralOCRApiResponse;
    let documentAnnotation: T;
    try {
      documentAnnotation = parseDocumentAnnotation<T>(responseData.document_annotation);
    } catch (parseError) {
      if (typeof responseData.document_annotation === 'string') {
        log.error('Mistral OCR document_annotation parse preview', {
          preview: responseData.document_annotation.slice(0, 600),
        });
      }
      throw parseError;
    }
    const pagesProcessed = responseData.usage_info?.pages_processed ?? 0;
    const debugResponse = {
      content: JSON.stringify(documentAnnotation),
      model: MISTRAL_OCR_MODEL_ID as never,
      provider: 'mistral' as never,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: pagesProcessed,
        pagesProcessed,
        batchMode: false,
      },
    };

    logAIResponse(debugContext, debugResponse);

    return {
      model: MISTRAL_OCR_MODEL_ID,
      provider: 'mistral',
      documentAnnotation,
      pages: (responseData.pages || []).map((page, index) => ({
        index: page.index ?? index,
        markdown: page.markdown,
      })),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: pagesProcessed,
        pagesProcessed,
        docSizeBytes: responseData.usage_info?.doc_size_bytes ?? null,
        batchMode: false,
      },
      raw: responseData,
    };
  } catch (caughtError) {
    error = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
    log.error('Mistral OCR request failed', error);
    logAIError(debugContext, error);
    throw error;
  } finally {
    if (resolvedConfig.connectorId) {
      logConnectorUsage({
        connectorId: resolvedConfig.connectorId,
        tenantId: options.tenantId,
        userId: options.userId,
        model: MISTRAL_OCR_MODEL_ID,
        provider: 'mistral',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: responseData?.usage_info?.pages_processed ?? 0,
        latencyMs: Date.now() - startTime,
        operation: options.operation,
        success: !error,
        errorMessage: error?.message,
        metadata: {
          ...(options.usageMetadata ?? {}),
          batchMode: false,
          pagesProcessed: responseData?.usage_info?.pages_processed,
          docSizeBytes: responseData?.usage_info?.doc_size_bytes ?? null,
        },
      }).catch((usageError) => {
        log.error('Failed to log Mistral OCR usage', usageError);
      });
    }
  }
}
