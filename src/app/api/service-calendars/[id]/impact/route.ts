import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { resolveWorkspaceId } from '@/lib/api-helpers';
import { requireServiceAdministrator } from '@/lib/service-administration-auth';
import { businessCalendarInputSchema } from '@/lib/validations/business-calendar';
import { idParamSchema, uuidSchema } from '@/lib/validations/params';
import { previewBusinessCalendarImpact } from '@/services/business-calendar';
import { businessCalendarErrorResponse, parseRequestTenantId, readJsonRecord, selectRequestTenantId } from '../../route-utils';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const { id } = idParamSchema.parse(await params);
    const rawBody = await readJsonRecord(request);
    const { searchParams } = new URL(request.url);
    const query = z.object({ tenantId: uuidSchema.optional() }).strict().parse(
      Object.fromEntries(searchParams.entries()),
    );
    const bodyTenantId = parseRequestTenantId(rawBody);
    const requestedTenantId = selectRequestTenantId(query.tenantId, bodyTenantId);
    const tenantId = resolveWorkspaceId(session, requestedTenantId ?? null);
    const { tenantId: _tenantId, ...payload } = rawBody;
    const input = businessCalendarInputSchema.parse(payload);
    const impact = await previewBusinessCalendarImpact(id, input, { tenantId, userId: session.id });
    return NextResponse.json(impact);
  } catch (error) {
    return businessCalendarErrorResponse(error, 'POST /api/service-calendars/[id]/impact');
  }
}
