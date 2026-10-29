import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, getRateLimitKey, RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { jsonWithServerTiming } from '@/lib/api/company-query';
import { getPublicFormBySlug } from '@/services/form-builder.service';
import { createErrorResponse } from '@/lib/api-helpers';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const startedAt = performance.now();

  try {
    const { slug } = await params;
    const ip = getClientIp(request);
    const rl = checkRateLimit(getRateLimitKey('form-view', `${ip}:${slug}`), RATE_LIMIT_CONFIGS.FORM_VIEW);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const form = await getPublicFormBySlug(slug);
    if (!form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    return jsonWithServerTiming({ form }, startedAt);
  } catch (error) {
    return createErrorResponse(error);
  }
}
