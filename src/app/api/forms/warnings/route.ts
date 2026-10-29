import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { listFormsWithWarnings } from '@/services/form-builder.service';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || '8')));

    const warnings = await listFormsWithWarnings(tenantId, limit);
    return NextResponse.json({ forms: warnings });
  } catch (error) {
    return createErrorResponse(error);
  }
}
