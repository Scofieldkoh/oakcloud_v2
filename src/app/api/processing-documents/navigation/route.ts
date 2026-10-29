/**
 * Processing Document Review Navigation API
 *
 * GET /api/processing-documents/navigation
 * Provides prev/next navigation within a filtered document set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@/generated/prisma';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

function buildBaseWhere(input: {
  tenantId: string;
  companyIds?: string[];
}): Prisma.ProcessingDocumentWhereInput {
  const documentFilter: Prisma.DocumentWhereInput = { tenantId: input.tenantId };
  if (input.companyIds?.length) {
    documentFilter.companyId = { in: input.companyIds };
  }

  return {
    deletedAt: null,
    document: documentFilter,
  };
}

function buildNeedsReviewWhere(): Prisma.ProcessingDocumentWhereInput {
  // Only match documents that need review:
  // 1. Suspected duplicates that need resolution
  // 2. Documents with any DRAFT revision (not yet approved)
  // Note: Approved documents should NOT appear even if they have validation issues
  // (validation issues on approved docs were accepted by the user during approval)
  return {
    OR: [
      { duplicateStatus: 'SUSPECTED' },
      // Any document with a DRAFT revision needs review
      { revisions: { some: { status: 'DRAFT' } } },
    ],
  };
}

function buildBeforeCurrentWhere(createdAt: Date, id: string): Prisma.ProcessingDocumentWhereInput {
  // Sort: createdAt desc, id desc
  // "Before" current means newer in the list.
  return {
    OR: [
      { createdAt: { gt: createdAt } },
      { createdAt: createdAt, id: { gt: id } },
    ],
  };
}

function buildAfterCurrentWhere(createdAt: Date, id: string): Prisma.ProcessingDocumentWhereInput {
  // Sort: createdAt desc, id desc
  // "After" current means older in the list.
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      { createdAt: createdAt, id: { lt: id } },
    ],
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);

    const filter = (searchParams.get('filter') || 'needs-review') as 'all' | 'needs-review';
    const start = searchParams.get('start') === 'true';

    const currentDocumentId = searchParams.get('currentDocumentId');
    if (!start && !currentDocumentId) {
      return jsonError(400, 'VALIDATION_ERROR', 'currentDocumentId is required unless start=true');
    }

    const effectiveTenantId = session.tenantId;

    if (!effectiveTenantId) {
      return jsonError(400, 'VALIDATION_ERROR', 'Tenant context is required');
    }

    // Determine accessible company IDs
    const companyId = searchParams.get('companyId');
    let companyIds: string[] | undefined;
    if (companyId) {
      if (!(await canAccessCompany(session, companyId))) {
        return jsonError(403, 'PERMISSION_DENIED', 'Forbidden');
      }
      companyIds = [companyId];
    } else if (!session.isSuperAdmin && !session.isWorkspaceAdmin && !session.hasAllCompaniesAccess) {
      companyIds = session.companyIds;
    }

    const baseWhere = buildBaseWhere({ tenantId: effectiveTenantId, companyIds });
    const needsReviewWhere = filter === 'needs-review' ? buildNeedsReviewWhere() : {};
    const scopedWhere: Prisma.ProcessingDocumentWhereInput = { AND: [baseWhere, needsReviewWhere] };

    // Start-of-queue request (used by list page "Review next")
    if (start) {
      const firstTwo = await prisma.processingDocument.findMany({
        where: scopedWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2,
        select: { id: true },
      });

      const total = await prisma.processingDocument.count({ where: scopedWhere });

      return NextResponse.json({
        success: true,
        data: {
          total,
          currentIndex: firstTwo.length > 0 ? 0 : 0,
          currentDocumentId: firstTwo[0]?.id ?? null,
          prevId: null,
          nextId: firstTwo[1]?.id ?? null,
        },
        meta: { requestId: uuidv4(), timestamp: new Date().toISOString() },
      });
    }

    // Validate the current document exists and is accessible
    const current = await prisma.processingDocument.findUnique({
      where: { id: currentDocumentId! },
      select: {
        id: true,
        createdAt: true,
        document: { select: { companyId: true, tenantId: true } },
      },
    });

    if (!current || current.document.tenantId !== effectiveTenantId) {
      return jsonError(404, 'RESOURCE_NOT_FOUND', 'Document not found');
    }

    if (current.document.companyId && !(await canAccessCompany(session, current.document.companyId))) {
      return jsonError(403, 'PERMISSION_DENIED', 'Forbidden');
    }

    // Total count (for "x / total")
    const totalPromise = prisma.processingDocument.count({ where: scopedWhere });

    // Index within sorted set (createdAt desc, id desc)
    const currentIndexPromise = prisma.processingDocument.count({
      where: {
        AND: [
          scopedWhere,
          buildBeforeCurrentWhere(current.createdAt, current.id),
        ],
      },
    });

    // Prev (newer) doc: constrain to before-current, then pick the closest by ordering ascending
    const prevPromise = prisma.processingDocument.findFirst({
      where: { AND: [scopedWhere, buildBeforeCurrentWhere(current.createdAt, current.id)] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });

    // Next (older) doc: constrain to after-current, then pick the closest by ordering descending
    const nextPromise = prisma.processingDocument.findFirst({
      where: { AND: [scopedWhere, buildAfterCurrentWhere(current.createdAt, current.id)] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });

    const [total, currentIndex, prev, next] = await Promise.all([
      totalPromise,
      currentIndexPromise,
      prevPromise,
      nextPromise,
    ]);

    return NextResponse.json({
      success: true,
      data: {
        total,
        currentIndex,
        currentDocumentId: current.id,
        prevId: prev?.id ?? null,
        nextId: next?.id ?? null,
      },
      meta: { requestId: uuidv4(), timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('Processing document navigation API error:', error);
    return handleApiError(error, 'processing-document-navigation');
  }
}
