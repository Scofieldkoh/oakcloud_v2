import { type NextRequest, NextResponse } from 'next/server';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { getFormUrlHealthDetails } from '@/services/form-url-health.service';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');
    const tenantId = resolveWorkspaceId(session, new URL(request.url).searchParams.get('tenantId'));
    return NextResponse.json(await getFormUrlHealthDetails(tenantId, id));
  } catch (error) {
    return createErrorResponse(error);
  }
}
