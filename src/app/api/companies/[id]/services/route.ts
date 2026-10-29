import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { createManualClientServiceSchema, searchClientServicesSchema } from '@/lib/validations/client-service';
import { createManualClientService, listCompanyServices } from '@/services/client-service';
import { getServiceAgreementCompanyIds } from '@/services/service-agreement';
import { createManualClientServiceErrorResponse } from './route-utils';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'company', 'read', id);
    const search = request.nextUrl.searchParams;
    const input = searchClientServicesSchema.parse({ status: search.get('status') || undefined, query: search.get('query') || undefined, page: search.get('page') || undefined, limit: search.get('limit') || undefined });
    const tenantId = requireSessionWorkspaceId(session);
    const result = await listCompanyServices(id, input, { tenantId, userId: session.id });
    const canUpdateDocuments = session.isSuperAdmin || await hasPermission(session.id, 'document', 'update');
    const activations = await Promise.all((result.activations ?? []).map(async (activation) => {
      if (!canUpdateDocuments) return { ...activation, canRetry: false };
      const companyIds = await getServiceAgreementCompanyIds(activation.agreementId, tenantId);
      const permissions = await Promise.all(companyIds.map((companyId) => session.isSuperAdmin || hasPermission(session.id, 'company', 'update', companyId)));
      return { ...activation, canRetry: permissions.every(Boolean) };
    }));
    return NextResponse.json({ ...result, activations });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'company', 'update', id);
    const tenantId = requireSessionWorkspaceId(session);
    const input = createManualClientServiceSchema.parse(await request.json());
    const service = await createManualClientService(id, input, { tenantId, userId: session.id });
    return NextResponse.json(service, { status: 201 });
  } catch (error) {
    return createManualClientServiceErrorResponse(error);
  }
}
