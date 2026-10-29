import { applyRunAction } from '@/services/business-assistant/run.service';
import { handleAssistantError, noStore, readJson, routeActor } from '../../../_helpers';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await readJson(request);
    const workspaceId = body && typeof body === 'object' && body !== null && 'workspaceId' in body ? String((body as { workspaceId?: unknown }).workspaceId ?? '') || null : null;
    const actor = await routeActor(request, workspaceId);
    const { id } = await params;
    const run = await applyRunAction({ userId: actor.userId, tenantId: actor.tenantId, requestId: actor.requestId }, id, body);
    return noStore({ run });
  } catch (error) {
    return handleAssistantError(error);
  }
}
