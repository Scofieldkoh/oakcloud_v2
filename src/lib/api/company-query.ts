import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/auth';
import { companySearchSchema } from '@/lib/validations/company';
import type { CompanySearchInput } from '@/lib/validations/company';
import type { SearchCompaniesOptions } from '@/services/company.service';

export function parseCompanySearchParams(request: NextRequest): CompanySearchInput {
  const { searchParams } = new URL(request.url);

  return companySearchSchema.parse({
    query: searchParams.get('query') || searchParams.get('q') || undefined,
    uen: searchParams.get('uen') || undefined,
    address: searchParams.get('address') || undefined,
    hasWarnings: searchParams.get('hasWarnings')
      ? searchParams.get('hasWarnings') === 'true'
      : undefined,
    entityType: searchParams.get('entityType') || undefined,
    status: searchParams.get('status') || undefined,
    incorporationDateFrom: searchParams.get('incorporationDateFrom') || undefined,
    incorporationDateTo: searchParams.get('incorporationDateTo') || undefined,
    hasCharges: searchParams.get('hasCharges')
      ? searchParams.get('hasCharges') === 'true'
      : undefined,
    financialYearEndMonth: searchParams.get('financialYearEndMonth')
      ? Number(searchParams.get('financialYearEndMonth'))
      : undefined,
    homeCurrency: searchParams.get('homeCurrency') || undefined,
    paidUpCapitalMin: searchParams.get('paidUpCapitalMin')
      ? Number(searchParams.get('paidUpCapitalMin'))
      : undefined,
    paidUpCapitalMax: searchParams.get('paidUpCapitalMax')
      ? Number(searchParams.get('paidUpCapitalMax'))
      : undefined,
    issuedCapitalMin: searchParams.get('issuedCapitalMin')
      ? Number(searchParams.get('issuedCapitalMin'))
      : undefined,
    issuedCapitalMax: searchParams.get('issuedCapitalMax')
      ? Number(searchParams.get('issuedCapitalMax'))
      : undefined,
    officersMin: searchParams.get('officersMin')
      ? Number(searchParams.get('officersMin'))
      : undefined,
    officersMax: searchParams.get('officersMax')
      ? Number(searchParams.get('officersMax'))
      : undefined,
    shareholdersMin: searchParams.get('shareholdersMin')
      ? Number(searchParams.get('shareholdersMin'))
      : undefined,
    shareholdersMax: searchParams.get('shareholdersMax')
      ? Number(searchParams.get('shareholdersMax'))
      : undefined,
    page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
    limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
    sortBy: searchParams.get('sortBy') || undefined,
    sortOrder: searchParams.get('sortOrder') || undefined,
  });
}

export function getCompanyReadScope(
  session: SessionUser
): { tenantId: string | null; options: SearchCompaniesOptions } | { empty: true } {
  const tenantId = session.tenantId;

  if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
    if (session.hasAllCompaniesAccess && tenantId) {
      return { tenantId, options: {} };
    }

    if (session.companyIds?.length && tenantId) {
      return { tenantId, options: { companyIds: session.companyIds } };
    }

    return { empty: true };
  }

  return { tenantId, options: {} };
}

export function emptyCompanySearchResult(limit: number) {
  return {
    companies: [],
    total: 0,
    page: 1,
    limit,
    totalPages: 0,
  };
}

export function jsonWithServerTiming<T>(
  data: T,
  startedAt: number,
  init?: ResponseInit
) {
  return withServerTiming(NextResponse.json(data, init), startedAt);
}

/** Add response timing headers without recreating or changing an existing response. */
export function withServerTiming<T extends Response>(
  response: T,
  startedAt: number,
): T {
  const durationMs = Math.max(0, performance.now() - startedAt);
  response.headers.set('Server-Timing', `app;dur=${durationMs.toFixed(1)}`);
  response.headers.set('X-Response-Time-Ms', durationMs.toFixed(1));
  return response;
}
