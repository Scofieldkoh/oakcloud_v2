import { readJson, routeActor, handleAssistantError, noStore } from '../_helpers';
import { acceptTurn } from '@/services/business-assistant/conversation.service';

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const workspaceId = body && typeof body === 'object' && body !== null && 'workspaceId' in body ? String((body as { workspaceId?: unknown }).workspaceId ?? '') || null : null;
    const actor = await routeActor(request, workspaceId);
    const accepted = await acceptTurn({ userId: actor.userId, tenantId: actor.tenantId, requestId: actor.requestId }, body);
    return noStore({ type: 'accepted', conversationId: accepted.conversationId, messageId: accepted.messageId, runId: accepted.runId, duplicate: accepted.duplicate }, { status: accepted.duplicate ? 200 : 202 });
  } catch (error) {
    return handleAssistantError(error);
  }
}
