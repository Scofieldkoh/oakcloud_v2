import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { NotFoundError } from '@/lib/errors';
import {
  taskStageRouteParamsSchema,
  taskStageTransitionSchema,
} from '@/lib/validations/task-api';
import {
  completeTaskStage,
  getTaskStageDetail,
  linkTaskStageOutcome,
  reconcileTaskStageOutcome,
  reopenTaskStage,
  skipTaskStage,
  updateTaskStageChecklistItem,
} from '@/services/tasks';
import {
  requireTaskAccess,
  requireTaskOutcomeAccess,
} from '@/services/tasks/access';

interface RouteParams {
  params: Promise<{ taskId: string; stageId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    const { taskId, stageId } = taskStageRouteParamsSchema.parse(await params);
    const transition = taskStageTransitionSchema.parse(await request.json());
    await requireTaskAccess(session, tenantId, taskId, 'update');
    if (transition.action === 'linkOutcome') {
      await requireTaskOutcomeAccess(session, tenantId, transition.outcome);
    }

    const stage = await getTaskStageDetail(tenantId, taskId, stageId);
    if (
      transition.action === 'checklist'
      && !stage.checklistItems.some((item) => item.id === transition.checklistItemId)
    ) {
      throw new NotFoundError('Task stage checklist item not found');
    }

    switch (transition.action) {
      case 'complete':
        return NextResponse.json(
          await completeTaskStage(tenantId, stageId, session.id),
        );
      case 'reopen':
        return NextResponse.json(
          await reopenTaskStage(tenantId, stageId, session.id),
        );
      case 'skip':
        return NextResponse.json(
          await skipTaskStage(tenantId, stageId, transition.reason, session.id),
        );
      case 'checklist':
        return NextResponse.json(
          await updateTaskStageChecklistItem(
            tenantId,
            transition.checklistItemId,
            { isCompleted: transition.isCompleted },
            session.id,
          ),
        );
      case 'linkOutcome':
        return NextResponse.json(
          await linkTaskStageOutcome(
            tenantId,
            stageId,
            transition.outcome,
            session.id,
          ),
        );
      case 'reconcile':
        return NextResponse.json(
          await reconcileTaskStageOutcome(tenantId, stageId, session.id),
        );
    }
  } catch (error) {
    return createErrorResponse(error);
  }
}
