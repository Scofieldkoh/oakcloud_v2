import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createErrorResponse } from '@/lib/api-helpers';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { enforceEsigningRateLimit, requireEsigningSameOrigin } from '@/lib/esigning-public-route';
import { declineEsigningEnvelopeSchema } from '@/lib/validations/esigning';
import { declineEsigningSigningSession } from '@/services/esigning-signing.service';

export async function POST(request: NextRequest) {
  const sameOriginError = requireEsigningSameOrigin(request);
  if (sameOriginError) {
    return sameOriginError;
  }

  const rateLimit = enforceEsigningRateLimit(
    request,
    'esigning_sign_decline',
    'session-decline',
    RATE_LIMIT_CONFIGS.ESIGNING_SIGN_DECLINE
  );
  if ('response' in rateLimit) {
    return rateLimit.response;
  }

  try {
    const body = declineEsigningEnvelopeSchema.parse(await request.json());
    await declineEsigningSigningSession({ reason: body.reason });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}
