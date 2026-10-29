import { createLogger } from '@/lib/logger';
import type { AIImageInput, AIModel, AIResponse, AICredentials } from '../types';
import {
  buildOpenAIChatCompletionRequest,
  getOpenAI,
  isOpenAIConfigured,
  parseOpenAIChatCompletionResponse,
} from './openai';

const log = createLogger('openai-batch');

type OpenAIBatchStatus =
  | 'validating'
  | 'in_progress'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelling'
  | 'cancelled';

interface ResolvedOpenAIConfig {
  credentials?: AICredentials['openai'];
  connectorId: string | null;
  connectorSource: 'workspace' | 'tenant' | 'system' | 'env';
}

interface OpenAIBatchObject {
  id: string;
  status: OpenAIBatchStatus;
  output_file_id?: string | null;
  error_file_id?: string | null;
  request_counts?: {
    total?: number;
    completed?: number;
    failed?: number;
  } | null;
}

interface OpenAIBatchOutputLine {
  custom_id?: string;
  response?: {
    status_code?: number;
    request_id?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body?: any;
  } | null;
  error?: {
    message?: string;
    code?: string;
  } | null;
}

export interface SubmitOpenAIBatchJobOptions {
  customId: string;
  tenantId: string | null;
  model: AIModel;
  userPrompt: string;
  systemPrompt?: string;
  images?: AIImageInput[];
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, string>;
}

export interface InspectOpenAIBatchJobOptions {
  tenantId: string | null;
  model: AIModel;
  userPrompt: string;
  userId?: string | null;
  operation?: string;
  usageMetadata?: Record<string, unknown>;
}

export interface OpenAIBatchInspectionPending {
  status: 'validating' | 'in_progress' | 'finalizing' | 'cancelling';
  jobId: string;
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  raw: unknown;
}

export interface OpenAIBatchInspectionFailed {
  status: 'failed' | 'expired' | 'cancelled';
  jobId: string;
  errorMessage: string;
  raw: unknown;
}

export interface OpenAIBatchInspectionSuccess {
  status: 'completed';
  jobId: string;
  result: AIResponse;
  raw: unknown;
}

export type OpenAIBatchInspection =
  | OpenAIBatchInspectionPending
  | OpenAIBatchInspectionFailed
  | OpenAIBatchInspectionSuccess;

async function resolveOpenAIConfig(tenantId: string | null): Promise<ResolvedOpenAIConfig> {
  const { resolveConnector } = await import('@/services/connector.service');

  const resolved = await resolveConnector(tenantId, 'AI_PROVIDER', 'OPENAI');
  if (resolved) {
    const credentials = resolved.connector.credentials as {
      apiKey?: string;
      organization?: string;
    };
    return {
      credentials: {
        apiKey: credentials.apiKey || '',
        organization: credentials.organization,
      },
      connectorId: resolved.connector.id,
      connectorSource: resolved.source,
    };
  }

  if (!isOpenAIConfigured()) {
    throw new Error('OpenAI API key not configured');
  }

  return {
    connectorId: null,
    connectorSource: 'env',
  };
}

function parseJsonLines<T>(content: string): T[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function readFileContent(
  openai: Awaited<ReturnType<typeof getOpenAI>>,
  fileId: string
): Promise<string> {
  const fileResponse = await openai.files.content(fileId);
  return await fileResponse.text();
}

async function readBatchErrorMessage(
  openai: Awaited<ReturnType<typeof getOpenAI>>,
  fileId?: string | null
): Promise<string | null> {
  if (!fileId) return null;
  try {
    const content = await readFileContent(openai, fileId);
    const lines = parseJsonLines<OpenAIBatchOutputLine>(content);
    const firstError = lines.find((line) => line.error?.message)?.error?.message;
    return firstError || null;
  } catch (error) {
    log.warn('Failed to read OpenAI batch error file', error);
    return null;
  }
}

export async function submitOpenAIBatchJob(
  options: SubmitOpenAIBatchJobOptions
): Promise<{ jobId: string; inputFileId: string }> {
  const resolvedConfig = await resolveOpenAIConfig(options.tenantId);
  const openai = await getOpenAI(resolvedConfig.credentials);
  const requestBody = buildOpenAIChatCompletionRequest({
    model: options.model,
    systemPrompt: options.systemPrompt,
    userPrompt: options.userPrompt,
    images: options.images,
    jsonMode: options.jsonMode,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  });

  const inputLine = JSON.stringify({
    custom_id: options.customId,
    method: 'POST',
    url: '/v1/chat/completions',
    body: requestBody,
  });

  const inputFile = await openai.files.create({
    file: new File([`${inputLine}\n`], `processing-${options.customId}.jsonl`, {
      type: 'application/jsonl',
    }),
    purpose: 'batch',
  });

  const batch = await openai.batches.create({
    input_file_id: inputFile.id,
    endpoint: '/v1/chat/completions',
    completion_window: '24h',
    metadata: options.metadata,
  });

  return {
    jobId: batch.id,
    inputFileId: inputFile.id,
  };
}

export async function inspectOpenAIBatchJob(
  jobId: string,
  options: InspectOpenAIBatchJobOptions
): Promise<OpenAIBatchInspection> {
  const { logConnectorUsage } = await import('@/services/connector-usage.service');
  const { logAIRequestStart, logAIResponse, logAIError } = await import('@/lib/ai/debug');

  const resolvedConfig = await resolveOpenAIConfig(options.tenantId);
  const openai = await getOpenAI(resolvedConfig.credentials);
  const batch = (await openai.batches.retrieve(jobId)) as OpenAIBatchObject;

  if (
    batch.status === 'validating' ||
    batch.status === 'in_progress' ||
    batch.status === 'finalizing' ||
    batch.status === 'cancelling'
  ) {
    return {
      status: batch.status,
      jobId,
      totalRequests: batch.request_counts?.total ?? 0,
      completedRequests: batch.request_counts?.completed ?? 0,
      failedRequests: batch.request_counts?.failed ?? 0,
      raw: batch,
    };
  }

  const debugContext = logAIRequestStart(
    {
      model: options.model,
      userPrompt: options.userPrompt,
      jsonMode: true,
      tenantId: options.tenantId,
      userId: options.userId,
    },
    'openai'
  );
  if (debugContext) {
    debugContext.connectorSource = resolvedConfig.connectorSource;
    debugContext.connectorId = resolvedConfig.connectorId;
  }

  if (batch.status !== 'completed') {
    const error = new Error(
      (await readBatchErrorMessage(openai, batch.error_file_id)) ||
        `OpenAI batch job ended with status ${batch.status}`
    );
    logAIError(debugContext, error);
    return {
      status: batch.status,
      jobId,
      errorMessage: error.message,
      raw: batch,
    };
  }

  if (!batch.output_file_id) {
    const error = new Error('OpenAI batch completed without an output file');
    logAIError(debugContext, error);
    return {
      status: 'failed',
      jobId,
      errorMessage: error.message,
      raw: batch,
    };
  }

  const outputContent = await readFileContent(openai, batch.output_file_id);
  const lines = parseJsonLines<OpenAIBatchOutputLine>(outputContent);
  const line = lines.find((entry) => entry.custom_id)?.response?.body
    ? lines.find((entry) => entry.custom_id)
    : lines[0];

  if (line?.response?.status_code && line.response.status_code >= 400) {
    const error = new Error(
      line.error?.message ||
        `OpenAI batch request failed with status ${line.response.status_code}`
    );
    logAIError(debugContext, error);
    return {
      status: 'failed',
      jobId,
      errorMessage: error.message,
      raw: batch,
    };
  }

  if (!line?.response?.body) {
    const error = new Error(line?.error?.message || 'OpenAI batch output did not include a successful response');
    logAIError(debugContext, error);
    return {
      status: 'failed',
      jobId,
      errorMessage: error.message,
      raw: batch,
    };
  }

  const result = parseOpenAIChatCompletionResponse(line.response.body, options.model, true);
  logAIResponse(debugContext, result);

  if (resolvedConfig.connectorId) {
    await logConnectorUsage({
      connectorId: resolvedConfig.connectorId,
      tenantId: options.tenantId,
      userId: options.userId,
      model: options.model,
      provider: 'openai',
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
      operation: options.operation,
      success: true,
      metadata: {
        ...(options.usageMetadata ?? {}),
        batchMode: true,
        batchJobId: jobId,
      },
    });
  }

  return {
    status: 'completed',
    jobId,
    result,
    raw: batch,
  };
}
