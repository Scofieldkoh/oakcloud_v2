/**
 * Company Account Mappings API Routes
 *
 * GET  /api/companies/[id]/account-mappings - Get all account mappings for a company
 * POST /api/companies/[id]/account-mappings - Create or update account mappings (bulk upsert)
 *
 * Access: TENANT_ADMIN, COMPANY_ADMIN (for their company)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { parseIdParams } from '@/lib/validations/params';
import { prisma } from '@/lib/prisma';
import { createErrorResponse, requireWorkspaceContext } from '@/lib/api-helpers';
import * as chartOfAccountsService from '@/services/chart-of-accounts.service';
import { accountingProviderSchema, bulkMappingSchema } from '@/lib/validations/chart-of-accounts';
import { ZodError } from 'zod';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ============================================================================
// GET - Get all account mappings for a company
// ============================================================================

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId } = await parseIdParams(params);
    const { searchParams } = new URL(request.url);
    const tenantResult = await requireWorkspaceContext(session, searchParams.get('tenantId'));
    if ('error' in tenantResult) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Check permission
    await requirePermission(session, 'chart_of_accounts', 'read', companyId);

    // Additional check for company-scoped users
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verify company exists and belongs to the current workspace.
    const company = await prisma.company.findUnique({
      where: { id: companyId, tenantId },
      select: { id: true },
    });

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Get optional provider filter
    const providerParam = searchParams.get('provider');
    let provider: 'XERO' | 'QUICKBOOKS' | 'MYOB' | 'SAGE' | undefined;

    if (providerParam) {
      const result = accountingProviderSchema.safeParse(providerParam);
      if (result.success) {
        provider = result.data;
      }
    }

    const mappings = await chartOfAccountsService.getCompanyMappings(companyId, provider);

    return NextResponse.json(mappings);
  } catch (error) {
    console.error('Failed to get company account mappings:', error);
    return createErrorResponse(error);
  }
}

// ============================================================================
// POST - Bulk upsert account mappings for a company
// ============================================================================

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId } = await parseIdParams(params);
    const { searchParams } = new URL(request.url);

    // Check permission - need update permission for mappings
    await requirePermission(session, 'chart_of_accounts', 'update', companyId);

    // Additional check for company access
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verify company exists and get tenantId
    const body = await request.json();
    const tenantResult = await requireWorkspaceContext(
      session,
      typeof body.tenantId === 'string' ? body.tenantId : searchParams.get('tenantId')
    );
    if ('error' in tenantResult) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    const company = await prisma.company.findUnique({
      where: { id: companyId, tenantId },
      select: { id: true, tenantId: true },
    });

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const data = bulkMappingSchema.parse({
      ...body,
      companyId, // Use companyId from URL params
    });

    const results = await chartOfAccountsService.bulkUpsertMappings(
      {
        companyId: data.companyId,
        provider: data.provider,
        mappings: data.mappings,
      },
      {
        tenantId: company.tenantId,
        userId: session.id,
        isSuperAdmin: session.isSuperAdmin,
      }
    );

    return NextResponse.json({
      success: true,
      created: results.created,
      updated: results.updated,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to update company account mappings:', error);
    return createErrorResponse(error);
  }
}
