import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createPublicFormResponseToken,
  getPublicFormResponseEmailLinkTokenTtlSeconds,
  verifyPublicFormResponseToken,
} from '@/lib/form-response-token';
import { checkRateLimit, getClientIp, getRateLimitKey, RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { emailPublicFormResponsePdfLink } from '@/services/form-builder.service';
import { createErrorResponse } from '@/lib/api-helpers';

const emailPayloadSchema = z.object({
  email: z.string().email().max(320),
  accessToken: z.string().min(20),
});

interface RouteParams {
  params: Promise<{
    slug: string;
    submissionId: string;
  }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { slug, submissionId } = await params;

    const ip = getClientIp(request);
    const rl = checkRateLimit(getRateLimitKey('form-submit', `${ip}:${slug}:email`), RATE_LIMIT_CONFIGS.FORM_SUBMIT);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json();
    const payload = emailPayloadSchema.parse(body);

    const hasEmailAccess = await verifyPublicFormResponseToken(payload.accessToken, {
      slug,
      submissionId,
      scope: 'public_form_pdf_email_request',
    });

    if (!hasEmailAccess) {
      return NextResponse.json({ error: 'Invalid or expired email access token' }, { status: 403 });
    }

    const emailLinkToken = await createPublicFormResponseToken({
      slug,
      submissionId,
      scope: 'public_form_pdf_download',
      expiresInSeconds: getPublicFormResponseEmailLinkTokenTtlSeconds(),
    });

    await emailPublicFormResponsePdfLink(slug, submissionId, payload.email, emailLinkToken);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid email payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}
