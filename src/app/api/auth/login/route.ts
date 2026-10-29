import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { createToken, getDefaultWorkspaceForAdmin } from '@/lib/auth';
import { logAuthEvent } from '@/lib/audit';
import { createLogger, safeErrorMessage } from '@/lib/logger';
import { verifyPassword, hashPassword } from '@/lib/encryption';
import {
  checkRateLimit,
  recordFailure,
  recordSuccess,
  getClientIp,
  createRateLimitHeaders,
  getRateLimitKey,
  RATE_LIMIT_CONFIGS,
} from '@/lib/rate-limit';
import {
  AUTH_COOKIE_NAME,
  COOKIE_MAX_AGE_SECONDS,
  COOKIE_OPTIONS,
  TENANT_STATUSES,
  HTTP_STATUS,
} from '@/lib/constants/application';

const log = createLogger('auth:login');

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

export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request);
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    const normalizedEmail = String(email).toLowerCase();
    const ipRateLimitKey = getRateLimitKey('login_ip', clientIp);
    const emailRateLimitKey = getRateLimitKey('login_email', normalizedEmail);

    const ipRateLimitResult = checkRateLimit(ipRateLimitKey, RATE_LIMIT_CONFIGS.LOGIN);
    if (!ipRateLimitResult.allowed) {
      const headers = createRateLimitHeaders(ipRateLimitResult);
      const errorMessage = ipRateLimitResult.isLockedOut
        ? 'Too many failed login attempts. Please try again later.'
        : 'Rate limit exceeded. Please wait before trying again.';
      return NextResponse.json(
        { error: errorMessage },
        { status: HTTP_STATUS.TOO_MANY_REQUESTS, headers }
      );
    }

    const emailRateLimitResult = checkRateLimit(emailRateLimitKey, RATE_LIMIT_CONFIGS.LOGIN);
    if (!emailRateLimitResult.allowed) {
      const headers = createRateLimitHeaders(emailRateLimitResult);
      const errorMessage = emailRateLimitResult.isLockedOut
        ? 'Too many failed login attempts. Please try again later.'
        : 'Rate limit exceeded. Please wait before trying again.';
      return NextResponse.json(
        { error: errorMessage },
        { status: HTTP_STATUS.TOO_MANY_REQUESTS, headers }
      );
    }

    // Find user by email with tenant info and role assignments
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        tenant: true,
        roleAssignments: {
          select: {
            role: {
              select: {
                systemRoleType: true,
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive || user.deletedAt) {
      recordFailure(ipRateLimitKey, RATE_LIMIT_CONFIGS.LOGIN);
      recordFailure(emailRateLimitKey, RATE_LIMIT_CONFIGS.LOGIN);
      // Log failed login attempt
      await logAuthEvent('LOGIN_FAILED', undefined, {
        email: normalizedEmail,
        reason: !user ? 'User not found' : 'Account inactive or deleted',
      });
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: HTTP_STATUS.UNAUTHORIZED }
      );
    }

    // Compute role flags from role assignments (authoritative source).
    // ADMIN is the canonical migrated system role; legacy labels are aliases.
    const internalRole = user.roleAssignments.some((a) => normalizeSystemRole(a.role.systemRoleType) === 'ADMIN')
      ? 'ADMIN'
      : user.roleAssignments.some((a) => normalizeSystemRole(a.role.systemRoleType) === 'MANAGER')
        ? 'MANAGER'
        : 'STAFF';
    const isAdmin = internalRole === 'ADMIN';
    const isSuperAdmin = isAdmin;
    const isWorkspaceAdmin = isAdmin;
    const fallbackWorkspace = isAdmin && !user.tenantId ? await getDefaultWorkspaceForAdmin() : null;
    const effectiveWorkspaceId = user.tenantId ?? fallbackWorkspace?.id ?? null;
    const effectiveWorkspaceName = user.tenant?.name ?? fallbackWorkspace?.name;

    // Check workspace status for non-admin users.
    if (user.tenant && !isAdmin) {
      if (user.tenant.status === TENANT_STATUSES.SUSPENDED) {
        await logAuthEvent('LOGIN_FAILED', user.id, {
          email: user.email,
          userName: `${user.firstName} ${user.lastName}`,
          reason: 'Workspace suspended',
          workspaceId: user.tenantId,
          workspaceName: user.tenant.name,
        });
        return NextResponse.json(
          { error: 'Your organization has been suspended. Please contact support.' },
          { status: HTTP_STATUS.FORBIDDEN }
        );
      }
      if (user.tenant.status === TENANT_STATUSES.DEACTIVATED) {
        await logAuthEvent('LOGIN_FAILED', user.id, {
          email: user.email,
          userName: `${user.firstName} ${user.lastName}`,
          reason: 'Workspace deactivated',
          workspaceId: user.tenantId,
          workspaceName: user.tenant.name,
        });
        return NextResponse.json(
          { error: 'Your organization has been deactivated. Please contact support.' },
          { status: HTTP_STATUS.FORBIDDEN }
        );
      }
      if (user.tenant.status === TENANT_STATUSES.PENDING_SETUP) {
        await logAuthEvent('LOGIN_FAILED', user.id, {
          email: user.email,
          userName: `${user.firstName} ${user.lastName}`,
          reason: 'Workspace pending setup',
          workspaceId: user.tenantId,
          workspaceName: user.tenant.name,
        });
        return NextResponse.json(
          { error: 'Your organization setup is not complete. Please contact your administrator.' },
          { status: HTTP_STATUS.FORBIDDEN }
        );
      }
    }

    // Verify password (supports both Argon2id and legacy bcrypt)
    const verification = await verifyPassword(password, user.passwordHash);
    if (!verification.isValid) {
      recordFailure(ipRateLimitKey, RATE_LIMIT_CONFIGS.LOGIN);
      recordFailure(emailRateLimitKey, RATE_LIMIT_CONFIGS.LOGIN);
      await logAuthEvent('LOGIN_FAILED', user.id, {
        email: user.email,
        userName: `${user.firstName} ${user.lastName}`,
        reason: 'Invalid password',
      });
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: HTTP_STATUS.UNAUTHORIZED }
      );
    }

    // Update last login and migrate password hash if needed
    try {
      const updateData: { lastLoginAt: Date; passwordHash?: string } = {
        lastLoginAt: new Date(),
      };

      // Automatically upgrade bcrypt hashes to Argon2id on successful login
      if (verification.needsRehash) {
        updateData.passwordHash = hashPassword(password);
        log.info(`Migrated password hash for user ${user.id} from bcrypt to Argon2id`);
      }

      await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
    } catch (updateError) {
      console.error('Failed to update user on login:', updateError);
      // Continue with login - this is non-critical
    }

    // Log successful login
    await logAuthEvent('LOGIN', user.id, {
      email: user.email,
      userName: `${user.firstName} ${user.lastName}`,
      isSuperAdmin,
      isWorkspaceAdmin,
      workspaceId: effectiveWorkspaceId,
      workspaceName: effectiveWorkspaceName,
    });

    // Successful login resets failure counters.
    recordSuccess(ipRateLimitKey);
    recordSuccess(emailRateLimitKey);

    // Create JWT token
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

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        tenantId: effectiveWorkspaceId,
        workspaceId: effectiveWorkspaceId,
        internalRole,
        isAdmin,
        isManager: internalRole === 'MANAGER',
        isStaff: internalRole === 'STAFF',
        isSuperAdmin,
        isWorkspaceAdmin,
      },
      mustChangePassword: user.mustChangePassword,
      message: 'Login successful',
    });
  } catch (error) {
    log.error('Login error:', safeErrorMessage(error));
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: HTTP_STATUS.SERVER_ERROR }
    );
  }
}
