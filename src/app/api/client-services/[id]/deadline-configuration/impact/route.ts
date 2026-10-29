import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { requirePermission } from '@/lib/rbac';
import { clientServiceDeadlineImpactSchema } from '@/lib/validations/client-service';
import { getClientService, previewClientServiceDeadlineConfiguration } from '@/services/client-service';

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();
const emptyQuerySchema = z.object({}).strict();

function parseStrictEmptyQuery(request: NextRequest): void {
  const entries = [...request.nextUrl.searchParams.entries()];
  const query: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      throw new ValidationError(`Duplicate query parameter "${key}"`);
    }
    query[key] = value;
  }
  emptyQuerySchema.parse(query);
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const session = await requireAuth();
    const { id: rawId } = await params;
    const id = idSchema.parse(rawId);
    parseStrictEmptyQuery(request);
    const actor = {
      tenantId: requireSessionWorkspaceId(session),
      userId: session.id,
      accessibleCompanyIds: session.hasAllCompaniesAccess || session.isSuperAdmin ? undefined : session.companyIds ?? [],
      allCompaniesAccess: session.hasAllCompaniesAccess || session.isSuperAdmin,
    };
    const service = await getClientService(id, actor);
    await requirePermission(session, 'company', 'update', service.companyId);
    const body = await request.json().catch(() => {
      throw new ValidationError('Request body must be valid JSON');
    });
    const input = clientServiceDeadlineImpactSchema.parse(body);
    const impact = await previewClientServiceDeadlineConfiguration(id, input, actor);
    if (!impact.previewFingerprint) throw new ValidationError('Impact preview did not produce a fingerprint');
    return NextResponse.json(impact);
  } catch (error) {
    return createErrorResponse(error);
  }
}
