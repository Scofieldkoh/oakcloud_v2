import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { requireServicesWorkspaceEnabled } from '@/services/schedule-reconciliation';
import { getClientService } from '@/services/client-service';
import { previewManualDeadlineCycle } from '@/services/deadline';
import { manualDeadlineCyclePreviewSchema } from '@/services/deadline/manual-cycle';
import type { ManualCycleActor } from '@/services/deadline';

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

export async function POST(request: NextRequest, { params }: Context): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const id = idSchema.parse((await params).id);
    const actor = actorFor(session);
    await requireServicesWorkspaceEnabled(actor.tenantId);

    // Loading through the existing tenant/access-scoped service projection
    // prevents a caller from learning whether another company/tenant owns an
    // otherwise valid UUID. Permission is checked only after the company is
    // known, matching the deadline lifecycle route contract.
    const service = await getClientService(id, actor);
    await requirePermission(session, 'company', 'update', service.companyId);
    const body = await request.json().catch(() => { throw new z.ZodError([]); });
    const input = manualDeadlineCyclePreviewSchema.parse(body);
    return NextResponse.json(await previewManualDeadlineCycle(id, input, actor));
  } catch (error) {
    return createErrorResponse(error);
  }
}
