import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { finalizeDocument, unfinalizeDocument } from '@/services/document-generator.service';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import {
  parseTaskLaunchContext,
  preflightTaskLaunchContext,
  safelyLinkGeneratedDocumentTaskOutcome,
} from '@/services/tasks/integration.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseExpectedRevision(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const revision = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error('expectedRevision must be a non-negative integer');
  }
  return revision;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'document', 'update');

    const body = await request.json().catch(() => ({}));
    const expectedRevision = parseExpectedRevision(
      typeof body === 'object' && body !== null && 'expectedRevision' in body
        ? (body as { expectedRevision?: unknown }).expectedRevision
        : undefined,
    );
    const taskContext = parseTaskLaunchContext(
      typeof body === 'object' && body !== null && 'taskContext' in body
        ? (body as { taskContext: unknown }).taskContext
        : undefined,
    );
    const tenantId = requireSessionWorkspaceId(session);
    if (taskContext) {
      await preflightTaskLaunchContext(
        tenantId,
        taskContext,
        'DOCUMENT_GENERATION',
        session,
      );
    }

    const document = await finalizeDocument(
      id,
      { tenantId, userId: session.id },
      expectedRevision,
    );
    if (taskContext) {
      await safelyLinkGeneratedDocumentTaskOutcome({
        tenantId,
        context: taskContext,
        authoritativeId: id,
        userId: session.id,
        session,
      });
    }

    return NextResponse.json(document);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'document', 'update');

    const { searchParams } = new URL(request.url);
    const reason = searchParams.get('reason');
    if (!reason) {
      return NextResponse.json({ error: 'Reason is required for un-finalizing' }, { status: 400 });
    }
    const expectedRevision = parseExpectedRevision(searchParams.get('expectedRevision'));
    const tenantId = requireSessionWorkspaceId(session);
    const document = await unfinalizeDocument(
      id,
      { tenantId, userId: session.id },
      reason,
      expectedRevision,
    );

    return NextResponse.json(document);
  } catch (error) {
    return createErrorResponse(error);
  }
}
