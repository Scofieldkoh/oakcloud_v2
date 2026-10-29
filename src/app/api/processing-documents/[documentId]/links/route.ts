/**
 * Document Links API
 *
 * GET /api/processing-documents/:documentId/links - Get all linked documents
 * POST /api/processing-documents/:documentId/links - Create a new link
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { getProcessingDocument } from '@/services/document-processing.service';
import {
  getDocumentLinks,
  createDocumentLink,
  searchLinkableDocuments,
  linkTypeLabels,
  reverseLinkTypeLabels,
} from '@/services/document-link.service';
import { createAuditLog } from '@/lib/audit';
import type { DocumentLinkType } from '@/generated/prisma';

type Params = { documentId: string };

/**
 * GET /api/processing-documents/:documentId/links
 * Get all linked documents
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;
    const searchQuery = request.nextUrl.searchParams.get('search');

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

    if (!document || !document.companyId) {
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

    // If search query provided, return linkable documents
    if (searchQuery !== null) {
      const linkableDocuments = await searchLinkableDocuments(
        documentId,
        document.tenantId,
        document.companyId,
        searchQuery || undefined
      );

      return NextResponse.json({
        success: true,
        data: { documents: linkableDocuments },
        meta: {
          requestId: uuidv4(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Otherwise, return existing links
    const links = await getDocumentLinks(documentId);

    return NextResponse.json({
      success: true,
      data: {
        links: links.map((link) => ({
          ...link,
          linkTypeLabel:
            link.linkDirection === 'target'
              ? linkTypeLabels[link.linkType]
              : reverseLinkTypeLabels[link.linkType],
          linkedAt: link.linkedAt.toISOString(),
        })),
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/processing-documents/:documentId/links
 * Create a new link
 */
export async function POST(
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

    const body = await request.json();
    const { targetDocumentId, linkType, notes } = body as {
      targetDocumentId: string;
      linkType: DocumentLinkType;
      notes?: string;
    };

    if (!targetDocumentId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'targetDocumentId is required',
          },
        },
        { status: 400 }
      );
    }

    if (!linkType) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'linkType is required',
          },
        },
        { status: 400 }
      );
    }

    // Create the link
    const link = await createDocumentLink({
      sourceDocumentId: documentId,
      targetDocumentId,
      linkType,
      notes,
      linkedById: session.id,
    });

    // Create audit log
    await createAuditLog({
      tenantId: document.tenantId,
      userId: session.id,
      companyId: document.companyId,
      action: 'CREATE',
      entityType: 'DocumentLink',
      entityId: link.id,
      summary: `Linked document to ${targetDocumentId} (${linkType})`,
      changeSource: 'MANUAL',
      metadata: {
        sourceDocumentId: documentId,
        targetDocumentId,
        linkType,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          link: {
            id: link.id,
            sourceDocumentId: link.sourceDocumentId,
            targetDocumentId: link.targetDocumentId,
            linkType: link.linkType,
            linkTypeLabel: linkTypeLabels[link.linkType],
            notes: link.notes,
            linkedAt: link.linkedAt.toISOString(),
          },
        },
        meta: {
          requestId: uuidv4(),
          timestamp: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown): NextResponse {
  if (
    error instanceof Error &&
    (error.message.includes('already exists') || error.message.includes('Cannot link'))
  ) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: error.message },
      },
      { status: 400 }
    );
  }

  return handleApiError(error, 'document-links');
}
