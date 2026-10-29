import { applyMemoryAction } from '@/services/business-assistant/memory.service';
import { handleAssistantError, noStore, readJson, routeActor } from '../../../_helpers';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await readJson(request);
    const actor = await routeActor(request);
    const { id } = await params;
    const memory = await applyMemoryAction({ userId: actor.userId, tenantId: actor.tenantId, requestId: actor.requestId }, id, body);
    return noStore({ memory });
  } catch (error) {
    return handleAssistantError(error);
  }
}
