/**
 * Authentication & Authorization
 *
 * Provides JWT-based authentication with secure HTTP-only cookies.
 * Fully integrated with workspace scoping support.
 */

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { prisma } from './prisma';
import type { Prisma, WorkspaceStatus } from '@/generated/prisma';
import { logAuthEvent } from './audit';
import {
  AUTH_COOKIE_NAME,
  DEFAULT_JWT_EXPIRES_IN,
  COOKIE_MAX_AGE_SECONDS,
  COOKIE_OPTIONS,
  MIN_JWT_SECRET_LENGTH,
  ERROR_MESSAGES,
  TENANT_STATUSES,
} from './constants/application';

// ============================================================================
// Configuration
// ============================================================================

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is required in production');
    }
    // Development fallback with warning
    console.warn('Warning: JWT_SECRET not set. Using insecure default for development only.');
    return new TextEncoder().encode('development-only-secret-do-not-use-in-production');
  }

  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long`);
  }

  return new TextEncoder().encode(secret);
}

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || DEFAULT_JWT_EXPIRES_IN;

// ============================================================================
// Session Cache
// Per-process Map cache keyed by userId. Safe for Docker/persistent server
// deployments. TTL of 30s balances freshness with DB round-trip reduction.
// ============================================================================

type SessionCacheEntry<T> = { value: T; expiresAt: number };
const SESSION_CACHE_TTL_MS = 30_000;
const _sessionCache = new Map<string, SessionCacheEntry<SessionUser>>();
const _sessionWithWorkspaceCache = new Map<string, SessionCacheEntry<SessionWithWorkspace>>();

export function invalidateSessionCache(userId: string): void {
  _sessionCache.delete(userId);
  _sessionWithWorkspaceCache.delete(userId);
}

// ============================================================================
// Types
// ============================================================================

export interface JWTPayload {
  userId: string;
  email: string;
  tenantId?: string | null;
  workspaceId?: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string | null;
  workspaceId?: string | null;
  internalRole?: 'ADMIN' | 'MANAGER' | 'STAFF';
  isAdmin?: boolean;
  isManager?: boolean;
  isStaff?: boolean;
  // Deprecated aliases kept for compatibility while callers move to internalRole.
  isSuperAdmin: boolean;
  isWorkspaceAdmin: boolean;
  // True if user has any role with "All Companies" scope (companyId = null)
  hasAllCompaniesAccess: boolean;
  // All company IDs the user has access to via role assignments (excludes "All Companies" assignments)
  companyIds: string[];
}

export interface SessionWithWorkspace extends SessionUser {
  workspace: {
    id: string;
    name: string;
    slug: string;
    status: WorkspaceStatus;
  } | null;
}

// ============================================================================
// Token Management
// ============================================================================

/**
 * Create a JWT token for a user
 */
export async function createToken(payload: JWTPayload): Promise<string> {
  const expiresIn = parseExpiration(JWT_EXPIRES_IN);

  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(JWT_SECRET);
}

/**
 * Verify a JWT token
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Parse expiration string to jose-compatible format
 */
function parseExpiration(exp: string): string {
  // Convert formats like '7d' to jose format
  const match = exp.match(/^(\d+)([smhd])$/);
  if (!match) return '7d';

  const [, value, unit] = match;
  const unitMap: Record<string, string> = {
    s: 'seconds',
    m: 'minutes',
    h: 'hours',
    d: 'days',
  };

  return `${value} ${unitMap[unit] || 'days'}`;
}

// ============================================================================
// Session Management
// ============================================================================

type RoleAssignmentForSession = {
  companyId: string | null;
  role: { systemRoleType: string | null };
};

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

function deriveInternalRole(roleAssignments: RoleAssignmentForSession[]): 'ADMIN' | 'MANAGER' | 'STAFF' {
  const roles = roleAssignments.map((assignment) => normalizeSystemRole(assignment.role.systemRoleType));
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('MANAGER')) return 'MANAGER';
  return 'STAFF';
}

function hasAllCompanyScope(roleAssignments: RoleAssignmentForSession[]): boolean {
  return roleAssignments.some((assignment) => assignment.companyId === null);
}

type SessionWorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
};

export async function getDefaultWorkspaceForAdmin(): Promise<SessionWorkspaceSummary | null> {
  const select = {
    id: true,
    name: true,
    slug: true,
    status: true,
  } satisfies Prisma.WorkspaceSelect;

  const activeWorkspace = await prisma.workspace.findFirst({
    where: {
      deletedAt: null,
      status: TENANT_STATUSES.ACTIVE,
    },
    select,
    orderBy: { createdAt: 'asc' },
  });

  if (activeWorkspace) {
    return activeWorkspace;
  }

  return prisma.workspace.findFirst({
    where: { deletedAt: null },
    select,
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Get current session from cookies (basic user info)
 */
export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  const cached = _sessionCache.get(payload.userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      tenantId: true,
      isActive: true,
      deletedAt: true,
      roleAssignments: {
        select: {
          companyId: true,
          role: {
            select: {
              systemRoleType: true,
            },
          },
        },
      },
    },
  });

  if (!user || !user.isActive || user.deletedAt) return null;

  const internalRole = deriveInternalRole(user.roleAssignments);
  const isAdminRole = internalRole === 'ADMIN';
  const isManagerRole = internalRole === 'MANAGER';
  const fallbackWorkspace = isAdminRole && !user.tenantId ? await getDefaultWorkspaceForAdmin() : null;
  const effectiveWorkspaceId = user.tenantId ?? fallbackWorkspace?.id ?? null;

  const hasAllCompaniesAccess = isAdminRole || hasAllCompanyScope(user.roleAssignments);

  // Get all unique company IDs from role assignments (excludes null/"All Companies")
  const companyIds = [
    ...new Set(
      user.roleAssignments
        .map((a) => a.companyId)
        .filter((id): id is string => id !== null)
    ),
  ];

  const session: SessionUser = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    tenantId: effectiveWorkspaceId,
    workspaceId: effectiveWorkspaceId,
    internalRole,
    isAdmin: isAdminRole,
    isManager: isManagerRole,
    isStaff: internalRole === 'STAFF',
    isSuperAdmin: isAdminRole,
    isWorkspaceAdmin: isAdminRole,
    hasAllCompaniesAccess,
    companyIds,
  };

  _sessionCache.set(user.id, { value: session, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  return session;
}

/**
 * Get session with full workspace information
 */
export async function getSessionWithWorkspace(): Promise<SessionWithWorkspace | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  const cached = _sessionWithWorkspaceCache.get(payload.userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      tenantId: true,
      isActive: true,
      deletedAt: true,
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
        },
      },
      roleAssignments: {
        select: {
          companyId: true,
          role: {
            select: {
              systemRoleType: true,
            },
          },
        },
      },
    },
  });

  if (!user || !user.isActive || user.deletedAt) return null;

  const internalRole = deriveInternalRole(user.roleAssignments);
  const isAdminRole = internalRole === 'ADMIN';
  const isManagerRole = internalRole === 'MANAGER';
  const fallbackWorkspace = isAdminRole && !user.tenantId ? await getDefaultWorkspaceForAdmin() : null;
  const effectiveWorkspace = user.tenant ?? fallbackWorkspace;
  const effectiveWorkspaceId = user.tenantId ?? fallbackWorkspace?.id ?? null;

  // Check workspace is active for non-admin users.
  if (effectiveWorkspace && effectiveWorkspace.status !== TENANT_STATUSES.ACTIVE && !isAdminRole) {
    return null;
  }

  const hasAllCompaniesAccess = isAdminRole || hasAllCompanyScope(user.roleAssignments);

  // Get all unique company IDs from role assignments (excludes null/"All Companies")
  const companyIds = [
    ...new Set(
      user.roleAssignments
        .map((a) => a.companyId)
        .filter((id): id is string => id !== null)
    ),
  ];

  const sessionWithWorkspace: SessionWithWorkspace = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    tenantId: effectiveWorkspaceId,
    workspaceId: effectiveWorkspaceId,
    workspace: effectiveWorkspace,
    internalRole,
    isAdmin: isAdminRole,
    isManager: isManagerRole,
    isStaff: internalRole === 'STAFF',
    isSuperAdmin: isAdminRole,
    isWorkspaceAdmin: isAdminRole,
    hasAllCompaniesAccess,
    companyIds,
  };

  _sessionWithWorkspaceCache.set(user.id, { value: sessionWithWorkspace, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  return sessionWithWorkspace;
}

// ============================================================================
// Authentication Enforcement
// ============================================================================

/**
 * Require authentication - throws if not authenticated
 */
export async function requireAuth(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    throw new Error(ERROR_MESSAGES.UNAUTHORIZED);
  }
  return session;
}

/**
 * Require authentication with workspace info - throws if not authenticated
 */
export async function requireAuthWithWorkspace(): Promise<SessionWithWorkspace> {
  const session = await getSessionWithWorkspace();
  if (!session) {
    throw new Error(ERROR_MESSAGES.UNAUTHORIZED);
  }
  return session;
}

/**
 * Require workspace membership - throws if user doesn't belong to a workspace
 */
export async function requireWorkspace(): Promise<SessionWithWorkspace & { workspaceId: string }> {
  const session = await getSessionWithWorkspace();
  if (!session) {
    throw new Error(ERROR_MESSAGES.UNAUTHORIZED);
  }
  if (!session.tenantId && !session.isSuperAdmin) {
    throw new Error(ERROR_MESSAGES.NO_TENANT_ASSOCIATION);
  }
  return {
    ...session,
    workspaceId: session.tenantId,
  } as SessionWithWorkspace & { workspaceId: string };
}

// ============================================================================
// Role Checks
// ============================================================================

/**
 * Check if user is a super admin (uses computed flag from role assignments)
 */
export function isSuperAdmin(user: SessionUser): boolean {
  return user.isSuperAdmin;
}

/**
 * Check if user is a workspace admin (uses computed flag from role assignments)
 */
export function isWorkspaceAdmin(user: SessionUser): boolean {
  return user.isWorkspaceAdmin;
}

/**
 * Check if user has admin privileges (super or workspace admin)
 */
export function isAdmin(user: SessionUser): boolean {
  return user.isSuperAdmin || user.isWorkspaceAdmin;
}

// ============================================================================
// Access Control
// ============================================================================

/**
 * Check if user can access a specific workspace
 */
export function canAccessWorkspace(user: SessionUser, workspaceId: string): boolean {
  if (isSuperAdmin(user)) return true;
  return user.tenantId === workspaceId;
}

/**
 * Check if user can access a specific company
 * This function verifies:
 * 1. SUPER_ADMIN can access any company
 * 2. TENANT_ADMIN can only access companies within their workspace
 * 3. Users with "All Companies" role can access any company in their workspace
 * 4. Regular users can only access companies they have role assignments for
 */
export async function canAccessCompany(user: SessionUser, companyId: string): Promise<boolean> {
  if (user.isSuperAdmin) return true;

  // For TENANT_ADMIN, verify company belongs to their workspace
  if (user.isWorkspaceAdmin) {
    if (!user.tenantId) return false;
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { tenantId: true },
    });
    return company?.tenantId === user.tenantId;
  }

  // For users with "All Companies" access, verify company belongs to their workspace
  if (user.hasAllCompaniesAccess) {
    if (!user.tenantId) return false;
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { tenantId: true },
    });
    return company?.tenantId === user.tenantId;
  }

  // For company admins/users, check if company is in their role assignments
  return user.companyIds.includes(companyId);
}

/**
 * Check if user can manage workspace settings
 */
export function canManageWorkspace(user: SessionUser, workspaceId: string): boolean {
  if (user.isSuperAdmin) return true;
  if (!user.isWorkspaceAdmin) return false;
  return user.tenantId === workspaceId;
}

/**
 * Check if user can manage users within a workspace
 */
export function canManageUsers(user: SessionUser): boolean {
  return user.isSuperAdmin || user.isWorkspaceAdmin;
}

/**
 * Check if user can manage companies within a workspace
 */
export function canManageCompanies(user: SessionUser): boolean {
  // Super admin and workspace admin can manage all companies
  // Company admin status now determined by per-company role assignments
  return user.isSuperAdmin || user.isWorkspaceAdmin;
}

// ============================================================================
// Login & Logout
// ============================================================================

/**
 * Perform login and set auth cookie
 * Returns the session user on success
 */
export async function performLogin(
  email: string,
  passwordHash: string,
  verifyPassword: (hash: string, password: string) => Promise<boolean>,
  password: string
): Promise<SessionUser> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      tenant: {
        select: {
          id: true,
          status: true,
        },
      },
      roleAssignments: {
        select: {
          companyId: true,
          role: {
            select: {
              systemRoleType: true,
            },
          },
        },
      },
    },
  });

  if (!user || user.deletedAt || !user.isActive) {
    await logAuthEvent('LOGIN_FAILED', undefined, { email, reason: 'User not found or inactive' });
    throw new Error(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  const internalRole = deriveInternalRole(user.roleAssignments);
  const isAdminRole = internalRole === 'ADMIN';
  const isManagerRole = internalRole === 'MANAGER';
  const fallbackWorkspace = isAdminRole && !user.tenantId ? await getDefaultWorkspaceForAdmin() : null;
  const effectiveWorkspaceId = user.tenantId ?? fallbackWorkspace?.id ?? null;

  // Check workspace status for non-admin users.
  if (user.tenant && user.tenant.status !== TENANT_STATUSES.ACTIVE && !isAdminRole) {
    await logAuthEvent('LOGIN_FAILED', user.id, { reason: 'Workspace not active', WorkspaceStatus: user.tenant.status });
    throw new Error(ERROR_MESSAGES.ACCOUNT_ACCESS_RESTRICTED);
  }

  const isValid = await verifyPassword(user.passwordHash, password);
  if (!isValid) {
    await logAuthEvent('LOGIN_FAILED', user.id, { reason: 'Invalid password' });
    throw new Error(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // Create token
  const token = await createToken({
    userId: user.id,
    email: user.email,
    tenantId: effectiveWorkspaceId,
    workspaceId: effectiveWorkspaceId,
  });

  // Set cookie
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, token, {
    ...COOKIE_OPTIONS,
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  // Log successful login
  await logAuthEvent('LOGIN', user.id, { workspaceId: effectiveWorkspaceId });

  const hasAllCompaniesAccess = isAdminRole || hasAllCompanyScope(user.roleAssignments);

  // Get all unique company IDs from role assignments (excludes null/"All Companies")
  const companyIds = [
    ...new Set(
      user.roleAssignments
        .map((a) => a.companyId)
        .filter((id): id is string => id !== null)
    ),
  ];

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    tenantId: effectiveWorkspaceId,
    workspaceId: effectiveWorkspaceId,
    internalRole,
    isAdmin: isAdminRole,
    isManager: isManagerRole,
    isStaff: internalRole === 'STAFF',
    isSuperAdmin: isAdminRole,
    isWorkspaceAdmin: isAdminRole,
    hasAllCompaniesAccess,
    companyIds,
  };
}

/**
 * Perform logout and clear auth cookie
 */
export async function performLogout(): Promise<void> {
  const session = await getSession();

  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);

  if (session) {
    await logAuthEvent('LOGOUT', session.id);
  }
}

// ============================================================================
// Workspace-Scoped Session Helpers
// ============================================================================

/**
 * Get the workspace ID from session (throws if no workspace and not SUPER_ADMIN)
 */
export async function getSessionWorkspaceId(): Promise<string | null> {
  const session = await requireAuth();

  // SUPER_ADMIN doesn't need a workspace
  if (isSuperAdmin(session)) {
    return null;
  }

  if (!session.tenantId) {
    throw new Error(ERROR_MESSAGES.NO_TENANT_ASSOCIATION);
  }

  return session.tenantId;
}

/**
 * Validate that user belongs to the specified workspace
 */
export async function validateWorkspaceAccess(workspaceId: string): Promise<SessionUser> {
  const session = await requireAuth();

  if (!canAccessWorkspace(session, workspaceId)) {
    throw new Error(ERROR_MESSAGES.FORBIDDEN);
  }

  return session;
}

/**
 * Validate that user can access the specified company
 */
export async function validateCompanyAccess(companyId: string): Promise<SessionUser> {
  const session = await requireAuth();

  // Get company to check workspace
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { tenantId: true },
  });

  if (!company) {
    throw new Error(ERROR_MESSAGES.COMPANY_NOT_FOUND);
  }

  // Check workspace access first
  if (!canAccessWorkspace(session, company.tenantId)) {
    throw new Error(ERROR_MESSAGES.FORBIDDEN);
  }

  // Then check company-level access
  if (!(await canAccessCompany(session, companyId))) {
    throw new Error(ERROR_MESSAGES.FORBIDDEN);
  }

  return session;
}
