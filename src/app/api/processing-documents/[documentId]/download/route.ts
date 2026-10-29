/**
 * Document Download API
 *
 * GET /api/processing-documents/{documentId}/download - Download original document file
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';

interface RouteParams {
  params: Promise<{ documentId: string }>;
}

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
};

/**
 * GET /api/processing-documents/{documentId}/download
 * Download the original document file
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    // Get the processing document with its document
    const processingDoc = await prisma.processingDocument.findUnique({
      where: { id: documentId },
      include: {
        document: {
          select: {
            companyId: true,
            storageKey: true,
            fileName: true,
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

    const document = processingDoc.document;
    if (!document?.storageKey) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Document storage key not found' },
        },
        { status: 404 }
      );
    }

    // Check if file exists in storage
    const exists = await storage.exists(document.storageKey);
    if (!exists) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Document file not found in storage' },
        },
        { status: 404 }
      );
    }

    // Download the file from storage
    const fileBuffer = await storage.download(document.storageKey);

    // Determine content type
    const extension = document.storageKey.substring(document.storageKey.lastIndexOf('.')).toLowerCase();
    const contentType = document.mimeType || MIME_TYPES[extension] || 'application/octet-stream';

    // Use renamed filename after approval, fallback to original filename
    const downloadFileName = document.fileName || document.originalFileName;

    // Return the file with appropriate headers
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length.toString(),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(downloadFileName)}"`,
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (error) {
    console.error('Document download API error:', error);

    return handleApiError(error, 'document-download');
  }
}
