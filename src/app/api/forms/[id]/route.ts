import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveWorkspaceId, createErrorResponse } from '@/lib/api-helpers';
import {
  saveFormFieldsSchema,
  updateFormSchema,
} from '@/lib/validations/form-builder';
import {
  deleteForm,
  getFormById,
  saveFormFields,
  updateForm,
} from '@/services/form-builder.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));

    const form = await getFormById(id, tenantId);
    if (!form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    return NextResponse.json(form);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');

    const body = await request.json();
    const tenantId = resolveWorkspaceId(session, body.tenantId);
    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    let updatedAny = false;

    const formPatchCandidate: Record<string, unknown> = {};
    for (const key of ['title', 'description', 'status', 'tags', 'slug', 'settings']) {
      if (key in body) {
        formPatchCandidate[key] = body[key];
      }
    }

    if (Object.keys(formPatchCandidate).length > 0) {
      const updateInput = updateFormSchema.parse(formPatchCandidate);
      await updateForm(
        id,
        updateInput,
        {
          tenantId,
          userId: session.id,
        },
        reason
      );
      updatedAny = true;
    }

    if (Array.isArray(body.fields)) {
      const parsed = saveFormFieldsSchema.parse({ fields: body.fields });
      await saveFormFields(
        id,
        parsed.fields,
        {
          tenantId,
          userId: session.id,
        },
        reason
      );
      updatedAny = true;
    }

    if (!updatedAny) {
      return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 });
    }

    const form = await getFormById(id, tenantId);
    if (!form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    return NextResponse.json(form);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'delete');

    const { searchParams } = new URL(request.url);
    const reason = searchParams.get('reason') || undefined;
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));

    const form = await deleteForm(
      id,
      {
        tenantId,
        userId: session.id,
      },
      reason || undefined
    );

    return NextResponse.json(form);
  } catch (error) {
    return createErrorResponse(error);
  }
}
