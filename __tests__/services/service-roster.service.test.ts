import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientService: {
      findMany: mocks.findMany,
      count: mocks.count,
    },
    $queryRaw: mocks.queryRaw,
  },
}));

import {
  listServiceRosterFamilies,
  listServiceRoster,
  type ServiceRosterScope,
} from '@/services/service-roster';
import type { ServiceRosterSearch } from '@/lib/validations/service-roster';
import { addCalendarDays, currentDateInSingapore } from '@/services/service-schedule';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';
const familyId = '33333333-3333-4333-8333-333333333333';
const variantId = '44444444-4444-4444-8444-444444444444';

const search: ServiceRosterSearch = {
  query: undefined,
  companyId: undefined,
  familyIds: [],
  variantId: undefined,
  statuses: ['ACTIVE'],
  archived: false,
  applicability: undefined,
  sortBy: 'company',
  sortOrder: 'asc',
  page: 1,
  limit: 20,
};

const scope: ServiceRosterScope = {
  tenantId,
  companyIds: [companyId],
};

function rawQueryText(query: unknown): string {
  if (query && typeof query === 'object') {
    const candidate = query as { sql?: unknown; strings?: readonly unknown[] };
    if (typeof candidate.sql === 'string') return candidate.sql;
    if (candidate.strings) return candidate.strings.map(String).join(' ');
  }
  return String(query);
}

function rosterRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'service-1',
    tenantId,
    companyId,
    source: 'MANUAL',
    serviceVariantId: variantId,
    familyName: 'Corporate Services',
    serviceName: 'Annual Return Filing',
    status: 'ACTIVE',
    serviceCadence: 'ANNUALLY',
    customCadenceLabel: null,
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: null,
    fieldValues: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    company: {
      id: companyId,
      tenantId,
      name: 'Oaktree Accounting & Corporate Solution Pte. Ltd.',
      displayAlias: null,
      uen: '202600001A',
      deletedAt: null,
    },
    serviceVariant: {
      id: variantId,
      tenantId,
      familyId,
      code: 'AR',
      name: 'Annual Return Filing',
      serviceCadence: 'ANNUALLY',
      customCadenceLabel: null,
      version: 2,
      deletedAt: null,
      family: {
        id: familyId,
        tenantId,
        name: 'Corporate Services',
        displayColor: '#2F6F5E',
        deletedAt: null,
      },
    },
    deadlineRules: [
      {
        id: 'client-rule-1',
        enabled: true,
        applicabilityState: 'APPLICABLE',
        applicabilityReason: null,
        rule: { id: 'rule-1', code: 'AR', name: 'Annual Return' },
      },
    ],
    deadlineOccurrences: [
      {
        id: 'deadline-1',
        tenantId,
        companyId,
        clientServiceId: 'service-1',
        milestoneKey: 'filing',
        scheduleEntryKey: '',
        deadlineType: 'STATUTORY',
        calculatedDueDate: new Date('2026-09-01T00:00:00.000Z'),
        operativeDueDate: new Date('2026-09-01T00:00:00.000Z'),
        status: 'OPEN',
        origin: 'RULE',
      },
    ],
    ...overrides,
  };
}

describe('service roster service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([rosterRecord()]);
    mocks.count.mockResolvedValue(1);
    mocks.queryRaw.mockResolvedValue([{ id: 'service-1' }]);
  });

  it('places tenant and accessible company IDs in the client-service predicate', async () => {
    await listServiceRoster(search, scope);

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId,
        companyId: { in: [companyId] },
      }),
    }));
    expect(mocks.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId,
        companyId: { in: [companyId] },
      }),
    }));
  });

  it('applies every data-column inline filter to the roster predicate', async () => {
    await listServiceRoster({
      ...search,
      statuses: [],
      statusQuery: 'active',
      cadenceQuery: 'one-time',
      nextDeadlineQuery: '2026-09-01',
      startEndQuery: '2026-01-01',
      warningQuery: 'review',
      billingQuery: 'configured',
    }, scope);

    const where = (mocks.count.mock.calls[0]![0] as { where: { AND?: unknown[] } }).where;
    expect(where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: { in: ['ACTIVE'] } }),
      expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ serviceCadence: { in: ['ONE_TIME'] } })]) }),
      expect.objectContaining({ AND: expect.arrayContaining([
        expect.objectContaining({ deadlineOccurrences: expect.anything() }),
        expect.objectContaining({ NOT: expect.anything() }),
      ]) }),
      expect.objectContaining({ OR: expect.arrayContaining([
        expect.objectContaining({ startDate: expect.anything() }),
        expect.objectContaining({ endDate: expect.anything() }),
      ]) }),
      expect.objectContaining({ deadlineRules: expect.anything() }),
      expect.objectContaining({ OR: [{ billingDisposition: { in: ['CONFIGURED'] } }] }),
    ]));
    expect(where.AND).toHaveLength(6);
  });

  it('scopes the nested open-deadline relation and orders it deterministically', async () => {
    await listServiceRoster(search, scope);

    const call = mocks.findMany.mock.calls[0]![0] as {
      include: { deadlineOccurrences: { where: Record<string, unknown>; orderBy: unknown; take: number } };
    };
    expect(call.include.deadlineOccurrences.where).toEqual(expect.objectContaining({
      tenantId,
      companyId: { in: [companyId] },
      status: 'OPEN',
    }));
    expect(call.include.deadlineOccurrences.orderBy).toEqual([
      { operativeDueDate: 'asc' },
      { id: 'asc' },
    ]);
    expect(call.include.deadlineOccurrences.take).toBe(1);
  });

  it('projects the next required Open or Billed billing state and skips historical waived/billed rows', async () => {
    const today = currentDateInSingapore();
    const nextDate = addCalendarDays(today, 5);
    mocks.findMany.mockResolvedValue([rosterRecord({
      billingDisposition: 'CONFIGURED',
      billingOccurrences: [
        { status: 'WAIVED', operativeExpectedDate: new Date('2020-01-01T00:00:00.000Z') },
        { status: 'BILLED', operativeExpectedDate: new Date('2020-02-01T00:00:00.000Z') },
        { status: 'OPEN', operativeExpectedDate: new Date(`${nextDate}T00:00:00.000Z`) },
      ],
    })]);

    const result = await listServiceRoster(search, scope);

    expect(result.items[0]?.nextBilling).toMatchObject({ status: 'OPEN', expectedDate: nextDate });
    const call = mocks.findMany.mock.calls[0]![0] as {
      include: { billingOccurrences: { where: Record<string, unknown>; orderBy: unknown; take: number } };
    };
    expect(call.include.billingOccurrences.where).toEqual(expect.objectContaining({
      tenantId,
      status: { in: ['OPEN', 'BILLED'] },
      operativeExpectedDate: { gte: new Date(`${today}T00:00:00.000Z`) },
    }));
    expect(call.include.billingOccurrences.take).toBe(1);
  });

  it.each([
    ['asc', 'ASC'],
    ['desc', 'DESC'],
  ] as const)('orders next-deadline pages by the scoped minimum with nulls last (%s)', async (sortOrder, direction) => {
    mocks.queryRaw.mockResolvedValue([{ id: 'service-1' }]);

    const result = await listServiceRoster({
      ...search,
      sortBy: 'nextDeadline',
      sortOrder,
      page: 2,
      limit: 1,
    }, scope);

    expect(result.items).toHaveLength(1);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const sql = rawQueryText(mocks.queryRaw.mock.calls[0]![0]);
    expect(sql).toMatch(/MIN[\s\S]*operative_due_date/);
    expect(sql).toMatch(/deadline_occurrences/);
    expect(sql).toMatch(new RegExp(`ORDER BY[\\s\\S]*CASE[\\s\\S]*MIN[\\s\\S]*IS NULL[\\s\\S]*ASC[\\s\\S]*MIN[\\s\\S]*operative_due_date[\\s\\S]*${direction}[\\s\\S]*cs[\\s\\S]*id[\\s\\S]*ASC`));
    expect(sql).toMatch(/OFFSET[\s\S]*LIMIT/);
    expect(sql).toMatch(/tenant_id/);
    expect(sql).toMatch(/company_id/);
    expect(sql).toContain('c."tenantId" =');
    expect(sql).toContain('c."deletedAt" IS NULL');
  });

  it('hydrates raw next-deadline page IDs in SQL order without widening access scope', async () => {
    mocks.queryRaw.mockResolvedValue([{ id: 'service-2' }, { id: 'service-1' }]);
    mocks.findMany.mockResolvedValue([
      rosterRecord({ id: 'service-1' }),
      rosterRecord({ id: 'service-2' }),
    ]);

    const result = await listServiceRoster({
      ...search,
      sortBy: 'nextDeadline',
      page: 2,
      limit: 2,
    }, scope);

    expect(result.items.map((item) => item.id)).toEqual(['service-2', 'service-1']);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId,
        companyId: { in: [companyId] },
        id: { in: ['service-2', 'service-1'] },
      }),
    }));
    expect(mocks.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId, companyId: { in: [companyId] } }),
    }));
  });

  it('returns alias fallback, family color, snapshots, next deadline, and warning state', async () => {
    const result = await listServiceRoster(search, { tenantId, allCompaniesAccess: true });

    expect(result.items[0]).toMatchObject({
      company: {
        name: 'Oaktree Accounting & Corporate Solution Pte. Ltd.',
        displayLabel: 'OACS',
      },
      family: { displayColor: '#2F6F5E' },
      variant: { id: variantId, name: 'Annual Return Filing', version: 2 },
      service: { source: 'MANUAL', status: 'ACTIVE', cadence: 'ANNUALLY' },
      nextDeadline: { operativeDueDate: '2026-09-01', status: 'OPEN' },
      applicability: { state: 'APPLICABLE', hasWarning: false },
      ruleWarning: { state: 'APPLICABLE', hasWarning: false },
    });
  });

  it('aggregates missing applicability as a warning without hiding not-applicable rules', async () => {
    mocks.findMany.mockResolvedValue([rosterRecord({
      deadlineRules: [
        { id: 'rule-1', enabled: true, applicabilityState: 'NOT_APPLICABLE', applicabilityReason: 'Private company', rule: null },
        { id: 'rule-2', enabled: true, applicabilityState: 'MISSING_INPUT', applicabilityReason: 'Missing FYE', rule: null },
      ],
      deadlineOccurrences: [],
    })]);

    const result = await listServiceRoster(search, scope);

    expect(result.items[0]).toMatchObject({
      applicability: { state: 'MISSING_INPUT', hasWarning: true, missingInputCount: 1, notApplicableCount: 1 },
      ruleWarning: { state: 'MISSING_INPUT', hasWarning: true, reasons: ['Missing FYE'] },
      nextDeadline: null,
    });
  });

  it('keeps stored operational snapshots when live catalog values differ', async () => {
    const base = rosterRecord();
    mocks.findMany.mockResolvedValue([rosterRecord({
      familyName: 'Stored Corporate Services',
      serviceName: 'Stored Annual Return Filing',
      serviceCadence: 'MONTHLY',
      customCadenceLabel: 'Stored monthly cadence',
      serviceVariant: {
        ...base.serviceVariant,
        name: 'Current Annual Return Filing',
        serviceCadence: 'ANNUALLY',
        customCadenceLabel: 'Current annual cadence',
        family: {
          ...base.serviceVariant.family,
          name: 'Current Corporate Services',
        },
      },
    })]);

    const result = await listServiceRoster(search, scope);

    expect(result.items[0]).toMatchObject({
      family: { name: 'Current Corporate Services' },
      familyName: 'Stored Corporate Services',
      variant: { name: 'Current Annual Return Filing', serviceCadence: 'ANNUALLY' },
      service: {
        name: 'Stored Annual Return Filing',
        cadence: 'MONTHLY',
        serviceCadence: 'MONTHLY',
        customCadenceLabel: 'Stored monthly cadence',
      },
      serviceName: 'Stored Annual Return Filing',
      cadence: 'MONTHLY',
      serviceCadence: 'MONTHLY',
      customCadenceLabel: 'Stored monthly cadence',
    });
  });

  it('puts archived, search, status, company, family, variant, and applicability filters in the predicate', async () => {
    await listServiceRoster({
      ...search,
      query: 'annual',
      companyId,
      familyIds: [familyId],
      variantId,
      statuses: ['PAUSED'],
      archived: true,
      applicability: 'MISSING_INPUT',
    }, { tenantId, allCompaniesAccess: true });

    const call = mocks.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(call.where).toEqual(expect.objectContaining({
      tenantId,
      companyId: { in: [companyId] },
      deletedAt: { not: null },
      status: { in: ['PAUSED'] },
      company: expect.objectContaining({ id: { in: [companyId] } }),
      serviceVariant: expect.objectContaining({ id: variantId, familyId: { in: [familyId] } }),
      deadlineRules: { some: expect.objectContaining({ tenantId, applicabilityState: 'MISSING_INPUT' }) },
      AND: expect.any(Array),
    }));
  });

  it('applies distinct inline company, family, and service queries in the server predicate', async () => {
    await listServiceRoster({
      ...search,
      companyQuery: 'Oaktree',
      familyQuery: 'Accounting',
      serviceQuery: 'Annual',
    }, scope);

    const call = mocks.findMany.mock.calls[0]![0] as { where: { AND?: unknown[] } };
    expect(call.where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ company: expect.objectContaining({ OR: expect.any(Array) }) }),
      expect.objectContaining({ OR: expect.arrayContaining([
        expect.objectContaining({ familyName: expect.any(Object) }),
      ]) }),
      expect.objectContaining({ OR: expect.arrayContaining([
        expect.objectContaining({ serviceName: expect.any(Object) }),
      ]) }),
    ]));
  });

  it.each([
    ['company', { company: { name: 'asc' } }],
    ['family', { familyName: 'asc' }],
    ['service', { serviceName: 'asc' }],
    ['status', { status: 'asc' }],
    ['startDate', { startDate: 'asc' }],
  ] as const)('uses a deterministic SQL order for the %s branch', async (sortBy, firstOrder) => {
    await listServiceRoster({ ...search, sortBy }, scope);

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: expect.arrayContaining([firstOrder, { id: 'asc' }]),
    }));
  });

  it('does not add a status constraint when no status quick filter is active', async () => {
    await listServiceRoster({ ...search, statuses: [] }, scope);

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ status: expect.anything() }),
    }));
    expect(mocks.count).toHaveBeenCalled();
  });

  it('returns an empty page without querying when access scope is empty', async () => {
    const result = await listServiceRoster({ ...search, page: 3, limit: 10 }, { tenantId, companyIds: [] });

    expect(result).toEqual({ items: [], total: 0, page: 3, limit: 10, totalPages: 0 });
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('returns complete deduplicated family facets from the access-scoped operational set', async () => {
    mocks.queryRaw.mockResolvedValue([
      { id: familyId, name: 'Accounting', displayColor: '#3F6DA8' },
      { id: '55555555-5555-4555-8555-555555555555', name: 'Advisory', displayColor: '#B85C38' },
    ]);

    await expect(listServiceRosterFamilies(scope)).resolves.toEqual([
      { id: familyId, name: 'Accounting', displayColor: '#3F6DA8' },
      { id: '55555555-5555-4555-8555-555555555555', name: 'Advisory', displayColor: '#B85C38' },
    ]);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('uses the physical legacy company columns in the grouped access-scoped family query', async () => {
    mocks.queryRaw.mockResolvedValue([
      { id: familyId, name: 'Corporate Services', displayColor: '#2F6F5E' },
      { id: '55555555-5555-4555-8555-555555555555', name: 'Archived Advisory', displayColor: '#B85C38' },
    ]);

    await expect(listServiceRosterFamilies(scope)).resolves.toEqual([
      { id: familyId, name: 'Corporate Services', displayColor: '#2F6F5E' },
      { id: '55555555-5555-4555-8555-555555555555', name: 'Archived Advisory', displayColor: '#B85C38' },
    ]);

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const query = rawQueryText(mocks.queryRaw.mock.calls[0]?.[0]);
    expect(query).toContain('GROUP BY sf."id", sf."name", sf."display_color"');
    expect(query).not.toContain('cs."deleted_at" IS NULL');
    expect(query).toContain('c."tenantId" =');
    expect(query).toContain('c."deletedAt" IS NULL');
  });
});
