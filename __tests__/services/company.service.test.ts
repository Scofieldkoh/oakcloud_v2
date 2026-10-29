/**
 * Company Service Tests
 *
 * Tests for company CRUD operations, multi-tenancy isolation,
 * and business logic validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@/generated/prisma';

// Mock Prisma before importing the service
vi.mock('@/lib/prisma', () => ({
  prisma: {
    company: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    companyFormerName: { findMany: vi.fn() },
    companyAddress: { findMany: vi.fn() },
    companyOfficer: { findMany: vi.fn() },
    companyShareholder: { findMany: vi.fn() },
    shareCapital: { findMany: vi.fn() },
    companyCharge: { findMany: vi.fn() },
    companyAuditor: { findUnique: vi.fn() },
    document: { findMany: vi.fn() },
    companyFinancialPeriod: { findMany: vi.fn() },
    $transaction: vi.fn(),
    tenant: {
      findUnique: vi.fn(),
    },
    acraEntity: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock audit logging
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
  computeChanges: vi.fn(() => []),
}));

// Mock tenant utilities
vi.mock('@/lib/workspace', () => ({
  canAddCompany: vi.fn(() => Promise.resolve(true)),
}));

import { prisma } from '@/lib/prisma';
import {
  getCompanyById,
  getCompanyByUen,
  searchCompanies,
  createCompany,
  updateCompany,
  getCompanyFullDetails,
} from '@/services/company.service';
import type { CreateCompanyInput, UpdateCompanyInput } from '@/lib/validations/company';
import { createAuditLog, computeChanges } from '@/lib/audit';

describe('Company schema contract', () => {
  it('exposes normalized auditor fields through the generated Prisma client', () => {
    expect(
      (Prisma as unknown as Record<string, unknown>).CompanyAuditorScalarFieldEnum
    ).toEqual(expect.objectContaining({
      companyId: 'companyId',
      name: 'name',
      address: 'address',
      appointmentDate: 'appointmentDate',
      sourceDocumentId: 'sourceDocumentId',
    }));
  });
});

describe('Company Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCompanyById', () => {
    it('should require tenantId for non-admin queries', async () => {
      await expect(
        getCompanyById('company-1', null)
      ).rejects.toThrow('Workspace context is required for company queries');
    });

    it('should allow skipTenantFilter for SUPER_ADMIN', async () => {
      const mockCompany = {
        id: 'company-1',
        name: 'Test Company',
        uen: '202312345A',
        tenantId: 'tenant-1',
      };

      vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany as never);

      const result = await getCompanyById('company-1', null, { skipTenantFilter: true });

      expect(result).toEqual(mockCompany);
      expect(prisma.company.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'company-1',
          }),
        })
      );
    });

    it('should attach the ACRA record for the company UEN', async () => {
      const mockCompany = {
        id: 'company-1',
        name: 'Test Company',
        uen: '202312345A',
        tenantId: 'tenant-1',
      };

      vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany as never);
      vi.mocked(prisma.acraEntity.findFirst).mockResolvedValue({
        dataAsOf: '2026-08-14',
        accountDueDate: '2026-12-31',
        annualReturnDate: '2026-07-31',
      } as never);

      const result = await getCompanyById('company-1', 'tenant-1');

      expect(result).toEqual({
        ...mockCompany,
        acraRecord: {
          dataAsOf: '2026-08-14',
          accountDueDate: '2026-12-31',
          annualReturnDate: '2026-07-31',
        },
      });
      expect(prisma.acraEntity.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { uen: { equals: '202312345A', mode: 'insensitive' } },
        })
      );
    });

    it('should trim the stored alias in the detail response without dropping the legal name', async () => {
      const mockCompany = {
        id: 'company-1',
        name: 'Oaktree Accounting & Corporate Solution Pte. Ltd.',
        uen: '202312345A',
        displayAlias: ' OAK ',
        tenantId: 'tenant-1',
      };

      vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany as never);

      const result = await getCompanyById('company-1', 'tenant-1');

      expect(result).toEqual(expect.objectContaining({
        name: 'Oaktree Accounting & Corporate Solution Pte. Ltd.',
        displayAlias: 'OAK',
      }));
    });

    it('should not attach an ACRA record when none exists', async () => {
      const mockCompany = {
        id: 'company-1',
        name: 'Test Company',
        uen: '202312345A',
        tenantId: 'tenant-1',
      };

      vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany as never);
      vi.mocked(prisma.acraEntity.findFirst).mockResolvedValue(null);

      const result = await getCompanyById('company-1', 'tenant-1');

      expect(result).toEqual(mockCompany);
    });

    it('should filter by tenantId for regular queries', async () => {
      const mockCompany = {
        id: 'company-1',
        name: 'Test Company',
        uen: '202312345A',
        tenantId: 'tenant-1',
      };

      vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany as never);

      await getCompanyById('company-1', 'tenant-1');

      expect(prisma.company.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'company-1',
            tenantId: 'tenant-1',
          }),
        })
      );
    });

    it('should exclude soft-deleted companies by default', async () => {
      vi.mocked(prisma.company.findFirst).mockResolvedValue(null);

      await getCompanyById('company-1', 'tenant-1');

      expect(prisma.company.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
          }),
        })
      );
    });

    it('should include soft-deleted when requested', async () => {
      vi.mocked(prisma.company.findFirst).mockResolvedValue(null);

      await getCompanyById('company-1', 'tenant-1', { includeDeleted: true });

      // Should NOT have deletedAt: null in where clause
      const call = vi.mocked(prisma.company.findFirst).mock.calls[0][0];
      expect(call?.where).not.toHaveProperty('deletedAt');
    });
  });

  describe('getCompanyByUen', () => {
    it('should find company by UEN within tenant', async () => {
      const mockCompany = {
        id: 'company-1',
        name: 'Test Company',
        uen: '202312345A',
        tenantId: 'tenant-1',
      };

      vi.mocked(prisma.company.findFirst).mockResolvedValue(mockCompany as never);

      const result = await getCompanyByUen('202312345A', 'tenant-1');

      expect(result).toEqual(mockCompany);
      expect(prisma.company.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            uen: '202312345A',
            tenantId: 'tenant-1',
          }),
        })
      );
    });

    it('should return null for non-existent UEN', async () => {
      vi.mocked(prisma.company.findFirst).mockResolvedValue(null);

      const result = await getCompanyByUen('NOTEXIST', 'tenant-1');

      expect(result).toBeNull();
    });

    it('should trim the alias while preserving the UEN lookup result', async () => {
      vi.mocked(prisma.company.findFirst).mockResolvedValue({
        id: 'company-1',
        name: 'Oaktree Accounting & Corporate Solution Pte. Ltd.',
        uen: '202312345A',
        displayAlias: ' OAK ',
        tenantId: 'tenant-1',
      } as never);

      const result = await getCompanyByUen('202312345A', 'tenant-1');

      expect(result).toEqual(expect.objectContaining({
        uen: '202312345A',
        displayAlias: 'OAK',
      }));
    });
  });

  describe('getCompanyFullDetails', () => {
    it('propagates a normalized alias and existing scalar fields', async () => {
      vi.mocked(prisma.company.findFirst).mockResolvedValue({
        id: 'company-1',
        name: 'Oaktree Accounting & Corporate Solution Pte. Ltd.',
        uen: '202312345A',
        displayAlias: ' OAK ',
        tenantId: 'tenant-1',
      } as never);
      vi.mocked(prisma.companyFormerName.findMany).mockResolvedValue([]);
      vi.mocked(prisma.companyAddress.findMany).mockResolvedValue([]);
      vi.mocked(prisma.companyOfficer.findMany).mockResolvedValue([]);
      vi.mocked(prisma.companyShareholder.findMany).mockResolvedValue([]);
      vi.mocked(prisma.shareCapital.findMany).mockResolvedValue([]);
      vi.mocked(prisma.companyCharge.findMany).mockResolvedValue([]);
      vi.mocked(prisma.companyAuditor.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.document.findMany).mockResolvedValue([]);
      vi.mocked(prisma.companyFinancialPeriod.findMany).mockResolvedValue([]);

      const result = await getCompanyFullDetails('company-1', 'tenant-1');

      expect(result).toEqual(expect.objectContaining({
        name: 'Oaktree Accounting & Corporate Solution Pte. Ltd.',
        uen: '202312345A',
        displayAlias: 'OAK',
      }));
    });

    it('includes the first confirmed financial period for the Compliance card', async () => {
      vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: 'company-1', name: 'Bordeus Pte Ltd', tenantId: 'tenant-1' } as never);
      for (const model of [prisma.companyFormerName, prisma.companyAddress, prisma.companyOfficer, prisma.companyShareholder, prisma.shareCapital, prisma.companyCharge, prisma.document]) {
        vi.mocked(model.findMany).mockResolvedValue([] as never);
      }
      vi.mocked(prisma.companyAuditor.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.companyFinancialPeriod.findMany).mockResolvedValue([
        { periodStart: new Date('2026-10-03'), periodEnd: new Date('2026-12-31'), yearsOfAssessment: [2027] },
      ] as never);

      const result = await getCompanyFullDetails('company-1', 'tenant-1');

      expect(prisma.companyFinancialPeriod.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { companyId: 'company-1', provenance: 'CONFIRMED' },
        take: 1,
      }));
      expect((result as { financialPeriods?: Array<{ periodEnd: unknown }> } | null)?.financialPeriods?.[0]?.periodEnd).toBeDefined();
    });
  });

  // Default search params for tests
  const defaultSearchParams = {
    page: 1,
    limit: 20,
    sortBy: 'updatedAt' as const,
    sortOrder: 'desc' as const,
  };

  describe('searchCompanies', () => {
    it('should filter by tenantId', async () => {
      vi.mocked(prisma.company.findMany).mockResolvedValue([]);
      vi.mocked(prisma.company.count).mockResolvedValue(0);

      // searchCompanies(params, tenantId, options)
      await searchCompanies(defaultSearchParams, 'tenant-1');

      expect(prisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
          }),
        })
      );
    });

    it('should search by query string (name, UEN, SSIC)', async () => {
      vi.mocked(prisma.company.findMany).mockResolvedValue([]);
      vi.mocked(prisma.company.count).mockResolvedValue(0);

      await searchCompanies({ ...defaultSearchParams, query: 'test' }, 'tenant-1');

      expect(prisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.anything() }),
              expect.objectContaining({ uen: expect.anything() }),
            ]),
          }),
        })
      );
    });

    it('should filter by entity type', async () => {
      vi.mocked(prisma.company.findMany).mockResolvedValue([]);
      vi.mocked(prisma.company.count).mockResolvedValue(0);

      await searchCompanies({ ...defaultSearchParams, entityType: 'PRIVATE_LIMITED' }, 'tenant-1');

      expect(prisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entityType: 'PRIVATE_LIMITED',
          }),
        })
      );
    });

    it('should filter by status', async () => {
      vi.mocked(prisma.company.findMany).mockResolvedValue([]);
      vi.mocked(prisma.company.count).mockResolvedValue(0);

      await searchCompanies({ ...defaultSearchParams, status: 'LIVE' }, 'tenant-1');

      expect(prisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'LIVE',
          }),
        })
      );
    });

    it('should paginate results', async () => {
      vi.mocked(prisma.company.findMany).mockResolvedValue([]);
      vi.mocked(prisma.company.count).mockResolvedValue(100);

      const result = await searchCompanies({ ...defaultSearchParams, page: 2, limit: 20 }, 'tenant-1');

      expect(prisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20, // (page - 1) * limit = (2 - 1) * 20
          take: 20,
        })
      );
      expect(result.page).toBe(2);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(5); // 100 / 20
    });

    it('should restrict to companyIds for company-scoped users', async () => {
      vi.mocked(prisma.company.findMany).mockResolvedValue([]);
      vi.mocked(prisma.company.count).mockResolvedValue(0);

      await searchCompanies(defaultSearchParams, 'tenant-1', { companyIds: ['company-1', 'company-2'] });

      expect(prisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['company-1', 'company-2'] },
          }),
        })
      );
    });

    it('should trim stored aliases in search results without dropping existing fields', async () => {
      vi.mocked(prisma.company.findMany).mockResolvedValue([{
        id: 'company-1',
        name: 'Oaktree Accounting & Corporate Solution Pte. Ltd.',
        uen: '202312345A',
        displayAlias: ' OAK ',
        tenantId: 'tenant-1',
        addresses: [],
      }] as never);
      vi.mocked(prisma.company.count).mockResolvedValue(1);

      const result = await searchCompanies(defaultSearchParams, 'tenant-1');

      expect(result.companies[0]).toEqual(expect.objectContaining({
        name: 'Oaktree Accounting & Corporate Solution Pte. Ltd.',
        displayAlias: 'OAK',
      }));
    });
  });

  // Default company data for tests - cast to CreateCompanyInput since Zod transforms are complex
  const defaultCompanyData = {
    name: 'New Company Pte Ltd',
    uen: '202400001A',
    entityType: 'PRIVATE_LIMITED',
    status: 'LIVE',
    dateOfNameChange: null,
    statusDate: null,
    incorporationDate: null,
    registrationDate: null,
    dateOfAddress: null,
    primarySsicCode: null,
    primarySsicDescription: null,
    secondarySsicCode: null,
    secondarySsicDescription: null,
    fyeAsAtLastAr: null,
    gstRegistrationDate: null,
  } as CreateCompanyInput;

  describe('createCompany', () => {
    it('should create company with tenantId', async () => {
      const mockCompany = {
        id: 'new-company',
        name: 'New Company Pte Ltd',
        uen: '202400001A',
        tenantId: 'tenant-1',
      };

      // Mock findFirst to return null (no existing UEN)
      vi.mocked(prisma.company.findFirst).mockResolvedValue(null);
      // Mock create to return new company
      vi.mocked(prisma.company.create).mockResolvedValue(mockCompany as never);

      const result = await createCompany(
        defaultCompanyData,
        { tenantId: 'tenant-1', userId: 'user-1' }
      );

      expect(result.name).toBe('New Company Pte Ltd');
    });

    it('should trim a provided alias without persisting a derived fallback', async () => {
      const mockCompany = {
        id: 'new-company',
        name: 'New Company Pte Ltd',
        uen: '202400001A',
        displayAlias: 'OAK',
        tenantId: 'tenant-1',
      };

      vi.mocked(prisma.company.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.company.create).mockResolvedValue(mockCompany as never);

      await createCompany(
        { ...defaultCompanyData, displayAlias: ' OAK ' },
        { tenantId: 'tenant-1', userId: 'user-1' },
      );

      expect(prisma.company.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ displayAlias: 'OAK' }),
      }));
      expect(prisma.company.create).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ displayAlias: 'NCP' }),
      }));
    });

    it('should normalize a blank alias to null when updating a company', async () => {
      const existingCompany = {
        id: 'company-1',
        name: 'Example Company Pte Ltd',
        uen: '202400001A',
        tenantId: 'tenant-1',
        deletedAt: null,
      };
      const txCompany = {
        update: vi.fn().mockResolvedValue({ ...existingCompany, displayAlias: null }),
      };
      const tx = {
        company: txCompany,
        companyAddress: { findFirst: vi.fn() },
      };

      vi.mocked(prisma.company.findFirst).mockResolvedValue(existingCompany as never);
      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never) as never);

      await updateCompany(
        { id: 'company-1', displayAlias: '   ' } as UpdateCompanyInput,
        { tenantId: 'tenant-1', userId: 'user-1' },
      );

      expect(txCompany.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ displayAlias: null }),
      }));
    });

    it('should serialize a legacy-whitespace alias when updating an unrelated field', async () => {
      const existingCompany = {
        id: 'company-1',
        name: 'Example Company Pte Ltd',
        uen: '202400001A',
        displayAlias: ' OAK ',
        tenantId: 'tenant-1',
        deletedAt: null,
      };
      const txCompany = {
        update: vi.fn().mockResolvedValue({ ...existingCompany, status: 'LIVE' }),
      };
      const tx = { company: txCompany, companyAddress: { findFirst: vi.fn() } };

      vi.mocked(prisma.company.findFirst).mockResolvedValue(existingCompany as never);
      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never) as never);

      const result = await updateCompany(
        { id: 'company-1', status: 'LIVE' } as UpdateCompanyInput,
        { tenantId: 'tenant-1', userId: 'user-1' },
      );

      expect(result).toEqual(expect.objectContaining({
        status: 'LIVE',
        displayAlias: 'OAK',
      }));
    });

    it('should audit a blank alias as canonical null when clearing it', async () => {
      const existingCompany = {
        id: 'company-1',
        name: 'Example Company Pte Ltd',
        uen: '202400001A',
        displayAlias: 'OAK',
        tenantId: 'tenant-1',
        deletedAt: null,
      };
      const txCompany = {
        update: vi.fn().mockResolvedValue({ ...existingCompany, displayAlias: null }),
      };
      const tx = { company: txCompany, companyAddress: { findFirst: vi.fn() } };

      vi.mocked(prisma.company.findFirst).mockResolvedValue(existingCompany as never);
      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never) as never);
      vi.mocked(computeChanges).mockReturnValue({ displayAlias: { old: 'OAK', new: null } });

      await updateCompany(
        { id: 'company-1', displayAlias: '   ' } as UpdateCompanyInput,
        { tenantId: 'tenant-1', userId: 'user-1' },
      );

      expect(computeChanges).toHaveBeenCalledWith(
        existingCompany,
        expect.objectContaining({ displayAlias: null }),
        expect.arrayContaining(['displayAlias']),
      );
      expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        changes: { displayAlias: { old: 'OAK', new: null } },
      }));
    });

    it('does not enqueue reconciliation when a schedule source is submitted unchanged', async () => {
      const existingCompany = {
        id: 'company-1',
        name: 'Example Company Pte Ltd',
        uen: '202400001A',
        entityType: 'PRIVATE_LIMITED',
        incorporationDate: new Date('2020-01-01T00:00:00.000Z'),
        financialYearEndDay: 31,
        financialYearEndMonth: 12,
        accountsDueDate: null,
        tenantId: 'tenant-1',
        deletedAt: null,
      };
      const txCompany = {
        update: vi.fn().mockResolvedValue({ ...existingCompany }),
      };
      const tx = { company: txCompany, companyAddress: { findFirst: vi.fn() } };

      vi.mocked(prisma.company.findFirst).mockResolvedValue(existingCompany as never);
      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never) as never);

      await expect(updateCompany(
        {
          id: 'company-1',
          entityType: 'PRIVATE_LIMITED',
          incorporationDate: '2020-01-01',
          financialYearEndDay: 31,
          financialYearEndMonth: 12,
          accountsDueDate: null,
        } as UpdateCompanyInput,
        { tenantId: 'tenant-1', userId: 'user-1' },
      )).resolves.toMatchObject({ id: 'company-1' });
    });

    it('should reject duplicate UEN within tenant', async () => {
      const existingCompany = {
        id: 'existing-company',
        name: 'Existing Company',
        uen: '202400001A',
        tenantId: 'tenant-1',
      };

      // Mock findFirst to return existing company (UEN already exists)
      vi.mocked(prisma.company.findFirst).mockResolvedValue(existingCompany as never);

      await expect(
        createCompany(
          { ...defaultCompanyData, name: 'Duplicate Company' },
          { tenantId: 'tenant-1', userId: 'user-1' }
        )
      ).rejects.toThrow('already exists');
    });
  });

  describe('Multi-tenancy Isolation', () => {
    it('should not return companies from other tenants', async () => {
      // Company exists in tenant-2 but we query tenant-1
      vi.mocked(prisma.company.findFirst).mockResolvedValue(null);

      const result = await getCompanyById('company-from-tenant-2', 'tenant-1');

      expect(result).toBeNull();
      expect(prisma.company.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
          }),
        })
      );
    });

    it('should allow same UEN in different tenants', async () => {
      // Same UEN can exist in different tenants
      const tenant1Company = {
        id: 'company-t1',
        name: 'Company in Tenant 1',
        uen: '202400001A',
        tenantId: 'tenant-1',
      };

      vi.mocked(prisma.company.findFirst).mockResolvedValue(tenant1Company as never);

      const result = await getCompanyByUen('202400001A', 'tenant-1');

      expect(result?.tenantId).toBe('tenant-1');
    });
  });
});
