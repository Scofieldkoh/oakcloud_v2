/**
 * Page Image API
 *
 * GET /api/processing-documents/{documentId}/pages/{pageNumber}/image - Serve page image
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { requireAuth, canAccessCompany, canAccessWorkspace } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';

/**
 * Generate an SVG placeholder image
 * Returns a simple SVG with "No Preview" text
 */
function generatePlaceholderSVG(width = 600, height = 800): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f3f4f6"/>
  <rect x="2" y="2" width="${width - 4}" height="${height - 4}" fill="none" stroke="#e5e7eb" stroke-width="2" stroke-dasharray="8,4"/>
  <g transform="translate(${width / 2}, ${height / 2})">
    <rect x="-60" y="-50" width="120" height="100" fill="#e5e7eb" rx="8"/>
    <path d="M-30,-20 L30,-20 L30,10 L20,0 L5,15 L-10,5 L-30,25 L-30,-20Z" fill="#9ca3af"/>
    <circle cx="15" cy="-5" r="8" fill="#9ca3af"/>
  </g>
  <text x="${width / 2}" y="${height / 2 + 80}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="16" fill="#6b7280">No Preview Available</text>
  <text x="${width / 2}" y="${height / 2 + 105}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#9ca3af">Image file not found</text>
</svg>`;
}

interface RouteParams {
  params: Promise<{ documentId: string; pageNumber: string }>;
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
 * GET /api/processing-documents/{documentId}/pages/{pageNumber}/image
 * Serve the rendered page image
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { documentId, pageNumber: pageNumberStr } = await params;
    const pageNumber = parseInt(pageNumberStr, 10);

    if (isNaN(pageNumber) || pageNumber < 1) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid page number' },
        },
        { status: 400 }
      );
    }

    // Get the processing document with its document and page
    const processingDoc = await prisma.processingDocument.findUnique({
      where: { id: documentId },
      include: {
        document: {
          select: {
            companyId: true,
            tenantId: true,
          },
        },
        pages: {
          where: { pageNumber },
          select: {
            storageKey: true,
            imageFingerprint: true,
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

    // Check access - either via company or tenant (for unassigned documents)
    const companyId = processingDoc.document?.companyId;
    const tenantId = processingDoc.document?.tenantId;

    // If document has a company, check company access
    if (companyId) {
      if (!(await canAccessCompany(session, companyId))) {
        return NextResponse.json(
          {
            success: false,
            error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
          },
          { status: 403 }
        );
      }
    } else if (tenantId) {
      // For unassigned documents, check tenant access
      if (!canAccessWorkspace(session, tenantId)) {
        return NextResponse.json(
          {
            success: false,
            error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
          },
          { status: 403 }
        );
      }
    } else {
      // No company or tenant - deny access
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        },
        { status: 403 }
      );
    }

    const page = processingDoc.pages[0];
    if (!page || !page.storageKey) {
      // No page record or no storage key - return placeholder
      const placeholderSVG = generatePlaceholderSVG();
      return new NextResponse(placeholderSVG, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Length': Buffer.byteLength(placeholderSVG).toString(),
          'Cache-Control': 'no-cache',
          'X-Placeholder': 'true',
          'X-Reason': 'page-not-found',
        },
      });
    }

    // Check if file exists in storage
    const fileExists = await storage.exists(page.storageKey);

    // If file doesn't exist, return a placeholder SVG
    if (!fileExists) {
      const placeholderSVG = generatePlaceholderSVG();
      return new NextResponse(placeholderSVG, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Length': Buffer.byteLength(placeholderSVG).toString(),
          'Cache-Control': 'no-cache', // Don't cache placeholder
          'X-Placeholder': 'true',
        },
      });
    }

    // Read the image file from storage
    const imageBuffer = await storage.download(page.storageKey);

    // Determine content type from file extension
    const extension = page.storageKey.substring(page.storageKey.lastIndexOf('.')).toLowerCase();
    const contentType = MIME_TYPES[extension] || 'application/octet-stream';

    // Return the image with appropriate headers
    const response = new NextResponse(new Uint8Array(imageBuffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': imageBuffer.length.toString(),
        'Cache-Control': 'private, max-age=3600', // Cache for 1 hour
      },
    });

    // Add ETag based on fingerprint if available
    if (page.imageFingerprint) {
      response.headers.set('ETag', `"${page.imageFingerprint}"`);
    }

    return response;
  } catch (error) {
    console.error('Page image API error:', error);

    return handleApiError(error, 'page-image');
  }
}
