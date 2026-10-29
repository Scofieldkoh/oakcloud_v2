import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCompanyStats } from '@/services/company.service';
import { routeErrorResponse } from '@/lib/api-route-errors';

export async function GET(request: NextRequest) {
  try {
    // Allow both SUPER_ADMIN (global stats) and TENANT_ADMIN (tenant-scoped stats)
    const session = await requireAuth();
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);

    // For SUPER_ADMIN, allow specifying tenantId via query param
    const tenantIdParam = searchParams.get('tenantId');
    let effectiveTenantId = session.tenantId;

    if (session.isSuperAdmin && tenantIdParam) {
      // Trust the tenantId param - validation happens in getCompanyStats
      // Removing the blocking getWorkspaceById() call for performance
      effectiveTenantId = tenantIdParam;
    }

    // Pass tenantId for non-SUPER_ADMIN users to get tenant-scoped stats
    // SUPER_ADMIN can get global stats with skipTenantFilter only if no tenant selected
    const stats = await getCompanyStats(
      effectiveTenantId,
      { skipTenantFilter: session.isSuperAdmin && !effectiveTenantId }
    );

    return NextResponse.json(stats);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
