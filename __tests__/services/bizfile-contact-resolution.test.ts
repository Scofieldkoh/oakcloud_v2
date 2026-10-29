import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  companyFindFirst: vi.fn(),
  resolveOrCreateContact: vi.fn(),
  previewContactIdentity: vi.fn(),
  createCompanyContactRelation: vi.fn(),
  generateBizFileDiff: vi.fn(),
  createAuditLog: vi.fn(),
  recoveryUpsert: vi.fn(),
}));

const tx = {
  $executeRaw: vi.fn(),
  company: { upsert: vi.fn(), update: vi.fn() },
  document: { findUnique: vi.fn(), update: vi.fn() },
  companyFormerName: { deleteMany: vi.fn(), create: vi.fn() },
  companyAddress: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  shareCapital: { deleteMany: vi.fn(), create: vi.fn() },
  companyOfficer: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  companyShareholder: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  companyAuditor: { upsert: vi.fn(), deleteMany: vi.fn() },
  companyCharge: { deleteMany: vi.fn(), create: vi.fn() },
  auditLog: { createMany: vi.fn() },
  processingDocument: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  documentRevision: { create: vi.fn() },
  taskCompanyRecoveryContext: { upsert: mocks.recoveryUpsert },
  serviceScheduleReconciliationRequest: { findUnique: vi.fn(), upsert: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    company: { findFirst: mocks.companyFindFirst },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/services/contact-identity.service', () => ({
  resolveOrCreateContact: mocks.resolveOrCreateContact,
  previewContactIdentity: mocks.previewContactIdentity,
}));
vi.mock('@/services/contact.service', () => ({
  createCompanyContactRelation: mocks.createCompanyContactRelation,
}));
vi.mock('@/services/bizfile/diff', () => ({ generateBizFileDiff: mocks.generateBizFileDiff }));
vi.mock('@/lib/audit', () => ({ createAuditLog: mocks.createAuditLog }));
vi.mock('@/services/document-processing.service', () => ({ prepareDocumentPages: vi.fn() }));
vi.mock('@/lib/storage', () => ({ storage: {} }));

const officer = {
  name: '王小明', role: 'DIRECTOR', identificationType: 'NRIC',
  identificationNumber: 'S1234567A', nationality: 'Singaporean', address: '1 Main Street',
  contactResolution: { action: 'REUSE' as const, contactId: 'contact-existing' },
};
const shareholder = {
  name: 'Acme Holdings Pte. Ltd.', type: 'CORPORATE' as const,
  identificationType: 'UEN', identificationNumber: '202400001A', address: '2 Main Street',
  shareClass: 'ORDINARY', numberOfShares: 100,
  contactResolution: { action: 'CREATE_SEPARATE' as const, reason: 'Different legal entity in BizFile' },
};
const extractedData = {
  entityDetails: { uen: '202600001A', name: 'Example Pte. Ltd.', entityType: 'PRIVATE_LIMITED', status: 'LIVE' },
  officers: [officer], shareholders: [shareholder],
};
const taskContext = {
  taskId: '11111111-1111-4111-8111-111111111111',
  taskStageId: '22222222-2222-4222-8222-222222222222',
  returnTo: '/tasks/11111111-1111-4111-8111-111111111111',
};

describe('BizFile contact identity resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.companyFindFirst.mockResolvedValue(null);
    mocks.previewContactIdentity.mockResolvedValue(null);
    tx.company.upsert.mockResolvedValue({ id: 'company-1' });
    tx.$executeRaw.mockResolvedValue(0);
    tx.companyAddress.findFirst.mockResolvedValue(null);
    tx.processingDocument.create.mockResolvedValue({ id: 'processing-1' });
    tx.documentRevision.create.mockResolvedValue({ id: 'revision-1' });
    tx.processingDocument.findUnique.mockResolvedValue({ id: 'processing-existing' });
    tx.companyShareholder.findMany.mockResolvedValue([]);
    tx.serviceScheduleReconciliationRequest.findUnique.mockResolvedValue(null);
    tx.serviceScheduleReconciliationRequest.upsert.mockResolvedValue({ id: 'reconciliation-1' });
    mocks.resolveOrCreateContact
      .mockResolvedValueOnce({ contact: { id: 'contact-existing' } })
      .mockResolvedValueOnce({ contact: { id: 'contact-new-corporate' } });
  });

  it('stores task recovery context in the BizFile company create branch', async () => {
    const { processBizFileExtraction } = await import('@/services/bizfile/processor');
    await processBizFileExtraction(
      'doc-1',
      extractedData,
      'user-1',
      'tenant-1',
      undefined,
      undefined,
      taskContext,
    );

    expect(tx.company.update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { taskIntegrationContext: taskContext },
    });
  });

  it('stores task recovery context in the BizFile existing-company update branch', async () => {
    mocks.companyFindFirst.mockResolvedValue({ id: 'company-existing' });
    tx.company.upsert.mockResolvedValue({ id: 'company-existing' });
    const { processBizFileExtraction } = await import('@/services/bizfile/processor');
    await processBizFileExtraction(
      'doc-1',
      extractedData,
      'user-1',
      'tenant-1',
      undefined,
      undefined,
      taskContext,
    );

    expect(tx.company.update).toHaveBeenCalledWith({
      where: { id: 'company-existing' },
      data: { taskIntegrationContext: taskContext },
    });
  });

  it('stores task recovery context during a selective existing-company update', async () => {
    mocks.generateBizFileDiff.mockResolvedValue({
      hasDifferences: false,
      differences: [],
      officerDiffs: [],
      shareholderDiffs: [],
    });
    const { processBizFileExtractionSelective } = await import('@/services/bizfile/processor');
    await processBizFileExtractionSelective(
      'doc-1',
      extractedData,
      'user-1',
      'tenant-1',
      'company-1',
      undefined,
      taskContext,
    );

    expect(tx.company.update).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { taskIntegrationContext: taskContext },
    });
    expect(mocks.recoveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        companyId: 'company-1',
        taskId: taskContext.taskId,
        taskStageId: taskContext.taskStageId,
      }),
    }));
  });

  it('keeps task A and task B recovery associations for the same existing company', async () => {
    const taskBContext = {
      taskId: '33333333-3333-4333-8333-333333333333',
      taskStageId: '44444444-4444-4444-8444-444444444444',
    };
    mocks.companyFindFirst.mockResolvedValue({ id: 'company-existing' });
    tx.company.upsert.mockResolvedValue({ id: 'company-existing' });
    mocks.resolveOrCreateContact.mockResolvedValue({ contact: { id: 'contact-existing' } });
    const { processBizFileExtraction } = await import('@/services/bizfile/processor');

    await Promise.all([
      processBizFileExtraction(
        'doc-a', extractedData, 'user-1', 'tenant-1',
        undefined, undefined, taskContext,
      ),
      processBizFileExtraction(
        'doc-b', extractedData, 'user-1', 'tenant-1',
        undefined, undefined, taskBContext,
      ),
    ]);

    expect(mocks.recoveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId_taskStageId: {
          tenantId: 'tenant-1',
          taskStageId: taskContext.taskStageId,
        },
      },
    }));
    expect(mocks.recoveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId_taskStageId: {
          tenantId: 'tenant-1',
          taskStageId: taskBContext.taskStageId,
        },
      },
    }));
  });

  it('upserts the same recovery association idempotently under duplicate requests', async () => {
    mocks.companyFindFirst.mockResolvedValue({ id: 'company-existing' });
    tx.company.upsert.mockResolvedValue({ id: 'company-existing' });
    mocks.resolveOrCreateContact.mockResolvedValue({ contact: { id: 'contact-existing' } });
    const { processBizFileExtraction } = await import('@/services/bizfile/processor');

    await Promise.all([
      processBizFileExtraction(
        'doc-a', extractedData, 'user-1', 'tenant-1',
        undefined, undefined, taskContext,
      ),
      processBizFileExtraction(
        'doc-a', extractedData, 'user-1', 'tenant-1',
        undefined, undefined, taskContext,
      ),
    ]);

    const recoveryKeys = mocks.recoveryUpsert.mock.calls.map(([input]) => input.where);
    expect(recoveryKeys).toEqual([
      {
        tenantId_taskStageId: {
          tenantId: 'tenant-1',
          taskStageId: taskContext.taskStageId,
        },
      },
      {
        tenantId_taskStageId: {
          tenantId: 'tenant-1',
          taskStageId: taskContext.taskStageId,
        },
      },
    ]);
  });

  it('replaces Company A with Company B for the same task stage', async () => {
    mocks.companyFindFirst
      .mockResolvedValueOnce({ id: 'company-a' })
      .mockResolvedValueOnce({ id: 'company-b' });
    tx.company.upsert
      .mockResolvedValueOnce({ id: 'company-a' })
      .mockResolvedValueOnce({ id: 'company-b' });
    mocks.resolveOrCreateContact.mockResolvedValue({ contact: { id: 'contact-existing' } });
    const { processBizFileExtraction } = await import('@/services/bizfile/processor');

    await processBizFileExtraction(
      'doc-a', extractedData, 'user-1', 'tenant-1',
      undefined, undefined, taskContext,
    );
    await processBizFileExtraction(
      'doc-b', extractedData, 'user-1', 'tenant-1',
      undefined, undefined, taskContext,
    );

    expect(mocks.recoveryUpsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      update: expect.objectContaining({ companyId: 'company-a' }),
    }));
    expect(mocks.recoveryUpsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        tenantId_taskStageId: {
          tenantId: 'tenant-1',
          taskStageId: taskContext.taskStageId,
        },
      },
      update: expect.objectContaining({ companyId: 'company-b' }),
    }));
  });

  it('captures all available identity fields and decisions in the full new-company transaction', async () => {
    const { processBizFileExtraction } = await import('@/services/bizfile/processor');
    await processBizFileExtraction('doc-1', extractedData, 'user-1', 'tenant-1');

    expect(mocks.resolveOrCreateContact).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        source: 'BIZFILE', sourceRecordId: 'officers.0', contactType: 'INDIVIDUAL',
        firstName: '王小明', identificationType: 'NRIC', identificationNumber: 'S1234567A',
        nationality: 'Singaporean', fullAddress: '1 Main Street',
      }),
      { action: 'REUSE', contactId: 'contact-existing' },
      expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1', tx }),
    );
    expect(mocks.resolveOrCreateContact).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        source: 'BIZFILE', sourceRecordId: 'shareholders.0', contactType: 'CORPORATE',
        corporateName: 'Acme Holdings Pte. Ltd.', corporateUen: '202400001A', fullAddress: '2 Main Street',
      }),
      shareholder.contactResolution,
      expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1', tx }),
    );
  });

  it('takes the shared business barrier before the legacy company upsert', async () => {
    const { processBizFileExtraction } = await import('@/services/bizfile/processor');

    await processBizFileExtraction('doc-1', extractedData, 'user-1', 'tenant-1');

    const barrierQuery = tx.$executeRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(barrierQuery.sql).toContain('pg_advisory_xact_lock_shared');
    expect(barrierQuery.values).toEqual(['oakcloud:business-operation:tenant-1']);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.company.upsert.mock.invocationCallOrder[0],
    );
    expect(tx.company.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resolveOrCreateContact.mock.invocationCallOrder[0],
    );
  });

  it('uses the same resolver and transaction for added records in an existing company', async () => {
    mocks.generateBizFileDiff.mockResolvedValue({
      hasDifferences: true, differences: [],
      officerDiffs: [{ type: 'added', sourceRecordId: 'officers.0', extractedData: officer }],
      shareholderDiffs: [{ type: 'added', sourceRecordId: 'shareholders.0', extractedData: shareholder }],
    });
    const { processBizFileExtractionSelective } = await import('@/services/bizfile/processor');
    await processBizFileExtractionSelective('doc-1', extractedData, 'user-1', 'tenant-1', 'company-1');

    expect(mocks.resolveOrCreateContact).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ source: 'BIZFILE', sourceRecordId: 'officers.0', identificationNumber: 'S1234567A' }),
      officer.contactResolution,
      expect.objectContaining({ tenantId: 'tenant-1', tx }),
    );
    expect(mocks.resolveOrCreateContact).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ source: 'BIZFILE', sourceRecordId: 'shareholders.0', corporateUen: '202400001A' }),
      shareholder.contactResolution,
      expect.objectContaining({ tenantId: 'tenant-1', tx }),
    );
  });

  it('uses diff-provided source paths for duplicate existing-company rows', async () => {
    const duplicate = { ...officer, contactResolution: { action: 'REUSE' as const, contactId: 'contact-second' } };
    mocks.generateBizFileDiff.mockResolvedValue({
      hasDifferences: true, differences: [], shareholderDiffs: [],
      officerDiffs: [
        { type: 'added', sourceRecordId: 'officers.0', extractedData: officer },
        { type: 'added', sourceRecordId: 'officers.1', extractedData: duplicate },
      ],
    });
    mocks.resolveOrCreateContact
      .mockResolvedValueOnce({ contact: { id: 'contact-existing' } })
      .mockResolvedValueOnce({ contact: { id: 'contact-second' } });
    const { processBizFileExtractionSelective } = await import('@/services/bizfile/processor');
    await processBizFileExtractionSelective('doc-1', {
      ...extractedData, officers: [officer, duplicate], shareholders: [],
    }, 'user-1', 'tenant-1', 'company-1');

    expect(mocks.resolveOrCreateContact.mock.calls.map(([candidate]) => candidate.sourceRecordId))
      .toEqual(['officers.0', 'officers.1']);
    expect(tx.companyOfficer.create).toHaveBeenCalledTimes(2);
  });

  it('requires a per-record decision when a current review match exists', async () => {
    mocks.previewContactIdentity.mockResolvedValue({
      contactId: 'contact-existing', score: 1, automatic: true,
      blockedByIdentifierConflict: false, reasons: ['EXACT_CANONICAL_NAME'], conflicts: [],
    });
    const undecided = {
      ...extractedData,
      officers: [{ ...officer, contactResolution: undefined }],
      shareholders: [],
    };
    const { processBizFileExtraction } = await import('@/services/bizfile/processor');

    await expect(processBizFileExtraction('doc-1', undecided, 'user-1', 'tenant-1'))
      .rejects.toThrow('Review the contact match for officers.0 before continuing');
    expect(mocks.resolveOrCreateContact).not.toHaveBeenCalled();
    expect(tx.companyOfficer.create).not.toHaveBeenCalled();
  });

  it('reuses a contact created earlier in the same BizFile transaction without requiring an impossible review', async () => {
    const samePersonShareholder = {
      name: officer.name,
      type: 'INDIVIDUAL' as const,
      identificationType: officer.identificationType,
      identificationNumber: officer.identificationNumber,
      nationality: officer.nationality,
      address: officer.address,
      shareClass: 'ORDINARY',
      numberOfShares: 100,
    };
    mocks.previewContactIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        contactId: 'contact-created-in-import', score: 1, automatic: true,
        blockedByIdentifierConflict: false, reasons: ['IDENTIFIER'], conflicts: [],
      });
    mocks.resolveOrCreateContact
      .mockReset()
      .mockResolvedValueOnce({ contact: { id: 'contact-created-in-import' }, outcome: 'CREATED' })
      .mockResolvedValueOnce({ contact: { id: 'contact-created-in-import' }, outcome: 'REUSED_IDENTIFIER' });
    const undecidedDuplicate = {
      ...extractedData,
      officers: [{ ...officer, contactResolution: undefined }],
      shareholders: [samePersonShareholder],
    };
    const { processBizFileExtraction } = await import('@/services/bizfile/processor');

    await expect(processBizFileExtraction('doc-1', undecidedDuplicate, 'user-1', 'tenant-1'))
      .resolves.toEqual(expect.objectContaining({ companyId: 'company-1' }));
    expect(mocks.resolveOrCreateContact).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sourceRecordId: 'shareholders.0' }),
      { action: 'AUTO' },
      expect.objectContaining({ tenantId: 'tenant-1', tx }),
    );
    expect(tx.companyShareholder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contactId: 'contact-created-in-import' }),
    }));
  });

  it('tracks a restored contact as auto-created for duplicate records in the same import', async () => {
    const samePersonShareholder = {
      name: officer.name,
      type: 'INDIVIDUAL' as const,
      identificationType: officer.identificationType,
      identificationNumber: officer.identificationNumber,
      nationality: officer.nationality,
      address: officer.address,
      shareClass: 'ORDINARY',
      numberOfShares: 100,
    };
    mocks.previewContactIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        contactId: 'contact-restored-in-import', score: 1, automatic: true,
        blockedByIdentifierConflict: false, reasons: ['IDENTIFIER'], conflicts: [],
      });
    mocks.resolveOrCreateContact
      .mockReset()
      .mockResolvedValueOnce({ contact: { id: 'contact-restored-in-import' }, outcome: 'RESTORED' })
      .mockResolvedValueOnce({ contact: { id: 'contact-restored-in-import' }, outcome: 'REUSED_IDENTIFIER' });
    const undecidedDuplicate = {
      ...extractedData,
      officers: [{ ...officer, contactResolution: undefined }],
      shareholders: [samePersonShareholder],
    };
    const { processBizFileExtraction } = await import('@/services/bizfile/processor');

    await expect(processBizFileExtraction('doc-1', undecidedDuplicate, 'user-1', 'tenant-1'))
      .resolves.toEqual(expect.objectContaining({ companyId: 'company-1' }));
    expect(tx.companyShareholder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contactId: 'contact-restored-in-import' }),
    }));
  });
});
