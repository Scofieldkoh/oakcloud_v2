import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { exportDocumentsToZip } from '@/services/document-export.service';

const MAX_BULK_DOWNLOAD_DOCUMENTS = 50;

/**
 * POST /api/generated-documents/bulk-download
 * Export multiple generated documents to a single ZIP of PDFs.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    await requirePermission(session, 'document', 'export');

    const body = await request.json();
    const documentIds: string[] = Array.isArray(body?.documentIds)
      ? body.documentIds
      : [];

    if (documentIds.length === 0) {
      return NextResponse.json(
        { error: 'documentIds array is required' },
        { status: 400 }
      );
    }

    if (documentIds.length > MAX_BULK_DOWNLOAD_DOCUMENTS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_BULK_DOWNLOAD_DOCUMENTS} documents per download` },
        { status: 400 }
      );
    }

    const tenantId = requireSessionWorkspaceId(session);
    const result = await exportDocumentsToZip(documentIds, {
      tenantId,
      userId: session.id,
    });

    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Content-Length': result.buffer.length.toString(),
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (error) {
    console.error('Bulk document download error:', error);
    return createErrorResponse(error);
  }
}
