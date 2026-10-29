/**
 * Reset Password API Route
 *
 * POST /api/auth/reset-password - Reset password using token
 *
 * Security:
 * - Rate limited to 5 attempts per 15 minutes per token
 * - Lockout after 10 failed attempts (1 hour lockout)
 * - Also rate limited by IP
 */

import { NextRequest, NextResponse } from 'next/server';
import { resetPasswordWithToken } from '@/services/password.service';
import { z } from 'zod';
import { createLogger, safeErrorMessage } from '@/lib/logger';
import {
  checkRateLimit,
  recordFailure,
  recordSuccess,
  clearRateLimit,
  getClientIp,
  createRateLimitHeaders,
  getRateLimitKey,
  RATE_LIMIT_CONFIGS,
} from '@/lib/rate-limit';
import { HTTP_STATUS } from '@/lib/constants/application';

const log = createLogger('auth:reset-password');

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request);
    const body = await request.json();
    const { token, password } = resetPasswordSchema.parse(body);

    // Rate limit by token (to prevent brute-force)
    const tokenRateLimitKey = getRateLimitKey('password_reset_token', token.substring(0, 16)); // Use first 16 chars
    const tokenRateLimitResult = checkRateLimit(tokenRateLimitKey, RATE_LIMIT_CONFIGS.PASSWORD_RESET_TOKEN);

    if (!tokenRateLimitResult.allowed) {
      const headers = createRateLimitHeaders(tokenRateLimitResult);
      const errorMessage = tokenRateLimitResult.isLockedOut
        ? 'Too many failed attempts. Please request a new password reset.'
        : 'Rate limit exceeded. Please wait before trying again.';

      return NextResponse.json(
        { error: errorMessage },
        { status: HTTP_STATUS.TOO_MANY_REQUESTS, headers }
      );
    }

    // Also rate limit by IP
    const ipRateLimitKey = getRateLimitKey('password_reset_token_ip', clientIp);
    const ipRateLimitResult = checkRateLimit(ipRateLimitKey, RATE_LIMIT_CONFIGS.PASSWORD_RESET_TOKEN);

    if (!ipRateLimitResult.allowed) {
      const headers = createRateLimitHeaders(ipRateLimitResult);
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: HTTP_STATUS.TOO_MANY_REQUESTS, headers }
      );
    }

    const result = await resetPasswordWithToken(token, password);

    if (!result.success) {
      // Record failure for lockout tracking
      recordFailure(tokenRateLimitKey, RATE_LIMIT_CONFIGS.PASSWORD_RESET_TOKEN);

      return NextResponse.json(
        { error: result.message },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    // Success - clear rate limit for this token
    recordSuccess(tokenRateLimitKey);
    clearRateLimit(tokenRateLimitKey);

    return NextResponse.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    log.error('Reset password error:', safeErrorMessage(error));
    return NextResponse.json(
      { error: 'An error occurred. Please try again.' },
      { status: HTTP_STATUS.SERVER_ERROR }
    );
  }
}
