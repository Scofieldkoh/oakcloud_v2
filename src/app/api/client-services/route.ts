import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { requireSessionWorkspaceId } from '@/lib/api-helpers';
import {
  getCompanyReadScope,
  jsonWithServerTiming,
  withServerTiming,
} from '@/lib/api/company-query';
import {
  emptyServiceRosterResult,
  parseServiceRosterSearchParams,
} from '@/lib/validations/service-roster';
import { requireServicesWorkspaceEnabled } from '@/services/schedule-reconciliation';
import { listServiceRoster } from '@/services/service-roster';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startedAt = performance.now();
  try {
    const session = await requireAuth();
    await requirePermission(session, 'company', 'read');
    const tenantId = requireSessionWorkspaceId(session);
    await requireServicesWorkspaceEnabled(tenantId);

    const search = parseServiceRosterSearchParams(request);
    const scope = getCompanyReadScope(session);
    if ('empty' in scope || scope.options.companyIds?.length === 0) {
      return jsonWithServerTiming(emptyServiceRosterResult(search), startedAt);
    }

    return jsonWithServerTiming(await listServiceRoster(search, {
      tenantId,
      companyIds: scope.options.companyIds,
    }), startedAt);
  } catch (error) {
    console.error('[API /api/client-services GET] error:', error);
    return withServerTiming(routeErrorResponse(error), startedAt);
  }
}
