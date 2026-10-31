import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { ESIGNING_LIMITS } from '@/lib/validations/esigning';
import { createEsigningEnvelopeFromGeneratedDocuments } from '@/services/esigning-envelope.service';
import { esigningValidationErrorResponse } from '@/lib/esigning-validation-response';

const bodySchema = z.object({
  tenantId: z.string().uuid().optional(),
  generatedDocumentIds: z.array(z.string().uuid()).min(1).max(ESIGNING_LIMITS.MAX_DOCUMENTS),
  finalizeDrafts: z.boolean().default(false),
});

/**
 * POST /api/esigning/envelopes/from-documents
 * Create a draft envelope from generated documents with their signers added
 * ({ generatedDocumentIds, finalizeDrafts? }).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'create');
    await requirePermission(session, 'esigning', 'update');
    await requirePermission(session, 'document', 'read');

    const body = bodySchema.parse(await request.json());
    if (body.finalizeDrafts) await requirePermission(session, 'document', 'update');
    const tenantId = resolveWorkspaceId(session, body.tenantId);
    const result = await createEsigningEnvelopeFromGeneratedDocuments(session, tenantId, body);
    return NextResponse.json({
      id: result.envelope.id,
      signersAdded: result.signersAdded,
      signersWithoutEmail: result.signersWithoutEmail,
      finalized: result.finalized,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return esigningValidationErrorResponse(error);
    }
    return createErrorResponse(error);
  }
}
