import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrCreateVendorContact: vi.fn(), getOrCreateCustomerContact: vi.fn(),
  resolveVendor: vi.fn(), resolveCustomer: vi.fn(),
  learnVendorAlias: vi.fn(), learnCustomerAlias: vi.fn(), createAuditLog: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    documentRevision: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    processingDocument: { findUnique: vi.fn(), update: vi.fn() },
    documentExtraction: { findUnique: vi.fn() }, document: { update: vi.fn() }, company: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/storage', () => ({
  storage: { exists: vi.fn(), copy: vi.fn(), delete: vi.fn(), move: vi.fn() }, generateApprovedDocumentFilename: vi.fn(() => 'approved.pdf'),
  getFileExtension: vi.fn(() => 'pdf'), buildApprovedStorageKey: vi.fn(() => 'approved.pdf'),
}));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock('@/lib/audit', () => ({ createAuditLog: mocks.createAuditLog }));
vi.mock('@/services/vendor-resolution.service', () => ({
  getOrCreateVendorContact: mocks.getOrCreateVendorContact, learnVendorAlias: mocks.learnVendorAlias,
  resolveVendor: mocks.resolveVendor,
}));
vi.mock('@/services/customer-resolution.service', () => ({
  getOrCreateCustomerContact: mocks.getOrCreateCustomerContact, learnCustomerAlias: mocks.learnCustomerAlias,
  resolveCustomer: mocks.resolveCustomer,
}));

import {
  approveRevision,
  buildDocumentVaultContactCandidate,
  normalizeCounterpartyIdentityDraft,
  parseReviewerCounterpartyIdentity,
} from '@/services/document-revision.service';
import { mapCounterpartyIdentityDraft } from '@/services/document-extraction.service';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import { Decimal } from '@prisma/client/runtime/client';

describe('Document Vault counterparty identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.documentRevision.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.documentRevision.update).mockResolvedValue({} as never);
    vi.mocked(prisma.processingDocument.update).mockResolvedValue({} as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
  });

  it('maps structured extraction values and confidence', () => {
    const draft = mapCounterpartyIdentityDraft({
      counterpartyIdentificationType: { value: 'UEN', confidence: 0.97 },
      counterpartyIdentificationNumber: { value: '202012345A', confidence: 0.98 },
      counterpartyAddress: { value: '1 Raffles Place', confidence: 0.92 },
      counterpartyEmail: { value: 'accounts@example.sg', confidence: 0.95 },
      counterpartyPhone: { value: '+65 6123 4567', confidence: 0.91 },
    });
    expect(draft).toEqual({
      identificationType: 'UEN', identificationNumber: '202012345A', fullAddress: '1 Raffles Place',
      email: 'accounts@example.sg', phone: '+65 6123 4567',
      confidence: { identificationNumber: 0.98, fullAddress: 0.92, email: 0.95, phone: 0.91 },
    });
  });

  it('normalizes extracted identity confidence without changing it', () => {
    expect(normalizeCounterpartyIdentityDraft({
      identificationType: 'UEN', identificationNumber: ' 202099999Z ', fullAddress: ' 10 Anson Road ',
      email: ' billing@example.sg ', phone: ' +65 6999 0000 ',
      confidence: { identificationNumber: 0.98, fullAddress: 0.92, email: 0.95, phone: 0.91 },
    })).toEqual({
      identificationType: 'UEN', identificationNumber: '202099999Z', fullAddress: '10 Anson Road',
      email: 'billing@example.sg', phone: '+65 6999 0000',
      confidence: { identificationNumber: 0.98, fullAddress: 0.92, email: 0.95, phone: 0.91 },
    });
  });

  it('passes identifier confidence through to the deterministic 0.90 gate', () => {
    const low = buildDocumentVaultContactCandidate('Acme', {
      identificationType: 'UEN', identificationNumber: '202012345A', confidence: { identificationNumber: 0.89 },
    }, 'revision-low');
    const threshold = buildDocumentVaultContactCandidate('Acme', {
      identificationType: 'UEN', identificationNumber: '202012345A', confidence: { identificationNumber: 0.9 },
    }, 'revision-threshold');
    expect(low.confidence?.corporateUen).toBe(0.89);
    expect(threshold.confidence?.corporateUen).toBe(0.9);
  });

  it('preserves non-UEN identifiers and all available details', () => {
    const candidate = buildDocumentVaultContactCandidate('Example Trading', {
      identificationType: 'OTHER', identificationNumber: 'REG-123', email: 'ops@example.sg',
      phone: '+65 6000 0000', confidence: { identificationNumber: 0.96 },
    }, 'revision-1', 'company-1');
    expect(candidate).toEqual(expect.objectContaining({
      identificationType: 'OTHER', identificationNumber: 'REG-123',
      contactDetails: expect.arrayContaining([
        expect.objectContaining({ detailType: 'EMAIL', value: 'ops@example.sg', companyId: 'company-1' }),
        expect.objectContaining({ detailType: 'PHONE', value: '+65 6000 0000', companyId: 'company-1' }),
      ]),
    }));
  });

  it.each([
    [{ identificationType: 'TIN', identificationNumber: '12345678' }, 'identificationType'],
    [{ identificationType: 'UEN', identificationNumber: 'bad!' }, 'identificationNumber'],
    [{ identificationType: 'UEN', identificationNumber: '202012345A', email: 'not-an-email' }, 'email'],
    [{ identificationType: 'UEN', identificationNumber: '202012345A', phone: 'abc' }, 'phone'],
    [{ identificationType: 'UEN' }, 'identificationNumber'],
  ])('rejects invalid reviewer identity input %#', (input, field) => {
    expect(() => parseReviewerCounterpartyIdentity(input)).toThrow(expect.objectContaining({
      issues: expect.arrayContaining([expect.objectContaining({ field })]),
    }));
  });

  it('derives reviewer confidence and ignores client spoofing', () => {
    expect(parseReviewerCounterpartyIdentity({
      identificationType: 'UEN', identificationNumber: '202012345A', email: 'billing@example.sg',
      confidence: { identificationNumber: 0.01, email: 0.02 },
    })).toEqual({
      identificationType: 'UEN', identificationNumber: '202012345A', email: 'billing@example.sg',
      confidence: { identificationNumber: 1, email: 1 },
    });
  });

  it('clears reviewer fields and their confidence when blank', () => {
    expect(parseReviewerCounterpartyIdentity({
      identificationType: '', identificationNumber: '', fullAddress: '', email: '', phone: '',
      confidence: { identificationNumber: 1, fullAddress: 1, email: 1, phone: 1 },
    })).toEqual({ confidence: {} });
  });

  it.each([
    ['ACCOUNTS_PAYABLE', mocks.getOrCreateVendorContact, 'vendor'],
    ['ACCOUNTS_RECEIVABLE', mocks.getOrCreateCustomerContact, 'customer'],
  ] as const)('keeps %s identity resolution and approval writes in one transaction', async (category, resolver, side) => {
    const revision = approvalRevision(category, side);
    vi.mocked(prisma.documentRevision.findUnique).mockResolvedValue(revision as never);
    vi.mocked(prisma.processingDocument.findUnique).mockResolvedValue(processingContext() as never);
    resolver.mockResolvedValue(resolutionResult(side));
    const tx = approvalTx(revision);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: unknown) => (
      callback as (client: typeof tx) => Promise<unknown>
    )(tx) as never);

    expect(resolver).not.toHaveBeenCalled();
    await approveRevision(revision.id, { userId: 'user-1' });

    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', companyId: 'company-1', createdById: 'user-1', sourceRecordId: revision.id,
      counterpartyIdentity: expect.objectContaining({ identificationNumber: '202012345A' }), tx,
    }));
    expect(side === 'vendor' ? mocks.learnVendorAlias : mocks.learnCustomerAlias)
      .toHaveBeenCalledWith(expect.objectContaining({ tx }));
    expect(tx.documentRevision.update).toHaveBeenCalled();
    expect(tx.processingDocument.update).toHaveBeenCalled();
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.any(Object), tx);
    expect(prisma.documentRevision.update).not.toHaveBeenCalled();
    expect(prisma.processingDocument.update).not.toHaveBeenCalled();
  });

  it.each([
    ['ACCOUNTS_PAYABLE', mocks.getOrCreateVendorContact, 'vendor'],
    ['ACCOUNTS_RECEIVABLE', mocks.getOrCreateCustomerContact, 'customer'],
  ] as const)('rolls back %s identity work when a late approval write fails', async (category, resolver, side) => {
    const revision = approvalRevision(category, side);
    vi.mocked(prisma.documentRevision.findUnique).mockResolvedValue(revision as never);
    vi.mocked(prisma.processingDocument.findUnique).mockResolvedValue(processingContext() as never);
    resolver.mockResolvedValue(resolutionResult(side));
    const tx = approvalTx(revision);
    tx.processingDocument.update.mockRejectedValue(new Error('late write failed'));
    let committed = false;
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: unknown) => {
      const result = await (callback as (client: typeof tx) => Promise<unknown>)(tx);
      committed = true;
      return result as never;
    });

    await expect(approveRevision(revision.id, { userId: 'user-1' })).rejects.toThrow('late write failed');
    expect(committed).toBe(false);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ tx }));
    expect(side === 'vendor' ? mocks.learnVendorAlias : mocks.learnCustomerAlias)
      .toHaveBeenCalledWith(expect.objectContaining({ tx }));
    expect(prisma.documentRevision.update).not.toHaveBeenCalled();
    expect(prisma.processingDocument.update).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it('keeps the recorded source when destination metadata persistence fails', async () => {
    const revision = approvalRevision('ACCOUNTS_PAYABLE', 'vendor');
    vi.mocked(prisma.documentRevision.findUnique).mockResolvedValue(revision as never);
    vi.mocked(prisma.processingDocument.findUnique).mockResolvedValue(processingContext('vault/original.pdf') as never);
    mocks.getOrCreateVendorContact.mockResolvedValue(resolutionResult('vendor'));
    const tx = approvalTx(revision);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: unknown) => (
      callback as (client: typeof tx) => Promise<unknown>
    )(tx) as never);
    vi.mocked(storage.exists).mockResolvedValue(true);
    vi.mocked(prisma.document.update).mockRejectedValue(new Error('metadata failed'));

    await approveRevision(revision.id, { userId: 'user-1' });

    expect(storage.copy).toHaveBeenCalledWith('vault/original.pdf', 'approved.pdf');
    expect(storage.delete).toHaveBeenCalledWith('approved.pdf');
    expect(storage.delete).not.toHaveBeenCalledWith('vault/original.pdf');
  });

  it('records destination metadata before deleting the source', async () => {
    const revision = approvalRevision('ACCOUNTS_PAYABLE', 'vendor');
    vi.mocked(prisma.documentRevision.findUnique).mockResolvedValue(revision as never);
    vi.mocked(prisma.processingDocument.findUnique).mockResolvedValue(processingContext('vault/original.pdf') as never);
    mocks.getOrCreateVendorContact.mockResolvedValue(resolutionResult('vendor'));
    const tx = approvalTx(revision);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: unknown) => (
      callback as (client: typeof tx) => Promise<unknown>
    )(tx) as never);
    vi.mocked(storage.exists).mockResolvedValue(true);
    vi.mocked(prisma.document.update).mockResolvedValue({} as never);

    await approveRevision(revision.id, { userId: 'user-1' });

    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'document-1' },
      data: { fileName: 'approved.pdf', storageKey: 'approved.pdf' },
    });
    expect(vi.mocked(prisma.document.update).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(storage.delete).mock.invocationCallOrder[0]);
    expect(storage.delete).toHaveBeenCalledWith('vault/original.pdf');
  });

  it('retains the new recorded key when deleting the old source fails', async () => {
    const revision = approvalRevision('ACCOUNTS_PAYABLE', 'vendor');
    vi.mocked(prisma.documentRevision.findUnique).mockResolvedValue(revision as never);
    vi.mocked(prisma.processingDocument.findUnique).mockResolvedValue(processingContext('vault/original.pdf') as never);
    mocks.getOrCreateVendorContact.mockResolvedValue(resolutionResult('vendor'));
    const tx = approvalTx(revision);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: unknown) => (
      callback as (client: typeof tx) => Promise<unknown>
    )(tx) as never);
    vi.mocked(storage.exists).mockResolvedValue(true);
    vi.mocked(prisma.document.update).mockResolvedValue({} as never);
    vi.mocked(storage.delete).mockRejectedValueOnce(new Error('delete failed'));

    await approveRevision(revision.id, { userId: 'user-1' });

    expect(prisma.document.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { fileName: 'approved.pdf', storageKey: 'approved.pdf' },
    }));
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith('vault/original.pdf');
  });
});

function approvalRevision(category: 'ACCOUNTS_PAYABLE' | 'ACCOUNTS_RECEIVABLE', side: 'vendor' | 'customer') {
  return {
    id: `revision-${side}`, processingDocumentId: 'processing-1', status: 'DRAFT', documentCategory: category,
    documentSubCategory: null, vendorName: 'Acme', vendorId: null,
    customerName: category === 'ACCOUNTS_RECEIVABLE' ? 'Acme' : null, customerId: null,
    counterpartyIdentity: {
      identificationType: 'UEN', identificationNumber: '202012345A', fullAddress: '1 Raffles Place',
      email: 'accounts@example.sg', confidence: { identificationNumber: 0.98, fullAddress: 0.92, email: 0.95 },
    },
    extractionId: 'extraction-1', validationIssues: { issues: [] }, currency: 'SGD', totalAmount: new Decimal(100),
    homeCurrency: 'SGD', homeExchangeRate: new Decimal(1), homeExchangeRateSource: null,
    exchangeRateDate: null, homeEquivalent: new Decimal(100), documentDate: null, documentNumber: null, items: [],
  };
}

function processingContext(storageKey: string | null = null) {
  return { document: { id: 'document-1', tenantId: 'tenant-1', companyId: 'company-1', fileName: 'invoice.pdf', storageKey } };
}

function resolutionResult(side: 'vendor' | 'customer') {
  return side === 'vendor'
    ? { vendorId: 'contact-1', vendorName: 'Acme', confidence: 1, strategy: 'CONTACT' }
    : { customerId: 'contact-1', customerName: 'Acme', confidence: 1, strategy: 'CONTACT' };
}

function approvalTx(revision: ReturnType<typeof approvalRevision>) {
  return {
    documentRevision: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }), update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ ...revision, status: 'APPROVED' }),
    },
    processingDocument: { update: vi.fn().mockResolvedValue({}) },
    documentExtraction: { findUnique: vi.fn().mockResolvedValue({ rawJson: { vendorName: { value: 'Acme' } } }) },
  };
}
