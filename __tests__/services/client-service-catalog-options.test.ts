import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  company: { findFirst: vi.fn() },
  serviceVariant: { findMany: vi.fn() },
  templatePartial: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getManualClientServiceCatalogOptions } from '@/services/client-service';

const params = { tenantId: 'tenant-1', userId: 'user-1' };
const nestedPartial = {
  id: 'nested-1',
  name: 'nested-partial',
  version: 2,
  content: 'Nested wording',
  placeholders: [
    { key: 'service.fields.software', label: 'Nested Software', type: 'text', defaultValue: 'Nested', required: true },
    { key: 'service.fields.filingMonth', label: 'Filing month', type: 'text', required: true },
    { key: 'document.entityName', label: 'Entity name', type: 'text', required: true },
  ],
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
};
const rootPartial = {
  id: 'partial-1',
  name: 'corporate-secretarial',
  version: 1,
  content: '<h2>{{> nested-partial}}</h2>',
  placeholders: [
    { key: 'service.fields.software', label: 'Software', type: 'text', defaultValue: 'Xero', required: true },
    { key: 'document.title', label: 'Document title', type: 'text', required: true },
  ],
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
};
const variant = {
  id: 'variant-1',
  name: 'Corporate Secretarial',
  serviceCadence: 'ANNUALLY',
  customCadenceLabel: null,
  family: { id: 'family-1', name: 'Corporate Services' },
  sowPartial: rootPartial,
  defaultFeeTemplates: [{
    description: 'Annual service fee',
    defaultAmount: { toFixed: () => '1200.00' },
    currency: 'SGD',
    billingFrequency: 'ANNUALLY',
    customFrequencyLabel: null,
    displayOrder: 0,
  }],
};

describe('manual client service catalog options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.company.findFirst.mockResolvedValue({ id: 'company-1', name: 'Test Co', uen: '202400001A' });
    prismaMock.serviceVariant.findMany.mockResolvedValue([variant]);
    prismaMock.templatePartial.findMany.mockResolvedValue([rootPartial, nestedPartial]);
  });

  it('projects minimal operational options with root-first field composition', async () => {
    const result = await getManualClientServiceCatalogOptions('company-1', params);

    expect(result).toEqual({
      companyContext: { id: 'company-1', name: 'Test Co', uen: '202400001A', accountsDueDate: null, financialYearEndDay: undefined, financialYearEndMonth: undefined, incorporationDate: null },
      variants: [{
        id: 'variant-1',
        name: 'Corporate Secretarial',
        family: { id: 'family-1', name: 'Corporate Services', displayColor: '#2F6F5E' },
        serviceCadence: 'ANNUALLY',
        customCadenceLabel: null,
        monitoringProfiles: [],
        fields: [
          { key: 'software', label: 'Software', type: 'text', defaultValue: 'Xero' },
          { key: 'filingMonth', label: 'Filing month', type: 'text', defaultValue: null },
        ],
        feeTemplates: [{
          description: 'Annual service fee',
          defaultAmount: '1200.00',
          currency: 'SGD',
          billingFrequency: 'ANNUALLY',
          customFrequencyLabel: null,
          billingTiming: 'PREPAID',
          postpaidTrigger: null,
          tieredPricing: null,
          displayOrder: 0,
        }],
        deadlineRules: [],
      }],
    });
    expect(JSON.stringify(result)).not.toContain('partialContent');
    expect(JSON.stringify(result)).not.toContain('required');
    expect(JSON.stringify(result)).not.toContain('document.');
  });

  it('scopes eligible variants to the workspace and active non-archived parents', async () => {
    await getManualClientServiceCatalogOptions('company-1', params);

    expect(prismaMock.serviceVariant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        deletedAt: null,
        isActive: true,
        family: expect.objectContaining({ tenantId: 'tenant-1', deletedAt: null, isActive: true }),
        sowPartial: expect.objectContaining({ tenantId: 'tenant-1', deletedAt: null }),
      }),
    }));
  });

  it('hides unavailable companies behind the generic not-found behavior', async () => {
    prismaMock.company.findFirst.mockResolvedValue(null);

    await expect(getManualClientServiceCatalogOptions('company-1', params)).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.serviceVariant.findMany).not.toHaveBeenCalled();
  });
});
