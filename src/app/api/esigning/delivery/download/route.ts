import { NextRequest } from 'next/server';
import { z } from 'zod';
import { buildContentDispositionHeader, createErrorResponse } from '@/lib/api-helpers';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { enforceEsigningRateLimit } from '@/lib/esigning-public-route';
import { downloadEsigningDeliveryDocument } from '@/services/esigning-pdf.service';

const deliveryDownloadSchema = z.object({
  token: z.string().min(1),
  documentId: z.string().uuid(),
  variant: z.enum(['signed', 'certificate']).optional().default('signed'),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = deliveryDownloadSchema.safeParse({
    token: searchParams.get('token') || undefined,
    documentId: searchParams.get('documentId') || undefined,
    variant: searchParams.get('variant') || 'signed',
  });

  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid query', details: parsed.error.errors }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rateLimit = enforceEsigningRateLimit(
    request,
    'esigning_delivery_download',
    parsed.data.documentId,
    RATE_LIMIT_CONFIGS.ESIGNING_SIGN_DOWNLOAD
  );
  if ('response' in rateLimit) {
    return rateLimit.response;
  }

  try {
    const result = await downloadEsigningDeliveryDocument(parsed.data);

    return new Response(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': buildContentDispositionHeader('attachment', result.fileName),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
