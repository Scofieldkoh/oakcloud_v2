import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { taskRouteParamsSchema } from '@/lib/validations/task-api';
import { getTaskResources } from '@/services/tasks';
import { requireTaskAccess } from '@/services/tasks/access';

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { taskId } = await params;
    const { id } = taskRouteParamsSchema.parse({ id: taskId });
    const tenantId = requireSessionWorkspaceId(session);

    await requireTaskAccess(session, tenantId, id, 'read');
    return NextResponse.json(await getTaskResources(session, tenantId, id));
  } catch (error) {
    return createErrorResponse(error);
  }
}
