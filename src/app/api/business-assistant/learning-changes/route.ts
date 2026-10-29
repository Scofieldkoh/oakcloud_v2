import { listLearningChanges } from '@/services/business-assistant/learning.service';
import { handleAssistantError, noStore, routeActor } from '../_helpers';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const actor = await routeActor(request, url.searchParams.get('workspaceId'));
    const changes = await listLearningChanges({ userId: actor.userId, tenantId: actor.tenantId, requestId: actor.requestId });
    return noStore({ changes });
  } catch (error) {
    return handleAssistantError(error);
  }
}
