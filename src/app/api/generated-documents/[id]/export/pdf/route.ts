import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { ApiError } from '@/lib/errors';
import { exportToPDF } from '@/services/document-export.service';
import { getGeneratedDocumentById } from '@/services/document-generator.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/generated-documents/[id]/export/pdf
 * Export document to PDF
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check export permission
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = requireSessionWorkspaceId(session);

    // Verify document exists
    const document = await getGeneratedDocumentById(id, tenantId);
    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Parse export options from query params
    // Only explicit overrides are forwarded; OakDoc refuses them because its
    // Word section layout is authoritative.
    const format = (searchParams.get('format') || undefined) as 'A4' | 'Letter' | undefined;
    const orientation = (searchParams.get('orientation') || undefined) as 'portrait' | 'landscape' | undefined;
    const filename = searchParams.get('filename') || undefined;

    // Generate PDF
    const result = await exportToPDF({
      documentId: id,
      tenantId,
      userId: session.id,
      format,
      orientation,
      filename,
    });

    // Return PDF as downloadable file
    // Convert Buffer to Uint8Array for NextResponse compatibility
    const pdfData = new Uint8Array(result.buffer);
    return new NextResponse(pdfData, {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Content-Length': result.buffer.length.toString(),
        'X-Page-Count': result.pageCount.toString(),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return createErrorResponse(error);
    console.error('PDF export error:', error);

    if (error instanceof Error && (error.message.includes('Chrome') || error.message.includes('Chromium'))) {
      return NextResponse.json(
        {
          error: 'PDF generation unavailable',
          details: 'Chrome/Chromium is not installed on the server',
        },
        { status: 503 }
      );
    }
    return createErrorResponse(error);
  }
}
