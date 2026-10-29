/**
 * Connector Usage Logs API
 *
 * GET /api/connectors/[id]/usage - List usage logs with filtering
 * GET /api/connectors/[id]/usage?export=csv - Export as CSV
 */

import { NextRequest, NextResponse } from 'next/server';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { requireAuth } from '@/lib/auth';
import { searchUsageLogs, getUsageStats, exportUsageLogs } from '@/services/connector-usage.service';
import { prisma } from '@/lib/prisma';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/connectors/[id]/usage
 * List usage logs with filtering, or export as CSV
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { id: connectorId } = await context.params;
    const { searchParams } = new URL(request.url);

    // Get connector to verify access
    const connector = await prisma.connector.findUnique({
      where: { id: connectorId, deletedAt: null },
      select: { id: true, workspaceId: true, name: true },
    });

    if (!connector) {
      return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
    }

    // Access control: SUPER_ADMIN can see all, workspace admins can only see their workspace connectors
    const isSystem = connector.workspaceId === null;
    if (!session.isSuperAdmin) {
      if (isSystem) {
        // Workspace admins can view usage of system connectors used by their workspace
        // But can't see global usage
      } else if (connector.workspaceId !== session.tenantId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    // Parse query parameters
    const exportFormat = searchParams.get('export');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const startDate = searchParams.get('startDate')
      ? new Date(searchParams.get('startDate')!)
      : undefined;
    // Set end date to end of day (23:59:59.999) to include all records from that day
    const endDate = searchParams.get('endDate')
      ? (() => {
          const d = new Date(searchParams.get('endDate')!);
          d.setUTCHours(23, 59, 59, 999);
          return d;
        })()
      : undefined;
    const model = searchParams.get('model') || undefined;
    const operation = searchParams.get('operation') || undefined;
    const success = searchParams.get('success')
      ? searchParams.get('success') === 'true'
      : undefined;
    const sortBy = (searchParams.get('sortBy') as 'createdAt' | 'costCents' | 'totalTokens' | 'latencyMs') || 'createdAt';
    const sortOrder = (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc';

    // For workspace admins viewing a system connector, filter to their workspace usage
    const filterTenantId = !session.isSuperAdmin && isSystem ? session.tenantId : undefined;

    const searchParams_parsed = {
      connectorId,
      tenantId: filterTenantId || undefined,
      model,
      operation,
      success,
      startDate,
      endDate,
      page,
      limit,
      sortBy,
      sortOrder,
    };

    // Handle CSV export
    if (exportFormat === 'csv') {
      const csv = await exportUsageLogs(searchParams_parsed);

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="connector-usage-${connectorId}-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    // Get usage logs
    const { logs, total } = await searchUsageLogs(searchParams_parsed);

    // Also get stats summary for this connector
    const stats = await getUsageStats(connectorId, startDate, endDate);

    return NextResponse.json({
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      stats: {
        totalCalls: stats.totalCalls,
        successfulCalls: stats.successfulCalls,
        failedCalls: stats.failedCalls,
        totalTokens: stats.totalTokens,
        totalCostUsd: stats.totalCostUsd,
        avgLatencyMs: stats.avgLatencyMs,
      },
    });
  } catch (error) {
    console.error('[Connector Usage API] Error:', error);
    return routeErrorResponse(error);
  }
}
