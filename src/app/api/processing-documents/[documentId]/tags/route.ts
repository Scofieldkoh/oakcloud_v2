/**
 * Document Tags API
 *
 * GET /api/processing-documents/:documentId/tags - Get tags for a document
 * POST /api/processing-documents/:documentId/tags - Add a tag to a document
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { prisma } from '@/lib/prisma';
import { getProcessingDocument } from '@/services/document-processing.service';
import {
  getDocumentTags,
  addTagToDocument,
  createAndAddTagToDocument,
} from '@/services/document-tag.service';
import { addTagToDocumentSchema, createAndAddTagSchema } from '@/lib/validations/document-tag';
import { createAuditLog } from '@/lib/audit';
import { z } from 'zod';

type RouteParams = { params: Promise<{ documentId: string }> };

/**
 * GET /api/processing-documents/:documentId/tags
 * Get all tags for a document
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    const processingDoc = await getProcessingDocument(documentId);

    if (!processingDoc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Get the base document for company context
    const document = await prisma.document.findUnique({
      where: { id: processingDoc.documentId },
      select: { companyId: true, tenantId: true },
    });

    if (!document || !document.companyId) {
      return NextResponse.json({ error: 'Base document not found' }, { status: 404 });
    }

    // Check permission
    await requirePermission(session, 'document', 'read', document.companyId);

    if (!(await canAccessCompany(session, document.companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const tags = await getDocumentTags(documentId);

    return NextResponse.json({ tags });
  } catch (error) {
    return routeErrorResponse(error, { logLabel: 'Error fetching document tags' });
  }
}

/**
 * POST /api/processing-documents/:documentId/tags
 * Add a tag to a document
 *
 * Body options:
 * - { tagId: string } - Add existing tag
 * - { name: string, color?: TagColor } - Create and add new tag
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

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

    // Check permission - allow tagging if user can read documents
    // (tagging is a lightweight operation, not a full document update)
    await requirePermission(session, 'document', 'read', document.companyId);

    if (!(await canAccessCompany(session, document.companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    let docTag;

    // Check if adding existing tag or creating new one
    if ('tagId' in body) {
      // Add existing tag
      const input = addTagToDocumentSchema.parse(body);
      docTag = await addTagToDocument(documentId, input.tagId, {
        tenantId: document.tenantId,
        companyId: document.companyId,
        userId: session.id,
      });
    } else if ('name' in body) {
      // Create and add new tag
      const input = createAndAddTagSchema.parse(body);
      docTag = await createAndAddTagToDocument(documentId, input, {
        tenantId: document.tenantId,
        companyId: document.companyId,
        userId: session.id,
      });
    } else {
      return NextResponse.json(
        { error: 'Invalid input: provide either tagId or name' },
        { status: 400 }
      );
    }

    // Audit log
    await createAuditLog({
      tenantId: document.tenantId,
      userId: session.id,
      companyId: document.companyId,
      action: 'UPDATE',
      entityType: 'ProcessingDocument',
      entityId: documentId,
      entityName: document.fileName || documentId,
      summary: `Added tag "${docTag.name}" to document`,
      changeSource: 'MANUAL',
      changes: {
        tags: { old: null, new: docTag.name },
      },
    });

    return NextResponse.json({ tag: docTag }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    return routeErrorResponse(error, {
      notFound: ['Tag not found'],
      conflict: ['Document already has this tag', 'A tag with this name already exists'],
      logLabel: 'Error adding tag to document',
    });
  }
}
