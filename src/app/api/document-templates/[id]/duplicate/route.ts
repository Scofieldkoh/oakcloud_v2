import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { duplicateDocumentTemplateSchema } from '@/lib/validations/document-template';
import { duplicateDocumentTemplate } from '@/services/document-template.service';
import { createErrorResponse } from '@/lib/api-helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'document', 'create');

    const body = await request.json();
    const data = duplicateDocumentTemplateSchema.parse({ ...body, id });
    let tenantId = session.tenantId;
    if (session.isSuperAdmin && body.tenantId) tenantId = body.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    const template = await duplicateDocumentTemplate(data, { tenantId, userId: session.id });
    return NextResponse.json({ ...template, revision: template.version }, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
