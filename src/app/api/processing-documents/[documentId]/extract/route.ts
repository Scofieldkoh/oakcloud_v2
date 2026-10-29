/**
 * Document Extraction API
 *
 * POST /api/processing-documents/:documentId/extract - Trigger extraction
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { getProcessingDocument, resetProcessingRetryState } from '@/services/document-processing.service';
import { extractFields } from '@/services/document-extraction.service';

type Params = { documentId: string };

/**
 * POST /api/processing-documents/:documentId/extract
 * Trigger document field extraction
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;
    const idempotencyKey = request.headers.get('Idempotency-Key');

    const processingDoc = await getProcessingDocument(documentId);

    if (!processingDoc) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Document not found' },
        },
        { status: 404 }
      );
    }

    // Get the base document for company context
    const document = await prisma.document.findUnique({
      where: { id: processingDoc.documentId },
      select: { companyId: true, tenantId: true },
    });

    if (!document || !document.companyId || !document.tenantId) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Base document not found' },
        },
        { status: 404 }
      );
    }

    // Check permission
    await requirePermission(session, 'document', 'update', document.companyId);

    if (!(await canAccessCompany(session, document.companyId))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        },
        { status: 403 }
      );
    }

    // Check idempotency
    if (idempotencyKey) {
      const existing = await prisma.idempotencyRecord.findUnique({
        where: { key: idempotencyKey },
      });

      if (existing && existing.expiresAt > new Date()) {
        return NextResponse.json(existing.response, {
          status: existing.statusCode,
        });
      }
    }

    // Parse optional config from body
    let body: { provider?: string; model?: string; priority?: string; context?: string; batchMode?: boolean } = {};
    try {
      const text = await request.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      // Empty or invalid body is ok
    }

    await resetProcessingRetryState(documentId);

    // Trigger extraction
    const result = await extractFields(
      documentId,
      document.tenantId,
      document.companyId,
      session.id,
      {
        provider: body.provider as 'openai' | 'anthropic' | 'google' | 'mistral' | undefined,
        model: body.model,
        additionalContext: body.context,
        batchMode: body.batchMode,
      }
    );

    const jobId = `job_extract_${uuidv4()}`;

    const response = {
      success: true,
      data: {
        jobId,
        extractionId: result.extractionId,
        revisionId: result.revisionId,
        estimatedCompletionSeconds: 30,
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    };

    // Store idempotency record
    if (idempotencyKey) {
      await prisma.idempotencyRecord.create({
        data: {
          key: idempotencyKey,
          tenantId: document.tenantId,
          endpoint: `/api/processing-documents/${documentId}/extract`,
          method: 'POST',
          requestHash: '',
          response: response as object,
          statusCode: 202,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });
    }

    return NextResponse.json(response, { status: 202 });
  } catch (error) {
    return handleApiError(error, 'processing-document-extract');
  }
}
