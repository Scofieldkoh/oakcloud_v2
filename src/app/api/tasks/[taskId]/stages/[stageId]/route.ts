import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { taskStageMetadataSchema } from '@/lib/validations/task';
import { taskStageRouteParamsSchema } from '@/lib/validations/task-api';
import {
  getTaskStageDetail,
  updateTaskStageMetadata,
} from '@/services/tasks';
import { requireTaskAccess } from '@/services/tasks/access';

interface RouteParams {
  params: Promise<{ taskId: string; stageId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { taskId, stageId } = taskStageRouteParamsSchema.parse(await params);

    const tenantId = requireSessionWorkspaceId(session);
    await requireTaskAccess(session, tenantId, taskId, 'read');
    return NextResponse.json(
      await getTaskStageDetail(
        tenantId,
        taskId,
        stageId,
      ),
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    const { taskId, stageId } = taskStageRouteParamsSchema.parse(await params);
    const parsed = taskStageMetadataSchema.parse(await request.json());
    await requireTaskAccess(session, tenantId, taskId, 'update');

    await getTaskStageDetail(tenantId, taskId, stageId);
    await updateTaskStageMetadata(tenantId, stageId, parsed, session.id);
    return NextResponse.json(await getTaskStageDetail(tenantId, taskId, stageId));
  } catch (error) {
    return createErrorResponse(error);
  }
}
