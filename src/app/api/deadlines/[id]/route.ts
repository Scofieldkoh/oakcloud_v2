import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { ApiError, ErrorCodes, NotFoundError } from '@/lib/errors';
import { requirePermission } from '@/lib/rbac';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { requireServicesWorkspaceEnabled } from '@/services/schedule-reconciliation';
import {
  updateDeadlineOccurrenceSchema,
} from '@/lib/validations/deadline';
import {
  getDeadlineOccurrence,
  updateDeadlineOccurrence,
} from '@/services/deadline';

const deadlineIdSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

function safeErrorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return createErrorResponse(new ApiError(
      ErrorCodes.VALIDATION_ERROR,
      'Invalid deadline request',
      400,
      { issues: error.issues },
    ));
  }
  if (error instanceof SyntaxError) {
    return createErrorResponse(new ApiError(ErrorCodes.VALIDATION_ERROR, 'Invalid JSON request', 400));
  }
  return routeErrorResponse(error);
}

async function requireDeadlineCompanyPermission(
  session: Awaited<ReturnType<typeof requireAuth>>,
  action: 'read' | 'update',
  companyId: string,
): Promise<void> {
  try {
    await requirePermission(session, 'company', action, companyId);
  } catch (error) {
    if (error instanceof ApiError && error.code === ErrorCodes.PERMISSION_DENIED) {
      throw new NotFoundError('Deadline occurrence not found');
    }
    if (error instanceof Error && (
      error.message === 'Forbidden' || error.message.startsWith('Permission denied')
    )) {
      throw new NotFoundError('Deadline occurrence not found');
    }
    throw error;
  }
}

function actorFor(session: Awaited<ReturnType<typeof requireAuth>>) {
  return { tenantId: requireSessionWorkspaceId(session), userId: session.id };
}

async function loadForSession(id: string, session: Awaited<ReturnType<typeof requireAuth>>) {
  const actor = actorFor(session);
  await requireServicesWorkspaceEnabled(actor.tenantId);
  const deadline = await getDeadlineOccurrence(id, actor);
  return { actor, deadline };
}

export async function GET(_request: NextRequest, { params }: Context): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const { id: rawId } = await params;
    const id = deadlineIdSchema.parse(rawId);
    const { deadline } = await loadForSession(id, session);
    await requireDeadlineCompanyPermission(session, 'read', deadline.companyId);
    return NextResponse.json(deadline);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Context): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const { id: rawId } = await params;
    const id = deadlineIdSchema.parse(rawId);
    const { actor, deadline } = await loadForSession(id, session);
    await requireDeadlineCompanyPermission(session, 'update', deadline.companyId);
    const input = updateDeadlineOccurrenceSchema.parse(await request.json());
    return NextResponse.json(await updateDeadlineOccurrence(id, input, actor));
  } catch (error) {
    return safeErrorResponse(error);
  }
}
