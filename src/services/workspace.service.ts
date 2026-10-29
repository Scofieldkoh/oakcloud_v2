/**
 * Workspace Service
 *
 * Business logic for tenant management including CRUD operations,
 * user management within tenants, and tenant-level operations.
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import type { WorkspaceStatus } from '@/generated/prisma';
import {
  createAuditLog,
  computeChanges,
  logTenantOperation as logWorkspaceOperation,
  logUserMembership,
  type AuditContext,
} from '@/lib/audit';
import { generateWorkspaceSlug, getWorkspaceLimits } from '@/lib/workspace';
import {
  createSystemRolesForWorkspace,
  getSystemRoleId,
} from '@/lib/rbac';
import { sendEmail } from '@/lib/email';
import { createLogger } from '@/lib/logger';
import {
  userInvitationEmail,
  tenantSetupCompleteEmail,
  userRemovedEmail,
} from '@/lib/email-templates';
import { createServiceScheduleStarterData } from '@/services/deadline-rule/starter-drafts';
import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  WorkspaceSearchInput,
  InviteUserInput,
  WorkspaceSettingsInput,
} from '@/lib/validations/workspace';
import bcrypt from 'bcryptjs';
import {
  BCRYPT_SALT_ROUNDS,
  DEFAULT_TENANT_MAX_USERS,
  DEFAULT_TENANT_MAX_COMPANIES,
  DEFAULT_TENANT_MAX_STORAGE_MB,
  DEFAULT_TENANT_PRIMARY_COLOR,
  TENANT_STATUSES,
  ERROR_MESSAGES,
} from '@/lib/constants/application';

const log = createLogger('tenant');

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceWithStats {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  contactEmail: string | null;
  createdAt: Date;
  _count: {
    users: number;
    companies: number;
  };
}

// Fields tracked for audit logging
const TRACKED_FIELDS: (keyof UpdateWorkspaceInput)[] = [
  'name',
  'slug',
  'contactEmail',
  'contactPhone',
  'maxUsers',
  'maxCompanies',
  'maxStorageMb',
  'logoUrl',
  'primaryColor',
];

// ============================================================================
// Create Workspace
// ============================================================================

export async function createWorkspace(
  data: CreateWorkspaceInput,
  userId?: string
) {
  // Generate slug if not provided
  const slug = data.slug || (await generateWorkspaceSlug(data.name));

  try {
    // Use a transaction to prevent race conditions
    // The unique constraint on slug will be enforced at database level
    const tenant = await prisma.$transaction(async (tx) => {
      // Check slug uniqueness within transaction
      const existing = await tx.workspace.findUnique({
        where: { slug },
      });

      if (existing) {
        throw new Error('Workspace slug already exists');
      }

      const createdWorkspace = await tx.workspace.create({
        data: {
          name: data.name,
          slug,
          status: TENANT_STATUSES.PENDING_SETUP,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone,
          maxUsers: data.maxUsers || DEFAULT_TENANT_MAX_USERS,
          maxCompanies: data.maxCompanies || DEFAULT_TENANT_MAX_COMPANIES,
          maxStorageMb: data.maxStorageMb || DEFAULT_TENANT_MAX_STORAGE_MB,
          logoUrl: data.logoUrl,
          primaryColor: data.primaryColor || DEFAULT_TENANT_PRIMARY_COLOR,
          settings: data.settings ? (data.settings as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });
      await createServiceScheduleStarterData(tx, createdWorkspace.id);
      return createdWorkspace;
    });

    // Log tenant creation (outside transaction - non-critical)
    await logWorkspaceOperation('TENANT_CREATED', tenant.id, tenant.name, userId, undefined, undefined);

    // Initialize system roles for the new tenant
    await createSystemRolesForWorkspace(tenant.id);

    return tenant;
  } catch (error) {
    // Handle database unique constraint violation using Prisma error codes
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('Workspace slug already exists');
    }
    throw error;
  }
}

// ============================================================================
// Get Workspace
// ============================================================================

export async function getWorkspaceById(id: string) {
  return prisma.workspace.findUnique({
    where: { id, deletedAt: null },
    include: {
      _count: {
        select: {
          users: { where: { deletedAt: null, isActive: true } },
          companies: { where: { deletedAt: null } },
          documents: true,
        },
      },
    },
  });
}

export async function getWorkspaceBySlug(slug: string) {
  return prisma.workspace.findUnique({
    where: { slug, deletedAt: null },
    include: {
      _count: {
        select: {
          users: { where: { deletedAt: null, isActive: true } },
          companies: { where: { deletedAt: null } },
        },
      },
    },
  });
}

// ============================================================================
// Update Workspace
// ============================================================================

export async function updateWorkspace(
  data: UpdateWorkspaceInput,
  userId?: string,
  reason?: string
) {
  const { id, ...updateData } = data;

  // Get existing tenant
  const existing = await prisma.workspace.findUnique({
    where: { id, deletedAt: null },
  });

  if (!existing) {
    throw new Error(ERROR_MESSAGES.TENANT_NOT_FOUND);
  }

  // Check slug uniqueness if being updated
  if (updateData.slug && updateData.slug !== existing.slug) {
    const slugExists = await prisma.workspace.findUnique({
      where: { slug: updateData.slug },
    });
    if (slugExists) {
      throw new Error('Workspace slug already exists');
    }
  }

  // Update tenant
  const tenant = await prisma.workspace.update({
    where: { id },
    data: {
      ...updateData,
      settings: updateData.settings
        ? (updateData.settings as Prisma.InputJsonValue)
        : undefined,
    },
  });

  // Compute and log changes
  const changes = computeChanges(
    existing as unknown as Record<string, unknown>,
    updateData as Record<string, unknown>,
    TRACKED_FIELDS as string[]
  );

  if (changes) {
    await logWorkspaceOperation('TENANT_UPDATED', tenant.id, tenant.name, userId, changes, reason);
  }

  return tenant;
}

// ============================================================================
// Update Workspace Status
// ============================================================================

export async function updateWorkspaceStatus(
  id: string,
  status: WorkspaceStatus,
  userId?: string,
  reason?: string
) {
  const existing = await prisma.workspace.findUnique({
    where: { id, deletedAt: null },
  });

  if (!existing) {
    throw new Error(ERROR_MESSAGES.TENANT_NOT_FOUND);
  }

  const oldStatus = existing.status;

  const updateData: Prisma.WorkspaceUpdateInput = {
    status,
  };

  // Set timestamps based on status change
  if (status === TENANT_STATUSES.ACTIVE && oldStatus !== TENANT_STATUSES.ACTIVE) {
    updateData.activatedAt = new Date();
    updateData.suspendedAt = null;
    updateData.suspendReason = null;
  } else if (status === TENANT_STATUSES.SUSPENDED) {
    updateData.suspendedAt = new Date();
    updateData.suspendReason = reason;
  }

  const tenant = await prisma.workspace.update({
    where: { id },
    data: updateData,
  });

  // Log status change
  const action = status === TENANT_STATUSES.SUSPENDED ? 'TENANT_SUSPENDED' : 'TENANT_ACTIVATED';
  await logWorkspaceOperation(
    action,
    tenant.id,
    tenant.name,
    userId,
    { status: { old: oldStatus, new: status } },
    reason
  );

  return tenant;
}

// ============================================================================
// Search Workspaces
// ============================================================================

export async function searchWorkspaces(params: WorkspaceSearchInput) {
  const where: Prisma.WorkspaceWhereInput = {
    deletedAt: null,
    ...(params.query && {
      OR: [
        { name: { contains: params.query, mode: 'insensitive' } },
        { slug: { contains: params.query, mode: 'insensitive' } },
        { contactEmail: { contains: params.query, mode: 'insensitive' } },
      ],
    }),
    ...(params.status && { status: params.status }),
  };

  const orderBy: Prisma.WorkspaceOrderByWithRelationInput = {
    [params.sortBy]: params.sortOrder,
  };

  // Optimized: Fetch tenants without expensive _count with WHERE conditions
  // The counts are fetched separately only for the paginated results
  const [tenantsRaw, totalCount] = await Promise.all([
    prisma.workspace.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        contactEmail: true,
        contactPhone: true,
        logoUrl: true,
        primaryColor: true,
        createdAt: true,
        updatedAt: true,
        settings: true,
        maxUsers: true,
        maxCompanies: true,
        maxStorageMb: true,
      },
      orderBy,
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
    prisma.workspace.count({ where }),
  ]);

  // Batch fetch counts for the paginated tenants only (much faster than nested _count with WHERE)
  const tenantIds = tenantsRaw.map(t => t.id);

  const [userCounts, companyCounts] = await Promise.all([
    prisma.user.groupBy({
      by: ['tenantId'],
      where: {
        tenantId: { in: tenantIds },
        deletedAt: null,
        isActive: true,
      },
      _count: { id: true },
    }),
    prisma.company.groupBy({
      by: ['tenantId'],
      where: {
        tenantId: { in: tenantIds },
        deletedAt: null,
      },
      _count: { id: true },
    }),
  ]);

  // Create lookup maps for O(1) access
  const userCountMap = new Map(userCounts.map(u => [u.tenantId, u._count.id]));
  const companyCountMap = new Map(companyCounts.map(c => [c.tenantId, c._count.id]));

  // Merge counts into tenant objects
  const tenants = tenantsRaw.map(tenant => ({
    ...tenant,
    _count: {
      users: userCountMap.get(tenant.id) || 0,
      companies: companyCountMap.get(tenant.id) || 0,
    },
  }));

  return {
    tenants,
    totalCount,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(totalCount / params.limit),
  };
}

// ============================================================================
// Delete Workspace (Soft Delete with Cascade)
// ============================================================================

export async function deleteWorkspace(
  id: string,
  userId: string,
  reason: string
) {
  const existing = await prisma.workspace.findUnique({
    where: { id, deletedAt: null },
    include: {
      _count: {
        select: {
          users: { where: { deletedAt: null } },
          companies: { where: { deletedAt: null } },
          contacts: { where: { deletedAt: null } },
        },
      },
    },
  });

  if (!existing) {
    throw new Error(ERROR_MESSAGES.TENANT_NOT_FOUND);
  }

  // Only allow deletion when tenant is SUSPENDED or PENDING_SETUP
  if (existing.status !== TENANT_STATUSES.SUSPENDED && existing.status !== TENANT_STATUSES.PENDING_SETUP) {
    throw new Error('Workspace must be suspended or pending setup before it can be deleted');
  }

  const deletedAt = new Date();

  // Cascade soft-delete in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Soft-delete all users belonging to this tenant
    const usersDeleted = await tx.user.updateMany({
      where: { tenantId: id, deletedAt: null },
      data: { deletedAt, isActive: false },
    });

    // Soft-delete all companies belonging to this tenant
    const companiesDeleted = await tx.company.updateMany({
      where: { tenantId: id, deletedAt: null },
      data: { deletedAt, deletedReason: `Workspace deleted: ${reason}` },
    });

    // Soft-delete all contacts belonging to this tenant
    const contactsDeleted = await tx.contact.updateMany({
      where: { tenantId: id, deletedAt: null },
      data: { deletedAt },
    });

    // Soft-delete the tenant itself
    const tenant = await tx.workspace.update({
      where: { id },
      data: {
        deletedAt,
        deletedReason: reason,
        status: TENANT_STATUSES.DEACTIVATED,
      },
    });

    return {
      tenant,
      usersDeleted: usersDeleted.count,
      companiesDeleted: companiesDeleted.count,
      contactsDeleted: contactsDeleted.count,
    };
  });

  // Log deletion with cascade info
  const cascadeInfo = [];
  if (result.usersDeleted > 0) cascadeInfo.push(`${result.usersDeleted} users`);
  if (result.companiesDeleted > 0) cascadeInfo.push(`${result.companiesDeleted} companies`);
  if (result.contactsDeleted > 0) cascadeInfo.push(`${result.contactsDeleted} contacts`);
  const cascadeSummary = cascadeInfo.length > 0 ? ` (cascade: ${cascadeInfo.join(', ')})` : '';

  await createAuditLog({
    tenantId: result.tenant.id,
    userId,
    action: 'DELETE',
    entityType: 'Workspace',
    entityId: result.tenant.id,
    entityName: result.tenant.name,
    summary: `Deleted tenant "${result.tenant.name}"${cascadeSummary}`,
    changeSource: 'MANUAL',
    reason,
    metadata: {
      name: result.tenant.name,
      slug: result.tenant.slug,
      cascade: {
        usersDeleted: result.usersDeleted,
        companiesDeleted: result.companiesDeleted,
        contactsDeleted: result.contactsDeleted,
      },
    },
  });

  return result.tenant;
}

// ============================================================================
// Workspace User Management
// ============================================================================

export async function inviteUserToWorkspace(
  tenantId: string,
  data: InviteUserInput,
  invitedByUserId: string
) {
  // Check tenant limits
  const limits = await getWorkspaceLimits(tenantId);
  if (limits.currentUsers >= limits.maxUsers) {
    throw new Error(`Workspace has reached the maximum number of users (${limits.maxUsers})`);
  }

  const normalizedEmail = data.email.toLowerCase();

  // Check if email already exists. If user was soft-deleted in this tenant,
  // we restore that account instead of creating a new one.
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  const canRestoreSoftDeletedUser = Boolean(
    existingUser &&
    existingUser.tenantId === tenantId &&
    existingUser.deletedAt !== null
  );

  if (existingUser && !canRestoreSoftDeletedUser) {
    throw new Error('A user with this email already exists');
  }

  // Validate all company assignments belong to tenant
  if (data.companyAssignments && data.companyAssignments.length > 0) {
    const companyIds = data.companyAssignments.map((a) => a.companyId);
    const companies = await prisma.company.findMany({
      where: { id: { in: companyIds }, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (companies.length !== companyIds.length) {
      throw new Error('One or more companies not found in this tenant');
    }
  }

  // Validate all role assignments have valid roles
  if (data.roleAssignments && data.roleAssignments.length > 0) {
    const roleIds = data.roleAssignments.map((a) => a.roleId);
    const roles = await prisma.role.findMany({
      where: { id: { in: roleIds }, tenantId },
      select: { id: true },
    });
    if (roles.length !== roleIds.length) {
      throw new Error('One or more roles not found in this tenant');
    }

    // Validate company-scoped role assignments reference valid companies
    const companyIdsInRoles = data.roleAssignments
      .filter((a) => a.companyId)
      .map((a) => a.companyId as string);
    if (companyIdsInRoles.length > 0) {
      const companiesForRoles = await prisma.company.findMany({
        where: { id: { in: companyIdsInRoles }, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (companiesForRoles.length !== companyIdsInRoles.length) {
        throw new Error('One or more companies in role assignments not found in this tenant');
      }
    }
  }

  // Generate temporary password (should be changed on first login)
  const tempPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_SALT_ROUNDS);

  // Collect all company IDs that need UserCompanyAssignment
  const companyIdsToAssign = new Set<string>();

  // From explicit company assignments
  if (data.companyAssignments && data.companyAssignments.length > 0) {
    data.companyAssignments.forEach((a) => companyIdsToAssign.add(a.companyId));
  }

  // From role assignments with company scope
  if (data.roleAssignments) {
    data.roleAssignments
      .filter((a) => a.companyId)
      .forEach((a) => companyIdsToAssign.add(a.companyId as string));
  }

  const assignUserAccess = async (userId: string) => {
    // Create company assignments for all unique companies
    if (companyIdsToAssign.size > 0) {
      const companyIds = Array.from(companyIdsToAssign);
      const primaryCompanyIdForAssignment = data.companyAssignments?.find((a) => a.isPrimary)?.companyId
        || companyIds[0];

      await prisma.userCompanyAssignment.createMany({
        data: companyIds.map((companyId) => ({
          userId,
          companyId,
          isPrimary: companyId === primaryCompanyIdForAssignment,
        })),
      });
    }

    // Handle role assignments (required - at least one must be provided)
    await prisma.userRoleAssignment.createMany({
      data: data.roleAssignments.map((assignment) => ({
        userId,
        roleId: assignment.roleId,
        companyId: assignment.companyId || null, // null = "All Companies"
      })),
    });
  };

  let user: Awaited<ReturnType<typeof prisma.user.create>>;

  if (canRestoreSoftDeletedUser && existingUser) {
    user = await prisma.$transaction(async (tx) => {
      const restoredUser = await tx.user.update({
        where: { id: existingUser.id },
        data: {
          email: normalizedEmail,
          firstName: data.firstName,
          lastName: data.lastName,
          passwordHash,
          tenantId,
          isActive: true,
          deletedAt: null,
          mustChangePassword: true, // Force password change on first login
          passwordResetToken: null,
          passwordResetExpires: null,
          passwordChangedAt: null,
        },
      });

      // Replace existing access assignments so re-invite reflects current selections.
      await tx.userCompanyAssignment.deleteMany({
        where: { userId: restoredUser.id },
      });
      await tx.userRoleAssignment.deleteMany({
        where: { userId: restoredUser.id },
      });

      if (companyIdsToAssign.size > 0) {
        const companyIds = Array.from(companyIdsToAssign);
        const primaryCompanyIdForAssignment = data.companyAssignments?.find((a) => a.isPrimary)?.companyId
          || companyIds[0];

        await tx.userCompanyAssignment.createMany({
          data: companyIds.map((companyId) => ({
            userId: restoredUser.id,
            companyId,
            isPrimary: companyId === primaryCompanyIdForAssignment,
          })),
        });
      }

      await tx.userRoleAssignment.createMany({
        data: data.roleAssignments.map((assignment) => ({
          userId: restoredUser.id,
          roleId: assignment.roleId,
          companyId: assignment.companyId || null,
        })),
      });

      return restoredUser;
    });
  } else {
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        firstName: data.firstName,
        lastName: data.lastName,
        passwordHash,
        tenantId,
        isActive: true,
        mustChangePassword: true, // Force password change on first login
      },
    });

    await assignUserAccess(user.id);
  }

  // Log user invitation
  const auditContext: AuditContext = {
    tenantId,
    userId: invitedByUserId,
  };

  await logUserMembership(auditContext, 'USER_INVITED', user.id, {
    email: user.email,
    companyAssignments: data.companyAssignments?.length || 0,
    roleAssignments: data.roleAssignments.length,
    reactivated: canRestoreSoftDeletedUser,
  });

  // Get tenant name for email
  const tenant = await prisma.workspace.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });

  // Get inviter name for email
  const inviter = await prisma.user.findUnique({
    where: { id: invitedByUserId },
    select: { firstName: true, lastName: true },
  });

  const inviterName = inviter
    ? `${inviter.firstName} ${inviter.lastName}`.trim()
    : undefined;

  // Send invitation email
  const emailTemplate = userInvitationEmail({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    temporaryPassword: tempPassword,
    tenantName: tenant?.name || 'your organization',
    invitedByName: inviterName,
  });

  const emailResult = await sendEmail({
    to: user.email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
  });

  if (!emailResult.success) {
    log.error('Failed to send invitation email:', emailResult.error);
  }

  // Return user without exposing temp password in response in production
  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },
    // Only for development/testing - in production, password is only sent via email
    temporaryPassword: process.env.NODE_ENV === 'development' ? tempPassword : undefined,
  };
}

export async function removeUserFromWorkspace(
  tenantId: string,
  userId: string,
  removedByUserId: string,
  reason: string
) {
  const user = await prisma.user.findUnique({
    where: { id: userId, tenantId, deletedAt: null },
    include: {
      roleAssignments: {
        include: {
          role: {
            select: { systemRoleType: true },
          },
        },
      },
    },
  });

  if (!user) {
    throw new Error('User not found in this tenant');
  }

  // Check if user has an admin role via role assignments.
  const isWorkspaceAdmin = user.roleAssignments.some(
    (a) => a.role.systemRoleType === 'ADMIN' || a.role.systemRoleType === 'TENANT_ADMIN' || a.role.systemRoleType === 'SUPER_ADMIN'
  );

  // Prevent removing the last workspace admin.
  if (isWorkspaceAdmin) {
    // Count users with an admin role assignment.
    const adminCount = await prisma.userRoleAssignment.count({
      where: {
        role: { systemRoleType: { in: ['ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'] }, tenantId },
        user: { tenantId, deletedAt: null, isActive: true },
      },
    });

    if (adminCount <= 1) {
      throw new Error('Cannot remove the last tenant administrator');
    }
  }

  // Soft delete the user
  await prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt: new Date(),
      isActive: false,
    },
  });

  // Log user removal
  const auditContext: AuditContext = {
    tenantId,
    userId: removedByUserId,
  };

  await logUserMembership(auditContext, 'USER_REMOVED', userId, {
    email: user.email,
    isWorkspaceAdmin,
    reason,
  });

  // Get tenant name and remover name for email
  const tenant = await prisma.workspace.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });

  const remover = await prisma.user.findUnique({
    where: { id: removedByUserId },
    select: { firstName: true, lastName: true },
  });

  const removerName = remover
    ? `${remover.firstName} ${remover.lastName}`.trim()
    : undefined;

  // Send removal notification email
  const emailTemplate = userRemovedEmail({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    tenantName: tenant?.name || 'the organization',
    removedByName: removerName,
  });

  await sendEmail({
    to: user.email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
  });

  return { success: true };
}


// ============================================================================
// Workspace Settings
// ============================================================================

export async function updateWorkspaceSettings(
  tenantId: string,
  settings: WorkspaceSettingsInput,
  userId: string
) {
  const existing = await prisma.workspace.findUnique({
    where: { id: tenantId, deletedAt: null },
    select: { settings: true },
  });

  if (!existing) {
    throw new Error(ERROR_MESSAGES.TENANT_NOT_FOUND);
  }

  const currentSettings = (existing.settings as Record<string, unknown>) || {};
  const newSettings = { ...currentSettings, ...settings };

  const tenant = await prisma.workspace.update({
    where: { id: tenantId },
    data: {
      settings: newSettings as Prisma.InputJsonValue,
    },
  });

  // Log settings update
  await createAuditLog({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'WorkspaceSettings',
    entityId: tenantId,
    entityName: tenant.name,
    summary: `Updated settings for tenant "${tenant.name}"`,
    changeSource: 'MANUAL',
    changes: { settings: { old: currentSettings, new: newSettings } },
  });

  return tenant;
}

// ============================================================================
// Workspace Statistics
// ============================================================================

export async function getWorkspaceStats(tenantId: string) {
  const [
    userCount,
    companyStats,
    documentStats,
    storageUsage,
    recentActivity,
  ] = await Promise.all([
    // User statistics - total count (role breakdown via roleAssignments if needed)
    prisma.user.count({
      where: { tenantId, deletedAt: null, isActive: true },
    }),

    // Company statistics
    prisma.company.groupBy({
      by: ['status'],
      where: { tenantId, deletedAt: null },
      _count: true,
    }),

    // Document statistics
    prisma.document.groupBy({
      by: ['documentType'],
      where: { tenantId },
      _count: true,
    }),

    // Storage usage
    prisma.document.aggregate({
      where: { tenantId },
      _sum: { fileSize: true },
    }),

    // Recent activity (last 30 days)
    prisma.auditLog.count({
      where: {
        tenantId,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  const limits = await getWorkspaceLimits(tenantId);

  return {
    users: {
      total: limits.currentUsers,
      max: limits.maxUsers,
      active: userCount,
    },
    companies: {
      total: limits.currentCompanies,
      max: limits.maxCompanies,
      byStatus: companyStats.map((s) => ({ status: s.status, count: s._count })),
    },
    documents: {
      byType: documentStats.map((s) => ({ type: s.documentType, count: s._count })),
    },
    storage: {
      usedMb: limits.currentStorageMb,
      maxMb: limits.maxStorageMb,
      usedBytes: storageUsage._sum.fileSize || 0,
    },
    activity: {
      last30Days: recentActivity,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function generateTemporaryPassword(): string {
  // Use cryptographically secure random values instead of Math.random()
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const randomValues = new Uint32Array(12);
  crypto.getRandomValues(randomValues);
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(randomValues[i] % chars.length);
  }
  return password;
}

// ============================================================================
// Complete Workspace Setup (Wizard)
// ============================================================================

export interface WorkspaceSetupData {
  WorkspaceInfo?: {
    name?: string;
    contactEmail?: string | null;
    contactPhone?: string | null;
  };
  adminUser: {
    email: string;
    firstName: string;
    lastName: string;
  };
  firstCompany?: {
    uen: string;
    name: string;
    entityType?: string;
  } | null;
}

export interface WorkspaceSetupResult {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: WorkspaceStatus;
  };
  adminUser: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    temporaryPassword?: string;
  };
  company?: {
    id: string;
    uen: string;
    name: string;
  } | null;
}

/**
 * Complete tenant setup wizard - creates admin user, optionally creates first company,
 * and activates the tenant in a single operation.
 */
export async function completeWorkspaceSetup(
  tenantId: string,
  data: WorkspaceSetupData,
  performedByUserId: string
): Promise<WorkspaceSetupResult> {
  // Validate tenant exists and is in PENDING_SETUP status
  const tenant = await prisma.workspace.findUnique({
    where: { id: tenantId, deletedAt: null },
  });

  if (!tenant) {
    throw new Error(ERROR_MESSAGES.TENANT_NOT_FOUND);
  }

  if (tenant.status !== TENANT_STATUSES.PENDING_SETUP) {
    throw new Error(`Cannot complete setup for tenant with status: ${tenant.status}`);
  }

  // Check if admin email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: data.adminUser.email.toLowerCase() },
  });

  if (existingUser) {
    throw new Error('A user with this email already exists');
  }

  // Check if company UEN already exists (if company provided)
  if (data.firstCompany) {
    const existingCompany = await prisma.company.findFirst({
      where: {
        uen: data.firstCompany.uen,
        tenantId,
        deletedAt: null,
      },
    });

    if (existingCompany) {
      throw new Error('A company with this UEN already exists in this tenant');
    }
  }

  // Generate temporary password for admin user
  const tempPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_SALT_ROUNDS);

  // Execute all operations in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // 1. Update tenant info if provided
    if (data.WorkspaceInfo && Object.keys(data.WorkspaceInfo).some(k => data.WorkspaceInfo![k as keyof typeof data.WorkspaceInfo] !== undefined)) {
      await tx.workspace.update({
        where: { id: tenantId },
        data: {
          name: data.WorkspaceInfo.name ?? tenant.name,
          contactEmail: data.WorkspaceInfo.contactEmail,
          contactPhone: data.WorkspaceInfo.contactPhone,
        },
      });
    }

    // 2. Create admin user
    const adminUser = await tx.user.create({
      data: {
        email: data.adminUser.email.toLowerCase(),
        firstName: data.adminUser.firstName,
        lastName: data.adminUser.lastName,
        passwordHash,
        tenantId,
        isActive: true,
        mustChangePassword: true,
      },
    });

    // 3. Assign RBAC role to admin user (must use tx, not external function)
    const roleId = await getSystemRoleId(tenantId, 'ADMIN');
    if (roleId) {
      await tx.userRoleAssignment.create({
        data: {
          userId: adminUser.id,
          roleId,
        },
      });
    }

    // 4. Create first company if provided
    let company = null;
    if (data.firstCompany) {
      company = await tx.company.create({
        data: {
          uen: data.firstCompany.uen,
          name: data.firstCompany.name,
          entityType: (data.firstCompany.entityType || 'PRIVATE_LIMITED') as 'PRIVATE_LIMITED' | 'PUBLIC_LIMITED' | 'SOLE_PROPRIETORSHIP' | 'PARTNERSHIP' | 'LIMITED_PARTNERSHIP' | 'LIMITED_LIABILITY_PARTNERSHIP' | 'FOREIGN_COMPANY' | 'VARIABLE_CAPITAL_COMPANY' | 'OTHER',
          status: 'LIVE',
          tenantId,
        },
      });
    }

    // 5. Activate tenant
    const activatedWorkspace = await tx.workspace.update({
      where: { id: tenantId },
      data: {
        status: TENANT_STATUSES.ACTIVE,
        activatedAt: new Date(),
        suspendedAt: null,
        suspendReason: null,
      },
    });

    return {
      tenant: activatedWorkspace,
      adminUser,
      company,
    };
  });

  // Log audit events (outside transaction for better reliability)
  const auditContext: AuditContext = {
    tenantId,
    userId: performedByUserId,
  };

  // Log tenant info update if changed
  if (data.WorkspaceInfo) {
    const updatedFields = Object.keys(data.WorkspaceInfo).filter(k => data.WorkspaceInfo![k as keyof typeof data.WorkspaceInfo] !== undefined);
    await createAuditLog({
      tenantId,
      userId: performedByUserId,
      action: 'UPDATE',
      entityType: 'Workspace',
      entityId: tenantId,
      entityName: result.tenant.name,
      summary: `Updated tenant "${result.tenant.name}" info during setup (${updatedFields.join(', ')})`,
      changeSource: 'MANUAL',
      metadata: {
        setupWizard: true,
        fields: updatedFields,
      },
    });
  }

  // Log user creation
  await logUserMembership(auditContext, 'USER_INVITED', result.adminUser.id, {
    email: result.adminUser.email,
    role: 'ADMIN',
    setupWizard: true,
  });

  // Log company creation
  if (result.company) {
    await createAuditLog({
      tenantId,
      userId: performedByUserId,
      companyId: result.company.id,
      action: 'CREATE',
      entityType: 'Company',
      entityId: result.company.id,
      entityName: result.company.name,
      summary: `Created company "${result.company.name}" (UEN: ${result.company.uen}) during tenant setup`,
      changeSource: 'MANUAL',
      metadata: {
        uen: result.company.uen,
        name: result.company.name,
        setupWizard: true,
      },
    });
  }

  // Log tenant activation
  await createAuditLog({
    tenantId,
    userId: performedByUserId,
    action: 'UPDATE',
    entityType: 'Workspace',
    entityId: tenantId,
    entityName: result.tenant.name,
    summary: `Activated tenant "${result.tenant.name}" - setup completed`,
    changeSource: 'MANUAL',
    changes: {
      status: { old: 'PENDING_SETUP', new: 'ACTIVE' },
    },
    metadata: {
      setupWizard: true,
      activated: true,
    },
  });

  // Send welcome email to new admin user
  const emailTemplate = tenantSetupCompleteEmail({
    firstName: result.adminUser.firstName,
    lastName: result.adminUser.lastName,
    email: result.adminUser.email,
    temporaryPassword: tempPassword,
    tenantName: result.tenant.name,
  });

  const emailResult = await sendEmail({
    to: result.adminUser.email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
  });

  if (!emailResult.success) {
    log.error('Failed to send tenant setup email:', emailResult.error);
  }

  return {
    tenant: {
      id: result.tenant.id,
      name: result.tenant.name,
      slug: result.tenant.slug,
      status: result.tenant.status,
    },
    adminUser: {
      id: result.adminUser.id,
      email: result.adminUser.email,
      firstName: result.adminUser.firstName,
      lastName: result.adminUser.lastName,
      temporaryPassword: process.env.NODE_ENV === 'development' ? tempPassword : undefined,
    },
    company: result.company
      ? {
          id: result.company.id,
          uen: result.company.uen,
          name: result.company.name,
        }
      : null,
  };
}
