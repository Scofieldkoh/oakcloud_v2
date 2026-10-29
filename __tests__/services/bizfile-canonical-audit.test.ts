import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ audit: vi.fn(), apply: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@/lib/audit', () => ({ createAuditLog: mocks.audit }));
vi.mock('@/services/bizfile/canonical-sync', () => ({ applyBizFileChangePlanInTransaction: mocks.apply }));
vi.mock('@/services/document-processing.service', () => ({ prepareDocumentPages: vi.fn() }));
vi.mock('@/lib/storage', () => ({ storage: {} }));
import { buildBizFileChangePlan } from '@/services/bizfile/change-plan';
import { processBizFileExtraction } from '@/services/bizfile/processor';

const data = { entityDetails: { name: 'Example Pte Ltd', uen: '202600001A', entityType: 'PRIVATE_LIMITED', status: 'LIVE' } };
const plan = buildBizFileChangePlan({ mode: 'CREATE', documentId: 'document', tenantId: 'tenant', reviewedData: data });
const receipt = { id: 'receipt', tenantId: 'tenant', operationId: 'operation', status: 'COMMITTED' as const,
  mode: 'CREATE' as const, companyId: 'company', documentId: 'document', expectedAggregateRevision: 0,
  beforeRevision: 0, afterRevision: 1, effectStatus: 'NOT_REQUIRED' as const, fresh: true };
const repository = { begin: vi.fn(), commit: vi.fn(), evidence: vi.fn(), effect: vi.fn() };
const tx = {
  company: { findFirst: vi.fn().mockResolvedValue({ id: 'company', aggregateRevision: 1 }) },
  document: {
    findFirst: vi.fn().mockResolvedValue({ sourceRevision: 0 }),
    findUnique: vi.fn().mockResolvedValue({ sourceRevision: 1, storageKey: 'tenant/pending/document.pdf', mimeType: 'application/pdf' }),
    update: vi.fn(),
  },
  processingDocument: { findUnique: vi.fn().mockResolvedValue({ id: 'processing' }), update: vi.fn() },
  documentRevision: { create: vi.fn().mockResolvedValue({ id: 'revision' }) },
};
const execute = () => processBizFileExtraction('document', data, 'user', 'tenant', undefined, undefined, undefined, plan,
  { operationId: 'operation', operationRepository: repository });

describe('canonical BizFile summary audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (run: (client: unknown) => unknown) => run(tx));
    repository.begin.mockResolvedValue(receipt);
    mocks.apply.mockResolvedValue({ companyId: 'company', created: true, beforeRevision: 0, afterRevision: 1,
      changedSections: [], selectedChanges: [], operationStatus: 'COMMITTED' });
    mocks.audit.mockResolvedValue({ id: 'audit' });
  });

  it('writes summary audit with the mutation transaction and persisted revision', async () => {
    await execute();
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      entityId: 'company', metadata: expect.objectContaining({ operationId: 'operation', receiptId: 'receipt', afterRevision: 1 }),
    }), tx);
  });

  it('renames the approved BizFile from its upload name to the readable BizFile name', async () => {
    tx.document.findUnique.mockResolvedValueOnce({
      fileName: '1036ae32-5a85-412d-902f-b5c2c925afb6.pdf',
      originalFileName: 'acra profile.PDF',
      storageKey: 'tenant/pending/1036ae32-5a85-412d-902f-b5c2c925afb6.pdf',
    });
    await processBizFileExtraction('document',
      { ...data, documentMetadata: { receiptNo: 'ACRA250322001', receiptDate: '2025-03-22' } },
      'user', 'tenant', undefined, undefined, undefined, plan, { operationId: 'operation', operationRepository: repository });
    expect(tx.document.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { id: 'document' },
      data: expect.objectContaining({ fileName: 'BizFile_2025-03-22_ACRA_ACRA250322001.pdf' }),
    }));
  });

  it('propagates audit failure through the transaction instead of returning success', async () => {
    mocks.audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(execute()).rejects.toThrow('audit unavailable');
    // Approval now runs earlier in the same transaction so its actual source
    // revision can be recorded. Audit failure must still reject that boundary.
    expect(tx.document.update).toHaveBeenCalledTimes(1);
    await expect(mocks.transaction.mock.results[0].value).rejects.toThrow('audit unavailable');
  });

  it('does not create another summary audit or mutation when replaying a committed receipt', async () => {
    repository.begin.mockResolvedValue({ ...receipt, fresh: false });
    await execute();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(tx.document.update).not.toHaveBeenCalled();
  });
});
