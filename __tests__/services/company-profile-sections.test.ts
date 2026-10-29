import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
const company = {
  id: 'company-1', tenantId: 'tenant-1', uen: '202400001A', name: 'Example Pte. Ltd.', displayAlias: 'OAK',
  formerName: null, dateOfNameChange: null, entityType: 'PRIVATE_LIMITED', status: 'LIVE',
  statusDate: null, incorporationDate: new Date('2020-01-01'), registrationDate: new Date('2020-01-02'),
  primarySsicCode: null, primarySsicDescription: null, secondarySsicCode: null, secondarySsicDescription: null,
  financialYearEndDay: 31, financialYearEndMonth: 12, fyeAsAtLastAr: null, homeCurrency: 'SGD',
  lastAgmDate: null, lastArFiledDate: null, accountsDueDate: null,
  paidUpCapitalCurrency: 'SGD', paidUpCapitalAmount: 1000,
  issuedCapitalCurrency: 'SGD', issuedCapitalAmount: 1000,
  addresses: [], formerNames: [], officers: [], shareholders: [], shareCapital: [], charges: [], auditor: null,
  financialPeriods: [] as Array<{ periodStart: Date; periodEnd: Date; yearsOfAssessment: number[] }>,
};
const tx = {
  company: { findFirst: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
  companyFinancialPeriod: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  companyAddress: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  auditLog: { create: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction, company: tx.company } }));

const enqueueMock = vi.fn();
vi.mock('@/services/schedule-reconciliation', () => ({
  enqueueScheduleReconciliation: (...args: unknown[]) => enqueueMock(...args),
}));

describe('company profile section services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.company.findFirst.mockResolvedValue(company);
    tx.companyAddress.findFirst.mockResolvedValue(null);
    tx.company.findUniqueOrThrow.mockResolvedValue({ tenantId: 'tenant-1', incorporationDate: new Date('2024-09-14T00:00:00.000Z') });
    tx.companyFinancialPeriod.findFirst.mockResolvedValue(null);
    mocks.transaction.mockImplementation((callback) => callback(tx));
  });

  it('rejects a stale section version before writing', async () => {
    const { saveCompanyProfileSection } = await import('@/services/company/profile-sections');
    await expect(saveCompanyProfileSection({
      companyId: 'company-1', tenantId: 'tenant-1', userId: 'user-1',
      section: 'addresses', ifMatchVersion: 'stale',
      data: { registered: null, mailing: null },
    })).rejects.toMatchObject({ code: 'COMPANY_PROFILE_CONFLICT' });
    expect(tx.companyAddress.create).not.toHaveBeenCalled();
  });

  it('saves only the requested address section and audits it', async () => {
    const { getCompanyProfileSection, saveCompanyProfileSection } = await import('@/services/company/profile-sections');
    const current = await getCompanyProfileSection('company-1', 'tenant-1', 'addresses');
    tx.company.findFirst
      .mockResolvedValueOnce(company)
      .mockResolvedValueOnce({ ...company, addresses: [{
        id: 'address-1', addressType: 'REGISTERED_OFFICE', streetName: 'Oak Street',
        postalCode: '123456', country: 'Singapore', fullAddress: 'Oak Street, Singapore 123456',
        block: null, level: null, unit: null, buildingName: null, effectiveFrom: null, isCurrent: true,
      }] });

    const saved = await saveCompanyProfileSection({
      companyId: 'company-1', tenantId: 'tenant-1', userId: 'user-1',
      section: 'addresses', ifMatchVersion: current.version,
      data: { registered: { streetName: 'Oak Street', postalCode: '123456', country: 'Singapore' }, mailing: null },
    });

    expect(tx.companyAddress.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ addressType: 'REGISTERED_OFFICE' }) }));
    expect(tx.company.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entityId: 'company-1:addresses' }) }));
    expect(saved.section).toBe('addresses');
    expect(saved.version).not.toBe(current.version);
  });

  it('includes the alias in identity versions and normalizes profile alias updates', async () => {
    const { getCompanyProfileSection, mutateCompanyProfileSection } = await import('@/services/company/profile-sections');
    const identity = await getCompanyProfileSection('company-1', 'tenant-1', 'identity');

    expect(identity.data).toEqual(expect.objectContaining({ displayAlias: 'OAK' }));

    await mutateCompanyProfileSection(tx as never, 'company-1', 'identity', {
      uen: '202400001A',
      name: 'Example Pte. Ltd.',
      displayAlias: '   ',
      entityType: 'PRIVATE_LIMITED',
      status: 'LIVE',
      statusDate: null,
      incorporationDate: '2020-01-01',
    });

    expect(tx.company.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ displayAlias: null }),
    }));

    tx.company.update.mockClear();
    await mutateCompanyProfileSection(tx as never, 'company-1', 'identity', {
      uen: '202400001A',
      name: 'Example Pte. Ltd.',
      entityType: 'PRIVATE_LIMITED',
      status: 'LIVE',
      statusDate: null,
      incorporationDate: '2020-01-01',
    });

    expect(tx.company.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ displayAlias: expect.anything() }),
    }));
  });

  it('updates Accounts due and enqueues company source reconciliation', async () => {
    const { getCompanyProfileSection, saveCompanyProfileSection } = await import(
      '@/services/company/profile-sections'
    );
    const current = await getCompanyProfileSection('company-1', 'tenant-1', 'compliance');

    await saveCompanyProfileSection({
      companyId: 'company-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      section: 'compliance',
      ifMatchVersion: current.version,
      data: {
        financialYearEndDay: 31,
        financialYearEndMonth: 12,
        fyeAsAtLastAr: null,
        homeCurrency: 'SGD',
        lastAgmDate: null,
        lastArFiledDate: null,
        accountsDueDate: '2026-07-31',
      },
    });

    expect(tx.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountsDueDate: new Date('2026-07-31T00:00:00.000Z'),
        }),
      }),
    );

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scopeType: 'COMPANY',
        triggerType: 'COMPANY_SOURCE_CHANGED',
      }),
    );
  });

  it('does not enqueue when compliance edits leave all schedule source fields unchanged', async () => {
    enqueueMock.mockClear();
    const { getCompanyProfileSection, saveCompanyProfileSection } = await import(
      '@/services/company/profile-sections'
    );
    const current = await getCompanyProfileSection('company-1', 'tenant-1', 'compliance');

    await saveCompanyProfileSection({
      companyId: 'company-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      section: 'compliance',
      ifMatchVersion: current.version,
      data: {
        financialYearEndDay: 31,
        financialYearEndMonth: 12,
        fyeAsAtLastAr: '2026-01-01',
        homeCurrency: 'USD',
        lastAgmDate: '2026-02-01',
        lastArFiledDate: '2026-03-01',
        accountsDueDate: null,
      },
    });

    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('saves the first FYE from the Compliance section as a period from incorporation and queues reconciliation', async () => {
    const { getCompanyProfileSection, saveCompanyProfileSection } = await import(
      '@/services/company/profile-sections'
    );
    const current = await getCompanyProfileSection('company-1', 'tenant-1', 'compliance');
    expect(current.data).toMatchObject({ firstFinancialYearEndDate: null });

    await saveCompanyProfileSection({
      companyId: 'company-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      section: 'compliance',
      ifMatchVersion: current.version,
      data: { ...current.data, firstFinancialYearEndDate: '2025-12-31' },
    });

    expect(tx.companyFinancialPeriod.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      periodStart: new Date('2024-09-14T00:00:00.000Z'),
      periodEnd: new Date('2025-12-31T00:00:00.000Z'),
      yearsOfAssessment: [2026],
      provenance: 'CONFIRMED',
    }) });
    expect(enqueueMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scopeType: 'COMPANY' }));
  });

  it('rejects a first FYE before the incorporation date is known', async () => {
    const { getCompanyProfileSection, saveCompanyProfileSection } = await import(
      '@/services/company/profile-sections'
    );
    tx.company.findUniqueOrThrow.mockResolvedValue({ tenantId: 'tenant-1', incorporationDate: null });
    const current = await getCompanyProfileSection('company-1', 'tenant-1', 'compliance');
    await expect(saveCompanyProfileSection({
      companyId: 'company-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      section: 'compliance',
      ifMatchVersion: current.version,
      data: { ...current.data, firstFinancialYearEndDate: '2025-12-31' },
    })).rejects.toThrow(/incorporation date/);
    expect(tx.companyFinancialPeriod.create).not.toHaveBeenCalled();
  });
});
