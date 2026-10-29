/**
 * Append Pages API
 *
 * POST /api/processing-documents/:documentId/pages/append
 * Appends new files (PDFs or images) to an existing document.
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
import { appendPagesToPdf, extractPdfPageDimensions } from '@/services/pdf-manipulation.service';
import { generateFingerprint } from '@/lib/encryption';

const log = createLogger('append-pages');

// Supported file types for appending
const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/tiff',
];

// Maximum file size per file (50MB)
const MAX_FILE_SIZE = 50 * 1024 * 1024;

type RouteParams = { params: Promise<{ documentId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    // Get the processing document with its base document
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
            fileName: true,
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

    const { document } = processingDoc;
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

    // Check if document is a PDF (only PDFs can have pages appended)
    if (document.mimeType !== 'application/pdf') {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_TYPE', message: 'Can only append pages to PDF documents' } },
        { status: 400 }
      );
    }

    // Parse multipart form data
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'At least one file is required' } },
        { status: 400 }
      );
    }

    // Validate files
    const filesToAppend: Array<{ buffer: Buffer; mimeType: string; fileName: string }> = [];
    for (const file of files) {
      // Check MIME type
      if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
        return NextResponse.json(
          { success: false, error: { code: 'INVALID_TYPE', message: `Unsupported file type: ${file.type}` } },
          { status: 400 }
        );
      }

      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { success: false, error: { code: 'FILE_TOO_LARGE', message: `File "${file.name}" exceeds 50MB limit` } },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      filesToAppend.push({
        buffer,
        mimeType: file.type,
        fileName: file.name,
      });
    }

    // Download existing PDF from storage
    const existingPdfBytes = await storage.download(document.storageKey);
    if (!existingPdfBytes) {
      return NextResponse.json(
        { success: false, error: { code: 'STORAGE_ERROR', message: 'Failed to retrieve existing document' } },
        { status: 500 }
      );
    }

    // Append pages to PDF
    const { pdfBytes, pagesAdded, newTotalPages } = await appendPagesToPdf(
      Buffer.from(existingPdfBytes),
      filesToAppend
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

    // Get dimensions for new pages
    const allPageDimensions = await extractPdfPageDimensions(Buffer.from(pdfBytes));
    const existingPageCount = processingDoc.pages.length;

    // Create DocumentPage records for new pages
    const newPages: Array<{ id: string; pageNumber: number }> = [];
    for (let i = existingPageCount; i < newTotalPages; i++) {
      const pageNumber = i + 1;
      const dims = allPageDimensions[i] || { width: 0, height: 0 };

      const newPage = await prisma.documentPage.create({
        data: {
          processingDocumentId: documentId,
          pageNumber,
          storageKey: document.storageKey, // Points to the PDF
          widthPx: dims.width,
          heightPx: dims.height,
          renderDpi: 72, // PDF points
          rotationDeg: 0,
          imageFingerprint: generateFingerprint(`${document.storageKey}:${pageNumber}`, 16),
        },
      });

      newPages.push({ id: newPage.id, pageNumber });
    }

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
      summary: `Appended ${pagesAdded} page(s) to document`,
      metadata: {
        action: 'APPEND_PAGES',
        pagesAdded,
        newTotalPages,
        fileNames: filesToAppend.map((f) => f.fileName),
      },
    });

    log.info(`Appended ${pagesAdded} pages to document ${documentId}`, {
      documentId,
      pagesAdded,
      newTotalPages,
    });

    return NextResponse.json({
      success: true,
      data: {
        documentId,
        pagesAdded,
        newPageCount: newTotalPages,
        newPages,
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    log.error('Failed to append pages', error);

    return handleApiError(error, 'append-pages');
  }
}
