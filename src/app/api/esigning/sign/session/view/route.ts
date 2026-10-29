import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { RATE_LIMIT_CONFIGS, getClientIp } from '@/lib/rate-limit';
import { enforceEsigningRateLimit, requireEsigningSameOrigin } from '@/lib/esigning-public-route';
import { recordEsigningSigningView } from '@/services/esigning-signing.service';

export async function POST(request: NextRequest) {
  const sameOriginError = requireEsigningSameOrigin(request);
  if (sameOriginError) {
    return sameOriginError;
  }

  const rateLimit = enforceEsigningRateLimit(
    request,
    'esigning_sign_load',
    'session-view',
    RATE_LIMIT_CONFIGS.ESIGNING_SIGN_LOAD
  );
  if ('response' in rateLimit) {
    return rateLimit.response;
  }

  try {
    const result = await recordEsigningSigningView({
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
