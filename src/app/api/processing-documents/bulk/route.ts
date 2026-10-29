/**
 * Bulk Operations API
 *
 * POST /api/processing-documents/bulk - Execute bulk operations on documents
 */

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany, type SessionUser } from '@/lib/auth';
import { hasPermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { clearDuplicateReferencesToDocument } from '@/services/duplicate-detection.service';
import { resetProcessingRetryState } from '@/services/document-processing.service';
import { handleApiError } from '@/lib/api-error-handler';
import type { PipelineStatus } from '@/generated/prisma';

type BulkOperation = 'APPROVE' | 'TRIGGER_EXTRACTION' | 'DELETE';

interface BulkRequest {
  operation: BulkOperation;
  documentIds: string[];
}

interface BulkResult {
  documentId: string;
  success: boolean;
  error?: string;
}

const MAX_BULK_DOCUMENTS = 1000;

/**
 * Unlinked documents are base documents whose company was permanently deleted
 * (companyId was nulled). Only tenant-wide/all-companies users can see them in
 * the vault, so the same audience is allowed to clean them up.
 */
function canAccessUnlinkedDocument(
  session: SessionUser,
  tenantId: string | null | undefined
): boolean {
  if (session.isSuperAdmin) return true;
  if (!session.isWorkspaceAdmin && !session.hasAllCompaniesAccess) return false;
  return !!tenantId && session.tenantId === tenantId;
}

/**
 * POST /api/processing-documents/bulk
 * Execute bulk operations on multiple documents
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body: BulkRequest = await request.json();
    const { operation, documentIds } = body;

    if (!operation || !documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Operation and documentIds are required' },
        },
        { status: 400 }
      );
    }

    if (documentIds.length > MAX_BULK_DOCUMENTS) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Maximum ${MAX_BULK_DOCUMENTS} documents per bulk operation` },
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
            tenantId: true,
            companyId: true,
          },
        },
        currentRevision: true,
      },
    });

    // Check access to all documents
    const accessibleDocs: typeof documents = [];
    const accessDenied: string[] = [];

    for (const doc of documents) {
      const companyId = doc.document?.companyId;
      if (
        (companyId && (await canAccessCompany(session, companyId))) ||
        (!companyId && canAccessUnlinkedDocument(session, doc.document?.tenantId ?? doc.tenantId))
      ) {
        accessibleDocs.push(doc);
      } else {
        accessDenied.push(doc.id);
      }
    }

    const results: BulkResult[] = [];

    // Add access denied results
    for (const docId of accessDenied) {
      results.push({ documentId: docId, success: false, error: 'Permission denied' });
    }

    // Add not found results
    const foundIds = documents.map((d) => d.id);
    for (const docId of documentIds) {
      if (!foundIds.includes(docId)) {
        results.push({ documentId: docId, success: false, error: 'Document not found' });
      }
    }

    // Process accessible documents based on operation
    switch (operation) {
      case 'APPROVE':
        for (const doc of accessibleDocs) {
          try {
            // Check RBAC permission for document approval (requires update permission)
            const companyId = doc.document?.companyId;
            if (!companyId || !(await hasPermission(session.id, 'document', 'update', companyId))) {
              results.push({ documentId: doc.id, success: false, error: 'Permission denied: document:update' });
              continue;
            }

            // Check if document can be approved
            if (!doc.currentRevisionId || !doc.currentRevision) {
              results.push({ documentId: doc.id, success: false, error: 'No revision to approve' });
              continue;
            }

            if (doc.currentRevision.status !== 'DRAFT') {
              results.push({ documentId: doc.id, success: false, error: 'Revision is not in DRAFT status' });
              continue;
            }

            if (doc.duplicateStatus === 'SUSPECTED') {
              results.push({ documentId: doc.id, success: false, error: 'Must resolve duplicate status first' });
              continue;
            }

            // Approve the revision
            await prisma.$transaction([
              // Mark any previous approved revisions as superseded
              prisma.documentRevision.updateMany({
                where: {
                  processingDocumentId: doc.id,
                  status: 'APPROVED',
                },
                data: {
                  status: 'SUPERSEDED',
                  supersededAt: new Date(),
                },
              }),
              // Also supersede any other DRAFT revisions (not the one being approved)
              prisma.documentRevision.updateMany({
                where: {
                  processingDocumentId: doc.id,
                  status: 'DRAFT',
                  id: { not: doc.currentRevisionId },
                },
                data: {
                  status: 'SUPERSEDED',
                  supersededAt: new Date(),
                },
              }),
              // Approve the current revision
              prisma.documentRevision.update({
                where: { id: doc.currentRevisionId },
                data: {
                  status: 'APPROVED',
                  approvedAt: new Date(),
                  approvedById: session.id,
                },
              }),
              // Update document lock version
              prisma.processingDocument.update({
                where: { id: doc.id },
                data: { lockVersion: { increment: 1 } },
              }),
            ]);

            await createAuditLog({
              tenantId: doc.document!.tenantId,
              userId: session.id,
              companyId: doc.document!.companyId!,
              action: 'UPDATE',
              entityType: 'DocumentRevision',
              entityId: doc.currentRevisionId,
              entityName: `Revision #${doc.currentRevision.revisionNumber}`,
              summary: `Bulk approved revision (document ${doc.id})`,
              changeSource: 'MANUAL',
            });

            results.push({ documentId: doc.id, success: true });
          } catch (err) {
            results.push({
              documentId: doc.id,
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }
        break;

      case 'TRIGGER_EXTRACTION':
        for (const doc of accessibleDocs) {
          try {
            // Check RBAC permission for document update (re-extraction)
            const companyId = doc.document?.companyId;
            if (!companyId || !(await hasPermission(session.id, 'document', 'update', companyId))) {
              results.push({ documentId: doc.id, success: false, error: 'Permission denied: document:update' });
              continue;
            }

            // Check if document can be re-extracted
            const canRetrigger: PipelineStatus[] = ['UPLOADED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'DEAD_LETTER'];
            if (!canRetrigger.includes(doc.pipelineStatus)) {
              results.push({
                documentId: doc.id,
                success: false,
                error: `Cannot trigger extraction for status: ${doc.pipelineStatus}`,
              });
              continue;
            }

            await resetProcessingRetryState(doc.id);

            // Update status to QUEUED
            await prisma.processingDocument.update({
              where: { id: doc.id },
              data: {
                pipelineStatus: 'QUEUED',
                lastError: undefined,
              },
            });

            await createAuditLog({
              tenantId: doc.document!.tenantId,
              userId: session.id,
              companyId: doc.document!.companyId!,
              action: 'UPDATE',
              entityType: 'ProcessingDocument',
              entityId: doc.id,
              entityName: doc.id,
              summary: 'Bulk triggered extraction',
              changeSource: 'MANUAL',
            });

            results.push({ documentId: doc.id, success: true });
          } catch (err) {
            results.push({
              documentId: doc.id,
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }
        break;

      case 'DELETE':
        // Soft delete - sets deletedAt timestamp
        for (const doc of accessibleDocs) {
          try {
            // Check RBAC permission for document delete
            const companyId = doc.document?.companyId;
            if (
              companyId
                ? !(await hasPermission(session.id, 'document', 'delete', companyId))
                : !canAccessUnlinkedDocument(session, doc.document?.tenantId ?? doc.tenantId)
            ) {
              results.push({ documentId: doc.id, success: false, error: 'Permission denied: document:delete' });
              continue;
            }

            await prisma.processingDocument.update({
              where: { id: doc.id },
              data: { deletedAt: new Date() },
            });

            // Clear duplicate references pointing to this document
            await clearDuplicateReferencesToDocument(doc.id);

            await createAuditLog({
              tenantId: doc.document?.tenantId ?? doc.tenantId,
              userId: session.id,
              companyId: doc.document?.companyId ?? undefined,
              action: 'DELETE',
              entityType: 'ProcessingDocument',
              entityId: doc.id,
              entityName: doc.id,
              summary: 'Bulk soft-deleted document',
              changeSource: 'MANUAL',
            });

            results.push({ documentId: doc.id, success: true });
          } catch (err) {
            results.push({
              documentId: doc.id,
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }
        break;

      default:
        return NextResponse.json(
          {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: `Unknown operation: ${operation}` },
          },
          { status: 400 }
        );
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: true,
      data: {
        operation,
        results,
        summary: {
          total: documentIds.length,
          succeeded: successCount,
          failed: failureCount,
        },
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error, 'bulk-operations');
  }
}
