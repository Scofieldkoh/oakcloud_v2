import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { taskListQuerySchema } from '@/lib/validations/task-api';
import { createTaskSchema } from '@/lib/validations/task';
import { createTask, searchTasks } from '@/services/tasks';
import {
  requireTaskCollectionAccess,
  requireTaskCompanyAccess,
} from '@/services/tasks/access';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    const accessibleCompanyIds = await requireTaskCollectionAccess(session, 'read');
    const searchParams = new URL(request.url).searchParams;
    const parsed = taskListQuerySchema.parse({
      query: searchParams.get('q') || undefined,
      title: searchParams.get('title') || undefined,
      ownerQuery: searchParams.get('ownerQuery') || undefined,
      pipelineId: searchParams.get('pipeline') || undefined,
      companyId: searchParams.get('company') || undefined,
      ownerId: searchParams.get('owner') || undefined,
      status: searchParams.get('status') || undefined,
      dueBucket: searchParams.get('dueBucket') || undefined,
      dueDateFrom: searchParams.get('dueDateFrom') || undefined,
      dueDateTo: searchParams.get('dueDateTo') || undefined,
      page: searchParams.get('page') || undefined,
      limit: searchParams.get('limit') || undefined,
      sortBy: searchParams.get('sortBy') || undefined,
      sortOrder: searchParams.get('sortOrder') || undefined,
    });

    return NextResponse.json(await searchTasks(
      tenantId,
      accessibleCompanyIds
        ? { ...parsed, accessibleCompanyIds }
        : parsed,
    ));
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    const body = await request.json();
    const { tenantId: _ignoredTenantId, ...input } = body;
    const parsed = createTaskSchema.parse(input);
    await requireTaskCompanyAccess(session, parsed.companyId, 'update');

    return NextResponse.json(
      await createTask(tenantId, input, session.id),
      { status: 201 },
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}
