import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { resolveWorkspaceId } from '@/lib/api-helpers';
import { requireServiceAdministrator } from '@/lib/service-administration-auth';
import { idParamSchema } from '@/lib/validations/params';
import { stageDeadlineRulePreset } from '@/services/deadline-rule';
import {
  parseRequestTenantId,
  parseStrictTenantQuery,
  readJsonRecord,
  selectRequestTenantId,
  serviceCatalogErrorResponse,
} from '../../../route-utils';

type RouteParams = { params: Promise<{ id: string }> };

const stagePresetSchema = z.object({
  expectedDraftRevision: z.number().int().min(1).optional(),
}).strict();

/** Stage the reviewed IRAS preset as the rule's draft; publishing stays separate. */
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
    const input = stagePresetSchema.parse(payload);
    const rule = await stageDeadlineRulePreset(id, input, { tenantId, userId: session.id });
    return NextResponse.json(rule);
  } catch (error) {
    return serviceCatalogErrorResponse(error, 'POST /api/service-catalog/deadline-rules/[id]/preset');
  }
}
