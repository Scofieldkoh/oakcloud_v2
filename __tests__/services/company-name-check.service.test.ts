import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPANY_NAME_MAX_LENGTH,
  CompanyNameCheckUnavailableError,
  checkCompanyNameAvailability,
  normalizeCompanyName,
} from '@/lib/external/company-name-check';
import { prisma } from '@/lib/prisma';
import { getAcraSyncState } from '@/services/acra-sync.service';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    acraEntity: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/services/acra-sync.service', () => ({
  getAcraSyncState: vi.fn(),
}));

const prismaMock = prisma as unknown as {
  acraEntity: { findMany: ReturnType<typeof vi.fn> };
};
const getAcraSyncStateMock = vi.mocked(getAcraSyncState);

const METADATA_LAST_UPDATED = '2026-08-14T14:07:42+08:00';

function dbRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    uen: '201904999E',
    entityName: 'ACME HOLDINGS PTE. LTD.',
    entityStatus: 'Live Company',
    ...overrides,
  };
}

describe('checkCompanyNameAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.acraEntity.findMany.mockResolvedValue([]);
    getAcraSyncStateMock.mockResolvedValue({
      collectionLastUpdatedAt: METADATA_LAST_UPDATED,
      entityCount: 400_000,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns available with the local dataAsOf when no rows match', async () => {
    const result = await checkCompanyNameAvailability('  Zxqkqw   Vmxqkq  ');

    expect(result.available).toBe(true);
    expect(result.records).toEqual([]);
    expect(typeof result.checkedAt).toBe('string');
    expect(result.dataAsOf).toBe(METADATA_LAST_UPDATED);
  });

  it('returns identical local records and marks the name unavailable', async () => {
    prismaMock.acraEntity.findMany.mockResolvedValue([dbRow()]);

    const result = await checkCompanyNameAvailability('Acme Holdings');

    expect(result.available).toBe(false);
    expect(result.assessment).toBe('IDENTICAL');
    expect(result.records).toEqual([
      {
        uen: '201904999E',
        entityName: 'ACME HOLDINGS PTE. LTD.',
        entityStatus: 'Live Company',
        matchType: 'IDENTICAL',
      },
    ]);
  });

  it('queries the local table by distinctive anchors with insensitive contains', async () => {
    await checkCompanyNameAvailability('Acme Holdings');

    expect(prismaMock.acraEntity.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ entityName: { contains: 'ACME', mode: 'insensitive' } }],
      },
      select: { uen: true, entityName: true, entityStatus: true },
      orderBy: { entityName: 'asc' },
      take: 500,
    });
  });

  it('strips company suffix words from the query', async () => {
    await checkCompanyNameAvailability('Acme Pte Ltd');

    const call = prismaMock.acraEntity.findMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([{ entityName: { contains: 'ACME', mode: 'insensitive' } }]);
  });

  it('falls back to a single contains on the normalized name when no search anchors exist', async () => {
    await checkCompanyNameAvailability('A B');

    const call = prismaMock.acraEntity.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      entityName: { contains: 'A B', mode: 'insensitive' },
    });
  });

  it('drops candidate rows that are neither identical nor similar', async () => {
    prismaMock.acraEntity.findMany.mockResolvedValue([
      dbRow({ entityName: 'ACME BAKERY PTE. LTD.' }),
      dbRow({ uen: '222222222B', entityName: 'ACME HOLDINGS (S) PTE. LTD.' }),
    ]);

    const result = await checkCompanyNameAvailability('Acme Holdings (S)');

    expect(result.available).toBe(false);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].uen).toBe('222222222B');
  });

  it('dedupes by UEN', async () => {
    const rows = Array.from({ length: 15 }, (_, index) => dbRow({ uen: `UEN-${index % 5}` }));
    prismaMock.acraEntity.findMany.mockResolvedValue(rows);

    const result = await checkCompanyNameAvailability('Acme Holdings');

    expect(result.records.map((record) => record.uen)).toEqual(['UEN-0', 'UEN-1', 'UEN-2', 'UEN-3', 'UEN-4']);
  });

  it('caps records at 10', async () => {
    const rows = Array.from({ length: 15 }, (_, index) => dbRow({ uen: `UEN-${index}` }));
    prismaMock.acraEntity.findMany.mockResolvedValue(rows);

    const result = await checkCompanyNameAvailability('Acme Holdings');

    expect(result.records).toHaveLength(10);
  });

  it('throws a typed error when the local table has no data yet', async () => {
    getAcraSyncStateMock.mockResolvedValue(null);

    await expect(checkCompanyNameAvailability('Acme Holdings')).rejects.toBeInstanceOf(
      CompanyNameCheckUnavailableError
    );
    expect(prismaMock.acraEntity.findMany).not.toHaveBeenCalled();
  });

  it('throws a typed error when the sync state reports an empty table', async () => {
    getAcraSyncStateMock.mockResolvedValue({ collectionLastUpdatedAt: null, entityCount: 0 });

    await expect(checkCompanyNameAvailability('Acme Holdings')).rejects.toBeInstanceOf(
      CompanyNameCheckUnavailableError
    );
  });

  it('throws a typed error when the local query fails (no live fallback)', async () => {
    prismaMock.acraEntity.findMany.mockRejectedValue(new Error('connection refused'));

    await expect(checkCompanyNameAvailability('Acme Holdings')).rejects.toBeInstanceOf(
      CompanyNameCheckUnavailableError
    );
  });

  it('never calls the data.gov.sg live API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await checkCompanyNameAvailability('Acme Holdings');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects empty names', async () => {
    await expect(checkCompanyNameAvailability('   ')).rejects.toThrow('Company name is required');
  });

  it('rejects names longer than the maximum', async () => {
    const tooLong = 'A'.repeat(COMPANY_NAME_MAX_LENGTH + 1);
    await expect(checkCompanyNameAvailability(tooLong)).rejects.toThrow(
      `Company name must be at most ${COMPANY_NAME_MAX_LENGTH} characters`
    );
  });
});

describe('normalizeCompanyName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeCompanyName('  Acme   Holdings  ')).toBe('Acme Holdings');
  });
});
