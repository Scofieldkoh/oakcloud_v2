/**
 * Tenant Tags API
 *
 * GET /api/tags - List all tenant (shared) tags
 * POST /api/tags - Create a new tenant tag (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getWorkspaceTags, createWorkspaceTag } from '@/services/document-tag.service';
import { createTagSchema } from '@/lib/validations/document-tag';
import { createAuditLog } from '@/lib/audit';
import { routeErrorResponse } from '@/lib/api-route-errors';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);

    // Allow tenantId from query param for super admins with tenant selector
    const tenantIdParam = searchParams.get('tenantId');
    const tenantId = tenantIdParam || session.tenantId;

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found. Please select a tenant.' }, { status: 400 });
    }

    // Verify tenant access for non-super admins
    if (!session.isSuperAdmin && session.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const tags = await getWorkspaceTags(tenantId);

    return NextResponse.json({ tags });
  } catch (error) {
    console.error('Error fetching tenant tags:', error);
    return routeErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await request.json();

    // Allow tenantId from body for super admins with tenant selector
    const tenantId = body.tenantId || session.tenantId;

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found. Please select a tenant.' }, { status: 400 });
    }

    // Verify tenant access for non-super admins
    if (!session.isSuperAdmin && session.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only SUPER_ADMIN or TENANT_ADMIN can create tenant tags
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json(
        { error: 'Only administrators can create shared tags' },
        { status: 403 }
      );
    }

    const input = createTagSchema.parse(body);

    const tag = await createWorkspaceTag(input, {
      tenantId,
      userId: session.id,
    });

    // Audit log
    await createAuditLog({
      tenantId,
      userId: session.id,
      action: 'CREATE',
      entityType: 'DocumentTag',
      entityId: tag.id,
      entityName: tag.name,
      summary: `Created shared tag "${tag.name}"`,
      changeSource: 'MANUAL',
    });

    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    // Zod validation error
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid input', details: error }, { status: 400 });
    }
    console.error('Error creating tenant tag:', error);
    return routeErrorResponse(error, { conflict: ['A shared tag with this name already exists'] });
  }
}
