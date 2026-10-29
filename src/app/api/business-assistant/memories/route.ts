import { listMemories } from '@/services/business-assistant/memory.service';
import { handleAssistantError, noStore, routeActor } from '../_helpers';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const actor = await routeActor(request, url.searchParams.get('workspaceId'));
    const memories = await listMemories({ userId: actor.userId, tenantId: actor.tenantId, requestId: actor.requestId }, { includeDeleted: url.searchParams.get('includeDeleted') === 'true', capabilityId: url.searchParams.get('capabilityId') ?? undefined });
    return noStore({ memories });
  } catch (error) {
    return handleAssistantError(error);
  }
}
