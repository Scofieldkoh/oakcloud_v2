import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncCompanyFromBizfileInTransaction } from '@/services/bizfile/company-sync';

const enqueueMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/schedule-reconciliation', () => ({ enqueueScheduleReconciliation: enqueueMock }));

const tx = {
  company: { upsert: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  companyFormerName: { deleteMany: vi.fn(), create: vi.fn() },
  companyAddress: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  shareCapital: { deleteMany: vi.fn(), create: vi.fn() },
  companyOfficer: { updateMany: vi.fn(), create: vi.fn() },
  companyShareholder: { updateMany: vi.fn(), create: vi.fn() },
  companyAuditor: { upsert: vi.fn(), deleteMany: vi.fn() },
  companyCharge: { deleteMany: vi.fn(), create: vi.fn() },
  auditLog: { createMany: vi.fn() },
};

const data = {
  entityDetails: {
    uen: '202400001A', name: 'Complete Pte. Ltd.', formerName: 'Old Complete',
    dateOfNameChange: '2024-01-01',
    formerNames: [{ name: 'First Complete', effectiveFrom: '2020-01-01', effectiveTo: '2023-12-31' }],
    entityType: 'PRIVATE_LIMITED', status: 'LIVE', statusDate: '2024-01-02',
    incorporationDate: '2020-01-01', registrationDate: '2020-01-02',
  },
  ssicActivities: {
    primary: { code: '62011', description: 'Software development' },
    secondary: { code: '70201', description: 'Management consultancy' },
  },
  registeredAddress: { block: '1', streetName: 'Oak Street', level: '02', unit: '03', buildingName: 'Oak House', postalCode: '123456', country: 'Singapore', effectiveFrom: '2024-01-01' },
  mailingAddress: { block: '2', streetName: 'Mail Street', postalCode: '654321', country: 'Singapore' },
  paidUpCapital: { amount: 100000, currency: 'SGD' },
  issuedCapital: { amount: 120000, currency: 'SGD' },
  shareCapital: [{ shareClass: 'ORDINARY', currency: 'SGD', numberOfShares: 100000, parValue: 1, totalValue: 100000, isPaidUp: true, isTreasury: false }],
  treasuryShares: { numberOfShares: 100, currency: 'SGD' },
  homeCurrency: 'SGD',
  officers: [{ name: 'Tan Mei Ling', role: 'DIRECTOR', identificationType: 'NRIC', identificationNumber: 'S1234567A', nationality: 'Singaporean', address: '1 Oak Street', appointmentDate: '2020-01-01' }],
  shareholders: [{ name: 'Tan Mei Ling', type: 'INDIVIDUAL' as const, identificationType: 'NRIC', identificationNumber: 'S1234567A', nationality: 'Singaporean', placeOfOrigin: 'Singapore', address: '1 Oak Street', shareClass: 'ORDINARY', numberOfShares: 60000, percentageHeld: 60, currency: 'SGD' }],
  auditor: { name: 'Oak Audit LLP', address: '3 Audit Street', appointmentDate: '2021-01-01' },
  financialYear: { endDay: 31, endMonth: 12 },
  compliance: { lastAgmDate: '2025-05-01', lastArFiledDate: '2025-06-01', accountsDueDate: '2026-06-30', fyeAsAtLastAr: '2024-12-31' },
  charges: [{ chargeNumber: 'C1', chargeType: 'FIXED', description: 'Bank charge', chargeHolderName: 'Oak Bank', amountSecured: 5000, amountSecuredText: 'Five thousand', currency: 'SGD', registrationDate: '2022-01-01' }],
  documentMetadata: { receiptNo: 'ACRA-1', receiptDate: '2025-01-01' },
};

describe('syncCompanyFromBizfileInTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.company.upsert.mockResolvedValue({ id: 'company-1' });
    tx.companyAddress.findFirst.mockResolvedValue(null);
    tx.company.findFirst.mockResolvedValue(null);
  });

  it.each([
    ['new company', undefined],
    ['existing company', 'company-1'],
  ])('normalizes every reviewed company section for a %s', async (_label, existingCompanyId) => {
    const resolveContact = vi.fn()
      .mockResolvedValueOnce('contact-officer')
      .mockResolvedValueOnce('contact-shareholder');

    const result = await syncCompanyFromBizfileInTransaction({
      data, documentId: 'doc-1', tenantId: 'tenant-1', userId: 'user-1', existingCompanyId,
    }, tx as never, { resolveContact });

    expect(result.companyId).toBe('company-1');
    expect(existingCompanyId ? tx.company.update : tx.company.upsert).toHaveBeenCalled();
    expect(tx.companyAddress.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ addressType: 'MAILING', sourceDocumentId: 'doc-1' }) }));
    expect(tx.shareCapital.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shareClass: 'ORDINARY', totalValue: 100000 }) }));
    expect(tx.shareCapital.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shareClass: 'TREASURY', numberOfShares: 100 }) }));
    expect(tx.companyOfficer.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ identificationNumber: 'S1234567A', appointmentDate: new Date('2020-01-01'), contactId: 'contact-officer' }) }));
    expect(tx.companyShareholder.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ placeOfOrigin: 'Singapore', percentageHeld: 60, currency: 'SGD', contactId: 'contact-shareholder' }) }));
    expect(tx.companyAuditor.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ name: 'Oak Audit LLP', sourceDocumentId: 'doc-1' }) }));
    expect(tx.companyCharge.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ chargeNumber: 'C1', amountSecuredText: 'Five thousand' }) }));
    expect(tx.company.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ homeCurrency: 'SGD', fyeAsAtLastAr: new Date('2024-12-31') }) }));
    expect(JSON.stringify([
      ...tx.company.upsert.mock.calls,
      ...tx.company.update.mock.calls,
    ])).not.toContain('ACRA-1');
  });

  it('does not clear an existing alias when BizFile omits it', async () => {
    const omittedAlias = {
      ...data,
      entityDetails: { ...data.entityDetails, displayAlias: undefined },
    };

    await syncCompanyFromBizfileInTransaction({
      data: omittedAlias,
      documentId: 'doc-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      existingCompanyId: 'company-1',
    }, tx as never);

    const updateData = tx.company.update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(updateData, 'displayAlias')).toBe(false);
  });

  it('clears an existing alias when the reviewed BizFile value is blank', async () => {
    const blankAlias = {
      ...data,
      entityDetails: { ...data.entityDetails, displayAlias: '   ' },
    };

    await syncCompanyFromBizfileInTransaction({
      data: blankAlias,
      documentId: 'doc-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      existingCompanyId: 'company-1',
    }, tx as never);

    expect(tx.company.update.mock.calls[0]?.[0]?.data).toEqual(expect.objectContaining({ displayAlias: null }));
  });

  it('clears an existing alias when the reviewed BizFile value is explicitly null', async () => {
    const explicitNull = {
      ...data,
      entityDetails: { ...data.entityDetails, displayAlias: null },
    };

    await syncCompanyFromBizfileInTransaction({
      data: explicitNull,
      documentId: 'doc-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      existingCompanyId: 'company-1',
    }, tx as never);

    expect(tx.company.update.mock.calls[0]?.[0]?.data).toEqual(
      expect.objectContaining({ displayAlias: null }),
    );
  });

  it.each([
    ['omitted', undefined],
    ['blank', '   '],
  ] as const)('stores a null alias for a new company when the reviewed value is %s', async (_label, alias) => {
    const entityDetails: typeof data.entityDetails & { displayAlias?: string | null } = {
      ...data.entityDetails,
    };
    if (alias !== undefined) entityDetails.displayAlias = alias;

    await syncCompanyFromBizfileInTransaction({
      data: { ...data, entityDetails },
      documentId: 'doc-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    }, tx as never);

    expect(tx.company.upsert.mock.calls[0]?.[0]?.create).toEqual(
      expect.objectContaining({ displayAlias: null }),
    );
  });

  it('normalizes a supplied BizFile alias before updating an existing company', async () => {
    const suppliedAlias = {
      ...data,
      entityDetails: { ...data.entityDetails, displayAlias: ' OAK ' },
    };

    await syncCompanyFromBizfileInTransaction({
      data: suppliedAlias,
      documentId: 'doc-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      existingCompanyId: 'company-1',
    }, tx as never);

    expect(tx.company.update.mock.calls[0]?.[0]?.data).toEqual(expect.objectContaining({ displayAlias: 'OAK' }));
  });

  it('normalizes a supplied BizFile alias when creating a company', async () => {
    const suppliedAlias = {
      ...data,
      entityDetails: { ...data.entityDetails, displayAlias: ' OAK ' },
    };

    await syncCompanyFromBizfileInTransaction({
      data: suppliedAlias,
      documentId: 'doc-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    }, tx as never);

    expect(tx.company.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ displayAlias: 'OAK' }),
    }));
  });

  it('persists the nominee shareholder flag from reviewed BizFile data', async () => {
    const nomineeData = {
      ...data,
      shareholders: [{ ...data.shareholders[0], isNominee: true }],
    };

    await syncCompanyFromBizfileInTransaction({
      data: nomineeData as never, documentId: 'doc-1', tenantId: 'tenant-1', userId: 'user-1',
    }, tx as never);

    expect(tx.companyShareholder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isNominee: true }),
    }));
  });

  it('does not enqueue when an existing BizFile sync leaves approved source fields unchanged', async () => {
    tx.company.findFirst.mockResolvedValue({
      id: 'company-1', tenantId: 'tenant-1', entityType: 'PRIVATE_LIMITED',
      incorporationDate: new Date('2020-01-01'), financialYearEndDay: 31, financialYearEndMonth: 12,
      accountsDueDate: new Date('2026-06-30'),
    });

    await expect(syncCompanyFromBizfileInTransaction({
      data, documentId: 'doc-1', tenantId: 'tenant-1', userId: 'user-1', existingCompanyId: 'company-1',
    }, tx as never)).resolves.toMatchObject({ companyId: 'company-1', created: false });
  });
});
