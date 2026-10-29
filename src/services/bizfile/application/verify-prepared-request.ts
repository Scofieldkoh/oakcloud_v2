import { prisma } from '@/lib/prisma';
import { assertBizFileChangePlan, hashBizFileValue, type BizFileChangePlan } from '../change-plan';
import { BizFilePreparationTokenError, verifyBizFilePreparationToken } from './preparation-token';

/** HTTP callers must present server-prepared content. An expired signature can
 * only recover an already committed, identical operation; it cannot authorize
 * a new write. Canonical services separately check current authorization. */
export async function verifyPreparedBizFileRequest(input: {
  plan: unknown; token: unknown; operationId: unknown; actorId: string;
  tenantId: string; documentId: string; taskContext: unknown;
}): Promise<{ plan: BizFileChangePlan; operationId: string }> {
  if (typeof input.operationId !== 'string' || !input.operationId.trim() || input.operationId.length > 200 || !input.plan) {
    throw new BizFilePreparationTokenError('INVALID_PREPARATION');
  }
  const plan = input.plan as BizFileChangePlan;
  try { assertBizFileChangePlan(plan); } catch { throw new BizFilePreparationTokenError('INVALID_PREPARATION'); }
  if (plan.tenantId !== input.tenantId || plan.documentId !== input.documentId) throw new BizFilePreparationTokenError('INVALID_PREPARATION');
  const now = Date.now();
  const { expiresAt } = verifyBizFilePreparationToken(input.token, {
    actorId: input.actorId, tenantId: input.tenantId, documentId: input.documentId,
    planHash: plan.canonicalHash, contextHash: hashBizFileValue(input.taskContext ?? null),
  }, now, { allowExpiredReceiptRead: true });
  if (expiresAt <= now) {
    const receipt = await prisma.bizFileOperationReceipt.findFirst({ where: {
      tenantId: input.tenantId, operationId: input.operationId, documentId: input.documentId,
      payloadHash: plan.canonicalHash, status: 'COMMITTED',
    }, select: { id: true } });
    if (!receipt) throw new BizFilePreparationTokenError('EXPIRED_PREPARATION');
  }
  return { plan, operationId: input.operationId };
}
