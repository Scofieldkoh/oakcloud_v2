/**
 * Combined Session + Permissions API
 *
 * GET /api/auth/session - Get current user's session and permissions in one call
 *
 * This endpoint replaces the old separate session and permission endpoints
 * to reduce the number of API calls needed on page load.
 *
 * Returns:
 * - user: Session user data
 * - permissions: Array of permission strings (e.g., "company:read")
 * - isSuperAdmin, isWorkspaceAdmin: Role flags
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSessionPayload } from '@/lib/auth-session';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('companyId') || undefined;
    const session = await getAuthSessionPayload(companyId);

    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    return NextResponse.json(session);
  } catch (error) {
    console.error('Session error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
