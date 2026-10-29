/**
 * Audit Logging Tests
 *
 * Tests for audit log creation, change tracking, and history queries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before importing audit functions
vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock request context
vi.mock('@/lib/request-context', () => ({
  getRequestContext: vi.fn(() => ({
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    sessionId: 'test-session',
  })),
  getAuditRequestContext: vi.fn(() => Promise.resolve({
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
    sessionId: 'test-session',
  })),
}));

import { prisma } from '@/lib/prisma';
import {
  computeChanges,
  createAuditLog,
  createAuditLogBatch,
  createAuditContext,
  getAuditHistory,
} from '@/lib/audit';

describe('Audit Logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // computeChanges Tests
  // ============================================================================

  describe('computeChanges', () => {
    it('should detect simple string changes', () => {
      const oldData = { name: 'Old Name', status: 'ACTIVE' };
      const newData = { name: 'New Name' };
      const fieldsToTrack: (keyof typeof oldData)[] = ['name', 'status'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).not.toBeNull();
      expect(changes?.name).toEqual({ old: 'Old Name', new: 'New Name' });
      expect(changes?.status).toBeUndefined(); // Not in newData
    });

    it('should detect number changes', () => {
      const oldData = { amount: 100, count: 5 };
      const newData = { amount: 200 };
      const fieldsToTrack: (keyof typeof oldData)[] = ['amount', 'count'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).not.toBeNull();
      expect(changes?.amount).toEqual({ old: 100, new: 200 });
    });

    it('should detect boolean changes', () => {
      const oldData = { isActive: true, isVerified: false };
      const newData = { isActive: false };
      const fieldsToTrack: (keyof typeof oldData)[] = ['isActive', 'isVerified'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).not.toBeNull();
      expect(changes?.isActive).toEqual({ old: true, new: false });
    });

    it('should detect null to value changes', () => {
      const oldData = { email: null as string | null };
      const newData = { email: 'test@test.com' };
      const fieldsToTrack: (keyof typeof oldData)[] = ['email'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).not.toBeNull();
      expect(changes?.email).toEqual({ old: null, new: 'test@test.com' });
    });

    it('should detect value to null changes', () => {
      const oldData = { email: 'test@test.com' as string | null };
      const newData = { email: null };
      const fieldsToTrack: (keyof typeof oldData)[] = ['email'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).not.toBeNull();
      expect(changes?.email).toEqual({ old: 'test@test.com', new: null });
    });

    it('should return null when no changes', () => {
      const oldData = { name: 'Same Name', status: 'ACTIVE' };
      const newData = { name: 'Same Name' };
      const fieldsToTrack: (keyof typeof oldData)[] = ['name', 'status'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).toBeNull();
    });

    it('should ignore fields not in fieldsToTrack', () => {
      const oldData = { name: 'Name', secret: 'old-secret' };
      const newData = { name: 'Name', secret: 'new-secret' };
      const fieldsToTrack: (keyof typeof oldData)[] = ['name'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).toBeNull();
    });

    it('should skip undefined new values', () => {
      const oldData = { name: 'Name', status: 'ACTIVE' };
      const newData = { name: undefined } as Partial<typeof oldData>;
      const fieldsToTrack: (keyof typeof oldData)[] = ['name', 'status'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).toBeNull();
    });

    it('should detect array changes', () => {
      const oldData = { tags: ['a', 'b'] };
      const newData = { tags: ['a', 'b', 'c'] };
      const fieldsToTrack: (keyof typeof oldData)[] = ['tags'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).not.toBeNull();
      expect(changes?.tags).toEqual({ old: ['a', 'b'], new: ['a', 'b', 'c'] });
    });

    it('should detect Date changes', () => {
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-06-01');
      const oldData = { createdAt: date1 };
      const newData = { createdAt: date2 };
      const fieldsToTrack: (keyof typeof oldData)[] = ['createdAt'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).not.toBeNull();
      expect(changes?.createdAt).toEqual({ old: date1, new: date2 });
    });

    it('should detect nested object changes', () => {
      const oldData = { config: { theme: 'light', lang: 'en' } };
      const newData = { config: { theme: 'dark', lang: 'en' } };
      const fieldsToTrack: (keyof typeof oldData)[] = ['config'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).not.toBeNull();
    });

    it('should not detect changes for equal nested objects', () => {
      const oldData = { config: { theme: 'light', lang: 'en' } };
      const newData = { config: { theme: 'light', lang: 'en' } };
      const fieldsToTrack: (keyof typeof oldData)[] = ['config'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).toBeNull();
    });

    it('should handle multiple field changes', () => {
      const oldData = { name: 'Old', status: 'INACTIVE', count: 0 };
      const newData = { name: 'New', status: 'ACTIVE', count: 10 };
      const fieldsToTrack: (keyof typeof oldData)[] = ['name', 'status', 'count'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).not.toBeNull();
      expect(Object.keys(changes!)).toHaveLength(3);
      expect(changes?.name).toEqual({ old: 'Old', new: 'New' });
      expect(changes?.status).toEqual({ old: 'INACTIVE', new: 'ACTIVE' });
      expect(changes?.count).toEqual({ old: 0, new: 10 });
    });
  });

  // ============================================================================
  // createAuditLog Tests
  // ============================================================================

  describe('createAuditLog', () => {
    it('should create audit log entry', async () => {
      vi.mocked(prisma.auditLog.create).mockResolvedValue({
        id: 'audit-1',
        action: 'CREATE',
        entityType: 'Company',
        entityId: 'company-1',
      } as never);

      await createAuditLog({
        action: 'CREATE',
        entityType: 'Company',
        entityId: 'company-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'CREATE',
          entityType: 'Company',
          entityId: 'company-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
        }),
      });
    });

    it('should include changes data when provided', async () => {
      vi.mocked(prisma.auditLog.create).mockResolvedValue({
        id: 'audit-1',
      } as never);

      const changes = { name: { old: 'Old', new: 'New' } };

      await createAuditLog({
        action: 'UPDATE',
        entityType: 'Company',
        entityId: 'company-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        changes,
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changes,
        }),
      });
    });

    it('should include metadata when provided', async () => {
      vi.mocked(prisma.auditLog.create).mockResolvedValue({
        id: 'audit-1',
      } as never);

      const metadata = { reason: 'User requested', source: 'API' };

      await createAuditLog({
        action: 'DELETE',
        entityType: 'Company',
        entityId: 'company-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        metadata,
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata,
        }),
      });
    });
  });

  // ============================================================================
  // createAuditLogBatch Tests
  // ============================================================================

  describe('createAuditLogBatch', () => {
    it('should create multiple audit log entries', async () => {
      vi.mocked(prisma.auditLog.createMany).mockResolvedValue({ count: 3 });

      await createAuditLogBatch([
        {
          action: 'CREATE',
          entityType: 'Company',
          entityId: 'company-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
        },
        {
          action: 'CREATE',
          entityType: 'Company',
          entityId: 'company-2',
          userId: 'user-1',
          tenantId: 'tenant-1',
        },
        {
          action: 'CREATE',
          entityType: 'Company',
          entityId: 'company-3',
          userId: 'user-1',
          tenantId: 'tenant-1',
        },
      ]);

      expect(prisma.auditLog.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ entityId: 'company-1' }),
          expect.objectContaining({ entityId: 'company-2' }),
          expect.objectContaining({ entityId: 'company-3' }),
        ]),
      });
    });

    it('should handle empty batch', async () => {
      vi.mocked(prisma.auditLog.createMany).mockResolvedValue({ count: 0 });

      await createAuditLogBatch([]);

      expect(prisma.auditLog.createMany).toHaveBeenCalledWith({
        data: [],
      });
    });
  });

  // ============================================================================
  // createAuditContext Tests
  // ============================================================================

  describe('createAuditContext', () => {
    it('should create context with tenant and user', async () => {
      const context = await createAuditContext({
        tenantId: 'tenant-1',
        userId: 'user-1',
        changeSource: 'MANUAL',
      });

      expect(context).toMatchObject({
        tenantId: 'tenant-1',
        userId: 'user-1',
        changeSource: 'MANUAL',
      });
      // Context also includes request info from getAuditRequestContext
      expect(context.ipAddress).toBe('127.0.0.1');
      expect(context.userAgent).toBe('test-agent');
    });

    it('should accept different change sources', async () => {
      const manualContext = await createAuditContext({
        tenantId: 'tenant-1',
        userId: 'user-1',
        changeSource: 'MANUAL',
      });

      const bizfileContext = await createAuditContext({
        tenantId: 'tenant-1',
        userId: 'user-1',
        changeSource: 'BIZFILE_UPLOAD',
      });

      const apiContext = await createAuditContext({
        tenantId: 'tenant-1',
        userId: 'user-1',
        changeSource: 'API',
      });

      expect(manualContext.changeSource).toBe('MANUAL');
      expect(bizfileContext.changeSource).toBe('BIZFILE_UPLOAD');
      expect(apiContext.changeSource).toBe('API');
    });
  });

  // ============================================================================
  // getAuditHistory Tests
  // ============================================================================

  describe('getAuditHistory', () => {
    it('should fetch audit history for entity', async () => {
      const mockLogs = [
        { id: 'log-1', action: 'CREATE', createdAt: new Date() },
        { id: 'log-2', action: 'UPDATE', createdAt: new Date() },
      ];

      vi.mocked(prisma.auditLog.findMany).mockResolvedValue(mockLogs as never);

      const result = await getAuditHistory('Company', 'company-1');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entityType: 'Company',
            entityId: 'company-1',
          }),
        })
      );
      expect(result).toHaveLength(2);
    });

    it('should filter by action types', async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);

      await getAuditHistory('Company', 'company-1', {
        actions: ['CREATE', 'UPDATE'],
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: { in: ['CREATE', 'UPDATE'] },
          }),
        })
      );
    });

    it('should filter by start date', async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);

      const startDate = new Date('2024-01-01');

      await getAuditHistory('Company', 'company-1', {
        startDate,
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: startDate },
          }),
        })
      );
    });

    it('should filter by end date', async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);

      const endDate = new Date('2024-12-31');

      await getAuditHistory('Company', 'company-1', {
        endDate,
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { lte: endDate },
          }),
        })
      );
    });

    it('should filter by user', async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);

      await getAuditHistory('Company', 'company-1', {
        userId: 'user-1',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
          }),
        })
      );
    });

    it('should use offset and limit for pagination', async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);

      await getAuditHistory('Company', 'company-1', {
        offset: 20,
        limit: 20,
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
        })
      );
    });

    it('should use default limit of 50', async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);

      await getAuditHistory('Company', 'company-1');

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          skip: 0,
        })
      );
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('computeChanges should handle empty fieldsToTrack', () => {
      const oldData = { name: 'Test' };
      const newData = { name: 'New Test' };
      const fieldsToTrack: (keyof typeof oldData)[] = [];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).toBeNull();
    });

    it('computeChanges should handle same Date objects', () => {
      const date = new Date('2024-01-01');
      const oldData = { createdAt: date };
      const newData = { createdAt: new Date('2024-01-01') }; // Same value, different object
      const fieldsToTrack: (keyof typeof oldData)[] = ['createdAt'];

      const changes = computeChanges(oldData, newData, fieldsToTrack);

      expect(changes).toBeNull();
    });

    it('createAuditLog should handle null changes', async () => {
      vi.mocked(prisma.auditLog.create).mockResolvedValue({
        id: 'audit-1',
      } as never);

      await createAuditLog({
        action: 'UPDATE',
        entityType: 'Company',
        entityId: 'company-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        changes: undefined,
      });

      expect(prisma.auditLog.create).toHaveBeenCalled();
    });
  });
});
