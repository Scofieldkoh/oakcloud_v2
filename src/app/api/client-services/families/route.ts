import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { requireSessionWorkspaceId } from '@/lib/api-helpers';
import { getCompanyReadScope } from '@/lib/api/company-query';
import { requireServicesWorkspaceEnabled } from '@/services/schedule-reconciliation';
import { listServiceRosterFamilies } from '@/services/service-roster';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'company', 'read');
    const tenantId = requireSessionWorkspaceId(session);
    await requireServicesWorkspaceEnabled(tenantId);

    const scope = getCompanyReadScope(session);
    if ('empty' in scope || scope.options.companyIds?.length === 0) {
      return NextResponse.json({ families: [] });
    }

    return NextResponse.json({
      families: await listServiceRosterFamilies({
        tenantId,
        companyIds: scope.options.companyIds,
      }),
    });
  } catch (error) {
    console.error('[API /api/client-services/families GET] error:', error);
    return routeErrorResponse(error);
  }
}
