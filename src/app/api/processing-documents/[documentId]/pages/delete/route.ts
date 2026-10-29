/**
 * Delete Pages API
 *
 * POST /api/processing-documents/:documentId/pages/delete
 * Deletes specified pages from an existing PDF document.
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
import { deletePdfPages } from '@/services/pdf-manipulation.service';

const log = createLogger('delete-pages');

type RouteParams = { params: Promise<{ documentId: string }> };

interface DeleteRequest {
  pageNumbers: number[]; // Array of page numbers to delete (1-indexed)
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    // Parse request body
    const body: DeleteRequest = await request.json();
    const { pageNumbers } = body;

    if (!pageNumbers || !Array.isArray(pageNumbers) || pageNumbers.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'pageNumbers array is required' } },
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
          select: { id: true, pageNumber: true },
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
        { success: false, error: { code: 'INVALID_TYPE', message: 'Can only delete pages from PDF documents' } },
        { status: 400 }
      );
    }

    // Validate page numbers
    const uniquePageNumbers = [...new Set(pageNumbers)].sort((a, b) => a - b);
    for (const pageNum of uniquePageNumbers) {
      if (pageNum < 1 || pageNum > pages.length) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid page number ${pageNum}: must be between 1 and ${pages.length}`,
            },
          },
          { status: 400 }
        );
      }
    }

    // Cannot delete all pages
    if (uniquePageNumbers.length >= pages.length) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Cannot delete all pages from the document',
          },
        },
        { status: 400 }
      );
    }

    // Download existing PDF from storage
    const existingPdfBytes = await storage.download(document.storageKey);
    if (!existingPdfBytes) {
      return NextResponse.json(
        { success: false, error: { code: 'STORAGE_ERROR', message: 'Failed to retrieve document' } },
        { status: 500 }
      );
    }

    // Delete pages from PDF
    const { pdfBytes, pagesDeleted, newTotalPages } = await deletePdfPages(
      Buffer.from(existingPdfBytes),
      uniquePageNumbers
    );

    // Upload modified PDF (replace existing)
    await storage.upload(document.storageKey, Buffer.from(pdfBytes), {
      contentType: 'application/pdf',
    });

    // Update Document file size
    await prisma.document.update({
      where: { id: document.id },
      data: { fileSize: pdfBytes.length },
    });

    // Delete DocumentPage records and renumber remaining pages in a transaction
    await prisma.$transaction(async (tx) => {
      // Get page IDs to delete
      const pageIdsToDelete = pages
        .filter((p) => uniquePageNumbers.includes(p.pageNumber))
        .map((p) => p.id);

      // Delete the pages
      await tx.documentPage.deleteMany({
        where: { id: { in: pageIdsToDelete } },
      });

      // Get remaining pages and renumber them
      const remainingPages = pages.filter((p) => !uniquePageNumbers.includes(p.pageNumber));

      // Step 1: Set all remaining pages to negative numbers (to avoid unique constraint)
      for (const page of remainingPages) {
        await tx.documentPage.update({
          where: { id: page.id },
          data: { pageNumber: -page.pageNumber },
        });
      }

      // Step 2: Renumber to sequential 1, 2, 3...
      let newPageNumber = 1;
      for (const page of remainingPages) {
        await tx.documentPage.update({
          where: { id: page.id },
          data: { pageNumber: newPageNumber },
        });
        newPageNumber++;
      }
    });

    // Update ProcessingDocument page count and lock version
    await prisma.processingDocument.update({
      where: { id: documentId },
      data: {
        pageCount: newTotalPages,
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
      summary: `Deleted ${pagesDeleted} page(s) from document`,
      metadata: {
        action: 'DELETE_PAGES',
        deletedPageNumbers: uniquePageNumbers,
        pagesDeleted,
        newTotalPages,
      },
    });

    log.info(`Deleted ${pagesDeleted} pages from document ${documentId}`, {
      documentId,
      deletedPageNumbers: uniquePageNumbers,
      newTotalPages,
    });

    return NextResponse.json({
      success: true,
      data: {
        documentId,
        pagesDeleted,
        newPageCount: newTotalPages,
        deletedPageNumbers: uniquePageNumbers,
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    log.error('Failed to delete pages', error);

    return handleApiError(error, 'delete-pages');
  }
}
