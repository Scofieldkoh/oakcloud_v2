import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { resolveWorkspaceId } from '@/lib/api-helpers';
import { requireServiceAdministrator } from '@/lib/service-administration-auth';
import { idParamSchema } from '@/lib/validations/params';
import {
  deadlineRulePublishSchema,
  publishDeadlineRule,
} from '@/services/deadline-rule';
import {
  parseRequestTenantId,
  parseStrictTenantQuery,
  readJsonRecord,
  selectRequestTenantId,
  serviceCatalogErrorResponse,
} from '../../../route-utils';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const { id } = idParamSchema.parse(await params);
    const queryTenantId = parseStrictTenantQuery(request);
    const body = await readJsonRecord(request);
    const bodyTenantId = parseRequestTenantId(body);
    const tenantId = resolveWorkspaceId(session, selectRequestTenantId(queryTenantId, bodyTenantId) ?? null);
    const { tenantId: _tenantId, ...payload } = body;
    const input = deadlineRulePublishSchema.parse(payload);
    const rule = await publishDeadlineRule(id, input, { tenantId, userId: session.id });
    return NextResponse.json(rule);
  } catch (error) {
    return serviceCatalogErrorResponse(error, 'POST /api/service-catalog/deadline-rules/[id]/publish');
  }
}
