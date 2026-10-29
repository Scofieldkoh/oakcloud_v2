import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { batchReviewSchema } from '@/lib/validations/document-generation-batch';
import { reviewDocumentGenerationBatchItem } from '@/services/document-generation-batch';

interface RouteParams {
  params: Promise<{ id: string; itemId: string }>;
}

/**
 * POST /api/document-generation-batches/[id]/items/[itemId]/review
 * Approve the exact current preview fingerprint.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');
    const { id, itemId } = await params;
    const input = batchReviewSchema.parse(await request.json());
    const tenantId = requireSessionWorkspaceId(session);
    const batch = await reviewDocumentGenerationBatchItem(
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
