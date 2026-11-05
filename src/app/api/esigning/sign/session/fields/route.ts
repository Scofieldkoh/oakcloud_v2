import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createErrorResponse } from '@/lib/api-helpers';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { enforceEsigningRateLimit, requireEsigningSameOrigin } from '@/lib/esigning-public-route';
import { saveEsigningFieldValuesSchema } from '@/lib/validations/esigning';
import { saveEsigningSigningFieldValues } from '@/services/esigning-signing.service';
import { esigningValidationErrorResponse } from '@/lib/esigning-validation-response';
import { ESIGNING_PAYLOAD_LIMITS } from '@/lib/esigning-payload-limits';
import { readLimitedJson } from '@/lib/esigning-request-body';

export async function PUT(request: NextRequest) {
  const sameOriginError = requireEsigningSameOrigin(request);
  if (sameOriginError) {
    return sameOriginError;
  }

  const rateLimit = enforceEsigningRateLimit(
    request,
    'esigning_sign_save',
    'session-fields',
    RATE_LIMIT_CONFIGS.ESIGNING_SIGN_SAVE
  );
  if ('response' in rateLimit) {
    return rateLimit.response;
  }

  try {
    const body = saveEsigningFieldValuesSchema.parse(
      await readLimitedJson(request, ESIGNING_PAYLOAD_LIMITS.SIGNING_VALUES_BODY_BYTES)
    );
    const result = await saveEsigningSigningFieldValues(body.values);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return esigningValidationErrorResponse(error);
    }

    return createErrorResponse(error);
  }
}
