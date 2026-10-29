/**
 * Approve Revision API
 *
 * POST /api/processing-documents/:documentId/revisions/:revisionId/approve
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { getProcessingDocument } from '@/services/document-processing.service';
import { approveRevision, getRevision } from '@/services/document-revision.service';
import { canApproveDocument } from '@/services/duplicate-detection.service';
import type { ExchangeRateSource } from '@/generated/prisma';

type Params = { documentId: string; revisionId: string };

/**
 * POST /api/processing-documents/:documentId/revisions/:revisionId/approve
 * Approve a revision
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireAuth();
    const { documentId, revisionId } = await params;
    const idempotencyKey = request.headers.get('Idempotency-Key');
    const ifMatch = request.headers.get('If-Match');

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

    // Check permission (require document:approve permission)
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

    // Check lock version (optimistic concurrency)
    if (ifMatch) {
      const expectedVersion = parseInt(ifMatch, 10);
      if (processingDoc.lockVersion !== expectedVersion) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'CONCURRENT_MODIFICATION',
              message: 'Document has been modified by another user',
            },
          },
          { status: 409 }
        );
      }
    }

    // Check revision exists
    const revision = await getRevision(revisionId);
    if (!revision || revision.processingDocumentId !== documentId) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Revision not found' },
        },
        { status: 404 }
      );
    }

    // Check duplicate decision gating
    const duplicateCheck = await canApproveDocument(documentId);
    if (!duplicateCheck.canApprove) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DUPLICATE_DECISION_REQUIRED',
            message: duplicateCheck.reason || 'Cannot approve document',
          },
        },
        { status: 409 }
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

    // Parse optional body for exchange rate info
    let body: {
      homeCurrency?: string;
      exchangeRate?: string;
      exchangeRateSource?: ExchangeRateSource;
      exchangeRateDate?: string;
      overrideReason?: string;
      aliasLearning?: {
        vendor?: 'AUTO' | 'FORCE' | 'SKIP';
        customer?: 'AUTO' | 'FORCE' | 'SKIP';
      };
    } = {};
    try {
      const text = await request.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      // Empty body is ok
    }

    // Approve revision
    const approvedRevision = await approveRevision(revisionId, {
      userId: session.id,
      homeCurrency: body.homeCurrency,
      exchangeRate: body.exchangeRate,
      exchangeRateSource: body.exchangeRateSource,
      exchangeRateDate: body.exchangeRateDate
        ? new Date(body.exchangeRateDate)
        : undefined,
      overrideReason: body.overrideReason,
      aliasLearning: body.aliasLearning,
    });

    // Get updated document
    const updatedDoc = await getProcessingDocument(documentId);

    const response = {
      success: true,
      data: {
        revision: {
          id: approvedRevision.id,
          status: approvedRevision.status,
          approvedAt: approvedRevision.approvedAt,
          homeEquivalent: approvedRevision.homeEquivalent?.toString(),
        },
        document: {
          currentRevisionId: updatedDoc?.currentRevisionId,
          lockVersion: updatedDoc?.lockVersion ?? processingDoc.lockVersion + 1,
        },
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
          endpoint: `/api/processing-documents/${documentId}/revisions/${revisionId}/approve`,
          method: 'POST',
          requestHash: '',
          response: response as object,
          statusCode: 200,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot approve')) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: error.message },
        },
        { status: 400 }
      );
    }
    return handleApiError(error, 'revision-approve');
  }
}
