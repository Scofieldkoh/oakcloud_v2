import { NextRequest, NextResponse } from 'next/server';
import { isValidOrigin } from '@/lib/request-origin';

export { getAllowedOrigins, isValidOrigin } from '@/lib/request-origin';

/**
 * CSRF Protection Middleware
 *
 * Validates the Origin header for state-changing requests (POST, PUT, DELETE, PATCH)
 * to prevent Cross-Site Request Forgery attacks.
 *
 * Allows requests from:
 * - Same origin (Origin header matches host)
 * - No Origin header (same-site navigation, curl, etc.)
 * - Allowed origins list (for configured external integrations)
 *
 * Exemptions:
 * - Public API endpoints that need external access
 * - Webhook endpoints
 */

// Methods that require CSRF protection
const PROTECTED_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];

// API paths that are exempt from CSRF protection (public endpoints)
const CSRF_EXEMPT_PATHS = [
  '/api/forms/public/', // Public form submissions/uploads
  '/api/webhooks/', // Webhook endpoints
  '/api/auth/login', // Login endpoint (needs to work from external forms)
  '/api/auth/forgot-password', // Password reset
  '/api/auth/reset-password', // Password reset
];

/**
 * Check if the path is exempt from CSRF protection
 */
function isExemptPath(pathname: string): boolean {
  return CSRF_EXEMPT_PATHS.some((exemptPath) => pathname.startsWith(exemptPath));
}

export function middleware(request: NextRequest) {
  const { method, headers, nextUrl } = request;

  // Only check API routes
  if (!nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Only check protected methods
  if (!PROTECTED_METHODS.includes(method)) {
    return NextResponse.next();
  }

  // Check if path is exempt
  if (isExemptPath(nextUrl.pathname)) {
    return NextResponse.next();
  }

  // Get origin and host
  const origin = headers.get('origin');
  const host = headers.get('host') || 'localhost:3000';

  // Validate origin
  if (!isValidOrigin(origin, host)) {
    console.warn(`[CSRF] Blocked request from origin: ${origin} to ${nextUrl.pathname}`);
    return NextResponse.json(
      {
        error: 'Forbidden',
        message: 'Invalid request origin',
      },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

// Configure which paths the middleware runs on
export const config = {
  matcher: [
    // Match all API routes
    '/api/:path*',
  ],
};
