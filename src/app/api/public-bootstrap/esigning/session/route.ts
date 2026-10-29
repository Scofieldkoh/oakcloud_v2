import { NextRequest } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { enforceEsigningRateLimit } from '@/lib/esigning-public-route';
import { jsonWithServerTiming } from '@/lib/api/company-query';
import { loadEsigningSigningSession } from '@/services/esigning-signing.service';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  ESIGNING_SIGNATURE_SPECIMEN_PREFERENCE_KEY,
  parseSignatureSpecimen,
} from '@/lib/esigning-signature-specimen';

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  const rateLimit = enforceEsigningRateLimit(
    request,
    'esigning_sign_load',
    'session-bootstrap',
    RATE_LIMIT_CONFIGS.ESIGNING_SIGN_LOAD
  );
  if ('response' in rateLimit) {
    return rateLimit.response;
  }

  try {
    const result = await loadEsigningSigningSession();
    const authenticatedUser = await getSession();
    let savedSignatureSpecimenDataUrl: string | null = null;

    if (
      authenticatedUser &&
      authenticatedUser.email.trim().toLowerCase() === result.recipient.email?.trim().toLowerCase()
    ) {
      const preference = await prisma.userPreference.findUnique({
        where: {
          userId_key: {
            userId: authenticatedUser.id,
            key: ESIGNING_SIGNATURE_SPECIMEN_PREFERENCE_KEY,
          },
        },
        select: { value: true },
      });
      savedSignatureSpecimenDataUrl = parseSignatureSpecimen(preference?.value);
    }

    return jsonWithServerTiming({
      session: { ...result, savedSignatureSpecimenDataUrl },
    }, startedAt);
  } catch (error) {
    return createErrorResponse(error);
  }
}
