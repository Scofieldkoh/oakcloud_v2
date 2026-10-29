/**
 * Single Revision API
 *
 * GET /api/processing-documents/:documentId/revisions/:revisionId - Get revision with line items
 * PATCH /api/processing-documents/:documentId/revisions/:revisionId - Update revision (draft only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { getProcessingDocument } from '@/services/document-processing.service';
import {
  CounterpartyIdentityValidationError,
  parseReviewerCounterpartyIdentity,
  validateRevision,
  type CounterpartyIdentityDraft,
} from '@/services/document-revision.service';
import { createAuditLog } from '@/lib/audit';

type Params = { documentId: string; revisionId: string };

/**
 * GET /api/processing-documents/:documentId/revisions/:revisionId
 * Get a single revision with its line items
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireAuth();
    const { documentId, revisionId } = await params;

    // Check if validation should be re-run (e.g., on page refresh)
    const { searchParams } = new URL(request.url);
    const revalidate = searchParams.get('revalidate') === 'true';

    const processingDoc = await getProcessingDocument(documentId);

    if (!processingDoc) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Document not found' },
        },
        { status: 404 }
      );
    }

    // Get the base document for company context
    const document = await prisma.document.findUnique({
      where: { id: processingDoc.documentId },
      select: { companyId: true },
    });

    if (!document || !document.companyId) {
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

    // Get the revision with line items
    const revision = await prisma.documentRevision.findUnique({
      where: { id: revisionId, processingDocumentId: documentId },
      include: {
        items: {
          orderBy: { lineNo: 'asc' },
        },
      },
    });

    if (!revision) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Revision not found' },
        },
        { status: 404 }
      );
    }

    // Re-run validation if requested (e.g., on page refresh)
    let validationStatus = revision.validationStatus;
    let validationIssues: unknown = revision.validationIssues;
    if (revalidate) {
      const validationResult = await validateRevision(revisionId);
      validationStatus = validationResult.status;
      validationIssues = { issues: validationResult.issues };
    }

    return NextResponse.json({
      success: true,
      data: {
        id: revision.id,
        revisionNumber: revision.revisionNumber,
        status: revision.status,
        documentCategory: revision.documentCategory,
        documentSubCategory: revision.documentSubCategory,
        vendorName: revision.vendorName,
        counterpartyIdentity: revision.counterpartyIdentity,
        documentNumber: revision.documentNumber,
        documentDate: revision.documentDate?.toISOString().split('T')[0] || null,
        dueDate: revision.dueDate?.toISOString().split('T')[0] || null,
        currency: revision.currency,
        subtotal: revision.subtotal?.toString() || null,
        taxAmount: revision.taxAmount?.toString() || null,
        totalAmount: revision.totalAmount.toString(),
        gstTreatment: revision.gstTreatment,
        supplierGstNo: revision.supplierGstNo,
        validationStatus: validationStatus,
        validationIssues: validationIssues,
        headerEvidenceJson: revision.headerEvidenceJson,
        // Phase 2: Home currency fields
        homeCurrency: revision.homeCurrency,
        homeExchangeRate: revision.homeExchangeRate?.toString() || null,
        homeExchangeRateSource: revision.homeExchangeRateSource,
        exchangeRateDate: revision.exchangeRateDate?.toISOString().split('T')[0] || null,
        homeSubtotal: revision.homeSubtotal?.toString() || null,
        homeTaxAmount: revision.homeTaxAmount?.toString() || null,
        homeEquivalent: revision.homeEquivalent?.toString() || null,
        isHomeExchangeRateOverride: revision.isHomeExchangeRateOverride ?? false,
        lineItems: revision.items.map((item) => ({
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
          // Phase 2: Home currency line item fields
          homeAmount: item.homeAmount?.toString() || null,
          homeGstAmount: item.homeGstAmount?.toString() || null,
          isHomeAmountOverride: item.isHomeAmountOverride ?? false,
          isHomeGstOverride: item.isHomeGstOverride ?? false,
        })),
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * PATCH /api/processing-documents/:documentId/revisions/:revisionId
 * Update a draft revision
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const session = await requireAuth();
    const { documentId, revisionId } = await params;
    const ifMatch = request.headers.get('If-Match');

    const processingDoc = await getProcessingDocument(documentId);

    if (!processingDoc) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Document not found' },
        },
        { status: 404 }
      );
    }

    // Get the base document for company context
    const document = await prisma.document.findUnique({
      where: { id: processingDoc.documentId },
      select: { companyId: true, tenantId: true },
    });

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
    await requirePermission(session, 'document', 'update', document.companyId);

    if (!(await canAccessCompany(session, document.companyId))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'Forbidden' },
        },
        { status: 403 }
      );
    }

    // Check lock version (optimistic concurrency)
    if (ifMatch) {
      const expectedVersion = parseInt(ifMatch, 10);
      if (processingDoc.lockVersion !== expectedVersion) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'CONCURRENT_MODIFICATION',
              message: 'Document has been modified by another user',
            },
          },
          { status: 409 }
        );
      }
    }

    // Get the revision - can only edit DRAFT revisions
    const revision = await prisma.documentRevision.findUnique({
      where: { id: revisionId, processingDocumentId: documentId },
    });

    if (!revision) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Revision not found' },
        },
        { status: 404 }
      );
    }

    if (revision.status !== 'DRAFT') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_STATE',
            message: 'Only draft revisions can be edited',
          },
        },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { headerUpdates, itemsToUpsert, itemsToDelete } = body as {
      headerUpdates?: {
        vendorName?: string;
        counterpartyIdentity?: CounterpartyIdentityDraft;
        documentNumber?: string;
        documentDate?: string;
        dueDate?: string;
        currency?: string;
        subtotal?: string;
        taxAmount?: string;
        totalAmount?: string;
        gstTreatment?: string;
        supplierGstNo?: string;
        documentCategory?: string;
        documentSubCategory?: string | null;
        // Phase 2: Home currency header fields
        homeCurrency?: string;
        homeExchangeRate?: string;
        homeExchangeRateSource?: string;
        exchangeRateDate?: string;
        homeSubtotal?: string;
        homeTaxAmount?: string;
        homeEquivalent?: string;
        isHomeExchangeRateOverride?: boolean;
      };
      itemsToUpsert?: Array<{
        id?: string;
        lineNo: number;
        description: string;
        quantity?: string;
        unitPrice?: string;
        amount: string;
        gstAmount?: string;
        taxCode?: string;
        accountCode?: string;
        // Phase 2: Home currency line item fields
        homeAmount?: string;
        homeGstAmount?: string;
        isHomeAmountOverride?: boolean;
        isHomeGstOverride?: boolean;
      }>;
      itemsToDelete?: string[];
    };

    // Build header update data
    const headerData: Record<string, unknown> = {};
    if (headerUpdates) {
      if (headerUpdates.vendorName !== undefined) headerData.vendorName = headerUpdates.vendorName;
      if (headerUpdates.counterpartyIdentity !== undefined) {
        headerData.counterpartyIdentity = parseReviewerCounterpartyIdentity(headerUpdates.counterpartyIdentity);
      }
      if (headerUpdates.documentNumber !== undefined) headerData.documentNumber = headerUpdates.documentNumber;
      if (headerUpdates.documentDate !== undefined) headerData.documentDate = headerUpdates.documentDate ? new Date(headerUpdates.documentDate) : null;
      if (headerUpdates.dueDate !== undefined) headerData.dueDate = headerUpdates.dueDate ? new Date(headerUpdates.dueDate) : null;
      if (headerUpdates.currency !== undefined) headerData.currency = headerUpdates.currency;
      if (headerUpdates.subtotal !== undefined) headerData.subtotal = headerUpdates.subtotal ? parseFloat(headerUpdates.subtotal) : null;
      if (headerUpdates.taxAmount !== undefined) headerData.taxAmount = headerUpdates.taxAmount ? parseFloat(headerUpdates.taxAmount) : null;
      if (headerUpdates.totalAmount !== undefined) headerData.totalAmount = parseFloat(headerUpdates.totalAmount);
      if (headerUpdates.gstTreatment !== undefined) headerData.gstTreatment = headerUpdates.gstTreatment || null;
      if (headerUpdates.supplierGstNo !== undefined) headerData.supplierGstNo = headerUpdates.supplierGstNo || null;
      if (headerUpdates.documentCategory !== undefined) headerData.documentCategory = headerUpdates.documentCategory;
      if (headerUpdates.documentSubCategory !== undefined) headerData.documentSubCategory = headerUpdates.documentSubCategory;
      // Phase 2: Home currency header fields
      if (headerUpdates.homeCurrency !== undefined) headerData.homeCurrency = headerUpdates.homeCurrency || null;
      if (headerUpdates.homeExchangeRate !== undefined) headerData.homeExchangeRate = headerUpdates.homeExchangeRate ? parseFloat(headerUpdates.homeExchangeRate) : null;
      if (headerUpdates.homeExchangeRateSource !== undefined) headerData.homeExchangeRateSource = headerUpdates.homeExchangeRateSource || null;
      if (headerUpdates.exchangeRateDate !== undefined) headerData.exchangeRateDate = headerUpdates.exchangeRateDate ? new Date(headerUpdates.exchangeRateDate) : null;
      if (headerUpdates.homeSubtotal !== undefined) headerData.homeSubtotal = headerUpdates.homeSubtotal ? parseFloat(headerUpdates.homeSubtotal) : null;
      if (headerUpdates.homeTaxAmount !== undefined) headerData.homeTaxAmount = headerUpdates.homeTaxAmount ? parseFloat(headerUpdates.homeTaxAmount) : null;
      if (headerUpdates.homeEquivalent !== undefined) headerData.homeEquivalent = headerUpdates.homeEquivalent ? parseFloat(headerUpdates.homeEquivalent) : null;
      if (headerUpdates.isHomeExchangeRateOverride !== undefined) headerData.isHomeExchangeRateOverride = headerUpdates.isHomeExchangeRateOverride;
    }

    // Start a transaction
    await prisma.$transaction(async (tx) => {
      // Update header fields
      if (Object.keys(headerData).length > 0) {
        await tx.documentRevision.update({
          where: { id: revisionId },
          data: headerData,
        });
      }

      // Delete items
      if (itemsToDelete && itemsToDelete.length > 0) {
        await tx.documentRevisionLineItem.deleteMany({
          where: {
            id: { in: itemsToDelete },
            revisionId,
          },
        });
      }

      // Upsert items
      if (itemsToUpsert && itemsToUpsert.length > 0) {
        for (const item of itemsToUpsert) {
          const itemData = {
            description: item.description,
            quantity: item.quantity ? parseFloat(item.quantity) : null,
            unitPrice: item.unitPrice ? parseFloat(item.unitPrice) : null,
            amount: parseFloat(item.amount),
            gstAmount: item.gstAmount ? parseFloat(item.gstAmount) : null,
            taxCode: item.taxCode || null,
            accountCode: item.accountCode || null,
            // Phase 2: Home currency line item fields
            homeAmount: item.homeAmount ? parseFloat(item.homeAmount) : null,
            homeGstAmount: item.homeGstAmount ? parseFloat(item.homeGstAmount) : null,
            isHomeAmountOverride: item.isHomeAmountOverride ?? false,
            isHomeGstOverride: item.isHomeGstOverride ?? false,
          };

          if (item.id) {
            // Update existing item by id
            await tx.documentRevisionLineItem.update({
              where: { id: item.id },
              data: {
                lineNo: item.lineNo,
                ...itemData,
              },
            });
          } else {
            // Create or update by revisionId + lineNo composite key
            // This handles the case where lineNo already exists
            await tx.documentRevisionLineItem.upsert({
              where: {
                revisionId_lineNo: {
                  revisionId,
                  lineNo: item.lineNo,
                },
              },
              update: itemData,
              create: {
                revisionId,
                lineNo: item.lineNo,
                ...itemData,
              },
            });
          }
        }
      }

      // Increment lock version
      await tx.processingDocument.update({
        where: { id: documentId },
        data: { lockVersion: { increment: 1 } },
      });
    });

    // Get updated lock version
    const updatedDoc = await getProcessingDocument(documentId);

    // Re-run validation after update
    const validationResult = await validateRevision(revisionId);

    // Create audit log
    await createAuditLog({
      tenantId: document.tenantId,
      userId: session.id,
      companyId: document.companyId,
      action: 'UPDATE',
      entityType: 'DocumentRevision',
      entityId: revisionId,
      summary: `Updated draft revision #${revision.revisionNumber}`,
      changeSource: 'MANUAL',
      metadata: {
        revisionNumber: revision.revisionNumber,
        headerUpdates: headerUpdates ? Object.keys(headerUpdates) : [],
        itemsUpserted: itemsToUpsert?.length || 0,
        itemsDeleted: itemsToDelete?.length || 0,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        revisionId,
        lockVersion: updatedDoc?.lockVersion ?? processingDoc.lockVersion + 1,
        validationStatus: validationResult.status,
        validationIssues: validationResult.issues,
      },
      meta: {
        requestId: uuidv4(),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown): NextResponse {
  if (error instanceof CounterpartyIdentityValidationError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Counterparty identity contains invalid fields',
          issues: error.issues,
        },
      },
      { status: 400 },
    );
  }

  return handleApiError(error, 'document-revision');
}
