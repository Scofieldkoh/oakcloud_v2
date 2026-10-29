import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { duplicateTaskPipelineSchema } from '@/lib/validations/task-pipeline';
import { taskPipelineRouteParamsSchema } from '@/lib/validations/task-api';
import { duplicateTaskPipeline } from '@/services/tasks';
import { requireTenantWideTaskAccess } from '@/services/tasks/access';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    const { id } = taskPipelineRouteParamsSchema.parse(await params);
    const parsed = duplicateTaskPipelineSchema.parse(await request.json());
    await requireTenantWideTaskAccess(session, 'update');

    return NextResponse.json(
      await duplicateTaskPipeline(tenantId, id, parsed, session.id),
      { status: 201 },
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}
