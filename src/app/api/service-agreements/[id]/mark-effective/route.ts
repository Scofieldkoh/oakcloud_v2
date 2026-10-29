import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { markServiceAgreementEffectiveSchema } from '@/lib/validations/client-service';
import { getServiceAgreementCompanyIds, requestManualServiceAgreementActivation } from '@/services/service-agreement';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const tenantId = requireSessionWorkspaceId(session);
    await requirePermission(session, 'document', 'update');
    const companyIds = await getServiceAgreementCompanyIds(id, tenantId);
    await Promise.all(companyIds.map((companyId) => requirePermission(session, 'company', 'update', companyId)));
    const result = await requestManualServiceAgreementActivation(id, markServiceAgreementEffectiveSchema.parse(await request.json()), { tenantId, userId: session.id });
    return NextResponse.json(result);
  } catch (error) { return createErrorResponse(error); }
}
