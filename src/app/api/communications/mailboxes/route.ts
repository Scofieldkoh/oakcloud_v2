import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireWorkspaceContext } from '@/lib/api-helpers';
import { updateCommunicationMailboxesSchema } from '@/lib/validations/communication';
import { updateOutlookConnectorMailboxSettings } from '@/services/outlook-email-ingestion.service';

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const params = updateCommunicationMailboxesSchema.parse(body);

    const tenantResult = await requireWorkspaceContext(session, params.tenantId);
    if (tenantResult.error) return tenantResult.error;

    const connector = await updateOutlookConnectorMailboxSettings({
      tenantId: tenantResult.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
      mailboxUserIds: params.mailboxUserIds,
      ingestAllEmails: params.ingestAllEmails,
    });

    return NextResponse.json({ connector });
  } catch (error) {
    return createErrorResponse(error);
  }
}
