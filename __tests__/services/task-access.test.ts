import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  hasPermission: vi.fn(),
  canAccessCompany: vi.fn(),
  taskFindFirst: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: mocks.requirePermission,
  hasPermission: mocks.hasPermission,
}));
vi.mock('@/lib/auth', () => ({
  canAccessCompany: mocks.canAccessCompany,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findFirst: mocks.taskFindFirst },
  },
}));

import {
  requireTaskAccess,
  requireTaskCollectionAccess,
} from '@/services/tasks/access';

const scopedSession = {
  id: 'user-1',
  email: 'staff@example.com',
  firstName: 'Staff',
  lastName: 'User',
  tenantId: 'tenant-a',
  isSuperAdmin: false,
  isWorkspaceAdmin: false,
  hasAllCompaniesAccess: false,
  companyIds: ['company-a'],
};

describe('task access reuses company RBAC and scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canAccessCompany.mockResolvedValue(true);
  });

  it('returns scoped company ids for list filtering', async () => {
    await expect(requireTaskCollectionAccess(
      scopedSession,
      'read',
    )).resolves.toEqual(['company-a']);
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      scopedSession,
      'company',
      'read',
    );
  });

  it('checks the task company with the requested existing permission', async () => {
    mocks.taskFindFirst.mockResolvedValue({ companyId: 'company-a' });

    await requireTaskAccess(scopedSession, 'tenant-a', 'task-1', 'update');

    expect(mocks.taskFindFirst).toHaveBeenCalledWith({
      where: { id: 'task-1', tenantId: 'tenant-a', deletedAt: null },
      select: { companyId: true },
    });
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      scopedSession,
      'company',
      'update',
      'company-a',
    );
    expect(mocks.canAccessCompany).toHaveBeenCalledWith(
      scopedSession,
      'company-a',
    );
  });

  it('denies a company-scoped actor access to an unassigned task', async () => {
    mocks.taskFindFirst.mockResolvedValue({ companyId: null });

    await expect(requireTaskAccess(
      scopedSession,
      'tenant-a',
      'task-1',
      'read',
    )).rejects.toMatchObject({ statusCode: 403 });
  });
});
