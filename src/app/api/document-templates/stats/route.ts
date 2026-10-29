import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { getTemplateStats } from '@/services/document-template.service';
import { createErrorResponse } from '@/lib/api-helpers';

/**
 * GET /api/document-templates/stats
 * Get document template statistics
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check read permission
    await requirePermission(session, 'document', 'read');

    // For SUPER_ADMIN, allow specifying tenantId via query param
    const { searchParams } = new URL(request.url);
    const tenantIdParam = searchParams.get('tenantId');
    const effectiveTenantId =
      session.isSuperAdmin && tenantIdParam ? tenantIdParam : session.tenantId;

    if (!effectiveTenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    const stats = await getTemplateStats(effectiveTenantId);

    return NextResponse.json(stats);
  } catch (error) {
    return createErrorResponse(error);
  }
}
