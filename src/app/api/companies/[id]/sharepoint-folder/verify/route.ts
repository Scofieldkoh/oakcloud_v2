import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { ApiError } from '@/lib/errors';
import { createErrorResponse } from '@/lib/api-helpers';
import { SharePointServiceError } from '@/services/sharepoint.service';
import { verifyCompanySharePointFolder } from '@/services/company-sharepoint-folder.service';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    await requirePermission(session, 'company', 'update', id);
    await requirePermission(session, 'connector', 'read');
    if (!session.tenantId) return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    return NextResponse.json({ folder: await verifyCompanySharePointFolder({ tenantId: session.tenantId, userId: session.id, companyId: id }) });
  } catch (error) {
    if (error instanceof SharePointServiceError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode ?? 400 });
    if (error instanceof ApiError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode });
    return createErrorResponse(error, 'SharePoint mapping verification failed');
  }
}
