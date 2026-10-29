import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { saveGenerationSessionSchema } from '@/lib/validations/generated-document';
import {
  getGenerationSession,
  updateGenerationSession,
} from '@/services/document-generation-session.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');
    const { id } = await params;
    const result = await getGenerationSession(id, {
      tenantId: requireSessionWorkspaceId(session),
      userId: session.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');
    const { id } = await params;
    const body = await request.json();
    const { tenantId: _ignoredTenantId, ...payload } = body;
    const input = saveGenerationSessionSchema.parse(payload);
    const result = await updateGenerationSession(id, input, {
      tenantId: requireSessionWorkspaceId(session),
      userId: session.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
