import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { resolveWorkspaceId } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { requireServiceAdministrator } from '@/lib/service-administration-auth';
import { uuidSchema } from '@/lib/validations/params';
import {
  deadlineRuleDraftSchema,
  searchDeadlineRulesSchema,
} from '@/lib/validations/deadline-rule';
import {
  createDeadlineRule,
  listDeadlineRules,
} from '@/services/deadline-rule';
import {
  parseRequestTenantId,
  readJsonRecord,
  selectRequestTenantId,
  serviceCatalogErrorResponse,
} from '../route-utils';

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ValidationError('Boolean query parameters must be true or false');
}

function parseTenantQuery(request: NextRequest): string | undefined {
  const { searchParams } = new URL(request.url);
  return z.object({ tenantId: uuidSchema.optional() }).strict().parse({
    tenantId: searchParams.get('tenantId') ?? undefined,
  }).tenantId;
}

function parseRulesQuery(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return searchDeadlineRulesSchema.parse({
    query: searchParams.get('query') ?? undefined,
    isActive: parseBoolean(searchParams.get('isActive')),
    includeArchived: parseBoolean(searchParams.get('includeArchived')) ?? false,
    page: searchParams.has('page') ? Number(searchParams.get('page')) : undefined,
    limit: searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined,
    sortBy: searchParams.get('sortBy') ?? undefined,
    sortOrder: searchParams.get('sortOrder') ?? undefined,
  });
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const tenantId = resolveWorkspaceId(session, parseTenantQuery(request) ?? null);
    const result = await listDeadlineRules(parseRulesQuery(request), {
      tenantId,
      userId: session.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return serviceCatalogErrorResponse(error, 'GET /api/service-catalog/deadline-rules');
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    requireServiceAdministrator(session);
    const queryTenantId = parseTenantQuery(request);
    const body = await readJsonRecord(request);
    const bodyTenantId = parseRequestTenantId(body);
    const tenantId = resolveWorkspaceId(
      session,
      selectRequestTenantId(queryTenantId, bodyTenantId) ?? null,
    );
    const { tenantId: _tenantId, ...payload } = body;
    const input = deadlineRuleDraftSchema.parse(payload);
    const rule = await createDeadlineRule(input, { tenantId, userId: session.id });
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    return serviceCatalogErrorResponse(error, 'POST /api/service-catalog/deadline-rules');
  }
}
