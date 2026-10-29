/**
 * Duplicate Comparison API
 *
 * GET /api/processing-documents/{documentId}/duplicate-of - Get duplicate document details for comparison
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ documentId: string }>;
}

/**
 * GET /api/processing-documents/{documentId}/duplicate-of
 * Returns the current document alongside its suspected duplicate for side-by-side comparison
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    // Get the current processing document with its duplicate info
    const processingDoc = await prisma.processingDocument.findUnique({
      where: { id: documentId },
      include: {
        document: {
          select: {
            companyId: true,
            tenantId: true,
            fileName: true,
            originalFileName: true,
          },
        },
        currentRevision: {
          select: {
            id: true,
            status: true,
            documentCategory: true,
            vendorName: true,
            documentNumber: true,
            documentDate: true,
            dueDate: true,
            currency: true,
            subtotal: true,
            taxAmount: true,
            totalAmount: true,
            gstTreatment: true,
            supplierGstNo: true,
            headerEvidenceJson: true,
          },
        },
        pages: {
          orderBy: { pageNumber: 'asc' },
          select: {
            pageNumber: true,
            storageKey: true,
            widthPx: true,
            heightPx: true,
          },
        },
      },
    });

    if (!processingDoc) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Processing document not found' },
        },
        { status: 404 }
      );
    }

    // Check access to the company
    const companyId = processingDoc.document?.companyId;
    if (!companyId || !(await canAccessCompany(session, companyId))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        },
        { status: 403 }
      );
    }

    // Check if document has a suspected duplicate
    if (!processingDoc.duplicateOfId || processingDoc.duplicateStatus !== 'SUSPECTED') {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'NO_DUPLICATE', message: 'No suspected duplicate for this document' },
        },
        { status: 404 }
      );
    }

    // Get the suspected duplicate document
    const duplicateDoc = await prisma.processingDocument.findUnique({
      where: { id: processingDoc.duplicateOfId },
      include: {
        document: {
          select: {
            fileName: true,
            originalFileName: true,
          },
        },
        currentRevision: {
          select: {
            id: true,
            status: true,
            documentCategory: true,
            vendorName: true,
            documentNumber: true,
            documentDate: true,
            dueDate: true,
            currency: true,
            subtotal: true,
            taxAmount: true,
            totalAmount: true,
            gstTreatment: true,
            supplierGstNo: true,
            headerEvidenceJson: true,
          },
        },
        pages: {
          orderBy: { pageNumber: 'asc' },
          select: {
            pageNumber: true,
            storageKey: true,
            widthPx: true,
            heightPx: true,
          },
        },
      },
    });

    // If the duplicate document doesn't exist or is soft-deleted, clear the duplicate status
    if (!duplicateDoc || duplicateDoc.deletedAt) {
      // Auto-clear the orphaned duplicate reference
      await prisma.processingDocument.update({
        where: { id: documentId },
        data: {
          duplicateStatus: 'NONE',
          duplicateOfId: null,
          duplicateScore: null,
          duplicateReason: null,
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DUPLICATE_CLEARED',
            message: 'Suspected duplicate document was deleted. Duplicate status has been cleared.',
          },
        },
        { status: 404 }
      );
    }

    // Compare fields and identify matches
    const fieldComparison = compareFields(
      processingDoc.currentRevision,
      duplicateDoc.currentRevision
    );

    return NextResponse.json({
      success: true,
      data: {
        currentDocument: {
          id: processingDoc.id,
          fileName: processingDoc.document?.fileName || processingDoc.document?.originalFileName,
          pipelineStatus: processingDoc.pipelineStatus,
          approvalStatus: processingDoc.currentRevision?.status || 'N/A',
          createdAt: processingDoc.createdAt,
          revision: processingDoc.currentRevision,
          pdfUrl: `/api/processing-documents/${processingDoc.id}/pdf`,
          pages: processingDoc.pages.map((p) => ({
            pageNumber: p.pageNumber,
            imageUrl: `/api/processing-documents/${processingDoc.id}/pages/${p.pageNumber}/image`,
            width: p.widthPx,
            height: p.heightPx,
          })),
        },
        duplicateDocument: {
          id: duplicateDoc.id,
          fileName: duplicateDoc.document?.fileName || duplicateDoc.document?.originalFileName,
          pipelineStatus: duplicateDoc.pipelineStatus,
          approvalStatus: duplicateDoc.currentRevision?.status || 'N/A',
          createdAt: duplicateDoc.createdAt,
          revision: duplicateDoc.currentRevision,
          pdfUrl: `/api/processing-documents/${duplicateDoc.id}/pdf`,
          pages: duplicateDoc.pages.map((p) => ({
            pageNumber: p.pageNumber,
            imageUrl: `/api/processing-documents/${duplicateDoc.id}/pages/${p.pageNumber}/image`,
            width: p.widthPx,
            height: p.heightPx,
          })),
        },
        comparison: {
          duplicateScore: processingDoc.duplicateScore,
          duplicateReason: processingDoc.duplicateReason,
          fieldComparison,
        },
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Duplicate comparison API error:', error);

    return handleApiError(error, 'duplicate-comparison');
  }
}

interface RevisionData {
  documentCategory: string | null;
  vendorName: string | null;
  documentNumber: string | null;
  documentDate: Date | null;
  totalAmount: { toString(): string };
  currency: string;
}

interface FieldMatch {
  field: string;
  currentValue: string | null;
  duplicateValue: string | null;
  isMatch: boolean;
}

/**
 * Compare fields between two revisions
 */
function compareFields(
  current: RevisionData | null,
  duplicate: RevisionData | null
): FieldMatch[] {
  if (!current || !duplicate) return [];

  const fields: FieldMatch[] = [
    {
      field: 'documentCategory',
      currentValue: current.documentCategory,
      duplicateValue: duplicate.documentCategory,
      isMatch: current.documentCategory === duplicate.documentCategory,
    },
    {
      field: 'vendorName',
      currentValue: current.vendorName,
      duplicateValue: duplicate.vendorName,
      isMatch: normalizeString(current.vendorName) === normalizeString(duplicate.vendorName),
    },
    {
      field: 'documentNumber',
      currentValue: current.documentNumber,
      duplicateValue: duplicate.documentNumber,
      isMatch: normalizeString(current.documentNumber) === normalizeString(duplicate.documentNumber),
    },
    {
      field: 'documentDate',
      currentValue: current.documentDate?.toISOString().split('T')[0] || null,
      duplicateValue: duplicate.documentDate?.toISOString().split('T')[0] || null,
      isMatch: current.documentDate?.getTime() === duplicate.documentDate?.getTime(),
    },
    {
      field: 'totalAmount',
      currentValue: current.totalAmount?.toString() || null,
      duplicateValue: duplicate.totalAmount?.toString() || null,
      isMatch: current.totalAmount?.toString() === duplicate.totalAmount?.toString(),
    },
    {
      field: 'currency',
      currentValue: current.currency,
      duplicateValue: duplicate.currency,
      isMatch: current.currency === duplicate.currency,
    },
  ];

  return fields;
}

/**
 * Normalize string for comparison
 */
function normalizeString(str: string | null): string | null {
  if (!str) return null;
  return str.toLowerCase().trim();
}
