import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { enforceEsigningRateLimit, requireEsigningSameOrigin } from '@/lib/esigning-public-route';
import { exchangeEsigningLinkToken } from '@/services/esigning-signing.service';

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const sameOriginError = requireEsigningSameOrigin(request);
  if (sameOriginError) {
    return sameOriginError;
  }

  const { token } = await params;
  const rateLimit = enforceEsigningRateLimit(
    request,
    'esigning_sign_load',
    token,
    RATE_LIMIT_CONFIGS.ESIGNING_SIGN_LOAD
  );
  if ('response' in rateLimit) {
    return rateLimit.response;
  }

  try {
    const result = await exchangeEsigningLinkToken(token);
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
