import { z } from 'zod';
import { deriveLearningCandidateFromFeedback } from '@/services/business-assistant/learning-derivation.service';
import { handleAssistantError, noStore, readJson, routeActor } from '../_helpers';

const requestSchema = z.object({
  feedbackId: z.string().trim().min(1).max(200),
  candidateVersion: z.string().trim().min(1).max(40),
}).strict();

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return noStore({ error: { code: 'VALIDATION_FAILED', message: 'The learning derivation request is invalid.' } }, { status: 400 });
    }
    const actor = await routeActor(request);
    const candidate = await deriveLearningCandidateFromFeedback(
      { userId: actor.userId, tenantId: actor.tenantId, requestId: actor.requestId },
      parsed.data.feedbackId,
      parsed.data.candidateVersion,
    );
    return noStore({ candidate });
  } catch (error) {
    return handleAssistantError(error);
  }
}
