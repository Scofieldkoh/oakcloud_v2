/**
 * ACRA Records API Routes (admin)
 *
 * GET /api/admin/acra-records - List locally mirrored ACRA entities with
 * pagination, inline filters (including date ranges), and sorting. Includes
 * the sync state summary so the UI can show how fresh the data is.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { requireAuth, isAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildAcraEntityWhere, getAcraSort } from '@/lib/acra-records-query';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    if (!isAdmin(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
    );

    const { sortBy, sortOrder } = getAcraSort(searchParams);
    const where = buildAcraEntityWhere(searchParams);

    const [records, total, syncStateRow] = await Promise.all([
      prisma.acraEntity.findMany({
        where,
        select: {
          id: true,
          uen: true,
          entityName: true,
          entityStatus: true,
          entityType: true,
          companyTypeDescription: true,
          registrationIncorporateDate: true,
          block: true,
          streetName: true,
          levelNo: true,
          unitNo: true,
          buildingName: true,
          postalCode: true,
          address: true,
          accountDueDate: true,
          annualReturnDate: true,
          primarySsicCode: true,
          primarySsicDescription: true,
          secondarySsicCode: true,
          secondarySsicDescription: true,
          noOfOfficers: true,
          formerEntityName1: true,
          uenOfAuditFirm1: true,
          dataAsOf: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.acraEntity.count({ where }),
      prisma.acraSyncState.findUnique({ where: { id: 'main' } }),
    ]);

    return NextResponse.json({
      records,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      syncState: syncStateRow
        ? {
            collectionLastUpdatedAt: syncStateRow.collectionLastUpdatedAt,
            entityCount: syncStateRow.entityCount,
            lastStartedAt: syncStateRow.lastStartedAt,
            lastCompletedAt: syncStateRow.lastCompletedAt,
            lastError: syncStateRow.lastError,
          }
        : null,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
