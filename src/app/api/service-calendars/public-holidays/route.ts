/**
 * Official public holiday source (MOM via data.gov.sg)
 *
 * GET  /api/service-calendars/public-holidays - source status for the Business Calendar page
 * POST /api/service-calendars/public-holidays - check for updates now (forced refresh), then
 *      synchronize business calendars from the local copy
 *
 * All data.gov.sg requests are made by the server. The response only reports
 * the calling workspace's calendars.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { resolveWorkspaceId } from '@/lib/api-helpers';
import { requireServiceAdministrator } from '@/lib/service-administration-auth';
import { uuidSchema } from '@/lib/validations/params';
import {
  getPublicHolidaySourceStatus,
  syncPublicHolidaysIfUpdated,
} from '@/services/public-holiday-sync.service';
import { businessCalendarErrorResponse } from '../route-utils';

function resolveTenant(request: NextRequest, session: Awaited<ReturnType<typeof requireAuth>>): string {
  const { searchParams } = new URL(request.url);
  const query = z.object({ tenantId: uuidSchema.optional() }).strict().parse(
    Object.fromEntries(searchParams.entries()),
  );
  return resolveWorkspaceId(session, query.tenantId ?? null);
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    resolveTenant(request, session);
    return NextResponse.json(await getPublicHolidaySourceStatus());
  } catch (error) {
    return businessCalendarErrorResponse(error, 'GET /api/service-calendars/public-holidays');
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const tenantId = resolveTenant(request, session);
    const { calendarResults: _calendarResults, ...result } = await syncPublicHolidaysIfUpdated({
      force: true,
      reportTenantId: tenantId,
    });
    const status = await getPublicHolidaySourceStatus();
    return NextResponse.json({ result, status });
  } catch (error) {
    return businessCalendarErrorResponse(error, 'POST /api/service-calendars/public-holidays');
  }
}
