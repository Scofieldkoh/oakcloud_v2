/**
 * Bulk Download API
 *
 * POST /api/processing-documents/bulk-download - Get download info for multiple documents
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';

interface BulkDownloadRequest {
  documentIds: string[];
}

interface DownloadInfo {
  documentId: string;
  fileName: string;
  downloadUrl: string;
  mimeType: string;
  fileSize: number;
}

const MAX_BULK_DOWNLOAD_DOCUMENTS = 1000;

/**
 * POST /api/processing-documents/bulk-download
 * Get download URLs for multiple documents
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body: BulkDownloadRequest = await request.json();
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

    const downloadInfos: DownloadInfo[] = [];
    const errors: { documentId: string; error: string }[] = [];

    for (const doc of documents) {
      const companyId = doc.document?.companyId;

      // Check access
      if (!companyId || !(await canAccessCompany(session, companyId))) {
        errors.push({ documentId: doc.id, error: 'Permission denied' });
        continue;
      }

      // Check if file exists in storage
      if (!doc.document?.storageKey) {
        errors.push({ documentId: doc.id, error: 'Storage key not found' });
        continue;
      }

      const fileExists = await storage.exists(doc.document.storageKey);
      if (!fileExists) {
        errors.push({ documentId: doc.id, error: 'File not found in storage' });
        continue;
      }

      downloadInfos.push({
        documentId: doc.id,
        fileName: doc.document.fileName || doc.document.originalFileName,
        downloadUrl: `/api/processing-documents/${doc.id}/download`,
        mimeType: doc.document.mimeType || 'application/octet-stream',
        fileSize: doc.document.fileSize || 0,
      });
    }

    // Check for documents not found
    const foundIds = documents.map((d) => d.id);
    for (const docId of documentIds) {
      if (!foundIds.includes(docId)) {
        errors.push({ documentId: docId, error: 'Document not found' });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        downloads: downloadInfos,
        errors,
        summary: {
          total: documentIds.length,
          available: downloadInfos.length,
          failed: errors.length,
        },
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Bulk download API error:', error);

    return handleApiError(error, 'bulk-download');
  }
}
