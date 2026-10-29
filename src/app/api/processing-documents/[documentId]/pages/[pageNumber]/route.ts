/**
 * Document Page API
 *
 * PATCH /api/processing-documents/{documentId}/pages/{pageNumber} - Update page properties (e.g., rotation)
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

interface RouteParams {
  params: Promise<{ documentId: string; pageNumber: string }>;
}

const updatePageSchema = z.object({
  rotation: z.number().refine((val) => [0, 90, 180, 270].includes(val), {
    message: 'Rotation must be 0, 90, 180, or 270 degrees',
  }),
});

/**
 * PATCH /api/processing-documents/{documentId}/pages/{pageNumber}
 * Update page properties (rotation)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { documentId, pageNumber: pageNumberStr } = await params;
    const pageNumber = parseInt(pageNumberStr, 10);

    if (isNaN(pageNumber) || pageNumber < 1) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Invalid page number' },
        },
        { status: 400 }
      );
    }

    // Parse request body
    const body = await request.json();
    const parseResult = updatePageSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parseResult.error.errors[0]?.message || 'Invalid input',
          },
        },
        { status: 400 }
      );
    }

    const { rotation } = parseResult.data;

    // Get the processing document
    const processingDoc = await prisma.processingDocument.findUnique({
      where: { id: documentId },
      include: {
        document: {
          select: {
            companyId: true,
            tenantId: true,
          },
        },
      },
    });

    if (!processingDoc) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Processing document not found' },
        },
        { status: 404 }
      );
    }

    // Check access to the company
    const companyId = processingDoc.document?.companyId;
    if (!companyId) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Document has no associated company' },
        },
        { status: 404 }
      );
    }

    // Check permission to update documents
    await requirePermission(session, 'document', 'update', companyId);

    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        },
        { status: 403 }
      );
    }

    // Update the page rotation
    const updatedPage = await prisma.documentPage.updateMany({
      where: {
        processingDocumentId: documentId,
        pageNumber: pageNumber,
      },
      data: {
        rotationDeg: rotation,
      },
    });

    if (updatedPage.count === 0) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Page not found' },
        },
        { status: 404 }
      );
    }

    // Fetch the updated page
    const page = await prisma.documentPage.findFirst({
      where: {
        processingDocumentId: documentId,
        pageNumber: pageNumber,
      },
      select: {
        id: true,
        pageNumber: true,
        widthPx: true,
        heightPx: true,
        rotationDeg: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: page?.id,
        pageNumber: page?.pageNumber,
        width: page?.widthPx,
        height: page?.heightPx,
        rotation: page?.rotationDeg,
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Document page update API error:', error);

    return handleApiError(error, 'document-page');
  }
}
