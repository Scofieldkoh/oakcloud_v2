import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { ApiError, ErrorCodes, NotFoundError } from '@/lib/errors';
import { requirePermission } from '@/lib/rbac';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { requireServicesWorkspaceEnabled } from '@/services/schedule-reconciliation';
import { resetDeadlineDateOverrideSchema } from '@/lib/validations/deadline';
import {
  getDeadlineOccurrence,
  resetDeadlineDateOverride,
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

async function requireDeadlineCompanyUpdate(
  session: Awaited<ReturnType<typeof requireAuth>>,
  companyId: string,
): Promise<void> {
  try {
    await requirePermission(session, 'company', 'update', companyId);
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

export async function POST(request: NextRequest, { params }: Context): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    await requireServicesWorkspaceEnabled(tenantId);
    const { id: rawId } = await params;
    const id = deadlineIdSchema.parse(rawId);
    const actor = { tenantId, userId: session.id };
    const deadline = await getDeadlineOccurrence(id, actor);
    await requireDeadlineCompanyUpdate(session, deadline.companyId);
    const input = resetDeadlineDateOverrideSchema.parse(await request.json());
    return NextResponse.json(await resetDeadlineDateOverride(id, input, actor));
  } catch (error) {
    return safeErrorResponse(error);
  }
}
