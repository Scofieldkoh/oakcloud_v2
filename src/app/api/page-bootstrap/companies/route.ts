import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import {
  parseCompanySearchParams,
  getCompanyReadScope,
  emptyCompanySearchResult,
  jsonWithServerTiming,
} from '@/lib/api/company-query';
import { getUserPreferenceMap } from '@/lib/api/preferences';
import { searchCompanies, getCompanyStats } from '@/services/company.service';
import { routeErrorResponse } from '@/lib/api-route-errors';

function parsePreferenceKeys(request: NextRequest) {
  const keys = new URL(request.url).searchParams.get('preferenceKeys');
  return keys?.split(',').map((key) => key.trim()).filter(Boolean) ?? [];
}

export async function GET(request: NextRequest) {
  const startedAt = performance.now();

  try {
    const session = await requireAuth();
    await requirePermission(session, 'company', 'read');

    const params = parseCompanySearchParams(request);
    const scope = getCompanyReadScope(session);
    const preferencesPromise = getUserPreferenceMap(session.id, parsePreferenceKeys(request));

    if ('empty' in scope) {
      const preferences = await preferencesPromise;
      return jsonWithServerTiming(
        {
          companies: emptyCompanySearchResult(params.limit),
          stats: null,
          preferences,
        },
        startedAt
      );
    }

    const statsPromise = session.isSuperAdmin || session.isWorkspaceAdmin
      ? getCompanyStats(scope.tenantId, scope.options)
      : Promise.resolve(null);

    const [companies, stats, preferences] = await Promise.all([
      searchCompanies(params, scope.tenantId, scope.options),
      statsPromise,
      preferencesPromise,
    ]);

    return jsonWithServerTiming({ companies, stats, preferences }, startedAt);
  } catch (error) {
    return routeErrorResponse(error, {
      notFound: 'any',
      fallback: 'bad-request',
      logLabel: 'GET /page-bootstrap/companies failed',
    });
  }
}
