/**
 * Permissions API
 *
 * GET /api/permissions - Get all available permissions
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getPermissionsGroupedByResource } from '@/services/role.service';
import { createErrorResponse } from '@/lib/api-helpers';

export async function GET() {
  try {
    const session = await requireAuth();

    // Only SUPER_ADMIN and TENANT_ADMIN can view permissions
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const permissions = await getPermissionsGroupedByResource();

    return NextResponse.json(permissions);
  } catch (error) {
    return createErrorResponse(error);
  }
}
