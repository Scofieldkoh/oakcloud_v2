import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { requirePermission } from '@/lib/rbac';
import { clientServiceDeadlineDraftPreviewSchema } from '@/lib/validations/client-service';
import { previewClientServiceDeadlineDraft } from '@/services/client-service';

function parseStrictEmptyQuery(request: NextRequest): void {
  const entries = [...request.nextUrl.searchParams.entries()];
  if (entries.length > 0) {
    throw new ValidationError('This endpoint does not accept query parameters');
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    parseStrictEmptyQuery(request);
    const actor = {
      tenantId: requireSessionWorkspaceId(session),
      userId: session.id,
      accessibleCompanyIds: session.hasAllCompaniesAccess || session.isSuperAdmin ? undefined : session.companyIds ?? [],
      allCompaniesAccess: session.hasAllCompaniesAccess || session.isSuperAdmin,
    };
    const body = await request.json().catch(() => {
      throw new ValidationError('Request body must be valid JSON');
    });
    const input = clientServiceDeadlineDraftPreviewSchema.parse(body);
    await requirePermission(session, 'company', 'update', input.companyId);
    const preview = await previewClientServiceDeadlineDraft(input, actor);
    return NextResponse.json(preview);
  } catch (error) {
    return createErrorResponse(error);
  }
}
