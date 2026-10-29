import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import {
  buildContentDispositionHeader,
  createErrorResponse,
  resolveWorkspaceId,
} from '@/lib/api-helpers';
import { getEsigningEnvelopeDetail } from '@/services/esigning-envelope.service';
import { downloadEsigningEnvelopePackage } from '@/services/esigning-pdf.service';

const downloadQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  variant: z.enum(['documents', 'documents_with_certificates', 'certificates']).optional().default('documents_with_certificates'),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'read');

    const { searchParams } = new URL(request.url);
    const parsed = downloadQuerySchema.parse({
      tenantId: searchParams.get('tenantId') ?? undefined,
      variant: searchParams.get('variant') ?? undefined,
    });
    const tenantId = resolveWorkspaceId(session, parsed.tenantId);

    await getEsigningEnvelopeDetail(session, tenantId, id);
    const result = await downloadEsigningEnvelopePackage({
      tenantId,
      envelopeId: id,
      variant: parsed.variant,
    });

    return new Response(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': buildContentDispositionHeader('attachment', result.fileName),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({ error: 'Invalid query', details: error.errors }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return createErrorResponse(error);
  }
}
