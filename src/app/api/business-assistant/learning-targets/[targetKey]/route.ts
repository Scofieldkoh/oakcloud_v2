import { getLearningTargetLifecycle } from '@/services/business-assistant/learning-lifecycle.service';
import { assertAssistantAdministrativeAccess } from '@/services/business-assistant/policy.service';
import { handleAssistantError, noStore, routeActor } from '../../_helpers';

export async function GET(request: Request, { params }: { params: Promise<{ targetKey: string }> }) {
  try {
    const actor = await routeActor(request);
    const access = await assertAssistantAdministrativeAccess(actor.userId, actor.tenantId);
    if (!access.isAdmin) {
      return noStore({ error: { code: 'FORBIDDEN', message: 'Only a workspace administrator can read tenant learning configuration.' } }, { status: 403 });
    }
    const { targetKey } = await params;
    const target = await getLearningTargetLifecycle(actor.tenantId, targetKey);
    return noStore({ target });
  } catch (error) {
    return handleAssistantError(error);
  }
}
