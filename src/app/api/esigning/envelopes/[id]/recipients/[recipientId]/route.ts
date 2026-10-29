import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { updateEsigningRecipientSchema } from '@/lib/validations/esigning';
import {
  removeEsigningEnvelopeRecipient,
  updateEsigningEnvelopeRecipient,
} from '@/services/esigning-envelope.service';

interface RouteParams {
  params: Promise<{ id: string; recipientId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, recipientId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'update');

    const body = await request.json();
    const tenantId = resolveWorkspaceId(session, body.tenantId);
    const { tenantId: _tenantId, ...payload } = body;
    const parsed = updateEsigningRecipientSchema.parse(payload);

    const result = await updateEsigningEnvelopeRecipient(
      session,
      tenantId,
      id,
      recipientId,
      parsed
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, recipientId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'update');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));

    const result = await removeEsigningEnvelopeRecipient(session, tenantId, id, recipientId);
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
