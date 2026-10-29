import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireWorkspaceContext } from '@/lib/api-helpers';
import { listCommunicationsSchema } from '@/lib/validations/communication';
import {
  getOutlookConnectorStatus,
  listLatestTenantCommunications,
} from '@/services/outlook-email-ingestion.service';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const params = listCommunicationsSchema.parse({
      tenantId: searchParams.get('tenantId') || undefined,
      limit: searchParams.get('limit') || undefined,
    });

    const tenantResult = await requireWorkspaceContext(session, params.tenantId);
    if (tenantResult.error) return tenantResult.error;

    const [connector, communications] = await Promise.all([
      getOutlookConnectorStatus(tenantResult.tenantId),
      listLatestTenantCommunications(tenantResult.tenantId, params.limit),
    ]);

    return NextResponse.json({
      connector,
      communications,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
