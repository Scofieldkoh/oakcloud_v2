import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { extractBizFileWithVision, generateBizFileDiff, normalizeExtractedData, prepareBizFileImportCommand } from '@/services/bizfile';
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
 * POST /api/documents/:documentId/preview-diff
 *
 * Extract data from a document and generate a diff against an existing company.
 * This is a preview-only operation that does NOT save any changes.
 * Used for update mode to show users what will change before confirming.
 *
 * Request body:
 * - companyId: string - The existing company ID to compare against
 * - modelId?: string - Optional AI model ID
 * - additionalContext?: string - Optional context for AI extraction
 *
 * Permissions:
 * - TENANT_ADMIN or COMPANY_ADMIN with update permission
 * - SUPER_ADMIN for any company
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    // Parse request body
    const body = await request.json();
    const { companyId, modelId, additionalContext } = body as {
      companyId: string;
      modelId?: AIModel;
      additionalContext?: string;
    };

    if (!companyId) {
      return NextResponse.json(
        { error: 'companyId is required for preview-diff' },
        { status: 400 }
      );
    }

    // Get document
    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Get company for permission check
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, tenantId: true, name: true, uen: true, updatedAt: true },
    });

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Check tenant access
    if (!session.isSuperAdmin) {
      if (document.tenantId !== session.tenantId || company.tenantId !== session.tenantId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Verify user can update this company (admin or document uploader)
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      const canUpdate = session.companyIds?.includes(companyId);
      if (!canUpdate) {
        return NextResponse.json(
          { error: 'You do not have permission to update this company' },
          { status: 403 }
        );
      }
    }

    // Validate file type for vision extraction
    if (!VISION_SUPPORTED_TYPES.includes(document.mimeType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${document.mimeType}. Supported types: PDF, PNG, JPG, WebP` },
        { status: 400 }
      );
    }

    try {
      // Download file from storage and convert to base64 for vision extraction
      if (!document.storageKey) {
        throw new Error('Document has no storage key');
      }
      const fileBuffer = await storage.download(document.storageKey);
      const base64Data = fileBuffer.toString('base64');
      const originalSourceHash = createHash('sha256').update(fileBuffer).digest('hex');

      // Extract data using AI vision (connector-aware for tenant)
      const extractionResult = await extractBizFileWithVision(
        {
          base64: base64Data,
          mimeType: document.mimeType,
        },
        {
          modelId,
          additionalContext,
          tenantId: document.tenantId, // Use tenant's configured AI connector
        }
      );

      // If FYE not extracted and entity type is a company, try to retrieve from ACRA records
      const extractedEntityType = mapEntityType(extractionResult.data.entityDetails?.entityType);
      const hasFYE = extractionResult.data.financialYear?.endDay && extractionResult.data.financialYear?.endMonth;

      if (!hasFYE && isCompanyEntityType(extractedEntityType)) {
        const uen = extractionResult.data.entityDetails?.uen;

        if (uen) {
          try {
            logger.info('FYE not in BizFile, attempting ACRA records retrieval', { uen, entityType: extractedEntityType });
            const fyeResult = await retrieveFYEFromACRA(uen, extractedEntityType);

            if (fyeResult) {
              // Add FYE to extracted data
              extractionResult.data.financialYear = {
                ...extractionResult.data.financialYear,
                endDay: fyeResult.day,
                endMonth: fyeResult.month,
              };
              logger.info('FYE retrieved from ACRA records and added to extraction', { fyeResult });
            }
          } catch (fyeError) {
            // Log but don't fail the extraction if FYE retrieval fails
            logger.warn('Failed to retrieve FYE from ACRA records, continuing without it', { error: fyeError });
          }
        }
      }

      // Normalize extracted data before comparing
      const normalizedData = normalizeExtractedData(extractionResult.data);

      const prepared = await prepareBizFileImportCommand({
        tenantId: document.tenantId,
        documentId,
        reviewedData: normalizedData,
        targetCompanyId: companyId,
        sourceVersion: document.sourceRevision,
        sourceHash: originalSourceHash,
      });

      // Generate diff against existing company
      const diffResult = await generateBizFileDiff(
        companyId,
        normalizedData,
        company.tenantId
      );

      // Calculate estimated cost
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
        diff: {
          hasDifferences: diffResult.hasDifferences,
          differences: diffResult.differences,
          existingCompany: diffResult.existingCompany,
          officerDiffs: diffResult.officerDiffs,
          shareholderDiffs: diffResult.shareholderDiffs,
          summary: diffResult.summary,
        },
        // Include company updatedAt for optimistic locking (concurrent update detection)
        companyUpdatedAt: company.updatedAt.toISOString(),
        plan: prepared.plan,
        source: prepared.source,
        contactCandidates: prepared.contactCandidates,
        preparationToken: prepared.plan.canonicalHash,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
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
      console.error('BizFile preview extraction error:', extractionError);
      throw extractionError;
    }
  } catch (error) {
    console.error('BizFile preview-diff error:', error);
    return createErrorResponse(error);
  }
}
