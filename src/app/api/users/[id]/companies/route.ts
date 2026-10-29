/**
 * User Company Assignments API Routes
 *
 * GET    /api/users/:id/companies - Get user's company assignments
 * POST   /api/users/:id/companies - Assign user to a company
 * DELETE /api/users/:id/companies/:companyId - Remove company assignment
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getUserCompanyAssignments,
  assignUserToCompany,
  removeCompanyAssignment,
  updateCompanyAssignment,
} from '@/services/user-company.service';
import { z } from 'zod';
import { createErrorResponse } from '@/lib/api-helpers';

const assignCompanySchema = z.object({
  companyId: z.string().uuid('Invalid company ID').nullable(), // null = "All Companies"
  roleId: z.string().uuid('Invalid role ID').optional(), // Role to assign for this company
  isPrimary: z.boolean().optional(),
  tenantId: z.string().uuid('Invalid tenant ID').optional(), // Required for SUPER_ADMIN
});

const updateAssignmentSchema = z.object({
  assignmentId: z.string().uuid('Invalid assignment ID'),
  accessLevel: z.enum(['VIEW', 'EDIT', 'MANAGE']).optional(),
  isPrimary: z.boolean().optional(),
});

const removeAssignmentSchema = z.object({
  assignmentId: z.string().uuid('Invalid assignment ID'),
});

// GET - Get user's company assignments
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { id: userId } = await params;

    if (!session.tenantId && !session.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const assignments = await getUserCompanyAssignments(
      userId,
      session.tenantId || ''
    );

    return NextResponse.json({ assignments });
  } catch (error) {
    return createErrorResponse(error);
  }
}

// POST - Assign user to company
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { id: userId } = await params;
    const body = await request.json();

    const data = assignCompanySchema.parse(body);

    // Determine tenantId: use session.tenantId for TENANT_ADMIN, or request body for SUPER_ADMIN
    const tenantId = session.tenantId || data.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 });
    }

    const assignment = await assignUserToCompany(
      { userId, companyId: data.companyId, roleId: data.roleId, isPrimary: data.isPrimary },
      tenantId,
      session.id
    );

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    return createErrorResponse(error);
  }
}

// PATCH - Update assignment
export async function PATCH(
  request: NextRequest,
  _props: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await request.json();

    if (!session.tenantId && !session.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { assignmentId, ...updateData } = updateAssignmentSchema.parse(body);

    const assignment = await updateCompanyAssignment(
      assignmentId,
      updateData,
      session.tenantId || '',
      session.id
    );

    return NextResponse.json({ assignment });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    return createErrorResponse(error);
  }
}

// DELETE - Remove assignment
export async function DELETE(
  request: NextRequest,
  _props: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await request.json();

    if (!session.tenantId && !session.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { assignmentId } = removeAssignmentSchema.parse(body);

    await removeCompanyAssignment(
      assignmentId,
      session.tenantId || '',
      session.id
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    return createErrorResponse(error);
  }
}
