import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { ApiError, ErrorCodes } from '@/lib/errors';
import { requirePermission } from '@/lib/rbac';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { deadlineHolidaySearchSchema } from '@/lib/validations/deadline';
import { requireServicesWorkspaceEnabled } from '@/services/schedule-reconciliation';
import { listWorkspaceHolidays } from '@/services/business-calendar';
import type { DateOnly } from '@/services/service-schedule';

/** Holidays for the deadline calendar; readable by anyone who can read deadlines. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'company', 'read');
    const tenantId = requireSessionWorkspaceId(session);
    await requireServicesWorkspaceEnabled(tenantId);

    const search = deadlineHolidaySearchSchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    return NextResponse.json(await listWorkspaceHolidays({ tenantId, from: search.from as DateOnly, to: search.to as DateOnly }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse(new ApiError(ErrorCodes.VALIDATION_ERROR, 'Invalid holiday request', 400, { issues: error.issues }));
    }
    return routeErrorResponse(error);
  }
}
