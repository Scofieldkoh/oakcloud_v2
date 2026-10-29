/**
 * API Route Helpers
 *
 * Common utility functions for API routes to ensure consistent
 * handling of tenant context, error responses, and validation.
 */

import { NextResponse } from 'next/server';
import { routeErrorResponse } from './api-route-errors';
import type { SessionUser } from './auth';
import { prisma } from './prisma';
import { HTTP_STATUS } from './constants/application';
import { BadRequestError } from './errors';

// ============================================================================
// Tenant Context Helpers
// ============================================================================

/**
 * Resolve effective tenant ID for API operations
 *
 * Rules:
 * - SUPER_ADMIN can specify tenantId via parameter (must be validated)
 * - Regular users always use their session tenant
 * - Returns null if no valid tenant context
 *
 * @param session - Current user session
 * @param requestedTenantId - Optional tenant ID from request
 * @returns Effective tenant ID or null
 */
export async function resolveEffectiveWorkspaceId(
  session: SessionUser,
  requestedTenantId?: string | null
): Promise<{ tenantId: string | null; error?: string }> {
  // Regular users always use their session tenant
  if (!session.isSuperAdmin) {
    if (!session.tenantId) {
      return { tenantId: null, error: 'Workspace context required' };
    }
    return { tenantId: session.tenantId };
  }

  // SUPER_ADMIN with requested tenant ID - validate it exists
  if (requestedTenantId) {
    const tenant = await prisma.workspace.findUnique({
      where: { id: requestedTenantId, deletedAt: null },
      select: { id: true, status: true },
    });

    if (!tenant) {
      return { tenantId: null, error: 'Workspace not found' };
    }

    return { tenantId: tenant.id };
  }

  // SUPER_ADMIN without tenant ID - use session tenant if available
  if (session.tenantId) {
    return { tenantId: session.tenantId };
  }

  // SUPER_ADMIN without any tenant context - some operations may allow this
  return { tenantId: null };
}

/**
 * Require tenant context - returns error response if not available
 */
export async function requireWorkspaceContext(
  session: SessionUser,
  requestedTenantId?: string | null
): Promise<{ tenantId: string; error?: never } | { tenantId?: never; error: NextResponse }> {
  const result = await resolveEffectiveWorkspaceId(session, requestedTenantId);

  if (result.error) {
    return {
      error: NextResponse.json(
        { error: result.error },
        { status: HTTP_STATUS.BAD_REQUEST }
      ),
    };
  }

  if (!result.tenantId) {
    return {
      error: NextResponse.json(
        { error: 'Workspace context required' },
        { status: HTTP_STATUS.BAD_REQUEST }
      ),
    };
  }

  return { tenantId: result.tenantId };
}

/**
 * Synchronous tenant ID resolver for API routes.
 * Throws on missing tenant context (handled by createErrorResponse).
 */
export function resolveWorkspaceId(
  session: SessionUser,
  requestedTenantId?: string | null
): string {
  if (session.isSuperAdmin) {
    const tenantId = requestedTenantId || session.tenantId;
    if (!tenantId) {
      throw new Error('Workspace context required');
    }
    return tenantId;
  }

  if (!session.tenantId) {
    throw new Error('Workspace context required');
  }

  return session.tenantId;
}

/**
 * Require the workspace attached to the authenticated session.
 *
 * Internal generated-document routes should not accept caller-supplied
 * workspace IDs; the authenticated session is the sole scope source.
 */
export function requireSessionWorkspaceId(session: SessionUser): string {
  if (!session.tenantId) {
    throw new BadRequestError('Workspace context required');
  }

  return session.tenantId;
}

// ============================================================================
// Error Response Helpers
// ============================================================================

/**
 * Default error response for staff routes: auth → 401/403, "... not found" →
 * 404, other application errors → 400 with their message, and database or
 * runtime errors → 500 without their message. See `routeErrorResponse`.
 */
export function createErrorResponse(
  error: unknown,
  defaultMessage: string = 'Internal server error'
): NextResponse {
  return routeErrorResponse(error, {
    notFound: 'any',
    fallback: 'bad-request',
    serverErrorMessage: defaultMessage,
  });
}

/**
 * Create success response with optional status code
 */
export function createSuccessResponse<T>(
  data: T,
  status: number = HTTP_STATUS.OK
): NextResponse {
  return NextResponse.json(data, { status });
}

// ============================================================================
// HTTP Header Helpers
// ============================================================================

/**
 * Build a safe Content-Disposition header value.
 *
 * Strips control characters and uses RFC 5987 encoding for non-ASCII filenames
 * so the value is safe against header injection and displays correctly.
 *
 * @example
 * buildContentDispositionHeader('attachment', 'report.pdf')
 * // → 'attachment; filename="report.pdf"'
 *
 * buildContentDispositionHeader('inline', '报告.pdf')
 * // → "inline; filename=\".pdf\"; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf"
 */
export function buildContentDispositionHeader(
  disposition: 'attachment' | 'inline',
  fileName: string
): string {
  // Strip control characters (0x00–0x1F), backslashes and double-quotes
  const safe = fileName.replace(/[\x00-\x1f\\"/]/g, '');

  const hasNonAscii = /[^\x20-\x7E]/.test(safe);
  if (!hasNonAscii) {
    return `${disposition}; filename="${safe}"`;
  }

  // RFC 5987: use percent-encoding for non-ASCII, keep ASCII fallback
  const encoded = encodeURIComponent(safe);
  return `${disposition}; filename="${safe.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encoded}`;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Parse query parameters safely
 */
export function parseQueryParams<T>(
  searchParams: URLSearchParams,
  schema: { parse: (data: unknown) => T }
): T {
  const params: Record<string, string | undefined> = {};

  searchParams.forEach((value, key) => {
    params[key] = value || undefined;
  });

  return schema.parse(params);
}

/**
 * Parse numeric query parameter
 */
export function parseNumericParam(value: string | null, defaultValue?: number): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return defaultValue;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/**
 * Parse integer query parameter safely.
 *
 * Non-finite values fall back to the provided default. Decimal input is
 * normalized with `Math.floor` so callers can use the result directly in
 * pagination offsets without relying on downstream coercion.
 */
export function parseIntegerParam(value: string | null, defaultValue?: number): number | undefined {
  const parsed = parseNumericParam(value, defaultValue);
  if (parsed == null) return parsed;
  return Math.floor(parsed);
}

/**
 * Clamp a caller-supplied pagination limit to a safe range.
 *
 * Service/list endpoints should pass caller input through this helper so a
 * bad or hostile client can't trigger an unbounded scan. Non-finite or
 * nullish input falls back to `default`.
 */
export function clampLimit(
  value: number | null | undefined,
  opts: { default?: number; min?: number; max?: number } = {}
): number {
  const def = opts.default ?? 50;
  const max = opts.max ?? 500;
  const min = opts.min ?? 1;
  if (value == null || !Number.isFinite(value)) return Math.min(max, Math.max(min, def));
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Parse boolean query parameter
 */
export function parseBooleanParam(value: string | null, defaultValue?: boolean): boolean | undefined {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}
