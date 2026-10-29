import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { SharePointServiceError } from '@/services/sharepoint.service';
import { getCompanySharePointFolder, removeCompanySharePointFolder, setCompanySharePointFolder } from '@/services/company-sharepoint-folder.service';
import { z } from 'zod';
import { ApiError } from '@/lib/errors';
import { createErrorResponse } from '@/lib/api-helpers';

interface Params { params: Promise<{ id: string }> }

function errorResponse(error: unknown) {
  if (error instanceof SharePointServiceError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode ?? 400 });
  if (error instanceof ApiError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode });
  if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid request', details: error.flatten() }, { status: 400 });
  return createErrorResponse(error, 'SharePoint mapping failed');
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    await requirePermission(session, 'company', 'read', id);
    if (!session.tenantId) return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    return NextResponse.json({ folder: await getCompanySharePointFolder({ tenantId: session.tenantId, companyId: id }) });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    await requirePermission(session, 'company', 'update', id);
    await requirePermission(session, 'connector', 'read');
    if (!session.tenantId) return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    const body = z.object({ connectorId: z.string().uuid(), folder: z.unknown() }).parse(await request.json());
    const folder = await setCompanySharePointFolder({ tenantId: session.tenantId, userId: session.id, companyId: id, connectorId: body.connectorId, folder: body.folder });
    return NextResponse.json({ folder });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    await requirePermission(session, 'company', 'update', id);
    await requirePermission(session, 'connector', 'read');
    if (!session.tenantId) return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    await removeCompanySharePointFolder({ tenantId: session.tenantId, userId: session.id, companyId: id });
    return NextResponse.json({ success: true });
  } catch (error) { return errorResponse(error); }
}
