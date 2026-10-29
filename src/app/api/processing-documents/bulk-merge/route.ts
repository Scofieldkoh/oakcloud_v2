/**
 * Bulk Merge API
 *
 * Merges multiple processing documents into a single PDF document.
 * - Creates a new ProcessingDocument for the merged result with pipelineStatus: QUEUED (triggers extraction)
 * - Soft deletes the source documents after successful merge
 * - Clears duplicate references for deleted documents
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { storage, StorageKeys } from '@/lib/storage';
import { PDFDocument } from 'pdf-lib';
import { createAuditLog } from '@/lib/audit';
import { createLogger } from '@/lib/logger';
import { clearDuplicateReferencesToDocument } from '@/services/duplicate-detection.service';
import { extractFields } from '@/services/document-extraction.service';
import crypto from 'crypto';

const log = createLogger('bulk-merge');

interface BulkMergeRequest {
    documentIds: string[];
}

const MAX_BULK_MERGE_DOCUMENTS = 100;

export async function POST(request: NextRequest) {
    try {
        const session = await requireAuth();

        const body: BulkMergeRequest = await request.json();
        const { documentIds } = body;

        if (!documentIds || !Array.isArray(documentIds) || documentIds.length < 2) {
            return NextResponse.json(
                { error: { message: 'At least 2 document IDs are required for merging' } },
                { status: 400 }
            );
        }

        if (documentIds.length > MAX_BULK_MERGE_DOCUMENTS) {
            return NextResponse.json(
                { error: { message: `Maximum ${MAX_BULK_MERGE_DOCUMENTS} documents can be merged at once` } },
                { status: 400 }
            );
        }

        // Fetch all source documents with their Document records
        const sourceDocs = await prisma.processingDocument.findMany({
            where: {
                id: { in: documentIds },
                deletedAt: null,
            },
            include: {
                document: true,
            },
            orderBy: {
                createdAt: 'asc',
            },
        });

        // Determine which document IDs were not found
        const foundIds = new Set(sourceDocs.map((d) => d.id));
        const notFoundIds = documentIds.filter((id) => !foundIds.has(id));

        // Check access to each document using canAccessCompany (handles SUPER_ADMIN properly)
        const accessibleDocs: typeof sourceDocs = [];
        const accessDeniedIds: string[] = [];

        for (const doc of sourceDocs) {
            const companyId = doc.document.companyId;
            // canAccessCompany handles SUPER_ADMIN, tenant admin, and company-level access
            if (companyId && (await canAccessCompany(session, companyId))) {
                accessibleDocs.push(doc);
            } else if (!companyId) {
                // Documents without a company - check tenant access (SUPER_ADMIN can access all)
                if (session.isSuperAdmin || doc.document.tenantId === session.tenantId) {
                    accessibleDocs.push(doc);
                } else {
                    accessDeniedIds.push(doc.id);
                }
            } else {
                accessDeniedIds.push(doc.id);
            }
        }

        if (accessibleDocs.length !== documentIds.length) {
            const issues: string[] = [];
            if (notFoundIds.length > 0) {
                issues.push(`${notFoundIds.length} document(s) not found or deleted`);
                log.warn('Merge failed - documents not found', { notFoundIds });
            }
            if (accessDeniedIds.length > 0) {
                issues.push(`${accessDeniedIds.length} document(s) access denied`);
                log.warn('Merge failed - access denied', { accessDeniedIds });
            }
            return NextResponse.json(
                { error: { message: issues.join('; ') || 'One or more documents not found or access denied' } },
                { status: 404 }
            );
        }

        // Verify all documents belong to the same tenant and company
        const tenantIds = new Set(accessibleDocs.map((d) => d.document.tenantId));
        if (tenantIds.size > 1) {
            return NextResponse.json(
                { error: { message: 'All documents must belong to the same tenant' } },
                { status: 400 }
            );
        }

        const companyIds = new Set(accessibleDocs.map((d) => d.document.companyId));
        // Allow mixing null companyId with one specific companyId, but not multiple different companies
        const nonNullCompanyIds = [...companyIds].filter(Boolean);
        if (nonNullCompanyIds.length > 1) {
            return NextResponse.json(
                { error: { message: 'All documents must belong to the same company' } },
                { status: 400 }
            );
        }

        const tenantId = accessibleDocs[0].document.tenantId;
        // Use the first non-null companyId, or null if all are null
        const companyId = nonNullCompanyIds[0] || null;

        // Sort accessibleDocs to match the order of documentIds (preserve user's intended order)
        const docIdOrder = new Map(documentIds.map((id, index) => [id, index]));
        accessibleDocs.sort((a, b) => (docIdOrder.get(a.id) ?? 0) - (docIdOrder.get(b.id) ?? 0));

        // Create merged PDF
        const mergedPdf = await PDFDocument.create();
        let totalPageCount = 0;

        for (const doc of accessibleDocs) {
            const pdfBytes = await storage.download(doc.document.storageKey);
            const sourcePdf = await PDFDocument.load(pdfBytes);
            const pageIndices = sourcePdf.getPageIndices();
            const copiedPages = await mergedPdf.copyPages(sourcePdf, pageIndices);
            copiedPages.forEach((page) => mergedPdf.addPage(page));
            totalPageCount += pageIndices.length;
        }

        // Save merged PDF
        const mergedPdfBytes = await mergedPdf.save({ useObjectStreams: true });
        const mergedFileName = `Merged_${new Date().toISOString().split('T')[0]}_${accessibleDocs.length}docs.pdf`;

        // Generate storage key
        const docId = crypto.randomUUID();
        const mergedStorageKey = StorageKeys.documentOriginal(tenantId, companyId ?? 'no-company', docId, '.pdf');

        // Upload merged file
        await storage.upload(mergedStorageKey, Buffer.from(mergedPdfBytes), {
            contentType: 'application/pdf',
        });

        // Create Document record first
        const newDocument = await prisma.document.create({
            data: {
                tenantId,
                companyId,
                documentType: 'PROCESSING',
                uploadedById: session.id,
                fileName: mergedFileName,
                originalFileName: mergedFileName,
                mimeType: 'application/pdf',
                fileSize: mergedPdfBytes.length,
                storageKey: mergedStorageKey,
            },
        });

        // Create ProcessingDocument record
        const mergedProcessingDoc = await prisma.processingDocument.create({
            data: {
                documentId: newDocument.id,
                tenantId,
                isContainer: true,
                pageCount: totalPageCount,
                pipelineStatus: 'QUEUED',
                uploadSource: 'WEB',
            },
        });

        // Create audit log for merged document
        await createAuditLog({
            tenantId,
            userId: session.id,
            action: 'CREATE',
            entityType: 'ProcessingDocument',
            entityId: mergedProcessingDoc.id,
            metadata: {
                action: 'MERGE',
                sourceDocumentIds: documentIds,
                mergedPageCount: totalPageCount,
            },
        });

        // Soft delete source documents
        const now = new Date();
        for (const doc of accessibleDocs) {
            await prisma.processingDocument.update({
                where: { id: doc.id },
                data: { deletedAt: now },
            });

            // Clear duplicate references pointing to deleted documents
            await clearDuplicateReferencesToDocument(doc.id);

            // Create audit log for each soft-deleted document
            await createAuditLog({
                tenantId,
                userId: session.id,
                companyId: doc.document.companyId ?? undefined,
                action: 'DELETE',
                entityType: 'ProcessingDocument',
                entityId: doc.id,
                summary: `Soft-deleted after merge into ${mergedProcessingDoc.id}`,
                metadata: {
                    action: 'MERGE_SOURCE_DELETED',
                    mergedDocumentId: mergedProcessingDoc.id,
                },
            });
        }

        log.info(`Merged ${accessibleDocs.length} documents into ${mergedProcessingDoc.id}, source documents soft-deleted`);

        // Trigger extraction for the merged document (run asynchronously - don't wait for completion)
        // Only trigger if we have a valid companyId
        if (companyId) {
            extractFields(mergedProcessingDoc.id, tenantId, companyId, session.id)
                .then((result) => {
                    log.info(`Extraction completed for merged document ${mergedProcessingDoc.id}`, {
                        extractionId: result.extractionId,
                        revisionId: result.revisionId,
                    });
                })
                .catch((err) => {
                    log.error(`Extraction failed for merged document ${mergedProcessingDoc.id}`, err);
                });
        } else {
            log.warn(`Skipping extraction for merged document ${mergedProcessingDoc.id} - no company assigned`);
        }

        return NextResponse.json({
            data: {
                success: true,
                mergedDocumentId: mergedProcessingDoc.id,
                sourceDocumentIds: documentIds,
                pageCount: totalPageCount,
                sourceDocumentsDeleted: true,
            },
        });
    } catch (error) {
        log.error('Failed to merge documents', error);
        return handleApiError(error, 'bulk-merge');
    }
}
