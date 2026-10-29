import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { isInternalError, routeErrorResponse } from '@/lib/api-route-errors';
import {
  createTemplatePartialSchema,
  searchTemplatePartialsSchema,
} from '@/lib/validations/template-partial';
import {
  createTemplatePartial,
  getAllTemplatePartials,
  searchTemplatePartials,
} from '@/services/template-partial.service';

function withRevision<T extends { version: number }>(value: T) {
  return { ...value, revision: value.version };
}

function apiError(error: unknown) {
  if (error instanceof Error && !isInternalError(error) && error.message.includes('must start with a letter')) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return routeErrorResponse(error, { conflict: ['A partial with this name already exists'] });
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantIdParam = searchParams.get('tenantId');
    const effectiveTenantId =
      session.isSuperAdmin && tenantIdParam ? tenantIdParam : session.tenantId;

    if (!effectiveTenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    if (searchParams.get('all') === 'true') {
      const partials = await getAllTemplatePartials(effectiveTenantId);
      return NextResponse.json({ partials: partials.map(withRevision) });
    }

    const input = searchTemplatePartialsSchema.parse({
      search: searchParams.get('search') || undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 20,
      sortBy: searchParams.get('sortBy') || 'name',
      sortOrder: searchParams.get('sortOrder') || 'asc',
      editor: searchParams.get('editor') || undefined,
      category: searchParams.get('category') || undefined,
      name: searchParams.get('name') || undefined,
      description: searchParams.get('description') || undefined,
      usage: searchParams.get('usage') || undefined,
      reference: searchParams.get('reference') || undefined,
      createdBy: searchParams.get('createdBy') || undefined,
      updatedFrom: searchParams.get('updatedFrom') || undefined,
      updatedTo: searchParams.get('updatedTo') || undefined,
    });

    const result = await searchTemplatePartials(input, {
      tenantId: effectiveTenantId,
      userId: session.id,
    });

    return NextResponse.json({
      ...result,
      partials: result.partials.map(withRevision),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'create');

    const body = await request.json();
    const { tenantId: bodyTenantId, ...partialData } = body;
    const effectiveTenantId =
      session.isSuperAdmin && bodyTenantId ? bodyTenantId : session.tenantId;

    if (!effectiveTenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    const input = createTemplatePartialSchema.parse(partialData);
    const partial = await createTemplatePartial(input, {
      tenantId: effectiveTenantId,
      userId: session.id,
    });

    return NextResponse.json(withRevision(partial), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
