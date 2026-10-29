import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { ApiError } from '@/lib/errors';
import { createErrorResponse } from '@/lib/api-helpers';
import { sharepointSignedFilingUpdateSchema } from '@/lib/validations/connector';
import { getSharePointFilingSettings, updateSharePointFilingSettings } from '@/services/sharepoint-filing-settings.service';
import { SharePointServiceError } from '@/services/sharepoint.service';

function responseForError(error: unknown) {
  if (error instanceof SharePointServiceError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode ?? 400 });
  if (error instanceof ApiError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode });
  return createErrorResponse(error, 'SharePoint filing settings failed');
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await requirePermission(session, 'connector', 'read');
    if (!session.tenantId) return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    const connectorId = new URL(request.url).searchParams.get('connectorId');
    if (!connectorId) return NextResponse.json({ error: 'connectorId is required' }, { status: 400 });
    return NextResponse.json(await getSharePointFilingSettings({ workspaceId: session.tenantId, connectorId }));
  } catch (error) {
    return responseForError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await requirePermission(session, 'connector', 'update');
    if (!session.tenantId) return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    const body = sharepointSignedFilingUpdateSchema.parse(await request.json());
    return NextResponse.json(await updateSharePointFilingSettings({ ...body, workspaceId: session.tenantId, userId: session.id }));
  } catch (error) {
    return responseForError(error);
  }
}
