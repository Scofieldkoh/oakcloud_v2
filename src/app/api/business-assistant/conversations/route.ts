import { listConversations } from '@/services/business-assistant/conversation.service';
import { handleAssistantError, noStore, routeActor } from '../_helpers';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const actor = await routeActor(request, url.searchParams.get('workspaceId'));
    const result = await listConversations({ userId: actor.userId, tenantId: actor.tenantId, requestId: actor.requestId }, { cursor: url.searchParams.get('cursor') ?? undefined, limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined });
    return noStore(result);
  } catch (error) {
    return handleAssistantError(error);
  }
}
