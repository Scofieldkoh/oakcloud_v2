/**
 * Processing Document View API
 *
 * GET /api/processing-documents/:documentId/view - Get consolidated document view data
 *
 * This endpoint returns all data needed for the initial document view in a single request:
 * - Document metadata
 * - Current revision with line items
 * - Page metadata (for PDF viewer)
 * - Document tags
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

type Params = { documentId: string };

/**
 * GET /api/processing-documents/:documentId/view
 * Get consolidated document view data for initial page load
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    // Single query to get document with all related data
    const processingDoc = await prisma.processingDocument.findUnique({
      where: { id: documentId },
      include: {
        document: {
          select: {
            companyId: true,
            tenantId: true,
            fileName: true,
            originalFileName: true,
            mimeType: true,
            fileSize: true,
            storageKey: true,
            company: {
              select: {
                id: true,
                name: true,
                homeCurrency: true,
              },
            },
          },
        },
        pages: {
          orderBy: { pageNumber: 'asc' },
          select: {
            id: true,
            pageNumber: true,
            widthPx: true,
            heightPx: true,
            rotationDeg: true,
            renderDpi: true,
          },
        },
        // Tags removed - will be loaded lazily via separate endpoint
      },
    });

    if (!processingDoc) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Document not found' },
        },
        { status: 404 }
      );
    }

    const document = processingDoc.document;

    if (!document || !document.companyId || !document.tenantId) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Base document not found' },
        },
        { status: 404 }
      );
    }

    // Check permission
    await requirePermission(session, 'document', 'read', document.companyId);

    if (!(await canAccessCompany(session, document.companyId))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        },
        { status: 403 }
      );
    }

    const resolvedProcessingDoc = processingDoc;

    // Get current revision with line items
    // First check currentRevisionId, then fall back to latest revision
    let currentRevision = null;
    const revisionId = resolvedProcessingDoc.currentRevisionId;

    if (revisionId) {
      currentRevision = await prisma.documentRevision.findUnique({
        where: { id: revisionId },
        include: {
          items: {
            orderBy: { lineNo: 'asc' },
          },
        },
      });
    }

    // If no approved revision, get the latest draft revision
    if (!currentRevision) {
      currentRevision = await prisma.documentRevision.findFirst({
        where: { processingDocumentId: documentId },
        orderBy: { revisionNumber: 'desc' },
        include: {
          items: {
            orderBy: { lineNo: 'asc' },
          },
        },
      });
    }

    // Detect if this is a PDF file
    const isPdf =
      document.mimeType === 'application/pdf' ||
      document.originalFileName?.toLowerCase().endsWith('.pdf') ||
      document.storageKey?.toLowerCase().endsWith('.pdf');

    // Transform pages
    const pages = resolvedProcessingDoc.pages.map((page) => ({
      id: page.id,
      pageNumber: page.pageNumber,
      width: page.widthPx,
      height: page.heightPx,
      rotation: page.rotationDeg,
      dpi: page.renderDpi,
      imageUrl: `/api/processing-documents/${documentId}/pages/${page.pageNumber}/image`,
    }));



    return NextResponse.json({
      success: true,
      data: {
        document: {
          id: resolvedProcessingDoc.id,
          documentId: resolvedProcessingDoc.documentId,
          isContainer: resolvedProcessingDoc.isContainer,
          parentDocumentId: resolvedProcessingDoc.parentProcessingDocId,
          pageFrom: resolvedProcessingDoc.pageFrom,
          pageTo: resolvedProcessingDoc.pageTo,
          pageCount: resolvedProcessingDoc.pageCount,
          pipelineStatus: resolvedProcessingDoc.pipelineStatus,
          duplicateStatus: resolvedProcessingDoc.duplicateStatus,
          currentRevisionId: resolvedProcessingDoc.currentRevisionId,
          lockVersion: resolvedProcessingDoc.lockVersion,
          createdAt: resolvedProcessingDoc.createdAt.toISOString(),
          pages: pages.length,
          // Versioning
          version: resolvedProcessingDoc.version,
          rootDocumentId: resolvedProcessingDoc.rootDocumentId,
          // File details (prefer renamed fileName after approval, fallback to original)
          fileName: document.fileName || document.originalFileName,
          mimeType: document.mimeType,
          fileSize: document.fileSize,
          // Tenant info
          tenantId: document.tenantId,
          // Company info
          company: document.company,
        },
        currentRevision: currentRevision
          ? {
            id: currentRevision.id,
            revisionNumber: currentRevision.revisionNumber,
            status: currentRevision.status,
            documentCategory: currentRevision.documentCategory,
            documentSubCategory: currentRevision.documentSubCategory,
            vendorName: currentRevision.vendorName,
            documentNumber: currentRevision.documentNumber,
            documentDate: currentRevision.documentDate?.toISOString().split('T')[0] || null,
            dueDate: currentRevision.dueDate?.toISOString().split('T')[0] || null,
            currency: currentRevision.currency,
            subtotal: currentRevision.subtotal?.toString() || null,
            taxAmount: currentRevision.taxAmount?.toString() || null,
            totalAmount: currentRevision.totalAmount.toString(),
            gstTreatment: currentRevision.gstTreatment,
            supplierGstNo: currentRevision.supplierGstNo,
            validationStatus: currentRevision.validationStatus,
            validationIssues: currentRevision.validationIssues,
            headerEvidenceJson: currentRevision.headerEvidenceJson,
            // Home currency fields
            homeCurrency: currentRevision.homeCurrency,
            homeExchangeRate: currentRevision.homeExchangeRate?.toString() || null,
            homeExchangeRateSource: currentRevision.homeExchangeRateSource,
            exchangeRateDate: currentRevision.exchangeRateDate?.toISOString().split('T')[0] || null,
            homeSubtotal: currentRevision.homeSubtotal?.toString() || null,
            homeTaxAmount: currentRevision.homeTaxAmount?.toString() || null,
            homeEquivalent: currentRevision.homeEquivalent?.toString() || null,
            isHomeExchangeRateOverride: currentRevision.isHomeExchangeRateOverride ?? false,
            lineItems: currentRevision.items.map((item) => ({
              id: item.id,
              lineNo: item.lineNo,
              description: item.description,
              quantity: item.quantity?.toString() || null,
              unitPrice: item.unitPrice?.toString() || null,
              amount: item.amount.toString(),
              gstAmount: item.gstAmount?.toString() || null,
              taxCode: item.taxCode,
              accountCode: item.accountCode,
              evidenceJson: item.evidenceJson,
              // Home currency line item fields
              homeAmount: item.homeAmount?.toString() || null,
              homeGstAmount: item.homeGstAmount?.toString() || null,
              isHomeAmountOverride: item.isHomeAmountOverride ?? false,
              isHomeGstOverride: item.isHomeGstOverride ?? false,
            })),
          }
          : null,
        pages: {
          documentId,
          pageCount: pages.length,
          pages,
          isPdf: isPdf || false,
          // Include lockVersion in URL for cache busting after page modifications
          pdfUrl: isPdf ? `/api/processing-documents/${documentId}/pdf?v=${resolvedProcessingDoc.lockVersion}` : null,
        },
        // Tags removed - will be loaded lazily via separate endpoint
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error, 'processing-document-view');
  }
}
