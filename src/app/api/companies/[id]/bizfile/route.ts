/**
 * Company BizFile API
 *
 * GET /api/companies/{id}/bizfile - Get the latest BizFile document for a company
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { routeErrorResponse } from '@/lib/api-route-errors';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/companies/{id}/bizfile
 * Returns the latest BizFile document (by documentDate) for the company
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId } = await params;

    // Check access to the company
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Find the latest BizFile document for this company
    // BizFile documents are identified by documentSubCategory = 'BIZFILE'
    const latestBizFile = await prisma.processingDocument.findFirst({
      where: {
        document: {
          companyId,
        },
        currentRevision: {
          documentSubCategory: 'BIZFILE',
        },
      },
      orderBy: {
        currentRevision: {
          documentDate: 'desc',
        },
      },
      select: {
        id: true,
        document: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
          },
        },
        currentRevision: {
          select: {
            documentDate: true,
            documentNumber: true,
          },
        },
      },
    });

    if (!latestBizFile) {
      return NextResponse.json({ error: 'No BizFile found for this company' }, { status: 404 });
    }

    return NextResponse.json({
      processingDocumentId: latestBizFile.id,
      documentId: latestBizFile.document?.id,
      fileName: latestBizFile.document?.fileName,
      mimeType: latestBizFile.document?.mimeType,
      documentDate: latestBizFile.currentRevision?.documentDate,
      receiptNo: latestBizFile.currentRevision?.documentNumber,
      pdfUrl: `/api/processing-documents/${latestBizFile.id}/pdf`,
    });
  } catch (error) {
    console.error('Company BizFile API error:', error);

    return routeErrorResponse(error);
  }
}
