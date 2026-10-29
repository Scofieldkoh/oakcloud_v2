import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { getServiceAgreementCompanyIds, retryServiceAgreementActivation } from '@/services/service-agreement';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const tenantId = requireSessionWorkspaceId(session);
    await requirePermission(session, 'document', 'update');
    const companyIds = await getServiceAgreementCompanyIds(id, tenantId);
    await Promise.all(companyIds.map((companyId) => requirePermission(session, 'company', 'update', companyId)));
    return NextResponse.json(await retryServiceAgreementActivation(id, { tenantId, userId: session.id }));
  } catch (error) { return createErrorResponse(error); }
}
