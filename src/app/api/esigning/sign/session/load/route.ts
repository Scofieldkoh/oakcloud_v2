import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { enforceEsigningRateLimit } from '@/lib/esigning-public-route';
import { loadEsigningSigningSession } from '@/services/esigning-signing.service';

export async function GET(request: NextRequest) {
  const rateLimit = enforceEsigningRateLimit(
    request,
    'esigning_sign_load',
    'session-load',
    RATE_LIMIT_CONFIGS.ESIGNING_SIGN_LOAD
  );
  if ('response' in rateLimit) {
    return rateLimit.response;
  }

  try {
    const result = await loadEsigningSigningSession();
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
