import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { duplicateEsigningEnvelope } from '@/services/esigning-envelope.service';

const duplicateEnvelopeSchema = z.object({
  tenantId: z.string().uuid().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'create');

    const body = duplicateEnvelopeSchema.parse(await request.json().catch(() => ({})));
    const tenantId = resolveWorkspaceId(session, body.tenantId);

    const result = await duplicateEsigningEnvelope(session, tenantId, id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}
