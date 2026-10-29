import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { reconcilePendingBatchExtraction } from '@/services/document-extraction.service';

type Params = { documentId: string };

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    const processingDoc = await prisma.processingDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        pipelineStatus: true,
        document: {
          select: {
            tenantId: true,
            companyId: true,
          },
        },
      },
    });

    if (!processingDoc || !processingDoc.document?.tenantId || !processingDoc.document.companyId) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Document not found' },
        },
        { status: 404 }
      );
    }

    await requirePermission(session, 'document', 'read', processingDoc.document.companyId);

    if (!(await canAccessCompany(session, processingDoc.document.companyId))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        },
        { status: 403 }
      );
    }

    if (
      processingDoc.pipelineStatus !== 'QUEUED' &&
      processingDoc.pipelineStatus !== 'PROCESSING'
    ) {
      return NextResponse.json({
        success: true,
        data: { status: 'NOT_PENDING' },
        meta: {
          requestId: uuidv4(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const result = await reconcilePendingBatchExtraction(
      processingDoc.id,
      processingDoc.document.tenantId,
      processingDoc.document.companyId,
      session.id
    );

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Processing document reconcile API error:', error);

    return handleApiError(error, 'document-reconcile');
  }
}
