import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  txFindFirst: vi.fn(),
  txDelete: vi.fn(),
  deletePrefix: vi.fn(),
  createAuditLog: vi.fn(),
  captureStages: vi.fn(),
  reconcileStages: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    generatedDocument: { findFirst: mocks.findFirst },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
      generatedDocument: { findFirst: mocks.txFindFirst, delete: mocks.txDelete },
    })),
  },
}));
vi.mock('@/lib/audit', () => ({ createAuditLog: mocks.createAuditLog }));
vi.mock('@/lib/storage', () => ({
  storage: { deletePrefix: mocks.deletePrefix },
  StorageKeys: {
    generatedDocumentPrefix: (tenantId: string, documentId: string) => `${tenantId}/generated-documents/${documentId}/`,
  },
}));
vi.mock('@/services/tasks/integration.service', () => ({
  safelyCaptureGeneratedDocumentTaskStageIds: mocks.captureStages,
  safelyReconcileTaskStageIds: mocks.reconcileStages,
}));

import { permanentlyDeleteGeneratedDocument } from '@/services/generated-document-purge.service';

const params = { tenantId: 'workspace-1', userId: 'user-1' };

function finalizedDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    tenantId: 'workspace-1',
    companyId: 'company-1',
    title: 'Board resolution',
    status: 'FINALIZED',
    deletedAt: null,
    serviceAgreement: null,
    esigningEnvelopeDocuments: [],
    ...overrides,
  };
}

describe('permanentlyDeleteGeneratedDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({ id: 'doc-1' });
    mocks.captureStages.mockResolvedValue(['stage-1']);
    mocks.deletePrefix.mockResolvedValue(2);
  });

  it('hard deletes a finalized document, its stored files and audits it', async () => {
    mocks.txFindFirst.mockResolvedValue(finalizedDocument({
      esigningEnvelopeDocuments: [{ envelope: { id: 'env-1', title: 'Resolution', status: 'COMPLETED' } }],
    }));

    const result = await permanentlyDeleteGeneratedDocument('doc-1', params, 'Duplicate generated in error');

    expect(mocks.txDelete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
    expect(mocks.deletePrefix).toHaveBeenCalledWith('workspace-1/generated-documents/doc-1/');
    expect(result).toEqual({
      id: 'doc-1',
      title: 'Board resolution',
      removedServiceAgreementId: null,
      unlinkedEnvelopeIds: ['env-1'],
    });
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE',
      entityId: 'doc-1',
      summary: 'Permanently deleted document "Board resolution"',
      reason: 'Duplicate generated in error',
      metadata: expect.objectContaining({ permanent: true, status: 'FINALIZED' }),
    }));
    expect(mocks.reconcileStages).toHaveBeenCalledWith('workspace-1', ['stage-1'], 'user-1');
  });

  it('refuses a document that is out for signature', async () => {
    mocks.txFindFirst.mockResolvedValue(finalizedDocument({
      esigningEnvelopeDocuments: [{ envelope: { id: 'env-1', title: 'Resolution', status: 'SENT' } }],
    }));

    await expect(permanentlyDeleteGeneratedDocument('doc-1', params, 'Duplicate generated in error'))
      .rejects.toThrow('out for signature in envelope "Resolution"');
    expect(mocks.txDelete).not.toHaveBeenCalled();
    expect(mocks.deletePrefix).not.toHaveBeenCalled();
  });

  it('refuses a service agreement with client services created from it', async () => {
    mocks.txFindFirst.mockResolvedValue(finalizedDocument({
      serviceAgreement: { id: 'sa-1', status: 'DRAFT', _count: { clientServices: 2 } },
    }));

    await expect(permanentlyDeleteGeneratedDocument('doc-1', params, 'Duplicate generated in error'))
      .rejects.toThrow('2 client services created from it');
    expect(mocks.txDelete).not.toHaveBeenCalled();
  });

  it('refuses a service agreement that is in effect', async () => {
    mocks.txFindFirst.mockResolvedValue(finalizedDocument({
      serviceAgreement: { id: 'sa-1', status: 'EFFECTIVE', _count: { clientServices: 0 } },
    }));

    await expect(permanentlyDeleteGeneratedDocument('doc-1', params, 'Duplicate generated in error'))
      .rejects.toThrow('in effect');
  });

  it('removes a draft service agreement along with its document', async () => {
    mocks.txFindFirst.mockResolvedValue(finalizedDocument({
      serviceAgreement: { id: 'sa-1', status: 'DRAFT', _count: { clientServices: 0 } },
    }));

    const result = await permanentlyDeleteGeneratedDocument('doc-1', params, 'Duplicate generated in error');
    expect(result.removedServiceAgreementId).toBe('sa-1');
  });

  it('is scoped to the workspace', async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(permanentlyDeleteGeneratedDocument('doc-1', params, 'Duplicate generated in error'))
      .rejects.toThrow('Document not found');
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'doc-1', tenantId: 'workspace-1' },
    }));
  });
});
