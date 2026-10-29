/**
 * Audit Log Statistics API Route
 *
 * GET /api/audit-logs/stats - Get audit log statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { requireAuth, isSuperAdmin } from '@/lib/auth';
import { auditStatsQuerySchema } from '@/lib/validations/audit';
import { getTenantAuditStats } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);

    // Default to last 30 days if no dates provided
    const defaultEndDate = new Date();
    const defaultStartDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const params = auditStatsQuerySchema.parse({
      startDate: searchParams.get('startDate') || defaultStartDate.toISOString(),
      endDate: searchParams.get('endDate') || defaultEndDate.toISOString(),
    });

    // Determine tenant scope
    let tenantId: string | undefined;

    if (!isSuperAdmin(session)) {
      if (!session.tenantId) {
        return NextResponse.json({ error: 'No tenant association' }, { status: 403 });
      }
      tenantId = session.tenantId;
    } else {
      // Super admin can optionally filter by tenant
      tenantId = searchParams.get('tenantId') || undefined;
    }

    // If tenant-scoped, use the tenant stats function
    if (tenantId) {
      const stats = await getTenantAuditStats(tenantId, params.startDate, params.endDate);
      return NextResponse.json(stats);
    }

    // System-wide stats for super admin (no tenant filter)
    const [
      totalLogs,
      actionCounts,
      entityTypeCounts,
      topTenants,
      topUsers,
    ] = await Promise.all([
      prisma.auditLog.count({
        where: {
          createdAt: { gte: params.startDate, lte: params.endDate },
        },
      }),
      prisma.auditLog.groupBy({
        by: ['action'],
        where: {
          createdAt: { gte: params.startDate, lte: params.endDate },
        },
        _count: true,
      }),
      prisma.auditLog.groupBy({
        by: ['entityType'],
        where: {
          createdAt: { gte: params.startDate, lte: params.endDate },
        },
        _count: true,
      }),
      prisma.auditLog.groupBy({
        by: ['tenantId'],
        where: {
          tenantId: { not: null },
          createdAt: { gte: params.startDate, lte: params.endDate },
        },
        _count: true,
        orderBy: { _count: { tenantId: 'desc' } },
        take: 10,
      }),
      prisma.auditLog.groupBy({
        by: ['userId'],
        where: {
          userId: { not: null },
          createdAt: { gte: params.startDate, lte: params.endDate },
        },
        _count: true,
        orderBy: { _count: { userId: 'desc' } },
        take: 10,
      }),
    ]);

    return NextResponse.json({
      totalLogs,
      actionCounts: actionCounts.map((a) => ({
        action: a.action,
        count: a._count,
      })),
      entityTypeCounts: entityTypeCounts.map((e) => ({
        entityType: e.entityType,
        count: e._count,
      })),
      topTenants: topTenants.map((t) => ({
        tenantId: t.tenantId,
        count: t._count,
      })),
      topUsers: topUsers.map((u) => ({
        userId: u.userId,
        count: u._count,
      })),
      dateRange: {
        start: params.startDate,
        end: params.endDate,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
