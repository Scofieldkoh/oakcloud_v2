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
      count: vi.fn(),
    },
    acraSyncState: {
      findUnique: vi.fn(),
    },
  },
}));

const prismaMock = prisma as unknown as {
  acraEntity: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  acraSyncState: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

const ADMIN_SESSION = {
  isSuperAdmin: true,
  isWorkspaceAdmin: false,
  tenantId: 'tenant-1',
};

function acraRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    address: '123 MAIN STREET ACME BUILDING #05-01 SINGAPORE 123456',
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
    createdAt: '2026-08-14T06:07:42.000Z',
    updatedAt: '2026-08-14T06:07:42.000Z',
    ...overrides,
  };
}

async function callGet(url: string): Promise<Response> {
  const { GET } = await import('@/app/api/admin/acra-records/route');
  return GET(new Request(`http://localhost${url}`) as NextRequest);
}

describe('GET /api/admin/acra-records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(ADMIN_SESSION);
    mocks.isAdmin.mockImplementation(
      (user: { isSuperAdmin?: boolean; isWorkspaceAdmin?: boolean }) =>
        !!user.isSuperAdmin || !!user.isWorkspaceAdmin
    );
    prismaMock.acraEntity.findMany.mockResolvedValue([acraRecord()]);
    prismaMock.acraEntity.count.mockResolvedValue(466_583);
    prismaMock.acraSyncState.findUnique.mockResolvedValue({
      id: 'main',
      collectionLastUpdatedAt: '2026-08-14T14:07:42+08:00',
      entityCount: 466_583,
      lastStartedAt: null,
      lastCompletedAt: new Date('2026-08-14T12:10:45Z'),
      lastError: null,
    });
  });

  it('returns records, pagination, and the sync state summary', async () => {
    const response = await callGet('/api/admin/acra-records?page=2&limit=20&sortBy=uen&sortOrder=desc');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      records: [acraRecord()],
      total: 466_583,
      page: 2,
      limit: 20,
      totalPages: 23_330,
      syncState: {
        collectionLastUpdatedAt: '2026-08-14T14:07:42+08:00',
        entityCount: 466_583,
        lastStartedAt: null,
        lastCompletedAt: expect.any(String),
        lastError: null,
      },
    });

    expect(prismaMock.acraEntity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: { uen: 'desc' },
        skip: 20,
        take: 20,
      })
    );
  });

  it('applies search and inline filters to the query', async () => {
    await callGet(
      '/api/admin/acra-records?search=oaktree&uen=2024&entityName=accounting&entityStatus=liquidation&entityType=local%20company'
    );

    const call = prismaMock.acraEntity.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      AND: [
        {
          OR: [
            { entityName: { contains: 'oaktree', mode: 'insensitive' } },
            { uen: { contains: 'oaktree', mode: 'insensitive' } },
          ],
        },
        { uen: { contains: '2024', mode: 'insensitive' } },
        { entityName: { contains: 'accounting', mode: 'insensitive' } },
        { entityStatus: { contains: 'liquidation', mode: 'insensitive' } },
        { entityType: { contains: 'local company', mode: 'insensitive' } },
      ],
    });
    expect(prismaMock.acraEntity.count).toHaveBeenCalledWith({ where: call.where });
  });

  it('applies date range filters for the date columns', async () => {
    await callGet(
      '/api/admin/acra-records?dataAsOfFrom=2026-08-01&dataAsOfTo=2026-08-31&createdAtFrom=2026-07-01&createdAtTo=2026-07-31&updatedAtFrom=2026-06-01'
    );

    const call = prismaMock.acraEntity.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      AND: [
        {
          dataAsOf: {
            gte: '2026-08-01T00:00:00+08:00',
            lte: '2026-08-31T23:59:59+08:00',
          },
        },
        {
          createdAt: {
            gte: new Date('2026-07-01T00:00:00.000Z'),
            lte: new Date('2026-07-31T23:59:59.999Z'),
          },
        },
        {
          updatedAt: {
            gte: new Date('2026-06-01T00:00:00.000Z'),
          },
        },
      ],
    });
  });

  it('applies text filters on the extended columns and date ranges on stored date strings', async () => {
    await callGet(
      '/api/admin/acra-records?primarySsicCode=6920&address=main%20street&registrationIncorporateDateFrom=2019-01-01&registrationIncorporateDateTo=2019-12-31&accountDueDateFrom=2026-01-01'
    );

    const call = prismaMock.acraEntity.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      AND: [
        { address: { contains: 'main street', mode: 'insensitive' } },
        { primarySsicCode: { contains: '6920', mode: 'insensitive' } },
        {
          registrationIncorporateDate: {
            gte: '2019-01-01',
            lte: '2019-12-31',
          },
        },
        {
          accountDueDate: {
            gte: '2026-01-01',
          },
        },
      ],
    });
  });

  it('falls back to entityName asc for unknown sort fields', async () => {
    await callGet('/api/admin/acra-records?sortBy=__evil__&sortOrder=desc');

    const call = prismaMock.acraEntity.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ entityName: 'asc' });
  });

  it('clamps the limit to the maximum', async () => {
    await callGet('/api/admin/acra-records?limit=9999');

    const call = prismaMock.acraEntity.findMany.mock.calls[0][0];
    expect(call.take).toBe(200);
  });

  it('returns 403 for non-admin users', async () => {
    mocks.isAdmin.mockReturnValue(false);

    const response = await callGet('/api/admin/acra-records');

    expect(response.status).toBe(403);
    expect(prismaMock.acraEntity.findMany).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.requireAuth.mockRejectedValue(new Error('Unauthorized'));

    const response = await callGet('/api/admin/acra-records');

    expect(response.status).toBe(401);
  });
});
