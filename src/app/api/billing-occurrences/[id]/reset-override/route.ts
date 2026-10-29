import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { getCompanyReadScope } from '@/lib/api/company-query';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { ApiError, ErrorCodes, NotFoundError } from '@/lib/errors';
import { requirePermission } from '@/lib/rbac';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { requireServicesWorkspaceEnabled } from '@/services/schedule-reconciliation';
import { resetBillingOverrideSchema } from '@/lib/validations/billing';
import { getBillingOccurrence, resetBillingOverride } from '@/services/billing';

const billingOccurrenceIdSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

function safeErrorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) return createErrorResponse(new ApiError(ErrorCodes.VALIDATION_ERROR, 'Invalid billing occurrence request', 400, { issues: error.issues }));
  if (error instanceof SyntaxError) return createErrorResponse(new ApiError(ErrorCodes.VALIDATION_ERROR, 'Invalid JSON request', 400));
  return routeErrorResponse(error);
}

export async function POST(request: NextRequest, { params }: Context): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    const tenantId = requireSessionWorkspaceId(session);
    await requireServicesWorkspaceEnabled(tenantId);
    const id = billingOccurrenceIdSchema.parse((await params).id);
    const scope = getCompanyReadScope(session);
    const occurrence = await getBillingOccurrence(id, {
      tenantId,
      userId: session.id,
      companyIds: 'empty' in scope ? [] : scope.options.companyIds,
    });
    try {
      await requirePermission(session, 'company', 'update', occurrence.companyId);
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCodes.PERMISSION_DENIED) throw new NotFoundError('Billing occurrence not found');
      if (error instanceof Error && (error.message === 'Forbidden' || error.message.startsWith('Permission denied'))) throw new NotFoundError('Billing occurrence not found');
      throw error;
    }
    const input = resetBillingOverrideSchema.parse(await request.json());
    return NextResponse.json(await resetBillingOverride(id, input, { tenantId, userId: session.id, companyIds: 'empty' in scope ? [] : scope.options.companyIds }));
  } catch (error) {
    return safeErrorResponse(error);
  }
}
