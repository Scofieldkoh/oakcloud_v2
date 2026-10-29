import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { canAccessCompany, requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { COMPANY_FIELD_HOME_IDS } from '@/lib/document-editor/oakdoc-company-field-ids';
import {
  getCompanyDocumentFieldValues,
  saveCompanyDocumentField,
} from '@/services/company/document-field-values.service';

type RouteContext = { params: Promise<{ id: string }> };

const saveSchema = z.object({
  fieldId: z.enum(COMPANY_FIELD_HOME_IDS),
  value: z.string().max(2000),
}).strict();

/** Values the given `company.*` tags print for this company (`?tags=a,b`). */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');
    const { id } = await params;
    if (!(await canAccessCompany(session, id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const tags = (request.nextUrl.searchParams.get('tags') ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 200);
    const values = await getCompanyDocumentFieldValues(id, requireSessionWorkspaceId(session), tags);
    return NextResponse.json({ values });
  } catch (error) {
    return createErrorResponse(error);
  }
}

/** Save a value that was missing for the company to where the company keeps it. */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    if (!(await canAccessCompany(session, id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await requirePermission(session, 'company', 'update', id);
    const parsed = saveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Choose a company field and enter its value.' }, { status: 400 });
    }
    const result = await saveCompanyDocumentField({
      companyId: id,
      tenantId: requireSessionWorkspaceId(session),
      userId: session.id,
      fieldId: parsed.data.fieldId,
      value: parsed.data.value,
    });
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
