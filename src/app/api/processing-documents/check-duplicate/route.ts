/**
 * Duplicate Check API
 *
 * Quick endpoint to check if a file hash already exists in the system.
 * Used for real-time duplicate detection during upload.
 */

import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleApiError, ApiError, ErrorCodes, createSuccessResponse } from '@/lib/api-error-handler';

interface CheckDuplicateRequest {
    fileHashes: string[];
    companyId: string;
}

interface DuplicateMatch {
    hash: string;
    documentId: string;
    fileName: string;
    uploadedAt: string;
}

export async function POST(request: NextRequest) {
    try {
        const session = await getSession();
        if (!session) {
            throw new ApiError(ErrorCodes.AUTHENTICATION_REQUIRED, 'Unauthorized', 401);
        }

        const body: CheckDuplicateRequest = await request.json();
        const { fileHashes, companyId } = body;

        if (!fileHashes || !Array.isArray(fileHashes) || fileHashes.length === 0) {
            throw new ApiError(ErrorCodes.VALIDATION_ERROR, 'fileHashes array is required', 400);
        }

        if (!companyId) {
            throw new ApiError(ErrorCodes.VALIDATION_ERROR, 'companyId is required', 400);
        }

        // Verify user has access to this company
        const company = await prisma.company.findFirst({
            where: {
                id: companyId,
                tenantId: session.tenantId ?? undefined,
            },
            select: { id: true, tenantId: true },
        });

        if (!company) {
            throw new ApiError(ErrorCodes.NOT_FOUND, 'Company not found or access denied', 404);
        }

        // Find existing documents with matching hashes (query through document relation for tenant filtering)
        const existingDocs = await prisma.processingDocument.findMany({
            where: {
                document: {
                    tenantId: company.tenantId,
                },
                fileHash: { in: fileHashes },
                deletedAt: null,
            },
            include: {
                document: {
                    select: {
                        fileName: true,
                    },
                },
            },
        });

        // Build response with matches - filter out null hashes
        const duplicates: DuplicateMatch[] = existingDocs
            .filter((doc) => doc.fileHash !== null)
            .map((doc) => ({
                hash: doc.fileHash!,
                documentId: doc.id,
                fileName: doc.document.fileName,
                uploadedAt: doc.createdAt.toISOString(),
            }));

        // Create a set of duplicate hashes for quick lookup
        const duplicateHashes = new Set(duplicates.map((d) => d.hash));

        return createSuccessResponse({
            duplicates,
            duplicateHashes: Array.from(duplicateHashes),
            checkedCount: fileHashes.length,
            duplicateCount: duplicates.length,
        });
    } catch (error) {
        return handleApiError(error, 'check-duplicate');
    }
}
