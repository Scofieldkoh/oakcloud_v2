/**
 * Individual Tenant Tag API
 *
 * GET /api/tags/:tagId - Get a tenant tag
 * PATCH /api/tags/:tagId - Update a tenant tag (admin only)
 * DELETE /api/tags/:tagId - Delete a tenant tag (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getWorkspaceTag,
  updateTenantTag,
  deleteWorkspaceTag,
} from '@/services/document-tag.service';
import { updateTagSchema } from '@/lib/validations/document-tag';
import { createAuditLog } from '@/lib/audit';
import { z } from 'zod';
import { routeErrorResponse } from '@/lib/api-route-errors';

type RouteParams = { params: Promise<{ tagId: string }> };

const tagIdSchema = z.object({
  tagId: z.string().uuid('Invalid tag ID'),
});

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { tagId } = tagIdSchema.parse(await params);

    if (!session.tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const tag = await getWorkspaceTag(tagId, { tenantId: session.tenantId });

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    return NextResponse.json({ tag });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid tag ID' }, { status: 400 });
    }
    console.error('Error fetching tenant tag:', error);
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { tagId } = tagIdSchema.parse(await params);

    if (!session.tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    // Only SUPER_ADMIN or TENANT_ADMIN can update tenant tags
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json(
        { error: 'Only administrators can update shared tags' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const updates = updateTagSchema.parse(body);

    const tag = await updateTenantTag(tagId, updates, { tenantId: session.tenantId });

    // Audit log
    await createAuditLog({
      tenantId: session.tenantId,
      userId: session.id,
      action: 'UPDATE',
      entityType: 'DocumentTag',
      entityId: tag.id,
      entityName: tag.name,
      summary: `Updated shared tag "${tag.name}"`,
      changeSource: 'MANUAL',
    });

    return NextResponse.json({ tag });
  } catch (error) {
    if (error instanceof Error && error.message === 'Shared tag not found') {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    console.error('Error updating tenant tag:', error);
    return routeErrorResponse(error, { conflict: ['A shared tag with this name already exists'] });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { tagId } = tagIdSchema.parse(await params);

    if (!session.tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    // Only SUPER_ADMIN or TENANT_ADMIN can delete tenant tags
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json(
        { error: 'Only administrators can delete shared tags' },
        { status: 403 }
      );
    }

    // Get tag info for audit log before deletion
    const tag = await getWorkspaceTag(tagId, { tenantId: session.tenantId });
    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    await deleteWorkspaceTag(tagId, { tenantId: session.tenantId });

    // Audit log
    await createAuditLog({
      tenantId: session.tenantId,
      userId: session.id,
      action: 'DELETE',
      entityType: 'DocumentTag',
      entityId: tagId,
      entityName: tag.name,
      summary: `Deleted shared tag "${tag.name}"`,
      changeSource: 'MANUAL',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Shared tag not found') {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid tag ID' }, { status: 400 });
    }
    console.error('Error deleting tenant tag:', error);
    return routeErrorResponse(error);
  }
}
