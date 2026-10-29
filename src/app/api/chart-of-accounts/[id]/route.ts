/**
 * Chart of Accounts [id] API Routes
 *
 * GET    /api/chart-of-accounts/[id] - Get a single account
 * PATCH  /api/chart-of-accounts/[id] - Update an account
 * DELETE /api/chart-of-accounts/[id] - Soft delete an account
 *
 * Access: All authenticated users (read), TENANT_ADMIN (write)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import * as chartOfAccountsService from '@/services/chart-of-accounts.service';
import { updateAccountSchema } from '@/lib/validations/chart-of-accounts';
import { ZodError } from 'zod';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ============================================================================
// GET - Get single account
// ============================================================================

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check read permission
    await requirePermission(session, 'chart_of_accounts', 'read');

    const { id } = await params;
    const account = await chartOfAccountsService.getAccountById(id);

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Tenant isolation check for non-super admins
    if (!session.isSuperAdmin && account.tenantId && account.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(account);
  } catch (error) {
    console.error('Failed to get account:', error);
    return createErrorResponse(error);
  }
}

// ============================================================================
// PATCH - Update account
// ============================================================================

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check update permission
    await requirePermission(session, 'chart_of_accounts', 'update');

    const { id } = await params;

    // Get existing account to check ownership
    const existing = await chartOfAccountsService.getAccountById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Tenant isolation check for non-super admins
    if (!session.isSuperAdmin && existing.tenantId && existing.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // System accounts can only be edited by SUPER_ADMIN
    if (existing.isSystem && !session.isSuperAdmin) {
      return NextResponse.json(
        { error: 'System accounts can only be edited by Super Admin' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const data = updateAccountSchema.parse(body);

    const account = await chartOfAccountsService.updateAccount(id, data, {
      tenantId: session.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    });

    return NextResponse.json(account);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to update account:', error);
    return createErrorResponse(error);
  }
}

// ============================================================================
// DELETE - Soft delete account
// ============================================================================

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check delete permission
    await requirePermission(session, 'chart_of_accounts', 'delete');

    const { id } = await params;

    // Get existing account to check ownership
    const existing = await chartOfAccountsService.getAccountById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Tenant isolation check for non-super admins
    if (!session.isSuperAdmin && existing.tenantId && existing.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // System accounts can only be deleted by SUPER_ADMIN
    if (existing.isSystem && !session.isSuperAdmin) {
      return NextResponse.json(
        { error: 'System accounts can only be deleted by Super Admin' },
        { status: 403 }
      );
    }

    // Get reason from query params or body
    const { searchParams } = new URL(request.url);
    let reason = searchParams.get('reason');
    if (!reason) {
      try {
        const body = await request.json();
        reason = body.reason;
      } catch {
        // No body
      }
    }

    if (!reason || reason.length < 5) {
      return NextResponse.json(
        { error: 'Reason is required (minimum 5 characters)' },
        { status: 400 }
      );
    }

    await chartOfAccountsService.deleteAccount(id, reason, {
      tenantId: session.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete account:', error);
    return createErrorResponse(error);
  }
}
