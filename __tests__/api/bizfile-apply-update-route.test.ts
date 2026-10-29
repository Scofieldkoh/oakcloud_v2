import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBizFileChangePlan, hashBizFileValue } from '@/services/bizfile/change-plan';
import { issueBizFilePreparationToken } from '@/services/bizfile/application/preparation-token';
import { bizFileReviewSchema, normalizeBizFileReviewDraft } from '@/lib/validations/bizfile-review';

const { auth, document, company, processUpdate } = vi.hoisted(() => ({ auth: vi.fn(), document: vi.fn(), company: vi.fn(), processUpdate: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAuth: auth }));
vi.mock('@/lib/prisma', () => ({ prisma: { document: { findUnique: document }, company: { findUnique: company } } }));
vi.mock('@/services/bizfile', async () => ({ processBizFileExtractionSelective: processUpdate,
  hashBizFileValue: (await import('@/services/bizfile/change-plan')).hashBizFileValue }));

import { POST } from '@/app/api/documents/[documentId]/apply-update/route';

describe('BizFile update preparation contract', () => {
  const reviewedData = { entityDetails: { uen: '202600001A', name: 'New Pte Ltd', entityType: 'PRIVATE_LIMITED', status: 'LIVE' } };
  function body() {
    const plan = buildBizFileChangePlan({ mode: 'UPDATE', tenantId: 'tenant', documentId: 'document', targetCompanyId: 'company', reviewedData: normalizeBizFileReviewDraft(bizFileReviewSchema.parse(reviewedData)),
      baseline: { company: { id: 'company', name: 'Old Pte Ltd', uen: '202600001A', entityType: 'PRIVATE_LIMITED', status: 'LIVE' }, expectedAggregateRevision: 2 }, expectedAggregateRevision: 2 });
    const { token } = issueBizFilePreparationToken({ actorId: 'user', tenantId: 'tenant', documentId: 'document', planHash: plan.canonicalHash, contextHash: hashBizFileValue(null) });
    return { companyId: 'company', extractedData: plan.reviewedData, plan, operationId: 'operation', preparationToken: token };
  }
  function post(input: unknown) {
    return POST(new Request('http://localhost/api/documents/document/apply-update', { method: 'POST', body: JSON.stringify(input) }) as never,
      { params: Promise.resolve({ documentId: 'document' }) });
  }
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BUSINESS_ASSISTANT_PREPARATION_SECRET', 'test-only-preparation-signing-secret-32-characters');
    auth.mockResolvedValue({ id: 'user', tenantId: 'tenant', isSuperAdmin: false, isWorkspaceAdmin: true });
    document.mockResolvedValue({ id: 'document', tenantId: 'tenant', storageKey: 'tenant/source.pdf', mimeType: 'application/pdf', version: 1 });
    company.mockResolvedValue({ id: 'company', tenantId: 'tenant', name: 'Old Pte Ltd', uen: '202600001A', updatedAt: new Date() });
    processUpdate.mockResolvedValue({ companyId: 'company', created: false, updatedFields: ['identity'], officerChanges: { added: 0, updated: 0, ceased: 0, followUp: 0 }, shareholderChanges: { added: 0, updated: 0, removed: 0 } });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('passes the exact signed plan and stable operation to the canonical processor', async () => {
    const input = body(); const response = await post(input);
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(processUpdate).toHaveBeenCalledWith('document', expect.any(Object), 'user', 'tenant', 'company', undefined, undefined,
      input.plan, expect.objectContaining({ operationId: 'operation' }));
  });
  it.each(['preparationToken', 'plan', 'operationId'] as const)('rejects a request without %s', async (field) => {
    const input: Record<string, unknown> = body(); delete input[field];
    expect((await post(input)).status).toBe(409); expect(processUpdate).not.toHaveBeenCalled();
  });
  it('rejects reviewed data changed after preparation', async () => {
    const input = body(); input.extractedData = { ...input.extractedData, entityDetails: { ...input.extractedData.entityDetails, name: 'Unreviewed Pte Ltd' } };
    expect((await post(input)).status).toBe(409); expect(processUpdate).not.toHaveBeenCalled();
  });
  it('rejects officer actions added after the plan was signed', async () => {
    const response = await post({ ...body(), officerActions: [
      { officerId: 'unapproved-officer', action: 'cease', cessationDate: '2026-09-08' },
    ] });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Officer choices changed after preparation. Prepare them again.' });
    expect(processUpdate).not.toHaveBeenCalled();
  });
  it('does not expose a canonical processor failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    processUpdate.mockRejectedValue(new Error('private database credentials'));
    const response = await post(body()); expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
  });
});
