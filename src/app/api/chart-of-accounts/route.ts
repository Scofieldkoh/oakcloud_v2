/**
 * Chart of Accounts API Routes
 *
 * GET  /api/chart-of-accounts - List accounts with filters
 * POST /api/chart-of-accounts - Create a new account
 *
 * Access: All authenticated users (read), TENANT_ADMIN (write)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import * as chartOfAccountsService from '@/services/chart-of-accounts.service';
import { accountSearchSchema, createAccountSchema } from '@/lib/validations/chart-of-accounts';
import { ZodError } from 'zod';

// ============================================================================
// GET - List chart of accounts
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check read permission
    await requirePermission(session, 'chart_of_accounts', 'read');

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const params = accountSearchSchema.parse({
      search: searchParams.get('search') || undefined,
      accountType: searchParams.get('accountType') || undefined,
      status: searchParams.get('status') || undefined,
      tenantId: session.isSuperAdmin
        ? searchParams.get('tenantId') || undefined
        : session.tenantId,
      companyId: searchParams.get('companyId') || undefined,
      includeSystem: searchParams.get('includeSystem') !== 'false',
      parentId: searchParams.get('parentId') || undefined,
      topLevelOnly: searchParams.get('topLevelOnly') === 'true',
      page: searchParams.get('page') || 1,
      limit: searchParams.get('limit') || 50,
      sortBy: searchParams.get('sortBy') || 'sortOrder',
      sortOrder: searchParams.get('sortOrder') || 'asc',
    });

    // For non-super admins, ensure tenant isolation
    if (!session.isSuperAdmin && !params.tenantId) {
      params.tenantId = session.tenantId;
    }

    const result = await chartOfAccountsService.getAccounts(params);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to list chart of accounts:', error);
    return createErrorResponse(error);
  }
}

// ============================================================================
// POST - Create new account
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check create permission
    await requirePermission(session, 'chart_of_accounts', 'create');

    const body = await request.json();

    // For non-super admins, force tenant ID to their tenant
    if (!session.isSuperAdmin) {
      body.tenantId = session.tenantId;
    }

    const data = createAccountSchema.parse(body);

    const account = await chartOfAccountsService.createAccount(data, {
      tenantId: session.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    });

    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to create chart of account:', error);
    return createErrorResponse(error);
  }
}
