import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBizFileChangePlan, hashBizFileValue } from '@/services/bizfile/change-plan';

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), operational: vi.fn(), document: vi.fn(), receipt: vi.fn(), download: vi.fn(), review: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  document: { findFirst: mocks.document },
  bizFileOperationReceipt: { findFirst: mocks.receipt, findUnique: mocks.receipt },
} }));
vi.mock('@/lib/storage', () => ({ storage: { download: mocks.download } }));
vi.mock('@/lib/fresh-authorization', () => ({ evaluateFreshAuthorization: mocks.authorize }));
vi.mock('@/services/business-assistant/policy.service', () => ({ assertAssistantWorkspaceOperational: mocks.operational }));
vi.mock('@/services/bizfile/application/independent-source-review', () => ({ assessBizFileIndependentSourceReview: mocks.review }));
vi.mock('@/services/bizfile/processor', () => ({ processBizFileExtraction: vi.fn(), processBizFileExtractionSelective: vi.fn() }));

import { assistantCapabilities } from '@/services/bizfile/assistant-capabilities';

const source = { documentId: 'document', storageKey: 'tenant/pending/document.pdf', mimeType: 'application/pdf', version: 1, sourceRevision: 0, sourceHash: 'a'.repeat(64) };
const plan = buildBizFileChangePlan({ mode: 'CREATE', tenantId: 'tenant', documentId: 'document', sourceHash: source.sourceHash, sourceVersion: 0,
  reviewedData: { entityDetails: { name: 'Example Pte Ltd', uen: '202600001A', entityType: 'PRIVATE_LIMITED', status: 'LIVE' } } });
const output = { operationId: 'operation', companyId: 'company', created: true, effectStatus: 'COMPLETE', selectedChangeIds: plan.selectedChangeIds, plan,
  receipt: { receiptType: 'BizFileOperationReceipt', receiptId: 'receipt', operationId: 'operation', status: 'COMMITTED', payloadHash: plan.canonicalHash } };
const context = { actor: { tenantId: 'tenant', userId: 'user', requestId: 'request', source: 'BUSINESS_ASSISTANT' }, resources: [] };
const review = () => assistantCapabilities[0].review({ items: [{ status: 'ELIGIBLE', input: { plan, source } }] }, output,
  { companyId: 'company', aggregateRevision: 1, baseline: { company: { name: 'Example Pte Ltd' } }, observedAt: new Date().toISOString() }, context);

describe('independent source review dispatch boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'true');
    mocks.authorize.mockResolvedValue({ allowed: true });
    mocks.operational.mockResolvedValue({ allowed: true });
    mocks.document.mockResolvedValue({ id: 'document', companyId: 'company', storageKey: `tenant/companies/company/documents/document/original-${source.sourceHash}.pdf`, mimeType: source.mimeType });
    const artifact = { ...source, sourceVersion: 0, sourceRevision: 1 };
    mocks.receipt.mockResolvedValue({ id: 'receipt', tenantId: 'tenant', operationId: 'operation', documentId: 'document', companyId: 'company', status: 'COMMITTED', payloadHash: plan.canonicalHash,
      evidence: [{ kind: 'SOURCE', artifact, artifactHash: hashBizFileValue(artifact), sourceRef: { documentId: source.documentId, sourceVersion: 0 } }] });
    mocks.download.mockResolvedValue(Buffer.from('retained original'));
    mocks.review.mockResolvedValue({ verdict: 'NEEDS_REVIEW', executionConformance: 'PASS', sourceAlignment: 'INCOMPLETE', findings: [], coverage: { complete: false } });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('reviews retained original bytes after the current pointer was finalized', async () => {
    const result = await review();
    expect(mocks.download).toHaveBeenCalledWith(source.storageKey);
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({
      sourceBytes: new Uint8Array(Buffer.from('retained original')), expectedSourceHash: source.sourceHash,
      extractionOptions: expect.objectContaining({ tenantId: 'tenant', userId: 'user', documentId: 'document' }),
    }));
    expect(result.verdict).toBe('NEEDS_REVIEW');
  });

  it('does not read bytes or dispatch extraction after source access is revoked', async () => {
    mocks.authorize.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    expect((await review()).verdict).toBe('NEEDS_REVIEW');
    expect(mocks.authorize).toHaveBeenCalledTimes(2);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it('does not dispatch extraction when provider work is disabled', async () => {
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'false');
    expect((await review()).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PROVIDER_DISABLED' })]));
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it('does not dispatch extraction while the workspace is paused', async () => {
    mocks.operational.mockRejectedValue(new Error('workspace restoring'));
    expect((await review()).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'WORKSPACE_PAUSED' })]));
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it.each(['provider', 'source', 'pause'])('rechecks %s policy before subsequent provider dispatch', async (gate) => {
    await review();
    const beforeDispatch = mocks.review.mock.calls[0][0].beforeProviderDispatch as () => Promise<void>;
    await expect(beforeDispatch()).resolves.toBeUndefined();
    if (gate === 'provider') vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'false');
    if (gate === 'source') mocks.authorize.mockResolvedValue({ allowed: false });
    if (gate === 'pause') mocks.operational.mockRejectedValue(new Error('workspace restoring'));
    await expect(beforeDispatch()).rejects.toThrow();
  });
});
