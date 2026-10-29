import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { batchExecutionSchema } from '@/lib/validations/document-generation-batch';
import { retryDocumentGenerationBatchItem } from '@/services/document-generation-batch';

interface RouteParams {
  params: Promise<{ id: string; itemId: string }>;
}

/**
 * POST /api/document-generation-batches/[id]/items/[itemId]/retry
 * Revalidate and retry one failed item.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'create');
    await requirePermission(session, 'document', 'update');
    const { id, itemId } = await params;
    const input = batchExecutionSchema.parse(await request.json());
    const tenantId = requireSessionWorkspaceId(session);
    const batch = await retryDocumentGenerationBatchItem(
      id,
      itemId,
      input,
      { tenantId, userId: session.id },
    );
    return NextResponse.json(batch);
  } catch (error) {
    return createErrorResponse(error);
  }
}
