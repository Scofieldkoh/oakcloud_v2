/** Reconciling pending Mistral and OpenAI batch extractions. */

import { prisma } from '@/lib/prisma';
import {
  transitionPipelineStatus,
  recordProcessingAttempt,
  saveCheckpoint,
} from '@/services/document-processing.service';
import { stripMarkdownCodeBlocks } from '@/lib/ai';
import type { AIModel } from '@/lib/ai/types';
import { inspectOpenAIBatchJob } from '@/lib/ai/providers/openai-batch';
import { inspectMistralOCRBatchJob } from '@/lib/ocr/mistral';
import { storage } from '@/lib/storage';
import { getDocumentMimeTypeFromStorageKey } from './shared';
import { mapAIResponseToResult } from './mapping';
import {
  shouldUseChunkedMistralLineItemFallback,
  applyChunkedMistralLineItemFallback,
} from './ai-extraction';
import { persistCompletedExtraction } from './persistence';

export async function reconcilePendingMistralBatchExtraction(
  processingDocumentId: string,
  tenantId: string,
  companyId: string,
  userId: string
): Promise<{
  status: 'QUEUED' | 'RUNNING' | 'CANCELLATION_REQUESTED' | 'SUCCESS' | 'FAILED' | 'TIMEOUT_EXCEEDED' | 'CANCELLED' | 'NOT_PENDING';
  extractionId?: string;
  revisionId?: string;
  errorMessage?: string;
}> {
  const checkpoint = await prisma.processingCheckpoint.findUnique({
    where: {
      processingDocumentId_step: {
        processingDocumentId,
        step: 'FIELD_EXTRACTION',
      },
    },
  });

  const state = checkpoint?.stateJson as PendingMistralBatchState | null;
  if (!checkpoint || !state || state.mode !== 'mistral_batch') {
    return { status: 'NOT_PENDING' };
  }

  if (checkpoint.status === 'COMPLETED') {
    return {
      status: 'SUCCESS',
      extractionId: state.extractionId,
      revisionId: state.revisionId,
    };
  }

  if (checkpoint.status === 'FAILED') {
    return {
      status: state.failedStatus ?? 'FAILED',
      errorMessage: state.errorMessage,
    };
  }

  const inspected = await inspectMistralOCRBatchJob<Record<string, unknown>>(state.batchJobId, {
    prompt: state.prompt,
    tenantId,
    operation: 'document_field_extraction_batch',
    // Safe to log here now that completed/failed checkpoints short-circuit earlier.
    logAIDebug: true,
    usageMetadata: {
      companyId,
      processingDocumentId,
    },
  });

  if (inspected.status === 'QUEUED' || inspected.status === 'RUNNING' || inspected.status === 'CANCELLATION_REQUESTED') {
    return { status: inspected.status };
  }

  if (
    inspected.status === 'FAILED' ||
    inspected.status === 'TIMEOUT_EXCEEDED' ||
    inspected.status === 'CANCELLED'
  ) {
    const isRetryable = inspected.status !== 'CANCELLED';
    await recordProcessingAttempt(
      processingDocumentId,
      'FIELD_EXTRACTION',
      isRetryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT',
      {
        errorCode: 'EXTRACTION_FAILED',
        errorMessage: inspected.errorMessage,
        providerRequestId: state.batchJobId,
      }
    );
    await transitionPipelineStatus(
      processingDocumentId,
      isRetryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT',
      tenantId,
      companyId,
      { error: { code: 'EXTRACTION_FAILED', message: inspected.errorMessage } }
    );
    await saveCheckpoint(processingDocumentId, 'FIELD_EXTRACTION', 'FAILED', {
      ...state,
      failedAt: new Date().toISOString(),
      failedStatus: inspected.status,
      errorMessage: inspected.errorMessage,
    });

    return {
      status: inspected.status,
      errorMessage: inspected.errorMessage,
    };
  }

  if (inspected.status !== 'SUCCESS') {
    return { status: inspected.status };
  }

  const pages = await prisma.documentPage.findMany({
    where: { processingDocumentId },
    orderBy: { pageNumber: 'asc' },
    select: {
      pageNumber: true,
      storageKey: true,
      imageFingerprint: true,
      id: true,
    },
  });
  let extractionResult = mapAIResponseToResult(
    inspected.result.documentAnnotation as Record<string, unknown>,
    pages
  );
  const firstPage = pages[0];
  const extractionMimeType = firstPage?.storageKey
    ? getDocumentMimeTypeFromStorageKey(firstPage.storageKey)
    : 'image/png';

  if (firstPage?.storageKey && shouldUseChunkedMistralLineItemFallback(extractionResult, pages, extractionMimeType)) {
    const extractionDocumentBuffer = await storage.download(firstPage.storageKey);
    extractionResult = await applyChunkedMistralLineItemFallback({
      result: extractionResult,
      pages,
      documentBuffer: extractionDocumentBuffer,
      mimeType: extractionMimeType,
      tenantId,
      companyId,
      userId,
      additionalContext: state.additionalContext,
    });
  }
  const completed = await persistCompletedExtraction({
    processingDocumentId,
    tenantId,
    companyId,
    userId,
    extractionResult,
    modelUsed: inspected.result.model,
    providerUsed: inspected.result.provider,
    promptVersion: state.promptVersion,
    schemaVersion: state.schemaVersion,
    inputFingerprint: state.inputFingerprint,
    latencyMs: 0,
  });
  await saveCheckpoint(processingDocumentId, 'FIELD_EXTRACTION', 'COMPLETED', {
    ...state,
    completedAt: new Date().toISOString(),
    extractionId: completed.extractionId,
    revisionId: completed.revisionId,
  });

  return {
    status: 'SUCCESS',
    extractionId: completed.extractionId,
    revisionId: completed.revisionId,
  };
}

export async function reconcilePendingOpenAIBatchExtraction(
  processingDocumentId: string,
  tenantId: string,
  companyId: string,
  userId: string
): Promise<{
  status:
    | 'validating'
    | 'in_progress'
    | 'finalizing'
    | 'completed'
    | 'failed'
    | 'expired'
    | 'cancelling'
    | 'cancelled'
    | 'NOT_PENDING';
  extractionId?: string;
  revisionId?: string;
  errorMessage?: string;
}> {
  const checkpoint = await prisma.processingCheckpoint.findUnique({
    where: {
      processingDocumentId_step: {
        processingDocumentId,
        step: 'FIELD_EXTRACTION',
      },
    },
  });

  const state = checkpoint?.stateJson as PendingOpenAIBatchState | null;
  if (!checkpoint || !state || state.mode !== 'openai_batch') {
    return { status: 'NOT_PENDING' };
  }

  if (checkpoint.status === 'COMPLETED') {
    return {
      status: 'completed',
      extractionId: state.extractionId,
      revisionId: state.revisionId,
    };
  }

  if (checkpoint.status === 'FAILED') {
    return {
      status: state.failedStatus ?? 'failed',
      errorMessage: state.errorMessage,
    };
  }

  const inspected = await inspectOpenAIBatchJob(state.batchJobId, {
    tenantId,
    model: state.modelId,
    userPrompt: state.prompt,
    userId,
    operation: 'document_field_extraction_batch',
    usageMetadata: {
      companyId,
      processingDocumentId,
    },
  });

  if (
    inspected.status === 'validating' ||
    inspected.status === 'in_progress' ||
    inspected.status === 'finalizing' ||
    inspected.status === 'cancelling'
  ) {
    return { status: inspected.status };
  }

  if (
    inspected.status === 'failed' ||
    inspected.status === 'expired' ||
    inspected.status === 'cancelled'
  ) {
    const isRetryable = inspected.status !== 'cancelled';
    await recordProcessingAttempt(
      processingDocumentId,
      'FIELD_EXTRACTION',
      isRetryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT',
      {
        errorCode: 'EXTRACTION_FAILED',
        errorMessage: inspected.errorMessage,
        providerRequestId: state.batchJobId,
      }
    );
    await transitionPipelineStatus(
      processingDocumentId,
      isRetryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT',
      tenantId,
      companyId,
      { error: { code: 'EXTRACTION_FAILED', message: inspected.errorMessage } }
    );
    await saveCheckpoint(processingDocumentId, 'FIELD_EXTRACTION', 'FAILED', {
      ...state,
      failedAt: new Date().toISOString(),
      failedStatus: inspected.status,
      errorMessage: inspected.errorMessage,
    });

    return {
      status: inspected.status,
      errorMessage: inspected.errorMessage,
    };
  }

  if (inspected.status !== 'completed') {
    return { status: inspected.status };
  }

  const pages = await prisma.documentPage.findMany({
    where: { processingDocumentId },
    orderBy: { pageNumber: 'asc' },
    select: {
      pageNumber: true,
      storageKey: true,
      imageFingerprint: true,
      id: true,
    },
  });

  const cleanedContent = stripMarkdownCodeBlocks(inspected.result.content);
  const parsed = JSON.parse(cleanedContent) as Record<string, unknown>;
  const extractionResult = mapAIResponseToResult(parsed, pages);

  const completed = await persistCompletedExtraction({
    processingDocumentId,
    tenantId,
    companyId,
    userId,
    extractionResult,
    modelUsed: inspected.result.model,
    providerUsed: inspected.result.provider,
    promptVersion: state.promptVersion,
    schemaVersion: state.schemaVersion,
    inputFingerprint: state.inputFingerprint,
    latencyMs: 0,
  });

  await saveCheckpoint(processingDocumentId, 'FIELD_EXTRACTION', 'COMPLETED', {
    ...state,
    completedAt: new Date().toISOString(),
    extractionId: completed.extractionId,
    revisionId: completed.revisionId,
  });

  return {
    status: 'completed',
    extractionId: completed.extractionId,
    revisionId: completed.revisionId,
  };
}

export async function reconcilePendingBatchExtraction(
  processingDocumentId: string,
  tenantId: string,
  companyId: string,
  userId: string
): Promise<
  | Awaited<ReturnType<typeof reconcilePendingMistralBatchExtraction>>
  | Awaited<ReturnType<typeof reconcilePendingOpenAIBatchExtraction>>
> {
  const checkpoint = await prisma.processingCheckpoint.findUnique({
    where: {
      processingDocumentId_step: {
        processingDocumentId,
        step: 'FIELD_EXTRACTION',
      },
    },
    select: {
      stateJson: true,
    },
  });

  const state = checkpoint?.stateJson as PendingBatchExtractionState | null;
  if (!state?.mode) {
    return { status: 'NOT_PENDING' };
  }

  if (state.mode === 'openai_batch') {
    return reconcilePendingOpenAIBatchExtraction(
      processingDocumentId,
      tenantId,
      companyId,
      userId
    );
  }

  return reconcilePendingMistralBatchExtraction(
    processingDocumentId,
    tenantId,
    companyId,
    userId
  );
}

export interface PendingMistralBatchState {
  mode: 'mistral_batch';
  batchJobId: string;
  prompt: string;
  promptVersion: string;
  schemaVersion: string;
  inputFingerprint: string;
  additionalContext?: string;
  submittedAt: string;
  completedAt?: string;
  extractionId?: string;
  revisionId?: string;
  failedAt?: string;
  failedStatus?: 'FAILED' | 'TIMEOUT_EXCEEDED' | 'CANCELLED';
  errorMessage?: string;
}

export interface PendingOpenAIBatchState {
  mode: 'openai_batch';
  batchJobId: string;
  inputFileId: string;
  modelId: AIModel;
  prompt: string;
  promptVersion: string;
  schemaVersion: string;
  inputFingerprint: string;
  additionalContext?: string;
  submittedAt: string;
  completedAt?: string;
  extractionId?: string;
  revisionId?: string;
  failedAt?: string;
  failedStatus?: 'failed' | 'expired' | 'cancelled';
  errorMessage?: string;
}

type PendingBatchExtractionState = PendingMistralBatchState | PendingOpenAIBatchState;
