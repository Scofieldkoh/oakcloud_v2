/**
 * Chart of Accounts Hierarchy API Route
 *
 * GET /api/chart-of-accounts/hierarchy - Get accounts in hierarchical tree structure
 *
 * Access: All authenticated users
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import * as chartOfAccountsService from '@/services/chart-of-accounts.service';
import { accountHierarchySchema } from '@/lib/validations/chart-of-accounts';
import { ZodError } from 'zod';

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check read permission
    await requirePermission(session, 'chart_of_accounts', 'read');

    const { searchParams } = new URL(request.url);
    const params = accountHierarchySchema.parse({
      tenantId: searchParams.get('tenantId') || (session.isSuperAdmin ? undefined : session.tenantId),
      companyId: searchParams.get('companyId') || undefined,
      includeSystem: searchParams.get('includeSystem') || 'true',
      accountType: searchParams.get('accountType') || undefined,
      status: searchParams.get('status') || 'ACTIVE',
    });

    // Non-super admins can only access their tenant's accounts
    if (!session.isSuperAdmin) {
      params.tenantId = session.tenantId;
    }

    const hierarchy = await chartOfAccountsService.getAccountHierarchy(
      params.tenantId,
      params.companyId,
      params.includeSystem,
      params.accountType,
      params.status
    );

    return NextResponse.json(hierarchy);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to get account hierarchy:', error);
    return createErrorResponse(error);
  }
}
