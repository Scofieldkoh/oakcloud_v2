import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireWorkspaceContext } from '@/lib/api-helpers';
import { updateContactDetailSchema } from '@/lib/validations/contact-detail';
import {
  getContactDetailById,
  updateContactDetail,
  deleteContactDetail,
} from '@/services/contact-detail.service';
import { ZodError } from 'zod';

type RouteParams = { params: Promise<{ id: string; detailId: string }> };

/**
 * GET /api/contacts/[id]/contact-details/[detailId]
 * Get a specific contact detail
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await requireAuth();
    const { id, detailId } = await params;
    await requirePermission(session, 'contact', 'read');

    const searchParams = request.nextUrl.searchParams;
    const tenantResult = await requireWorkspaceContext(session, searchParams.get('tenantId'));
    if (tenantResult.error) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    const detail = await getContactDetailById(detailId, tenantId);
    if (!detail || detail.contactId !== id) {
      return NextResponse.json({ error: 'Contact detail not found' }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    return createErrorResponse(error, 'Failed to fetch contact detail');
  }
}

/**
 * PATCH /api/contacts/[id]/contact-details/[detailId]
 * Update a contact detail
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await requireAuth();
    const { id, detailId } = await params;
    await requirePermission(session, 'contact', 'update');

    const body = await request.json();
    const { tenantId: requestedTenantId, ...detailData } = body;

    const tenantResult = await requireWorkspaceContext(session, requestedTenantId);
    if (tenantResult.error) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Verify the detail belongs to this contact
    const existing = await getContactDetailById(detailId, tenantId);
    if (!existing || existing.contactId !== id) {
      return NextResponse.json({ error: 'Contact detail not found' }, { status: 404 });
    }

    const data = updateContactDetailSchema.parse({ ...detailData, id: detailId });
    const detail = await updateContactDetail(data, { tenantId, userId: session.id });

    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? 'Validation failed' }, { status: 400 });
    }
    return createErrorResponse(error, 'Failed to update contact detail');
  }
}

/**
 * DELETE /api/contacts/[id]/contact-details/[detailId]
 * Delete a contact detail
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await requireAuth();
    const { id, detailId } = await params;
    await requirePermission(session, 'contact', 'update');

    const searchParams = request.nextUrl.searchParams;
    const tenantResult = await requireWorkspaceContext(session, searchParams.get('tenantId'));
    if (tenantResult.error) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Verify the detail belongs to this contact
    const existing = await getContactDetailById(detailId, tenantId);
    if (!existing || existing.contactId !== id) {
      return NextResponse.json({ error: 'Contact detail not found' }, { status: 404 });
    }

    await deleteContactDetail(detailId, { tenantId, userId: session.id });

    return NextResponse.json({ success: true });
  } catch (error) {
    return createErrorResponse(error, 'Failed to delete contact detail');
  }
}
