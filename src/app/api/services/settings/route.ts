import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getServiceWorkspaceFlagsForTenant } from '@/services/schedule-reconciliation';
import { routeErrorResponse } from '@/lib/api-route-errors';

/**
 * Return feature flags for the authenticated workspace. The workspace is
 * always derived from the session; this endpoint intentionally has no tenant
 * query parameter.
 */
export async function GET(_request: Request) {
  try {
    const session = await requireAuth();
    if (!session.tenantId) {
      return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    }

    return NextResponse.json(await getServiceWorkspaceFlagsForTenant(session.tenantId));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
