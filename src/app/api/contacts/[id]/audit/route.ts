import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { getAuditHistory } from '@/lib/audit';
import type { AuditAction } from '@/generated/prisma';
import { parseIdParams } from '@/lib/validations/params';
import { prisma } from '@/lib/prisma';
import { clampLimit, parseIntegerParam, parseNumericParam, requireWorkspaceContext } from '@/lib/api-helpers';
import { routeErrorResponse } from '@/lib/api-route-errors';

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

    // Check audit log read permission (or contact read permission as fallback)
    try {
      await requirePermission(session, 'audit_log', 'read');
    } catch {
      // Fall back to contact read permission
      await requirePermission(session, 'contact', 'read');
    }

    const limit = clampLimit(parseNumericParam(searchParams.get('limit')), { default: 50, max: 200 });
    const offset = Math.max(0, parseIntegerParam(searchParams.get('offset'), 0) ?? 0);
    const actions = searchParams.get('actions')?.split(',') as AuditAction[] | undefined;

    const auditLogs = await getAuditHistory('Contact', id, {
      limit,
      offset,
      actions,
      tenantId,
    });

    return NextResponse.json(auditLogs);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
