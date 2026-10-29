/**
 * Individual Tag API
 *
 * GET /api/companies/:id/tags/:tagId - Get a single tag
 * PATCH /api/companies/:id/tags/:tagId - Update a tag
 * DELETE /api/companies/:id/tags/:tagId - Delete a tag
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getTag, updateTag, deleteTag } from '@/services/document-tag.service';
import { updateTagSchema } from '@/lib/validations/document-tag';
import { createAuditLog } from '@/lib/audit';
import { z } from 'zod';
import { routeErrorResponse } from '@/lib/api-route-errors';

type RouteParams = { params: Promise<{ id: string; tagId: string }> };

// Validate params
const paramsSchema = z.object({
  id: z.string().uuid('Invalid company ID'),
  tagId: z.string().uuid('Invalid tag ID'),
});

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId, tagId } = paramsSchema.parse(await params);

    // Verify company access
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get company to verify tenant
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { tenantId: true },
    });

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const tag = await getTag(tagId, {
      tenantId: company.tenantId,
      companyId,
    });

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    return NextResponse.json({ tag });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }
    console.error('Error fetching tag:', error);
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId, tagId } = paramsSchema.parse(await params);

    // Verify company access
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get company to verify tenant
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { tenantId: true },
    });

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Get current tag for audit comparison
    const currentTag = await getTag(tagId, {
      tenantId: company.tenantId,
      companyId,
    });

    if (!currentTag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    const body = await request.json();
    const updates = updateTagSchema.parse(body);

    const tag = await updateTag(tagId, updates, {
      tenantId: company.tenantId,
      companyId,
    });

    // Build changes object for audit
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (updates.name && updates.name !== currentTag.name) {
      changes.name = { old: currentTag.name, new: tag.name };
    }
    if (updates.color && updates.color !== currentTag.color) {
      changes.color = { old: currentTag.color, new: tag.color };
    }
    if (updates.description !== undefined && updates.description !== currentTag.description) {
      changes.description = { old: currentTag.description, new: tag.description };
    }

    // Audit log
    if (Object.keys(changes).length > 0) {
      await createAuditLog({
        tenantId: company.tenantId,
        userId: session.id,
        companyId,
        action: 'UPDATE',
        entityType: 'DocumentTag',
        entityId: tag.id,
        entityName: tag.name,
        summary: `Updated tag "${tag.name}"`,
        changeSource: 'MANUAL',
        changes,
      });
    }

    return NextResponse.json({ tag });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    console.error('Error updating tag:', error);
    return routeErrorResponse(error, {
      notFound: ['Tag not found'],
      conflict: ['A tag with this name already exists'],
    });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId, tagId } = paramsSchema.parse(await params);

    // Verify company access
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get company to verify tenant
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { tenantId: true },
    });

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Get tag name for audit log
    const tag = await getTag(tagId, {
      tenantId: company.tenantId,
      companyId,
    });

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    await deleteTag(tagId, {
      tenantId: company.tenantId,
      companyId,
    });

    // Audit log
    await createAuditLog({
      tenantId: company.tenantId,
      userId: session.id,
      companyId,
      action: 'DELETE',
      entityType: 'DocumentTag',
      entityId: tagId,
      entityName: tag.name,
      summary: `Deleted tag "${tag.name}"`,
      changeSource: 'MANUAL',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }
    console.error('Error deleting tag:', error);
    return routeErrorResponse(error, { notFound: ['Tag not found'] });
  }
}
