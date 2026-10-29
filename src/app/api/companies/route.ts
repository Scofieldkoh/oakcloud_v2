import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createCompanyRequestSchema, companySearchSchema } from '@/lib/validations/company';
import { createCompany, searchCompanies, getCompanyByUen } from '@/services/company.service';
import { migrateBizFileToProcessing } from '@/services/document-processing.service';
import { createLogger, sanitizeError } from '@/lib/logger';
import { createErrorResponse } from '@/lib/api-helpers';
import {
  parseTaskLaunchContext,
  preflightTaskLaunchContext,
  safelyLinkCompanyTaskOutcome,
} from '@/services/tasks/integration.service';

const log = createLogger('api:companies');

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check read permission
    await requirePermission(session, 'company', 'read');

    const { searchParams } = new URL(request.url);

    // Let Zod handle all parsing and validation - no manual parseInt or type casts
    const params = companySearchSchema.parse({
      query: searchParams.get('query') || undefined,
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

    // Company-scoped users can only see companies they have role assignments for
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      // Check if user has "All Companies" access (role with null companyId)
      if (session.hasAllCompaniesAccess && session.tenantId) {
        // User has a role for "All Companies" - return all companies in tenant
        const result = await searchCompanies(params, session.tenantId);
        return NextResponse.json(result);
      }

      if (session.companyIds && session.companyIds.length > 0 && session.tenantId) {
        // Return all companies the user has access to via role assignments
        const result = await searchCompanies(
          params,
          session.tenantId,
          { companyIds: session.companyIds }
        );
        return NextResponse.json(result);
      }
      // No company assigned - return empty
      return NextResponse.json({
        companies: [],
        total: 0,
        page: 1,
        limit: params.limit,
        totalPages: 0,
      });
    }

    const effectiveTenantId = session.tenantId;

    const result = await searchCompanies(
      params,
      effectiveTenantId,
      {}
    );

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check create permission
    await requirePermission(session, 'company', 'create');

    const body = await request.json();
    const taskContext = parseTaskLaunchContext(body.taskContext);
    const data = createCompanyRequestSchema.parse(body);

    const tenantId = session.tenantId;

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }
    if (taskContext) {
      await preflightTaskLaunchContext(
        tenantId,
        taskContext,
        'COMPANY_PROFILE',
        session,
      );
    }

    // Check if UEN already exists within tenant
    const existing = await getCompanyByUen(data.uen, tenantId, {});
    if (existing) {
      return NextResponse.json(
        { error: 'A company with this UEN already exists' },
        { status: 409 }
      );
    }

    const company = await createCompany(
      data,
      { tenantId, userId: session.id },
      taskContext,
    );
    if (taskContext) {
      await safelyLinkCompanyTaskOutcome({
        tenantId,
        context: taskContext,
        authoritativeId: company.id,
        userId: session.id,
        session,
      });
    }

    // If a bizfileDocumentId is provided, migrate it to the processing pipeline
    const bizfileDocumentId = body.bizfileDocumentId as string | undefined;
    if (bizfileDocumentId) {
      try {
        log.info(`Migrating BizFile document ${bizfileDocumentId} for company ${company.id}`);
        await migrateBizFileToProcessing(bizfileDocumentId, company.id, tenantId);
        log.info(`Successfully migrated BizFile document ${bizfileDocumentId}`);
      } catch (error) {
        // Log error but don't fail company creation
        log.error(`Failed to migrate BizFile document ${bizfileDocumentId}:`, sanitizeError(error));
        // Company is still created, but BizFile migration failed
        // User can manually retry or upload the document again
      }
    }

    return NextResponse.json(company, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
