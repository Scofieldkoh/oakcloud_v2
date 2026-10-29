/**
 * Single Document Link API
 *
 * DELETE /api/processing-documents/:documentId/links/:linkId - Delete a link
 * PATCH /api/processing-documents/:documentId/links/:linkId - Update a link
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { getProcessingDocument } from '@/services/document-processing.service';
import {
  deleteDocumentLink,
  updateDocumentLink,
  linkTypeLabels,
} from '@/services/document-link.service';
import { createAuditLog } from '@/lib/audit';
import type { DocumentLinkType } from '@/generated/prisma';

type Params = { documentId: string; linkId: string };

/**
 * DELETE /api/processing-documents/:documentId/links/:linkId
 * Delete a link
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireAuth();
    const { documentId, linkId } = await params;

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

    // Get the base document for company context
    const document = await prisma.document.findUnique({
      where: { id: processingDoc.documentId },
      select: { companyId: true, tenantId: true },
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
    await requirePermission(session, 'document', 'update', document.companyId);

    if (!(await canAccessCompany(session, document.companyId))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        },
        { status: 403 }
      );
    }

    // Verify link belongs to this document
    const link = await prisma.documentLink.findUnique({
      where: { id: linkId },
    });

    if (!link) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Link not found' },
        },
        { status: 404 }
      );
    }

    if (link.sourceDocumentId !== documentId && link.targetDocumentId !== documentId) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Link does not belong to this document' },
        },
        { status: 400 }
      );
    }

    // Delete the link
    await deleteDocumentLink(linkId, session.id);

    // Create audit log
    await createAuditLog({
      tenantId: document.tenantId,
      userId: session.id,
      companyId: document.companyId,
      action: 'DELETE',
      entityType: 'DocumentLink',
      entityId: linkId,
      summary: `Removed link between ${link.sourceDocumentId} and ${link.targetDocumentId}`,
      changeSource: 'MANUAL',
      metadata: {
        sourceDocumentId: link.sourceDocumentId,
        targetDocumentId: link.targetDocumentId,
        linkType: link.linkType,
      },
    });

    return NextResponse.json({
      success: true,
      data: { deleted: true },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error, 'document-link');
  }
}

/**
 * PATCH /api/processing-documents/:documentId/links/:linkId
 * Update a link
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireAuth();
    const { documentId, linkId } = await params;

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

    // Get the base document for company context
    const document = await prisma.document.findUnique({
      where: { id: processingDoc.documentId },
      select: { companyId: true, tenantId: true },
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
    await requirePermission(session, 'document', 'update', document.companyId);

    if (!(await canAccessCompany(session, document.companyId))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        },
        { status: 403 }
      );
    }

    // Verify link belongs to this document
    const existingLink = await prisma.documentLink.findUnique({
      where: { id: linkId },
    });

    if (!existingLink) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Link not found' },
        },
        { status: 404 }
      );
    }

    if (existingLink.sourceDocumentId !== documentId && existingLink.targetDocumentId !== documentId) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Link does not belong to this document' },
        },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { linkType, notes } = body as {
      linkType?: DocumentLinkType;
      notes?: string | null;
    };

    // Update the link
    const updatedLink = await updateDocumentLink(
      linkId,
      { linkType, notes },
      session.id
    );

    // Create audit log
    await createAuditLog({
      tenantId: document.tenantId,
      userId: session.id,
      companyId: document.companyId,
      action: 'UPDATE',
      entityType: 'DocumentLink',
      entityId: linkId,
      summary: `Updated link between ${existingLink.sourceDocumentId} and ${existingLink.targetDocumentId}`,
      changeSource: 'MANUAL',
      metadata: {
        linkType: updatedLink.linkType,
        notes: updatedLink.notes,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        link: {
          id: updatedLink.id,
          sourceDocumentId: updatedLink.sourceDocumentId,
          targetDocumentId: updatedLink.targetDocumentId,
          linkType: updatedLink.linkType,
          linkTypeLabel: linkTypeLabels[updatedLink.linkType],
          notes: updatedLink.notes,
          linkedAt: updatedLink.linkedAt.toISOString(),
        },
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error, 'document-link');
  }
}
