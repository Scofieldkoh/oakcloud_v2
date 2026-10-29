import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { taskStageRouteParamsSchema } from '@/lib/validations/task-api';
import {
  ensureTaskEsigningPreparation,
  getTaskEsigningPreparation,
  triggerQueuedTaskEsigningPreparationProcessing,
} from '@/services/tasks/esigning-preparation.service';
import { requireTaskAccess } from '@/services/tasks/access';

interface RouteParams {
  params: Promise<{ taskId: string; stageId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    const { taskId, stageId } = taskStageRouteParamsSchema.parse(await params);
    await requireTaskAccess(session, tenantId, taskId, 'read');
    await requirePermission(session, 'document', 'read');
    await requirePermission(session, 'esigning', 'read');
    return NextResponse.json(
      await getTaskEsigningPreparation(tenantId, taskId, stageId),
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    const { taskId, stageId } = taskStageRouteParamsSchema.parse(await params);
    await requireTaskAccess(session, tenantId, taskId, 'update');
    await requirePermission(session, 'document', 'read');
    await requirePermission(session, 'esigning', 'create');
    const preparation = await ensureTaskEsigningPreparation({
      tenantId,
      taskId,
      taskStageId: stageId,
      initiatedById: session.id,
    });
    if (preparation.status === 'QUEUED') {
      triggerQueuedTaskEsigningPreparationProcessing();
    }
    return NextResponse.json(preparation);
  } catch (error) {
    return createErrorResponse(error);
  }
}
