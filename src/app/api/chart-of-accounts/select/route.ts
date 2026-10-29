/**
 * Chart of Accounts Select API Route
 *
 * GET /api/chart-of-accounts/select - Get simplified account list for dropdown selects
 *
 * Access: All authenticated users
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import * as chartOfAccountsService from '@/services/chart-of-accounts.service';
import { accountSelectSchema } from '@/lib/validations/chart-of-accounts';
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
    const params = accountSelectSchema.parse({
      tenantId: searchParams.get('tenantId') || (session.isSuperAdmin ? undefined : session.tenantId),
      companyId: searchParams.get('companyId') || undefined,
      accountType: searchParams.get('accountType') || undefined,
      headersOnly: searchParams.get('headersOnly') || undefined,
    });

    // Non-super admins can only access their tenant's accounts
    if (!session.isSuperAdmin) {
      params.tenantId = session.tenantId;
    }

    const accounts = await chartOfAccountsService.getAccountsForSelect(
      params.tenantId,
      params.companyId,
      params.accountType,
      false, // includeHeaders
      params.headersOnly // headersOnly - for parent account selection
    );

    return NextResponse.json(accounts);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to get accounts for select:', error);
    return createErrorResponse(error);
  }
}
