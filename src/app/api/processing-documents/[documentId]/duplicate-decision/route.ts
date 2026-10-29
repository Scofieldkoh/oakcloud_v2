/**
 * Duplicate Decision API
 *
 * POST /api/processing-documents/:documentId/duplicate-decision - Record decision
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { getProcessingDocument, markAsNewVersion } from '@/services/document-processing.service';
import { recordDuplicateDecision } from '@/services/duplicate-detection.service';
import { createAuditLog } from '@/lib/audit';
import type { DuplicateAction } from '@/generated/prisma';

type Params = { documentId: string };

/**
 * POST /api/processing-documents/:documentId/duplicate-decision
 * Record duplicate decision
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

    const body = await request.json();
    const { suspectedOfId, decision, reason } = body as {
      suspectedOfId: string;
      decision: DuplicateAction;
      reason?: string;
    };

    if (!suspectedOfId || !decision) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'suspectedOfId and decision are required',
          },
        },
        { status: 400 }
      );
    }

    // Validate decision value
    const validDecisions: DuplicateAction[] = [
      'CONFIRM_DUPLICATE',
      'REJECT_DUPLICATE',
      'MARK_AS_NEW_VERSION',
    ];
    if (!validDecisions.includes(decision)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid decision value',
          },
        },
        { status: 400 }
      );
    }

    // Record decision
    await recordDuplicateDecision(
      documentId,
      suspectedOfId,
      decision,
      session.id,
      reason
    );

    // Handle MARK_AS_NEW_VERSION
    if (decision === 'MARK_AS_NEW_VERSION') {
      await markAsNewVersion(
        documentId,
        suspectedOfId,
        document.tenantId,
        document.companyId,
        session.id
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
      summary: `Duplicate decision: ${decision}`,
      changeSource: 'MANUAL',
      metadata: {
        suspectedOfId,
        decision,
        reason,
      },
    });

    const response = {
      success: true,
      data: {
        documentId,
        suspectedOfId,
        decision,
        reason,
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
          endpoint: `/api/processing-documents/${documentId}/duplicate-decision`,
          method: 'POST',
          requestHash: '',
          response: response as object,
          statusCode: 200,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error, 'duplicate-decision');
  }
}
