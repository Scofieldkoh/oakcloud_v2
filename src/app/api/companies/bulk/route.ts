import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { routeErrorResponse } from '@/lib/api-route-errors';

/**
 * DELETE /api/companies/bulk
 *
 * Bulk delete multiple companies at once.
 * All companies must belong to the user's tenant.
 * User must have delete permission for all companies.
 *
 * Request body:
 * - ids: string[] - Array of company IDs to delete
 * - reason: string - Reason for deletion (required)
 *
 * Permissions:
 * - TENANT_ADMIN or user with company:delete permission
 * - SUPER_ADMIN can delete any company
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Parse request body
    const body = await request.json();
    const { ids, reason } = body as { ids: string[]; reason: string };

    // Validate input
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: 'ids array is required and must not be empty' },
        { status: 400 }
      );
    }

    if (!reason || reason.trim().length < 10) {
      return NextResponse.json(
        { error: 'Reason is required and must be at least 10 characters' },
        { status: 400 }
      );
    }

    if (ids.length > 100) {
      return NextResponse.json(
        { error: 'Cannot delete more than 100 companies at once' },
        { status: 400 }
      );
    }

    // Get all companies to verify ownership and check permissions
    const companies = await prisma.company.findMany({
      where: {
        id: { in: ids },
        deletedAt: null, // Only active companies
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        uen: true,
      },
    });

    // Check if all companies were found
    if (companies.length !== ids.length) {
      const foundIds = new Set(companies.map((c) => c.id));
      const notFound = ids.filter((id) => !foundIds.has(id));
      return NextResponse.json(
        { error: `Some companies not found: ${notFound.join(', ')}` },
        { status: 404 }
      );
    }

    // Check tenant access for all companies
    if (!session.isSuperAdmin) {
      const wrongTenantCompanies = companies.filter((c) => c.tenantId !== session.tenantId);
      if (wrongTenantCompanies.length > 0) {
        return NextResponse.json(
          { error: 'You do not have permission to delete some of these companies' },
          { status: 403 }
        );
      }

      // Check company-level access for company-scoped users
      for (const company of companies) {
        if (!(await canAccessCompany(session, company.id))) {
          return NextResponse.json(
            { error: `You do not have access to company "${company.name}"` },
            { status: 403 }
          );
        }
      }
    }

    // Check delete permission
    // For bulk operations, we require tenant-level delete permission
    try {
      await requirePermission(session, 'company', 'delete');
    } catch {
      return NextResponse.json(
        { error: 'You do not have permission to delete companies' },
        { status: 403 }
      );
    }

    // Perform soft delete in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Soft delete all companies
      await tx.company.updateMany({
        where: { id: { in: ids } },
        data: {
          deletedAt: new Date(),
          deletedReason: reason.trim(),
        },
      });

      // Create audit logs for each company
      for (const company of companies) {
        await createAuditLog({
          tenantId: company.tenantId,
          userId: session.id,
          companyId: company.id,
          action: 'DELETE',
          entityType: 'Company',
          entityId: company.id,
          entityName: company.name,
          summary: `Bulk deleted company "${company.name}" (UEN: ${company.uen})`,
          changeSource: 'MANUAL',
          reason: reason.trim(),
          metadata: {
            uen: company.uen,
            bulkOperation: true,
            totalInBatch: ids.length,
          },
        });
      }

      return { deleted: ids.length };
    });

    return NextResponse.json({
      success: true,
      deleted: result.deleted,
      message: `Successfully deleted ${result.deleted} ${result.deleted > 1 ? 'companies' : 'company'}`,
    });
  } catch (error) {
    console.error('Bulk delete companies error:', error);
    return routeErrorResponse(error, { fallback: 'bad-request' });
  }
}
