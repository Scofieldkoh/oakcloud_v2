import { NextRequest } from 'next/server';
import { z } from 'zod';
import { buildContentDispositionHeader, createErrorResponse } from '@/lib/api-helpers';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { enforceEsigningRateLimit } from '@/lib/esigning-public-route';
import { downloadEsigningSessionDocument } from '@/services/esigning-signing.service';

const downloadSchema = z.object({
  documentId: z.string().uuid(),
  token: z.string().optional(),
  variant: z.enum(['original', 'signed']).optional().default('original'),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = downloadSchema.safeParse({
    documentId: searchParams.get('documentId') || undefined,
    token: searchParams.get('token') || undefined,
    variant: searchParams.get('variant') || 'original',
  });

  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid query', details: parsed.error.errors }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rateLimit = enforceEsigningRateLimit(
    request,
    'esigning_sign_download',
    parsed.data.documentId,
    RATE_LIMIT_CONFIGS.ESIGNING_SIGN_DOWNLOAD
  );
  if ('response' in rateLimit) {
    return rateLimit.response;
  }

  try {
    const result = await downloadEsigningSessionDocument({
      documentId: parsed.data.documentId,
      token: parsed.data.token,
      variant: parsed.data.variant,
    });

    return new Response(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': buildContentDispositionHeader('inline', result.fileName),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
