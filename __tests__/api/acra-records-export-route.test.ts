import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isAdmin: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
  isAdmin: mocks.isAdmin,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    acraEntity: {
      findMany: vi.fn(),
    },
  },
}));

const prismaMock = prisma as unknown as {
  acraEntity: {
    findMany: ReturnType<typeof vi.fn>;
  };
};

function acraRecord() {
  return {
    id: 'record-1',
    uen: '201904999E',
    entityName: 'ACME HOLDINGS PTE. LTD.',
    entityStatus: 'Live Company',
    entityType: 'Local Company',
    companyTypeDescription: 'EXEMPT PRIVATE COMPANY LIMITED BY SHARES',
    registrationIncorporateDate: '04/05/2019',
    block: '123',
    streetName: 'MAIN STREET',
    levelNo: '05',
    unitNo: '01',
    buildingName: 'ACME BUILDING',
    postalCode: '123456',
    address: '123 MAIN STREET\nACME BUILDING #05-01',
    accountDueDate: '04/11/2026',
    annualReturnDate: '04/05/2026',
    primarySsicCode: '69201',
    primarySsicDescription: 'ACCOUNTING AND AUDITING SERVICES',
    secondarySsicCode: '70201',
    secondarySsicDescription: 'MANAGEMENT CONSULTANCY SERVICES',
    noOfOfficers: '3',
    formerEntityName1: 'OLD ACME PTE. LTD.',
    uenOfAuditFirm1: 'T08LL0001A',
    dataAsOf: '2026-08-14T14:07:42+08:00',
    createdAt: new Date('2026-08-14T06:07:42.000Z'),
    updatedAt: new Date('2026-08-14T06:07:42.000Z'),
  };
}

async function callGet(url: string): Promise<Response> {
  const { GET } = await import('@/app/api/admin/acra-records/export/route');
  return GET(new Request(`http://localhost${url}`) as NextRequest);
}

describe('GET /api/admin/acra-records/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ isSuperAdmin: true, isWorkspaceAdmin: false });
    mocks.isAdmin.mockReturnValue(true);
    prismaMock.acraEntity.findMany.mockResolvedValue([acraRecord()]);
  });

  it('exports every AcraEntity column as a streamed CSV', async () => {
    const response = await callGet('/api/admin/acra-records/export');
    // Response.text() strips a leading BOM, so decode the raw bytes to keep it.
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toMatch(/acra-records-\d{4}-\d{2}-\d{2}\.csv/);
    expect(csv.split('\r\n')[0]).toBe(
      '\uFEFFid,uen,entity_name,entity_status,entity_type,company_type_description,registration_incorporate_date,block,street_name,level_no,unit_no,building_name,postal_code,address,account_due_date,annual_return_date,primary_ssic_code,primary_ssic_description,secondary_ssic_code,secondary_ssic_description,no_of_officers,former_entity_name1,uen_of_audit_firm1,data_as_of,created_at,updated_at'
    );
    expect(csv).toContain('record-1,201904999E,ACME HOLDINGS PTE. LTD.');
    expect(csv).toContain('"123 MAIN STREET\nACME BUILDING #05-01"');
    expect(csv).toContain('2026-08-14T06:07:42.000Z,2026-08-14T06:07:42.000Z');
    expect(prismaMock.acraEntity.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { uen: 'asc' },
      take: 1_000,
    });
  });

  it('reuses list filters for the complete export', async () => {
    await callGet('/api/admin/acra-records/export?search=oaktree&entityType=local%20company&createdAtFrom=2026-07-01');

    expect(prismaMock.acraEntity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          {
            OR: [
              { entityName: { contains: 'oaktree', mode: 'insensitive' } },
              { uen: { contains: 'oaktree', mode: 'insensitive' } },
            ],
          },
          { entityType: { contains: 'local company', mode: 'insensitive' } },
          { createdAt: { gte: new Date('2026-07-01T00:00:00.000Z') } },
        ],
      },
    }));
  });

  it('returns 403 for non-admin users', async () => {
    mocks.isAdmin.mockReturnValue(false);

    const response = await callGet('/api/admin/acra-records/export');

    expect(response.status).toBe(403);
    expect(prismaMock.acraEntity.findMany).not.toHaveBeenCalled();
  });
});
