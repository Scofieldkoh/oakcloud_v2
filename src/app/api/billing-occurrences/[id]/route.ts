import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { getCompanyReadScope } from '@/lib/api/company-query';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { ApiError, ErrorCodes, NotFoundError } from '@/lib/errors';
import { requirePermission } from '@/lib/rbac';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { requireServicesWorkspaceEnabled } from '@/services/schedule-reconciliation';
import { updateBillingOccurrenceSchema } from '@/lib/validations/billing';
import {
  getBillingOccurrence,
  updateBillingOccurrence,
} from '@/services/billing';

const billingOccurrenceIdSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

function safeErrorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return createErrorResponse(new ApiError(ErrorCodes.VALIDATION_ERROR, 'Invalid billing occurrence request', 400, { issues: error.issues }));
  }
  if (error instanceof SyntaxError) return createErrorResponse(new ApiError(ErrorCodes.VALIDATION_ERROR, 'Invalid JSON request', 400));
  return routeErrorResponse(error);
}

function companyIdsForSession(session: Awaited<ReturnType<typeof requireAuth>>): string[] | undefined {
  const scope = getCompanyReadScope(session);
  return 'empty' in scope ? [] : scope.options.companyIds;
}

async function requireCompanyPermission(
  session: Awaited<ReturnType<typeof requireAuth>>,
  action: 'read' | 'update',
  companyId: string,
): Promise<void> {
  try {
    await requirePermission(session, 'company', action, companyId);
  } catch (error) {
    if (error instanceof ApiError && error.code === ErrorCodes.PERMISSION_DENIED) throw new NotFoundError('Billing occurrence not found');
    if (error instanceof Error && (error.message === 'Forbidden' || error.message.startsWith('Permission denied'))) {
      throw new NotFoundError('Billing occurrence not found');
    }
    throw error;
  }
}

async function loadForSession(id: string, session: Awaited<ReturnType<typeof requireAuth>>) {
  const tenantId = requireSessionWorkspaceId(session);
  await requireServicesWorkspaceEnabled(tenantId);
  const occurrence = await getBillingOccurrence(id, {
    tenantId,
    userId: session.id,
    companyIds: companyIdsForSession(session),
  });
  return { tenantId, occurrence };
}

export async function GET(_request: NextRequest, { params }: Context): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const id = billingOccurrenceIdSchema.parse((await params).id);
    const { occurrence } = await loadForSession(id, session);
    await requireCompanyPermission(session, 'read', occurrence.companyId);
    return NextResponse.json(occurrence);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Context): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const id = billingOccurrenceIdSchema.parse((await params).id);
    const { tenantId, occurrence } = await loadForSession(id, session);
    await requireCompanyPermission(session, 'update', occurrence.companyId);
    const input = updateBillingOccurrenceSchema.parse(await request.json());
    return NextResponse.json(await updateBillingOccurrence(id, input, {
      tenantId,
      userId: session.id,
      companyIds: companyIdsForSession(session),
    }));
  } catch (error) {
    return safeErrorResponse(error);
  }
}
