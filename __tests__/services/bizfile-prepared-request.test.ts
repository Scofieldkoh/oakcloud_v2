import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBizFileChangePlan, hashBizFileValue } from '@/services/bizfile/change-plan';
import { issueBizFilePreparationToken } from '@/services/bizfile/application/preparation-token';
import { verifyPreparedBizFileRequest } from '@/services/bizfile/application/verify-prepared-request';

const { findReceipt } = vi.hoisted(() => ({ findReceipt: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { bizFileOperationReceipt: { findFirst: findReceipt } } }));

describe('prepared BizFile request recovery', () => {
  const issuedAt = Date.UTC(2026, 8, 7);
  const plan = buildBizFileChangePlan({ mode: 'CREATE', tenantId: 'tenant', documentId: 'document',
    reviewedData: { entityDetails: { name: 'Example Pte Ltd', uen: '202600001A', entityType: 'PRIVATE_LIMITED', status: 'LIVE' } } });
  beforeEach(() => {
    vi.stubEnv('BUSINESS_ASSISTANT_PREPARATION_SECRET', 'test-only-preparation-signing-secret-32-characters');
    vi.spyOn(Date, 'now').mockReturnValue(issuedAt);
    findReceipt.mockReset(); findReceipt.mockResolvedValue(null);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  function input() {
    const { token } = issueBizFilePreparationToken({ actorId: 'actor', tenantId: 'tenant', documentId: 'document',
      planHash: plan.canonicalHash, contextHash: hashBizFileValue(null) }, issuedAt);
    return { plan, token, operationId: 'original-operation', actorId: 'actor', tenantId: 'tenant', documentId: 'document', taskContext: null };
  }

  it('accepts an unexpired prepared operation without consulting an old receipt', async () => {
    await expect(verifyPreparedBizFileRequest(input())).resolves.toMatchObject({ operationId: 'original-operation', plan });
    expect(findReceipt).not.toHaveBeenCalled();
  });
  it('rejects an expired proposal when no committed receipt exists', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(issuedAt + 30 * 60_000);
    await expect(verifyPreparedBizFileRequest(input())).rejects.toThrow('expired');
  });
  it('permits expired-token recovery only by querying the exact committed operation and payload', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(issuedAt + 30 * 60_000);
    findReceipt.mockResolvedValue({ id: 'committed-receipt' });
    await expect(verifyPreparedBizFileRequest(input())).resolves.toMatchObject({ operationId: 'original-operation' });
    expect(findReceipt).toHaveBeenCalledWith({ where: { tenantId: 'tenant', operationId: 'original-operation', documentId: 'document',
      payloadHash: plan.canonicalHash, status: 'COMMITTED' }, select: { id: true } });
  });
  it('never looks up receipt evidence for a forged signature', async () => {
    await expect(verifyPreparedBizFileRequest({ ...input(), token: 'forged.signature' })).rejects.toThrow('does not match');
    expect(findReceipt).not.toHaveBeenCalled();
  });
  it('requires an explicit bounded operation identity', async () => {
    await expect(verifyPreparedBizFileRequest({ ...input(), operationId: '' })).rejects.toThrow('does not match');
    await expect(verifyPreparedBizFileRequest({ ...input(), operationId: 'x'.repeat(201) })).rejects.toThrow('does not match');
  });
});
