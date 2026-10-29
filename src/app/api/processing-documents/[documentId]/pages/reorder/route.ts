/**
 * Reorder Pages API
 *
 * POST /api/processing-documents/:documentId/pages/reorder
 * Reorders pages within an existing PDF document.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import { createAuditLog } from '@/lib/audit';
import { createLogger } from '@/lib/logger';
import { reorderPdfPages } from '@/services/pdf-manipulation.service';
import { generateFingerprint } from '@/lib/encryption';

const log = createLogger('reorder-pages');

type RouteParams = { params: Promise<{ documentId: string }> };

interface ReorderRequest {
  newOrder: number[]; // Array of page numbers in new order (1-indexed)
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    // Parse request body
    const body: ReorderRequest = await request.json();
    const { newOrder } = body;

    if (!newOrder || !Array.isArray(newOrder) || newOrder.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'newOrder array is required' } },
        { status: 400 }
      );
    }

    // Get the processing document with its base document and pages
    const processingDoc = await prisma.processingDocument.findUnique({
      where: { id: documentId, deletedAt: null },
      include: {
        document: {
          select: {
            id: true,
            tenantId: true,
            companyId: true,
            storageKey: true,
            mimeType: true,
          },
        },
        pages: {
          select: { id: true, pageNumber: true, widthPx: true, heightPx: true, rotationDeg: true },
          orderBy: { pageNumber: 'asc' },
        },
      },
    });

    if (!processingDoc) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } },
        { status: 404 }
      );
    }

    const { document, pages } = processingDoc;
    if (!document.companyId) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_STATE', message: 'Document has no company assigned' } },
        { status: 400 }
      );
    }

    // Check permissions
    await requirePermission(session, 'document', 'update', document.companyId);
    if (!(await canAccessCompany(session, document.companyId))) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } },
        { status: 403 }
      );
    }

    // Check if document is a PDF
    if (document.mimeType !== 'application/pdf') {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_TYPE', message: 'Can only reorder pages in PDF documents' } },
        { status: 400 }
      );
    }

    // Validate newOrder matches page count
    if (newOrder.length !== pages.length) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `newOrder length (${newOrder.length}) must match page count (${pages.length})`,
          },
        },
        { status: 400 }
      );
    }

    // Validate all page numbers are present exactly once
    const sortedOrder = [...newOrder].sort((a, b) => a - b);
    for (let i = 0; i < pages.length; i++) {
      if (sortedOrder[i] !== i + 1) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `newOrder must contain each page number 1-${pages.length} exactly once`,
            },
          },
          { status: 400 }
        );
      }
    }

    // Check if order actually changed
    const isUnchanged = newOrder.every((pageNum, index) => pageNum === index + 1);
    if (isUnchanged) {
      return NextResponse.json({
        success: true,
        data: {
          documentId,
          pageCount: pages.length,
          reordered: false,
          message: 'Page order unchanged',
        },
        meta: {
          requestId: uuidv4(),
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Download existing PDF from storage
    const existingPdfBytes = await storage.download(document.storageKey);
    if (!existingPdfBytes) {
      return NextResponse.json(
        { success: false, error: { code: 'STORAGE_ERROR', message: 'Failed to retrieve document' } },
        { status: 500 }
      );
    }

    // Reorder pages in PDF
    const { pdfBytes, pageMapping } = await reorderPdfPages(Buffer.from(existingPdfBytes), newOrder);

    // Upload modified PDF (replace existing)
    await storage.upload(document.storageKey, Buffer.from(pdfBytes), {
      contentType: 'application/pdf',
    });

    // Update Document file size
    await prisma.document.update({
      where: { id: document.id },
      data: { fileSize: pdfBytes.length },
    });

    // Update DocumentPage records in a transaction
    // We need to handle the unique constraint on [processingDocumentId, pageNumber]
    // Strategy: First set all to negative numbers, then update to final positions
    await prisma.$transaction(async (tx) => {
      // Step 1: Set all page numbers to negative (temporary)
      for (const page of pages) {
        await tx.documentPage.update({
          where: { id: page.id },
          data: { pageNumber: -page.pageNumber },
        });
      }

      // Step 2: Set to new page numbers based on mapping
      // pageMapping tells us: oldPageNumber -> newPageNumber
      // We need to find the page record by its old page number and update to new
      for (const mapping of pageMapping) {
        const originalPage = pages.find((p) => p.pageNumber === mapping.oldPageNumber);
        if (originalPage) {
          await tx.documentPage.update({
            where: { id: originalPage.id },
            data: {
              pageNumber: mapping.newPageNumber,
              // Update fingerprint since page position changed
              imageFingerprint: generateFingerprint(`${document.storageKey}:${mapping.newPageNumber}`, 16),
            },
          });
        }
      }
    });

    // Update ProcessingDocument lock version
    await prisma.processingDocument.update({
      where: { id: documentId },
      data: {
        lockVersion: { increment: 1 },
      },
    });

    // Create audit log
    await createAuditLog({
      tenantId: document.tenantId,
      userId: session.id,
      companyId: document.companyId,
      action: 'UPDATE',
      entityType: 'ProcessingDocument',
      entityId: documentId,
      summary: `Reordered ${pages.length} pages`,
      metadata: {
        action: 'REORDER_PAGES',
        newOrder,
        pageMapping,
      },
    });

    log.info(`Reordered pages in document ${documentId}`, {
      documentId,
      pageCount: pages.length,
      newOrder,
    });

    return NextResponse.json({
      success: true,
      data: {
        documentId,
        pageCount: pages.length,
        reordered: true,
        pageMapping,
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    log.error('Failed to reorder pages', error);

    return handleApiError(error, 'reorder-pages');
  }
}
