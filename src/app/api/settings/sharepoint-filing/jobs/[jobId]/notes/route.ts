import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { ApiError } from '@/lib/errors';
import { createErrorResponse } from '@/lib/api-helpers';
import { SharePointServiceError } from '@/services/sharepoint.service';
import { addSharePointFilingNote } from '@/services/esigning-sharepoint-filing/recovery';

const noteSchema = z.object({ note: z.string().trim().min(1).max(2000) }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await requirePermission(session, 'connector', 'update');
    if (!session.tenantId) return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    const { jobId } = await params;
    const body = noteSchema.parse(await request.json());
    return NextResponse.json(await addSharePointFilingNote({ workspaceId: session.tenantId, jobId, userId: session.id, note: body.note }));
  } catch (error) {
    if (error instanceof SharePointServiceError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode ?? 400 });
    if (error instanceof ApiError) return NextResponse.json({ errorCode: error.code, error: error.message }, { status: error.statusCode });
    return createErrorResponse(error, 'SharePoint filing note failed');
  }
}
