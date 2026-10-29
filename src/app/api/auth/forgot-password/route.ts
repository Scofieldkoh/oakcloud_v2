/**
 * Forgot Password API Route
 *
 * POST /api/auth/forgot-password - Request password reset email
 *
 * Security:
 * - Rate limited to 3 requests per hour per email to prevent abuse
 * - Also rate limited by IP to prevent mass enumeration
 */

import { NextRequest, NextResponse } from 'next/server';
import { requestPasswordReset } from '@/services/password.service';
import { z } from 'zod';
import { createLogger, safeErrorMessage } from '@/lib/logger';
import {
  checkRateLimit,
  getClientIp,
  createRateLimitHeaders,
  getRateLimitKey,
  RATE_LIMIT_CONFIGS,
} from '@/lib/rate-limit';
import { HTTP_STATUS } from '@/lib/constants/application';

const log = createLogger('auth:forgot-password');

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request);
    const body = await request.json();
    const { email } = forgotPasswordSchema.parse(body);

    // Rate limit by email (to prevent abuse of specific accounts)
    const emailRateLimitKey = getRateLimitKey('password_reset_email', email.toLowerCase());
    const emailRateLimitResult = checkRateLimit(emailRateLimitKey, RATE_LIMIT_CONFIGS.PASSWORD_RESET_REQUEST);

    if (!emailRateLimitResult.allowed) {
      const headers = createRateLimitHeaders(emailRateLimitResult);
      // Return success message to prevent email enumeration
      // But with rate limit headers for client awareness
      return NextResponse.json(
        {
          success: true,
          message: 'If an account exists with this email, you will receive a password reset link.',
        },
        { headers }
      );
    }

    // Also rate limit by IP (to prevent mass enumeration)
    const ipRateLimitKey = getRateLimitKey('password_reset_ip', clientIp);
    const ipRateLimitConfig = { ...RATE_LIMIT_CONFIGS.PASSWORD_RESET_REQUEST, maxRequests: 10 }; // Allow more per IP
    const ipRateLimitResult = checkRateLimit(ipRateLimitKey, ipRateLimitConfig);

    if (!ipRateLimitResult.allowed) {
      const headers = createRateLimitHeaders(ipRateLimitResult);
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: HTTP_STATUS.TOO_MANY_REQUESTS, headers }
      );
    }

    const result = await requestPasswordReset(email);

    return NextResponse.json({
      success: result.success,
      message: result.message,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    log.error('Forgot password error:', safeErrorMessage(error));
    return NextResponse.json(
      { error: 'An error occurred. Please try again.' },
      { status: HTTP_STATUS.SERVER_ERROR }
    );
  }
}
