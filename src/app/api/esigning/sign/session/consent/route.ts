import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createErrorResponse } from '@/lib/api-helpers';
import { RATE_LIMIT_CONFIGS, getClientIp } from '@/lib/rate-limit';
import { enforceEsigningRateLimit, requireEsigningSameOrigin } from '@/lib/esigning-public-route';
import { recordEsigningConsentSchema } from '@/lib/validations/esigning';
import { recordEsigningSigningConsent } from '@/services/esigning-signing.service';

export async function POST(request: NextRequest) {
  const sameOriginError = requireEsigningSameOrigin(request);
  if (sameOriginError) {
    return sameOriginError;
  }

  const rateLimit = enforceEsigningRateLimit(
    request,
    'esigning_sign_save',
    'session-consent',
    RATE_LIMIT_CONFIGS.ESIGNING_SIGN_SAVE
  );
  if ('response' in rateLimit) {
    return rateLimit.response;
  }

  try {
    recordEsigningConsentSchema.parse(await request.json());

    const result = await recordEsigningSigningConsent({
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}
