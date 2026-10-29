import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { requireWorkspaceContext } from '@/lib/api-helpers';
import { parseIdParams } from '@/lib/validations/params';
import { retrieveAcraCompliance } from '@/lib/external/acra-records';
import { routeErrorResponse } from '@/lib/api-route-errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await parseIdParams(params);
    const { searchParams } = new URL(request.url);
    const tenantResult = await requireWorkspaceContext(session, searchParams.get('tenantId'));
    if ('error' in tenantResult) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Check permission - need update permission since this is used to populate edit form
    await requirePermission(session, 'company', 'update', id);

    // Additional check for company access
    if (!(await canAccessCompany(session, id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get the company with tenant validation
    const company = await prisma.company.findUnique({
      where: { id, tenantId },
      select: {
        id: true,
        uen: true,
        entityType: true,
      },
    });

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Retrieve compliance data from the local ACRA records
    const compliance = await retrieveAcraCompliance(company.uen, company.entityType);

    if (!compliance) {
      return NextResponse.json(
        { error: 'Could not retrieve ACRA records for this company.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      financialYearEndDay: compliance.financialYearEndDay,
      financialYearEndMonth: compliance.financialYearEndMonth,
      lastArFiledDate: compliance.annualReturnDate,
      accountsDueDate: compliance.accountDueDate,
      dataAsOf: compliance.dataAsOf,
    });
  } catch (error) {
    return routeErrorResponse(error, { fallback: 'bad-request' });
  }
}
