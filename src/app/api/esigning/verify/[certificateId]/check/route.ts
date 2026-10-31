import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { enforceEsigningRateLimit, requireEsigningSameOrigin } from '@/lib/esigning-public-route';
import {
  findIssuedArtifactMatch,
  getEsigningVerificationData,
} from '@/services/esigning-certificate.service';

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
    // Matches any file issued for this certificate: the signed document, the certificate, or the
    // document with its certificate (the emailed and filed copy), in any version.
    const match = await findIssuedArtifactMatch(certificateId, buffer);
    const matchedDocument = match.documentId
      ? verification.documents.find((document) => document.id === match.documentId)
      : undefined;

    return NextResponse.json({
      matched: match.matched,
      fileHash: match.fileHash,
      document: matchedDocument ?? null,
      artifact: match.artifact,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
