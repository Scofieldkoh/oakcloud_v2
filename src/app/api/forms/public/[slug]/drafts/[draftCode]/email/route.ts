import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, getClientIp, getRateLimitKey, RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { emailPublicFormDraft } from '@/services/form-builder.service';
import { createErrorResponse } from '@/lib/api-helpers';

const emailPayloadSchema = z.object({
  email: z.string().email().max(320),
  accessToken: z.string().min(1),
});

interface RouteParams {
  params: Promise<{ slug: string; draftCode: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { slug, draftCode } = await params;

    const ip = getClientIp(request);
    const rl = checkRateLimit(
      getRateLimitKey('form-draft-save', `${ip}:${slug}:email`),
      RATE_LIMIT_CONFIGS.FORM_DRAFT_SAVE
    );
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json();
    const payload = emailPayloadSchema.parse(body);

    await emailPublicFormDraft(slug, draftCode, payload.email, payload.accessToken);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.errors }, { status: 400 });
    }
    return createErrorResponse(error);
  }
}
