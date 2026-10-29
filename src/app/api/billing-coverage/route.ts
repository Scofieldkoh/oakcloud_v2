import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { getCompanyReadScope } from '@/lib/api/company-query';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { ApiError, ErrorCodes } from '@/lib/errors';
import { requireServicesWorkspaceEnabled } from '@/services/schedule-reconciliation';
import {
  listBillingCoverage,
  type BillingCoverageIssueSeverity,
  type BillingCoverageIssueType,
} from '@/services/billing';

const issueTypes = new Set<BillingCoverageIssueType>([
  'MISSING_DISPOSITION',
  'MISSING_FEE_LINES',
  'MISSING_START_DATE',
  'INVALID_CUSTOM_SCHEDULE',
  'MISSING_SCHEDULE_PARAMETER',
  'OCCURRENCE_GAP',
  'INVALID_AMOUNT_OR_CURRENCY',
]);
const severities = new Set<BillingCoverageIssueSeverity>(['ERROR', 'WARNING']);

function csvParam(request: NextRequest, key: string): string[] | undefined {
  const value = request.nextUrl.searchParams.get(key);
  if (value === null) return undefined;
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function parseFilters(request: NextRequest) {
  const companyIds = csvParam(request, 'companyIds');
  const types = csvParam(request, 'types');
  const severity = csvParam(request, 'severity') ?? csvParam(request, 'severities');
  if (types?.some((type) => !issueTypes.has(type as BillingCoverageIssueType))) {
    throw new z.ZodError([{ code: 'custom', path: ['types'], message: 'Invalid billing coverage issue type' }]);
  }
  if (severity?.some((value) => !severities.has(value as BillingCoverageIssueSeverity))) {
    throw new z.ZodError([{ code: 'custom', path: ['severity'], message: 'Invalid billing coverage severity' }]);
  }
  return {
    companyIds,
    types: types as BillingCoverageIssueType[] | undefined,
    severities: severity as BillingCoverageIssueSeverity[] | undefined,
  };
}

function emptySummary() {
  return { openIssueCount: 0, affectedServiceCount: 0, healthyActiveServiceCount: 0, issues: [] };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'company', 'read');
    const tenantId = requireSessionWorkspaceId(session);
    await requireServicesWorkspaceEnabled(tenantId);
    const scope = getCompanyReadScope(session);
    if ('empty' in scope || scope.options.companyIds?.length === 0) {
      return NextResponse.json(emptySummary());
    }
    const filters = parseFilters(request);
    const requestedCompanyIds = filters.companyIds;
    const accessibleCompanyIds = scope.options.companyIds;
    const companyIds = requestedCompanyIds === undefined
      ? accessibleCompanyIds
      : accessibleCompanyIds === undefined
        ? requestedCompanyIds
        : requestedCompanyIds.filter((companyId) => accessibleCompanyIds.includes(companyId));
    if (companyIds?.length === 0) return NextResponse.json(emptySummary());
    return NextResponse.json(await listBillingCoverage({
      tenantId,
      ...filters,
      companyIds,
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse(new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid billing coverage filters',
        400,
        { issues: error.issues },
      ));
    }
    return createErrorResponse(error);
  }
}
