import { recordFeedback } from '@/services/business-assistant/feedback.service';
import { handleAssistantError, noStore, readJson, routeActor } from '../_helpers';

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const actor = await routeActor(request);
    const feedback = await recordFeedback({ userId: actor.userId, tenantId: actor.tenantId, requestId: actor.requestId }, body);
    return noStore({ feedback }, { status: 202 });
  } catch (error) {
    return handleAssistantError(error);
  }
}
