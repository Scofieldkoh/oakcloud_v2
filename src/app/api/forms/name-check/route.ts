import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  COMPANY_NAME_MAX_LENGTH,
  CompanyNameCheckUnavailableError,
  checkCompanyNameAvailability,
} from '@/lib/external/company-name-check';
import { checkRateLimit, getClientIp, getRateLimitKey, RATE_LIMIT_CONFIGS } from '@/lib/rate-limit';
import { routeErrorResponse } from '@/lib/api-route-errors';

const nameCheckRequestSchema = z.object({
  name: z.string().trim().min(1).max(COMPANY_NAME_MAX_LENGTH),
});

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(
      getRateLimitKey('form-name-check', ip),
      RATE_LIMIT_CONFIGS.FORM_NAME_CHECK
    );

    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json();
    const parsed = nameCheckRequestSchema.parse(body);
    const result = await checkCompanyNameAvailability(parsed.name);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid company name', details: error.errors }, { status: 400 });
    }

    if (error instanceof CompanyNameCheckUnavailableError) {
      return NextResponse.json(
        { error: 'Availability check temporarily unavailable. Please try again.' },
        { status: 502 }
      );
    }

    return routeErrorResponse(error);
  }
}
