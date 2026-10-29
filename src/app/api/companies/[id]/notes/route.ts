import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createAuditContext } from '@/lib/audit';
import { parseIdParams } from '@/lib/validations/params';
import { requireWorkspaceContext } from '@/lib/api-helpers';
import {
  getNoteTabs,
  createNoteTab,
} from '@/services/notes.service';
import { z } from 'zod';
import { routeErrorResponse } from '@/lib/api-route-errors';

const createNoteTabSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  content: z.string().optional(),
});

/**
 * GET /api/companies/:id/notes
 * Get all note tabs for a company
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await parseIdParams(params);
    const { searchParams } = new URL(request.url);
    const tenantResult = await requireWorkspaceContext(session, searchParams.get('tenantId'));
    if ('error' in tenantResult) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Check permission
    await requirePermission(session, 'company', 'read', id);

    // Additional check for company-scoped users
    if (!(await canAccessCompany(session, id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const tabs = await getNoteTabs('company', id, tenantId);

    return NextResponse.json(tabs);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/**
 * POST /api/companies/:id/notes
 * Create a new note tab for a company
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await parseIdParams(params);
    const { searchParams } = new URL(request.url);

    // Check permission
    await requirePermission(session, 'company', 'update', id);

    // Additional check for company-scoped users
    if (!(await canAccessCompany(session, id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const tenantResult = await requireWorkspaceContext(
      session,
      typeof body.tenantId === 'string' ? body.tenantId : searchParams.get('tenantId')
    );
    if ('error' in tenantResult) return tenantResult.error;
    const tenantId = tenantResult.tenantId;
    const validatedData = createNoteTabSchema.parse(body);

    const auditContext = await createAuditContext({
      tenantId,
      userId: session.id,
      changeSource: 'MANUAL',
    });

    const tab = await createNoteTab('company', id, validatedData, auditContext, tenantId);

    return NextResponse.json(tab, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    if (error instanceof Error && error.message === 'Parent entity not found') {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }
    return routeErrorResponse(error);
  }
}
