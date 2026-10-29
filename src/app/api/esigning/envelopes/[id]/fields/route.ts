import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { saveEsigningFieldDefinitionsSchema } from '@/lib/validations/esigning';
import { getEsigningEnvelopeDetail } from '@/services/esigning-envelope.service';
import { saveEnvelopeFieldDefinitions } from '@/services/esigning-field.service';

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
    const detail = await getEsigningEnvelopeDetail(session, tenantId, id);

    if (!detail.canEdit) {
      throw new Error('Forbidden');
    }

    const parsed = saveEsigningFieldDefinitionsSchema.parse(body);
    const fieldWarnings = await saveEnvelopeFieldDefinitions(id, parsed);

    const updated = await getEsigningEnvelopeDetail(session, tenantId, id);
    return NextResponse.json({ ...updated, fieldWarnings });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}
