import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { ApiError } from '@/lib/errors';
import { createErrorResponse } from '@/lib/api-helpers';
import { SharePointServiceError } from '@/services/sharepoint.service';
import { listSharePointFilingRecoveryQueue } from '@/services/esigning-sharepoint-filing/recovery';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await requirePermission(session, 'connector', 'read');
    if (!session.tenantId) return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    const params = new URL(request.url).searchParams;
    const connectorId = params.get('connectorId');
    if (!connectorId) return NextResponse.json({ error: 'connectorId is required' }, { status: 400 });
    return NextResponse.json(await listSharePointFilingRecoveryQueue({ workspaceId: session.tenantId, connectorId, cursor: params.get('cursor') ?? undefined, limit: Number(params.get('limit') ?? 25) }));
  } catch (error) {
    if (error instanceof SharePointServiceError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode ?? 400 });
    if (error instanceof ApiError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode });
    return createErrorResponse(error, 'SharePoint recovery queue failed');
  }
}
