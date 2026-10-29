/**
 * Processing Document API
 *
 * GET /api/processing-documents/:documentId - Get document details
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { getProcessingDocument } from '@/services/document-processing.service';
import { getCurrentRevision } from '@/services/document-revision.service';

type Params = { documentId: string };

/**
 * GET /api/processing-documents/:documentId
 * Get processing document details
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

    // Get the base document with file details and company info
    const document = await prisma.document.findUnique({
      where: { id: processingDoc.documentId },
      select: {
        companyId: true,
        tenantId: true,
        fileName: true,
        originalFileName: true,
        mimeType: true,
        fileSize: true,
        company: {
          select: {
            id: true,
            name: true,
          },
        },
      },
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

    // Get current revision if available, or latest draft revision
    let currentRevision = processingDoc.currentRevisionId
      ? await getCurrentRevision(documentId)
      : null;

    // If no approved revision, get the latest draft revision to show extracted data
    if (!currentRevision) {
      const latestRevision = await prisma.documentRevision.findFirst({
        where: { processingDocumentId: documentId },
        orderBy: { revisionNumber: 'desc' },
        include: {
          items: {
            orderBy: { lineNo: 'asc' },
          },
        },
      });
      if (latestRevision) {
        currentRevision = {
          ...latestRevision,
          totalAmount: latestRevision.totalAmount,
          subtotal: latestRevision.subtotal,
          taxAmount: latestRevision.taxAmount,
          homeEquivalent: latestRevision.homeEquivalent,
          items: latestRevision.items,
        };
      }
    }

    // Get pages info
    const pages = await prisma.documentPage.findMany({
      where: { processingDocumentId: documentId },
      select: {
        pageNumber: true,
        widthPx: true,
        heightPx: true,
      },
      orderBy: { pageNumber: 'asc' },
    });

    return NextResponse.json({
      success: true,
      data: {
        document: {
          id: processingDoc.id,
          documentId: processingDoc.documentId,
          isContainer: processingDoc.isContainer,
          parentDocumentId: processingDoc.parentProcessingDocId,
          pageFrom: processingDoc.pageFrom,
          pageTo: processingDoc.pageTo,
          pageCount: processingDoc.pageCount,
          pipelineStatus: processingDoc.pipelineStatus,
          duplicateStatus: processingDoc.duplicateStatus,
          currentRevisionId: processingDoc.currentRevisionId,
          lockVersion: processingDoc.lockVersion,
          createdAt: processingDoc.createdAt,
          pages: pages.length,
          // Versioning
          version: processingDoc.version,
          rootDocumentId: processingDoc.rootDocumentId,
          // File details (prefer renamed fileName after approval, fallback to original)
          fileName: document.fileName || document.originalFileName,
          mimeType: document.mimeType,
          fileSize: document.fileSize,
          // Company info
          company: document.company,
        },
        currentRevision: currentRevision
          ? {
              id: currentRevision.id,
              revisionNumber: currentRevision.revisionNumber,
              status: currentRevision.status,
              documentCategory: currentRevision.documentCategory,
              vendorName: currentRevision.vendorName,
              documentNumber: currentRevision.documentNumber,
              documentDate: currentRevision.documentDate,
              totalAmount: currentRevision.totalAmount.toString(),
              currency: currentRevision.currency,
              homeEquivalent: currentRevision.homeEquivalent?.toString(),
              validationStatus: currentRevision.validationStatus,
              lineItemCount: currentRevision.items.length,
            }
          : null,
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error, 'processing-document');
  }
}
