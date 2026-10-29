import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { getAuditHistory } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';

interface RouteParams {
  params: Promise<{
    id: string;
    draftId: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, draftId } = await params;
    const session = await requireAuth();

    try {
      await requirePermission(session, 'audit_log', 'read');
    } catch {
      await requirePermission(session, 'document', 'read');
    }

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));

    const draft = await prisma.formDraft.findFirst({
      where: {
        id: draftId,
        formId: id,
        tenantId,
      },
      select: { id: true },
    });

    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    const auditLogs = await getAuditHistory('FormDraft', draftId, {
      tenantId,
      limit: 100,
    });

    return NextResponse.json(auditLogs);
  } catch (error) {
    return createErrorResponse(error);
  }
}
