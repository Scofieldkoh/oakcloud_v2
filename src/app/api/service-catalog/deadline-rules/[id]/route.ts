import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { resolveWorkspaceId } from '@/lib/api-helpers';
import { requireServiceAdministrator } from '@/lib/service-administration-auth';
import { idParamSchema, uuidSchema } from '@/lib/validations/params';
import { deadlineRuleDraftSchema } from '@/lib/validations/deadline-rule';
import {
  getDeadlineRule,
  updateDeadlineRuleDraft,
} from '@/services/deadline-rule';
import {
  parseRequestTenantId,
  readJsonRecord,
  selectRequestTenantId,
  serviceCatalogErrorResponse,
} from '../../route-utils';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseTenantQuery(request: NextRequest): string | undefined {
  const { searchParams } = new URL(request.url);
  return z.object({ tenantId: uuidSchema.optional() }).strict().parse({
    tenantId: searchParams.get('tenantId') ?? undefined,
  }).tenantId;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const { id } = idParamSchema.parse(await params);
    const tenantId = resolveWorkspaceId(session, parseTenantQuery(request) ?? null);
    const rule = await getDeadlineRule(id, { tenantId, userId: session.id });
    return NextResponse.json(rule);
  } catch (error) {
    return serviceCatalogErrorResponse(error, 'GET /api/service-catalog/deadline-rules/[id]');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const { id } = idParamSchema.parse(await params);
    const queryTenantId = parseTenantQuery(request);
    const body = await readJsonRecord(request);
    const bodyTenantId = parseRequestTenantId(body);
    const tenantId = resolveWorkspaceId(
      session,
      selectRequestTenantId(queryTenantId, bodyTenantId) ?? null,
    );
    const { tenantId: _tenantId, ...payload } = body;
    const input = deadlineRuleDraftSchema.parse(payload);
    const rule = await updateDeadlineRuleDraft(id, input, { tenantId, userId: session.id });
    return NextResponse.json(rule);
  } catch (error) {
    return serviceCatalogErrorResponse(error, 'PATCH /api/service-catalog/deadline-rules/[id]');
  }
}
