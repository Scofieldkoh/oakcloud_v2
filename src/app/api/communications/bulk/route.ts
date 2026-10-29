import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireWorkspaceContext } from '@/lib/api-helpers';
import { bulkDeleteCommunicationsSchema } from '@/lib/validations/communication';
import { deleteWorkspaceCommunicationsBulk } from '@/services/outlook-email-ingestion.service';

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = bulkDeleteCommunicationsSchema.parse(body);

    const tenantResult = await requireWorkspaceContext(session, parsed.tenantId);
    if (tenantResult.error) return tenantResult.error;

    const result = await deleteWorkspaceCommunicationsBulk({
      tenantId: tenantResult.tenantId,
      userId: session.id,
      communicationIds: parsed.ids,
    });

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}

