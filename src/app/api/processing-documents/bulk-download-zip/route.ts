/**
 * Bulk ZIP Download API
 *
 * POST /api/processing-documents/bulk-download-zip - Download multiple documents as a single ZIP file
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('bulk-download-zip');

interface BulkDownloadZipRequest {
  documentIds: string[];
}

const MAX_BULK_DOWNLOAD_DOCUMENTS = 1000;

/**
 * POST /api/processing-documents/bulk-download-zip
 * Download multiple documents as a single ZIP file
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body: BulkDownloadZipRequest = await request.json();
    const { documentIds } = body;

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'documentIds array is required' },
        },
        { status: 400 }
      );
    }

    if (documentIds.length > MAX_BULK_DOWNLOAD_DOCUMENTS) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Maximum ${MAX_BULK_DOWNLOAD_DOCUMENTS} documents per download request` },
        },
        { status: 400 }
      );
    }

    // Fetch all documents and verify access
    const documents = await prisma.processingDocument.findMany({
      where: { id: { in: documentIds } },
      include: {
        document: {
          select: {
            companyId: true,
            storageKey: true,
            fileName: true,
            originalFileName: true,
            mimeType: true,
            fileSize: true,
          },
        },
      },
    });

    // Filter accessible documents
    const accessibleDocs: typeof documents = [];
    const errors: { documentId: string; error: string }[] = [];

    for (const doc of documents) {
      const companyId = doc.document?.companyId;

      if (!companyId || !(await canAccessCompany(session, companyId))) {
        errors.push({ documentId: doc.id, error: 'Permission denied' });
        continue;
      }

      if (!doc.document?.storageKey) {
        errors.push({ documentId: doc.id, error: 'Storage key not found' });
        continue;
      }

      const fileExists = await storage.exists(doc.document.storageKey);
      if (!fileExists) {
        errors.push({ documentId: doc.id, error: 'File not found in storage' });
        continue;
      }

      accessibleDocs.push(doc);
    }

    // Check for documents not found
    const foundIds = documents.map((d) => d.id);
    for (const docId of documentIds) {
      if (!foundIds.includes(docId)) {
        errors.push({ documentId: docId, error: 'Document not found' });
      }
    }

    if (accessibleDocs.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'NO_FILES', message: 'No accessible files to download' },
          data: { errors },
        },
        { status: 400 }
      );
    }

    // Create ZIP archive
    const archive = archiver('zip', { zlib: { level: 5 } });
    const passthrough = new PassThrough();
    archive.pipe(passthrough);

    // Track filenames to handle duplicates
    const usedFilenames = new Map<string, number>();

    // Add files to archive
    for (const doc of accessibleDocs) {
      try {
        const fileBuffer = await storage.download(doc.document!.storageKey!);
        let fileName = doc.document!.fileName || doc.document!.originalFileName;

        // Handle duplicate filenames by appending index
        const count = usedFilenames.get(fileName) || 0;
        if (count > 0) {
          const ext = fileName.lastIndexOf('.');
          if (ext > 0) {
            fileName = `${fileName.substring(0, ext)} (${count})${fileName.substring(ext)}`;
          } else {
            fileName = `${fileName} (${count})`;
          }
        }
        usedFilenames.set(doc.document!.fileName || doc.document!.originalFileName, count + 1);

        archive.append(Buffer.from(fileBuffer), { name: fileName });
      } catch (err) {
        log.error(`Failed to add file ${doc.id} to ZIP:`, err);
        errors.push({ documentId: doc.id, error: 'Failed to read file' });
      }
    }

    // Finalize archive
    archive.finalize();

    // Generate filename with date
    const dateStr = new Date().toISOString().split('T')[0];
    const zipFileName = `documents-${dateStr}.zip`;

    // Convert PassThrough stream to ReadableStream for NextResponse
    const readableStream = new ReadableStream({
      start(controller) {
        passthrough.on('data', (chunk) => {
          controller.enqueue(chunk);
        });
        passthrough.on('end', () => {
          controller.close();
        });
        passthrough.on('error', (err) => {
          controller.error(err);
        });
      },
    });

    return new NextResponse(readableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFileName}"`,
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (error) {
    log.error('Bulk ZIP download API error:', error);

    return handleApiError(error, 'bulk-download-zip');
  }
}
