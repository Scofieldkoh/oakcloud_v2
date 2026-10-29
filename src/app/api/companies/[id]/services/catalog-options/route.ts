import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { getManualClientServiceCatalogOptions } from '@/services/client-service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'company', 'update', id);
    const tenantId = requireSessionWorkspaceId(session);
    return NextResponse.json(await getManualClientServiceCatalogOptions(id, { tenantId, userId: session.id }));
  } catch (error) {
    return createErrorResponse(error);
  }
}
