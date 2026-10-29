/**
 * Connector Workspace Access API Routes
 *
 * GET   /api/connectors/[id]/access - Get workspace access list (SUPER_ADMIN only)
 * PATCH /api/connectors/[id]/access - Update workspace access (SUPER_ADMIN only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { updateWorkspaceAccessSchema } from '@/lib/validations/connector';
import { getWorkspaceAccess, updateWorkspaceAccess } from '@/services/connector.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    if (!session.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const workspaceAccess = await getWorkspaceAccess(id, {
      tenantId: session.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    });

    return NextResponse.json({ workspaceAccess });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    if (!session.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const normalizedBody = body.workspaceAccess
      ? body
      : {
          workspaceAccess: body.tenantAccess?.map(
            (access: { tenantId: string; isEnabled: boolean }) => ({
              workspaceId: access.tenantId,
              isEnabled: access.isEnabled,
            })
          ),
        };
    const data = updateWorkspaceAccessSchema.parse(normalizedBody);

    await updateWorkspaceAccess(id, data, {
      tenantId: session.tenantId,
      userId: session.id,
      isSuperAdmin: session.isSuperAdmin,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return createErrorResponse(error);
  }
}
