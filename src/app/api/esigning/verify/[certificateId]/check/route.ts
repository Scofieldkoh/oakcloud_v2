import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { hashBlake3 } from '@/lib/encryption';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { enforceEsigningRateLimit, requireEsigningSameOrigin } from '@/lib/esigning-public-route';
import { getEsigningVerificationData } from '@/services/esigning-certificate.service';

interface RouteParams {
  params: Promise<{ certificateId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const sameOriginError = requireEsigningSameOrigin(request);
  if (sameOriginError) {
    return sameOriginError;
  }

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
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const verification = await getEsigningVerificationData(certificateId);
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileHash = hashBlake3(buffer);
    const matchedDocument = verification.documents.find((document) => document.hash === fileHash);

    return NextResponse.json({
      matched: Boolean(matchedDocument),
      fileHash,
      document: matchedDocument ?? null,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
