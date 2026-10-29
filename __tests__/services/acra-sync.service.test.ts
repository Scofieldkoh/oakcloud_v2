import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  getAcraCollectionLastUpdatedAt,
  getAcraSyncState,
  syncAcraDataIfUpdated,
} from '@/services/acra-sync.service';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    acraEntity: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    company: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    acraSyncState: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

const prismaMock = prisma as unknown as {
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
  acraEntity: {
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  company: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  acraSyncState: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

/** The SQL string of the last $queryRawUnsafe call. */
function lastUpsertSql(): string {
  const call = prismaMock.$queryRawUnsafe.mock.calls.at(-1)!;
  return call[0] as string;
}

/** Flatten the bound values of the last $queryRawUnsafe call (deep). */
function lastUpsertValues(): unknown[] {
  const call = prismaMock.$queryRawUnsafe.mock.calls.at(-1)!;
  const out: unknown[] = [];

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    out.push(value);
  };

  walk(call.slice(1));
  return out;
}

const OLD_DATE = '2026-07-12T02:03:04+08:00';
const NEW_DATE = '2026-08-14T14:07:42+08:00';

const CSV_FIXTURE = [
  'uen,entity_name,entity_status_description,entity_type_description,issuance_agency_id',
  '201904999E,ACME HOLDINGS PTE. LTD.,Live Company,Local Company,UEN',
  '202000001A,BETA ENTERPRISES,Struck Off,Local Company,UEN',
  '202000002B,GAMMA PTE. LTD.,Live Company,Business,UEN',
  '202000003C,DELTA CONSULTING PTE. LTD.,Live Company,Foreign Company,UEN',
].join('\n');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function csvResponse(csv: string): Response {
  return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv' } });
}

type FetchMock = ReturnType<typeof vi.fn>;

/**
 * Default fetch stub: metadata returns NEW_DATE, every dataset immediately
 * hands back a download URL and the CSV download returns the fixture.
 */
function stubSuccessfulFetch(): FetchMock {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/collections/2/metadata')) {
      return jsonResponse({ data: { collectionMetadata: { lastUpdatedAt: NEW_DATE } } });
    }
    if (url.includes('initiate-download')) {
      return jsonResponse({ data: { url: 'https://s3.example.test/acra.csv' } }, 201);
    }
    if (url.includes('poll-download')) {
      return jsonResponse({ data: { status: 'DOWNLOAD_SUCCESS', url: 'https://s3.example.test/acra.csv' } }, 201);
    }
    if (url.includes('s3.example.test')) {
      return csvResponse(CSV_FIXTURE);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('acra-sync.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$queryRawUnsafe.mockResolvedValue(0);
    prismaMock.acraEntity.createMany.mockResolvedValue({ count: 2 });
    prismaMock.acraEntity.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.acraEntity.count.mockResolvedValue(54);
    prismaMock.acraSyncState.findUnique.mockResolvedValue({
      id: 'main',
      collectionLastUpdatedAt: OLD_DATE,
      entityCount: 54,
      lastStartedAt: null,
      lastCompletedAt: new Date('2026-07-12T02:00:00Z'),
      lastError: null,
      updatedAt: new Date(),
    });
    prismaMock.acraSyncState.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.acraSyncState.upsert.mockResolvedValue({});
    prismaMock.acraSyncState.create.mockResolvedValue({});
    prismaMock.company.findMany.mockResolvedValue([]);
    prismaMock.company.update.mockResolvedValue({});
    prismaMock.acraEntity.findMany.mockResolvedValue([]);
    vi.stubEnv('ACRA_SYNC_SLEEP_MS', '0');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('getAcraCollectionLastUpdatedAt', () => {
    it('returns the collection last-updated time', async () => {
      stubSuccessfulFetch();

      await expect(getAcraCollectionLastUpdatedAt()).resolves.toBe(NEW_DATE);
    });

    it('returns null when metadata is unavailable', async () => {
      const fetchMock = vi.fn(async () => new Response('down', { status: 503 }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(getAcraCollectionLastUpdatedAt()).resolves.toBeNull();
    });
  });

  describe('getAcraSyncState', () => {
    it('returns the sync state row', async () => {
      await getAcraSyncState();

      expect(prismaMock.acraSyncState.findUnique).toHaveBeenCalledWith({ where: { id: 'main' } });
    });
  });

  describe('syncAcraDataIfUpdated', () => {
    it('imports all datasets and swaps in the new snapshot when the updated date changed', async () => {
      stubSuccessfulFetch();

      const result = await syncAcraDataIfUpdated();

      expect(result).toEqual({ synced: true, skipped: false, entityCount: 54, dataAsOf: NEW_DATE, companiesUpdated: 0 });

      // 27 datasets, one bulk upsert per dataset
      expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledTimes(27);

      const sql = lastUpsertSql();
      expect(sql).toContain('INSERT INTO "acra_entity"');
      expect(sql).toContain('ON CONFLICT ("uen") DO UPDATE SET');
      expect(sql).toContain('"company_type_description" = EXCLUDED."company_type_description"');
      expect(sql).toContain('"uen_of_audit_firm1" = EXCLUDED."uen_of_audit_firm1"');
      expect(sql).toContain('"updated_at" = NOW()');

      // The filtered rows are bound as unnest arrays
      const values = lastUpsertValues();
      expect(values).toContain('201904999E');
      expect(values).toContain('202000003C');
      expect(values).not.toContain('202000001A');
      expect(values).not.toContain('202000002B');

      // Stale rows are deleted only after every dataset was imported
      expect(prismaMock.acraEntity.deleteMany).toHaveBeenCalledWith({
        where: { dataAsOf: { not: NEW_DATE } },
      });

      expect(prismaMock.acraSyncState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'main' },
          create: expect.objectContaining({ id: 'main', collectionLastUpdatedAt: NEW_DATE, entityCount: 54 }),
          update: expect.objectContaining({
            collectionLastUpdatedAt: NEW_DATE,
            entityCount: 54,
            lastError: null,
            lastStartedAt: null,
          }),
        })
      );
    });

    it('updates company compliance dates from the freshly synced records', async () => {
      stubSuccessfulFetch();
      prismaMock.company.findMany.mockResolvedValue([
        { id: 'company-a', uen: '201904999E', lastArFiledDate: new Date('2025-01-01T00:00:00.000Z'), accountsDueDate: null },
        { id: 'company-b', uen: '202000003C', lastArFiledDate: new Date('2027-01-01T00:00:00.000Z'), accountsDueDate: new Date('2027-07-31T00:00:00.000Z') },
        { id: 'company-c', uen: '999999999Z', lastArFiledDate: null, accountsDueDate: null },
      ] as never);
      prismaMock.acraEntity.findMany.mockResolvedValue([
        { uen: '201904999E', annualReturnDate: '2026-06-28', accountDueDate: '2026-07-31' },
        { uen: '202000003C', annualReturnDate: 'na', accountDueDate: '2026-06-30' },
      ] as never);

      const result = await syncAcraDataIfUpdated();

      expect(result.synced).toBe(true);
      expect(result.companiesUpdated).toBe(1);
      expect(prismaMock.company.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.company.update).toHaveBeenCalledWith({
        where: { id: 'company-a' },
        data: {
          lastArFiledDate: new Date('2026-06-28T00:00:00.000Z'),
          accountsDueDate: new Date('2026-07-31T00:00:00.000Z'),
        },
      });
    });

    it('skips the import when the stored updated date matches the API', async () => {
      prismaMock.acraSyncState.findUnique.mockResolvedValue({
        id: 'main',
        collectionLastUpdatedAt: NEW_DATE,
        entityCount: 54,
        lastStartedAt: null,
        lastCompletedAt: new Date(),
        lastError: 'previous error',
        updatedAt: new Date(),
      });
      const fetchMock = stubSuccessfulFetch();

      const result = await syncAcraDataIfUpdated();

      expect(result.skipped).toBe(true);
      expect(result.synced).toBe(false);
      expect(result.entityCount).toBe(54);
      expect(result.dataAsOf).toBe(NEW_DATE);

      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes('initiate-download'))).toBe(false);
      expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(prismaMock.acraEntity.deleteMany).not.toHaveBeenCalled();

      expect(prismaMock.acraSyncState.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'main' },
          data: expect.objectContaining({ lastStartedAt: null, lastError: null }),
        })
      );
    });

    it('re-imports even when dates match when forced', async () => {
      prismaMock.acraSyncState.findUnique.mockResolvedValue({
        id: 'main',
        collectionLastUpdatedAt: NEW_DATE,
        entityCount: 54,
        lastStartedAt: null,
        lastCompletedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      });
      stubSuccessfulFetch();

      const result = await syncAcraDataIfUpdated({ force: true });

      expect(result.synced).toBe(true);
      expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledTimes(27);
    });

    it('skips when another sync run holds the lock', async () => {
      prismaMock.acraSyncState.findUnique.mockResolvedValue({
        id: 'main',
        collectionLastUpdatedAt: OLD_DATE,
        entityCount: 54,
        lastStartedAt: new Date(),
        lastCompletedAt: null,
        lastError: null,
        updatedAt: new Date(),
      });
      prismaMock.acraSyncState.updateMany.mockResolvedValue({ count: 0 });

      const result = await syncAcraDataIfUpdated();

      expect(result).toEqual({
        synced: false,
        skipped: true,
        reason: 'lock',
        entityCount: 0,
        dataAsOf: null,
        companiesUpdated: 0,
      });
      expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('claims the lock by creating the state row on first run', async () => {
      prismaMock.acraSyncState.findUnique.mockResolvedValue(null);
      stubSuccessfulFetch();

      const result = await syncAcraDataIfUpdated();

      expect(result.synced).toBe(true);
      expect(prismaMock.acraSyncState.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ id: 'main', lastStartedAt: expect.any(Date) }) })
      );
    });

    it('polls the download endpoint when initiate does not return a URL', async () => {
      let pollCount = 0;
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/collections/2/metadata')) {
          return jsonResponse({ data: { collectionMetadata: { lastUpdatedAt: NEW_DATE } } });
        }
        if (url.includes('initiate-download')) {
          return jsonResponse({ data: { status: 'DOWNLOAD_PROCESSING' } }, 201);
        }
        if (url.includes('poll-download')) {
          pollCount += 1;
          if (pollCount % 2 === 1) return jsonResponse({ data: { status: 'DOWNLOAD_PROCESSING' } }, 201);
          return jsonResponse({ data: { status: 'DOWNLOAD_SUCCESS', url: 'https://s3.example.test/acra.csv' } }, 201);
        }
        if (url.includes('s3.example.test')) return csvResponse(CSV_FIXTURE);
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await syncAcraDataIfUpdated();

      expect(result.synced).toBe(true);
      expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledTimes(27);
      expect(pollCount).toBe(54);
    });

    it('records the failure and keeps existing rows when a dataset fails mid-sync', async () => {
      let initiateCount = 0;
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/collections/2/metadata')) {
          return jsonResponse({ data: { collectionMetadata: { lastUpdatedAt: NEW_DATE } } });
        }
        if (url.includes('initiate-download')) {
          initiateCount += 1;
          if (initiateCount > 5) throw new Error('download rate limited (429)');
          return jsonResponse({ data: { url: 'https://s3.example.test/acra.csv' } }, 201);
        }
        if (url.includes('s3.example.test')) return csvResponse(CSV_FIXTURE);
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await syncAcraDataIfUpdated();

      expect(result.synced).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.error).toContain('429');
      expect(prismaMock.acraEntity.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.acraSyncState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ lastError: expect.any(String), lastStartedAt: null }),
        })
      );
    });

    it('fails when the collection metadata cannot be read', async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/collections/2/metadata')) return new Response('down', { status: 503 });
        return jsonResponse({ data: { url: 'https://s3.example.test/acra.csv' } }, 201);
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await syncAcraDataIfUpdated();

      expect(result.synced).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.error).toContain('last-updated');
      expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
    });
  });
});
