import { businessAssistantCapabilityRegistry } from '@/generated/business-assistant-capability-registry';
import { handleAssistantError, noStore, routeActor } from '../_helpers';
import { evaluateAssistantActor, hasCapabilityPermissions } from '@/services/business-assistant/policy.service';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const actor = await routeActor(request, url.searchParams.get('workspaceId'));
    const query = url.searchParams.get('query')?.trim().slice(0, 200) || undefined;
    const resources = [] as { resourceType: string; resourceId: string; title: string; role: 'source' | 'target' | 'context'; description?: string }[];
    const decision = await evaluateAssistantActor(actor.userId, actor.tenantId);
    const seen = new Set<string>();
    for (const capability of businessAssistantCapabilityRegistry.list().filter((candidate) => hasCapabilityPermissions(decision, candidate))) {
      if (!capability.resolveResources) continue;
      const found = await capability.resolveResources({ tenantId: actor.tenantId, userId: actor.userId, requestId: actor.requestId, source: 'BUSINESS_ASSISTANT' }, query);
      for (const resource of found) {
        const key = `${resource.resourceType}:${resource.resourceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        resources.push(resource);
        if (resources.length >= 100) break;
      }
      if (resources.length >= 100) break;
    }
    return noStore({ resources });
  } catch (error) {
    return handleAssistantError(error);
  }
}
