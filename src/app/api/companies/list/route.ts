import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { parseCompanySearchParams, getCompanyReadScope, emptyCompanySearchResult, jsonWithServerTiming } from '@/lib/api/company-query';
import { searchCompanies } from '@/services/company.service';
import { createErrorResponse } from '@/lib/api-helpers';

export async function GET(request: NextRequest) {
  const startedAt = performance.now();

  try {
    const session = await requireAuth();
    await requirePermission(session, 'company', 'read');

    const params = parseCompanySearchParams(request);
    const scope = getCompanyReadScope(session);

    if ('empty' in scope) {
      return jsonWithServerTiming(emptyCompanySearchResult(params.limit), startedAt);
    }

    const result = await searchCompanies(params, scope.tenantId, scope.options);
    return jsonWithServerTiming(result, startedAt);
  } catch (error) {
    return createErrorResponse(error);
  }
}
