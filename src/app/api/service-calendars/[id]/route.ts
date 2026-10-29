import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { resolveWorkspaceId } from '@/lib/api-helpers';
import { requireServiceAdministrator } from '@/lib/service-administration-auth';
import { businessCalendarUpdateSchema } from '@/lib/validations/business-calendar';
import { idParamSchema, uuidSchema } from '@/lib/validations/params';
import {
  getBusinessCalendar,
  updateBusinessCalendar,
} from '@/services/business-calendar';
import { businessCalendarErrorResponse, parseRequestTenantId, readJsonRecord, selectRequestTenantId } from '../route-utils';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const { id } = idParamSchema.parse(await params);
    const { searchParams } = new URL(request.url);
    const query = z.object({ tenantId: uuidSchema.optional() }).strict().parse(
      Object.fromEntries(searchParams.entries()),
    );
    const tenantId = resolveWorkspaceId(session, query.tenantId ?? null);
    const calendar = await getBusinessCalendar(id, { tenantId, userId: session.id });
    return NextResponse.json(calendar);
  } catch (error) {
    return businessCalendarErrorResponse(error, 'GET /api/service-calendars/[id]');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const { id } = idParamSchema.parse(await params);
    const rawBody = await readJsonRecord(request);
    const { searchParams } = new URL(request.url);
    const query = z.object({ tenantId: uuidSchema.optional() }).strict().parse(
      Object.fromEntries(searchParams.entries()),
    );
    const requestedTenantId = selectRequestTenantId(query.tenantId, parseRequestTenantId(rawBody));
    const tenantId = resolveWorkspaceId(session, requestedTenantId ?? null);
    const { tenantId: _tenantId, ...payload } = rawBody;
    const input = businessCalendarUpdateSchema.parse(payload);
    const calendar = await updateBusinessCalendar(id, input, { tenantId, userId: session.id });
    return NextResponse.json(calendar);
  } catch (error) {
    return businessCalendarErrorResponse(error, 'PATCH /api/service-calendars/[id]');
  }
}
