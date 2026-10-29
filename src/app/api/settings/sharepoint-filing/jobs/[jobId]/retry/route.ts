import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { ApiError } from '@/lib/errors';
import { createErrorResponse } from '@/lib/api-helpers';
import { SharePointServiceError } from '@/services/sharepoint.service';
import { retrySharePointFilingJob } from '@/services/esigning-sharepoint-filing/recovery';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await requirePermission(session, 'connector', 'update');
    if (!session.tenantId) return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    const { jobId } = await params;
    return NextResponse.json(await retrySharePointFilingJob({ workspaceId: session.tenantId, jobId, userId: session.id }));
  } catch (error) {
    if (error instanceof SharePointServiceError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode ?? 400 });
    if (error instanceof ApiError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode });
    return createErrorResponse(error, 'SharePoint filing retry failed');
  }
}
