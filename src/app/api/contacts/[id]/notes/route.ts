import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createAuditContext } from '@/lib/audit';
import { parseIdParams } from '@/lib/validations/params';
import { prisma } from '@/lib/prisma';
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

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/contacts/:id/notes
 * Get all note tabs for a contact
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await parseIdParams(params);
    const { searchParams } = new URL(request.url);
    const tenantResult = await requireWorkspaceContext(session, searchParams.get('tenantId'));
    if ('error' in tenantResult) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    const contact = await prisma.contact.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    await requirePermission(session, 'contact', 'read');

    const tabs = await getNoteTabs('contact', id, tenantId);

    return NextResponse.json(tabs);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/**
 * POST /api/contacts/:id/notes
 * Create a new note tab for a contact
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await parseIdParams(params);
    const { searchParams } = new URL(request.url);

    const body = await request.json();
    const tenantResult = await requireWorkspaceContext(
      session,
      typeof body.tenantId === 'string' ? body.tenantId : searchParams.get('tenantId')
    );
    if ('error' in tenantResult) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    const contact = await prisma.contact.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    await requirePermission(session, 'contact', 'update');

    const validatedData = createNoteTabSchema.parse(body);

    const auditContext = await createAuditContext({
      tenantId,
      userId: session.id,
      changeSource: 'MANUAL',
    });

    const tab = await createNoteTab('contact', id, validatedData, auditContext, tenantId);

    return NextResponse.json(tab, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    if (error instanceof Error && error.message === 'Parent entity not found') {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    return routeErrorResponse(error);
  }
}
