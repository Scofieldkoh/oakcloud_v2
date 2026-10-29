import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { routeErrorResponse } from '@/lib/api-route-errors';

// Schema for creating an alias
// companyId is optional - if not provided, creates a workspace-wide alias
const createAliasSchema = z.object({
  type: z.enum(['vendor', 'customer']),
  companyId: z.string().uuid().optional().nullable(),
  rawName: z.string().min(1).max(500),
});

// Schema for deleting an alias
const deleteAliasSchema = z.object({
  type: z.enum(['vendor', 'customer']),
  aliasId: z.string().uuid(),
});

/**
 * Helper to get effective tenant ID - handles Super Admin without session tenant
 */
async function getEffectiveTenantId(
  session: { tenantId?: string | null; isSuperAdmin?: boolean },
  contactId: string
): Promise<{ tenantId: string; contact: { id: string; tenantId: string } } | { error: string; status: number }> {
  // If session has tenant, use it
  if (session.tenantId) {
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        tenantId: session.tenantId,
        deletedAt: null,
      },
      select: { id: true, tenantId: true },
    });

    if (!contact) {
      return { error: 'Contact not found', status: 404 };
    }

    return { tenantId: session.tenantId, contact };
  }

  // Super Admin without tenant context - derive from contact
  if (session.isSuperAdmin) {
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        deletedAt: null,
      },
      select: { id: true, tenantId: true },
    });

    if (!contact) {
      return { error: 'Contact not found', status: 404 };
    }

    return { tenantId: contact.tenantId, contact };
  }

  return { error: 'Tenant context required', status: 400 };
}

/**
 * GET /api/contacts/[id]/aliases
 * Get all vendor and customer aliases that point to this contact
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check permission
    await requirePermission(session, 'contact', 'read', id);

    // Get effective tenant ID (handles Super Admin without session tenant)
    const tenantResult = await getEffectiveTenantId(session, id);
    if ('error' in tenantResult) {
      return NextResponse.json({ error: tenantResult.error }, { status: tenantResult.status });
    }

    const { tenantId } = tenantResult;

    // Fetch vendor aliases pointing to this contact
    const vendorAliases = await prisma.vendorAlias.findMany({
      where: {
        tenantId,
        normalizedContactId: id,
        deletedAt: null,
      },
      select: {
        id: true,
        companyId: true,
        rawName: true,
        confidence: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch customer aliases pointing to this contact
    const customerAliases = await prisma.customerAlias.findMany({
      where: {
        tenantId,
        normalizedContactId: id,
        deletedAt: null,
      },
      select: {
        id: true,
        companyId: true,
        rawName: true,
        confidence: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get unique company IDs to fetch company names (filter out nulls for workspace-wide)
    const companyIds = [
      ...new Set([
        ...vendorAliases.map((a) => a.companyId).filter((id): id is string => id !== null),
        ...customerAliases.map((a) => a.companyId).filter((id): id is string => id !== null),
      ]),
    ];

    // Fetch company names
    const companies = companyIds.length > 0
      ? await prisma.company.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, name: true },
        })
      : [];

    const companyMap = new Map(companies.map((c) => [c.id, c.name]));

    // Format response with company names
    // companyId = null means workspace-wide alias
    const formattedVendorAliases = vendorAliases.map((a) => ({
      ...a,
      companyName: a.companyId ? (companyMap.get(a.companyId) || 'Unknown Company') : null,
      isTenantWide: a.companyId === null,
      type: 'vendor' as const,
    }));

    const formattedCustomerAliases = customerAliases.map((a) => ({
      ...a,
      companyName: a.companyId ? (companyMap.get(a.companyId) || 'Unknown Company') : null,
      isTenantWide: a.companyId === null,
      type: 'customer' as const,
    }));

    return NextResponse.json({
      vendorAliases: formattedVendorAliases,
      customerAliases: formattedCustomerAliases,
      totalCount: formattedVendorAliases.length + formattedCustomerAliases.length,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/**
 * POST /api/contacts/[id]/aliases
 * Create a new alias pointing to this contact
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check permission (need update permission to add aliases)
    await requirePermission(session, 'contact', 'update', id);

    // Get effective tenant ID (handles Super Admin without session tenant)
    const tenantResult = await getEffectiveTenantId(session, id);
    if ('error' in tenantResult) {
      return NextResponse.json({ error: tenantResult.error }, { status: tenantResult.status });
    }

    const { tenantId } = tenantResult;

    const body = await request.json();
    const parsed = createAliasSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { type, companyId, rawName } = parsed.data;

    // If companyId is provided, verify the company exists and belongs to this tenant
    if (companyId) {
      const company = await prisma.company.findFirst({
        where: {
          id: companyId,
          tenantId,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (!company) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }
    }

    // Create the alias (companyId = null for workspace-wide)
    if (type === 'vendor') {
      // Check if alias already exists (same rawName + same scope)
      const existingAliases = await prisma.vendorAlias.findMany({
        where: {
          tenantId,
          rawName,
          deletedAt: null,
        },
      });
      // Filter in JS for the correct scope (companyId match or both null for workspace-wide)
      const existing = existingAliases.find((a) =>
        companyId ? a.companyId === companyId : a.companyId === null
      );

      if (existing) {
        // Update existing alias to point to this contact
        await prisma.vendorAlias.update({
          where: { id: existing.id },
          data: {
            normalizedContactId: id,
            confidence: 1.0,
            createdById: session.id,
          },
        });
      } else {
        await prisma.vendorAlias.create({
          data: {
            tenantId,
            companyId: companyId || null,
            rawName,
            normalizedContactId: id,
            confidence: 1.0,
            createdById: session.id,
          },
        });
      }
    } else {
      // Customer alias
      const existingAliases = await prisma.customerAlias.findMany({
        where: {
          tenantId,
          rawName,
          deletedAt: null,
        },
      });
      // Filter in JS for the correct scope (companyId match or both null for workspace-wide)
      const existing = existingAliases.find((a) =>
        companyId ? a.companyId === companyId : a.companyId === null
      );

      if (existing) {
        await prisma.customerAlias.update({
          where: { id: existing.id },
          data: {
            normalizedContactId: id,
            confidence: 1.0,
            createdById: session.id,
          },
        });
      } else {
        await prisma.customerAlias.create({
          data: {
            tenantId,
            companyId: companyId || null,
            rawName,
            normalizedContactId: id,
            confidence: 1.0,
            createdById: session.id,
          },
        });
      }
    }

    return NextResponse.json({ message: 'Alias created successfully' });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/**
 * DELETE /api/contacts/[id]/aliases
 * Soft delete an alias
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check permission
    await requirePermission(session, 'contact', 'update', id);

    // Get effective tenant ID (handles Super Admin without session tenant)
    const tenantResult = await getEffectiveTenantId(session, id);
    if ('error' in tenantResult) {
      return NextResponse.json({ error: tenantResult.error }, { status: tenantResult.status });
    }

    const { tenantId } = tenantResult;

    const body = await request.json();
    const parsed = deleteAliasSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { type, aliasId } = parsed.data;

    // Soft delete the alias
    if (type === 'vendor') {
      const alias = await prisma.vendorAlias.findFirst({
        where: {
          id: aliasId,
          tenantId,
          normalizedContactId: id,
          deletedAt: null,
        },
      });

      if (!alias) {
        return NextResponse.json({ error: 'Alias not found' }, { status: 404 });
      }

      await prisma.vendorAlias.update({
        where: { id: aliasId },
        data: { deletedAt: new Date() },
      });
    } else {
      const alias = await prisma.customerAlias.findFirst({
        where: {
          id: aliasId,
          tenantId,
          normalizedContactId: id,
          deletedAt: null,
        },
      });

      if (!alias) {
        return NextResponse.json({ error: 'Alias not found' }, { status: 404 });
      }

      await prisma.customerAlias.update({
        where: { id: aliasId },
        data: { deletedAt: new Date() },
      });
    }

    return NextResponse.json({ message: 'Alias deleted successfully' });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
