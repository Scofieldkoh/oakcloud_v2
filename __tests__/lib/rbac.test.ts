/**
 * RBAC (Role-Based Access Control) Tests
 *
 * Comprehensive tests for permission checking and role management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before importing RBAC functions
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
    },
    role: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    userRoleAssignment: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    permission: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      upsert: vi.fn(),
    },
    rolePermission: {
      createMany: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import {
  canAccessAuditLogs,
  canCreateCompanies,
  canManageUsers,
  canManageRoles,
  canExportData,
  canReadCompanies,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getUserPermissions,
  requirePermission,
  clearAllPermissionCache,
  SYSTEM_ROLES,
  RESOURCES,
  ACTIONS,
} from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth';

// Helper to create mock session
function createMockSession(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'user-1',
    email: 'user@test.com',
    firstName: 'Test',
    lastName: 'User',
    tenantId: 'tenant-1',
    isSuperAdmin: false,
    isWorkspaceAdmin: false,
    companyIds: [],
    hasAllCompaniesAccess: false,
    ...overrides,
  };
}

// Helper to create mock user with role assignments
function createMockUserWithRoles(options: {
  systemRoleType?: 'SUPER_ADMIN' | 'TENANT_ADMIN' | null;
  permissions?: Array<{ resource: string; action: string }>;
  companyId?: string | null;
  isActive?: boolean;
  deletedAt?: Date | null;
  tenantId?: string;
}) {
  const {
    systemRoleType = null,
    permissions = [],
    companyId = null,
    isActive = true,
    deletedAt = null,
    tenantId = 'tenant-1',
  } = options;

  return {
    id: 'user-1',
    email: 'user@test.com',
    tenantId,
    isActive,
    deletedAt,
    roleAssignments: [
      {
        id: 'assignment-1',
        companyId,
        role: {
          id: 'role-1',
          systemRoleType,
          permissions: permissions.map((p, i) => ({
            id: `rp-${i}`,
            permission: {
              id: `perm-${i}`,
              resource: p.resource,
              action: p.action,
            },
          })),
        },
      },
    ],
  };
}

describe('RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllPermissionCache();
  });

  // ============================================================================
  // Session-based permission checks (synchronous)
  // ============================================================================

  describe('canAccessAuditLogs', () => {
    it('should allow SUPER_ADMIN to access audit logs', () => {
      const session = createMockSession({ isSuperAdmin: true });
      expect(canAccessAuditLogs(session)).toBe(true);
    });

    it('should allow TENANT_ADMIN to access audit logs', () => {
      const session = createMockSession({ isWorkspaceAdmin: true, hasAllCompaniesAccess: true });
      expect(canAccessAuditLogs(session)).toBe(true);
    });

    it('should deny regular users access to audit logs', () => {
      const session = createMockSession({ companyIds: ['company-1'] });
      expect(canAccessAuditLogs(session)).toBe(false);
    });
  });

  describe('canCreateCompanies', () => {
    it('should allow SUPER_ADMIN to create companies', () => {
      const session = createMockSession({ isSuperAdmin: true });
      expect(canCreateCompanies(session)).toBe(true);
    });

    it('should allow TENANT_ADMIN to create companies', () => {
      const session = createMockSession({ isWorkspaceAdmin: true });
      expect(canCreateCompanies(session)).toBe(true);
    });

    it('should deny regular users from creating companies', () => {
      const session = createMockSession({ companyIds: ['company-1'] });
      expect(canCreateCompanies(session)).toBe(false);
    });
  });

  describe('canManageUsers', () => {
    it('should allow SUPER_ADMIN to manage users', () => {
      const session = createMockSession({ isSuperAdmin: true });
      expect(canManageUsers(session)).toBe(true);
    });

    it('should allow TENANT_ADMIN to manage users', () => {
      const session = createMockSession({ isWorkspaceAdmin: true });
      expect(canManageUsers(session)).toBe(true);
    });

    it('should deny regular users from managing users', () => {
      const session = createMockSession({ companyIds: ['company-1'] });
      expect(canManageUsers(session)).toBe(false);
    });
  });

  describe('canManageRoles', () => {
    it('should allow SUPER_ADMIN to manage roles', () => {
      const session = createMockSession({ isSuperAdmin: true });
      expect(canManageRoles(session)).toBe(true);
    });

    it('should allow TENANT_ADMIN to manage roles', () => {
      const session = createMockSession({ isWorkspaceAdmin: true });
      expect(canManageRoles(session)).toBe(true);
    });

    it('should deny regular users from managing roles', () => {
      const session = createMockSession({ companyIds: ['company-1'] });
      expect(canManageRoles(session)).toBe(false);
    });
  });

  describe('canExportData', () => {
    it('should allow SUPER_ADMIN to export data', () => {
      const session = createMockSession({ isSuperAdmin: true });
      expect(canExportData(session)).toBe(true);
    });

    it('should allow TENANT_ADMIN to export data', () => {
      const session = createMockSession({ isWorkspaceAdmin: true });
      expect(canExportData(session)).toBe(true);
    });

    it('should deny regular users from exporting data', () => {
      const session = createMockSession({ companyIds: ['company-1'] });
      expect(canExportData(session)).toBe(false);
    });
  });

  describe('canReadCompanies', () => {
    it('should allow SUPER_ADMIN to read companies', () => {
      const session = createMockSession({ isSuperAdmin: true });
      expect(canReadCompanies(session)).toBe(true);
    });

    it('should allow TENANT_ADMIN to read companies', () => {
      const session = createMockSession({ isWorkspaceAdmin: true });
      expect(canReadCompanies(session)).toBe(true);
    });

    it('should allow all authenticated users to read companies', () => {
      const session = createMockSession({ companyIds: ['company-1'] });
      expect(canReadCompanies(session)).toBe(true);
    });
  });

  // ============================================================================
  // Database-based permission checks (async)
  // ============================================================================

  describe('hasPermission', () => {
    it('should return false for non-existent user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const result = await hasPermission('non-existent', 'company', 'read');
      expect(result).toBe(false);
    });

    it('should return false for inactive user', async () => {
      const mockUser = createMockUserWithRoles({
        isActive: false,
        permissions: [{ resource: 'company', action: 'read' }],
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const result = await hasPermission('user-1', 'company', 'read');
      expect(result).toBe(false);
    });

    it('should return false for deleted user', async () => {
      const mockUser = createMockUserWithRoles({
        deletedAt: new Date(),
        permissions: [{ resource: 'company', action: 'read' }],
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const result = await hasPermission('user-1', 'company', 'read');
      expect(result).toBe(false);
    });

    it('should allow SUPER_ADMIN all permissions', async () => {
      const mockUser = createMockUserWithRoles({
        systemRoleType: 'SUPER_ADMIN',
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const result = await hasPermission('user-1', 'tenant', 'manage');
      expect(result).toBe(true);
    });

    it('should allow TENANT_ADMIN all permissions within tenant', async () => {
      const mockUser = createMockUserWithRoles({
        systemRoleType: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const result = await hasPermission('user-1', 'company', 'delete');
      expect(result).toBe(true);
    });

    it('should deny TENANT_ADMIN access to company from different tenant', async () => {
      const mockUser = createMockUserWithRoles({
        systemRoleType: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        id: 'company-1',
        tenantId: 'tenant-2', // Different tenant
      } as never);

      const result = await hasPermission('user-1', 'company', 'read', 'company-1');
      expect(result).toBe(false);
    });

    it('should not grant TENANT_ADMIN cross-tenant access from cached result', async () => {
      const mockUser = createMockUserWithRoles({
        systemRoleType: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        id: 'company-1',
        tenantId: 'tenant-2',
      } as never);

      const firstAttempt = await hasPermission('user-1', 'company', 'read', 'company-1');
      const secondAttempt = await hasPermission('user-1', 'company', 'read', 'company-1');

      expect(firstAttempt).toBe(false);
      expect(secondAttempt).toBe(false);
    });

    it('should check specific permission for regular user', async () => {
      const mockUser = createMockUserWithRoles({
        permissions: [{ resource: 'company', action: 'read' }],
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const result = await hasPermission('user-1', 'company', 'read');
      expect(result).toBe(true);
    });

    it('should deny permission user does not have', async () => {
      const mockUser = createMockUserWithRoles({
        permissions: [{ resource: 'company', action: 'read' }],
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const result = await hasPermission('user-1', 'company', 'delete');
      expect(result).toBe(false);
    });

    it('should allow action if user has manage permission', async () => {
      const mockUser = createMockUserWithRoles({
        permissions: [{ resource: 'company', action: 'manage' }],
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      // 'manage' should grant any action
      const result = await hasPermission('user-1', 'company', 'delete');
      expect(result).toBe(true);
    });

    it('should use company-specific role when checking company permission', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'user@test.com',
        tenantId: 'tenant-1',
        isActive: true,
        deletedAt: null,
        roleAssignments: [
          // Tenant-wide role with read-only
          {
            id: 'assignment-1',
            companyId: null,
            role: {
              id: 'role-1',
              systemRoleType: null,
              permissions: [
                { id: 'rp-1', permission: { id: 'p-1', resource: 'company', action: 'read' } },
              ],
            },
          },
          // Company-specific role with update permission
          {
            id: 'assignment-2',
            companyId: 'company-1',
            role: {
              id: 'role-2',
              systemRoleType: null,
              permissions: [
                { id: 'rp-2', permission: { id: 'p-2', resource: 'company', action: 'update' } },
              ],
            },
          },
        ],
      };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      // For company-1, should use company-specific role (update only, not read)
      const canUpdate = await hasPermission('user-1', 'company', 'update', 'company-1');
      expect(canUpdate).toBe(true);
    });
  });

  describe('hasAnyPermission', () => {
    it('should return true if user has at least one permission', async () => {
      const mockUser = createMockUserWithRoles({
        permissions: [{ resource: 'company', action: 'read' }],
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const result = await hasAnyPermission('user-1', [
        { resource: 'company', action: 'read' },
        { resource: 'company', action: 'update' },
      ]);
      expect(result).toBe(true);
    });

    it('should return false if user has none of the permissions', async () => {
      const mockUser = createMockUserWithRoles({
        permissions: [{ resource: 'contact', action: 'read' }],
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const result = await hasAnyPermission('user-1', [
        { resource: 'company', action: 'read' },
        { resource: 'company', action: 'update' },
      ]);
      expect(result).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('should return true if user has all permissions', async () => {
      const mockUser = createMockUserWithRoles({
        permissions: [
          { resource: 'company', action: 'read' },
          { resource: 'company', action: 'update' },
        ],
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const result = await hasAllPermissions('user-1', [
        { resource: 'company', action: 'read' },
        { resource: 'company', action: 'update' },
      ]);
      expect(result).toBe(true);
    });

    it('should return false if user is missing any permission', async () => {
      const mockUser = createMockUserWithRoles({
        permissions: [{ resource: 'company', action: 'read' }],
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const result = await hasAllPermissions('user-1', [
        { resource: 'company', action: 'read' },
        { resource: 'company', action: 'update' },
      ]);
      expect(result).toBe(false);
    });
  });

  describe('requirePermission', () => {
    it('should deny TENANT_ADMIN access to company outside their tenant', async () => {
      const session = createMockSession({
        id: 'user-1',
        tenantId: 'tenant-1',
        isWorkspaceAdmin: true,
      });
      const mockUser = createMockUserWithRoles({
        systemRoleType: 'TENANT_ADMIN',
        tenantId: 'tenant-1',
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        id: 'company-1',
        tenantId: 'tenant-2',
      } as never);

      await expect(requirePermission(session, 'company', 'read', 'company-1')).rejects.toThrow(
        'Permission denied: company:read'
      );
    });
  });

  describe('getUserPermissions', () => {
    it('should return all permissions for SUPER_ADMIN', async () => {
      const mockUser = createMockUserWithRoles({
        systemRoleType: 'SUPER_ADMIN',
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const permissions = await getUserPermissions('user-1');

      // SUPER_ADMIN should have all resource:action combinations
      expect(permissions.length).toBe(RESOURCES.length * ACTIONS.length);
      expect(permissions).toContain('company:read');
      expect(permissions).toContain('tenant:manage');
    });

    it('should return TENANT_ADMIN permissions for tenant admin', async () => {
      const mockUser = createMockUserWithRoles({
        systemRoleType: 'TENANT_ADMIN',
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const permissions = await getUserPermissions('user-1');

      // TENANT_ADMIN should have predefined set of permissions
      expect(permissions).toContain('company:create');
      expect(permissions).toContain('company:read');
      expect(permissions).toContain('company:update');
      expect(permissions).toContain('company:delete');
      expect(permissions).toContain('user:create');
    });

    it('should return only assigned permissions for regular user', async () => {
      const mockUser = createMockUserWithRoles({
        permissions: [
          { resource: 'company', action: 'read' },
          { resource: 'document', action: 'read' },
        ],
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const permissions = await getUserPermissions('user-1');

      expect(permissions).toHaveLength(2);
      expect(permissions).toContain('company:read');
      expect(permissions).toContain('document:read');
    });

    it('should return empty array for non-existent user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const permissions = await getUserPermissions('non-existent');
      expect(permissions).toHaveLength(0);
    });
  });

  // ============================================================================
  // System role definitions
  // ============================================================================

  describe('SYSTEM_ROLES', () => {
    it('should define ADMIN with expected permissions', () => {
      expect(SYSTEM_ROLES.ADMIN.permissions).toContain('company:create');
      expect(SYSTEM_ROLES.ADMIN.permissions).toContain('user:create');
      expect(SYSTEM_ROLES.ADMIN.permissions).toContain('role:create');
      expect(SYSTEM_ROLES.ADMIN.permissions).toContain('audit_log:read');
    });

    it('should define MANAGER with limited permissions', () => {
      expect(SYSTEM_ROLES.MANAGER.permissions).toContain('company:read');
      expect(SYSTEM_ROLES.MANAGER.permissions).toContain('company:update');
      expect(SYSTEM_ROLES.MANAGER.permissions).not.toContain('company:create');
      expect(SYSTEM_ROLES.MANAGER.permissions).not.toContain('company:delete');
      expect(SYSTEM_ROLES.MANAGER.permissions).not.toContain('user:create');
    });

    it('should define STAFF with read-only permissions', () => {
      expect(SYSTEM_ROLES.STAFF.permissions).toContain('company:read');
      expect(SYSTEM_ROLES.STAFF.permissions).toContain('document:read');
      expect(SYSTEM_ROLES.STAFF.permissions).not.toContain('company:update');
      expect(SYSTEM_ROLES.STAFF.permissions).not.toContain('document:create');
    });
  });

  // ============================================================================
  // Constants validation
  // ============================================================================

  describe('RESOURCES constant', () => {
    it('should include all expected resources', () => {
      expect(RESOURCES).toContain('tenant');
      expect(RESOURCES).toContain('user');
      expect(RESOURCES).toContain('role');
      expect(RESOURCES).toContain('company');
      expect(RESOURCES).toContain('contact');
      expect(RESOURCES).toContain('document');
      expect(RESOURCES).toContain('officer');
      expect(RESOURCES).toContain('shareholder');
      expect(RESOURCES).toContain('audit_log');
    });
  });

  describe('ACTIONS constant', () => {
    it('should include all expected actions', () => {
      expect(ACTIONS).toContain('create');
      expect(ACTIONS).toContain('read');
      expect(ACTIONS).toContain('update');
      expect(ACTIONS).toContain('delete');
      expect(ACTIONS).toContain('export');
      expect(ACTIONS).toContain('import');
      expect(ACTIONS).toContain('manage');
    });
  });
});
