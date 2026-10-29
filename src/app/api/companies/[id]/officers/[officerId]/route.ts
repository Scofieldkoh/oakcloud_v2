import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import {
  linkOfficerToContact,
  unlinkOfficerFromContact,
  updateOfficer,
  removeOfficer,
  deleteOfficer,
  getCompanyById,
} from '@/services/company.service';
import { createErrorResponse } from '@/lib/api-helpers';
import { z } from 'zod';

const linkSchema = z.object({
  contactId: z.string().uuid('Invalid contact ID'),
});

const updateSchema = z.object({
  appointmentDate: z.string().nullable().optional(),
  cessationDate: z.string().nullable().optional(),
});

// PATCH - Link/unlink officer to contact or update officer details
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; officerId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id: companyId, officerId } = await params;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // Check permission
    await requirePermission(session, 'company', 'update', companyId);

    // Additional check for company-scoped users
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get tenant from company for SUPER_ADMIN (who has null tenantId)
    // SECURITY: Only SUPER_ADMIN can skip tenant filter - verified by canAccessCompany check above
    let tenantId = session.tenantId;
    if (!tenantId && session.isSuperAdmin) {
      const company = await getCompanyById(companyId, null, { skipTenantFilter: true });
      if (!company) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }
      tenantId = company.tenantId;
    } else if (!tenantId) {
      // Non-SUPER_ADMIN without tenantId should not reach here, but guard anyway
      return NextResponse.json({ error: 'Tenant context required' }, { status: 403 });
    }

    const body = await request.json();

    // Handle update action
    if (action === 'update') {
      const data = updateSchema.parse(body);

      // Validate cessation date is not before appointment date
      if (data.appointmentDate && data.cessationDate) {
        const appointmentDate = new Date(data.appointmentDate);
        const cessationDate = new Date(data.cessationDate);
        if (cessationDate < appointmentDate) {
          return NextResponse.json(
            { error: 'Cessation date cannot be earlier than appointment date' },
            { status: 400 }
          );
        }
      }

      const officer = await updateOfficer(
        officerId,
        companyId,
        { tenantId, userId: session.id },
        data
      );
      return NextResponse.json({ success: true, officer });
    }

    // Default: link/unlink contact
    // If contactId is provided, link; if null/undefined, unlink
    if (body.contactId === null || body.contactId === undefined) {
      await unlinkOfficerFromContact(officerId, { tenantId, userId: session.id });
      return NextResponse.json({ success: true, action: 'unlinked' });
    } else {
      const data = linkSchema.parse(body);
      await linkOfficerToContact(officerId, data.contactId, { tenantId, userId: session.id });
      return NextResponse.json({ success: true, action: 'linked' });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    return createErrorResponse(error);
  }
}

// DELETE - Remove officer (mark as ceased) or delete record (action=delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; officerId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id: companyId, officerId } = await params;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // Check permission (delete vs cease)
    if (action === 'delete') {
      await requirePermission(session, 'officer', 'delete', companyId);
    } else {
      await requirePermission(session, 'company', 'update', companyId);
    }

    // Additional check for company-scoped users
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get tenant from company for SUPER_ADMIN (who has null tenantId)
    // SECURITY: Only SUPER_ADMIN can skip tenant filter - verified by canAccessCompany check above
    let tenantId = session.tenantId;
    if (!tenantId && session.isSuperAdmin) {
      const company = await getCompanyById(companyId, null, { skipTenantFilter: true });
      if (!company) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }
      tenantId = company.tenantId;
    } else if (!tenantId) {
      // Non-SUPER_ADMIN without tenantId should not reach here, but guard anyway
      return NextResponse.json({ error: 'Tenant context required' }, { status: 403 });
    }

    if (action === 'delete') {
      await deleteOfficer(officerId, companyId, { tenantId, userId: session.id });
    } else {
      await removeOfficer(officerId, companyId, { tenantId, userId: session.id });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return createErrorResponse(error);
  }
}
