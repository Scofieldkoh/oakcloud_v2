import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { ESIGNING_LIMITS } from '@/lib/validations/esigning';
import {
  attachGeneratedDocumentsToEsigningEnvelope,
  uploadEsigningEnvelopeDocument,
} from '@/services/esigning-envelope.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'update');

    if (request.headers.get('content-type')?.includes('application/json')) {
      await requirePermission(session, 'document', 'read');
      const body = await request.json();
      const generatedDocumentIds = z.array(z.string().uuid()).min(1).max(ESIGNING_LIMITS.MAX_DOCUMENTS).refine(
        (ids) => new Set(ids).size === ids.length,
        'Selected generated documents must be distinct',
      ).parse(body.generatedDocumentIds);
      const tenantId = resolveWorkspaceId(session, body.tenantId);
      const result = await attachGeneratedDocumentsToEsigningEnvelope(
        session,
        tenantId,
        id,
        generatedDocumentIds,
      );
      return NextResponse.json(result, { status: 201 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const tenantId = resolveWorkspaceId(session, formData.get('tenantId')?.toString());

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const result = await uploadEsigningEnvelopeDocument(session, tenantId, id, file);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
