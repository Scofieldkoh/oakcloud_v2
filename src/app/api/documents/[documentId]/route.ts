import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import { buildContentDispositionHeader } from '@/lib/api-helpers';
import { routeErrorResponse } from '@/lib/api-route-errors';

const CANCELLABLE_STATUSES = ['PENDING', 'PROCESSING', 'EXTRACTED', 'FAILED'];

/**
 * GET /api/documents/:documentId
 *
 * Streams a pending document back to its uploader so an upload started from
 * another screen can continue in the BizFile review workspace.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;
    const document = await prisma.document.findUnique({ where: { id: documentId } });

    if (!document || !document.storageKey) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    if (!session.isSuperAdmin && document.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (
      document.uploadedById !== session.id
      && !session.isSuperAdmin
      && !session.isWorkspaceAdmin
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!CANCELLABLE_STATUSES.includes(document.extractionStatus || '')) {
      return NextResponse.json(
        { error: 'Document is no longer available for review' },
        { status: 409 },
      );
    }

    const file = await storage.download(document.storageKey);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': document.mimeType || 'application/octet-stream',
        'Content-Length': String(file.length),
        'Content-Disposition': buildContentDispositionHeader(
          'inline',
          document.originalFileName || document.fileName,
        ),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Document read error:', error);
    return routeErrorResponse(error);
  }
}

/**
 * DELETE /api/documents/:documentId
 *
 * Cancel/clean up a pending document that has not yet been confirmed.
 * Deletes the storage file and the document record.
 * Only allowed for documents in PENDING, PROCESSING, EXTRACTED, or FAILED status.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Check tenant access
    if (!session.isSuperAdmin && document.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only allow uploader or admin to cancel
    if (
      document.uploadedById !== session.id &&
      !session.isSuperAdmin &&
      !session.isWorkspaceAdmin
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only allow cancellation for pre-confirm statuses
    if (!CANCELLABLE_STATUSES.includes(document.extractionStatus || '')) {
      return NextResponse.json(
        { error: 'Document cannot be cancelled in its current status' },
        { status: 409 }
      );
    }

    // Delete storage file (best-effort)
    if (document.storageKey) {
      try {
        await storage.delete(document.storageKey);
      } catch {
        // Log but don't fail — record cleanup is more important
      }
    }

    // Delete the document record
    await prisma.document.delete({ where: { id: documentId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Document delete error:', error);
    return routeErrorResponse(error);
  }
}
