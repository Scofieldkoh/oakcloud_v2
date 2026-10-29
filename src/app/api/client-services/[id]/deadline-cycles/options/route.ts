import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { requireServicesWorkspaceEnabled } from '@/services/schedule-reconciliation';
import { getManualDeadlineCycleOptions, type ManualCycleActor } from '@/services/deadline';

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();

function actorFor(session: Awaited<ReturnType<typeof requireAuth>>): ManualCycleActor {
  return {
    tenantId: requireSessionWorkspaceId(session),
    userId: session.id,
    accessibleCompanyIds: session.hasAllCompaniesAccess || session.isSuperAdmin ? undefined : session.companyIds ?? [],
    allCompaniesAccess: session.hasAllCompaniesAccess || session.isSuperAdmin,
  };
}

export async function GET(_request: Request, { params }: Context): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const id = idSchema.parse((await params).id);
    const actor = actorFor(session);
    await requireServicesWorkspaceEnabled(actor.tenantId);
    const options = await getManualDeadlineCycleOptions(id, actor);
    await requirePermission(session, 'company', 'update', options.companyId);
    return NextResponse.json(options);
  } catch (error) {
    return createErrorResponse(error);
  }
}
