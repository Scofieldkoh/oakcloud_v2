import { describe, expect, it, vi } from 'vitest';
import {
  bizFileOperationAdvisoryKey,
  reconcileBizFileOperation,
  type BizFileOperationReceiptSnapshot,
} from '@/services/bizfile/application/operation-reconciliation';

function receipt(status: BizFileOperationReceiptSnapshot['status'], operationId = 'operation-1'): BizFileOperationReceiptSnapshot {
  return {
    id: `receipt-${operationId}`,
    tenantId: 'tenant-1',
    operationId,
    status,
    mode: 'UPDATE',
    companyId: 'company-1',
    documentId: 'document-1',
    payloadHash: 'a'.repeat(64),
    expectedAggregateRevision: 3,
    beforeRevision: 3,
    afterRevision: 4,
    effectStatus: 'PENDING',
    evidence: [{ kind: 'AFTER', artifact: { selectedChanges: [{ id: 'change-1' }] }, artifactHash: 'b'.repeat(64), sourceRef: null }],
    effects: [{ effectKind: 'PAGE_PREPARATION', target: 'document:document-1', payload: null, payloadHash: null, state: 'PENDING' }],
  };
}

function database(options: {
  locks?: boolean[];
  operationReceipt?: BizFileOperationReceiptSnapshot | null;
  claim?: { id: string } | null;
  queryError?: Error;
} = {}) {
  const locks = [...(options.locks ?? [true])];
  const queryRaw = vi.fn(async () => {
    if (options.queryError) throw options.queryError;
    return [{ locked: locks.shift() ?? true }];
  });
  const findReceipt = vi.fn().mockResolvedValue(options.operationReceipt ?? null);
  const findClaim = vi.fn().mockResolvedValue(options.claim ?? null);
  const tx = {
    $queryRawUnsafe: queryRaw,
    bizFileOperationReceipt: { findUnique: findReceipt },
    businessAssistantRunItem: { findFirst: findClaim },
  };
  const transaction = vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx));
  return { client: { $transaction: transaction }, transaction, queryRaw, findReceipt, findClaim };
}

const claim = { runItemId: 'item-1', claimToken: 'claim-1', claimGeneration: 2 };

describe('BizFile operation reconciliation', () => {
  it('uses the exact writer advisory key', () => {
    expect(bizFileOperationAdvisoryKey('tenant-1', 'operation-1')).toBe('oakcloud:bizfile:operation:tenant-1:operation-1');
  });

  it('proves NO_COMMIT only after the same operation gate settles and the claim is current', async () => {
    const db = database({ locks: [false, true], claim: { id: claim.runItemId } });
    const result = await reconcileBizFileOperation({ tenantId: 'tenant-1', operationId: 'operation-1', claim, maxWaitMs: 50, pollIntervalMs: 1 }, db.client as never);

    expect(result).toEqual({ status: 'NO_COMMIT', receipt: null });
    expect(db.queryRaw).toHaveBeenCalledTimes(2);
    expect(db.findReceipt).toHaveBeenCalledTimes(1);
    expect(db.findClaim).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: claim.runItemId,
        tenantId: 'tenant-1',
        operationId: 'operation-1',
        claimToken: claim.claimToken,
        claimGeneration: claim.claimGeneration,
      }),
    }));
  });

  it('keeps a missing receipt UNKNOWN when no claim can fence a delayed writer', async () => {
    const db = database();
    const result = await reconcileBizFileOperation({ tenantId: 'tenant-1', operationId: 'operation-1', maxWaitMs: 0 }, db.client as never);

    expect(result).toEqual({ status: 'UNKNOWN', receipt: null, reason: 'CLAIM_CONTEXT_UNAVAILABLE' });
  });

  it('keeps a missing receipt UNKNOWN when the current claim was fenced', async () => {
    const db = database({ claim: null });
    const result = await reconcileBizFileOperation({ tenantId: 'tenant-1', operationId: 'operation-1', claim, maxWaitMs: 0 }, db.client as never);

    expect(result).toEqual({ status: 'UNKNOWN', receipt: null, reason: 'CLAIM_FENCED' });
  });

  it('returns UNKNOWN when an earlier writer holds the gate past the bound', async () => {
    const db = database({ locks: [false] });
    const result = await reconcileBizFileOperation({ tenantId: 'tenant-1', operationId: 'operation-1', claim, maxWaitMs: 0 }, db.client as never);

    expect(result).toEqual({ status: 'UNKNOWN', receipt: null, reason: 'LOCK_TIMEOUT' });
    expect(db.findReceipt).not.toHaveBeenCalled();
  });

  it('returns an unresolved receipt as UNKNOWN without treating it as a retry permit', async () => {
    const db = database({ operationReceipt: receipt('UNKNOWN') });
    const result = await reconcileBizFileOperation({ tenantId: 'tenant-1', operationId: 'operation-1', claim, maxWaitMs: 0 }, db.client as never);

    expect(result.status).toBe('UNKNOWN');
    expect(result.reason).toBe('RECEIPT_UNRESOLVED');
    expect(result.receipt?.status).toBe('UNKNOWN');
    expect(db.findClaim).not.toHaveBeenCalled();
  });

  it('returns committed durable evidence and effect intents without write methods', async () => {
    const db = database({ operationReceipt: receipt('COMMITTED') });
    const result = await reconcileBizFileOperation({ tenantId: 'tenant-1', operationId: 'operation-1', claim, maxWaitMs: 0 }, db.client as never);

    expect(result.status).toBe('COMMITTED');
    expect(result.receipt).toMatchObject({
      status: 'COMMITTED',
      companyId: 'company-1',
      effectStatus: 'PENDING',
      evidence: [{ kind: 'AFTER' }],
      effects: [{ effectKind: 'PAGE_PREPARATION', state: 'PENDING' }],
    });
    expect(db.findClaim).not.toHaveBeenCalled();
  });

  it('reconciles a correction by its new operation identity on every recovery attempt', async () => {
    const correctionOperationId = 'correction-operation';
    const sourceOperationId = 'source-operation';
    const db = database({ operationReceipt: receipt('COMMITTED', correctionOperationId) });

    const first = await reconcileBizFileOperation({ tenantId: 'tenant-1', operationId: correctionOperationId, claim, maxWaitMs: 0 }, db.client as never);
    const second = await reconcileBizFileOperation({ tenantId: 'tenant-1', operationId: correctionOperationId, claim, maxWaitMs: 0 }, db.client as never);

    expect(first).toEqual(second);
    expect(first.receipt).toMatchObject({ operationId: correctionOperationId, id: `receipt-${correctionOperationId}` });
    expect(first.receipt?.operationId).not.toBe(sourceOperationId);
    expect(db.findReceipt).toHaveBeenCalledTimes(2);
    for (const call of db.findReceipt.mock.calls) {
      expect(call[0]).toEqual({
        where: { tenantId_operationId: { tenantId: 'tenant-1', operationId: correctionOperationId } },
        select: expect.any(Object),
      });
    }
    expect(db.findClaim).not.toHaveBeenCalled();
  });

  it('converts database failures to UNKNOWN', async () => {
    const db = database({ queryError: new Error('database unavailable') });
    const result = await reconcileBizFileOperation({ tenantId: 'tenant-1', operationId: 'operation-1', claim, maxWaitMs: 0 }, db.client as never);

    expect(result).toEqual({ status: 'UNKNOWN', receipt: null, reason: 'DATABASE_UNAVAILABLE' });
  });
});
