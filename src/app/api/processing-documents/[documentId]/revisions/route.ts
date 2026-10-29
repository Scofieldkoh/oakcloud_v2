/**
 * Document Revisions API
 *
 * GET /api/processing-documents/:documentId/revisions - Get revision history
 * POST /api/processing-documents/:documentId/revisions - Create new revision
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { getProcessingDocument } from '@/services/document-processing.service';
import {
  createRevision,
  createRevisionFromEdit,
  getRevisionHistory,
  type RevisionPatchInput,
} from '@/services/document-revision.service';
import { createAuditLog } from '@/lib/audit';

type Params = { documentId: string };

/**
 * GET /api/processing-documents/:documentId/revisions
 * Get revision history
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

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
      select: { companyId: true },
    });

    if (!document || !document.companyId) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Base document not found' },
        },
        { status: 404 }
      );
    }

    // Check permission
    await requirePermission(session, 'document', 'read', document.companyId);

    if (!(await canAccessCompany(session, document.companyId))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        },
        { status: 403 }
      );
    }

    const revisions = await getRevisionHistory(documentId);

    return NextResponse.json({
      success: true,
      data: {
        revisions: revisions.map((rev) => ({
          id: rev.id,
          revisionNumber: rev.revisionNumber,
          status: rev.status,
          revisionType: rev.revisionType,
          documentCategory: rev.documentCategory,
          vendorName: rev.vendorName,
          totalAmount: rev.totalAmount.toString(),
          currency: rev.currency,
          createdAt: rev.createdAt,
          approvedAt: rev.approvedAt,
          supersededAt: rev.supersededAt,
        })),
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error, 'document-revisions');
  }
}

/**
 * POST /api/processing-documents/:documentId/revisions
 * Create new revision (edit)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;
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

    const body = await request.json();
    const { basedOnRevisionId, reason, patch } = body as {
      basedOnRevisionId?: string;
      reason?: string;
      patch?: RevisionPatchInput;
    };

    const revision = basedOnRevisionId
      ? await createRevisionFromEdit(
        documentId,
        basedOnRevisionId,
        patch || {},
        session.id,
        reason || 'user_edit'
      )
      : await createRevision({
        processingDocumentId: documentId,
        revisionType: 'USER_EDIT',
        createdById: session.id,
        reason: reason || 'manual_entry',
        documentCategory: 'OTHER',
        currency: 'SGD',
        totalAmount: '0',
      });

    // Update document to point to the new draft revision and increment lock version
    await prisma.processingDocument.update({
      where: { id: documentId },
      data: {
        currentRevisionId: revision.id,
        lockVersion: { increment: 1 },
      },
    });

    // Get updated lock version
    const updatedDoc = await getProcessingDocument(documentId);

    // Create audit log
    await createAuditLog({
      tenantId: document.tenantId,
      userId: session.id,
      companyId: document.companyId,
      action: 'CREATE',
      entityType: 'DocumentRevision',
      entityId: revision.id,
      summary: `Created revision #${revision.revisionNumber} for document`,
      changeSource: 'MANUAL',
      metadata: {
        revisionNumber: revision.revisionNumber,
        revisionType: revision.revisionType,
        basedOnRevisionId: basedOnRevisionId ?? null,
      },
    });

    const response = {
      success: true,
      data: {
        revision: {
          id: revision.id,
          revisionNumber: revision.revisionNumber,
          status: revision.status,
          revisionType: revision.revisionType,
          basedOnRevisionId: basedOnRevisionId ?? null,
        },
        document: {
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
          endpoint: `/api/processing-documents/${documentId}/revisions`,
          method: 'POST',
          requestHash: '',
          response: response as object,
          statusCode: 201,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      });
    }

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'document-revisions');
  }
}
