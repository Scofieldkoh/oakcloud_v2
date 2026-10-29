import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { BadRequestError } from '@/lib/errors';
import { createDocumentGenerationBatchSchema } from '@/lib/validations/document-generation-batch';
import {
  createDocumentGenerationBatch,
  listDocumentGenerationBatches,
} from '@/services/document-generation-batch';
import {
  parseTaskLaunchContext,
  preflightTaskLaunchContext,
} from '@/services/tasks/integration.service';

/**
 * GET /api/document-generation-batches
 * List active resumable generation batches.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');
    const tenantId = requireSessionWorkspaceId(session);
    const batches = await listDocumentGenerationBatches({
      tenantId,
      userId: session.id,
    });
    return NextResponse.json({ batches });
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * POST /api/document-generation-batches
 * Create a persisted batch (or adopt a legacy generation session).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'create');
    const body = await request.json();
    if (
      body
      && typeof body === 'object'
      && ['tenantId', 'userId', 'status', 'previewFingerprint', 'reviewedFingerprint']
        .some((field) => field in body)
    ) {
      throw new BadRequestError('Client-owned fields are not accepted');
    }
    const {
      taskContext: rawTaskContext,
      ...rest
    } = body;
    const input = createDocumentGenerationBatchSchema.parse(rest);
    const tenantId = requireSessionWorkspaceId(session);
    const taskContext = parseTaskLaunchContext(rawTaskContext);
    if (taskContext) {
      await preflightTaskLaunchContext(
        tenantId,
        taskContext,
        'DOCUMENT_GENERATION',
        session,
      );
    }
    const params = { tenantId, userId: session.id };
    const batch = taskContext
      ? await createDocumentGenerationBatch(input, params, taskContext)
      : await createDocumentGenerationBatch(input, params);
    return NextResponse.json(batch, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
