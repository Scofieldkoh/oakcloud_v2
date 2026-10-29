/**
 * Split Document API
 *
 * Endpoint to split a multi-page document into separate documents based on page ranges.
 * Creates new ProcessingDocument records for each split and archives the original.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import crypto from 'crypto';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { storage, StorageKeys } from '@/lib/storage';
import { PDFDocument } from 'pdf-lib';
import { createAuditLog } from '@/lib/audit';
import { createLogger } from '@/lib/logger';

const log = createLogger('split-document');

interface SplitRange {
    pageFrom: number;
    pageTo: number;
    label?: string;
}

interface SplitRequest {
    ranges: SplitRange[];
}

interface RouteParams {
    params: Promise<{ documentId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const { documentId } = await params;
        const session = await requireAuth();

        const body: SplitRequest = await request.json();
        const { ranges } = body;

        if (!ranges || !Array.isArray(ranges) || ranges.length < 2) {
            return NextResponse.json(
                { error: { message: 'At least 2 split ranges are required' } },
                { status: 400 }
            );
        }

        // Fetch the source document with its Document relation
        const sourceDoc = await prisma.processingDocument.findFirst({
            where: {
                id: documentId,
                deletedAt: null,
            },
            include: {
                document: true,
            },
        });

        // Verify access
        if (!sourceDoc || sourceDoc.document.tenantId !== session.tenantId) {
            return NextResponse.json(
                { error: { message: 'Document not found' } },
                { status: 404 }
            );
        }

        // Verify document has pages
        const pageCount = sourceDoc.pageCount ?? 0;
        if (pageCount < 2) {
            return NextResponse.json(
                { error: { message: 'Document must have at least 2 pages to split' } },
                { status: 400 }
            );
        }

        // Validate ranges
        for (const range of ranges) {
            if (range.pageFrom < 1 || range.pageTo > pageCount || range.pageFrom > range.pageTo) {
                return NextResponse.json(
                    { error: { message: `Invalid range: ${range.pageFrom}-${range.pageTo}` } },
                    { status: 400 }
                );
            }
        }

        // Download the source PDF
        const pdfBytes = await storage.download(sourceDoc.document.storageKey);
        const sourcePdf = await PDFDocument.load(pdfBytes);

        const createdDocIds: string[] = [];
        const baseName = sourceDoc.document.fileName.replace(/\.pdf$/i, '');
        const tenantId = sourceDoc.document.tenantId;
        const companyId = sourceDoc.document.companyId;

        // Create new documents for each range
        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            const newPdf = await PDFDocument.create();

            // Copy pages (0-indexed)
            const pageIndices: number[] = [];
            for (let p = range.pageFrom - 1; p < range.pageTo; p++) {
                pageIndices.push(p);
            }

            const copiedPages = await newPdf.copyPages(sourcePdf, pageIndices);
            copiedPages.forEach((page) => newPdf.addPage(page));

            const newPdfBytes = await newPdf.save({ useObjectStreams: true });
            const label = range.label || `Part ${i + 1}`;
            const newFileName = `${baseName}_${label.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

            // Generate storage key
            const docId = crypto.randomUUID();
            const newStorageKey = StorageKeys.documentOriginal(tenantId, companyId ?? 'no-company', docId, '.pdf');

            // Upload to storage
            await storage.upload(newStorageKey, Buffer.from(newPdfBytes), {
                contentType: 'application/pdf',
            });

            // Create Document record
            const newDocument = await prisma.document.create({
                data: {
                    tenantId,
                    companyId,
                    documentType: sourceDoc.document.documentType,
                    uploadedById: session.id,
                    fileName: newFileName,
                    originalFileName: newFileName,
                    mimeType: 'application/pdf',
                    fileSize: newPdfBytes.length,
                    storageKey: newStorageKey,
                },
            });

            // Create ProcessingDocument record
            const newProcessingDoc = await prisma.processingDocument.create({
                data: {
                    documentId: newDocument.id,
                    tenantId,
                    parentProcessingDocId: sourceDoc.id,
                    pageFrom: range.pageFrom,
                    pageTo: range.pageTo,
                    pageCount: range.pageTo - range.pageFrom + 1,
                    pipelineStatus: 'QUEUED',
                    uploadSource: sourceDoc.uploadSource,
                },
            });

            createdDocIds.push(newProcessingDoc.id);
        }

        // Mark original as container and update status
        await prisma.processingDocument.update({
            where: { id: sourceDoc.id },
            data: {
                isContainer: true,
                pipelineStatus: 'SPLIT_DONE',
            },
        });

        // Create audit log
        await createAuditLog({
            tenantId,
            userId: session.id,
            action: 'EXTRACT',
            entityType: 'ProcessingDocument',
            entityId: sourceDoc.id,
            metadata: {
                action: 'SPLIT',
                splitCount: ranges.length,
                childDocumentIds: createdDocIds,
            },
        });

        return NextResponse.json({
            data: {
                success: true,
                originalDocumentId: sourceDoc.id,
                createdDocumentIds: createdDocIds,
                splitCount: createdDocIds.length,
            },
        });
    } catch (error) {
        log.error('Failed to split document', error);
        return handleApiError(error, 'split-document');
    }
}
