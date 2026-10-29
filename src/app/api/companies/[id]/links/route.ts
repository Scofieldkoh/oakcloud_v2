import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { getCompanyLinkInfo } from '@/services/company.service';
import { routeErrorResponse } from '@/lib/api-route-errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check permission
    await requirePermission(session, 'company', 'read', id);

    // Additional check for company-scoped users
    if (!(await canAccessCompany(session, id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!session.tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    const linkInfo = await getCompanyLinkInfo(id, session.tenantId);

    return NextResponse.json(linkInfo);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
