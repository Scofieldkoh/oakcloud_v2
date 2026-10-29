import { NextResponse } from 'next/server';
import {
  checkRateLimit,
  createRateLimitHeaders,
  getClientIp,
  getRateLimitKey,
  type RateLimitConfig,
} from '@/lib/rate-limit';
import { isSameOriginRequest } from '@/lib/esigning-session';

export function enforceEsigningRateLimit(
  request: Request,
  operation: string,
  identifier: string,
  config: RateLimitConfig
): { ip: string } | { response: NextResponse } {
  const ip = getClientIp(request);
  const result = checkRateLimit(getRateLimitKey(operation, `${ip}:${identifier}`), config);

  if (!result.allowed) {
    return {
      response: NextResponse.json(
        { error: result.isLockedOut ? 'Too many attempts' : 'Rate limit exceeded' },
        {
          status: 429,
          headers: createRateLimitHeaders(result),
        }
      ),
    };
  }

  return { ip };
}

export function requireEsigningSameOrigin(request: Request): NextResponse | null {
  if (isSameOriginRequest(request)) {
    return null;
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
