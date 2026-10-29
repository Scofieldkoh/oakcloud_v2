import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { hardDeleteArchivedForm } from '@/services/form-builder.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'delete');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));

    const form = await hardDeleteArchivedForm(id, {
      tenantId,
      userId: session.id,
    });

    return NextResponse.json(form);
  } catch (error) {
    return createErrorResponse(error);
  }
}
