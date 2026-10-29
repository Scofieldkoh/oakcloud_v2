import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    company: { findFirst: vi.fn() },
    contact: { findMany: vi.fn() },
    documentTemplate: { findFirst: vi.fn() },
  },
}));

vi.mock('@/services/company.service', () => ({
  getCompanyById: vi.fn(),
}));

vi.mock('@/services/template-partial.service', () => ({
  getPartialsUsedInTemplate: vi.fn(() => []),
}));

import { prisma } from '@/lib/prisma';
import { getCompanyById } from '@/services/company.service';
import { renderTemplateForGeneration } from '@/services/document-generator.service';

describe('document generator party loops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders secured company-specific and general-fallback party contact fields', async () => {
    vi.mocked(getCompanyById).mockResolvedValue({
      id: 'company-1',
      name: 'Sample',
      uen: '202600001A',
      officers: [{
        id: 'officer-1',
        contactId: 'contact-1',
        name: 'Alice',
        role: 'DIRECTOR',
        address: 'One Road',
        isCurrent: true,
      }],
      shareholders: [{
        id: 'shareholder-1',
        contactId: 'contact-2',
        name: 'Ben',
        numberOfShares: 1,
        address: 'Two Road',
        isCurrent: true,
      }],
    } as never);
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [{
        id: 'officer-1',
        contactId: 'contact-1',
        name: 'Alice',
        role: 'DIRECTOR',
        nationality: null,
        identificationNumber: null,
        address: 'One Road',
        appointmentDate: null,
      }],
      shareholders: [{
        id: 'shareholder-1',
        contactId: 'contact-2',
        name: 'Ben',
        shareholderType: 'INDIVIDUAL',
        nationality: null,
        identificationNumber: null,
        shareClass: 'ORDINARY',
        numberOfShares: 1,
        percentageHeld: null,
        address: 'Two Road',
      }],
      contacts: [],
    } as never);
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      {
        id: 'contact-1',
        fullName: 'Alice',
        contactType: 'INDIVIDUAL',
        fullAddress: null,
        contactDetails: [
          { detailType: 'EMAIL', value: 'alice-general@example.com', companyId: null, isPrimary: true, displayOrder: 0, createdAt: new Date('2026-01-01') },
          { detailType: 'EMAIL', value: 'alice-company@example.com', companyId: 'company-1', isPrimary: true, displayOrder: 0, createdAt: new Date('2026-01-02') },
          { detailType: 'PHONE', value: '+65 6111 1111', companyId: null, isPrimary: true, displayOrder: 0, createdAt: new Date('2026-01-01') },
        ],
      },
      {
        id: 'contact-2',
        fullName: 'Ben',
        contactType: 'INDIVIDUAL',
        fullAddress: null,
        contactDetails: [
          { detailType: 'EMAIL', value: 'ben-general@example.com', companyId: null, isPrimary: true, displayOrder: 0, createdAt: new Date('2026-01-01') },
          { detailType: 'PHONE', value: '+65 6222 2222', companyId: null, isPrimary: true, displayOrder: 0, createdAt: new Date('2026-01-01') },
          { detailType: 'PHONE', value: '+65 6333 3333', companyId: 'company-1', isPrimary: true, displayOrder: 0, createdAt: new Date('2026-01-02') },
        ],
      },
    ] as never);

    const result = await renderTemplateForGeneration({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      templateContent: [
        '{{#each directors}}{{name}}|{{email}}|{{phone}}|{{letterAddress}}{{/each}}',
        '{{#each shareholders}}{{name}}|{{email}}|{{phone}}|{{letterAddress}}{{/each}}',
      ].join('/'),
    });

    expect(result.rawResolvedContent).toBe(
      'Alice|alice-company@example.com|+65 6111 1111|One Road/'
      + 'Ben|ben-general@example.com|+65 6333 3333|Two Road',
    );
    expect(prisma.company.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'company-1', tenantId: 'tenant-1', deletedAt: null },
    }));
    expect(prisma.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        deletedAt: null,
        isActive: true,
      }),
    }));
  });

  it('renders only the selected directors for a directors collection loop', async () => {
    vi.mocked(getCompanyById).mockResolvedValue({
      id: 'company-1',
      name: 'Sample',
      uen: '202600001A',
      officers: [
        { id: 'officer-1', name: 'Alice', role: 'DIRECTOR', address: null, isCurrent: true },
        { id: 'officer-2', name: 'Ben', role: 'DIRECTOR', address: null, isCurrent: true },
      ],
      shareholders: [],
    } as never);
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [
        { id: 'officer-1', contactId: null, name: 'Alice', role: 'DIRECTOR', nationality: null, identificationNumber: null, address: null, appointmentDate: null },
        { id: 'officer-2', contactId: null, name: 'Ben', role: 'DIRECTOR', nationality: null, identificationNumber: null, address: null, appointmentDate: null },
      ],
      shareholders: [],
      contacts: [],
    } as never);
    vi.mocked(prisma.contact.findMany).mockResolvedValue([]);

    const result = await renderTemplateForGeneration({
      tenantId: 'tenant-1',
      companyId: 'company-1',
      selectedDirectorIds: ['officer-2'],
      templateContent: '{{#each directors}}{{this.name}}{{/each}}',
    });

    expect(result.rawResolvedContent).toBe('Ben');
  });
});
