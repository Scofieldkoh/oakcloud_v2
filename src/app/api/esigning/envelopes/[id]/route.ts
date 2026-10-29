import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { updateEsigningEnvelopeSchema } from '@/lib/validations/esigning';
import {
  deleteDraftEsigningEnvelope,
  getEsigningEnvelopeDetail,
  updateDraftEsigningEnvelope,
} from '@/services/esigning-envelope.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));

    const result = await getEsigningEnvelopeDetail(session, tenantId, id);
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'update');

    const body = await request.json();
    const tenantId = resolveWorkspaceId(session, body.tenantId);
    const { tenantId: _tenantId, ...payload } = body;
    const parsed = updateEsigningEnvelopeSchema.parse(payload);

    const result = await updateDraftEsigningEnvelope(session, tenantId, id, parsed);
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
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'delete');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));

    await deleteDraftEsigningEnvelope(session, tenantId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return createErrorResponse(error);
  }
}
