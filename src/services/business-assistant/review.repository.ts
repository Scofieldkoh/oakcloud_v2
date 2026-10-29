import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import type { ClaimedItem } from './claim.repository';
import type { JsonValue, ReviewResult } from './contracts';

/** Store review evidence and settle its item under one current-claim fence. */
export async function recordClaimedReview(input: {
  claim: Pick<ClaimedItem, 'id' | 'tenantId' | 'token' | 'generation'>;
  reviewed: ReviewResult;
  snapshot: JsonValue;
  observedAt: string;
  effectStatus: 'NOT_REQUIRED' | 'PENDING' | 'COMPLETE' | 'FAILED';
  output: JsonValue | null;
  schemaVersion: string;
  promptVersion: string;
}): Promise<boolean> {
  const { claim, reviewed } = input;
  return runSerializableTransaction(prisma, async (tx) => {
    const updated = await tx.businessAssistantRunItem.updateMany({
      where: { id: claim.id, tenantId: claim.tenantId, claimToken: claim.token,
        claimGeneration: claim.generation, leaseExpiresAt: { gt: new Date() }, executionOutcome: 'COMMITTED', lifecycleState: 'EXECUTING' },
      data: {
        lifecycleState: reviewed.verdict === 'PASS' ? 'PASSED' : reviewed.verdict === 'PASS_WITH_WARNINGS' ? 'PASSED_WITH_WARNINGS' : 'NEEDS_REVIEW',
        requiredEffectStatus: input.effectStatus, reviewOutcome: reviewed.verdict,
        activeStage: null, output: input.output === null ? Prisma.JsonNull : input.output as Prisma.InputJsonValue,
        availableAt: new Date(),
      },
    });
    if (updated.count !== 1) return false;
    const prior = await tx.businessAssistantReview.findFirst({
      where: { tenantId: claim.tenantId, runItemId: claim.id }, orderBy: { attemptNumber: 'desc' }, select: { attemptNumber: true },
    });
    await tx.businessAssistantReview.create({ data: {
      tenantId: claim.tenantId, runItemId: claim.id, attemptNumber: (prior?.attemptNumber ?? 0) + 1,
      verdict: reviewed.verdict, executionConformance: reviewed.executionConformance, sourceAlignment: reviewed.sourceAlignment,
      evidence: { snapshot: input.snapshot, observedAt: input.observedAt } as Prisma.InputJsonValue,
      findings: reviewed.findings as Prisma.InputJsonValue, coverage: reviewed.coverage as Prisma.InputJsonValue,
      schemaVersion: input.schemaVersion, promptVersion: input.promptVersion,
    } });
    return true;
  });
}
