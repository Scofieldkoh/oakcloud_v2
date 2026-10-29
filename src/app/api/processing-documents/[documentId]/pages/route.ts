/**
 * Document Pages API
 *
 * GET /api/processing-documents/{documentId}/pages - Get document page metadata
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ documentId: string }>;
}

/**
 * GET /api/processing-documents/{documentId}/pages
 * Get all pages for a processing document with their metadata
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    // Get the processing document with its pages and document for company context and file info
    const processingDoc = await prisma.processingDocument.findUnique({
      where: { id: documentId },
      select: {
        lockVersion: true,
        document: {
          select: {
            companyId: true,
            tenantId: true,
            mimeType: true,
            originalFileName: true,
            storageKey: true,
          },
        },
        pages: {
          orderBy: { pageNumber: 'asc' },
          select: {
            id: true,
            pageNumber: true,
            widthPx: true,
            heightPx: true,
            rotationDeg: true,
            renderDpi: true,
            storageKey: true,
            imageFingerprint: true,
            ocrProvider: true,
            textAcquisitionDecision: true,
            createdAt: true,
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

    // Check access to the company via document relation
    const companyId = processingDoc.document?.companyId;
    if (!companyId || !(await canAccessCompany(session, companyId))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        },
        { status: 403 }
      );
    }

    // Detect if this is a PDF file (from the Document relation)
    const isPdf =
      processingDoc.document?.mimeType === 'application/pdf' ||
      processingDoc.document?.originalFileName?.toLowerCase().endsWith('.pdf') ||
      processingDoc.document?.storageKey?.toLowerCase().endsWith('.pdf');

    // Transform pages to include image URL
    const pages = processingDoc.pages.map((page) => ({
      id: page.id,
      pageNumber: page.pageNumber,
      width: page.widthPx,
      height: page.heightPx,
      rotation: page.rotationDeg,
      dpi: page.renderDpi,
      imageUrl: `/api/processing-documents/${documentId}/pages/${page.pageNumber}/image`,
      fingerprint: page.imageFingerprint,
      ocrProvider: page.ocrProvider,
      textAcquisition: page.textAcquisitionDecision,
      createdAt: page.createdAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      data: {
        documentId,
        pageCount: pages.length,
        pages,
        // PDF-specific fields for client-side rendering
        isPdf: isPdf || false,
        // Include lockVersion in URL for cache busting after page modifications
        pdfUrl: isPdf ? `/api/processing-documents/${documentId}/pdf?v=${processingDoc.lockVersion}` : null,
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Document pages API error:', error);

    return handleApiError(error, 'document-pages');
  }
}
