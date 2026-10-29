import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, getClientIp, getRateLimitKey, RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { publicDraftSaveSchema } from '@/lib/validations/form-builder';
import { savePublicDraft } from '@/services/form-builder.service';
import { createErrorResponse } from '@/lib/api-helpers';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { slug } = await params;

    const ip = getClientIp(request);
    const rl = checkRateLimit(getRateLimitKey('form-draft-save', `${ip}:${slug}`), RATE_LIMIT_CONFIGS.FORM_DRAFT_SAVE);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json();
    const payload = publicDraftSaveSchema.parse(body);
    const draft = await savePublicDraft(slug, payload);

    return NextResponse.json(
      {
        draftCode: draft.draftCode,
        accessToken: draft.accessToken,
        resumeUrl: draft.resumeUrl,
        expiresAt: draft.expiresAt,
        savedAt: draft.savedAt,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid draft payload', details: error.errors }, { status: 400 });
    }

    return createErrorResponse(error);
  }
}
