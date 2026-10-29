import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { batchExecutionSchema } from '@/lib/validations/document-generation-batch';
import { generateDocumentGenerationBatch } from '@/services/document-generation-batch';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/document-generation-batches/[id]/generate
 * Generate all ready, ungenerated items with bounded concurrency.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'create');
    await requirePermission(session, 'document', 'update');
    const { id } = await params;
    const input = batchExecutionSchema.parse(await request.json());
    const tenantId = requireSessionWorkspaceId(session);
    const result = await generateDocumentGenerationBatch(
      id,
      input,
      { tenantId, userId: session.id },
    );
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
