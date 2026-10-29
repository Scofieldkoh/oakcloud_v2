import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { sendEsigningEnvelope } from '@/services/esigning-envelope.service';
import {
  parseTaskLaunchContext,
  preflightTaskLaunchContext,
  safelyLinkEsigningEnvelopeTaskOutcome,
} from '@/services/tasks/integration.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'esigning', 'update');

    const body = await request.json().catch(() => ({}));
    const tenantId = resolveWorkspaceId(session, body.tenantId);
    const taskContext = parseTaskLaunchContext(body.taskContext);
    if (taskContext) {
      await preflightTaskLaunchContext(
        tenantId,
        taskContext,
        'ESIGNING',
        session,
      );
    }

    const result = await sendEsigningEnvelope(session, tenantId, id);
    if (taskContext) {
      await safelyLinkEsigningEnvelopeTaskOutcome({
        tenantId,
        context: taskContext,
        authoritativeId: id,
        userId: session.id,
        session,
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
