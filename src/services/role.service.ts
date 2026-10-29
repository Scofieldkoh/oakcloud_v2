/**
 * Role Service
 *
 * Business logic for role management including CRUD operations
 * and permission assignment.
 */

import { prisma } from '@/lib/prisma';
import { RESOURCES, ACTIONS } from '@/lib/rbac';

// ============================================================================
// Types
// ============================================================================

export interface CreateRoleData {
  tenantId: string;
  name: string;
  description?: string;
  permissions?: string[]; // Array of permission IDs
}

export interface UpdateRoleData {
  name?: string;
  description?: string;
  permissions?: string[]; // Array of permission IDs (replaces existing)
}

export interface RoleWithPermissions {
  id: string;
  tenantId: string | null; // Nullable for global roles (e.g., SUPER_ADMIN)
  name: string;
  description: string | null;
  isSystem: boolean;
  systemRoleType: string | null;
  createdAt: Date;
  updatedAt: Date;
  permissions: Array<{
    id: string;
    permissionId: string;
    permission: {
      id: string;
      resource: string;
      action: string;
      description: string | null;
    };
  }>;
  _count: {
    users: number;
  };
}

// ============================================================================
// Permission Operations
// ============================================================================

/**
 * Get all available permissions
 */
export async function getAllPermissions() {
  return prisma.permission.findMany({
    orderBy: [{ resource: 'asc' }, { action: 'asc' }],
  });
}

/**
 * Get permissions grouped by resource
 */
export async function getPermissionsGroupedByResource() {
  const permissions = await getAllPermissions();

  const grouped: Record<string, Array<{ id: string; action: string; description: string | null }>> = {};

  for (const permission of permissions) {
    if (!grouped[permission.resource]) {
      grouped[permission.resource] = [];
    }
    grouped[permission.resource].push({
      id: permission.id,
      action: permission.action,
      description: permission.description,
    });
  }

  return {
    resources: RESOURCES,
    actions: ACTIONS,
    grouped,
    permissions,
  };
}

// ============================================================================
// Role CRUD Operations
// ============================================================================

export interface GetRoleOptions {
  /**
   * If provided, validates that the role belongs to this tenant.
   * Global/system roles (tenantId = null) are always accessible.
   */
  tenantId?: string;
  /**
   * Skip tenant validation - ONLY use for SUPER_ADMIN operations.
   */
  skipTenantValidation?: boolean;
}

/**
 * Get a role by ID with optional tenant validation.
 * By default, validates that the role belongs to the specified tenant.
 */
export async function getRoleById(
  roleId: string,
  options: GetRoleOptions = {}
): Promise<RoleWithPermissions | null> {
  const { tenantId, skipTenantValidation = false } = options;

  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: {
      permissions: {
        include: {
          permission: true,
        },
      },
      _count: {
        select: { users: true },
      },
    },
  });

  if (!role) return null;

  // Validate tenant access unless skipped
  // Global roles (tenantId = null) are accessible to all
  if (!skipTenantValidation && tenantId && role.tenantId && role.tenantId !== tenantId) {
    // Role belongs to a different tenant - deny access
    return null;
  }

  return role;
}

/**
 * Get all roles for a tenant
 */
export async function getWorkspaceRoles(tenantId: string): Promise<RoleWithPermissions[]> {
  return prisma.role.findMany({
    where: { tenantId },
    include: {
      permissions: {
        include: {
          permission: true,
        },
      },
      _count: {
        select: { users: true },
      },
    },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });
}

/**
 * Create a new custom role
 */
export async function createRole(data: CreateRoleData): Promise<RoleWithPermissions> {
  const { tenantId, name, description, permissions = [] } = data;

  // Check if role name already exists in tenant
  const existing = await prisma.role.findUnique({
    where: {
      tenantId_name: { tenantId, name },
    },
  });

  if (existing) {
    throw new Error('A role with this name already exists');
  }

  // Create role with permissions
  const role = await prisma.role.create({
    data: {
      tenantId,
      name,
      description,
      isSystem: false, // Custom roles are never system roles
      permissions: {
        create: permissions.map((permissionId) => ({
          permissionId,
        })),
      },
    },
    include: {
      permissions: {
        include: {
          permission: true,
        },
      },
      _count: {
        select: { users: true },
      },
    },
  });

  return role;
}

/**
 * Update a role
 *
 * @param roleId - The ID of the role to update
 * @param data - The update data
 * @param tenantId - Required tenant ID for authorization
 */
export async function updateRole(
  roleId: string,
  data: UpdateRoleData,
  tenantId: string
): Promise<RoleWithPermissions> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: true },
  });

  if (!role) {
    throw new Error('Role not found');
  }

  // Security: Verify role belongs to the caller's tenant
  if (role.tenantId !== tenantId) {
    throw new Error('Role not found'); // Don't reveal role exists in another tenant
  }

  if (role.isSystem) {
    throw new Error('System roles cannot be modified');
  }

  // Check for name uniqueness if name is being updated
  if (data.name && data.name !== role.name && role.tenantId) {
    const existing = await prisma.role.findUnique({
      where: {
        tenantId_name: { tenantId: role.tenantId, name: data.name },
      },
    });

    if (existing) {
      throw new Error('A role with this name already exists');
    }
  }

  // Update role in transaction
  return prisma.$transaction(async (tx) => {
    // Update basic info
    await tx.role.update({
      where: { id: roleId },
      data: {
        name: data.name,
        description: data.description,
      },
    });

    // Update permissions if provided
    if (data.permissions !== undefined) {
      // Delete existing permissions
      await tx.rolePermission.deleteMany({
        where: { roleId },
      });

      // Create new permissions
      if (data.permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: data.permissions.map((permissionId) => ({
            roleId,
            permissionId,
          })),
        });
      }
    }

    // Return updated role
    return tx.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        _count: {
          select: { users: true },
        },
      },
    }) as Promise<RoleWithPermissions>;
  });
}

/**
 * Delete a role
 *
 * @param roleId - The ID of the role to delete
 * @param tenantId - Required tenant ID for authorization
 */
export async function deleteRole(roleId: string, tenantId: string): Promise<void> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: {
      _count: {
        select: { users: true },
      },
    },
  });

  if (!role) {
    throw new Error('Role not found');
  }

  // Security: Verify role belongs to the caller's tenant
  if (role.tenantId !== tenantId) {
    throw new Error('Role not found'); // Don't reveal role exists in another tenant
  }

  if (role.isSystem) {
    throw new Error('System roles cannot be deleted');
  }

  if (role._count.users > 0) {
    throw new Error(
      `Cannot delete role that is assigned to ${role._count.users} user(s). Remove all user assignments first.`
    );
  }

  // Delete role (cascade will handle RolePermission)
  await prisma.role.delete({
    where: { id: roleId },
  });
}

/**
 * Duplicate a role (for creating similar roles)
 *
 * Security: Only allows duplicating roles that:
 * - Belong to the same tenant, OR
 * - Are global/system roles (tenantId = null)
 */
export async function duplicateRole(
  roleId: string,
  newName: string,
  tenantId: string
): Promise<RoleWithPermissions> {
  const sourceRole = await prisma.role.findUnique({
    where: { id: roleId },
    include: {
      permissions: true,
    },
  });

  if (!sourceRole) {
    throw new Error('Source role not found');
  }

  // Security check: Only allow duplicating from same tenant or global/system roles
  // Global roles have tenantId = null and can be duplicated by any tenant
  if (sourceRole.tenantId && sourceRole.tenantId !== tenantId) {
    throw new Error('Cannot duplicate role from another tenant');
  }

  // Prevent duplicating system roles directly (they should be copied as templates)
  // This is a soft warning - we allow it but the new role won't be a system role
  if (sourceRole.isSystem) {
    // Allow duplicating system roles, but the new role will be a regular role
    // This is useful for creating custom variations of system roles
  }

  // Create new role with same permissions
  return createRole({
    tenantId,
    name: newName,
    description: sourceRole.description || undefined,
    permissions: sourceRole.permissions.map((rp) => rp.permissionId),
  });
}

// ============================================================================
// User Role Assignment Operations
// ============================================================================

/**
 * Get users assigned to a role
 */
export async function getRoleUsers(roleId: string) {
  return prisma.userRoleAssignment.findMany({
    where: { roleId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isActive: true,
        },
      },
      company: {
        select: {
          id: true,
          name: true,
          uen: true,
        },
      },
    },
  });
}

/**
 * Assign a role to a user
 */
export async function assignRoleToUser(
  userId: string,
  roleId: string,
  companyId?: string
): Promise<void> {
  // Check if assignment already exists
  const existing = await prisma.userRoleAssignment.findFirst({
    where: {
      userId,
      roleId,
      companyId: companyId || null,
    },
  });

  if (existing) {
    throw new Error('User already has this role assignment');
  }

  await prisma.userRoleAssignment.create({
    data: {
      userId,
      roleId,
      companyId,
    },
  });
}

/**
 * Remove a role from a user
 */
export async function removeRoleFromUser(
  userId: string,
  roleId: string,
  companyId?: string
): Promise<void> {
  await prisma.userRoleAssignment.deleteMany({
    where: {
      userId,
      roleId,
      companyId: companyId || null,
    },
  });
}

/**
 * Get all role assignments for a user
 */
export async function getUserRoles(userId: string) {
  return prisma.userRoleAssignment.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      },
      company: {
        select: {
          id: true,
          name: true,
          uen: true,
        },
      },
    },
  });
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that permission IDs exist
 */
export async function validatePermissionIds(permissionIds: string[]): Promise<boolean> {
  if (permissionIds.length === 0) return true;

  const count = await prisma.permission.count({
    where: {
      id: { in: permissionIds },
    },
  });

  return count === permissionIds.length;
}

/**
 * Check if a role belongs to a tenant
 */
export async function roleBelongsToWorkspace(roleId: string, tenantId: string): Promise<boolean> {
  const role = await prisma.role.findFirst({
    where: {
      id: roleId,
      tenantId,
    },
  });

  return !!role;
}
