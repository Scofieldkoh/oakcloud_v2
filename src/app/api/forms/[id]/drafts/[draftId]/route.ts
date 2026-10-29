import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import {
  deleteFormDraft,
  extendFormDraftExpiry,
  generateFormDraftResumeLink,
  getFormDraftById,
} from '@/services/form-builder.service';

interface RouteParams {
  params: Promise<{
    id: string;
    draftId: string;
  }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, draftId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'delete');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const reason = searchParams.get('reason') || undefined;

    const result = await deleteFormDraft(
      id,
      draftId,
      {
        tenantId,
        userId: session.id,
      },
      reason
    );

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, draftId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));

    const result = await getFormDraftById(id, draftId, tenantId);
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, draftId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const payload = await request.json().catch(() => ({}));
    const expiresAtValue = typeof payload.expiresAt === 'string' ? payload.expiresAt : '';
    const reason = typeof payload.reason === 'string' ? payload.reason : undefined;

    const result = await extendFormDraftExpiry(
      id,
      draftId,
      {
        tenantId,
        userId: session.id,
      },
      new Date(expiresAtValue),
      reason
    );

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, draftId } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const payload = await request.json().catch(() => ({}));
    const reason = typeof payload.reason === 'string' ? payload.reason : undefined;

    const result = await generateFormDraftResumeLink(
      id,
      draftId,
      {
        tenantId,
        userId: session.id,
      },
      reason
    );

    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
