/**
 * Duplicate Role API
 *
 * POST /api/workspace/roles/:roleId/duplicate - Duplicate a role
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse } from '@/lib/api-helpers';
import { createAuditContext, logCreate } from '@/lib/audit';
import { duplicateRole, roleBelongsToWorkspace } from '@/services/role.service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  try {
    const session = await requireAuth();
    const { roleId } = await params;
    const workspaceId = session.tenantId;

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    }

    const belongsToTenant = await roleBelongsToWorkspace(roleId, workspaceId);
    if (!belongsToTenant) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'New role name is required' }, { status: 400 });
    }

    if (name.length < 2 || name.length > 50) {
      return NextResponse.json(
        { error: 'Role name must be between 2 and 50 characters' },
        { status: 400 }
      );
    }

    // Duplicate the role
    const newRole = await duplicateRole(roleId, name.trim(), workspaceId);

    // Log the creation
    const ctx = await createAuditContext({
      tenantId: workspaceId,
      userId: session.id,
      changeSource: 'MANUAL',
    });
    await logCreate(ctx, 'Role', newRole.id, newRole.name, {
      description: newRole.description,
      permissionCount: newRole.permissions.length,
      duplicatedFrom: roleId,
    });

    return NextResponse.json(newRole, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'A role with this name already exists') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Failed to duplicate role:', error);
    return createErrorResponse(error);
  }
}
