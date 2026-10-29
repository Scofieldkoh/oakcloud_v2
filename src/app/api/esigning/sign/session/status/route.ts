import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { enforceEsigningRateLimit } from '@/lib/esigning-public-route';
import { getEsigningSigningSessionStatus } from '@/services/esigning-signing.service';

export async function GET(request: NextRequest) {
  const rateLimit = enforceEsigningRateLimit(
    request,
    'esigning_sign_status',
    'session-status',
    RATE_LIMIT_CONFIGS.ESIGNING_SIGN_LOAD
  );
  if ('response' in rateLimit) {
    return rateLimit.response;
  }

  try {
    const result = await getEsigningSigningSessionStatus();
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
