import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { resolveFormSubmissionAiWarning } from '@/services/form-builder.service';

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
    const reason = typeof body.reason === 'string' ? body.reason : '';

    const result = await resolveFormSubmissionAiWarning(
      id,
      submissionId,
      {
        tenantId,
        userId: session.id,
      },
      reason
    );

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
