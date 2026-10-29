import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import {
  archiveTaskSchema,
  updateTaskMetadataSchema,
} from '@/lib/validations/task';
import { taskRouteParamsSchema } from '@/lib/validations/task-api';
import {
  archiveTask,
  getTask,
  updateTaskMetadata,
} from '@/services/tasks';
import {
  requireTaskAccess,
  requireTaskCompanyAccess,
} from '@/services/tasks/access';

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
    return NextResponse.json(await getTask(tenantId, id, session.id));
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    const { taskId } = await params;
    const { id } = taskRouteParamsSchema.parse({ id: taskId });
    const body = await request.json();
    const { tenantId: _ignoredTenantId, ...input } = body;
    const parsed = updateTaskMetadataSchema.parse(input);
    await requireTaskAccess(session, tenantId, id, 'update');
    if (parsed.companyId !== undefined) {
      await requireTaskCompanyAccess(session, parsed.companyId, 'update');
    }

    return NextResponse.json(
      await updateTaskMetadata(tenantId, id, input, session.id),
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    const { taskId } = await params;
    const { id } = taskRouteParamsSchema.parse({ id: taskId });
    const parsed = archiveTaskSchema.parse(await request.json());
    await requireTaskAccess(session, tenantId, id, 'update');

    await archiveTask(tenantId, id, parsed.reason, session.id);
    return NextResponse.json({ id, archived: true });
  } catch (error) {
    return createErrorResponse(error);
  }
}
