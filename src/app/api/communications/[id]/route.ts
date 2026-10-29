import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireWorkspaceContext } from '@/lib/api-helpers';
import { deleteCommunicationSchema } from '@/lib/validations/communication';
import { deleteWorkspaceCommunication } from '@/services/outlook-email-ingestion.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = deleteCommunicationSchema.parse(body);

    const tenantResult = await requireWorkspaceContext(session, parsed.tenantId);
    if (tenantResult.error) return tenantResult.error;

    await deleteWorkspaceCommunication({
      tenantId: tenantResult.tenantId,
      userId: session.id,
      communicationId: id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return createErrorResponse(error);
  }
}

