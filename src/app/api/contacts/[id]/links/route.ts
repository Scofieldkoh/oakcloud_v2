import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { getContactLinkInfo } from '@/services/contact.service';
import { routeErrorResponse } from '@/lib/api-route-errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check permission
    await requirePermission(session, 'contact', 'read', id);

    if (!session.tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    const linkInfo = await getContactLinkInfo(id, session.tenantId);

    return NextResponse.json(linkInfo);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
