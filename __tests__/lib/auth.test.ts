/**
 * Authentication Library Tests
 *
 * Comprehensive tests for JWT, session management, and access control functions.
 * JWT_SECRET is configured in vitest.setup.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock audit logging
vi.mock('@/lib/audit', () => ({
  logAuthEvent: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import {
  verifyToken,
  isSuperAdmin,
  isWorkspaceAdmin,
  isAdmin,
  canAccessWorkspace,
  canAccessCompany,
  canManageWorkspace,
  canManageUsers,
  canManageCompanies,
} from '@/lib/auth';
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

describe('Authentication Library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Token Verification Tests
  // ============================================================================

  describe('verifyToken', () => {
    it('should return null for invalid token', async () => {
      const result = await verifyToken('invalid-token');
      expect(result).toBeNull();
    });

    it('should return null for malformed token', async () => {
      const result = await verifyToken('not.a.valid.jwt');
      expect(result).toBeNull();
    });

    it('should return null for empty token', async () => {
      const result = await verifyToken('');
      expect(result).toBeNull();
    });

    it('should return null for random base64 string', async () => {
      const fakeToken = btoa('random-data') + '.' + btoa('more-random') + '.' + btoa('signature');
      const result = await verifyToken(fakeToken);
      expect(result).toBeNull();
    });

    it('should return null for token with wrong signature', async () => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ userId: 'test', email: 'test@test.com' }));
      const fakeSignature = btoa('fake-signature');
      const result = await verifyToken(`${header}.${payload}.${fakeSignature}`);
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // Role Check Tests
  // ============================================================================

  describe('isSuperAdmin', () => {
    it('should return true for super admin user', () => {
      const session = createMockSession({ isSuperAdmin: true });
      expect(isSuperAdmin(session)).toBe(true);
    });

    it('should return false for non-super admin user', () => {
      const session = createMockSession({ isSuperAdmin: false });
      expect(isSuperAdmin(session)).toBe(false);
    });

    it('should return false for tenant admin user', () => {
      const session = createMockSession({ isWorkspaceAdmin: true, isSuperAdmin: false });
      expect(isSuperAdmin(session)).toBe(false);
    });
  });

  describe('isWorkspaceAdmin', () => {
    it('should return true for tenant admin user', () => {
      const session = createMockSession({ isWorkspaceAdmin: true });
      expect(isWorkspaceAdmin(session)).toBe(true);
    });

    it('should return false for non-tenant admin user', () => {
      const session = createMockSession({ isWorkspaceAdmin: false });
      expect(isWorkspaceAdmin(session)).toBe(false);
    });

    it('should return false for super admin without tenant admin role', () => {
      const session = createMockSession({ isSuperAdmin: true, isWorkspaceAdmin: false });
      expect(isWorkspaceAdmin(session)).toBe(false);
    });
  });

  describe('isAdmin', () => {
    it('should return true for super admin', () => {
      const session = createMockSession({ isSuperAdmin: true });
      expect(isAdmin(session)).toBe(true);
    });

    it('should return true for tenant admin', () => {
      const session = createMockSession({ isWorkspaceAdmin: true });
      expect(isAdmin(session)).toBe(true);
    });

    it('should return true when both super admin and tenant admin', () => {
      const session = createMockSession({ isSuperAdmin: true, isWorkspaceAdmin: true });
      expect(isAdmin(session)).toBe(true);
    });

    it('should return false for regular user', () => {
      const session = createMockSession({ isSuperAdmin: false, isWorkspaceAdmin: false });
      expect(isAdmin(session)).toBe(false);
    });
  });

  // ============================================================================
  // Access Control Tests
  // ============================================================================

  describe('canAccessWorkspace', () => {
    it('should allow super admin to access any tenant', () => {
      const session = createMockSession({ isSuperAdmin: true, tenantId: 'tenant-1' });
      expect(canAccessWorkspace(session, 'tenant-1')).toBe(true);
      expect(canAccessWorkspace(session, 'tenant-2')).toBe(true);
      expect(canAccessWorkspace(session, 'any-tenant')).toBe(true);
    });

    it('should allow user to access their own tenant', () => {
      const session = createMockSession({ tenantId: 'tenant-1' });
      expect(canAccessWorkspace(session, 'tenant-1')).toBe(true);
    });

    it('should deny user access to different tenant', () => {
      const session = createMockSession({ tenantId: 'tenant-1' });
      expect(canAccessWorkspace(session, 'tenant-2')).toBe(false);
    });

    it('should deny access when user has no tenant', () => {
      const session = createMockSession({ tenantId: null });
      expect(canAccessWorkspace(session, 'tenant-1')).toBe(false);
    });
  });

  describe('canAccessCompany', () => {
    it('should allow super admin to access any company', async () => {
      const session = createMockSession({ isSuperAdmin: true });
      const result = await canAccessCompany(session, 'any-company');
      expect(result).toBe(true);
      // Should not query database for super admin
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
    });

    it('should allow tenant admin to access company in their tenant', async () => {
      const session = createMockSession({ isWorkspaceAdmin: true, tenantId: 'tenant-1' });
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        id: 'company-1',
        tenantId: 'tenant-1',
      } as never);

      const result = await canAccessCompany(session, 'company-1');
      expect(result).toBe(true);
    });

    it('should deny tenant admin access to company in different tenant', async () => {
      const session = createMockSession({ isWorkspaceAdmin: true, tenantId: 'tenant-1' });
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        id: 'company-1',
        tenantId: 'tenant-2', // Different tenant
      } as never);

      const result = await canAccessCompany(session, 'company-1');
      expect(result).toBe(false);
    });

    it('should deny tenant admin access when they have no tenant', async () => {
      const session = createMockSession({ isWorkspaceAdmin: true, tenantId: null });
      const result = await canAccessCompany(session, 'company-1');
      expect(result).toBe(false);
    });

    it('should allow user with hasAllCompaniesAccess to access company in their tenant', async () => {
      const session = createMockSession({
        hasAllCompaniesAccess: true,
        tenantId: 'tenant-1',
      });
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        id: 'company-1',
        tenantId: 'tenant-1',
      } as never);

      const result = await canAccessCompany(session, 'company-1');
      expect(result).toBe(true);
    });

    it('should deny user with hasAllCompaniesAccess to company in different tenant', async () => {
      const session = createMockSession({
        hasAllCompaniesAccess: true,
        tenantId: 'tenant-1',
      });
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        id: 'company-1',
        tenantId: 'tenant-2',
      } as never);

      const result = await canAccessCompany(session, 'company-1');
      expect(result).toBe(false);
    });

    it('should allow regular user to access company in their companyIds', async () => {
      const session = createMockSession({
        companyIds: ['company-1', 'company-2'],
      });

      const result = await canAccessCompany(session, 'company-1');
      expect(result).toBe(true);
    });

    it('should deny regular user access to company not in their companyIds', async () => {
      const session = createMockSession({
        companyIds: ['company-1', 'company-2'],
      });

      const result = await canAccessCompany(session, 'company-3');
      expect(result).toBe(false);
    });

    it('should deny user with empty companyIds', async () => {
      const session = createMockSession({ companyIds: [] });

      const result = await canAccessCompany(session, 'company-1');
      expect(result).toBe(false);
    });
  });

  describe('canManageWorkspace', () => {
    it('should allow super admin to manage any tenant', () => {
      const session = createMockSession({ isSuperAdmin: true });
      expect(canManageWorkspace(session, 'any-tenant')).toBe(true);
    });

    it('should allow tenant admin to manage their own tenant', () => {
      const session = createMockSession({ isWorkspaceAdmin: true, tenantId: 'tenant-1' });
      expect(canManageWorkspace(session, 'tenant-1')).toBe(true);
    });

    it('should deny tenant admin managing different tenant', () => {
      const session = createMockSession({ isWorkspaceAdmin: true, tenantId: 'tenant-1' });
      expect(canManageWorkspace(session, 'tenant-2')).toBe(false);
    });

    it('should deny regular user managing any tenant', () => {
      const session = createMockSession({ tenantId: 'tenant-1' });
      expect(canManageWorkspace(session, 'tenant-1')).toBe(false);
    });
  });

  describe('canManageUsers', () => {
    it('should allow super admin to manage users', () => {
      const session = createMockSession({ isSuperAdmin: true });
      expect(canManageUsers(session)).toBe(true);
    });

    it('should allow tenant admin to manage users', () => {
      const session = createMockSession({ isWorkspaceAdmin: true });
      expect(canManageUsers(session)).toBe(true);
    });

    it('should deny regular user managing users', () => {
      const session = createMockSession();
      expect(canManageUsers(session)).toBe(false);
    });
  });

  describe('canManageCompanies', () => {
    it('should allow super admin to manage companies', () => {
      const session = createMockSession({ isSuperAdmin: true });
      expect(canManageCompanies(session)).toBe(true);
    });

    it('should allow tenant admin to manage companies', () => {
      const session = createMockSession({ isWorkspaceAdmin: true });
      expect(canManageCompanies(session)).toBe(true);
    });

    it('should deny regular user managing companies', () => {
      const session = createMockSession();
      expect(canManageCompanies(session)).toBe(false);
    });

    it('should deny user with hasAllCompaniesAccess from managing companies', () => {
      // hasAllCompaniesAccess gives read access, not management
      const session = createMockSession({ hasAllCompaniesAccess: true });
      expect(canManageCompanies(session)).toBe(false);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle null tenantId for super admin', () => {
      const session = createMockSession({ isSuperAdmin: true, tenantId: null });
      expect(canAccessWorkspace(session, 'any-tenant')).toBe(true);
      expect(canManageWorkspace(session, 'any-tenant')).toBe(true);
    });

    it('should handle user with both admin flags false', () => {
      const session = createMockSession({
        isSuperAdmin: false,
        isWorkspaceAdmin: false,
        companyIds: ['company-1'],
      });
      expect(isAdmin(session)).toBe(false);
      expect(canManageUsers(session)).toBe(false);
      expect(canManageCompanies(session)).toBe(false);
    });

    it('should handle company access when company does not exist', async () => {
      const session = createMockSession({ isWorkspaceAdmin: true, tenantId: 'tenant-1' });
      vi.mocked(prisma.company.findUnique).mockResolvedValue(null);

      const result = await canAccessCompany(session, 'non-existent');
      expect(result).toBe(false);
    });
  });
});
