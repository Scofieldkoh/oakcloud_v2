import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCompanyById: vi.fn(),
  getSection: vi.fn(),
  saveSection: vi.fn(),
  confirmFirstFye: vi.fn(),
}));

vi.mock('@/services/company.service', () => ({ getCompanyById: mocks.getCompanyById }));
vi.mock('@/services/oakdoc-generation.service', () => ({
  toOakDocCompanyDetail: (value: unknown) => JSON.parse(JSON.stringify(value)),
}));
vi.mock('@/services/company/profile-sections', () => ({
  getCompanyProfileSection: mocks.getSection,
  saveCompanyProfileSection: mocks.saveSection,
  CompanyProfileConflictError: class CompanyProfileConflictError extends Error {},
  CompanyProfileNotFoundError: class CompanyProfileNotFoundError extends Error {},
}));
vi.mock('@/services/compliance-monitoring/financial-periods', () => ({
  confirmFirstFinancialYearEnd: mocks.confirmFirstFye,
}));

import {
  getCompanyDocumentFieldValues,
  saveCompanyDocumentField,
} from '@/services/company/document-field-values.service';

const company = {
  id: 'company-1',
  name: 'ABC Pte. Ltd.',
  uen: '202400001A',
  incorporationDate: new Date('2025-03-15T00:00:00.000Z'),
  financialYearEndDay: null,
  financialYearEndMonth: null,
  financialPeriods: [],
  addresses: [],
};

const compliance = {
  financialYearEndDay: null,
  financialYearEndMonth: null,
  fyeAsAtLastAr: null,
  homeCurrency: 'SGD',
  lastAgmDate: null,
  lastArFiledDate: null,
  accountsDueDate: null,
  firstFinancialYearEndDate: null,
};

const args = { companyId: 'company-1', tenantId: 'tenant-1', userId: 'user-1' };

describe('company document field values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCompanyById.mockResolvedValue(company);
    mocks.getSection.mockResolvedValue({ section: 'compliance', version: 'v1', data: compliance });
    mocks.saveSection.mockResolvedValue({});
    mocks.confirmFirstFye.mockResolvedValue({ firstFinancialYearEnd: '2025-12-31', yearOfAssessment: 2026 });
  });

  it('resolves only company tags, with the probe tag of each home', async () => {
    const values = await getCompanyDocumentFieldValues('company-1', 'tenant-1', [
      'company.uen',
      'company.firstFinancialYearEnd',
      'company.address.postalCode',
      'selectedDirector.name',
    ]);
    expect(values).toEqual({
      'company.uen': '202400001A',
      'company.firstFinancialYearEnd': '',
      'company.address.postalCode': '',
      'company.registeredAddress': '',
    });
    expect(mocks.getCompanyById).toHaveBeenCalledWith('company-1', 'tenant-1');
  });

  it('saves the financial year end to the compliance data through the profile section service', async () => {
    await saveCompanyDocumentField({ ...args, fieldId: 'financialYearEnd', value: '12-31' });
    expect(mocks.saveSection).toHaveBeenCalledWith({
      ...args,
      section: 'compliance',
      ifMatchVersion: 'v1',
      reason: 'Filled from document generation',
      data: {
        financialYearEndDay: 31,
        financialYearEndMonth: 12,
        fyeAsAtLastAr: null,
        homeCurrency: 'SGD',
        lastAgmDate: null,
        lastArFiledDate: null,
        accountsDueDate: null,
      },
    });
    expect(mocks.confirmFirstFye).not.toHaveBeenCalled();
  });

  it('saves the first FYE as the first confirmed financial period, as the Compliance card does', async () => {
    mocks.getSection.mockResolvedValue({
      section: 'compliance', version: 'v1', data: { ...compliance, financialYearEndDay: 31, financialYearEndMonth: 12 },
    });
    const result = await saveCompanyDocumentField({ ...args, fieldId: 'firstFinancialYearEnd', value: '2025-12-31' });
    expect(mocks.confirmFirstFye).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', companyId: 'company-1', userId: 'user-1' },
      '2025-12-31',
    );
    expect(mocks.saveSection).not.toHaveBeenCalled();
    expect(result).toMatchObject({ fieldId: 'firstFinancialYearEnd', value: '2025-12-31' });
  });

  it('also records the financial year end from the first FYE when the company has none', async () => {
    await saveCompanyDocumentField({ ...args, fieldId: 'firstFinancialYearEnd', value: '2026-06-30' });
    expect(mocks.confirmFirstFye).toHaveBeenCalledWith(expect.anything(), '2026-06-30');
    expect(mocks.saveSection).toHaveBeenCalledWith(expect.objectContaining({
      section: 'compliance',
      ifMatchVersion: 'v1',
      data: expect.objectContaining({ financialYearEndDay: 30, financialYearEndMonth: 6 }),
    }));
    expect(mocks.saveSection.mock.calls[0][0].data).not.toHaveProperty('firstFinancialYearEndDate');
  });

  it('fills a missing registered address without touching the mailing address', async () => {
    const mailing = { streetName: 'Elm Road', postalCode: '654321', country: 'Singapore' };
    mocks.getSection.mockResolvedValue({ section: 'addresses', version: 'v2', data: { registered: null, mailing } });
    await saveCompanyDocumentField({
      ...args,
      fieldId: 'registeredAddress',
      value: JSON.stringify({ streetName: 'Oak Road', postalCode: '123456' }),
    });
    expect(mocks.getSection).toHaveBeenCalledWith('company-1', 'tenant-1', 'addresses');
    expect(mocks.saveSection).toHaveBeenCalledWith(expect.objectContaining({
      section: 'addresses',
      ifMatchVersion: 'v2',
      data: {
        mailing,
        registered: expect.objectContaining({ streetName: 'Oak Road', postalCode: '123456', country: 'Singapore', effectiveFrom: null }),
      },
    }));
  });

  it('refuses to replace a value recorded meanwhile', async () => {
    mocks.getSection.mockResolvedValue({
      section: 'compliance',
      version: 'v1',
      data: { ...compliance, firstFinancialYearEndDate: '2025-12-31' },
    });
    await expect(saveCompanyDocumentField({ ...args, fieldId: 'firstFinancialYearEnd', value: '2026-03-31' }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.confirmFirstFye).not.toHaveBeenCalled();
  });

  it('rejects an invalid value before reading the company', async () => {
    await expect(saveCompanyDocumentField({ ...args, fieldId: 'incorporationDate', value: '2025-02-30' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Enter a valid date.' });
    expect(mocks.getSection).not.toHaveBeenCalled();
  });
});
