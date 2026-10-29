/**
 * Resolve Counterparty Alias API
 *
 * POST /api/processing-documents/:documentId/revisions/:revisionId/resolve-alias
 *
 * Looks up an existing alias/contact match for the provided counterparty name
 * and returns the canonical contact name/id. Does NOT create new aliases.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { getProcessingDocument } from '@/services/document-processing.service';
import { getRevision } from '@/services/document-revision.service';
import { resolveVendor } from '@/services/vendor-resolution.service';
import { resolveCustomer } from '@/services/customer-resolution.service';

type Params = { documentId: string; revisionId: string };

export async function POST(request: NextRequest, { params }: { params: Promise<Params> }) {
  try {
    const session = await requireAuth();
    const { documentId, revisionId } = await params;

    const processingDoc = await getProcessingDocument(documentId);
    if (!processingDoc) {
      return NextResponse.json(
        { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Document not found' } },
        { status: 404 }
      );
    }

    const document = await prisma.document.findUnique({
      where: { id: processingDoc.documentId },
      select: { companyId: true, tenantId: true },
    });

    if (!document?.companyId || !document.tenantId) {
      return NextResponse.json(
        { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Base document not found' } },
        { status: 404 }
      );
    }

    await requirePermission(session, 'document', 'update', document.companyId);

    if (!(await canAccessCompany(session, document.companyId))) {
      return NextResponse.json(
        { success: false, error: { code: 'PERMISSION_DENIED', message: 'Forbidden' } },
        { status: 403 }
      );
    }

    const revision = await getRevision(revisionId);
    if (!revision || revision.processingDocumentId !== documentId) {
      return NextResponse.json(
        { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Revision not found' } },
        { status: 404 }
      );
    }

    let body: { rawName?: string } = {};
    try {
      body = await request.json();
    } catch {
      // empty
    }

    const rawName = body.rawName?.trim();
    if (!rawName) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'rawName is required' } },
        { status: 400 }
      );
    }

    const isReceivable = revision.documentCategory === 'ACCOUNTS_RECEIVABLE';

    if (isReceivable) {
      const resolved = await resolveCustomer({
        tenantId: document.tenantId,
        companyId: document.companyId,
        rawCustomerName: rawName,
        createdById: session.id,
      });

      if (!resolved.customerId || resolved.strategy === 'NONE') {
        return NextResponse.json({ success: true, data: { matched: false } });
      }

      return NextResponse.json({
        success: true,
        data: {
          matched: true,
          type: 'CUSTOMER',
          canonicalName: resolved.customerName,
          contactId: resolved.customerId,
          strategy: resolved.strategy,
          confidence: resolved.confidence,
        },
      });
    }

    const resolved = await resolveVendor({
      tenantId: document.tenantId,
      companyId: document.companyId,
      rawVendorName: rawName,
      createdById: session.id,
    });

    if (!resolved.vendorId || resolved.strategy === 'NONE') {
      return NextResponse.json({ success: true, data: { matched: false } });
    }

    return NextResponse.json({
      success: true,
      data: {
        matched: true,
        type: 'VENDOR',
        canonicalName: resolved.vendorName,
        contactId: resolved.vendorId,
        strategy: resolved.strategy,
        confidence: resolved.confidence,
      },
    });
  } catch (error) {
    console.error('Resolve alias API error:', error);
    return handleApiError(error, 'resolve-alias');
  }
}

