/**
 * Company Account Mapping [mappingId] API Routes
 *
 * GET    /api/companies/[id]/account-mappings/[mappingId] - Get a single mapping
 * PATCH  /api/companies/[id]/account-mappings/[mappingId] - Update a mapping
 * DELETE /api/companies/[id]/account-mappings/[mappingId] - Delete a mapping
 *
 * Access: TENANT_ADMIN, COMPANY_ADMIN (for their company)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import * as chartOfAccountsService from '@/services/chart-of-accounts.service';
import { updateAccountMappingSchema } from '@/lib/validations/chart-of-accounts';
import { ZodError, z } from 'zod';

interface RouteParams {
  params: Promise<{ id: string; mappingId: string }>;
}

const paramsSchema = z.object({
  id: z.string().uuid('Invalid company ID'),
  mappingId: z.string().uuid('Invalid mapping ID'),
});

// ============================================================================
// GET - Get a single mapping
// ============================================================================

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId, mappingId } = paramsSchema.parse(await params);

    // Check permission
    await requirePermission(session, 'chart_of_accounts', 'read', companyId);

    // Additional check for company-scoped users
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get mapping and verify it belongs to the company
    const mapping = await prisma.chartOfAccountsMapping.findUnique({
      where: { id: mappingId },
      include: {
        account: {
          select: {
            id: true,
            code: true,
            name: true,
            accountType: true,
          },
        },
      },
    });

    if (!mapping) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    if (mapping.companyId !== companyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(mapping);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to get account mapping:', error);
    return createErrorResponse(error);
  }
}

// ============================================================================
// PATCH - Update a mapping
// ============================================================================

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId, mappingId } = paramsSchema.parse(await params);

    // Check permission
    await requirePermission(session, 'chart_of_accounts', 'update', companyId);

    // Additional check for company-scoped users
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin && !(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get mapping and verify it belongs to the company
    const existing = await prisma.chartOfAccountsMapping.findUnique({
      where: { id: mappingId },
      include: {
        company: {
          select: { tenantId: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    if (existing.companyId !== companyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Tenant isolation check
    if (!session.isSuperAdmin && existing.company.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const data = updateAccountMappingSchema.parse(body);

    const mapping = await prisma.chartOfAccountsMapping.update({
      where: { id: mappingId },
      data: {
        externalCode: data.externalCode,
        externalId: data.externalId,
        externalName: data.externalName,
        updatedAt: new Date(),
      },
      include: {
        account: {
          select: {
            id: true,
            code: true,
            name: true,
            accountType: true,
          },
        },
      },
    });

    return NextResponse.json(mapping);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to update account mapping:', error);
    return createErrorResponse(error);
  }
}

// ============================================================================
// DELETE - Delete a mapping
// ============================================================================

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId, mappingId } = paramsSchema.parse(await params);

    // Check permission
    await requirePermission(session, 'chart_of_accounts', 'delete', companyId);

    // Additional check for company-scoped users
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin && !(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get mapping and verify it belongs to the company
    const existing = await prisma.chartOfAccountsMapping.findUnique({
      where: { id: mappingId },
      include: {
        company: {
          select: { tenantId: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    if (existing.companyId !== companyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Tenant isolation check
    if (!session.isSuperAdmin && existing.company.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await chartOfAccountsService.deleteAccountMapping(mappingId, {
      tenantId: existing.company.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Failed to delete account mapping:', error);
    return createErrorResponse(error);
  }
}
