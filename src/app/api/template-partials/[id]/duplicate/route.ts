import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { isInternalError, routeErrorResponse } from '@/lib/api-route-errors';
import { duplicateTemplatePartialSchema } from '@/lib/validations/template-partial';
import { duplicateTemplatePartial } from '@/services/template-partial.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'create');

    if (!session.tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    const { id } = await params;
    const body = await request.json();
    const input = duplicateTemplatePartialSchema.parse({ ...body, id });
    const partial = await duplicateTemplatePartial(id, input.name, {
      tenantId: session.tenantId,
      userId: session.id,
    });

    return NextResponse.json({ ...partial, revision: partial.version }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && !isInternalError(error) && error.message.includes('must start with a letter')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return routeErrorResponse(error, {
      notFound: ['Partial not found'],
      conflict: ['A partial with this name already exists'],
    });
  }
}
