import { NextResponse } from 'next/server';
import { z } from 'zod';
import { canManageWorkspace, requireAuth } from '@/lib/auth';
import { createErrorResponse } from '@/lib/api-helpers';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { normalizeWorkspaceLogoUrl } from '@/lib/workspace-logo-url';

const updateWorkspaceBrandingSchema = z.object({
  name: z.string().trim().min(2, 'Workspace name must be at least 2 characters').max(100, 'Workspace name must be at most 100 characters'),
  logoUrl: z
    .string()
    .trim()
    .max(500, 'Logo URL must be at most 500 characters')
    .optional()
    .nullable()
    .transform((value) => (value ? value : null))
    .refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Logo URL must be a valid HTTP or HTTPS URL'),
});

function workspaceResponse(workspace: { id: string; name: string; logoUrl: string | null }) {
  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      logoUrl: normalizeWorkspaceLogoUrl(workspace.logoUrl),
    },
  };
}

export async function GET() {
  try {
    const session = await requireAuth();
    const workspaceId = session.tenantId;

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true, name: true, logoUrl: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    return NextResponse.json(workspaceResponse(workspace));
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAuth();
    const workspaceId = session.tenantId;

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace context required' }, { status: 400 });
    }

    if (!canManageWorkspace(session, workspaceId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const data = updateWorkspaceBrandingSchema.parse(body);
    const existing = await prisma.workspace.findUnique({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true, name: true, logoUrl: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const nextLogoUrl = normalizeWorkspaceLogoUrl(data.logoUrl);
    const workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        name: data.name,
        logoUrl: nextLogoUrl,
      },
      select: { id: true, name: true, logoUrl: true },
    });

    await createAuditLog({
      tenantId: workspaceId,
      userId: session.id,
      action: 'TENANT_UPDATED',
      entityType: 'Workspace',
      entityId: workspaceId,
      entityName: workspace.name,
      summary: `Updated workspace branding for "${workspace.name}"`,
      changeSource: 'MANUAL',
      changes: {
        name: { old: existing.name, new: workspace.name },
        logoUrl: { old: existing.logoUrl, new: workspace.logoUrl },
      },
    });

    return NextResponse.json(workspaceResponse(workspace));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'Invalid request' }, { status: 400 });
    }
    return createErrorResponse(error);
  }
}
