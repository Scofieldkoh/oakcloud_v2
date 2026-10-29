/**
 * PDF Streaming API
 *
 * GET /api/processing-documents/{documentId}/pdf - Stream the original PDF file
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';

interface RouteParams {
  params: Promise<{ documentId: string }>;
}

/**
 * GET /api/processing-documents/{documentId}/pdf
 * Stream the original PDF file for client-side rendering
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    // Get the processing document with its storage key (from Document relation)
    const processingDoc = await prisma.processingDocument.findUnique({
      where: { id: documentId },
      include: {
        document: {
          select: {
            companyId: true,
            storageKey: true,
            originalFileName: true,
            mimeType: true,
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

    // Get file info from the Document relation
    const storageKey = processingDoc.document?.storageKey;
    const documentMimeType = processingDoc.document?.mimeType;
    const documentOriginalFileName = processingDoc.document?.originalFileName;

    if (!storageKey) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'FILE_NOT_FOUND', message: 'Document storage key not found' },
        },
        { status: 404 }
      );
    }

    // Verify this is a PDF file
    const isPdf =
      documentMimeType === 'application/pdf' ||
      documentOriginalFileName?.toLowerCase().endsWith('.pdf') ||
      storageKey?.toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Document is not a PDF' },
        },
        { status: 400 }
      );
    }

    // Check if file exists in storage
    const exists = await storage.exists(storageKey);
    if (!exists) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'FILE_NOT_FOUND', message: 'PDF file not found in storage' },
        },
        { status: 404 }
      );
    }

    // Download the PDF from storage
    const pdfBuffer = await storage.download(storageKey);

    // Return the PDF with appropriate headers
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': pdfBuffer.length.toString(),
        'Content-Disposition': `inline; filename="${documentOriginalFileName || 'document.pdf'}"`,
        'Cache-Control': 'private, max-age=3600', // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error('PDF streaming API error:', error);

    return handleApiError(error, 'document-pdf');
  }
}
