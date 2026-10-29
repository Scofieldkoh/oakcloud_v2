/**
 * Individual Workspace User API Routes
 *
 * GET    /api/workspace/users/:userId - Get user details
 * PATCH  /api/workspace/users/:userId - Update user
 * DELETE /api/workspace/users/:userId - Remove user from workspace
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { removeUserFromWorkspace } from '@/services/workspace.service';
import { requestPasswordReset } from '@/services/password.service';
import { createAuditLog, computeChanges } from '@/lib/audit';
import { z } from 'zod';

// Validation schema for user updates
const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  isActive: z.boolean().optional(),
  sendPasswordReset: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireAuth();
    const { userId } = await params;
    const workspaceId = session.tenantId;

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    }
    await requirePermission(session, 'user', 'read');

    const user = await prisma.user.findUnique({
      where: { id: userId, tenantId: workspaceId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        mustChangePassword: true,
        companyAssignments: {
          select: {
            id: true,
            companyId: true,
            isPrimary: true,
            company: {
              select: {
                id: true,
                name: true,
                uen: true,
              },
            },
          },
        },
        roleAssignments: {
          select: {
            id: true,
            role: {
              select: {
                id: true,
                name: true,
                isSystem: true,
                systemRoleType: true,
              },
            },
            companyId: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireAuth();
    const { userId } = await params;
    const workspaceId = session.tenantId;

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    }
    await requirePermission(session, 'user', 'update');

    const body = await request.json();
    const data = updateUserSchema.parse(body);

    // Get existing user
    const existingUser = await prisma.user.findUnique({
      where: { id: userId, tenantId: workspaceId, deletedAt: null },
    });

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Handle password reset request
    if (data.sendPasswordReset) {
      await requestPasswordReset(existingUser.email);
    }

    // Prepare update data
    const updateData: Record<string, unknown> = {};
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    // Handle email change (check uniqueness)
    if (data.email && data.email !== existingUser.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email: data.email.toLowerCase() },
      });
      if (emailExists) {
        return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
      }
      updateData.email = data.email.toLowerCase();
    }

    // Update user if there are changes
    let updatedUser = existingUser;
    if (Object.keys(updateData).length > 0) {
      updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });

      // Log changes
      const changes = computeChanges(
        existingUser as unknown as Record<string, unknown>,
        updateData,
        ['firstName', 'lastName', 'email', 'isActive', 'companyId']
      );

      if (changes) {
        const userName = `${updatedUser.firstName} ${updatedUser.lastName}`.trim() || updatedUser.email;
        await createAuditLog({
          tenantId: workspaceId,
          userId: session.id,
          action: 'UPDATE',
          entityType: 'User',
          entityId: userId,
          entityName: userName,
          summary: `Updated user "${userName}"`,
          changeSource: 'MANUAL',
          changes,
        });
      }
    }

    return NextResponse.json({
      id: updatedUser.id,
      email: updatedUser.email,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      isActive: updatedUser.isActive,
      passwordResetSent: data.sendPasswordReset || false,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireAuth();
    const { userId } = await params;
    const workspaceId = session.tenantId;

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    }
    await requirePermission(session, 'user', 'delete');

    // Prevent self-deletion
    if (userId === session.id) {
      return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 });
    }

    // Get reason from request body (optional)
    let reason = 'Removed by administrator';
    try {
      const body = await request.json();
      if (body.reason && typeof body.reason === 'string') {
        reason = body.reason;
      }
    } catch {
      // No body or invalid JSON - use default reason (DELETE with no body is valid)
    }

    await removeUserFromWorkspace(workspaceId, userId, session.id, reason);

    return NextResponse.json({ success: true });
  } catch (error) {
    return createErrorResponse(error);
  }
}
