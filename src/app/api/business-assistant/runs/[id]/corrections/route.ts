import { createCorrectionProposal } from '@/services/business-assistant/correction.service';
import { handleAssistantError, noStore, readJson, routeActor } from '../../../_helpers';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await readJson(request);
    const workspaceId = body && typeof body === 'object' && 'workspaceId' in body
      ? String((body as { workspaceId?: unknown }).workspaceId ?? '') || null : null;
    const actor = await routeActor(request, workspaceId);
    const { id } = await params;
    const correction = await createCorrectionProposal({
      actor: { userId: actor.userId, tenantId: actor.tenantId, requestId: actor.requestId, source: 'BUSINESS_ASSISTANT' },
      runId: id,
      rawInput: body,
    });
    return noStore({ correction });
  } catch (error) {
    return handleAssistantError(error);
  }
}
