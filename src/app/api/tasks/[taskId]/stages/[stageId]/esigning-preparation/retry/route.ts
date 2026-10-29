import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { taskStageRouteParamsSchema } from '@/lib/validations/task-api';
import { retryTaskEsigningPreparation } from '@/services/tasks/esigning-preparation.service';
import { requireTaskAccess } from '@/services/tasks/access';

interface RouteParams {
  params: Promise<{ taskId: string; stageId: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    const { taskId, stageId } = taskStageRouteParamsSchema.parse(await params);
    await requireTaskAccess(session, tenantId, taskId, 'update');
    await requirePermission(session, 'document', 'read');
    await requirePermission(session, 'esigning', 'create');
    return NextResponse.json(
      await retryTaskEsigningPreparation(tenantId, taskId, stageId),
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}
