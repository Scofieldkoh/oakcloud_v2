import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    company: {
      findMany: vi.fn(),
    },
    role: {
      findMany: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    userCompanyAssignment: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    userRoleAssignment: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
  computeChanges: vi.fn(),
  logTenantOperation: vi.fn(),
  logUserMembership: vi.fn(),
}));

vi.mock('@/lib/workspace', () => ({
  generateWorkspaceSlug: vi.fn(),
  getWorkspaceLimits: vi.fn(),
}));

vi.mock('@/services/deadline-rule/starter-drafts', () => ({
  createServiceScheduleStarterData: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  createSystemRolesForWorkspace: vi.fn(),
  getSystemRoleId: vi.fn(),
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/email-templates', () => ({
  userInvitationEmail: vi.fn(() => ({
    subject: 'Invite',
    html: '<p>Invite</p>',
  })),
  tenantSetupCompleteEmail: vi.fn(),
  userRemovedEmail: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(),
  },
}));

import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { generateWorkspaceSlug, getWorkspaceLimits } from '@/lib/workspace';
import { sendEmail } from '@/lib/email';
import { userInvitationEmail } from '@/lib/email-templates';
import { logUserMembership } from '@/lib/audit';
import { createWorkspace, inviteUserToWorkspace } from '@/services/workspace.service';
import { createServiceScheduleStarterData } from '@/services/deadline-rule/starter-drafts';

describe('tenant.service - inviteUserToWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getWorkspaceLimits).mockResolvedValue({
      maxUsers: 10,
      maxCompanies: 10,
      maxStorageMb: 1000,
      currentUsers: 1,
      currentCompanies: 1,
      currentStorageMb: 10,
    });

    vi.mocked(prisma.company.findMany).mockResolvedValue([{ id: 'company-1' }] as never);
    vi.mocked(prisma.role.findMany).mockResolvedValue([{ id: 'role-1' }] as never);
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ name: 'Oaktree Accounting' } as never);
    vi.mocked(sendEmail).mockResolvedValue({ success: true } as never);
    vi.mocked(userInvitationEmail).mockReturnValue({
      subject: 'Invite',
      html: '<p>Invite</p>',
    });
    vi.mocked((bcrypt as { hash: (...args: unknown[]) => Promise<string> }).hash).mockResolvedValue('hashed-temp-password');
  });

  it('restores a soft-deleted user in the same tenant', async () => {
    const deletedUser = {
      id: 'user-deleted-1',
      email: 'removed@example.com',
      firstName: 'Removed',
      lastName: 'User',
      tenantId: 'tenant-1',
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
      isActive: false,
    };
    const inviter = { firstName: 'Super', lastName: 'Admin' };
    const restoredUser = {
      ...deletedUser,
      firstName: 'Re',
      lastName: 'Invited',
      deletedAt: null,
      isActive: true,
    };

    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(deletedUser as never)
      .mockResolvedValueOnce(inviter as never);

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
    vi.mocked(prisma.user.update).mockResolvedValue(restoredUser as never);

    const result = await inviteUserToWorkspace(
      'tenant-1',
      {
        email: 'Removed@Example.com',
        firstName: 'Re',
        lastName: 'Invited',
        companyAssignments: [{ companyId: 'company-1', isPrimary: true }],
        roleAssignments: [{ roleId: 'role-1', companyId: null }],
      },
      'inviter-1'
    );

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: deletedUser.id },
        data: expect.objectContaining({
          deletedAt: null,
          isActive: true,
          mustChangePassword: true,
        }),
      })
    );
    expect(prisma.userCompanyAssignment.deleteMany).toHaveBeenCalledWith({ where: { userId: deletedUser.id } });
    expect(prisma.userRoleAssignment.deleteMany).toHaveBeenCalledWith({ where: { userId: deletedUser.id } });
    expect(prisma.userCompanyAssignment.createMany).toHaveBeenCalled();
    expect(prisma.userRoleAssignment.createMany).toHaveBeenCalled();
    expect(logUserMembership).toHaveBeenCalledWith(
      expect.anything(),
      'USER_INVITED',
      deletedUser.id,
      expect.objectContaining({ reactivated: true })
    );
    expect(result.user.email).toBe('removed@example.com');
  });

  it('still rejects invite when an active user with the email exists', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-active-1',
      email: 'active@example.com',
      tenantId: 'tenant-1',
      deletedAt: null,
      isActive: true,
    } as never);

    await expect(
      inviteUserToWorkspace(
        'tenant-1',
        {
          email: 'active@example.com',
          firstName: 'Active',
          lastName: 'User',
          roleAssignments: [{ roleId: 'role-1', companyId: null }],
        },
        'inviter-1'
      )
    ).rejects.toThrow('A user with this email already exists');

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('workspace starter provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateWorkspaceSlug).mockResolvedValue('new-workspace');
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.workspace.create).mockResolvedValue({
      id: 'workspace-1',
      name: 'New Workspace',
      slug: 'new-workspace',
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
  });

  it('provisions starter schedule data inside workspace creation transaction', async () => {
    await createWorkspace({
      name: 'New Workspace',
      contactEmail: 'owner@example.com',
    }, 'creator-1');

    expect(createServiceScheduleStarterData).toHaveBeenCalledWith(prisma, 'workspace-1');
  });
});
