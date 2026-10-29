import { getConversation } from '@/services/business-assistant/conversation.service';
import { handleAssistantError, noStore, routeActor } from '../../_helpers';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(request.url);
    const actor = await routeActor(request, url.searchParams.get('workspaceId'));
    const { id } = await params;
    const conversation = await getConversation({ userId: actor.userId, tenantId: actor.tenantId, requestId: actor.requestId }, id);
    return noStore({ conversation });
  } catch (error) {
    return handleAssistantError(error);
  }
}
