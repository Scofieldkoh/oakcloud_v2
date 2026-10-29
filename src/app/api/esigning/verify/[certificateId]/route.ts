import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { enforceEsigningRateLimit } from '@/lib/esigning-public-route';
import { getEsigningVerificationData } from '@/services/esigning-certificate.service';

interface RouteParams {
  params: Promise<{ certificateId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { certificateId } = await params;
  const rateLimit = enforceEsigningRateLimit(
    request,
    'esigning_verify',
    certificateId,
    RATE_LIMIT_CONFIGS.ESIGNING_VERIFY
  );
  if ('response' in rateLimit) {
    return rateLimit.response;
  }

  try {
    const result = await getEsigningVerificationData(certificateId);
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
