/**
 * Role-Based Access Control (RBAC) Utilities
 *
 * Provides permission checking and role management utilities
 * for fine-grained access control across the application.
 */

import { prisma } from './prisma';
import type { SessionUser } from './auth';

// ============================================================================
// Permission Cache (in-memory, per-instance)
// ============================================================================

interface CachedPermissions {
  permissions: Set<string>;
  isAdmin: boolean;
  hasScopedWorkspaceAdminAccess: boolean;
  timestamp: number;
}

// Simple in-memory cache for permissions (5-minute TTL)
const permissionCache = new Map<string, CachedPermissions>();
const PERMISSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cache key for permission lookup
 */
function getPermissionCacheKey(userId: string, companyId?: string): string {
  return companyId ? `${userId}:${companyId}` : userId;
}

/**
 * Clear permission cache for a user (call after role changes)
 */
export function clearPermissionCache(userId: string): void {
  // Clear all cache entries for this user
  for (const key of permissionCache.keys()) {
    if (key === userId || key.startsWith(`${userId}:`)) {
      permissionCache.delete(key);
    }
  }
}

/**
 * Resolve whether an ADMIN role applies in the current scope.
 */
async function hasAdminAccessForScope(
  hasAdminRole: boolean,
  userTenantId: string | null,
  companyId?: string
): Promise<boolean> {
  if (!hasAdminRole) {
    return false;
  }

  if (!companyId) {
    return true;
  }

  if (!userTenantId) {
    return true;
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { tenantId: true },
  });

  return company?.tenantId === userTenantId;
}

function normalizeSystemRole(systemRoleType: string | null | undefined): 'ADMIN' | 'MANAGER' | 'STAFF' | null {
  if (systemRoleType === 'ADMIN' || systemRoleType === 'SUPER_ADMIN' || systemRoleType === 'TENANT_ADMIN') {
    return 'ADMIN';
  }
  if (systemRoleType === 'MANAGER' || systemRoleType === 'COMPANY_ADMIN') {
    return 'MANAGER';
  }
  if (systemRoleType === 'STAFF' || systemRoleType === 'COMPANY_USER') {
    return 'STAFF';
  }
  return null;
}

/**
 * Clear entire permission cache (call on server restart or major changes)
 */
export function clearAllPermissionCache(): void {
  permissionCache.clear();
}

// ============================================================================
// Permission Definitions
// ============================================================================

/**
 * All available resources in the system
 */
export const RESOURCES = [
  'tenant',
  'user',
  'role',
  'company',
  'contact',
  'document',
  'esigning',
  'officer',
  'shareholder',
  'audit_log',
  'connector',
  'chart_of_accounts',
  'contract',
] as const;

export type Resource = (typeof RESOURCES)[number];

/**
 * All available actions for resources
 */
export const ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'export',
  'import',
  'manage', // Full control including admin actions
] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * Permission string format: "resource:action"
 */
export type PermissionString = `${Resource}:${Action}`;

/**
 * Default system roles with their permissions
 */
export const SYSTEM_ROLES = {
  ADMIN: {
    name: 'Admin',
    description: 'Full internal staff administration access',
    permissions: [
      'tenant:read',
      'tenant:update',
      'user:create',
      'user:read',
      'user:update',
      'user:delete',
      'role:create',
      'role:read',
      'role:update',
      'role:delete',
      'company:create',
      'company:read',
      'company:update',
      'company:delete',
      'company:export',
      'company:import',
      'contact:create',
      'contact:read',
      'contact:update',
      'contact:delete',
      'document:create',
      'document:read',
      'document:update',
      'document:delete',
      'document:export',
      'esigning:create',
      'esigning:read',
      'esigning:update',
      'esigning:delete',
      'esigning:manage',
      'officer:create',
      'officer:read',
      'officer:update',
      'officer:delete',
      'shareholder:create',
      'shareholder:read',
      'shareholder:update',
      'shareholder:delete',
      'audit_log:read',
      'audit_log:export',
      'connector:create',
      'connector:read',
      'connector:update',
      'connector:delete',
      'chart_of_accounts:create',
      'chart_of_accounts:read',
      'chart_of_accounts:update',
      'chart_of_accounts:delete',
      'chart_of_accounts:export',
      'chart_of_accounts:import',
      'contract:create',
      'contract:read',
      'contract:update',
      'contract:delete',
    ] as PermissionString[],
  },
  MANAGER: {
    name: 'Manager',
    description: 'Manage assigned companies and operational workflows',
    permissions: [
      'company:read',
      'company:update',
      'company:export',
      'contact:create',
      'contact:read',
      'contact:update',
      'document:create',
      'document:read',
      'document:update',
      'document:delete',
      'esigning:create',
      'esigning:read',
      'esigning:update',
      'esigning:delete',
      'officer:create',
      'officer:read',
      'officer:update',
      'officer:delete',
      'shareholder:create',
      'shareholder:read',
      'shareholder:update',
      'shareholder:delete',
      'audit_log:read',
      'chart_of_accounts:read',
      'chart_of_accounts:update',
      'contract:create',
      'contract:read',
      'contract:update',
      'contract:delete',
    ] as PermissionString[],
  },
  STAFF: {
    name: 'Staff',
    description: 'Read and work on assigned companies',
    permissions: [
      'company:read',
      'contact:read',
      'document:read',
      'esigning:read',
      'officer:read',
      'shareholder:read',
      'audit_log:read',
      'chart_of_accounts:read',
      'contract:read',
    ] as PermissionString[],
  },
} as const;

export type SystemRoleName = keyof typeof SYSTEM_ROLES;

/**
 * Default custom roles created for every new tenant
 * These can be modified or deleted by tenant admins
 */
export const DEFAULT_CUSTOM_ROLES = [
  {
    name: 'Auditor',
    description: 'Read-only access to audit logs, companies, and documents for compliance review',
    permissions: [
      'company:read',
      'contact:read',
      'document:read',
      'esigning:read',
      'officer:read',
      'shareholder:read',
      'audit_log:read',
      'audit_log:export',
      'contract:read',
    ] as PermissionString[],
  },
  {
    name: 'Data Entry Clerk',
    description: 'Create and update companies and contacts, but cannot delete or export',
    permissions: [
      'company:create', 'company:read', 'company:update',
      'contact:create', 'contact:read', 'contact:update',
      'document:create', 'document:read', 'document:update',
      'esigning:create', 'esigning:read', 'esigning:update',
      'officer:create', 'officer:read', 'officer:update',
      'shareholder:create', 'shareholder:read', 'shareholder:update',
      'contract:create', 'contract:read', 'contract:update',
    ] as PermissionString[],
  },
  {
    name: 'Report Viewer',
    description: 'View and export data for reporting purposes',
    permissions: [
      'company:read', 'company:export',
      'contact:read', 'contact:export',
      'document:read', 'document:export',
      'esigning:read',
      'officer:read', 'officer:export',
      'shareholder:read', 'shareholder:export',
      'audit_log:read', 'audit_log:export',
      'contract:read', 'contract:export',
    ] as PermissionString[],
  },
  {
    name: 'Document Manager',
    description: 'Full document management with read-only access to company data',
    permissions: [
      'company:read',
      'contact:read',
      'document:create', 'document:read', 'document:update', 'document:delete', 'document:export', 'document:manage',
      'esigning:create', 'esigning:read', 'esigning:update', 'esigning:delete',
      'officer:read',
      'shareholder:read',
      'contract:read',
    ] as PermissionString[],
  },
  {
    name: 'Manager',
    description: 'Full access to company data including delete, but no user or role management',
    permissions: [
      'company:create', 'company:read', 'company:update', 'company:delete', 'company:export',
      'contact:create', 'contact:read', 'contact:update', 'contact:delete', 'contact:export',
      'document:create', 'document:read', 'document:update', 'document:delete', 'document:export',
      'esigning:create', 'esigning:read', 'esigning:update', 'esigning:delete', 'esigning:manage',
      'officer:create', 'officer:read', 'officer:update', 'officer:delete', 'officer:export',
      'shareholder:create', 'shareholder:read', 'shareholder:update', 'shareholder:delete', 'shareholder:export',
      'audit_log:read', 'audit_log:export',
      'contract:create', 'contract:read', 'contract:update', 'contract:delete', 'contract:export',
    ] as PermissionString[],
  },
] as const;

// ============================================================================
// Permission Checking
// ============================================================================

/**
 * Check if user has a specific permission
 *
 * Permission Resolution (Specificity Priority):
 * 1. If companyId provided, look for role assignment specific to that company
 * 2. If no company-specific role, fall back to tenant-wide role (companyId = null)
 * 3. Company-specific roles OVERRIDE tenant-wide roles (not combined)
 *
 * Special cases:
 * - SUPER_ADMIN (systemRoleType): Has all permissions everywhere
 * - TENANT_ADMIN (systemRoleType): Has all permissions within their tenant
 */
export async function hasPermission(
  userId: string,
  resource: Resource,
  action: Action,
  companyId?: string
): Promise<boolean> {
  const cacheKey = getPermissionCacheKey(userId, companyId);
  const now = Date.now();

  // Check cache first
  const cached = permissionCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < PERMISSION_CACHE_TTL) {
    // Fast path: use cached permissions
    if (cached.isAdmin) {
      return true;
    }
    if (cached.hasScopedWorkspaceAdminAccess) {
      return true;
    }
    // Check if permission exists in cached set
    const permKey = `${resource}:${action}`;
    return cached.permissions.has(permKey) || cached.permissions.has(`${resource}:manage`);
  }

  // Get user with role assignments (cache miss)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roleAssignments: {
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
        },
      },
    },
  });

  if (!user || user.deletedAt || !user.isActive) {
    return false;
  }

  // Check for system role types via role assignments
  const hasAdminRole = user.roleAssignments.some(
    (a) => normalizeSystemRole(a.role.systemRoleType) === 'ADMIN'
  );
  const hasScopedWorkspaceAdminAccess = await hasAdminAccessForScope(
    hasAdminRole,
    user.tenantId,
    companyId
  );
  if (hasAdminRole && companyId && !hasScopedWorkspaceAdminAccess) {
    permissionCache.set(cacheKey, {
      permissions: new Set(),
      isAdmin: false,
      hasScopedWorkspaceAdminAccess: false,
      timestamp: now,
    });
    return false;
  }

  // Build permission set for caching
  const permissionSet = new Set<string>();
  const effectiveAssignments = getEffectiveRoleAssignments(user.roleAssignments, companyId);
  for (const assignment of effectiveAssignments) {
    for (const rp of assignment.role.permissions) {
      permissionSet.add(`${rp.permission.resource}:${rp.permission.action}`);
    }
  }

  // Cache the permissions
  permissionCache.set(cacheKey, {
    permissions: permissionSet,
    isAdmin: hasAdminRole,
    hasScopedWorkspaceAdminAccess,
    timestamp: now,
  });

  if (hasAdminRole) {
    return true;
  }

  if (hasScopedWorkspaceAdminAccess) {
    return true;
  }

  // Check if any effective role has the required permission
  for (const assignment of effectiveAssignments) {
    const hasMatch = assignment.role.permissions.some(
      (rp) =>
        rp.permission.resource === resource &&
        (rp.permission.action === action || rp.permission.action === 'manage')
    );

    if (hasMatch) {
      return true;
    }
  }

  return false;
}

/**
 * Get effective role assignments based on specificity
 * Company-specific roles override tenant-wide roles
 *
 * Resolution logic:
 * - If no companyId: Return ALL roles (tenant-wide + company-specific)
 *   This allows checking "does user have this permission anywhere?"
 * - If specific companyId: Use specificity rules
 *   1. Company-specific roles for that company override tenant-wide
 *   2. If no company-specific roles, fall back to tenant-wide
 */
function getEffectiveRoleAssignments<T extends { companyId: string | null }>(
  assignments: T[],
  companyId?: string
): T[] {
  if (!companyId) {
    // No specific company - return ALL roles (tenant-wide + company-specific)
    // This handles cases like "can this user read companies?" where we want
    // to know if they have the permission via ANY of their role assignments
    return assignments;
  }

  // Check if there are company-specific roles for the given company
  const companySpecific = assignments.filter(a => a.companyId === companyId);

  if (companySpecific.length > 0) {
    // Use ONLY company-specific roles (override behavior)
    return companySpecific;
  }

  // Fall back to tenant-wide roles
  return assignments.filter(a => a.companyId === null);
}

/**
 * Check if user has any of the specified permissions
 */
export async function hasAnyPermission(
  userId: string,
  permissions: Array<{ resource: Resource; action: Action }>,
  companyId?: string
): Promise<boolean> {
  for (const { resource, action } of permissions) {
    if (await hasPermission(userId, resource, action, companyId)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if user has all of the specified permissions
 */
export async function hasAllPermissions(
  userId: string,
  permissions: Array<{ resource: Resource; action: Action }>,
  companyId?: string
): Promise<boolean> {
  for (const { resource, action } of permissions) {
    if (!(await hasPermission(userId, resource, action, companyId))) {
      return false;
    }
  }
  return true;
}

/**
 * Get all permissions for a user
 * Uses the same specificity-based resolution as hasPermission
 * Optimized: Uses select to minimize data transfer and leverages permission cache
 */
export async function getUserPermissions(
  userId: string,
  companyId?: string
): Promise<PermissionString[]> {
  const cacheKey = getPermissionCacheKey(userId, companyId);
  const now = Date.now();

  // Check cache first
  const cached = permissionCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < PERMISSION_CACHE_TTL) {
    // Fast path: return cached permissions
    if (cached.isAdmin || cached.hasScopedWorkspaceAdminAccess) {
      const allPermissions: PermissionString[] = [];
      for (const resource of RESOURCES) {
        for (const action of ACTIONS) {
          allPermissions.push(`${resource}:${action}`);
        }
      }
      return allPermissions;
    }
    return Array.from(cached.permissions) as PermissionString[];
  }

  // Optimized query using select instead of include
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      deletedAt: true,
      isActive: true,
      tenantId: true,
      roleAssignments: {
        select: {
          companyId: true,
          role: {
            select: {
              systemRoleType: true,
              permissions: {
                select: {
                  permission: {
                    select: {
                      resource: true,
                      action: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user || user.deletedAt || !user.isActive) {
    return [];
  }

  const hasAdminRole = user.roleAssignments.some(
    (a) => normalizeSystemRole(a.role.systemRoleType) === 'ADMIN'
  );
  const hasScopedWorkspaceAdminAccess = await hasAdminAccessForScope(
    hasAdminRole,
    user.tenantId,
    companyId
  );
  if (hasAdminRole && companyId && !hasScopedWorkspaceAdminAccess) {
    permissionCache.set(cacheKey, {
      permissions: new Set(),
      isAdmin: false,
      hasScopedWorkspaceAdminAccess: false,
      timestamp: now,
    });
    return [];
  }

  // Get effective role assignments using specificity priority
  const effectiveAssignments = getEffectiveRoleAssignments(user.roleAssignments, companyId);

  const permissionSet = new Set<string>();
  for (const assignment of effectiveAssignments) {
    for (const rp of assignment.role.permissions) {
      permissionSet.add(`${rp.permission.resource}:${rp.permission.action}`);
    }
  }

  // Cache the permissions for future calls
  permissionCache.set(cacheKey, {
    permissions: permissionSet,
    isAdmin: hasAdminRole,
    hasScopedWorkspaceAdminAccess,
    timestamp: now,
  });

  if (hasAdminRole || hasScopedWorkspaceAdminAccess) {
    const allPermissions: PermissionString[] = [];
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        allPermissions.push(`${resource}:${action}`);
      }
    }
    return allPermissions;
  }

  return Array.from(permissionSet) as PermissionString[];
}

// ============================================================================
// Permission Enforcement
// ============================================================================

/**
 * Require a specific permission - throws if not granted
 * Uses computed flags from session (derived from role assignments)
 */
export async function requirePermission(
  session: SessionUser,
  resource: Resource,
  action: Action,
  companyId?: string
): Promise<void> {
  // SUPER_ADMIN bypasses all permission checks
  if (session.isSuperAdmin) {
    return;
  }

  const granted = await hasPermission(session.id, resource, action, companyId);

  if (!granted) {
    throw new Error(`Permission denied: ${resource}:${action}`);
  }
}

/**
 * Require any of the specified permissions - throws if none granted
 * Uses computed flags from session (derived from role assignments)
 */
export async function requireAnyPermission(
  session: SessionUser,
  permissions: Array<{ resource: Resource; action: Action }>,
  companyId?: string
): Promise<void> {
  // SUPER_ADMIN bypasses all permission checks
  if (session.isSuperAdmin) {
    return;
  }

  const granted = await hasAnyPermission(session.id, permissions, companyId);

  if (!granted) {
    const permStr = permissions.map((p) => `${p.resource}:${p.action}`).join(', ');
    throw new Error(`Permission denied: requires one of [${permStr}]`);
  }
}

// ============================================================================
// Role Management
// ============================================================================

/**
 * Get all roles for a tenant
 */
export async function getWorkspaceRoles(tenantId: string) {
  return prisma.role.findMany({
    where: { tenantId },
    include: {
      permissions: {
        include: {
          permission: true,
        },
      },
      _count: {
        select: {
          users: true,
        },
      },
    },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });
}

/**
 * Get user's role assignments
 */
export async function getUserRoleAssignments(userId: string) {
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

/**
 * Assign a role to a user
 * @param companyId - If null/undefined, the role applies to "All Companies" (tenant-wide)
 *                   If a company ID, the role only applies to that specific company
 */
export async function assignRoleToUser(
  userId: string,
  roleId: string,
  companyId?: string | null
): Promise<void> {
  await prisma.userRoleAssignment.create({
    data: {
      userId,
      roleId,
      companyId: companyId || null, // Explicitly set to null for "All Companies"
    },
  });
  clearPermissionCache(userId);
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
  clearPermissionCache(userId);
}

// ============================================================================
// System Role Initialization
// ============================================================================

/**
 * Initialize system permissions in the database
 * Should be called during database seeding
 */
export async function initializePermissions(): Promise<void> {
  const permissionData: Array<{ resource: string; action: string; description: string }> = [];

  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      permissionData.push({
        resource,
        action,
        description: `${action} ${resource}`,
      });
    }
  }

  // Upsert all permissions
  for (const perm of permissionData) {
    await prisma.permission.upsert({
      where: {
        resource_action: {
          resource: perm.resource,
          action: perm.action,
        },
      },
      create: perm,
      update: { description: perm.description },
    });
  }
}

/**
 * Create system roles for a tenant
 * Should be called when a new tenant is created
 */
export async function createSystemRolesForWorkspace(tenantId: string): Promise<void> {
  // Get all permissions
  const allPermissions = await prisma.permission.findMany();
  const permissionMap = new Map(
    allPermissions.map((p) => [`${p.resource}:${p.action}`, p.id])
  );

  // Create each system role
  for (const [roleKey, roleConfig] of Object.entries(SYSTEM_ROLES)) {
    // Check if role already exists
    const existing = await prisma.role.findUnique({
      where: {
        tenantId_name: {
          tenantId,
          name: roleConfig.name,
        },
      },
    });

    if (existing) continue;

    // Create role with systemRoleType for proper auth checks
    const role = await prisma.role.create({
      data: {
        tenantId,
        name: roleConfig.name,
        description: roleConfig.description,
        isSystem: true,
        systemRoleType: roleKey, // e.g., 'TENANT_ADMIN', 'COMPANY_ADMIN', 'COMPANY_USER'
      },
    });

    // Assign permissions to role
    const rolePermissions = roleConfig.permissions
      .map((permStr) => permissionMap.get(permStr))
      .filter((id): id is string => id !== undefined);

    await prisma.rolePermission.createMany({
      data: rolePermissions.map((permissionId) => ({
        roleId: role.id,
        permissionId,
      })),
    });
  }

  // Create default custom roles
  await createDefaultCustomRolesForWorkspace(tenantId, permissionMap);
}

/**
 * Create default custom roles for a tenant
 * These are non-system roles that can be modified or deleted
 */
export async function createDefaultCustomRolesForWorkspace(
  tenantId: string,
  permissionMap?: Map<string, string>
): Promise<void> {
  // Get permission map if not provided
  if (!permissionMap) {
    const allPermissions = await prisma.permission.findMany();
    permissionMap = new Map(
      allPermissions.map((p) => [`${p.resource}:${p.action}`, p.id])
    );
  }

  // Create each default custom role
  for (const roleConfig of DEFAULT_CUSTOM_ROLES) {
    // Check if role already exists
    const existing = await prisma.role.findUnique({
      where: {
        tenantId_name: {
          tenantId,
          name: roleConfig.name,
        },
      },
    });

    if (existing) continue;

    // Create role (not a system role - can be modified/deleted)
    const role = await prisma.role.create({
      data: {
        tenantId,
        name: roleConfig.name,
        description: roleConfig.description,
        isSystem: false,
      },
    });

    // Assign permissions to role
    const rolePermissions = roleConfig.permissions
      .map((permStr) => permissionMap!.get(permStr))
      .filter((id): id is string => id !== undefined);

    if (rolePermissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: rolePermissions.map((permissionId) => ({
          roleId: role.id,
          permissionId,
        })),
      });
    }
  }
}

/**
 * Get the system role ID for a tenant by role type
 */
export async function getSystemRoleId(
  tenantId: string,
  roleType: SystemRoleName
): Promise<string | null> {
  const roleName = SYSTEM_ROLES[roleType].name;

  const role = await prisma.role.findUnique({
    where: {
      tenantId_name: {
        tenantId,
        name: roleName,
      },
    },
  });

  return role?.id || null;
}

// ============================================================================
// Permission Helpers for Common Operations
// ============================================================================

/**
 * Check if user can read companies in tenant
 * Uses computed flags from session
 */
export function canReadCompanies(session: SessionUser): boolean {
  // Super admin and tenant admin can always read
  if (session.isSuperAdmin || session.isWorkspaceAdmin) return true;
  // All authenticated users can read companies (via role assignments for specific permissions)
  return true;
}

/**
 * Check if user can create companies in tenant
 * Uses computed flags from session
 */
export function canCreateCompanies(session: SessionUser): boolean {
  return session.isSuperAdmin || session.isWorkspaceAdmin;
}

/**
 * Check if user can manage users in tenant
 * Uses computed flags from session
 */
export function canManageUsers(session: SessionUser): boolean {
  return session.isSuperAdmin || session.isWorkspaceAdmin;
}

/**
 * Check if user can manage roles in tenant
 * Uses computed flags from session
 */
export function canManageRoles(session: SessionUser): boolean {
  return session.isSuperAdmin || session.isWorkspaceAdmin;
}

/**
 * Check if user can access audit logs
 * Uses computed flags from session
 *
 * Only admins can access audit logs by default.
 * Regular users need explicit audit_log:read permission.
 */
export function canAccessAuditLogs(session: SessionUser): boolean {
  // Super admin and tenant admin can always access
  if (session.isSuperAdmin || session.isWorkspaceAdmin) return true;
  // Regular users need explicit permission - this should be checked via hasPermission
  // in the calling code for more granular control
  return false;
}

/**
 * Check if user can export data
 * Uses computed flags from session
 */
export function canExportData(session: SessionUser): boolean {
  // Super admin and tenant admin can always export
  if (session.isSuperAdmin || session.isWorkspaceAdmin) return true;
  // Other users need specific permissions (checked via hasPermission)
  return false;
}
