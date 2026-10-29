/** Split detection, field extraction and extraction/page lookups. */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import type { DocumentExtraction } from '@/generated/prisma';
import type { ExtractionType } from '@/generated/prisma';
import {
  transitionPipelineStatus,
  recordProcessingAttempt,
  saveCheckpoint,
} from '@/services/document-processing.service';
import { getBestAvailableModelForWorkspace, getModelConfig, AI_MODELS } from '@/lib/ai';
import type { AIModel } from '@/lib/ai/types';
import { submitOpenAIBatchJob } from '@/lib/ai/providers/openai-batch';
import { MISTRAL_OCR_MODEL_ID, submitMistralOCRBatchJob } from '@/lib/ocr/mistral';
import { storage } from '@/lib/storage';
import { performAISplitDetection } from '@/lib/split-detection';
import { getDocumentExtractionPromptSettings } from '@/services/document-extraction-prompt-settings.service';
import {
  log,
  DEFAULT_CONFIG,
  MISTRAL_DOCUMENT_EXTRACTION_JSON_SCHEMA,
  getDocumentMimeTypeFromStorageKey,
  generateInputFingerprint,
  isRetryableError,
} from './shared';
import {
  type ExtractionConfig,
  type SplitDetectionResult,
  type ExtractionJobResult,
} from './types';
import { buildHistoricalCounterpartyLearningContext } from './counterparty';
import { buildBatchExtractionPrompt, performAIExtraction } from './ai-extraction';
import { persistCompletedExtraction } from './persistence';
import { type PendingMistralBatchState, type PendingOpenAIBatchState } from './batch';

/**
 * Detect document boundaries in a multi-page container
 */
export async function detectSplitBoundaries(
  processingDocumentId: string,
  tenantId: string,
  companyId: string,
  userId: string,
  config: Partial<ExtractionConfig> = {}
): Promise<SplitDetectionResult> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  log.info(`Detecting split boundaries for document ${processingDocumentId}`);

  // Get document pages
  const pages = await prisma.documentPage.findMany({
    where: { processingDocumentId },
    orderBy: { pageNumber: 'asc' },
  });

  if (pages.length === 0) {
    throw new Error('No pages found for document');
  }

  // Record attempt start
  await recordProcessingAttempt(processingDocumentId, 'SPLIT_DETECTION', 'RUNNING');

  try {
    // In production, this would call the AI provider
    // For now, we simulate the extraction
    const startTime = Date.now();

    const result = await performAISplitDetection(pages, tenantId, userId, mergedConfig);

    const latencyMs = Date.now() - startTime;

    // Create extraction record
    await prisma.documentExtraction.create({
      data: {
        processingDocumentId,
        extractionType: 'SPLIT',
        provider: mergedConfig.provider,
        model: mergedConfig.model,
        promptVersion: mergedConfig.promptVersion,
        extractionSchemaVersion: mergedConfig.schemaVersion,
        rawJson: result as unknown as Prisma.InputJsonValue,
        confidenceJson: { overall: result.overallConfidence } as Prisma.InputJsonValue,
        overallConfidence: result.overallConfidence,
        latencyMs,
      },
    });

    // Record success
    await recordProcessingAttempt(processingDocumentId, 'SPLIT_DETECTION', 'SUCCEEDED', {
      providerLatencyMs: latencyMs,
    });

    log.info(
      `Split detection completed for ${processingDocumentId}: ${result.documentBoundaries.length} documents found`
    );

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await recordProcessingAttempt(processingDocumentId, 'SPLIT_DETECTION', 'FAILED_RETRYABLE', {
      errorCode: 'SPLIT_FAILED',
      errorMessage,
    });

    throw error;
  }
}

// ============================================================================
// Field Extraction
// ============================================================================

/**
 * Extract fields from a document
 */
export async function extractFields(
  processingDocumentId: string,
  tenantId: string,
  companyId: string,
  userId: string,
  config: Partial<ExtractionConfig> = {}
): Promise<ExtractionJobResult> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  log.info(`Extracting fields for document ${processingDocumentId}`);

  // Update pipeline status
  await transitionPipelineStatus(processingDocumentId, 'PROCESSING', tenantId, companyId);

  // Record attempt start
  await recordProcessingAttempt(processingDocumentId, 'FIELD_EXTRACTION', 'RUNNING');

  try {
    const startTime = Date.now();

    // Get document pages for extraction
    const pages = await prisma.documentPage.findMany({
      where: { processingDocumentId },
      orderBy: { pageNumber: 'asc' },
    });

    // Validate that pages exist - cannot extract without rendered pages
    if (pages.length === 0) {
      throw new Error('No pages found for document. Pages must be created before extraction.');
    }

    log.info(`Found ${pages.length} pages for document ${processingDocumentId}`);

    const shouldUseMistral =
      mergedConfig.provider === 'mistral' || mergedConfig.model === MISTRAL_OCR_MODEL_ID;
    const explicitModel =
      mergedConfig.model && mergedConfig.model !== MISTRAL_OCR_MODEL_ID
        ? mergedConfig.model
        : undefined;
    const batchModelId = explicitModel
      ? explicitModel
      : shouldUseMistral
        ? null
        : await getBestAvailableModelForWorkspace(tenantId);
    const batchModelProvider = batchModelId && AI_MODELS[batchModelId as AIModel]
      ? getModelConfig(batchModelId as AIModel).provider
      : null;

    const learnedHistoricalContext = await buildHistoricalCounterpartyLearningContext({
      processingDocumentId,
      pages,
      tenantId,
      companyId,
      userId,
      modelId: batchModelId as AIModel | null,
      forceMistral: shouldUseMistral,
    });

    const promptSettings = await getDocumentExtractionPromptSettings(tenantId);

    // Generate input fingerprint for reproducibility using the effective prompt context.
    const inputFingerprint = generateInputFingerprint(
      pages.map((p) => p.id),
      mergedConfig
    );

    if (mergedConfig.batchMode && shouldUseMistral) {
      const firstPage = pages[0];
      if (!firstPage?.storageKey) {
        throw new Error('No pages to extract from or missing storage key');
      }

      const fileBuffer = await storage.download(firstPage.storageKey);
      const mimeType = getDocumentMimeTypeFromStorageKey(firstPage.storageKey);
      const prompt = await buildBatchExtractionPrompt(
        tenantId,
        companyId,
        mergedConfig.additionalContext,
        learnedHistoricalContext,
        promptSettings.promptTemplate
      );
      const batchJob = await submitMistralOCRBatchJob({
        customId: processingDocumentId,
        document: {
          base64: fileBuffer.toString('base64'),
          mimeType,
        },
        prompt,
        tenantId,
        userId,
        operation: 'document_field_extraction_batch',
        usageMetadata: {
          companyId,
          processingDocumentId,
          processingDocumentPageCount: pages.length,
        },
        schemaName: 'processing_document_extraction',
        jsonSchema: MISTRAL_DOCUMENT_EXTRACTION_JSON_SCHEMA,
        metadata: {
          processingDocumentId,
          companyId,
        },
      });

      await transitionPipelineStatus(processingDocumentId, 'QUEUED', tenantId, companyId, {
        reason: 'Queued for Mistral batch extraction',
        actorUserId: userId,
      });

      await saveCheckpoint(processingDocumentId, 'FIELD_EXTRACTION', 'STARTED', {
        mode: 'mistral_batch',
        batchJobId: batchJob.jobId,
        prompt,
        promptVersion: mergedConfig.promptVersion,
        schemaVersion: mergedConfig.schemaVersion,
        inputFingerprint,
        additionalContext: mergedConfig.additionalContext,
        submittedAt: new Date().toISOString(),
      } satisfies PendingMistralBatchState);

      return {
        success: true,
        extractionId: '',
      };
    }

    if (mergedConfig.batchMode && batchModelId && batchModelProvider === 'openai') {
      const firstPage = pages[0];
      if (!firstPage?.storageKey) {
        throw new Error('No pages to extract from or missing storage key');
      }

      const fileBuffer = await storage.download(firstPage.storageKey);
      const mimeType = getDocumentMimeTypeFromStorageKey(firstPage.storageKey);
      const prompt = await buildBatchExtractionPrompt(
        tenantId,
        companyId,
        mergedConfig.additionalContext,
        learnedHistoricalContext,
        promptSettings.promptTemplate
      );
      const batchJob = await submitOpenAIBatchJob({
        customId: processingDocumentId,
        tenantId,
        model: batchModelId as AIModel,
        userPrompt: prompt,
        images: [{
          base64: fileBuffer.toString('base64'),
          mimeType,
        }],
        jsonMode: true,
        metadata: {
          processingDocumentId,
          companyId,
        },
      });

      await transitionPipelineStatus(processingDocumentId, 'QUEUED', tenantId, companyId, {
        reason: `Queued for OpenAI batch extraction (${batchModelId})`,
        actorUserId: userId,
      });

      await saveCheckpoint(processingDocumentId, 'FIELD_EXTRACTION', 'STARTED', {
        mode: 'openai_batch',
        batchJobId: batchJob.jobId,
        inputFileId: batchJob.inputFileId,
        modelId: batchModelId as AIModel,
        prompt,
        promptVersion: mergedConfig.promptVersion,
        schemaVersion: mergedConfig.schemaVersion,
        inputFingerprint,
        additionalContext: mergedConfig.additionalContext,
        submittedAt: new Date().toISOString(),
      } satisfies PendingOpenAIBatchState);

      return {
        success: true,
        extractionId: '',
      };
    }

    // Perform AI extraction (falls back to simulation if AI unavailable)
    const { result: extractionResult, modelUsed, providerUsed } = await performAIExtraction(
      pages,
      tenantId,
      companyId,
      userId,
      mergedConfig,
      learnedHistoricalContext,
      promptSettings.promptTemplate
    );

    const latencyMs = Date.now() - startTime;
    const completed = await persistCompletedExtraction({
      processingDocumentId,
      tenantId,
      companyId,
      userId,
      extractionResult,
      modelUsed,
      providerUsed,
      promptVersion: mergedConfig.promptVersion,
      schemaVersion: mergedConfig.schemaVersion,
      inputFingerprint,
      latencyMs,
    });

    return {
      success: true,
      extractionId: completed.extractionId,
      revisionId: completed.revisionId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isRetryable = isRetryableError(error);

    await recordProcessingAttempt(
      processingDocumentId,
      'FIELD_EXTRACTION',
      isRetryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT',
      {
        errorCode: 'EXTRACTION_FAILED',
        errorMessage,
      }
    );

    await transitionPipelineStatus(
      processingDocumentId,
      isRetryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT',
      tenantId,
      companyId,
      { error: { code: 'EXTRACTION_FAILED', message: errorMessage } }
    );

    return {
      success: false,
      extractionId: '',
      error: {
        code: 'EXTRACTION_FAILED',
        message: errorMessage,
        retryable: isRetryable,
      },
    };
  }
}

/**
 * Re-extract fields with a different configuration
 */
export async function reextractFields(
  processingDocumentId: string,
  tenantId: string,
  companyId: string,
  userId: string,
  config: Partial<ExtractionConfig>
): Promise<ExtractionJobResult> {
  log.info(`Re-extracting fields for document ${processingDocumentId}`);

  return extractFields(processingDocumentId, tenantId, companyId, userId, config);
}

// ============================================================================
// Retrieval
// ============================================================================

/**
 * Get extraction by ID
 */
export async function getExtraction(extractionId: string): Promise<DocumentExtraction | null> {
  return prisma.documentExtraction.findUnique({
    where: { id: extractionId },
  });
}

/**
 * Get extractions for a document
 */
export async function getExtractionsByDocument(
  processingDocumentId: string,
  type?: ExtractionType
): Promise<DocumentExtraction[]> {
  const where: Prisma.DocumentExtractionWhereInput = { processingDocumentId };
  if (type) {
    where.extractionType = type;
  }

  return prisma.documentExtraction.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
}

// ============================================================================
// Page Management
// ============================================================================

/**
 * Create document page records
 */
export async function createDocumentPages(
  processingDocumentId: string,
  pages: Array<{
    pageNumber: number;
    storageKey: string;
    widthPx: number;
    heightPx: number;
    imageFingerprint?: string;
    renderDpi?: number;
  }>
): Promise<void> {
  await prisma.documentPage.createMany({
    data: pages.map((page) => ({
      processingDocumentId,
      pageNumber: page.pageNumber,
      storageKey: page.storageKey,
      widthPx: page.widthPx,
      heightPx: page.heightPx,
      imageFingerprint: page.imageFingerprint,
      renderDpi: page.renderDpi ?? 200,
    })),
  });

  log.info(`Created ${pages.length} page records for document ${processingDocumentId}`);
}

/**
 * Get document pages
 */
export async function getDocumentPages(processingDocumentId: string) {
  return prisma.documentPage.findMany({
    where: { processingDocumentId },
    orderBy: { pageNumber: 'asc' },
  });
}

// ============================================================================
// Helper Functions
// ============================================================================
