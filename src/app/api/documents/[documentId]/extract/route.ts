import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { extractBizFileWithVision, normalizeExtractedData } from '@/services/bizfile';
import { mapEntityType } from '@/services/bizfile/types';
import { AI_MODELS, calculateUsageCost, formatCost } from '@/lib/ai';
import type { AIModel } from '@/lib/ai';
import { MISTRAL_OCR_MODEL_ID, MISTRAL_OCR_MODEL_NAME } from '@/lib/ocr/mistral';
import { storage } from '@/lib/storage';
import { retrieveFYEFromACRA } from '@/lib/external/acra-records';
import { isCompanyEntityType } from '@/lib/external/acra-fye';
import logger from '@/lib/logger';

// Supported MIME types for vision extraction
const VISION_SUPPORTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
];

/**
 * POST /api/documents/:documentId/extract
 *
 * Extract data from a pending document using AI vision.
 * Stores extracted data on the document but does NOT create/update any company records.
 * Returns extracted data + conflict info (if UEN already exists).
 *
 * Conflict types:
 *   - IN_RECYCLE_BIN: company exists but is soft-deleted
 *   - ALREADY_EXISTS: company exists and is active
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    let modelId: AIModel | undefined;
    let additionalContext: string | undefined;
    try {
      const body = await request.json();
      modelId = body.modelId as AIModel | undefined;
      additionalContext = body.additionalContext as string | undefined;
    } catch {
      // No body or invalid JSON - use defaults
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (!session.isSuperAdmin && document.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (
      document.uploadedById !== session.id &&
      !session.isSuperAdmin &&
      !session.isWorkspaceAdmin
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (document.extractionStatus === 'PROCESSING') {
      return NextResponse.json({ error: 'Extraction already in progress' }, { status: 409 });
    }

    if (!VISION_SUPPORTED_TYPES.includes(document.mimeType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${document.mimeType}. Supported types: PDF, PNG, JPG, WebP` },
        { status: 400 }
      );
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { extractionStatus: 'PROCESSING' },
    });

    try {
      if (!document.storageKey) {
        throw new Error('Document has no storage key');
      }
      const fileBuffer = await storage.download(document.storageKey);
      const base64Data = fileBuffer.toString('base64');

      const extractionResult = await extractBizFileWithVision(
        { base64: base64Data, mimeType: document.mimeType },
        {
          modelId,
          additionalContext,
          tenantId: document.tenantId,
        }
      );

      // Optionally retrieve FYE from ACRA records if not in BizFile
      const extractedEntityType = mapEntityType(extractionResult.data.entityDetails?.entityType);
      const hasFYE =
        extractionResult.data.financialYear?.endDay &&
        extractionResult.data.financialYear?.endMonth;

      if (!hasFYE && isCompanyEntityType(extractedEntityType)) {
        const uen = extractionResult.data.entityDetails?.uen;
        if (uen) {
          try {
            logger.info('FYE not in BizFile, attempting ACRA records retrieval', { uen, entityType: extractedEntityType });
            const fyeResult = await retrieveFYEFromACRA(uen, extractedEntityType);
            if (fyeResult) {
              extractionResult.data.financialYear = {
                ...extractionResult.data.financialYear,
                endDay: fyeResult.day,
                endMonth: fyeResult.month,
              };
            }
          } catch (fyeError) {
            logger.warn('Failed to retrieve FYE from ACRA records', { error: fyeError });
          }
        }
      }

      const normalizedData = normalizeExtractedData(extractionResult.data);
      const uen = normalizedData.entityDetails?.uen;

      // Check for UEN conflict
      let conflict: {
        type: 'IN_RECYCLE_BIN' | 'ALREADY_EXISTS';
        companyId: string;
        companyName: string;
        uen: string;
      } | null = null;

      if (uen) {
        const existingCompany = await prisma.company.findFirst({
          where: { tenantId: document.tenantId, uen },
          select: { id: true, name: true, uen: true, deletedAt: true },
        });

        if (existingCompany) {
          conflict = {
            type: existingCompany.deletedAt ? 'IN_RECYCLE_BIN' : 'ALREADY_EXISTS',
            companyId: existingCompany.id,
            companyName: existingCompany.name,
            uen: existingCompany.uen,
          };
        }
      }

      // Store extracted data on document, mark as EXTRACTED (awaiting confirm)
      await prisma.document.update({
        where: { id: documentId },
        data: {
          extractionStatus: 'EXTRACTED',
          extractedAt: new Date(),
          extractedData: normalizedData as object,
        },
      });

      const modelConfig = AI_MODELS[extractionResult.modelUsed as AIModel];
      const modelName =
        modelConfig?.name ||
        (extractionResult.modelUsed === MISTRAL_OCR_MODEL_ID
          ? MISTRAL_OCR_MODEL_NAME
          : extractionResult.modelUsed);
      let estimatedCost: number | undefined;
      let formattedCost: string | undefined;
      if (extractionResult.usage) {
        estimatedCost = calculateUsageCost({
          modelId: extractionResult.modelUsed,
          provider: extractionResult.providerUsed,
          inputTokens: extractionResult.usage.inputTokens,
          outputTokens: extractionResult.usage.outputTokens,
          totalTokens: extractionResult.usage.totalTokens,
          pagesProcessed: extractionResult.usage.pagesProcessed,
        });
        formattedCost = formatCost(estimatedCost);
      }

      return NextResponse.json({
        success: true,
        extractedData: normalizedData,
        conflict,
        aiMetadata: {
          modelUsed: extractionResult.modelUsed,
          modelName,
          providerUsed: extractionResult.providerUsed,
          usage: extractionResult.usage,
          estimatedCost,
          formattedCost,
        },
      });
    } catch (extractionError) {
      await prisma.document.update({
        where: { id: documentId },
        data: {
          extractionStatus: 'FAILED',
          extractionError:
            extractionError instanceof Error ? extractionError.message : 'Unknown error',
        },
      });
      throw extractionError;
    }
  } catch (error) {
    console.error('BizFile extraction error:', error);
    return createErrorResponse(error);
  }
}
