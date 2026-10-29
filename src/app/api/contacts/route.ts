import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createContactWithDetailsSchema, contactSearchSchema } from '@/lib/validations/contact';
import { searchContactsWithCounts } from '@/services/contact.service';
import { previewContactIdentity, resolveOrCreateContact } from '@/services/contact-identity.service';
import { prisma } from '@/lib/prisma';
import { routeErrorResponse } from '@/lib/api-route-errors';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check read permission
    await requirePermission(session, 'contact', 'read');

    const { searchParams } = new URL(request.url);

    const params = contactSearchSchema.parse({
      query: searchParams.get('query') || undefined,
      fullName: searchParams.get('fullName') || undefined,
      contactType: searchParams.get('contactType') || undefined,
      identificationType: searchParams.get('identificationType') || undefined,
      identificationNumber: searchParams.get('identificationNumber') || undefined,
      nationality: searchParams.get('nationality') || undefined,
      email: searchParams.get('email') || undefined,
      phone: searchParams.get('phone') || undefined,
      companyId: searchParams.get('companyId') || undefined,
      companiesMin: searchParams.get('companiesMin') ? Number(searchParams.get('companiesMin')) : undefined,
      companiesMax: searchParams.get('companiesMax') ? Number(searchParams.get('companiesMax')) : undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined,
      sortBy: searchParams.get('sortBy') || undefined,
      sortOrder: searchParams.get('sortOrder') || undefined,
    });

    const effectiveTenantId = session.tenantId;

    // For company-scoped users, filter by their assigned companies
    // SUPER_ADMIN, TENANT_ADMIN, and users with "All Companies" access see all contacts in their tenant
    const companyIds = (!session.isSuperAdmin && !session.isWorkspaceAdmin && !session.hasAllCompaniesAccess)
      ? session.companyIds
      : undefined;

    const result = await searchContactsWithCounts(params, effectiveTenantId, {
      companyIds,
    });

    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, { fallback: 'bad-request' });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check create permission
    await requirePermission(session, 'contact', 'create');

    const body = await request.json();
    const data = createContactWithDetailsSchema.parse(body);
    const { contactDetails = [], resolution, ...createData } = data;

    const tenantId = session.tenantId;

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    const candidate = {
      ...createData,
      source: 'MANUAL' as const,
      contactDetails: contactDetails.map((detail, index) => ({
        ...detail,
        displayOrder: detail.displayOrder ?? index,
      })),
    };
    const match = await previewContactIdentity(candidate, tenantId);
    if (resolution && !match) {
      return NextResponse.json(
        { error: 'The contact match is no longer current; submit again to preview' },
        { status: 400 },
      );
    }
    if (match && (!resolution || (
      resolution.action === 'REUSE' &&
      (resolution.contactId !== match.contactId || match.blockedByIdentifierConflict)
    ))) {
      return NextResponse.json(
        {
          error: match.blockedByIdentifierConflict
            ? 'A matching contact has a conflicting identifier and cannot be reused'
            : 'Review the matching contact before continuing',
          code: 'CONTACT_MATCH_REVIEW_REQUIRED',
          match,
        },
        { status: 409 },
      );
    }

    const resolved = await prisma.$transaction((tx) => resolveOrCreateContact(
        candidate,
        resolution ?? { action: 'AUTO' },
        {
          tenantId,
          userId: session.id,
          tx,
        },
      ));
    const contact = resolved.contact;

    return NextResponse.json(contact, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, { fallback: 'bad-request' });
  }
}
