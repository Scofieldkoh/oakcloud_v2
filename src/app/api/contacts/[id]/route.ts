import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { updateContactSchema } from '@/lib/validations/contact';
import {
  getContactById,
  getContactWithRelationships,
  updateContact,
  deleteContact,
  restoreContact,
  linkContactToCompany,
  unlinkContactFromCompany,
} from '@/services/contact.service';
import { z } from 'zod';
import { routeErrorResponse } from '@/lib/api-route-errors';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    await requirePermission(session, 'contact', 'read');

    const { searchParams } = new URL(request.url);
    const full = searchParams.get('full') === 'true';

    // Determine tenant scope - SUPER_ADMIN can specify tenantId, others use session tenant
    const tenantIdParam = searchParams.get('tenantId');
    let effectiveTenantId: string;

    if (session.isSuperAdmin && tenantIdParam) {
      // SUPER_ADMIN can specify any tenant
      effectiveTenantId = tenantIdParam;
    } else if (session.tenantId) {
      // Use session tenant
      effectiveTenantId = session.tenantId;
    } else if (session.isSuperAdmin) {
      // SUPER_ADMIN without tenant context - need to look up contact directly via prisma
      const { prisma } = await import('@/lib/prisma');
      const contact = await prisma.contact.findUnique({
        where: { id, deletedAt: null },
        select: { tenantId: true },
      });
      if (!contact) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      }
      effectiveTenantId = contact.tenantId;
    } else {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    // For company-scoped users, filter company relationships by accessible companies
    const isCompanyScoped = !session.isSuperAdmin && !session.isWorkspaceAdmin && !session.hasAllCompaniesAccess;
    const companyIds = isCompanyScoped ? session.companyIds : undefined;

    const contact = full
      ? await getContactWithRelationships(id, { tenantId: effectiveTenantId, companyIds })
      : await getContactById(id, effectiveTenantId);

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    return NextResponse.json(contact);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    await requirePermission(session, 'contact', 'update');

    const body = await request.json();
    const data = updateContactSchema.parse({ ...body, id });

    if (!session.tenantId && !session.isSuperAdmin) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    // For SUPER_ADMIN, we need to get the contact to determine its tenant
    let tenantId = session.tenantId;
    if (session.isSuperAdmin && !tenantId) {
      const { prisma } = await import('@/lib/prisma');
      const existingContact = await prisma.contact.findUnique({
        where: { id, deletedAt: null },
        select: { tenantId: true },
      });
      if (!existingContact) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      }
      tenantId = existingContact.tenantId;
    }

    const contact = await updateContact(data, { tenantId: tenantId!, userId: session.id });

    return NextResponse.json(contact);
  } catch (error) {
    return routeErrorResponse(error, { notFound: ['Contact not found'], fallback: 'bad-request' });
  }
}

const deleteSchema = z.object({
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    await requirePermission(session, 'contact', 'delete');

    const body = await request.json();
    const { reason } = deleteSchema.parse(body);

    if (!session.tenantId && !session.isSuperAdmin) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    // For SUPER_ADMIN, we need to get the contact to determine its tenant
    let tenantId = session.tenantId;
    if (session.isSuperAdmin && !tenantId) {
      const { prisma } = await import('@/lib/prisma');
      const existingContact = await prisma.contact.findUnique({
        where: { id, deletedAt: null },
        select: { tenantId: true },
      });
      if (!existingContact) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      }
      tenantId = existingContact.tenantId;
    }

    const contact = await deleteContact(id, reason, { tenantId: tenantId!, userId: session.id });

    return NextResponse.json({ message: 'Contact deleted successfully', contact });
  } catch (error) {
    return routeErrorResponse(error, { notFound: ['Contact not found'], fallback: 'bad-request' });
  }
}

// PUT for restore action
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'restore') {
      await requirePermission(session, 'contact', 'update');

      if (!session.tenantId && !session.isSuperAdmin) {
        return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
      }

      // For restore, we need to find the deleted contact
      let tenantId = session.tenantId;
      if (session.isSuperAdmin && !tenantId) {
        // SUPER_ADMIN can restore any contact, need to look it up
        const { prisma } = await import('@/lib/prisma');
        const deletedContact = await prisma.contact.findUnique({
          where: { id },
          select: { tenantId: true },
        });
        if (!deletedContact) {
          return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
        }
        tenantId = deletedContact.tenantId;
      }

      const contact = await restoreContact(id, { tenantId: tenantId!, userId: session.id });

      return NextResponse.json({ message: 'Contact restored successfully', contact });
    }

    if (action === 'link-company') {
      await requirePermission(session, 'contact', 'update');

      const body = await request.json();
      const { companyId, relationship, isPrimary, appointmentDate, numberOfShares, shareClass } = body;

      if (!companyId || !relationship) {
        return NextResponse.json({ error: 'companyId and relationship are required' }, { status: 400 });
      }

      // For SUPER_ADMIN without tenant context, get tenant from the contact
      let tenantId = session.tenantId;
      if (!tenantId && session.isSuperAdmin) {
        const { prisma } = await import('@/lib/prisma');
        const existingContact = await prisma.contact.findUnique({
          where: { id, deletedAt: null },
          select: { tenantId: true },
        });
        if (!existingContact) {
          return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
        }
        tenantId = existingContact.tenantId;
      }

      if (!tenantId) {
        return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
      }

      await linkContactToCompany(id, companyId, relationship, {
        isPrimary: isPrimary ?? false,
        appointmentDate,
        numberOfShares,
        shareClass,
        tenantId,
        userId: session.id,
      });

      return NextResponse.json({ message: 'Contact linked to company successfully' });
    }

    if (action === 'unlink-company') {
      await requirePermission(session, 'contact', 'update');

      const body = await request.json();
      const { companyId, relationship } = body;

      if (!companyId || !relationship) {
        return NextResponse.json({ error: 'companyId and relationship are required' }, { status: 400 });
      }

      // For SUPER_ADMIN without tenant context, get tenant from the contact
      let tenantId = session.tenantId;
      if (!tenantId && session.isSuperAdmin) {
        const { prisma } = await import('@/lib/prisma');
        const existingContact = await prisma.contact.findUnique({
          where: { id, deletedAt: null },
          select: { tenantId: true },
        });
        if (!existingContact) {
          return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
        }
        tenantId = existingContact.tenantId;
      }

      if (!tenantId) {
        return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
      }

      await unlinkContactFromCompany(id, companyId, relationship, tenantId, session.id);

      return NextResponse.json({ message: 'Contact unlinked from company successfully' });
    }

    if (action === 'remove-officer') {
      await requirePermission(session, 'contact', 'update');

      const body = await request.json();
      const { officerId } = body;

      if (!officerId) {
        return NextResponse.json({ error: 'officerId is required' }, { status: 400 });
      }

      // For SUPER_ADMIN without tenant context, get tenant from the contact
      const { prisma } = await import('@/lib/prisma');
      let tenantId = session.tenantId;
      if (!tenantId && session.isSuperAdmin) {
        const existingContact = await prisma.contact.findUnique({
          where: { id, deletedAt: null },
          select: { tenantId: true },
        });
        if (!existingContact) {
          return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
        }
        tenantId = existingContact.tenantId;
      }

      if (!tenantId) {
        return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
      }

      // Verify the officer belongs to this contact and tenant
      const officer = await prisma.companyOfficer.findFirst({
        where: { id: officerId, contactId: id },
        include: { company: { select: { id: true, tenantId: true } } },
      });

      if (!officer || officer.company.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Officer position not found' }, { status: 404 });
      }

      const companyId = officer.company.id;

      // Soft delete: Mark officer as ceased instead of hard delete
      await prisma.companyOfficer.update({
        where: { id: officerId },
        data: {
          cessationDate: new Date(),
          isCurrent: false,
        },
      });

      // Clean up: Remove corresponding CompanyContact relationship if no other ACTIVE positions remain for this company
      const remainingOfficers = await prisma.companyOfficer.count({
        where: { companyId, contactId: id, isCurrent: true },
      });
      const remainingShareholders = await prisma.companyShareholder.count({
        where: { companyId, contactId: id, isCurrent: true },
      });

      // If no active officer or shareholder positions remain, remove the general relationship too
      if (remainingOfficers === 0 && remainingShareholders === 0) {
        await prisma.companyContact.deleteMany({
          where: { companyId, contactId: id },
        });
      }

      return NextResponse.json({ message: 'Officer position removed successfully' });
    }

    if (action === 'remove-shareholder') {
      await requirePermission(session, 'contact', 'update');

      const body = await request.json();
      const { shareholderId } = body;

      if (!shareholderId) {
        return NextResponse.json({ error: 'shareholderId is required' }, { status: 400 });
      }

      // For SUPER_ADMIN without tenant context, get tenant from the contact
      const { prisma } = await import('@/lib/prisma');
      let tenantId = session.tenantId;
      if (!tenantId && session.isSuperAdmin) {
        const existingContact = await prisma.contact.findUnique({
          where: { id, deletedAt: null },
          select: { tenantId: true },
        });
        if (!existingContact) {
          return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
        }
        tenantId = existingContact.tenantId;
      }

      if (!tenantId) {
        return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
      }

      // Verify the shareholder belongs to this contact and tenant
      const shareholder = await prisma.companyShareholder.findFirst({
        where: { id: shareholderId, contactId: id },
        include: { company: { select: { id: true, tenantId: true } } },
      });

      if (!shareholder || shareholder.company.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Shareholding not found' }, { status: 404 });
      }

      const companyId = shareholder.company.id;

      // Soft delete: Mark shareholder as no longer current instead of hard delete
      await prisma.companyShareholder.update({
        where: { id: shareholderId },
        data: {
          isCurrent: false,
        },
      });

      // Clean up: Remove corresponding CompanyContact relationship if no other ACTIVE positions remain for this company
      const remainingOfficers = await prisma.companyOfficer.count({
        where: { companyId, contactId: id, isCurrent: true },
      });
      const remainingShareholders = await prisma.companyShareholder.count({
        where: { companyId, contactId: id, isCurrent: true },
      });

      // If no active officer or shareholder positions remain, remove the general relationship too
      if (remainingOfficers === 0 && remainingShareholders === 0) {
        await prisma.companyContact.deleteMany({
          where: { companyId, contactId: id },
        });
      }

      return NextResponse.json({ message: 'Shareholding removed successfully' });
    }

    if (action === 'update-officer') {
      await requirePermission(session, 'contact', 'update');

      const body = await request.json();
      const { officerId, appointmentDate, cessationDate, role } = body;

      if (!officerId) {
        return NextResponse.json({ error: 'officerId is required' }, { status: 400 });
      }

      // For SUPER_ADMIN without tenant context, get tenant from the contact
      const { prisma } = await import('@/lib/prisma');
      let tenantId = session.tenantId;
      if (!tenantId && session.isSuperAdmin) {
        const existingContact = await prisma.contact.findUnique({
          where: { id, deletedAt: null },
          select: { tenantId: true },
        });
        if (!existingContact) {
          return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
        }
        tenantId = existingContact.tenantId;
      }

      if (!tenantId) {
        return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
      }

      // Verify the officer belongs to this contact and tenant
      const officer = await prisma.companyOfficer.findFirst({
        where: { id: officerId, contactId: id },
        include: { company: { select: { tenantId: true } } },
      });

      if (!officer || officer.company.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Officer position not found' }, { status: 404 });
      }

      // Update the officer record
      await prisma.companyOfficer.update({
        where: { id: officerId },
        data: {
          ...(role && { role }),
          appointmentDate: appointmentDate ? new Date(appointmentDate) : null,
          cessationDate: cessationDate ? new Date(cessationDate) : null,
          isCurrent: !cessationDate,
        },
      });

      return NextResponse.json({ message: 'Officer position updated successfully' });
    }

    if (action === 'update-shareholder') {
      await requirePermission(session, 'contact', 'update');

      const body = await request.json();
      const { shareholderId, numberOfShares, shareClass } = body;

      if (!shareholderId) {
        return NextResponse.json({ error: 'shareholderId is required' }, { status: 400 });
      }

      // For SUPER_ADMIN without tenant context, get tenant from the contact
      const { prisma } = await import('@/lib/prisma');
      let tenantId = session.tenantId;
      if (!tenantId && session.isSuperAdmin) {
        const existingContact = await prisma.contact.findUnique({
          where: { id, deletedAt: null },
          select: { tenantId: true },
        });
        if (!existingContact) {
          return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
        }
        tenantId = existingContact.tenantId;
      }

      if (!tenantId) {
        return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
      }

      // Verify the shareholder belongs to this contact and tenant
      const shareholder = await prisma.companyShareholder.findFirst({
        where: { id: shareholderId, contactId: id },
        include: { company: { select: { tenantId: true } } },
      });

      if (!shareholder || shareholder.company.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Shareholding not found' }, { status: 404 });
      }

      // Update the shareholder record
      await prisma.companyShareholder.update({
        where: { id: shareholderId },
        data: {
          numberOfShares: numberOfShares ?? shareholder.numberOfShares,
          shareClass: shareClass ?? shareholder.shareClass,
        },
      });

      return NextResponse.json({ message: 'Shareholding updated successfully' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return routeErrorResponse(error, { notFound: 'any', fallback: 'bad-request' });
  }
}
