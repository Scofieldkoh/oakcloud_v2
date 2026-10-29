import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { requireWorkspaceContext } from '@/lib/api-helpers';
import { updateCompanySchema, deleteCompanySchema } from '@/lib/validations/company';
import { parseIdParams } from '@/lib/validations/params';
import {
  getCompanyById,
  getCompanyFullDetails,
  updateCompany,
  deleteCompany,
  restoreCompany,
  permanentDeleteCompany,
} from '@/services/company.service';
import { routeErrorResponse } from '@/lib/api-route-errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    // SECURITY: Validate ID format before any database operations
    const { id } = await parseIdParams(params);
    const { searchParams } = new URL(request.url);
    const tenantResult = await requireWorkspaceContext(session, searchParams.get('tenantId'));
    if ('error' in tenantResult) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Check permission - RBAC will handle SUPER_ADMIN bypass
    await requirePermission(session, 'company', 'read', id);

    // Additional check for company-scoped users
    if (!(await canAccessCompany(session, id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const full = searchParams.get('full') === 'true';

    const company = full
      ? await getCompanyFullDetails(id, tenantId)
      : await getCompanyById(id, tenantId);

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    return NextResponse.json(company);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    // SECURITY: Validate ID format before any database operations
    const { id } = await parseIdParams(params);
    const { searchParams } = new URL(request.url);

    // Check permission - allows SUPER_ADMIN, TENANT_ADMIN, and COMPANY_ADMIN (for their company)
    await requirePermission(session, 'company', 'update', id);

    // Additional check for company access
    if (!(await canAccessCompany(session, id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const data = updateCompanySchema.parse({ ...body, id });
    const tenantResult = await requireWorkspaceContext(
      session,
      typeof body.tenantId === 'string' ? body.tenantId : searchParams.get('tenantId')
    );
    if ('error' in tenantResult) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Get the company with tenant validation
    const existingCompany = await prisma.company.findUnique({
      where: { id, tenantId },
      select: { tenantId: true },
    });

    if (!existingCompany) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const company = await updateCompany(
      data,
      { tenantId: existingCompany.tenantId, userId: session.id },
      body.reason
    );

    return NextResponse.json(company);
  } catch (error) {
    return routeErrorResponse(error, { notFound: ['Company not found'], fallback: 'bad-request' });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await parseIdParams(params);
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // Check permission - allows SUPER_ADMIN and TENANT_ADMIN
    await requirePermission(session, 'company', 'delete', id);

    const tenantResult = await requireWorkspaceContext(
      session,
      searchParams.get('tenantId')
    );
    if ('error' in tenantResult) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    const existingCompany = await prisma.company.findUnique({
      where: { id, tenantId },
      select: { tenantId: true },
    });

    if (!existingCompany) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    if (action === 'permanent') {
      await permanentDeleteCompany(id, {
        tenantId: existingCompany.tenantId,
        userId: session.id,
      });
      return NextResponse.json({ success: true });
    }

    // Default: soft delete — requires reason in body
    const body = await request.json();
    const data = deleteCompanySchema.parse({ id, reason: body.reason });

    const company = await deleteCompany(
      data.id,
      { tenantId: existingCompany.tenantId, userId: session.id },
      data.reason
    );

    return NextResponse.json(company);
  } catch (error) {
    if (error instanceof Error && error.message === 'Company must be soft-deleted before permanent deletion') {
      return NextResponse.json(
        { error: 'Company must be in the recycle bin before it can be permanently deleted' },
        { status: 422 }
      );
    }
    return routeErrorResponse(error, { notFound: ['Company not found'], fallback: 'bad-request' });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    // SECURITY: Validate ID format before any database operations
    const { id } = await parseIdParams(params);

    // Check permission for restore (treated as update)
    await requirePermission(session, 'company', 'update', id);

    const { searchParams } = new URL(request.url);
    const tenantResult = await requireWorkspaceContext(session, searchParams.get('tenantId'));
    if ('error' in tenantResult) return tenantResult.error;
    const tenantId = tenantResult.tenantId;
    const action = searchParams.get('action');

    if (action === 'restore') {
      const existingCompany = await prisma.company.findUnique({
        where: { id, tenantId },
        select: { tenantId: true },
      });

      if (!existingCompany) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }

      const company = await restoreCompany(
        id,
        { tenantId: existingCompany.tenantId, userId: session.id }
      );
      return NextResponse.json(company);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return routeErrorResponse(error, { notFound: ['Company not found'], fallback: 'bad-request' });
  }
}
