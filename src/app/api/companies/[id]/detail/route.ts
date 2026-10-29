import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { requireWorkspaceContext } from '@/lib/api-helpers';
import { parseIdParams } from '@/lib/validations/params';
import { getCompanyById, getCompanyFullDetails } from '@/services/company.service';
import { jsonWithServerTiming } from '@/lib/api/company-query';
import { routeErrorResponse } from '@/lib/api-route-errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = performance.now();

  try {
    const session = await requireAuth();
    const { id } = await parseIdParams(params);
    const { searchParams } = new URL(request.url);
    const tenantResult = await requireWorkspaceContext(session, searchParams.get('tenantId'));
    if ('error' in tenantResult) return tenantResult.error;

    await requirePermission(session, 'company', 'read', id);

    if (!(await canAccessCompany(session, id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const full = searchParams.get('full') === 'true';
    const company = full
      ? await getCompanyFullDetails(id, tenantResult.tenantId)
      : await getCompanyById(id, tenantResult.tenantId);

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    return jsonWithServerTiming(company, startedAt);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
