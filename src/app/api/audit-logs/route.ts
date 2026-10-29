/**
 * Audit Logs API Routes
 *
 * GET /api/audit-logs - List audit logs (tenant-scoped)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { requireAuth, isSuperAdmin } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { auditLogQuerySchema } from '@/lib/validations/audit';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import type { AuditAction } from '@/generated/prisma';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check audit_log:read permission
    await requirePermission(session, 'audit_log', 'read');

    const { searchParams } = new URL(request.url);

    const params = auditLogQuerySchema.parse({
      page: searchParams.get('page') || '1',
      limit: searchParams.get('limit') || '50',
      action: searchParams.get('action') || undefined,
      actions: searchParams.get('actions') || undefined,
      entityType: searchParams.get('entityType') || undefined,
      entityTypes: searchParams.get('entityTypes') || undefined,
      userId: searchParams.get('userId') || undefined,
      companyId: searchParams.get('companyId') || undefined,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      sortBy: searchParams.get('sortBy') || 'createdAt',
      sortOrder: searchParams.get('sortOrder') || 'desc',
    });

    // Build where clause
    const where: Prisma.AuditLogWhereInput = {};

    // Tenant scoping - non-super-admins can only see their tenant's logs
    if (!isSuperAdmin(session)) {
      if (!session.tenantId) {
        return NextResponse.json({ error: 'No tenant association' }, { status: 403 });
      }
      where.tenantId = session.tenantId;
    }

    // Filter by specific tenant if super admin requests it
    const tenantId = searchParams.get('tenantId');
    if (tenantId && isSuperAdmin(session)) {
      where.tenantId = tenantId;
    }

    // Action filter
    if (params.action) {
      where.action = params.action as AuditAction;
    } else if (params.actions && params.actions.length > 0) {
      where.action = { in: params.actions as AuditAction[] };
    }

    // Entity type filter
    if (params.entityType) {
      where.entityType = params.entityType;
    } else if (params.entityTypes && params.entityTypes.length > 0) {
      where.entityType = { in: params.entityTypes };
    }

    // User filter
    if (params.userId) {
      where.userId = params.userId;
    }

    // Company filter
    if (params.companyId) {
      where.companyId = params.companyId;
    }

    // Date range filter
    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) {
        where.createdAt.gte = params.startDate;
      }
      if (params.endDate) {
        where.createdAt.lte = params.endDate;
      }
    }

    // Execute query
    const [logs, totalCount] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          company: {
            select: {
              id: true,
              name: true,
              uen: true,
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { [params.sortBy]: params.sortOrder },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      logs,
      totalCount,
      page: params.page,
      limit: params.limit,
      totalPages: Math.ceil(totalCount / params.limit),
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
