import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  findMany: vi.fn(),
  queryRaw: vi.fn(),
  decisionFindMany: vi.fn(),
  decisionUpsert: vi.fn(),
  transaction: vi.fn(),
  txQueryRaw: vi.fn(), txGate: vi.fn(),
  txFindMany: vi.fn(),
  txDecisionUpsert: vi.fn(),
  createAuditLog: vi.fn(),
  documentFindMany: vi.fn(),
  vendorAliasFindMany: vi.fn(),
  customerAliasFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    contact: { groupBy: mocks.groupBy, findMany: mocks.findMany },
    contactDuplicateDecision: {
      findMany: mocks.decisionFindMany,
      upsert: mocks.decisionUpsert,
    },
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
    documentRevision: { findMany: mocks.documentFindMany },
    vendorAlias: { findMany: mocks.vendorAliasFindMany },
    customerAlias: { findMany: mocks.customerAliasFindMany },
  },
}));

vi.mock('@/lib/audit', () => ({ createAuditLog: mocks.createAuditLog }));

import {
  listContactDuplicateGroups,
  rejectContactDuplicatePair,
} from '@/services/contact-duplicate.service';

const createdAt = new Date('2020-01-01T00:00:00.000Z');

function duplicateContact(id: string, fullName: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantId: 'tenant-1',
    contactType: 'INDIVIDUAL',
    firstName: fullName,
    lastName: null,
    fullName,
    canonicalName: fullName.trim(),
    alias: null,
    identificationType: null,
    identificationNumber: null,
    nationality: null,
    dateOfBirth: null,
    corporateName: null,
    corporateUen: null,
    fullAddress: null,
    createdAt,
    updatedAt: createdAt,
    contactDetails: [],
    companyRelations: [],
    _count: {
      companyRelations: 0,
      officerPositions: 0,
      shareholdings: 0,
      chargeHoldings: 0,
      contactDetails: 0,
      noteTabs: 0,
    },
    ...overrides,
  };
}

function exactGroups(names: string[] = [], identifiers: Array<Record<string, unknown>> = [], uens: string[] = []) {
  mocks.groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
    if (by.includes('canonicalName')) return names.map((canonicalName) => ({
      contactType: 'INDIVIDUAL', canonicalName, _count: { _all: 2 },
    }));
    if (by.includes('identificationNumber')) return identifiers;
    return uens.map((corporateUen) => ({ corporateUen, _count: { _all: 2 } }));
  });
}

function rawCandidates(
  identifiers: Array<{ leftContactId: string; rightContactId: string }> = [],
  fuzzy: Array<{ leftContactId: string; rightContactId: string }> = [],
) {
  mocks.queryRaw.mockImplementation(async (query: { sql: string }) =>
    query.sql.includes('normalized_identifier_candidates') ? identifiers : fuzzy,
  );
}

describe('contact duplicate service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exactGroups();
    mocks.findMany.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);
    mocks.decisionFindMany.mockResolvedValue([]);
    mocks.txQueryRaw.mockResolvedValue([]);
    mocks.txGate.mockResolvedValue(0);
    mocks.txFindMany.mockResolvedValue([]);
    mocks.txDecisionUpsert.mockResolvedValue({ id: 'decision-1' });
    mocks.createAuditLog.mockResolvedValue({ id: 'audit-1' });
    mocks.documentFindMany.mockResolvedValue([]);
    mocks.vendorAliasFindMany.mockResolvedValue([]);
    mocks.customerAliasFindMany.mockResolvedValue([]);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      $executeRaw: mocks.txGate,
      $queryRaw: mocks.txQueryRaw,
      contact: { findMany: mocks.txFindMany },
      contactDuplicateDecision: { upsert: mocks.txDecisionUpsert },
    }));
  });

  it('discovers exact canonical and deterministic identifier groups within the tenant', async () => {
    exactGroups(
      ['王小明'],
      [{ identificationType: 'NRIC', identificationNumber: 'S1234567A', _count: { _all: 2 } }],
    );
    rawCandidates([{ leftContactId: 'c3', rightContactId: 'c4' }]);
    mocks.findMany.mockResolvedValue([
      duplicateContact('c1', '王小明'),
      duplicateContact('c2', ' 王小明 ', { canonicalName: '王小明' }),
      duplicateContact('c3', 'Different One', { identificationType: 'NRIC', identificationNumber: 'S1234567A' }),
      duplicateContact('c4', 'Different Two', { identificationType: 'NRIC', identificationNumber: 'S1234567A' }),
    ]);

    const result = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });

    expect(result.groups.map((group) => group.contactIds)).toEqual([
      ['c1', 'c2'],
      ['c3', 'c4'],
    ]);
    expect(mocks.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-1', deletedAt: null, isActive: true }),
      take: expect.any(Number),
    }));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-1', deletedAt: null, isActive: true }),
      take: expect.any(Number),
    }));
  });

  it('includes tenant-scoped document and alias reference counts in previews', async () => {
    exactGroups(['alpha']);
    mocks.findMany.mockResolvedValue([
      duplicateContact('c1', 'alpha', { canonicalName: 'alpha' }),
      duplicateContact('c2', 'alpha', { canonicalName: 'alpha' }),
    ]);
    mocks.documentFindMany.mockResolvedValue([
      { id: 'revision-1', vendorId: 'c1', customerId: null },
      { id: 'revision-2', vendorId: null, customerId: 'c1' },
    ]);
    mocks.vendorAliasFindMany.mockResolvedValue([{ id: 'vendor-alias-1', normalizedContactId: 'c1' }]);
    mocks.customerAliasFindMany.mockResolvedValue([{ id: 'customer-alias-1', normalizedContactId: 'c1' }]);

    const result = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });
    const preview = result.groups[0].contacts.find(({ id }) => id === 'c1');

    expect(preview?.referenceCounts).toMatchObject({ documentRevisions: 2, aliases: 2 });
    expect(mocks.documentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        processingDocument: { tenantId: 'tenant-1' },
        OR: [{ vendorId: { in: ['c1', 'c2'] } }, { customerId: { in: ['c1', 'c2'] } }],
      }),
    }));
    expect(mocks.vendorAliasFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', deletedAt: null, normalizedContactId: { in: ['c1', 'c2'] } },
    }));
  });

  it('scores bounded pg_trgm candidates and keeps short CJK names exact-only', async () => {
    mocks.queryRaw.mockResolvedValue([
      { leftContactId: 'c1', rightContactId: 'c2' },
      { leftContactId: 'c3', rightContactId: 'c4' },
    ]);
    mocks.findMany.mockResolvedValue([
      duplicateContact('c1', 'Alexander Hamilton'),
      duplicateContact('c2', 'Alexander Hamilto'),
      duplicateContact('c3', '王明'),
      duplicateContact('c4', '王民'),
    ]);

    const result = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ contactIds: ['c1', 'c2'], reasons: ['FUZZY_NAME'] });
    const query = (mocks.queryRaw.mock.calls.find(([candidate]) =>
      !(candidate as { sql: string }).sql.includes('normalized_identifier_candidates'))?.[0] as { sql: string }).sql;
    expect(query).toContain('similarity');
    expect(query).toContain('0.3');
  });

  it('discovers normalized NRIC and UEN variants but excludes non-deterministic identifiers', async () => {
    rawCandidates([
      { leftContactId: 'n1', rightContactId: 'n2' },
      { leftContactId: 'u1', rightContactId: 'u2' },
      { leftContactId: 'bad1', rightContactId: 'bad2' },
    ]);
    mocks.findMany.mockResolvedValue([
      duplicateContact('n1', 'Alice One', { identificationType: 'NRIC', identificationNumber: 's 123-4567 a' }),
      duplicateContact('n2', 'Alice Two', { identificationType: 'NRIC', identificationNumber: 'Ｓ１２３４５６７Ａ' }),
      duplicateContact('u1', 'Company One', {
        contactType: 'CORPORATE', firstName: null, corporateName: 'Company One', corporateUen: '2024-00001-a',
      }),
      duplicateContact('u2', 'Company Two', {
        contactType: 'CORPORATE', firstName: null, corporateName: 'Company Two', corporateUen: '２０２４００００１Ａ',
      }),
      duplicateContact('bad1', 'Masked One', { identificationType: 'NRIC', identificationNumber: '*****' }),
      duplicateContact('bad2', 'Masked Two', { identificationType: 'NRIC', identificationNumber: '*****' }),
    ]);

    const result = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });

    expect(result.groups.map(({ contactIds }) => contactIds)).toEqual([
      ['n1', 'n2'],
      ['u1', 'u2'],
    ]);
    expect(mocks.queryRaw.mock.calls.some(([query]) =>
      (query as { sql: string }).sql.includes('normalized_identifier_candidates') &&
      (query as { sql: string }).sql.includes('normalize'),
    )).toBe(true);
  });

  it('keeps conflict-bearing exact-name edges blocked at zero confidence', async () => {
    exactGroups(['sameperson']);
    mocks.findMany.mockResolvedValue([
      duplicateContact('c1', 'Same Person', {
        canonicalName: 'sameperson', identificationType: 'NRIC', identificationNumber: 'S1234567A',
      }),
      duplicateContact('c2', 'Same Person', {
        canonicalName: 'sameperson', identificationType: 'NRIC', identificationNumber: 'S7654321A',
      }),
    ]);

    const result = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });

    expect(result.groups[0]).toMatchObject({
      contactIds: ['c1', 'c2'],
      reasons: ['EXACT_CANONICAL_NAME'],
      confidence: 0,
      blockedByIdentifierConflict: true,
      conflicts: expect.arrayContaining([expect.objectContaining({ field: 'identificationNumber' })]),
    });
  });

  it('detects strong identifier conflicts between non-edge members of a fuzzy chain', async () => {
    rawCandidates([], [
      { leftContactId: 'c1', rightContactId: 'c2' },
      { leftContactId: 'c2', rightContactId: 'c3' },
    ]);
    mocks.findMany.mockResolvedValue([
      duplicateContact('c1', 'Alexander Hamilton', {
        identificationType: 'NRIC', identificationNumber: 'S1234567A',
      }),
      duplicateContact('c2', 'Alexander Hamilto'),
      duplicateContact('c3', 'Alexander Hamiltx', {
        identificationType: 'NRIC', identificationNumber: 'S7654321A',
      }),
    ]);

    const result = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });

    expect(result.groups[0]).toMatchObject({
      contactIds: ['c1', 'c2', 'c3'],
      confidence: 0,
      blockedByIdentifierConflict: true,
      conflicts: expect.arrayContaining([expect.objectContaining({ field: 'identificationNumber' })]),
    });
  });

  it('does not give conflicting identifiers a master-ranking boost over a richer no-ID contact', async () => {
    rawCandidates([], [
      { leftContactId: 'c1', rightContactId: 'c3' },
      { leftContactId: 'c2', rightContactId: 'c3' },
    ]);
    mocks.findMany.mockResolvedValue([
      duplicateContact('c1', 'Alexander Hamilton', {
        identificationType: 'NRIC', identificationNumber: 'S1234567A',
      }),
      duplicateContact('c2', 'Alexander Hamiltx', {
        identificationType: 'NRIC', identificationNumber: 'S7654321A',
      }),
      duplicateContact('c3', 'Alexander Hamilto', {
        alias: 'Alex Hamilton', nationality: 'Singaporean',
        dateOfBirth: new Date('1980-01-01T00:00:00.000Z'), fullAddress: '1 Rich Street',
      }),
    ]);

    const result = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });

    expect(result.groups[0]).toMatchObject({
      blockedByIdentifierConflict: true,
      recommendedMasterId: 'c3',
    });
  });

  it('filters more than 200 invalid normalized keys before the ordered group cap', async () => {
    rawCandidates([{ leftContactId: 'valid1', rightContactId: 'valid2' }]);
    mocks.findMany.mockResolvedValue([
      duplicateContact('valid1', 'Valid One', {
        identificationType: 'NRIC', identificationNumber: 's 123-4567 a',
      }),
      duplicateContact('valid2', 'Valid Two', {
        identificationType: 'NRIC', identificationNumber: 'S1234567A',
      }),
    ]);

    const result = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });
    const identifierSql = (mocks.queryRaw.mock.calls.find(([query]) =>
      (query as { sql: string }).sql.includes('normalized_identifier_candidates'))?.[0] as { sql: string }).sql;

    expect(result.groups[0].contactIds).toEqual(['valid1', 'valid2']);
    expect(identifierSql).toContain('valid_identifier_candidates');
    expect(identifierSql).toMatch(/[*•●]/u);
    expect(identifierSql).toContain('notavailable');
    expect(identifierSql).toContain('[^A-Z0-9]');
    expect(identifierSql.indexOf('valid_identifier_candidates')).toBeLessThan(
      identifierSql.indexOf('duplicate_identifier_keys'),
    );
    expect(identifierSql.indexOf('valid_identifier_candidates')).toBeLessThan(
      identifierSql.indexOf('LIMIT'),
    );
  });

  it('unions overlapping pairs stably, ranks the master, and paginates groups', async () => {
    exactGroups(['alpha', 'bravo']);
    mocks.queryRaw.mockResolvedValue([{ leftContactId: 'c2', rightContactId: 'c3' }]);
    mocks.findMany.mockResolvedValue([
      duplicateContact('c3', 'alpha', { canonicalName: 'alpha' }),
      duplicateContact('c1', 'alpha', { canonicalName: 'alpha' }),
      duplicateContact('c2', 'alpha', {
        canonicalName: 'alpha',
        identificationType: 'NRIC',
        identificationNumber: 'S1234567A',
      }),
      duplicateContact('d1', 'bravo', { canonicalName: 'bravo' }),
      duplicateContact('d2', 'bravo', { canonicalName: 'bravo' }),
    ]);

    const page = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 2, limit: 1 });

    expect(page).toMatchObject({ total: 2, page: 2, limit: 1, totalPages: 2 });
    expect(page.groups[0].contactIds).toEqual(['d1', 'd2']);
    const firstPage = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 1 });
    expect(firstPage.groups[0]).toMatchObject({
      contactIds: ['c1', 'c2', 'c3'],
      recommendedMasterId: 'c2',
    });
  });

  it('suppresses only rejections whose sorted pair fingerprints are still current', async () => {
    exactGroups(['王小明']);
    mocks.findMany.mockResolvedValue([
      duplicateContact('c1', '王小明'),
      duplicateContact('c2', '王小明'),
    ]);

    const initial = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });
    const fingerprints = initial.groups[0].fingerprints;
    mocks.decisionFindMany.mockResolvedValue([{
      leftContactId: 'c1',
      rightContactId: 'c2',
      leftFingerprint: fingerprints.c1,
      rightFingerprint: fingerprints.c2,
    }]);
    await expect(listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 }))
      .resolves.toMatchObject({ groups: [], total: 0 });

    mocks.decisionFindMany.mockResolvedValue([{
      leftContactId: 'c1', rightContactId: 'c2', leftFingerprint: 'stale', rightFingerprint: fingerprints.c2,
    }]);
    await expect(listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 }))
      .resolves.toMatchObject({ total: 1 });
  });

  it('does not reconnect a currently rejected pair through a third duplicate candidate', async () => {
    exactGroups(['sameperson']);
    mocks.findMany.mockResolvedValue([
      duplicateContact('c1', 'Same Person', { canonicalName: 'sameperson' }),
      duplicateContact('c2', 'Same Person', { canonicalName: 'sameperson' }),
      duplicateContact('c3', 'Same Person', { canonicalName: 'sameperson' }),
    ]);

    const initial = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });
    mocks.decisionFindMany.mockResolvedValue([{
      leftContactId: 'c1',
      rightContactId: 'c2',
      leftFingerprint: initial.groups[0].fingerprints.c1,
      rightFingerprint: initial.groups[0].fingerprints.c2,
    }]);

    const result = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });

    expect(result.groups.map(({ contactIds }) => contactIds)).toEqual([['c1', 'c3']]);
    expect(result.groups.every(({ contactIds }) =>
      !(contactIds.includes('c1') && contactIds.includes('c2')),
    )).toBe(true);
  });

  it('loads a rejected pair between participating contacts even when it is not a candidate edge', async () => {
    rawCandidates([], [
      { leftContactId: 'c1', rightContactId: 'c3' },
      { leftContactId: 'c2', rightContactId: 'c3' },
    ]);
    mocks.findMany.mockResolvedValue([
      duplicateContact('c1', 'Alexander Hamilton'),
      duplicateContact('c2', 'Alexander Hamiltx'),
      duplicateContact('c3', 'Alexander Hamilto'),
    ]);

    const initial = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });
    const rejection = {
      leftContactId: 'c1',
      rightContactId: 'c2',
      leftFingerprint: initial.groups[0].fingerprints.c1,
      rightFingerprint: initial.groups[0].fingerprints.c2,
    };
    mocks.decisionFindMany.mockImplementation(async ({ where }) => {
      const leftIds = where.leftContactId?.in ?? [];
      const rightIds = where.rightContactId?.in ?? [];
      return leftIds.includes('c1') && rightIds.includes('c2') ? [rejection] : [];
    });

    const result = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });

    expect(result.groups.map(({ contactIds }) => contactIds)).toEqual([['c1', 'c3']]);
    expect(mocks.decisionFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        leftContactId: { in: ['c1', 'c2', 'c3'] },
        rightContactId: { in: ['c1', 'c2', 'c3'] },
      }),
      orderBy: [{ leftContactId: 'asc' }, { rightContactId: 'asc' }],
    }));
    expect(mocks.decisionFindMany.mock.calls.at(-1)?.[0]).not.toHaveProperty('take');
  });

  it('orders every capped query and scopes decisions to sorted participating contacts', async () => {
    exactGroups(['alpha']);
    mocks.findMany.mockResolvedValue([
      duplicateContact('c2', 'alpha', { canonicalName: 'alpha' }),
      duplicateContact('c1', 'alpha', { canonicalName: 'alpha' }),
    ]);

    await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });

    for (const [args] of mocks.groupBy.mock.calls) {
      expect(args).toMatchObject({ take: 200, orderBy: expect.anything() });
    }
    const fuzzySql = (mocks.queryRaw.mock.calls.find(([query]) =>
      !(query as { sql: string }).sql.includes('normalized_identifier_candidates'))?.[0] as { sql: string }).sql;
    expect(fuzzySql).toMatch(/ORDER BY seed\.id[\s\S]*LIMIT/);
    expect(mocks.decisionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        leftContactId: { in: ['c1', 'c2'] },
        rightContactId: { in: ['c1', 'c2'] },
      }),
      orderBy: [{ leftContactId: 'asc' }, { rightContactId: 'asc' }],
    }));
    expect(mocks.decisionFindMany.mock.calls[0][0]).not.toHaveProperty('take');
    const normalizedSql = mocks.queryRaw.mock.calls.find(([query]) =>
      (query as { sql: string }).sql.includes('normalized_identifier_candidates'))?.[0] as { values: unknown[] };
    expect(normalizedSql.values).toEqual(expect.arrayContaining([200, 500]));
    const fuzzyQuery = mocks.queryRaw.mock.calls.find(([query]) =>
      !(query as { sql: string }).sql.includes('normalized_identifier_candidates'))?.[0] as { values: unknown[] };
    expect(fuzzyQuery.values).toEqual(expect.arrayContaining([200, 10, 500]));
  });

  it('keeps the participating-contact decision scope deterministic at the candidate boundary', async () => {
    exactGroups(['alpha']);
    mocks.findMany.mockResolvedValue(Array.from({ length: 56 }, (_, index) =>
      duplicateContact(`c${String(index).padStart(2, '0')}`, 'alpha', { canonicalName: 'alpha' }),
    ));

    await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });
    const firstIds = mocks.decisionFindMany.mock.calls[0][0].where.leftContactId.in;
    await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });
    const secondIds = mocks.decisionFindMany.mock.calls[1][0].where.leftContactId.in;

    expect(firstIds).toHaveLength(56);
    expect(firstIds[0]).toBe('c00');
    expect(firstIds.at(-1)).toBe('c55');
    expect(secondIds).toEqual(firstIds);
  });

  it('rejects a sorted tenant-scoped pair only when supplied fingerprints are current', async () => {
    const contacts = [duplicateContact('c2', '王小明'), duplicateContact('c1', '王小明')];
    mocks.findMany.mockResolvedValue(contacts);
    exactGroups(['王小明']);
    const discovered = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });
    const fingerprints = discovered.groups[0].fingerprints;

    mocks.txFindMany.mockResolvedValue(contacts);
    await rejectContactDuplicatePair({
      leftContactId: 'c2',
      rightContactId: 'c1',
      leftFingerprint: fingerprints.c2,
      rightFingerprint: fingerprints.c1,
      reason: 'Confirmed to be different people',
    }, { tenantId: 'tenant-1', userId: 'user-1' });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
    expect(mocks.txDecisionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_leftContactId_rightContactId: {
        tenantId: 'tenant-1', leftContactId: 'c1', rightContactId: 'c2',
      } },
      create: expect.objectContaining({
        leftContactId: 'c1', rightContactId: 'c2', decidedById: 'user-1', decision: 'REJECTED',
      }),
    }));
    const lockQuery = mocks.txQueryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(lockQuery.sql).toMatch(/ORDER BY id\s+FOR UPDATE/);
    expect(lockQuery.values).toEqual(expect.arrayContaining(['tenant-1', 'c1', 'c2']));
    expect(lockQuery.values.indexOf('c1')).toBeLessThan(lockQuery.values.indexOf('c2'));
    const gateKeys = mocks.txGate.mock.calls.map(([query]) => query.values[0]);
    expect(gateKeys).toEqual([
      'oakcloud:business-operation:tenant-1',
      'oakcloud:authorization:global',
    ]);
    expect(mocks.txGate.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      mocks.txQueryRaw.mock.invocationCallOrder[0],
    );
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      action: 'UPDATE',
      entityType: 'ContactDuplicateDecision',
      entityId: 'decision-1',
      reason: 'Confirmed to be different people',
      metadata: expect.objectContaining({
        leftContactId: 'c1', rightContactId: 'c2', reviewerId: 'user-1',
      }),
    }), expect.objectContaining({ contact: expect.anything() }));

    mocks.txFindMany.mockResolvedValue(contacts);
    await expect(rejectContactDuplicatePair({
      leftContactId: 'c1', rightContactId: 'c2', leftFingerprint: 'stale', rightFingerprint: fingerprints.c2,
      reason: 'Confirmed to be different people',
    }, { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow('stale');
  });

  it('re-reads after locking and writes neither decision nor audit when identity changed in the race', async () => {
    const original = [duplicateContact('c1', 'Original Person'), duplicateContact('c2', 'Original Person')];
    exactGroups(['Original Person']);
    mocks.findMany.mockResolvedValue(original);
    const discovered = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });
    mocks.txFindMany.mockResolvedValue([
      original[0],
      duplicateContact('c2', 'Changed Person', { canonicalName: 'changedperson' }),
    ]);

    await expect(rejectContactDuplicatePair({
      leftContactId: 'c1', rightContactId: 'c2',
      leftFingerprint: discovered.groups[0].fingerprints.c1,
      rightFingerprint: discovered.groups[0].fingerprints.c2,
      reason: 'Confirmed to be different people',
    }, { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow('stale');

    expect(mocks.txQueryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.txFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.txDecisionUpsert).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it('treats a concurrent contact-detail change as stale before decision and audit writes', async () => {
    const original = [
      duplicateContact('c1', 'Detail Person', {
        contactDetails: [{ detailType: 'EMAIL', value: 'one@example.com', companyId: null }],
      }),
      duplicateContact('c2', 'Detail Person', {
        contactDetails: [{ detailType: 'EMAIL', value: 'two@example.com', companyId: null }],
      }),
    ];
    exactGroups(['Detail Person']);
    mocks.findMany.mockResolvedValue(original);
    const discovered = await listContactDuplicateGroups({ tenantId: 'tenant-1', page: 1, limit: 20 });
    mocks.txFindMany.mockResolvedValue([
      original[0],
      duplicateContact('c2', 'Detail Person', {
        contactDetails: [{ detailType: 'EMAIL', value: 'changed@example.com', companyId: null }],
      }),
    ]);

    await expect(rejectContactDuplicatePair({
      leftContactId: 'c1', rightContactId: 'c2',
      leftFingerprint: discovered.groups[0].fingerprints.c1,
      rightFingerprint: discovered.groups[0].fingerprints.c2,
      reason: 'Confirmed to be different people',
    }, { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow('stale');

    expect(mocks.txDecisionUpsert).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it('maps a serializable transaction conflict to a stale recommendation error', async () => {
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('write conflict'), { code: 'P2034' }));

    await expect(rejectContactDuplicatePair({
      leftContactId: 'c1', rightContactId: 'c2',
      leftFingerprint: 'a'.repeat(64), rightFingerprint: 'b'.repeat(64),
      reason: 'Confirmed to be different people',
    }, { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toThrow('stale');
  });
});
