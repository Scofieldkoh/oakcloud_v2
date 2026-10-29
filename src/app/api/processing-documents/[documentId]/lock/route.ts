/**
 * Document Lock API
 *
 * POST /api/processing-documents/:documentId/lock - Acquire lock
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import {
  getProcessingDocument,
  acquireDocumentLock,
} from '@/services/document-processing.service';
import { createAuditLog } from '@/lib/audit';

type Params = { documentId: string };

/**
 * POST /api/processing-documents/:documentId/lock
 * Acquire lock on document
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

    // Get expected lock version from If-Match header
    const expectedVersion = ifMatch ? parseInt(ifMatch, 10) : processingDoc.lockVersion;

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

    // Acquire lock
    const result = await acquireDocumentLock(
      documentId,
      session.id,
      document.tenantId,
      document.companyId,
      expectedVersion
    );

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DOCUMENT_LOCKED',
            message: 'Document is locked by another user',
          },
          data: {
            lockVersion: result.newLockVersion,
            expiresAt: result.expiresAt,
          },
        },
        { status: 409 }
      );
    }

    // Create audit log
    await createAuditLog({
      tenantId: document.tenantId,
      userId: session.id,
      companyId: document.companyId,
      action: 'UPDATE',
      entityType: 'ProcessingDocument',
      entityId: documentId,
      summary: 'Acquired document lock',
      changeSource: 'MANUAL',
    });

    const response = {
      success: true,
      data: {
        lockVersion: result.newLockVersion,
        expiresAt: result.expiresAt,
        lockedById: session.id,
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
          endpoint: `/api/processing-documents/${documentId}/lock`,
          method: 'POST',
          requestHash: '',
          response: response as object,
          statusCode: 200,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error, 'processing-document-lock');
  }
}
