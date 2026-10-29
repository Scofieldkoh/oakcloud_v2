import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { requireWorkspaceContext } from '@/lib/api-helpers';
import {
  getContactDetailById,
  updateContactDetail,
  deleteContactDetail,
} from '@/services/contact-detail.service';
import { updateContactDetailSchema } from '@/lib/validations/contact-detail';
import { ZodError } from 'zod';
import { routeErrorResponse } from '@/lib/api-route-errors';

type RouteParams = {
  params: Promise<{ id: string; detailId: string }>;
};

/**
 * GET /api/companies/[id]/contact-details/[detailId]
 * Get a specific contact detail
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId, detailId } = await params;

    // Check company access
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check read permission
    await requirePermission(session, 'company', 'read', companyId);

    // Resolve tenant context - SUPER_ADMIN can specify via query param
    const { searchParams } = new URL(request.url);
    const tenantIdParam = searchParams.get('tenantId');
    const tenantResult = await requireWorkspaceContext(session, tenantIdParam);
    if (tenantResult.error) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    const contactDetail = await getContactDetailById(detailId, tenantId);

    if (!contactDetail) {
      return NextResponse.json({ error: 'Contact detail not found' }, { status: 404 });
    }

    // Verify the detail belongs to this company (or has no company)
    if (contactDetail.companyId && contactDetail.companyId !== companyId) {
      return NextResponse.json({ error: 'Contact detail not found' }, { status: 404 });
    }

    return NextResponse.json(contactDetail);
  } catch (error) {
    return routeErrorResponse(error, { logLabel: 'Error fetching contact detail:' });
  }
}

/**
 * PATCH /api/companies/[id]/contact-details/[detailId]
 * Update a contact detail
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId, detailId } = await params;

    // Check company access
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check update permission
    await requirePermission(session, 'company', 'update', companyId);

    const body = await request.json();

    // Resolve tenant context - SUPER_ADMIN can specify via body
    const { tenantId: bodyTenantId, ...updateData } = body;
    const tenantResult = await requireWorkspaceContext(session, bodyTenantId);
    if (tenantResult.error) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Verify the contact detail exists and belongs to this company
    const existing = await getContactDetailById(detailId, tenantId);
    if (!existing) {
      return NextResponse.json({ error: 'Contact detail not found' }, { status: 404 });
    }

    // For company-level details, ensure it belongs to this company
    if (existing.companyId && existing.companyId !== companyId) {
      return NextResponse.json({ error: 'Contact detail not found' }, { status: 404 });
    }

    // Parse and validate input
    const data = updateContactDetailSchema.parse({
      ...updateData,
      id: detailId,
    });

    const contactDetail = await updateContactDetail(data, {
      tenantId,
      userId: session.id,
    });

    return NextResponse.json(contactDetail);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    return routeErrorResponse(error, { notFound: ['Contact detail not found'], logLabel: 'Error updating contact detail:' });
  }
}

/**
 * DELETE /api/companies/[id]/contact-details/[detailId]
 * Delete a contact detail
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId, detailId } = await params;

    // Check company access
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check update permission (deleting a detail requires update permission)
    await requirePermission(session, 'company', 'update', companyId);

    // Resolve tenant context - SUPER_ADMIN can specify via query param
    const { searchParams } = new URL(request.url);
    const tenantIdParam = searchParams.get('tenantId');
    const tenantResult = await requireWorkspaceContext(session, tenantIdParam);
    if (tenantResult.error) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Verify the contact detail exists and belongs to this company
    const existing = await getContactDetailById(detailId, tenantId);
    if (!existing) {
      return NextResponse.json({ error: 'Contact detail not found' }, { status: 404 });
    }

    // For company-level details, ensure it belongs to this company
    if (existing.companyId && existing.companyId !== companyId) {
      return NextResponse.json({ error: 'Contact detail not found' }, { status: 404 });
    }

    await deleteContactDetail(detailId, {
      tenantId,
      userId: session.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, { notFound: ['Contact detail not found'], logLabel: 'Error deleting contact detail:' });
  }
}
