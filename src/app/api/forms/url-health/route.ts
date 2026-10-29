import { type NextRequest, NextResponse } from 'next/server';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { listFormUrlWarningSummaries } from '@/services/form-url-health.service';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');
    const tenantId = resolveWorkspaceId(session, new URL(request.url).searchParams.get('tenantId'));
    return NextResponse.json(await listFormUrlWarningSummaries(tenantId));
  } catch (error) {
    return createErrorResponse(error);
  }
}
