/**
 * Individual Workspace Role API
 *
 * GET /api/workspace/roles/:roleId - Get a specific role
 * PATCH /api/workspace/roles/:roleId - Update a role
 * DELETE /api/workspace/roles/:roleId - Delete a role
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { createAuditContext, logUpdate, logDelete } from '@/lib/audit';
import {
  getRoleById,
  updateRole,
  deleteRole,
  validatePermissionIds,
  roleBelongsToWorkspace,
} from '@/services/role.service';

export async function GET(
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
    await requirePermission(session, 'role', 'read');

    // Verify role belongs to the current workspace.
    const belongsToTenant = await roleBelongsToWorkspace(roleId, workspaceId);
    if (!belongsToTenant) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    const role = await getRoleById(roleId, { tenantId: workspaceId });
    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    return NextResponse.json(role);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(
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
    await requirePermission(session, 'role', 'update');

    // Verify role belongs to the current workspace.
    const belongsToTenant = await roleBelongsToWorkspace(roleId, workspaceId);
    if (!belongsToTenant) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    // Get current role for comparison (pass tenantId for authorization)
    const currentRole = await getRoleById(roleId, { tenantId: workspaceId });
    if (!currentRole) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    const body = await request.json();
    const { name, description, permissions } = body;

    // Validate name if provided
    if (name !== undefined) {
      if (typeof name !== 'string' || name.length < 2 || name.length > 50) {
        return NextResponse.json(
          { error: 'Role name must be between 2 and 50 characters' },
          { status: 400 }
        );
      }
    }

    // Validate permissions if provided
    if (permissions !== undefined) {
      if (!Array.isArray(permissions)) {
        return NextResponse.json(
          { error: 'Permissions must be an array' },
          { status: 400 }
        );
      }
      if (permissions.length > 0) {
        const validPermissions = await validatePermissionIds(permissions);
        if (!validPermissions) {
          return NextResponse.json(
            { error: 'One or more permission IDs are invalid' },
            { status: 400 }
          );
        }
      }
    }

    // Update the role (pass tenantId for authorization)
    const updatedRole = await updateRole(roleId, {
      name: name?.trim(),
      description: description?.trim(),
      permissions,
    }, workspaceId);

    // Build changes for audit log
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (name && name !== currentRole.name) {
      changes.name = { old: currentRole.name, new: name };
    }
    if (description !== undefined && description !== currentRole.description) {
      changes.description = { old: currentRole.description, new: description };
    }
    if (permissions !== undefined) {
      const oldPermissionIds = currentRole.permissions.map((p) => p.permissionId).sort();
      const newPermissionIds = [...permissions].sort();
      if (JSON.stringify(oldPermissionIds) !== JSON.stringify(newPermissionIds)) {
        changes.permissions = {
          old: oldPermissionIds.length,
          new: newPermissionIds.length,
        };
      }
    }

    // Log the update if there are changes
    if (Object.keys(changes).length > 0) {
      const ctx = await createAuditContext({
        tenantId: workspaceId,
        userId: session.id,
        changeSource: 'MANUAL',
      });
      await logUpdate(ctx, 'Role', roleId, changes, updatedRole.name);
    }

    return NextResponse.json(updatedRole);
  } catch (error) {
    if (error instanceof Error && error.message === 'System roles cannot be modified') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof Error && error.message === 'A role with this name already exists') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Failed to update role:', error);
    return createErrorResponse(error);
  }
}

export async function DELETE(
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
    await requirePermission(session, 'role', 'delete');

    // Verify role belongs to the current workspace.
    const belongsToTenant = await roleBelongsToWorkspace(roleId, workspaceId);
    if (!belongsToTenant) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    // Get role for audit log (pass tenantId for authorization)
    const role = await getRoleById(roleId, { tenantId: workspaceId });
    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    // Delete the role (pass tenantId for authorization)
    await deleteRole(roleId, workspaceId);

    // Log the deletion
    const ctx = await createAuditContext({
      tenantId: workspaceId,
      userId: session.id,
      changeSource: 'MANUAL',
    });
    await logDelete(ctx, 'Role', roleId, role.name, 'Role deleted by administrator');

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'System roles cannot be deleted') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Failed to delete role:', error);
    return createErrorResponse(error);
  }
}
