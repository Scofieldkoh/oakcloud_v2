import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import {
  linkShareholderToContact,
  unlinkShareholderFromContact,
  updateShareholder,
  removeShareholder,
  reactivateShareholder,
  deleteShareholder,
  getCompanyById,
} from '@/services/company.service';
import { createErrorResponse } from '@/lib/api-helpers';
import { z } from 'zod';

const linkSchema = z.object({
  contactId: z.string().uuid('Invalid contact ID'),
});

const updateSchema = z.object({
  numberOfShares: z.number().int().positive().optional(),
  shareClass: z.string().optional(),
});

// PATCH - Link/unlink shareholder to contact or update shareholder details
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareholderId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id: companyId, shareholderId } = await params;
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

    const serviceParams = { tenantId, userId: session.id };

    if (action === 'reactivate') {
      await reactivateShareholder(shareholderId, companyId, serviceParams);
      return NextResponse.json({ success: true });
    }

    const body = await request.json();

    if (action === 'update') {
      const data = updateSchema.parse(body);
      const shareholder = await updateShareholder(
        shareholderId,
        companyId,
        serviceParams,
        data
      );
      return NextResponse.json({ success: true, shareholder });
    }

    if (body.contactId === null || body.contactId === undefined) {
      await unlinkShareholderFromContact(shareholderId, serviceParams);
      return NextResponse.json({ success: true, action: 'unlinked' });
    } else {
      const data = linkSchema.parse(body);
      await linkShareholderToContact(shareholderId, data.contactId, serviceParams);
      return NextResponse.json({ success: true, action: 'linked' });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    return createErrorResponse(error);
  }
}

// DELETE - Remove shareholder (mark as former) or delete record (action=delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareholderId: string }> }
) {
  try {
    const session = await requireAuth();
    const { id: companyId, shareholderId } = await params;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // Check permission (delete vs mark former)
    if (action === 'delete') {
      await requirePermission(session, 'shareholder', 'delete', companyId);
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

    const serviceParams = { tenantId, userId: session.id };
    if (action === 'delete') {
      await deleteShareholder(shareholderId, companyId, serviceParams);
    } else {
      await removeShareholder(shareholderId, companyId, serviceParams);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return createErrorResponse(error);
  }
}
