import { getRun } from '@/services/business-assistant/run.service';
import { handleAssistantError, noStore, routeActor } from '../../_helpers';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(request.url);
    const actor = await routeActor(request, url.searchParams.get('workspaceId'));
    const { id } = await params;
    const run = await getRun({ userId: actor.userId, tenantId: actor.tenantId, requestId: actor.requestId }, id);
    return noStore({ run });
  } catch (error) {
    return handleAssistantError(error);
  }
}
