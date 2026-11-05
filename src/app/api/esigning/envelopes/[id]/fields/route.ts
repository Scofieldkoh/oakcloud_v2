import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { saveEsigningFieldDefinitionsSchema } from '@/lib/validations/esigning';
import { saveEsigningEnvelopeFields } from '@/services/esigning-envelope.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'update');

    const body = await request.json();
    const tenantId = resolveWorkspaceId(session, body.tenantId);
    const parsed = saveEsigningFieldDefinitionsSchema.parse(body);
    const { envelope, fieldWarnings } = await saveEsigningEnvelopeFields(session, tenantId, id, parsed);

    return NextResponse.json({ ...envelope, fieldWarnings });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}
