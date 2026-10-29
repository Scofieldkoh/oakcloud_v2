import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveWorkspaceId, createErrorResponse } from '@/lib/api-helpers';
import {
  createFormSchema,
  listFormsQuerySchema,
} from '@/lib/validations/form-builder';
import { createForm, listForms } from '@/services/form-builder.service';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));

    const query = listFormsQuerySchema.parse({
      query: searchParams.get('query') || undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : 1,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : 20,
      status: searchParams.get('status') || undefined,
      sortBy: searchParams.get('sortBy') || 'updatedAt',
      sortOrder: searchParams.get('sortOrder') || 'desc',
    });

    const result = await listForms(query, {
      tenantId,
      userId: session.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'create');

    const body = await request.json();
    const tenantId = resolveWorkspaceId(session, body.tenantId);
    const payload = createFormSchema.parse(body);

    const form = await createForm(payload, {
      tenantId,
      userId: session.id,
    });

    return NextResponse.json(form, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}
