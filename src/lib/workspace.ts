/**
 * Workspace Context and Utilities
 *
 * Provides workspace scoping support for data isolation and access control.
 * All workspace-scoped queries should use these utilities to ensure proper isolation.
 */

import { prisma } from './prisma';
import type { WorkspaceStatus } from '@/generated/prisma';
import type { SessionUser } from './auth';

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceContext {
  workspaceId: string;
  workspace: WorkspaceInfo;
  userId: string;
  isSuperAdmin: boolean;
  isWorkspaceAdmin: boolean;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  settings: Record<string, unknown> | null;
  maxUsers: number;
  maxCompanies: number;
  maxStorageMb: number;
}

export interface WorkspaceLimits {
  maxUsers: number;
  maxCompanies: number;
  maxStorageMb: number;
  currentUsers: number;
  currentCompanies: number;
  currentStorageMb: number;
}

// ============================================================================
// Workspace Retrieval
// ============================================================================

/**
 * Get workspace by ID
 */
export async function getWorkspaceById(workspaceId: string): Promise<WorkspaceInfo | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      settings: true,
      maxUsers: true,
      maxCompanies: true,
      maxStorageMb: true,
    },
  });

  if (!workspace) return null;

  return {
    ...workspace,
    settings: workspace.settings as Record<string, unknown> | null,
  };
}

/**
 * Get workspace by slug (URL-friendly identifier)
 */
export async function getWorkspaceBySlug(slug: string): Promise<WorkspaceInfo | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      settings: true,
      maxUsers: true,
      maxCompanies: true,
      maxStorageMb: true,
    },
  });

  if (!workspace) return null;

  return {
    ...workspace,
    settings: workspace.settings as Record<string, unknown> | null,
  };
}

// ============================================================================
// Workspace Context Resolution
// ============================================================================

/**
 * Resolve workspace context from session user
 * Returns null if user is SUPER_ADMIN (has access to all workspaces)
 */
export async function resolveWorkspaceContext(
  session: SessionUser
): Promise<WorkspaceContext | null> {
  // SUPER_ADMIN has cross-workspace access
  if (session.isSuperAdmin) {
    return null;
  }

  // Get user with workspace info
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          settings: true,
          maxUsers: true,
          maxCompanies: true,
          maxStorageMb: true,
        },
      },
    },
  });

  if (!user?.tenant) {
    throw new Error('User has no workspace association');
  }

  // Check workspace is active
  if (user.tenant.status !== 'ACTIVE') {
    throw new Error(`Workspace is ${user.tenant.status.toLowerCase()}`);
  }

  return {
    workspaceId: user.tenant.id,
    workspace: {
      ...user.tenant,
      settings: user.tenant.settings as Record<string, unknown> | null,
    },
    userId: user.id,
    isSuperAdmin: session.isSuperAdmin,
    isWorkspaceAdmin: session.isWorkspaceAdmin,
  };
}

// ============================================================================
// Access Control
// ============================================================================

/**
 * Check if user can access a specific workspace
 */
export function canAccessWorkspace(session: SessionUser, workspaceId: string): boolean {
  // SUPER_ADMIN can access any workspace
  if (session.isSuperAdmin) {
    return true;
  }

  // User must belong to the workspace
  return session.tenantId === workspaceId;
}

/**
 * Check if user has workspace admin privileges
 */
export function isWorkspaceAdmin(session: SessionUser): boolean {
  return session.isSuperAdmin || session.isWorkspaceAdmin;
}

/**
 * Check if user can manage workspace settings
 */
export function canManageWorkspace(session: SessionUser, workspaceId: string): boolean {
  if (session.isSuperAdmin) return true;
  if (!session.isWorkspaceAdmin) return false;
  // User must belong to the workspace they're managing
  return session.tenantId === workspaceId;
}

// ============================================================================
// Workspace Limits & Usage
// ============================================================================

/**
 * Get current usage and limits for a workspace
 */
export async function getWorkspaceLimits(workspaceId: string): Promise<WorkspaceLimits> {
  const [workspace, userCount, companyCount, storageUsage] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        maxUsers: true,
        maxCompanies: true,
        maxStorageMb: true,
      },
    }),
    prisma.user.count({
      where: { tenantId: workspaceId, deletedAt: null, isActive: true },
    }),
    prisma.company.count({
      where: { tenantId: workspaceId, deletedAt: null },
    }),
    prisma.document.aggregate({
      where: { tenantId: workspaceId },
      _sum: { fileSize: true },
    }),
  ]);

  if (!workspace) {
    throw new Error('Workspace not found');
  }

  return {
    maxUsers: workspace.maxUsers,
    maxCompanies: workspace.maxCompanies,
    maxStorageMb: workspace.maxStorageMb,
    currentUsers: userCount,
    currentCompanies: companyCount,
    currentStorageMb: Math.ceil((storageUsage._sum.fileSize || 0) / (1024 * 1024)),
  };
}

/**
 * Check if workspace can add more users
 */
export async function canAddUser(workspaceId: string): Promise<boolean> {
  const limits = await getWorkspaceLimits(workspaceId);
  return limits.currentUsers < limits.maxUsers;
}

/**
 * Check if workspace can add more companies
 */
export async function canAddCompany(workspaceId: string): Promise<boolean> {
  const limits = await getWorkspaceLimits(workspaceId);
  return limits.currentCompanies < limits.maxCompanies;
}

/**
 * Check if workspace has storage capacity for a file
 */
export async function hasStorageCapacity(
  workspaceId: string,
  fileSizeBytes: number
): Promise<boolean> {
  const limits = await getWorkspaceLimits(workspaceId);
  const fileSizeMb = fileSizeBytes / (1024 * 1024);
  return limits.currentStorageMb + fileSizeMb <= limits.maxStorageMb;
}

// ============================================================================
// Workspace-Scoped Query Helpers
// ============================================================================

/**
 * Add workspace filter to Prisma where clause
 * Returns the filter or undefined for SUPER_ADMIN
 */
export function workspaceFilter(
  context: WorkspaceContext | null
): { tenantId: string } | undefined {
  return context ? { tenantId: context.workspaceId } : undefined;
}

/**
 * Build where clause with workspace scope
 */
export function withWorkspaceScope<T extends Record<string, unknown>>(
  context: WorkspaceContext | null,
  where: T
): T & { tenantId?: string } {
  if (!context) return where;
  return { ...where, tenantId: context.workspaceId };
}

/**
 * Create data with workspace ID included
 */
export function withWorkspaceId<T extends Record<string, unknown>>(
  context: WorkspaceContext,
  data: T
): T & { tenantId: string } {
  return { ...data, tenantId: context.workspaceId };
}

// ============================================================================
// Workspace Ownership Assertions
// ============================================================================

/**
 * Assert a loaded entity both exists and belongs to the expected workspace.
 *
 * Throws a uniform "not found" style error for either missing entity OR
 * cross-workspace mismatch — intentionally indistinguishable to avoid leaking
 * existence of resources outside the caller's workspace.
 *
 * The `actualWorkspaceId` argument is taken separately so callers can pass
 * a nested field (e.g. `entity?.company.workspaceId`) without needing to
 * re-shape the entity.
 *
 * @example
 *   const officer = await prisma.companyOfficer.findFirst({ ... include: COMPANY_SCOPE_INCLUDE });
 *   assertWorkspaceOwned(officer, officer?.company.workspaceId, workspaceId, 'Officer not found');
 *   // `officer` is now narrowed to non-null
 */
export function assertWorkspaceOwned<T>(
  entity: T | null | undefined,
  actualWorkspaceId: string | null | undefined,
  expectedWorkspaceId: string,
  notFoundMessage: string
): asserts entity is NonNullable<T> {
  if (!entity || actualWorkspaceId !== expectedWorkspaceId) {
    throw new Error(notFoundMessage);
  }
}

// ============================================================================
// Workspace Validation
// ============================================================================

/**
 * Validate workspace status before operations
 */
export async function validateWorkspaceStatus(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { status: true, deletedAt: true },
  });

  if (!workspace || workspace.deletedAt) {
    throw new Error('Workspace not found');
  }

  if (workspace.status === 'SUSPENDED') {
    throw new Error('Workspace is suspended');
  }

  if (workspace.status === 'DEACTIVATED') {
    throw new Error('Workspace is deactivated');
  }

  if (workspace.status === 'PENDING_SETUP') {
    throw new Error('Workspace setup is incomplete');
  }
}

/**
 * Generate a unique slug from workspace name
 */
export async function generateWorkspaceSlug(name: string): Promise<string> {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  let slug = baseSlug;
  let counter = 1;

  while (await prisma.workspace.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}
