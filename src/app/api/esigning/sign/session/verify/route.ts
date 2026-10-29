import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createErrorResponse } from '@/lib/api-helpers';
import { getEsigningChallengeClaims } from '@/lib/esigning-session';
import {
  RATE_LIMIT_CONFIGS,
  getRateLimitKey,
  recordFailure,
  recordSuccess,
} from '@/lib/rate-limit';
import { enforceEsigningRateLimit, requireEsigningSameOrigin } from '@/lib/esigning-public-route';
import { verifyEsigningAccessCodeSchema } from '@/lib/validations/esigning';
import { verifyEsigningAccessCode } from '@/services/esigning-signing.service';

export async function POST(request: NextRequest) {
  const sameOriginError = requireEsigningSameOrigin(request);
  if (sameOriginError) {
    return sameOriginError;
  }

  const claims = await getEsigningChallengeClaims();
  const identifier = claims?.recipientId ?? 'unknown';
  const rateLimit = enforceEsigningRateLimit(
    request,
    'esigning_sign_verify',
    identifier,
    RATE_LIMIT_CONFIGS.ESIGNING_SIGN_VERIFY
  );
  if ('response' in rateLimit) {
    return rateLimit.response;
  }

  const rateLimitKey = getRateLimitKey('esigning_sign_verify', `${rateLimit.ip}:${identifier}`);

  try {
    const body = verifyEsigningAccessCodeSchema.parse(await request.json());
    await verifyEsigningAccessCode(body.accessCode);
    recordSuccess(rateLimitKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    recordFailure(rateLimitKey, RATE_LIMIT_CONFIGS.ESIGNING_SIGN_VERIFY);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}
