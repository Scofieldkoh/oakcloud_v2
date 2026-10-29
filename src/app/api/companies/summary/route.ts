import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCompanyStats } from '@/services/company.service';
import { jsonWithServerTiming } from '@/lib/api/company-query';
import { routeErrorResponse } from '@/lib/api-route-errors';

export async function GET(request: NextRequest) {
  const startedAt = performance.now();

  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const tenantIdParam = searchParams.get('tenantId');
    const effectiveTenantId = session.isSuperAdmin && tenantIdParam
      ? tenantIdParam
      : session.tenantId;

    const summary = await getCompanyStats(
      effectiveTenantId,
      { skipTenantFilter: session.isSuperAdmin && !effectiveTenantId }
    );

    return jsonWithServerTiming(summary, startedAt);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
