import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createPublicFormResponseToken,
  getPublicFormResponseSubmitDownloadTokenTtlSeconds,
  getPublicFormResponseSubmitEmailRequestTokenTtlSeconds,
} from '@/lib/form-response-token';
import { checkRateLimit, getClientIp, getRateLimitKey, RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { publicSubmissionSchema } from '@/lib/validations/form-builder';
import { createPublicSubmission } from '@/services/form-builder.service';
import { createErrorResponse } from '@/lib/api-helpers';
import { isInternalError } from '@/lib/api-route-errors';
import { ApiError } from '@/lib/errors';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { slug } = await params;

    const ip = getClientIp(request);
    const rl = checkRateLimit(getRateLimitKey('form-submit', `${ip}:${slug}`), RATE_LIMIT_CONFIGS.FORM_SUBMIT);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json();

    const payload = publicSubmissionSchema.parse(body);

    const submission = await createPublicSubmission(slug, payload);
    const downloadTokenTtlSeconds = getPublicFormResponseSubmitDownloadTokenTtlSeconds();
    const emailRequestTokenTtlSeconds = getPublicFormResponseSubmitEmailRequestTokenTtlSeconds();

    const [pdfDownloadToken, pdfEmailAccessToken] = await Promise.all([
      createPublicFormResponseToken({
        slug,
        submissionId: submission.id,
        scope: 'public_form_pdf_download',
        expiresInSeconds: downloadTokenTtlSeconds,
      }),
      createPublicFormResponseToken({
        slug,
        submissionId: submission.id,
        scope: 'public_form_pdf_email_request',
        expiresInSeconds: emailRequestTokenTtlSeconds,
      }),
    ]);

    return NextResponse.json(
      {
        id: submission.id,
        submittedAt: submission.submittedAt,
        pdfDownloadToken,
        pdfDownloadTokenTtlSeconds: downloadTokenTtlSeconds,
        pdfEmailAccessToken,
        pdfEmailAccessTokenTtlSeconds: emailRequestTokenTtlSeconds,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid submission payload', details: error.errors }, { status: 400 });
    }

    if (
      error instanceof Error
      && !(error instanceof ApiError)
      && !isInternalError(error)
      && error.message.includes('required')
    ) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }

    return createErrorResponse(error);
  }
}
