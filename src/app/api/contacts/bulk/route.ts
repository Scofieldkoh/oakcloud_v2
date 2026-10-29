import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { routeErrorResponse } from '@/lib/api-route-errors';

/**
 * DELETE /api/contacts/bulk
 *
 * Bulk delete multiple contacts at once.
 * All contacts must belong to the user's tenant.
 * User must have delete permission for all contacts.
 *
 * Request body:
 * - ids: string[] - Array of contact IDs to delete
 * - reason: string - Reason for deletion (required)
 *
 * Permissions:
 * - TENANT_ADMIN or user with contact:delete permission
 * - SUPER_ADMIN can delete any contact
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
        { error: 'Cannot delete more than 100 contacts at once' },
        { status: 400 }
      );
    }

    // Get all contacts to verify ownership and check permissions
    const contacts = await prisma.contact.findMany({
      where: {
        id: { in: ids },
        deletedAt: null, // Only active contacts
      },
      select: {
        id: true,
        tenantId: true,
        fullName: true,
        contactType: true,
      },
    });

    // Check if all contacts were found
    if (contacts.length !== ids.length) {
      const foundIds = new Set(contacts.map((c) => c.id));
      const notFound = ids.filter((id) => !foundIds.has(id));
      return NextResponse.json(
        { error: `Some contacts not found: ${notFound.join(', ')}` },
        { status: 404 }
      );
    }

    // Check tenant access for all contacts
    if (!session.isSuperAdmin) {
      const wrongTenantContacts = contacts.filter((c) => c.tenantId !== session.tenantId);
      if (wrongTenantContacts.length > 0) {
        return NextResponse.json(
          { error: 'You do not have permission to delete some of these contacts' },
          { status: 403 }
        );
      }
    }

    // Check delete permission (use first contact for permission check)
    // For bulk operations, we require tenant-level delete permission
    try {
      await requirePermission(session, 'contact', 'delete');
    } catch {
      return NextResponse.json(
        { error: 'You do not have permission to delete contacts' },
        { status: 403 }
      );
    }

    // Perform soft delete in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Soft delete all contacts
      await tx.contact.updateMany({
        where: { id: { in: ids } },
        data: {
          deletedAt: new Date(),
        },
      });

      // Create audit logs for each contact
      for (const contact of contacts) {
        await createAuditLog({
          tenantId: contact.tenantId,
          userId: session.id,
          action: 'DELETE',
          entityType: 'Contact',
          entityId: contact.id,
          entityName: contact.fullName,
          summary: `Bulk deleted contact "${contact.fullName}"`,
          changeSource: 'MANUAL',
          metadata: {
            reason: reason.trim(),
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
      message: `Successfully deleted ${result.deleted} contact${result.deleted > 1 ? 's' : ''}`,
    });
  } catch (error) {
    console.error('Bulk delete contacts error:', error);
    return routeErrorResponse(error, { fallback: 'bad-request' });
  }
}
