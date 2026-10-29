import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { ApiError } from '@/lib/errors';
import { authErrorResponse } from '@/lib/api-route-errors';
import { getWorkspaceSharePointContext, SharePointServiceError } from '@/services/sharepoint.service';
import { getSharePointFilingSettings } from '@/services/sharepoint-filing-settings.service';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await requirePermission(session, 'connector', 'read');
    if (!session.tenantId) return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    const connectorId = new URL(request.url).searchParams.get('connectorId');
    if (!connectorId) return NextResponse.json({ error: 'connectorId is required' }, { status: 400 });
    const context = await getWorkspaceSharePointContext({ workspaceId: session.tenantId, connectorId });
    const settings = await getSharePointFilingSettings({ workspaceId: session.tenantId, connectorId });
    return NextResponse.json({
      connectorId,
      connectorName: context.connectorName,
      connected: true,
      driveId: context.driveId,
      lastVerifiedAt: settings.lastVerifiedAt,
    });
  } catch (error) {
    if (error instanceof SharePointServiceError) {
      return NextResponse.json({ connected: false, errorCode: error.code, error: error.message }, { status: error.statusCode ?? 400 });
    }
    if (error instanceof ApiError) return NextResponse.json({ connected: false, errorCode: error.code, error: error.message }, { status: error.statusCode });
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ connected: false, error: 'SharePoint connection check failed' }, { status: 500 });
  }
}
