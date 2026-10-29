import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import {
  discardDocumentGenerationBatchSchema,
  updateDocumentGenerationBatchSchema,
} from '@/lib/validations/document-generation-batch';
import {
  discardDocumentGenerationBatch,
  getDocumentGenerationBatch,
  updateDocumentGenerationBatch,
} from '@/services/document-generation-batch';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/document-generation-batches/[id]
 * Resume one batch with its derived master catalogue and item summaries.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');
    const { id } = await params;
    const tenantId = requireSessionWorkspaceId(session);
    const batch = await getDocumentGenerationBatch(id, {
      tenantId,
      userId: session.id,
    });
    return NextResponse.json(batch);
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * PUT /api/document-generation-batches/[id]
 * Save full shared and item state using an expected revision.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');
    const { id } = await params;
    const body = await request.json();
    const input = updateDocumentGenerationBatchSchema.parse(body);
    const tenantId = requireSessionWorkspaceId(session);
    const batch = await updateDocumentGenerationBatch(
      id,
      input,
      { tenantId, userId: session.id },
    );
    return NextResponse.json(batch);
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * DELETE /api/document-generation-batches/[id]
 * Discard the aggregate and its incomplete children.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'delete');
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const input = discardDocumentGenerationBatchSchema.parse(body);
    const tenantId = requireSessionWorkspaceId(session);
    const result = await discardDocumentGenerationBatch(
      id,
      input,
      { tenantId, userId: session.id },
    );
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
