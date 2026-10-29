import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { requireWorkspaceContext } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { linkContactToCompany } from '@/services/contact.service';
import { createContactWithDetailsSchema } from '@/lib/validations/contact-detail';
import { contactResolutionSchema } from '@/lib/validations/contact';
import { previewContactIdentity, resolveOrCreateContact } from '@/services/contact-identity.service';
import { ZodError } from 'zod';
import { routeErrorResponse } from '@/lib/api-route-errors';

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/companies/[id]/contact-details/create-contact
 * Create a new contact with details and link to the company
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId } = await params;

    // Check company access
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check update permission
    await requirePermission(session, 'company', 'update', companyId);

    const body = await request.json();

    // Resolve tenant context - SUPER_ADMIN can specify via body
    const { tenantId: bodyTenantId, resolution: rawResolution, ...contactData } = body;
    const tenantResult = await requireWorkspaceContext(session, bodyTenantId);
    if (tenantResult.error) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Parse and validate input
    const data = createContactWithDetailsSchema.parse({
      ...contactData,
      companyId,
    });
    const resolution = rawResolution === undefined
      ? undefined
      : contactResolutionSchema.parse(rawResolution);
    const { email, phone, ...identityContact } = data.contact;
    const defaultDetails = [
      ...(email ? [{ detailType: 'EMAIL' as const, value: email }] : []),
      ...(phone ? [{ detailType: 'PHONE' as const, value: phone }] : []),
    ];
    const companyDetails = (data.contactDetails ?? []).map((detail, index) => ({
      ...detail,
      companyId,
      displayOrder: index,
    }));
    const candidate = {
      ...identityContact,
      source: 'COMPANY_QUICK_CREATE' as const,
      ...(defaultDetails.length > 0 || companyDetails.length > 0
        ? { contactDetails: [...defaultDetails, ...companyDetails] }
        : {}),
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

    // Use a transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      const resolved = await resolveOrCreateContact(
        candidate,
        resolution ?? { action: 'AUTO' },
        { tenantId, userId: session.id, tx },
      );
      const contact = resolved.contact;

      // Link the contact to the company
      await linkContactToCompany(contact.id, companyId, data.relationship, {
        tenantId,
        userId: session.id,
        tx,
      });

      return contact;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    return routeErrorResponse(error, { notFound: ['Company not found'], logLabel: 'Error creating contact with details:' });
  }
}
