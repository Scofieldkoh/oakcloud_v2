import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import {
  archiveTaskPipelineSchema,
  updateTaskPipelineSchema,
} from '@/lib/validations/task-pipeline';
import { taskPipelineRouteParamsSchema } from '@/lib/validations/task-api';
import {
  archiveTaskPipeline,
  getTaskPipeline,
  updateTaskPipeline,
} from '@/services/tasks';
import {
  requireTaskCollectionAccess,
  requireTenantWideTaskAccess,
} from '@/services/tasks/access';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = taskPipelineRouteParamsSchema.parse(await params);

    const tenantId = requireSessionWorkspaceId(session);
    await requireTaskCollectionAccess(session, 'read');
    return NextResponse.json(await getTaskPipeline(tenantId, id));
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    const { id } = taskPipelineRouteParamsSchema.parse(await params);
    const body = await request.json();
    const { tenantId: _ignoredTenantId, ...input } = body;
    const parsed = updateTaskPipelineSchema.parse(input);
    await requireTenantWideTaskAccess(session, 'update');

    return NextResponse.json(
      await updateTaskPipeline(tenantId, id, parsed, session.id),
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    const { id } = taskPipelineRouteParamsSchema.parse(await params);
    const parsed = archiveTaskPipelineSchema.parse(await request.json());
    await requireTenantWideTaskAccess(session, 'update');

    await archiveTaskPipeline(tenantId, id, parsed.reason, session.id);
    return NextResponse.json({ id, archived: true });
  } catch (error) {
    return createErrorResponse(error);
  }
}
