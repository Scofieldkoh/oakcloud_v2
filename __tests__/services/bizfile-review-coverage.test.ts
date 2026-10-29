import { describe, expect, it, vi } from 'vitest';
import { buildBizFileChangePlan } from '@/services/bizfile/change-plan';
import { assistantCapabilities } from '@/services/bizfile/assistant-capabilities';

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), companyRead: vi.fn(), reconcile: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { company: { findFirst: mocks.companyRead } } }));
vi.mock('@/lib/fresh-authorization', () => ({ evaluateFreshAuthorization: mocks.authorize }));
vi.mock('@/services/bizfile/application/operation-reconciliation', () => ({ reconcileBizFileOperation: mocks.reconcile }));
vi.mock('@/services/bizfile/processor', () => ({ processBizFileExtraction: vi.fn(), processBizFileExtractionSelective: vi.fn() }));

describe('BizFile review coverage', () => {
  it('accepts reconstructed committed output at the adapter output boundary', async () => {
    mocks.reconcile.mockResolvedValue({ status: 'COMMITTED', receipt: {
      id: 'receipt', operationId: 'operation', status: 'COMMITTED', payloadHash: 'a'.repeat(64),
      companyId: 'company', mode: 'UPDATE', beforeRevision: 1, afterRevision: 4, effectStatus: 'PENDING',
      evidence: [{ kind: 'AFTER', artifact: { selectedChanges: [{ id: 'change' }] } }], effects: [],
    } });
    const result = await assistantCapabilities[0].reconcile('operation', {
      actor: { tenantId: 'tenant', userId: 'user', requestId: 'request', source: 'BUSINESS_ASSISTANT' }, resources: [],
    });
    expect(result.status).toBe('COMMITTED');
    expect(result.effectStatus).toBe('PENDING');
    expect(assistantCapabilities[0].outputSchema.safeParse(result.output).success).toBe(true);
  });
  it('does not read company evidence after access has been revoked', async () => {
    mocks.authorize.mockResolvedValue({ allowed: false });
    await expect(assistantCapabilities[0].readBack({ companyId: 'company' }, {
      actor: { tenantId: 'tenant', userId: 'user', requestId: 'request', source: 'BUSINESS_ASSISTANT' }, resources: [],
    })).rejects.toThrow('access is no longer available');
    expect(mocks.companyRead).not.toHaveBeenCalled();
  });
  it('never certifies original-source agreement from a matching receipt and advanced revision alone', async () => {
    const plan = buildBizFileChangePlan({ mode: 'CREATE', tenantId: 'tenant', documentId: 'document',
      reviewedData: { entityDetails: { name: 'Example Pte Ltd', uen: '202600001A', entityType: 'PRIVATE_LIMITED', status: 'LIVE' } } });
    const output = { operationId: 'operation', companyId: 'company', created: true, effectStatus: 'COMPLETE', selectedChangeIds: plan.selectedChangeIds, plan,
      receipt: { receiptType: 'BizFileOperationReceipt', receiptId: 'receipt', operationId: 'operation', status: 'COMMITTED', payloadHash: plan.canonicalHash } };
    expect(assistantCapabilities[0].outputSchema.safeParse(output).success).toBe(true);
    const result = await assistantCapabilities[0].review({ items: [{ status: 'ELIGIBLE', input: { plan } }] }, output,
      { companyId: 'company', aggregateRevision: 1, baseline: {}, observedAt: new Date().toISOString() },
      { actor: { tenantId: 'tenant', userId: 'user', requestId: 'request', source: 'BUSINESS_ASSISTANT' }, resources: [] });
    expect(result).toMatchObject({ verdict: 'NEEDS_REVIEW', executionConformance: 'UNVERIFIABLE', sourceAlignment: 'INCOMPLETE',
      coverage: { complete: false, originalSourceReviewed: false, selectedFieldsReviewed: false } });
  });
});
