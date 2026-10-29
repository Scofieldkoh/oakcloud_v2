import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@/lib/errors';

const prismaMock = vi.hoisted(() => ({
  billingOccurrence: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}));

const auditMock = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => auditMock);

import {
  deriveBillingTiming,
  listBillingOccurrences,
  resetBillingOverride,
  updateBillingOccurrence,
} from '@/services/billing';

const actor = { tenantId: 'tenant-1', userId: 'user-1', companyIds: ['company-1'] };
const occurrence = {
  id: 'occurrence-1',
  tenantId: actor.tenantId,
  companyId: 'company-1',
  clientServiceId: 'service-1',
  feeLineId: 'fee-1',
  billingPeriodKey: '2026-08',
  scheduleEntryKey: 'default',
  generationKey: 'generation-1',
  calculatedExpectedDate: new Date('2026-08-18T00:00:00.000Z'),
  operativeExpectedDate: new Date('2026-08-18T00:00:00.000Z'),
  dateOverridden: false,
  dateOverrideReason: null,
  dateOverriddenAt: null,
  dateOverriddenById: null,
  baseAmount: '100.00',
  baseCurrency: 'SGD',
  operativeAmount: '100.00',
  operativeCurrency: 'SGD',
  valueOverridden: false,
  valueOverrideReason: null,
  valueOverriddenAt: null,
  valueOverriddenById: null,
  status: 'OPEN' as const,
  billedDate: null,
  markedBilledAt: null,
  markedBilledById: null,
  externalReference: null,
  notes: null,
  waivedAt: null,
  waivedById: null,
  waiverReason: null,
  cancelledAt: null,
  cancelledById: null,
  cancellationReason: null,
  cancellationReconciliationRequestId: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-10T00:00:00.000Z'),
  company: { id: 'company-1', tenantId: actor.tenantId, name: 'Example Pte. Ltd.', displayAlias: null, uen: '202400001A' },
  clientService: {
    id: 'service-1',
    tenantId: actor.tenantId,
    companyId: 'company-1',
    serviceName: 'Annual Return',
    familyName: 'Corporate',
    serviceVariant: {
      id: 'variant-1',
      tenantId: actor.tenantId,
      name: 'Annual Return',
      family: { id: 'family-1', tenantId: actor.tenantId, name: 'Corporate', displayColor: '#2F6F5E' },
    },
  },
  feeLine: { id: 'fee-1', tenantId: actor.tenantId, clientServiceId: 'service-1', description: 'Annual filing', amount: '100.00', currency: 'SGD' },
};

const search = {
  from: '2026-08-01',
  to: '2026-08-31',
  companyIds: [],
  familyIds: [],
  statuses: [],
  timing: [],
  page: 1,
  limit: 50,
  sortBy: 'expectedDate' as const,
  sortOrder: 'asc' as const,
};

describe('billing occurrence service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.billingOccurrence.findMany.mockResolvedValue([occurrence]);
    prismaMock.billingOccurrence.count.mockResolvedValue(1);
    prismaMock.billingOccurrence.findFirst.mockResolvedValue(occurrence);
    prismaMock.billingOccurrence.updateMany.mockResolvedValue({ count: 1 });
    auditMock.createAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['2026-08-18', 'UPCOMING'],
    ['2026-08-17', 'DUE'],
    ['2026-08-16', 'OVERDUE'],
  ] as const)('derives %s as %s using the Singapore date', (expectedDate, timing) => {
    expect(deriveBillingTiming('OPEN', expectedDate, '2026-08-17')).toBe(timing);
  });

  it('does not derive timing for billed, waived, or cancelled rows', () => {
    expect(deriveBillingTiming('BILLED', '2026-08-16', '2026-08-17')).toBeNull();
    expect(deriveBillingTiming('WAIVED', '2026-08-16', '2026-08-17')).toBeNull();
    expect(deriveBillingTiming('CANCELLED', '2026-08-16', '2026-08-17')).toBeNull();
  });

  it('keeps tenant and accessible-company predicates in the list query', async () => {
    await listBillingOccurrences(search, actor, prismaMock as never, { today: '2026-08-17' });

    expect(prismaMock.billingOccurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: actor.tenantId,
        companyId: { in: ['company-1'] },
        operativeExpectedDate: { gte: new Date('2026-08-01T00:00:00.000Z'), lte: new Date('2026-08-31T00:00:00.000Z') },
        company: expect.objectContaining({ tenantId: actor.tenantId, deletedAt: null }),
      }),
    }));
  });

  it('keeps family, status, timing, pagination, and amount-sort predicates in the list query', async () => {
    prismaMock.billingOccurrence.count.mockResolvedValue(25);
    const familyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const result = await listBillingOccurrences({
      ...search,
      familyIds: [familyId],
      statuses: ['OPEN'],
      timing: ['DUE'],
      page: 2,
      limit: 10,
      sortBy: 'amount',
      sortOrder: 'desc',
    }, actor, prismaMock as never, { today: '2026-08-17' });

    expect(result).toMatchObject({ page: 2, limit: 10, total: 25, totalPages: 3 });
    expect(prismaMock.billingOccurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 10,
      take: 10,
      orderBy: [{ operativeAmount: 'desc' }, { operativeExpectedDate: 'asc' }, { id: 'asc' }],
      where: expect.objectContaining({
        status: { in: ['OPEN'] },
        clientService: expect.objectContaining({
          serviceVariant: expect.objectContaining({
            family: expect.objectContaining({ id: { in: [familyId] } }),
          }),
        }),
        AND: [{ status: 'OPEN', OR: [{ operativeExpectedDate: new Date('2026-08-17T00:00:00.000Z') }] }],
      }),
    }));
  });

  it('omits the date predicate when no date range is supplied', async () => {
    await listBillingOccurrences({ ...search, from: undefined, to: undefined }, actor, prismaMock as never, { today: '2026-08-17' });

    expect(prismaMock.billingOccurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ operativeExpectedDate: expect.anything() }),
    }));
  });

  it('applies company, service, fee, and general search predicates before pagination', async () => {
    await listBillingOccurrences({
      ...search,
      query: 'annual',
      companyQuery: 'Example',
      serviceQuery: 'Return',
      feeQuery: 'filing',
    }, actor, prismaMock as never, { today: '2026-08-17' });

    const call = prismaMock.billingOccurrence.findMany.mock.calls[0]?.[0] as { where: { company: Record<string, unknown>; clientService: Record<string, unknown>; feeLine: Record<string, unknown>; AND?: unknown[] } };
    expect(call.where.company).toEqual(expect.objectContaining({
      OR: expect.arrayContaining([
        expect.objectContaining({ name: expect.objectContaining({ contains: 'Example' }) }),
        expect.objectContaining({ displayAlias: expect.objectContaining({ contains: 'Example' }) }),
      ]),
    }));
    expect(call.where.clientService).toEqual(expect.objectContaining({
      OR: expect.arrayContaining([
        expect.objectContaining({ serviceName: expect.objectContaining({ contains: 'Return' }) }),
        expect.objectContaining({ familyName: expect.objectContaining({ contains: 'Return' }) }),
      ]),
    }));
    expect(call.where.feeLine).toEqual(expect.objectContaining({
      description: expect.objectContaining({ contains: 'filing' }),
    }));
    expect(call.where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ company: expect.any(Object) }),
          expect.objectContaining({ clientService: expect.any(Object) }),
          expect.objectContaining({ feeLine: expect.any(Object) }),
          expect.objectContaining({ billingPeriodKey: expect.any(Object) }),
        ]),
      }),
      expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ feeLine: expect.any(Object) })]) }),
    ]));
  });

  it('applies split-column filters and an exact company selection', async () => {
    const companyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const familyId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await listBillingOccurrences({
      ...search,
      from: undefined,
      to: undefined,
      companyId,
      familyId,
      serviceNameQuery: 'Payroll',
      feeLineQuery: 'Monthly fee',
      periodQuery: '2026-08',
      expectedDate: '2026-08-31',
      billedDate: '2026-08-31',
      amountMin: '100.00',
      amountMax: '500.00',
      referenceQuery: 'REF-1',
    }, { ...actor, companyIds: undefined }, prismaMock as never, { today: '2026-08-17' });

    const call = prismaMock.billingOccurrence.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where).toEqual(expect.objectContaining({
      companyId: { in: [companyId] },
      operativeExpectedDate: new Date('2026-08-31T00:00:00.000Z'),
      billedDate: new Date('2026-08-31T00:00:00.000Z'),
      operativeAmount: { gte: '100.00', lte: '500.00' },
      externalReference: { contains: 'REF-1', mode: 'insensitive' },
    }));
    expect(call.where.clientService).toEqual(expect.objectContaining({
      companyId: { in: [companyId] },
      serviceVariant: expect.objectContaining({ family: expect.objectContaining({ id: { in: [familyId] } }) }),
      OR: [{ serviceName: { contains: 'Payroll', mode: 'insensitive' } }],
    }));
    expect(call.where.feeLine).toEqual(expect.objectContaining({ description: { contains: 'Monthly fee', mode: 'insensitive' } }));
    expect(call.where.AND).toEqual(expect.arrayContaining([
      { feeLine: { description: { contains: 'Monthly fee', mode: 'insensitive' } } },
      { billingPeriodKey: { contains: '2026-08', mode: 'insensitive' } },
      { externalReference: { contains: 'REF-1', mode: 'insensitive' } },
    ]));
  });

  it('returns a serializable DTO with company, family, fee, dates, values, and timing', async () => {
    const result = await listBillingOccurrences(search, actor, prismaMock as never, { today: '2026-08-17' });

    expect(result).toMatchObject({
      mode: 'TABLE',
      total: 1,
      items: [{
        id: 'occurrence-1',
        calculatedExpectedDate: '2026-08-18',
        operativeExpectedDate: '2026-08-18',
        timingState: 'UPCOMING',
        baseAmount: '100.00',
        operativeAmount: '100.00',
        billedDate: null,
        company: { displayLabel: 'E', name: 'Example Pte. Ltd.' },
        family: { name: 'Corporate', displayColor: '#2F6F5E' },
        feeLine: { id: 'fee-1', description: 'Annual filing' },
      }],
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('allows Billed without a billed date and records exact billed metadata', async () => {
    await updateBillingOccurrence('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      status: 'BILLED',
      billedDate: null,
      updateScope: 'THIS_OCCURRENCE',
      reason: null,
    }, actor, prismaMock as never);

    expect(prismaMock.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'occurrence-1', tenantId: actor.tenantId, updatedAt: occurrence.updatedAt, status: { not: 'CANCELLED' } }),
      data: expect.objectContaining({ status: 'BILLED', billedDate: null, markedBilledAt: expect.any(Date), markedBilledById: actor.userId }),
    }));
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'BillingOccurrence',
      reason: undefined,
      changes: expect.objectContaining({ status: expect.any(Object), markedBilledAt: expect.any(Object), markedBilledById: expect.any(Object), billedDate: expect.any(Object) }),
    }), expect.anything());
  });

  it('records waiver metadata when an Open occurrence is waived', async () => {
    await updateBillingOccurrence('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      status: 'WAIVED',
      updateScope: 'THIS_OCCURRENCE',
      reason: 'Client confirmed no billing is required',
    }, actor, prismaMock as never);

    expect(prismaMock.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'WAIVED',
        waivedAt: expect.any(Date),
        waivedById: actor.userId,
        waiverReason: 'Client confirmed no billing is required',
        markedBilledAt: null,
        markedBilledById: null,
        billedDate: null,
      }),
    }));
  });

  it.each([
    ['BILLED', { markedBilledAt: new Date('2026-08-11T00:00:00.000Z'), markedBilledById: 'previous-user', billedDate: new Date('2026-08-11T00:00:00.000Z') }],
    ['WAIVED', { waivedAt: new Date('2026-08-11T00:00:00.000Z'), waivedById: 'previous-user', waiverReason: 'Previous reason' }],
  ] as const)('reopens %s only with a reason and clears terminal metadata', async (status, metadata) => {
    prismaMock.billingOccurrence.findFirst.mockResolvedValue({ ...occurrence, status, ...metadata });

    await updateBillingOccurrence('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      status: 'OPEN',
      updateScope: 'THIS_OCCURRENCE',
      reason: 'Reopened after client review',
    }, actor, prismaMock as never);

    expect(prismaMock.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'OPEN',
        markedBilledAt: null,
        markedBilledById: null,
        billedDate: null,
        waivedAt: null,
        waivedById: null,
        waiverReason: null,
      }),
    }));
  });

  it('requires a reason when reopening a billed occurrence', async () => {
    prismaMock.billingOccurrence.findFirst.mockResolvedValue({
      ...occurrence,
      status: 'BILLED',
      markedBilledAt: new Date('2026-08-11T00:00:00.000Z'),
      markedBilledById: 'previous-user',
    });

    await expect(updateBillingOccurrence('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      status: 'OPEN',
      updateScope: 'THIS_OCCURRENCE',
      reason: null,
    }, actor, prismaMock as never)).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
    expect(prismaMock.billingOccurrence.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['BILLED', 'WAIVED'],
    ['WAIVED', 'BILLED'],
  ] as const)('rejects the forbidden %s to %s transition', async (currentStatus, nextStatus) => {
    prismaMock.billingOccurrence.findFirst.mockResolvedValue({ ...occurrence, status: currentStatus });

    await expect(updateBillingOccurrence('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      status: nextStatus,
      updateScope: 'THIS_OCCURRENCE',
      reason: 'Invalid direct transition',
    }, actor, prismaMock as never)).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
    expect(prismaMock.billingOccurrence.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a billed date on a non-Billed occurrence', async () => {
    await expect(updateBillingOccurrence('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      billedDate: '2026-08-20',
      updateScope: 'THIS_OCCURRENCE',
      reason: null,
    }, actor, prismaMock as never)).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
    expect(prismaMock.billingOccurrence.updateMany).not.toHaveBeenCalled();
  });

  it('updates selected plus matching future Open rows only for THIS_AND_FUTURE value edits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T04:00:00.000Z'));
    prismaMock.billingOccurrence.findMany.mockResolvedValue([{ id: 'future-1' }]);
    await updateBillingOccurrence('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      amount: '1500.00',
      currency: 'USD',
      updateScope: 'THIS_AND_FUTURE',
      reason: 'Updated engagement pricing',
    }, actor, prismaMock as never);

    expect(prismaMock.billingOccurrence.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.billingOccurrence.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        tenantId: actor.tenantId,
        companyId: occurrence.companyId,
        feeLineId: occurrence.feeLineId,
        clientServiceId: occurrence.clientServiceId,
        scheduleEntryKey: occurrence.scheduleEntryKey,
        generationKey: occurrence.generationKey,
        status: 'OPEN',
        operativeExpectedDate: { gte: occurrence.operativeExpectedDate },
      }),
      data: expect.objectContaining({ operativeAmount: '1500.00', operativeCurrency: 'USD', valueOverridden: true }),
    }));
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ updateScope: 'THIS_AND_FUTURE', affectedCount: 2, affectedIds: ['occurrence-1', 'future-1'] }),
    }), expect.anything());
  });

  it('preserves historical rows when a historical selected row updates current and future values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T04:00:00.000Z'));
    const selected = {
      ...occurrence,
      status: 'BILLED' as const,
      calculatedExpectedDate: new Date('2026-08-10T00:00:00.000Z'),
      operativeExpectedDate: new Date('2026-08-10T00:00:00.000Z'),
    };
    const futureRows = [
      { id: 'future-yesterday', operativeExpectedDate: new Date('2026-08-16T00:00:00.000Z') },
      { id: 'future-today', operativeExpectedDate: new Date('2026-08-17T00:00:00.000Z') },
      { id: 'future-tomorrow', operativeExpectedDate: new Date('2026-08-18T00:00:00.000Z') },
    ];
    prismaMock.billingOccurrence.findFirst.mockResolvedValue(selected);
    prismaMock.billingOccurrence.findMany.mockImplementation(async (args: { where: { operativeExpectedDate?: { gte?: Date } } }) => {
      const lowerBound = args.where.operativeExpectedDate?.gte ?? new Date(0);
      return futureRows.filter((row) => row.operativeExpectedDate >= lowerBound).map(({ id }) => ({ id }));
    });
    prismaMock.billingOccurrence.updateMany.mockImplementation(async (args: { where: { id?: string | { in?: string[] } } }) => ({
      count: typeof args.where.id === 'string' ? 1 : args.where.id?.in?.length ?? 0,
    }));

    await updateBillingOccurrence('occurrence-1', {
      expectedUpdatedAt: selected.updatedAt.toISOString(),
      amount: '1500.00',
      currency: 'USD',
      updateScope: 'THIS_AND_FUTURE',
      reason: 'Updated engagement pricing',
    }, actor, prismaMock as never);

    expect(prismaMock.billingOccurrence.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        operativeExpectedDate: { gte: new Date('2026-08-17T00:00:00.000Z') },
        id: { in: ['future-today', 'future-tomorrow'] },
      }),
    }));
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        affectedCount: 3,
        affectedIds: ['occurrence-1', 'future-today', 'future-tomorrow'],
      }),
    }), expect.anything());
  });

  it('rejects system-cancelled rows without writing or auditing', async () => {
    prismaMock.billingOccurrence.findFirst.mockResolvedValue({ ...occurrence, status: 'CANCELLED' });

    await expect(updateBillingOccurrence('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      status: 'OPEN',
      updateScope: 'THIS_OCCURRENCE',
      reason: 'Reopen',
    }, actor, prismaMock as never)).rejects.toMatchObject({ code: ErrorCodes.OCCURRENCE_IMMUTABLE });
    expect(prismaMock.billingOccurrence.updateMany).not.toHaveBeenCalled();
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });

  it('turns an optimistic claim miss into a version conflict without an audit', async () => {
    prismaMock.billingOccurrence.updateMany.mockResolvedValue({ count: 0 });

    await expect(updateBillingOccurrence('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      status: 'BILLED',
      updateScope: 'THIS_OCCURRENCE',
      reason: null,
    }, actor, prismaMock as never)).rejects.toMatchObject({ code: ErrorCodes.VERSION_CONFLICT });
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });

  it('resets only the requested date override to calculated expected date', async () => {
    const overridden = {
      ...occurrence,
      dateOverridden: true,
      dateOverrideReason: 'Client request',
      dateOverriddenById: actor.userId,
      dateOverriddenAt: new Date('2026-08-10T00:00:00.000Z'),
      operativeExpectedDate: new Date('2026-08-20T00:00:00.000Z'),
    };
    prismaMock.billingOccurrence.findFirst.mockResolvedValue(overridden);

    await resetBillingOverride('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      target: 'DATE',
      reason: 'Reset after review',
    }, actor, prismaMock as never);

    expect(prismaMock.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operativeExpectedDate: overridden.calculatedExpectedDate,
        dateOverridden: false,
        dateOverrideReason: null,
        dateOverriddenById: null,
        dateOverriddenAt: null,
      }),
    }));
    expect(auditMock.createAuditLog).toHaveBeenCalled();
  });

  it('resets only value override metadata for VALUE and both dimensions for ALL', async () => {
    const overridden = {
      ...occurrence,
      dateOverridden: true,
      dateOverrideReason: 'Client request',
      dateOverriddenById: actor.userId,
      dateOverriddenAt: new Date('2026-08-10T00:00:00.000Z'),
      operativeExpectedDate: new Date('2026-08-20T00:00:00.000Z'),
      valueOverridden: true,
      valueOverrideReason: 'Pricing review',
      valueOverriddenById: actor.userId,
      valueOverriddenAt: new Date('2026-08-10T00:00:00.000Z'),
      operativeAmount: '150.00',
      operativeCurrency: 'USD',
    };
    prismaMock.billingOccurrence.findFirst.mockResolvedValue(overridden);

    await resetBillingOverride('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      target: 'VALUE',
      reason: 'Reset price override',
    }, actor, prismaMock as never);
    expect(prismaMock.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operativeAmount: overridden.baseAmount,
        operativeCurrency: overridden.baseCurrency,
        valueOverridden: false,
        valueOverrideReason: null,
      }),
    }));
    expect(prismaMock.billingOccurrence.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty('operativeExpectedDate');

    vi.clearAllMocks();
    auditMock.createAuditLog.mockResolvedValue(undefined);
    prismaMock.billingOccurrence.findFirst.mockResolvedValue(overridden);
    prismaMock.billingOccurrence.updateMany.mockResolvedValue({ count: 1 });
    await resetBillingOverride('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      target: 'ALL',
      reason: 'Reset all overrides',
    }, actor, prismaMock as never);
    expect(prismaMock.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operativeExpectedDate: overridden.calculatedExpectedDate,
        operativeAmount: overridden.baseAmount,
        dateOverridden: false,
        valueOverridden: false,
      }),
    }));
  });

  it('does not audit or complete current-and-future edits when future count diverges', async () => {
    prismaMock.billingOccurrence.findMany.mockResolvedValue([{ id: 'future-1' }]);
    prismaMock.billingOccurrence.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(updateBillingOccurrence('occurrence-1', {
      expectedUpdatedAt: occurrence.updatedAt.toISOString(),
      amount: '1500.00',
      updateScope: 'THIS_AND_FUTURE',
      reason: 'Pricing review',
    }, actor, prismaMock as never)).rejects.toMatchObject({ code: ErrorCodes.VERSION_CONFLICT });
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });
});
