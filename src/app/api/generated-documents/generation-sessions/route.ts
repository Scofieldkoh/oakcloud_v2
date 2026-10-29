import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/rbac';
import { saveGenerationSessionSchema } from '@/lib/validations/generated-document';
import { createGenerationSession } from '@/services/document-generation-session.service';
import {
  parseTaskLaunchContext,
  preflightTaskLaunchContext,
  safelyLinkGeneratedDocumentTaskOutcome,
} from '@/services/tasks/integration.service';

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'create');

    const body = await request.json();
    const {
      tenantId: _ignoredTenantId,
      taskContext: rawTaskContext,
      ...payload
    } = body;
    const taskContext = parseTaskLaunchContext(rawTaskContext);
    const input = saveGenerationSessionSchema.parse(payload);
    const tenantId = requireSessionWorkspaceId(session);
    if (taskContext) {
      await preflightTaskLaunchContext(
        tenantId,
        taskContext,
        'DOCUMENT_GENERATION',
        session,
      );
    }
    const params = { tenantId, userId: session.id };
    const result = taskContext
      ? await createGenerationSession(input, params, taskContext)
      : await createGenerationSession(input, params);
    if (taskContext) {
      await safelyLinkGeneratedDocumentTaskOutcome({
        tenantId,
        context: taskContext,
        authoritativeId: result.id,
        userId: session.id,
        session,
      });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
