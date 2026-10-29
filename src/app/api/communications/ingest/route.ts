import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireWorkspaceContext } from '@/lib/api-helpers';
import { ingestCommunicationsSchema } from '@/lib/validations/communication';
import { ingestTenantOutlookCommunications } from '@/services/outlook-email-ingestion.service';

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const params = ingestCommunicationsSchema.parse(body);

    const tenantResult = await requireWorkspaceContext(session, params.tenantId);
    if (tenantResult.error) return tenantResult.error;

    const result = await ingestTenantOutlookCommunications({
      tenantId: tenantResult.tenantId,
      userId: session.id,
      lookbackDays: params.lookbackDays,
      maxMessagesPerMailbox: params.maxMessagesPerMailbox,
    });

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
