import { z } from 'zod';
import {
  deactivateLearningConfiguration,
  deleteLearningConfiguration,
  expireLearningConfiguration,
} from '@/services/business-assistant/learning-lifecycle.service';
import { handleAssistantError, noStore, readJson, routeActor } from '../../../_helpers';

const lifecycleActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('DEACTIVATE'), expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('EXPIRE'), expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('DELETE'), expectedRevision: z.number().int().nonnegative() }).strict(),
]);

export async function POST(request: Request, { params }: { params: Promise<{ targetKey: string }> }) {
  try {
    const body = lifecycleActionSchema.safeParse(await readJson(request));
    if (!body.success) {
      return noStore({ error: { code: 'VALIDATION_FAILED', message: 'The learning target lifecycle action is invalid.' } }, { status: 400 });
    }
    const actor = await routeActor(request);
    const { targetKey } = await params;
    const lifecycleActor = { userId: actor.userId, tenantId: actor.tenantId, requestId: actor.requestId };
    const target = body.data.action === 'DEACTIVATE'
      ? await deactivateLearningConfiguration(lifecycleActor, targetKey, body.data.expectedRevision)
      : body.data.action === 'EXPIRE'
        ? await expireLearningConfiguration(lifecycleActor, targetKey, body.data.expectedRevision)
        : await deleteLearningConfiguration(lifecycleActor, targetKey, body.data.expectedRevision);
    return noStore({ target });
  } catch (error) {
    return handleAssistantError(error);
  }
}
