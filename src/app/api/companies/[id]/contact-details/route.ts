import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { requireWorkspaceContext } from '@/lib/api-helpers';
import {
  getCompanyContactDetails,
  createContactDetail,
} from '@/services/contact-detail.service';
import { createContactDetailSchema } from '@/lib/validations/contact-detail';
import { ZodError } from 'zod';
import { routeErrorResponse } from '@/lib/api-route-errors';

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/companies/[id]/contact-details
 * Get all contact details for a company (including linked contacts' details)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id: companyId } = await params;

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

    const result = await getCompanyContactDetails(companyId, tenantId);

    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, { notFound: ['Company not found'], logLabel: 'Error fetching company contact details:' });
  }
}

/**
 * POST /api/companies/[id]/contact-details
 * Create a new contact detail for the company
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
    const { tenantId: bodyTenantId, isCompanySpecific, ...detailData } = body;
    const tenantResult = await requireWorkspaceContext(session, bodyTenantId);
    if (tenantResult.error) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Parse and validate input
    // If isCompanySpecific is true and contactId is provided, this creates a company-specific detail
    // (both contactId and companyId will be set)
    // If isCompanySpecific is false/undefined, and contactId is provided, this creates a default contact detail
    // (only contactId will be set, companyId will be null)
    const shouldSetCompanyId = isCompanySpecific && detailData.contactId;
    const data = createContactDetailSchema.parse({
      ...detailData,
      // Only set companyId if:
      // 1. No contactId (company-level detail), OR
      // 2. isCompanySpecific is true (company-specific contact detail)
      companyId: (!detailData.contactId || shouldSetCompanyId) ? companyId : undefined,
    });

    const contactDetail = await createContactDetail(data, {
      tenantId,
      userId: session.id,
    });

    return NextResponse.json(contactDetail, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    return routeErrorResponse(error, { notFound: ['Company not found', 'Contact not found'], logLabel: 'Error creating contact detail:' });
  }
}
