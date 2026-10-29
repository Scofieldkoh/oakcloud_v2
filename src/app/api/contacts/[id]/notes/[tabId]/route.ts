import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createAuditContext } from '@/lib/audit';
import { parseIdParams } from '@/lib/validations/params';
import { prisma } from '@/lib/prisma';
import { requireWorkspaceContext } from '@/lib/api-helpers';
import {
  updateNoteTab,
  deleteNoteTab,
  verifyNoteTabOwnership,
} from '@/services/notes.service';
import { z } from 'zod';
import { routeErrorResponse } from '@/lib/api-route-errors';

const updateNoteTabSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  content: z.string().optional(),
});

type RouteParams = { params: Promise<{ id: string; tabId: string }> };

/**
 * PATCH /api/contacts/:id/notes/:tabId
 * Update a note tab (title or content)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id, tabId } = await parseIdParams(params);
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

    await requirePermission(session, 'contact', 'update');

    // Verify tab belongs to this contact
    const isOwner = await verifyNoteTabOwnership(tabId, 'contact', id, tenantId);
    if (!isOwner) {
      return NextResponse.json({ error: 'Note tab not found' }, { status: 404 });
    }

    const body = await request.json();
    const validatedData = updateNoteTabSchema.parse(body);

    const auditContext = await createAuditContext({
      tenantId,
      userId: session.id,
      changeSource: 'MANUAL',
    });

    const tab = await updateNoteTab(tabId, validatedData, auditContext);

    return NextResponse.json(tab);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    return routeErrorResponse(error, { notFound: ['Contact not found', 'Note tab not found'] });
  }
}

/**
 * DELETE /api/contacts/:id/notes/:tabId
 * Delete a note tab
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id, tabId } = await parseIdParams(params);
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

    await requirePermission(session, 'contact', 'update');

    // Verify tab belongs to this contact
    const isOwner = await verifyNoteTabOwnership(tabId, 'contact', id, tenantId);
    if (!isOwner) {
      return NextResponse.json({ error: 'Note tab not found' }, { status: 404 });
    }

    const auditContext = await createAuditContext({
      tenantId,
      userId: session.id,
      changeSource: 'MANUAL',
    });

    await deleteNoteTab(tabId, auditContext);

    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, { notFound: ['Contact not found', 'Note tab not found'] });
  }
}
