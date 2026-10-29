import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { getFormById, getFormResponseById } from '@/services/form-builder.service';
import { diagnoseFormSubmissionAiAttachments } from '@/services/form-ai.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface RouteParams {
  params: Promise<{
    id: string;
    submissionId: string;
  }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, submissionId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');

    const body = await request.json().catch(() => ({}));
    const tenantId = resolveWorkspaceId(session, typeof body.tenantId === 'string' ? body.tenantId : null);

    const [form, responseDetail] = await Promise.all([
      getFormById(id, tenantId),
      getFormResponseById(id, submissionId, tenantId),
    ]);

    if (!form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    const result = await diagnoseFormSubmissionAiAttachments({
      form,
      submission: responseDetail.submission,
      uploads: responseDetail.uploads,
    });

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
