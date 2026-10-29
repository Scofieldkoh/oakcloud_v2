/**
 * Workspace Users API Routes
 *
 * GET  /api/workspace/users - List users in the current workspace
 * POST /api/workspace/users - Invite user to the current workspace
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse } from '@/lib/api-helpers';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { inviteUserSchema } from '@/lib/validations/workspace';
import { inviteUserToWorkspace } from '@/services/workspace.service';
import {
  workspaceUsersQuerySchema,
  safeParseQueryParams,
  createValidationErrorResponse,
} from '@/lib/validations/query-params';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const workspaceId = session.tenantId;

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    }
    await requirePermission(session, 'user', 'read');

    const { searchParams } = new URL(request.url);

    // Validate query parameters
    const validation = safeParseQueryParams(searchParams, workspaceUsersQuerySchema);
    if (!validation.success) {
      return NextResponse.json(createValidationErrorResponse(validation.error), { status: 400 });
    }

    const { page, limit, query, role, company, sortBy, sortOrder } = validation.data;

    const where = {
      tenantId: workspaceId,
      deletedAt: null,
      ...(query && {
        OR: [
          { email: { contains: query, mode: 'insensitive' as const } },
          { firstName: { contains: query, mode: 'insensitive' as const } },
          { lastName: { contains: query, mode: 'insensitive' as const } },
        ],
      }),
      // Filter by role name or systemRoleType
      // Handles both exact matches and normalized names (e.g., "COMPANY_ADMIN" matches "Company Admin")
      ...(role && {
        roleAssignments: {
          some: {
            role: {
              OR: [
                { name: role },
                { systemRoleType: role },
                // Convert "COMPANY_ADMIN" to "Company Admin" for matching
                { name: role.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') },
              ],
            },
          },
        },
      }),
      // Filter by company name (partial match)
      ...(company && {
        roleAssignments: {
          some: {
            company: {
              name: { contains: company, mode: 'insensitive' as const },
            },
          },
        },
      }),
    };

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          roleAssignments: {
            select: {
              id: true,
              roleId: true,
              companyId: true,
              role: {
                select: {
                  id: true,
                  name: true,
                  systemRoleType: true,
                },
              },
              company: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
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
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json({
      users,
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const workspaceId = session.tenantId;

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    }
    await requirePermission(session, 'user', 'create');

    const body = await request.json();
    const data = inviteUserSchema.parse(body);

    const result = await inviteUserToWorkspace(workspaceId, data, session.id);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('maximum number of users')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return routeErrorResponse(error, {
      notFound: 'any',
      conflict: ['A user with this email already exists'],
      fallback: 'bad-request',
    });
  }
}
