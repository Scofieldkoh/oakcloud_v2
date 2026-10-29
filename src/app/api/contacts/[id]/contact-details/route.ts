import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireWorkspaceContext } from '@/lib/api-helpers';
import { createContactDetailSchema } from '@/lib/validations/contact-detail';
import {
  getContactDetails,
  getContactDetailsGrouped,
  createContactDetail,
} from '@/services/contact-detail.service';
import { prisma } from '@/lib/prisma';
import { ZodError } from 'zod';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/contacts/[id]/contact-details
 * Get all contact details for a contact
 *
 * Query params:
 * - tenantId: (super admin only) specify tenant context
 * - grouped: if "true", returns details grouped by company (default vs company-specific)
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'contact', 'read');

    const searchParams = request.nextUrl.searchParams;
    const tenantResult = await requireWorkspaceContext(session, searchParams.get('tenantId'));
    if (tenantResult.error) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Check if grouped format is requested
    const grouped = searchParams.get('grouped') === 'true';

    if (grouped) {
      const groupedDetails = await getContactDetailsGrouped(id, tenantId);
      return NextResponse.json(groupedDetails);
    }

    const details = await getContactDetails(id, tenantId);
    return NextResponse.json(details);
  } catch (error) {
    return createErrorResponse(error, 'Failed to fetch contact details');
  }
}

/**
 * POST /api/contacts/[id]/contact-details
 * Create a new contact detail for a contact
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'contact', 'update');

    const body = await request.json();
    const { tenantId: requestedTenantId, selectedCompanyId, isCompanySpecific, ...detailData } = body;

    const tenantResult = await requireWorkspaceContext(session, requestedTenantId);
    if (tenantResult.error) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Validate contact exists and belongs to the current workspace.
    const contact = await prisma.contact.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // Determine if this should be a company-specific detail
    // selectedCompanyId comes from standalone modal when user selects a company
    const companyId = selectedCompanyId || (isCompanySpecific ? detailData.companyId : undefined);

    // Validate company if companyId is provided
    if (companyId) {
      const company = await prisma.company.findFirst({
        where: { id: companyId, tenantId, deletedAt: null },
      });
      if (!company) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }
    }

    const data = createContactDetailSchema.parse({
      ...detailData,
      contactId: id,
      companyId,
    });
    const detail = await createContactDetail(data, { tenantId, userId: session.id });

    return NextResponse.json(detail, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? 'Validation failed' }, { status: 400 });
    }
    return createErrorResponse(error, 'Failed to create contact detail');
  }
}
