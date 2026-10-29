import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { businessAssistantFeedbackSchema, type BusinessAssistantFeedback } from '@/lib/validations/business-assistant';
import { sha256 } from './contracts';
import { assertAssistantMutationAccess } from './policy.service';
import type { AssistantActor } from './conversation.service';

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export interface FeedbackDto {
  id: string;
  targetType: string;
  targetId: string;
  eventType: string;
  comment: string | null;
  adjudication: string;
  createdAt: string;
}

export async function recordFeedback(actor: AssistantActor, rawInput: unknown): Promise<FeedbackDto> {
  const parsed = businessAssistantFeedbackSchema.safeParse(rawInput);
  if (!parsed.success) throw new FeedbackServiceError('VALIDATION_FAILED', 'The feedback payload is invalid.');
  const input = parsed.data;
  await assertAssistantMutationAccess(actor.userId, actor.tenantId);
  await assertFeedbackTarget(actor, input);
  const bodyHash = sha256(input);
  const existing = input.clientEventId ? await prisma.businessAssistantFeedback.findFirst({ where: { tenantId: actor.tenantId, ownerId: actor.userId, clientEventId: input.clientEventId }, select: { id: true, bodyHash: true, targetType: true, targetId: true, eventType: true, comment: true, adjudication: true, createdAt: true } }).catch(() => null) : null;
  if (existing) {
    // The database enforces the dedup key. A changed body is a conflict even
    // when the target itself remains authorized.
    if (existing.bodyHash !== bodyHash) throw new FeedbackServiceError('ACTION_CONFLICT', 'This feedback event ID was already used with different content.');
    return toFeedbackDto(existing);
  }
  const feedback = await prisma.businessAssistantFeedback.create({ data: { tenantId: actor.tenantId, ownerId: actor.userId, targetType: input.targetType, targetId: input.targetId, eventType: input.eventType, comment: input.comment, bodyHash, provenance: jsonInput(input.provenance ?? { source: 'USER' }), adjudication: 'PENDING', clientEventId: input.clientEventId } });
  return toFeedbackDto(feedback);
}

async function assertFeedbackTarget(actor: AssistantActor, input: BusinessAssistantFeedback): Promise<void> {
  if (input.targetType === 'MESSAGE') {
    const target = await prisma.businessAssistantMessage.findFirst({ where: { id: input.targetId, tenantId: actor.tenantId, ownerId: actor.userId }, select: { id: true } });
    if (!target) throw new FeedbackServiceError('NOT_FOUND', 'The feedback target is unavailable.');
  } else if (input.targetType === 'RUN' || input.targetType === 'PROPOSAL') {
    const target = input.targetType === 'RUN'
      ? await prisma.businessAssistantRun.findFirst({ where: { id: input.targetId, tenantId: actor.tenantId, ownerId: actor.userId }, select: { id: true } })
      : await prisma.businessAssistantProposal.findFirst({ where: { id: input.targetId, tenantId: actor.tenantId, run: { ownerId: actor.userId } }, select: { id: true } });
    if (!target) throw new FeedbackServiceError('NOT_FOUND', 'The feedback target is unavailable.');
  } else if (input.targetType === 'ITEM' || input.targetType === 'REVIEW') {
    const target = input.targetType === 'ITEM'
      ? await prisma.businessAssistantRunItem.findFirst({ where: { id: input.targetId, tenantId: actor.tenantId, run: { ownerId: actor.userId } }, select: { id: true } })
      : await prisma.businessAssistantReview.findFirst({ where: { id: input.targetId, tenantId: actor.tenantId, runItem: { run: { ownerId: actor.userId } } }, select: { id: true } });
    if (!target) throw new FeedbackServiceError('NOT_FOUND', 'The feedback target is unavailable.');
  } else {
    const target = await prisma.businessAssistantMemory.findFirst({ where: { id: input.targetId, tenantId: actor.tenantId, ownerId: actor.userId }, select: { id: true } });
    if (!target) throw new FeedbackServiceError('NOT_FOUND', 'The feedback target is unavailable.');
  }
}

function toFeedbackDto(feedback: { id: string; targetType: string; targetId: string; eventType: string; comment: string | null; adjudication: string; createdAt: Date }): FeedbackDto {
  return { ...feedback, createdAt: feedback.createdAt.toISOString() };
}

export class FeedbackServiceError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'FORBIDDEN' | 'NOT_FOUND' | 'ACTION_CONFLICT', message: string) {
    super(message);
    this.name = 'FeedbackServiceError';
  }
}
