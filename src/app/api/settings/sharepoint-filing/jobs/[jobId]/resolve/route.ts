import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { ApiError } from '@/lib/errors';
import { createErrorResponse } from '@/lib/api-helpers';
import { sharePointFolderRefSchema } from '@/lib/sharepoint/folder-reference';
import { SharePointServiceError } from '@/services/sharepoint.service';
import { resolveSharePointFilingJob } from '@/services/esigning-sharepoint-filing/recovery';

const resolveSchema = z.object({
  connectorId: z.string().uuid().optional(),
  destination: sharePointFolderRefSchema.optional(),
  relativePath: z.string().max(400).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
}).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await requirePermission(session, 'connector', 'update');
    if (!session.tenantId) return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    const { jobId } = await params;
    const body = resolveSchema.parse(await request.json());
    if (!body.destination && !body.relativePath) return NextResponse.json({ errorCode: 'DESTINATION_REQUIRED', error: 'A verified recovery destination is required' }, { status: 400 });
    return NextResponse.json(await resolveSharePointFilingJob({ ...body, workspaceId: session.tenantId, jobId, userId: session.id }));
  } catch (error) {
    if (error instanceof SharePointServiceError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode ?? 400 });
    if (error instanceof ApiError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode });
    return createErrorResponse(error, 'SharePoint filing resolution failed');
  }
}
