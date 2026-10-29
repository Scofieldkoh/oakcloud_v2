import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, getRateLimitKey, RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { getPublicDraftByCode } from '@/services/form-builder.service';
import { createErrorResponse } from '@/lib/api-helpers';

interface RouteParams {
  params: Promise<{ slug: string; draftCode: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { slug, draftCode } = await params;
    const { searchParams } = new URL(request.url);
    const accessToken = searchParams.get('token')?.trim();

    const ip = getClientIp(request);
    const rl = checkRateLimit(
      getRateLimitKey('form-draft-resume', `${ip}:${slug}`),
      RATE_LIMIT_CONFIGS.FORM_DRAFT_RESUME
    );
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required to resume a draft' }, { status: 401 });
    }

    const draft = await getPublicDraftByCode(slug, draftCode, accessToken);

    return NextResponse.json(draft);
  } catch (error) {
    return createErrorResponse(error);
  }
}
