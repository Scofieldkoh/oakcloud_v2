import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveWorkspaceId, createErrorResponse } from '@/lib/api-helpers';
import { duplicateFormSchema } from '@/lib/validations/form-builder';
import { duplicateForm } from '@/services/form-builder.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'create');

    const body = await request.json().catch(() => ({}));
    const tenantId = resolveWorkspaceId(session, body?.tenantId);
    const payload = duplicateFormSchema.parse(body ?? {});

    const form = await duplicateForm(id, { tenantId, userId: session.id }, payload.title);

    return NextResponse.json(form, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}
