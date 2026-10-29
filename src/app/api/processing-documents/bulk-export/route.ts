/**
 * Bulk Excel Export API
 *
 * POST /api/processing-documents/bulk-export - Export multiple documents to Excel
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import ExcelJS from 'exceljs';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { CATEGORY_LABELS, SUBCATEGORY_LABELS } from '@/lib/document-categories';
import { getAccountsForSelect } from '@/services/chart-of-accounts.service';

const log = createLogger('bulk-export');

interface BulkExportRequest {
  documentIds: string[];
}

const MAX_BULK_EXPORT_DOCUMENTS = 1000;

// Status label mappings
const PIPELINE_STATUS_LABELS: Record<string, string> = {
  UPLOADED: 'Uploaded',
  QUEUED: 'Queued',
  PROCESSING: 'Processing',
  SPLIT_PENDING: 'Split Pending',
  SPLIT_DONE: 'Split Done',
  EXTRACTION_DONE: 'Extracted',
  FAILED_RETRYABLE: 'Failed (Retry)',
  FAILED_PERMANENT: 'Failed',
  DEAD_LETTER: 'Dead Letter',
};

const DUPLICATE_STATUS_LABELS: Record<string, string> = {
  NONE: 'Not Checked',
  SUSPECTED: 'Suspected Duplicate',
  CONFIRMED: 'Confirmed Duplicate',
  REJECTED: 'Not Duplicate',
};

const REVISION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  SUPERSEDED: 'Superseded',
};

function formatDate(date: Date | null): string {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDecimal(value: unknown): number | string {
  if (value === null || value === undefined) return '';
  const num = typeof value === 'object' && 'toNumber' in value
    ? (value as { toNumber(): number }).toNumber()
    : Number(value);
  return isNaN(num) ? '' : num;
}

type AccountNameLookup = Record<string, string>;

async function buildAccountNameLookup(
  tenantId: string | null,
  companyId: string | null | undefined
): Promise<AccountNameLookup> {
  const accounts = await getAccountsForSelect(tenantId, companyId ?? null, undefined, true);
  return Object.fromEntries(accounts.map((account) => [account.code, account.name]));
}

/**
 * POST /api/processing-documents/bulk-export
 * Export multiple documents to Excel with headers and line items
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body: BulkExportRequest = await request.json();
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

    if (documentIds.length > MAX_BULK_EXPORT_DOCUMENTS) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Maximum ${MAX_BULK_EXPORT_DOCUMENTS} documents per export request` },
        },
        { status: 400 }
      );
    }

    // Fetch all documents with their current revisions and line items
    const documents = await prisma.processingDocument.findMany({
      where: { id: { in: documentIds } },
      include: {
        document: {
          select: {
            companyId: true,
            fileName: true,
            originalFileName: true,
            createdAt: true,
            company: {
              select: {
                tenantId: true,
              },
            },
          },
        },
        currentRevision: {
          include: {
            items: {
              orderBy: { lineNo: 'asc' },
            },
          },
        },
        // Fallback for unapproved documents: export latest extracted draft revision.
        revisions: {
          take: 1,
          orderBy: { revisionNumber: 'desc' },
          include: {
            items: {
              orderBy: { lineNo: 'asc' },
            },
          },
        },
      },
    });

    // Filter accessible documents
    const accessibleDocs: typeof documents = [];

    for (const doc of documents) {
      const companyId = doc.document?.companyId;
      if (!companyId || !(await canAccessCompany(session, companyId))) {
        continue;
      }
      accessibleDocs.push(doc);
    }

    if (accessibleDocs.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'NO_FILES', message: 'No accessible documents to export' },
        },
        { status: 400 }
      );
    }

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Oakcloud';
    workbook.created = new Date();

    // ========================
    // Worksheet 1: Headers
    // ========================
    const headersSheet = workbook.addWorksheet('Document Headers');
    headersSheet.columns = [
      { header: 'File Name', key: 'fileName', width: 35 },
      { header: 'Pipeline Status', key: 'pipelineStatus', width: 15 },
      { header: 'Revision Status', key: 'revisionStatus', width: 15 },
      { header: 'Duplicate Status', key: 'duplicateStatus', width: 18 },
      { header: 'Document Category', key: 'documentCategory', width: 20 },
      { header: 'Document Sub-Category', key: 'documentSubCategory', width: 22 },
      { header: 'Vendor Name', key: 'vendorName', width: 30 },
      { header: 'Document Number', key: 'documentNumber', width: 20 },
      { header: 'Document Date', key: 'documentDate', width: 15 },
      { header: 'Due Date', key: 'dueDate', width: 15 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Subtotal', key: 'subtotal', width: 15 },
      { header: 'Tax Amount', key: 'taxAmount', width: 15 },
      { header: 'Total Amount', key: 'totalAmount', width: 15 },
      { header: 'Supplier GST No', key: 'supplierGstNo', width: 18 },
      { header: 'Home Currency', key: 'homeCurrency', width: 15 },
      { header: 'Exchange Rate', key: 'exchangeRate', width: 15 },
      { header: 'Home Equivalent', key: 'homeEquivalent', width: 15 },
      { header: 'Created Date', key: 'createdDate', width: 18 },
      { header: 'Approved Date', key: 'approvedDate', width: 18 },
    ];

    // Style header row
    headersSheet.getRow(1).font = { bold: true };
    headersSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add header data
    for (const doc of accessibleDocs) {
      const revision = doc.currentRevision ?? doc.revisions[0] ?? null;
      const fileName = doc.document?.fileName || doc.document?.originalFileName || '';

      headersSheet.addRow({
        fileName,
        pipelineStatus: PIPELINE_STATUS_LABELS[doc.pipelineStatus] || doc.pipelineStatus,
        revisionStatus: revision ? (REVISION_STATUS_LABELS[revision.status] || revision.status) : '',
        duplicateStatus: DUPLICATE_STATUS_LABELS[doc.duplicateStatus] || doc.duplicateStatus,
        documentCategory: revision?.documentCategory ? (CATEGORY_LABELS[revision.documentCategory] || revision.documentCategory) : '',
        documentSubCategory: revision?.documentSubCategory ? (SUBCATEGORY_LABELS[revision.documentSubCategory] || revision.documentSubCategory) : '',
        vendorName: revision?.vendorName || '',
        documentNumber: revision?.documentNumber || '',
        documentDate: revision?.documentDate ? formatDate(revision.documentDate) : '',
        dueDate: revision?.dueDate ? formatDate(revision.dueDate) : '',
        currency: revision?.currency || '',
        subtotal: formatDecimal(revision?.subtotal),
        taxAmount: formatDecimal(revision?.taxAmount),
        totalAmount: formatDecimal(revision?.totalAmount),
        supplierGstNo: revision?.supplierGstNo || '',
        homeCurrency: revision?.homeCurrency || '',
        exchangeRate: formatDecimal(revision?.homeExchangeRate),
        homeEquivalent: formatDecimal(revision?.homeEquivalent),
        createdDate: doc.document?.createdAt ? formatDate(doc.document.createdAt) : '',
        approvedDate: revision?.approvedAt ? formatDate(revision.approvedAt) : '',
      });
    }

    // ========================
    // Worksheet 2: Line Items
    // ========================
    const lineItemsSheet = workbook.addWorksheet('Line Items');
    lineItemsSheet.columns = [
      { header: 'File Name', key: 'fileName', width: 35 },
      { header: 'Vendor Name', key: 'vendorName', width: 30 },
      { header: 'Document Number', key: 'documentNumber', width: 20 },
      { header: 'Document Category', key: 'documentCategory', width: 20 },
      { header: 'Document Sub-Category', key: 'documentSubCategory', width: 22 },
      { header: 'Document Date', key: 'documentDate', width: 15 },
      { header: 'Due Date', key: 'dueDate', width: 15 },
      { header: 'Exchange Rate', key: 'exchangeRate', width: 15 },
      { header: 'Line No', key: 'lineNo', width: 10 },
      { header: 'Description', key: 'description', width: 50 },
      { header: 'Quantity', key: 'quantity', width: 12 },
      { header: 'Unit Price', key: 'unitPrice', width: 15 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'GST Amount', key: 'gstAmount', width: 15 },
      { header: 'Tax Code', key: 'taxCode', width: 12 },
      { header: 'Account Code', key: 'accountCode', width: 15 },
      { header: 'Account Name', key: 'accountName', width: 28 },
      { header: 'Home Amount', key: 'homeAmount', width: 15 },
      { header: 'Home GST Amount', key: 'homeGstAmount', width: 15 },
    ];

    // Style header row
    lineItemsSheet.getRow(1).font = { bold: true };
    lineItemsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add line item data
    const accountLookupCache = new Map<string, AccountNameLookup>();
    for (const doc of accessibleDocs) {
      const revision = doc.currentRevision ?? doc.revisions[0] ?? null;
      if (!revision?.items || revision.items.length === 0) continue;

      const fileName = doc.document?.fileName || doc.document?.originalFileName || '';
      const companyId = doc.document?.companyId;
      const tenantId = doc.document?.company?.tenantId ?? session.tenantId;
      const lookupKey = `${tenantId || ''}::${companyId || ''}`;
      let accountNameLookup = accountLookupCache.get(lookupKey);
      if (!accountNameLookup) {
        accountNameLookup = await buildAccountNameLookup(tenantId, companyId);
        accountLookupCache.set(lookupKey, accountNameLookup);
      }

      for (const item of revision.items) {
        lineItemsSheet.addRow({
          fileName,
          vendorName: revision.vendorName || '',
          documentNumber: revision.documentNumber || '',
          documentCategory: revision?.documentCategory ? (CATEGORY_LABELS[revision.documentCategory] || revision.documentCategory) : '',
          documentSubCategory: revision?.documentSubCategory ? (SUBCATEGORY_LABELS[revision.documentSubCategory] || revision.documentSubCategory) : '',
          documentDate: revision?.documentDate ? formatDate(revision.documentDate) : '',
          dueDate: revision?.dueDate ? formatDate(revision.dueDate) : '',
          exchangeRate: formatDecimal(revision?.homeExchangeRate),
          lineNo: item.lineNo,
          description: item.description || '',
          quantity: formatDecimal(item.quantity),
          unitPrice: formatDecimal(item.unitPrice),
          currency: revision?.currency || '',
          amount: formatDecimal(item.amount),
          gstAmount: formatDecimal(item.gstAmount),
          taxCode: item.taxCode || '',
          accountCode: item.accountCode || '',
          accountName: item.accountCode ? (accountNameLookup[item.accountCode] || '') : '',
          homeAmount: formatDecimal(item.homeAmount),
          homeGstAmount: formatDecimal(item.homeGstAmount),
        });
      }
    }

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Generate filename with date
    const dateStr = new Date().toISOString().split('T')[0];
    const excelFileName = `export-${dateStr}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${excelFileName}"`,
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (error) {
    log.error('Bulk export API error:', error);

    return handleApiError(error, 'bulk-export');
  }
}
