import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ValidationError } from '@/lib/errors';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import {
  COMPANY_PROFILE_SECTIONS,
  type CompanyProfileSectionId,
} from '@/lib/company-profile-sections';
import {
  companyProfileSectionSchemas,
  sectionMutationEnvelopeSchema,
} from '@/lib/validations/company-profile';
import {
  CompanyProfileConflictError,
  CompanyProfileNotFoundError,
  getCompanyProfileSection,
  saveCompanyProfileSection,
} from '@/services/company/profile-sections';

type RouteContext = { params: Promise<{ id: string; section: string }> };

function validSection(value: string): value is CompanyProfileSectionId {
  return COMPANY_PROFILE_SECTIONS.includes(value as CompanyProfileSectionId);
}

function errorResponse(error: unknown) {
  if (error instanceof CompanyProfileConflictError) {
    return NextResponse.json({
      error: 'This section changed after you opened it',
      latest: error.latest,
    }, { status: 409 });
  }
  if (error instanceof CompanyProfileNotFoundError) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({
      error: 'Please correct the highlighted fields',
      issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    }, { status: 400 });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return routeErrorResponse(error);
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { id, section } = await context.params;
    if (!validSection(section)) return NextResponse.json({ error: 'Unknown profile section' }, { status: 404 });
    if (!(await canAccessCompany(session, id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(await getCompanyProfileSection(id, session.tenantId!, section));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await requireAuth();
    const { id, section } = await context.params;
    if (!validSection(section)) return NextResponse.json({ error: 'Unknown profile section' }, { status: 404 });
    if (!(await canAccessCompany(session, id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await requirePermission(session, 'company', 'update', id);
    const envelope = sectionMutationEnvelopeSchema.parse(await request.json());
    const data = companyProfileSectionSchemas[section].parse(envelope.data);
    return NextResponse.json(await saveCompanyProfileSection({
      companyId: id,
      tenantId: session.tenantId!,
      userId: session.id,
      section,
      ifMatchVersion: envelope.ifMatchVersion,
      reason: envelope.reason,
      data,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
