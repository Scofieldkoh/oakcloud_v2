/**
 * Document Tag Removal API
 *
 * DELETE /api/processing-documents/:documentId/tags/:tagId - Remove a tag from a document
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { prisma } from '@/lib/prisma';
import { getProcessingDocument } from '@/services/document-processing.service';
import { removeTagFromDocument, getTag } from '@/services/document-tag.service';
import { createAuditLog } from '@/lib/audit';
import { z } from 'zod';

type RouteParams = { params: Promise<{ documentId: string; tagId: string }> };

// Validate params
const paramsSchema = z.object({
  documentId: z.string().uuid('Invalid document ID'),
  tagId: z.string().uuid('Invalid tag ID'),
});

/**
 * DELETE /api/processing-documents/:documentId/tags/:tagId
 * Remove a tag from a document
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { documentId, tagId } = paramsSchema.parse(await params);

    const processingDoc = await getProcessingDocument(documentId);

    if (!processingDoc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Get the base document for company context
    const document = await prisma.document.findUnique({
      where: { id: processingDoc.documentId },
      select: { companyId: true, tenantId: true, fileName: true },
    });

    if (!document || !document.companyId) {
      return NextResponse.json({ error: 'Base document not found' }, { status: 404 });
    }

    // Check permission - allow untagging if user can read documents
    await requirePermission(session, 'document', 'read', document.companyId);

    if (!(await canAccessCompany(session, document.companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get tag name for audit log
    const tag = await getTag(tagId, {
      tenantId: document.tenantId,
      companyId: document.companyId,
    });

    await removeTagFromDocument(documentId, tagId, {
      tenantId: document.tenantId,
      companyId: document.companyId,
    });

    // Audit log
    await createAuditLog({
      tenantId: document.tenantId,
      userId: session.id,
      companyId: document.companyId,
      action: 'UPDATE',
      entityType: 'ProcessingDocument',
      entityId: documentId,
      entityName: document.fileName || documentId,
      summary: `Removed tag "${tag?.name || tagId}" from document`,
      changeSource: 'MANUAL',
      changes: {
        tags: { old: tag?.name || tagId, new: null },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }
    return routeErrorResponse(error, {
      notFound: ['Tag not found', 'Document does not have this tag'],
      logLabel: 'Error removing tag from document',
    });
  }
}
