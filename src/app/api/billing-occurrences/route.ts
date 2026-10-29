import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { getCompanyReadScope } from '@/lib/api/company-query';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { ApiError, ErrorCodes } from '@/lib/errors';
import { requirePermission } from '@/lib/rbac';
import { routeErrorResponse } from '@/lib/api-route-errors';
import {
  emptyBillingOccurrenceResult,
  parseBillingOccurrenceSearchParams,
} from '@/lib/validations/billing';
import { requireServicesWorkspaceEnabled } from '@/services/schedule-reconciliation';
import { listBillingOccurrences } from '@/services/billing';

function safeErrorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return createErrorResponse(new ApiError(
      ErrorCodes.VALIDATION_ERROR,
      'Invalid billing occurrence request',
      400,
      { issues: error.issues },
    ));
  }
  return routeErrorResponse(error);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'company', 'read');
    const tenantId = requireSessionWorkspaceId(session);
    await requireServicesWorkspaceEnabled(tenantId);
    const search = parseBillingOccurrenceSearchParams(request);
    const scope = getCompanyReadScope(session);
    if ('empty' in scope || scope.options.companyIds?.length === 0) {
      return NextResponse.json(emptyBillingOccurrenceResult(search));
    }
    return NextResponse.json(await listBillingOccurrences(search, {
      tenantId,
      companyIds: scope.options.companyIds,
    }));
  } catch (error) {
    return safeErrorResponse(error);
  }
}
