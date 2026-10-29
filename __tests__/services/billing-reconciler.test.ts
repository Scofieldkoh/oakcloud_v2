import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DateOnly } from '@/services/service-schedule';
import { hashConfiguration } from '@/services/service-schedule';
import { reconcileClientServiceBilling } from '@/services/billing';

type Occurrence = Record<string, unknown> & {
  id: string;
  feeLineId: string;
  billingPeriodKey: string;
  scheduleEntryKey: string;
  generationKey: string;
  calculatedExpectedDate: Date;
  operativeExpectedDate: Date;
  updatedAt: Date;
  dateOverridden: boolean;
  valueOverridden: boolean;
  status: string;
};

const mocks = vi.hoisted(() => ({
  clientService: { findFirst: vi.fn() },
  businessCalendar: { findFirst: vi.fn() },
  billingOccurrence: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    createMany: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks }));

const input = {
  tenantId: 'tenant-1',
  clientServiceId: 'service-1',
  today: '2026-08-18' as DateOnly,
  horizonEnd: '2027-08-18' as DateOnly,
  writeMode: 'APPLY' as const,
  reconciliationRequestId: 'request-1',
};

function feeLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fee-1',
    description: 'Monthly support',
    amount: '100.00',
    currency: 'SGD',
    billingFrequency: 'MONTHLY',
    billingStartDate: new Date('2026-08-01T00:00:00.000Z'),
    scheduleConfig: {
      schemaVersion: 1,
      cadence: 'MONTHLY',
      startDate: '2026-08-01',
      customInterval: { unit: 'MONTH', count: 1 },
      scheduleEntries: [{
        key: 'default',
        label: 'Billing date',
        expression: { kind: 'DAY_OF_MONTH', day: 1 },
        businessDayAdjustment: 'NONE',
      }],
    },
    isActive: true,
    deletedAt: null,
    deletedReason: null,
    ...overrides,
  };
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    id: 'service-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    status: 'ACTIVE',
    deletedAt: null,
    endDate: null,
    billingDisposition: 'CONFIGURED',
    feeLines: [feeLine()],
    ...overrides,
  };
}

function occurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: 'occ-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    clientServiceId: 'service-1',
    feeLineId: 'fee-1',
    billingPeriodKey: '2026-09',
    scheduleEntryKey: 'default',
    generationKey: 'generation-1',
    calculatedExpectedDate: new Date('2026-09-01T00:00:00.000Z'),
    operativeExpectedDate: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    dateOverridden: false,
    valueOverridden: false,
    baseAmount: '100.00',
    baseCurrency: 'SGD',
    operativeAmount: '100.00',
    operativeCurrency: 'SGD',
    status: 'OPEN',
    billedDate: null,
    markedBilledAt: null,
    markedBilledById: null,
    waivedAt: null,
    waivedById: null,
    waiverReason: null,
    cancelledAt: null,
    cancelledById: null,
    cancellationReason: null,
    ...overrides,
  };
}

describe('reconcileClientServiceBilling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientService.findFirst.mockResolvedValue(service());
    mocks.businessCalendar.findFirst.mockResolvedValue(null);
    mocks.billingOccurrence.findMany.mockResolvedValue([]);
    mocks.billingOccurrence.createMany.mockResolvedValue({ count: 12 });
    mocks.billingOccurrence.updateMany.mockResolvedValue({ count: 1 });
  });

  it('creates rolling occurrences from active configured fee lines', async () => {
    const result = await reconcileClientServiceBilling(input);

    expect(result.created).toBe(12);
    expect(mocks.billingOccurrence.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: expect.arrayContaining([
        expect.objectContaining({
          tenantId: 'tenant-1',
          companyId: 'company-1',
          clientServiceId: 'service-1',
          feeLineId: 'fee-1',
          billingPeriodKey: expect.any(String),
          generationKey: expect.any(String),
          status: 'OPEN',
        }),
      ]),
    }));
  });

  it('creates the first billing period when a new service starts in the past', async () => {
    mocks.clientService.findFirst.mockResolvedValue(service({
      feeLines: [feeLine({
        billingFrequency: 'ANNUALLY',
        billingStartDate: new Date('2025-11-07T00:00:00.000Z'),
        scheduleConfig: {
          schemaVersion: 1,
          cadence: 'ANNUALLY',
          startDate: '2025-11-07',
          customInterval: { unit: 'MONTH', count: 12 },
          scheduleEntries: [{
            key: 'default',
            label: 'Billing date',
            expression: { kind: 'DAY_OF_MONTH', day: 7 },
            businessDayAdjustment: 'NONE',
          }],
        },
      })],
    }));
    mocks.billingOccurrence.createMany.mockResolvedValue({ count: 2 });

    const result = await reconcileClientServiceBilling({
      ...input,
      today: '2026-09-01',
      horizonEnd: '2027-09-01',
      includeHistoricalStart: true,
    });

    const createData = mocks.billingOccurrence.createMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
    expect(result.created).toBe(2);
    expect(createData).toHaveLength(2);
    expect(createData.map((row) => row.calculatedExpectedDate)).toEqual(expect.arrayContaining([
      new Date('2025-11-07T00:00:00.000Z'),
      new Date('2026-11-07T00:00:00.000Z'),
    ]));
  });

  it('backfills all recent historical periods for creation or activation reconciliation', async () => {
    mocks.clientService.findFirst.mockResolvedValue(service({
      feeLines: [feeLine({
        billingFrequency: 'ANNUALLY',
        billingStartDate: new Date('2025-08-19T00:00:00.000Z'),
        scheduleConfig: {
          schemaVersion: 1,
          cadence: 'ANNUALLY',
          startDate: '2025-08-19',
          customInterval: { unit: 'MONTH', count: 12 },
          scheduleEntries: [{
            key: 'default',
            label: 'Billing date',
            expression: { kind: 'DAY_OF_MONTH', day: 19 },
            businessDayAdjustment: 'NONE',
          }],
        },
      })],
    }));
    mocks.billingOccurrence.createMany.mockResolvedValue({ count: 3 });

    const result = await reconcileClientServiceBilling({
      ...input,
      today: '2026-09-01',
      horizonEnd: '2027-09-01',
      includeHistoricalStart: true,
    });

    const createData = mocks.billingOccurrence.createMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
    expect(result.created).toBe(3);
    expect(createData).toHaveLength(3);
    expect(createData.map((row) => row.calculatedExpectedDate)).toEqual(expect.arrayContaining([
      new Date('2025-08-19T00:00:00.000Z'),
      new Date('2026-08-19T00:00:00.000Z'),
      new Date('2027-08-19T00:00:00.000Z'),
    ]));
  });

  it('does not repeat historical backfill during ordinary reconciliation', async () => {
    mocks.clientService.findFirst.mockResolvedValue(service({
      source: 'AGREEMENT',
      feeLines: [feeLine({
        billingFrequency: 'ANNUALLY',
        billingStartDate: new Date('2025-08-19T00:00:00.000Z'),
        scheduleConfig: {
          schemaVersion: 1,
          cadence: 'ANNUALLY',
          startDate: '2025-08-19',
          customInterval: { unit: 'MONTH', count: 12 },
          scheduleEntries: [{
            key: 'default',
            label: 'Billing date',
            expression: { kind: 'DAY_OF_MONTH', day: 19 },
            businessDayAdjustment: 'NONE',
          }],
        },
      })],
    }));
    mocks.billingOccurrence.createMany.mockResolvedValue({ count: 1 });

    const result = await reconcileClientServiceBilling({
      ...input,
      today: '2026-09-01',
      horizonEnd: '2027-09-01',
    });

    const createData = mocks.billingOccurrence.createMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
    expect(result.created).toBe(1);
    expect(createData).toHaveLength(1);
    expect(createData[0]?.calculatedExpectedDate).toEqual(new Date('2027-08-19T00:00:00.000Z'));
  });

  it('caps historical backfill at 50 occurrences', async () => {
    mocks.clientService.findFirst.mockResolvedValue(service({
      feeLines: [feeLine({
        billingFrequency: 'MONTHLY',
        billingStartDate: new Date('2000-01-19T00:00:00.000Z'),
        scheduleConfig: {
          schemaVersion: 1,
          cadence: 'MONTHLY',
          startDate: '2000-01-19',
          customInterval: { unit: 'MONTH', count: 1 },
          scheduleEntries: [{
            key: 'default',
            label: 'Billing date',
            expression: { kind: 'DAY_OF_MONTH', day: 19 },
            businessDayAdjustment: 'NONE',
          }],
        },
      })],
    }));
    mocks.billingOccurrence.createMany.mockResolvedValue({ count: 62 });

    const result = await reconcileClientServiceBilling({
      ...input,
      today: '2026-09-01',
      horizonEnd: '2027-09-01',
      includeHistoricalStart: true,
    });

    const createData = mocks.billingOccurrence.createMany.mock.calls[0]?.[0]?.data as Array<Record<string, unknown>>;
    expect(result.created).toBe(62);
    expect(createData).toHaveLength(62);
    expect(createData.map((row) => row.calculatedExpectedDate)).toEqual(expect.arrayContaining([
      new Date('2022-07-19T00:00:00.000Z'),
      new Date('2026-08-19T00:00:00.000Z'),
      new Date('2027-08-19T00:00:00.000Z'),
    ]));
    expect(createData.map((row) => row.calculatedExpectedDate)).not.toContain(new Date('2000-01-19T00:00:00.000Z'));
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HISTORICAL_BACKFILL_CAPPED' }),
    ]));
  });

  it('preserves historical, billed, waived, cancelled, and overridden occurrences', async () => {
    mocks.billingOccurrence.findMany.mockResolvedValue([
      occurrence({ id: 'occ-historical', billingPeriodKey: '2026-07', calculatedExpectedDate: new Date('2026-07-01'), operativeExpectedDate: new Date('2026-07-01') }),
      occurrence({ id: 'occ-billed', billingPeriodKey: '2028-01', status: 'BILLED' }),
      occurrence({ id: 'occ-waived', billingPeriodKey: '2028-02', status: 'WAIVED' }),
      occurrence({ id: 'occ-cancelled', billingPeriodKey: '2028-03', status: 'CANCELLED' }),
      occurrence({ id: 'occ-overridden', billingPeriodKey: '2028-04', dateOverridden: true, operativeExpectedDate: new Date('2028-04-15') }),
    ]);

    const result = await reconcileClientServiceBilling({ ...input, writeMode: 'OBSERVE' });

    expect(result.preservedByReason).toMatchObject({
      HISTORICAL: 1,
      BILLED: 1,
      WAIVED: 1,
      CANCELLED: 1,
      OVERRIDDEN: 1,
    });
    expect(mocks.billingOccurrence.updateMany).not.toHaveBeenCalled();
  });

  it('preserves a future occurrence produced by a relative offset from an earlier cycle', async () => {
    const generation = `billing-v1-${hashConfiguration({ feeLineId: 'fee-1' })}`;
    mocks.clientService.findFirst.mockResolvedValue(service({
      feeLines: [feeLine({
        scheduleConfig: {
          schemaVersion: 1,
          cadence: 'MONTHLY',
          startDate: '2026-01-01',
          customInterval: { unit: 'MONTH', count: 1 },
          scheduleEntries: [{
            key: 'relative-start',
            label: 'Relative start',
            expression: { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'CYCLE_START' }, offset: 90, unit: 'CALENDAR_DAY' },
            businessDayAdjustment: 'NONE',
          }],
        },
      })],
    }));
    mocks.billingOccurrence.findMany.mockResolvedValue([occurrence({
      billingPeriodKey: '2026-06',
      scheduleEntryKey: 'relative-start',
      generationKey: generation,
      calculatedExpectedDate: new Date('2026-08-30T00:00:00.000Z'),
      operativeExpectedDate: new Date('2026-08-30T00:00:00.000Z'),
    })]);

    const result = await reconcileClientServiceBilling({
      ...input,
      today: '2026-08-01',
      horizonEnd: '2026-08-31',
    });

    expect(result.cancelled).toBe(0);
    expect(mocks.billingOccurrence.updateMany).not.toHaveBeenCalled();
    expect(mocks.billingOccurrence.createMany).not.toHaveBeenCalled();
  });

  it('preserves a future occurrence whose positive offset crosses dense weekday holidays', async () => {
    const denseHolidays = new Set<string>();
    let cursor = new Date('2025-01-02T00:00:00.000Z');
    while (denseHolidays.size < 100) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) denseHolidays.add(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
    const generation = `billing-v1-${hashConfiguration({ feeLineId: 'fee-1' })}`;
    mocks.clientService.findFirst.mockResolvedValue(service({
      feeLines: [feeLine({
        scheduleConfig: {
          schemaVersion: 1,
          cadence: 'MONTHLY',
          startDate: '2025-01-01',
          customInterval: { unit: 'MONTH', count: 1 },
          scheduleEntries: [{
            key: 'dense-positive',
            label: 'Dense positive',
            expression: { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'CYCLE_START' }, offset: 1, unit: 'BUSINESS_DAY' },
            businessDayAdjustment: 'NONE',
          }],
        },
        billingStartDate: new Date('2025-01-01T00:00:00.000Z'),
      })],
      companyId: 'company-1',
    }));
    mocks.businessCalendar.findFirst.mockResolvedValue({
      id: 'dense-calendar',
      timeZone: 'Asia/Singapore',
      revision: 1,
      weekendDays: [0, 6],
      holidays: [...denseHolidays],
    });
    mocks.billingOccurrence.findMany.mockResolvedValue([occurrence({
      billingPeriodKey: '2025-01',
      scheduleEntryKey: 'dense-positive',
      generationKey: generation,
      calculatedExpectedDate: new Date('2025-05-22T00:00:00.000Z'),
      operativeExpectedDate: new Date('2025-05-22T00:00:00.000Z'),
    })]);

    const result = await reconcileClientServiceBilling({
      ...input,
      today: '2025-05-22',
      horizonEnd: '2025-05-22',
    });

    expect(result.cancelled).toBe(0);
    expect(mocks.billingOccurrence.updateMany).not.toHaveBeenCalled();
    expect(mocks.billingOccurrence.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.arrayContaining([expect.objectContaining({ billingPeriodKey: '2025-01' })]),
    }));
  });

  it.each([
    ['PAUSED', null],
    ['ENDED', null],
    ['ACTIVE', new Date('2026-08-01')],
  ] as const)('does not extend a %s/deleted service', async (status, deletedAt) => {
    mocks.clientService.findFirst.mockResolvedValue(service({ status, deletedAt }));

    const result = await reconcileClientServiceBilling(input);

    expect(result.created).toBe(0);
    expect(mocks.billingOccurrence.createMany).not.toHaveBeenCalled();
  });

  it('cancels future rows for a not-required service with request provenance', async () => {
    mocks.clientService.findFirst.mockResolvedValue(service({ billingDisposition: 'NOT_REQUIRED', billingNotRequiredReason: 'Included elsewhere' }));
    mocks.billingOccurrence.findMany.mockResolvedValue([occurrence({ billingPeriodKey: '2026-09' })]);

    const result = await reconcileClientServiceBilling({ ...input, writeMode: 'APPLY' });

    expect(result.created).toBe(0);
    expect(result.cancelled).toBe(1);
    expect(result.warnings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CANCELLATION_ACTOR_REQUIRED' }),
    ]));
    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANCELLED',
        cancelledById: null,
        cancellationReconciliationRequestId: 'request-1',
        cancelledAt: expect.any(Date),
        cancellationReason: expect.any(String),
      }),
    }));
  });

  it.each([
    ['ENDED', { status: 'ENDED' }],
    ['elapsed end date', { endDate: new Date('2026-08-17') }],
  ] as const)('uses an ended-service cancellation reason for %s', async (_label, serviceChanges) => {
    mocks.clientService.findFirst.mockResolvedValue(service(serviceChanges));
    mocks.billingOccurrence.findMany.mockResolvedValue([occurrence({ billingPeriodKey: '2026-09' })]);

    const result = await reconcileClientServiceBilling(input);

    expect(result.cancelled).toBe(1);
    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANCELLED',
        cancellationReason: 'Client service ended or expired',
      }),
    }));
  });

  it('cancels only future open rows for not-required billing and preserves billing history', async () => {
    mocks.clientService.findFirst.mockResolvedValue(service({
      billingDisposition: 'NOT_REQUIRED',
      billingNotRequiredReason: 'Included elsewhere',
    }));
    mocks.billingOccurrence.findMany.mockResolvedValue([
      occurrence({ id: 'future-open', billingPeriodKey: '2026-09', status: 'OPEN' }),
      occurrence({ id: 'historical-open', billingPeriodKey: '2026-07', operativeExpectedDate: new Date('2026-07-01'), status: 'OPEN' }),
      occurrence({ id: 'billed', billingPeriodKey: '2026-10', status: 'BILLED' }),
      occurrence({ id: 'waived', billingPeriodKey: '2026-11', status: 'WAIVED' }),
    ]);

    const result = await reconcileClientServiceBilling(input);

    expect(result.cancelled).toBe(1);
    expect(result.preservedByReason).toMatchObject({ HISTORICAL: 1, BILLED: 1, WAIVED: 1 });
    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.billingOccurrence.updateMany.mock.calls[0]?.[0].where).toEqual(expect.objectContaining({ id: 'future-open', status: 'OPEN' }));
  });

  it('preserves existing rows when a fee-line schedule is incomplete', async () => {
    mocks.clientService.findFirst.mockResolvedValue(service({
      feeLines: [feeLine({ scheduleConfig: null, billingStartDate: null })],
    }));
    mocks.billingOccurrence.findMany.mockResolvedValue([occurrence({ billingPeriodKey: '2026-09' })]);

    const result = await reconcileClientServiceBilling(input);

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_SCHEDULE', feeLineId: 'fee-1' }),
    ]));
    expect(result.preserved).toBe(1);
    expect(result.cancelled).toBe(0);
    expect(mocks.billingOccurrence.updateMany).not.toHaveBeenCalled();
  });

  it('classifies a malformed business calendar as invalid schedule without materializing', async () => {
    mocks.businessCalendar.findFirst.mockResolvedValue({
      id: 'malformed-calendar',
      timeZone: 'Asia/Singapore',
      revision: 1,
      weekendDays: [7],
      holidays: [],
    });

    const result = await reconcileClientServiceBilling(input);

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_SCHEDULE', feeLineId: 'fee-1' }),
    ]));
    expect(result.created).toBe(0);
    expect(mocks.billingOccurrence.createMany).not.toHaveBeenCalled();
  });

  it('refreshes calculated/base values while retaining operative overrides', async () => {
    const generation = `billing-v1-${hashConfiguration({
      feeLineId: 'fee-1',
    })}`;
    const overridden = occurrence({
      id: 'occ-overridden',
      billingPeriodKey: '2026-09',
      generationKey: generation,
      dateOverridden: true,
      calculatedExpectedDate: new Date('2026-08-25'),
      operativeExpectedDate: new Date('2026-09-15'),
      valueOverridden: true,
      baseAmount: '90.00',
      baseCurrency: 'SGD',
      operativeAmount: '125.00',
      operativeCurrency: 'USD',
    });
    mocks.billingOccurrence.findMany.mockResolvedValue([overridden]);

    const result = await reconcileClientServiceBilling(input);

    expect(result.preservedByReason.OVERRIDDEN).toBe(1);
    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'occ-overridden', tenantId: 'tenant-1', clientServiceId: 'service-1' }),
      data: expect.objectContaining({
        calculatedExpectedDate: new Date('2026-09-01T00:00:00.000Z'),
        baseAmount: '100.00',
      }),
    }));
    const update = mocks.billingOccurrence.updateMany.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(update).not.toHaveProperty('operativeExpectedDate');
    expect(update).not.toHaveProperty('operativeAmount');
  });

  it('writes cancellation metadata only when an actor is supplied', async () => {
    mocks.billingOccurrence.findMany.mockResolvedValue([occurrence({ billingPeriodKey: '2026-09', generationKey: 'old-generation' })]);

    await reconcileClientServiceBilling({
      ...input,
      cancellationActorId: 'user-1',
    });

    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANCELLED',
        cancelledById: 'user-1',
        cancellationReconciliationRequestId: 'request-1',
        cancelledAt: expect.any(Date),
        cancellationReason: expect.any(String),
      }),
    }));
  });

  it.each([
    ['BILLED', { status: 'BILLED' }, 'BILLED'],
    ['WAIVED', { status: 'WAIVED' }, 'WAIVED'],
    ['date override', { dateOverridden: true, operativeExpectedDate: new Date('2026-09-15') }, 'OVERRIDDEN'],
    ['value override', { valueOverridden: true, operativeAmount: '125.00' }, 'OVERRIDDEN'],
  ] as const)('does not overwrite a concurrent %s transition when recalculating', async (_label, freshChanges, preservedReason) => {
    const generation = `billing-v1-${hashConfiguration({
      feeLineId: 'fee-1',
    })}`;
    const stale = occurrence({ generationKey: generation, baseAmount: '90.00' });
    const fresh = occurrence({ generationKey: generation, ...freshChanges });
    mocks.billingOccurrence.findMany.mockResolvedValue([stale]);
    mocks.billingOccurrence.updateMany.mockResolvedValue({ count: 0 });
    mocks.billingOccurrence.findFirst.mockResolvedValue(fresh);

    const result = await reconcileClientServiceBilling(input);

    expect(result.recalculated).toBe(0);
    expect(result.preservedByReason[preservedReason]).toBe(1);
    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: stale.id,
        tenantId: input.tenantId,
        clientServiceId: input.clientServiceId,
        feeLineId: stale.feeLineId,
        billingPeriodKey: stale.billingPeriodKey,
        scheduleEntryKey: stale.scheduleEntryKey,
        generationKey: stale.generationKey,
        updatedAt: stale.updatedAt,
        status: 'OPEN',
        operativeExpectedDate: { gte: new Date('2026-08-18T00:00:00.000Z') },
        dateOverridden: stale.dateOverridden,
        valueOverridden: stale.valueOverridden,
      }),
    }));
  });

  it('retries a recalculation after an unrelated concurrent edit keeps the row eligible', async () => {
    const generation = `billing-v1-${hashConfiguration({
      feeLineId: 'fee-1',
    })}`;
    const stale = occurrence({ generationKey: generation, baseAmount: '90.00' });
    const fresh = occurrence({
      generationKey: generation,
      baseAmount: '90.00',
      updatedAt: new Date('2026-08-19T00:00:00.000Z'),
      notes: 'Concurrent lifecycle edit',
    });
    mocks.billingOccurrence.findMany.mockResolvedValue([stale]);
    mocks.billingOccurrence.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.billingOccurrence.findFirst.mockResolvedValue(fresh);

    const result = await reconcileClientServiceBilling({
      ...input,
      horizonEnd: '2026-09-01',
    });

    expect(result.recalculated).toBe(1);
    expect(result.preserved).toBe(0);
    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.billingOccurrence.updateMany.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ updatedAt: fresh.updatedAt }),
    }));
    expect(mocks.billingOccurrence.updateMany.mock.calls[0]?.[0].where).not.toHaveProperty('origin');
  });

  it.each([
    ['date-overridden', { dateOverridden: true, operativeExpectedDate: new Date('2026-09-15T00:00:00.000Z') }, 'operativeExpectedDate'],
    ['value-overridden', { valueOverridden: true, operativeAmount: '125.00' }, 'operativeAmount'],
  ] as const)('retries hidden refresh for an initially %s row after an unrelated edit', async (_label, overrides, protectedField) => {
    const generation = `billing-v1-${hashConfiguration({
      feeLineId: 'fee-1',
    })}`;
    const stale = occurrence({
      generationKey: generation,
      calculatedExpectedDate: new Date('2026-08-25T00:00:00.000Z'),
      baseAmount: '90.00',
      ...overrides,
    });
    const fresh = occurrence({
      ...stale,
      updatedAt: new Date('2026-08-19T00:00:00.000Z'),
      notes: 'Concurrent lifecycle edit',
    });
    mocks.billingOccurrence.findMany.mockResolvedValue([stale]);
    mocks.billingOccurrence.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.billingOccurrence.findFirst.mockResolvedValue(fresh);

    const result = await reconcileClientServiceBilling({
      ...input,
      horizonEnd: '2026-09-01',
    });

    expect(result.recalculated).toBe(0);
    expect(result.preservedByReason.OVERRIDDEN).toBe(1);
    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledTimes(2);
    const data = mocks.billingOccurrence.updateMany.mock.calls[1]?.[0].data as Record<string, unknown>;
    expect(data).toEqual(expect.objectContaining({
      calculatedExpectedDate: new Date('2026-09-01T00:00:00.000Z'),
      baseAmount: '100.00',
    }));
    expect(data).not.toHaveProperty(protectedField);
    expect(data).not.toHaveProperty('operativeExpectedDate');
    expect(data).not.toHaveProperty('operativeAmount');
    expect(mocks.billingOccurrence.updateMany.mock.calls[1]?.[0].where).toEqual(expect.objectContaining({
      updatedAt: fresh.updatedAt,
      dateOverridden: stale.dateOverridden,
      valueOverridden: stale.valueOverridden,
    }));
  });

  it('does not count a concurrent writer that already applied the desired recalculation', async () => {
    const generation = `billing-v1-${hashConfiguration({
      feeLineId: 'fee-1',
    })}`;
    const stale = occurrence({ generationKey: generation, baseAmount: '90.00' });
    const fresh = occurrence({
      generationKey: generation,
      updatedAt: new Date('2026-08-19T00:00:00.000Z'),
      baseAmount: '100.00',
      baseCurrency: 'SGD',
      operativeAmount: '100.00',
      operativeCurrency: 'SGD',
      calculatedExpectedDate: new Date('2026-09-01T00:00:00.000Z'),
      operativeExpectedDate: new Date('2026-09-01T00:00:00.000Z'),
    });
    mocks.billingOccurrence.findMany.mockResolvedValue([stale]);
    mocks.billingOccurrence.updateMany.mockResolvedValue({ count: 0 });
    mocks.billingOccurrence.findFirst.mockResolvedValue(fresh);

    const result = await reconcileClientServiceBilling({
      ...input,
      horizonEnd: '2026-09-01',
    });

    expect(result.recalculated).toBe(0);
    expect(result.preserved).toBe(0);
    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledTimes(1);
  });

  it('preserves a cancellation when a concurrent writer protects the row', async () => {
    const stale = occurrence({ generationKey: 'old-generation' });
    const fresh = occurrence({
      generationKey: 'old-generation',
      status: 'CANCELLED',
      updatedAt: new Date('2026-08-19T00:00:00.000Z'),
      cancellationReconciliationRequestId: 'request-1',
      cancellationReason: 'Already cancelled by another worker',
      cancelledAt: new Date('2026-08-19T00:00:00.000Z'),
    });
    mocks.clientService.findFirst.mockResolvedValue(service({ billingDisposition: 'NOT_REQUIRED' }));
    mocks.billingOccurrence.findMany.mockResolvedValue([stale]);
    mocks.billingOccurrence.updateMany.mockResolvedValue({ count: 0 });
    mocks.billingOccurrence.findFirst.mockResolvedValue(fresh);

    const result = await reconcileClientServiceBilling(input);

    expect(result.cancelled).toBe(0);
    expect(result.preservedByReason.CANCELLED).toBe(1);
    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledTimes(1);
  });

  it('retries a cancellation after an unrelated concurrent edit keeps the row eligible', async () => {
    const stale = occurrence({ generationKey: 'old-generation' });
    const fresh = occurrence({
      generationKey: 'old-generation',
      updatedAt: new Date('2026-08-19T00:00:00.000Z'),
      notes: 'Concurrent lifecycle edit',
    });
    mocks.clientService.findFirst.mockResolvedValue(service({ billingDisposition: 'NOT_REQUIRED' }));
    mocks.billingOccurrence.findMany.mockResolvedValue([stale]);
    mocks.billingOccurrence.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.billingOccurrence.findFirst.mockResolvedValue(fresh);

    const result = await reconcileClientServiceBilling(input);

    expect(result.cancelled).toBe(1);
    expect(result.preserved).toBe(0);
    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.billingOccurrence.updateMany.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ updatedAt: fresh.updatedAt }),
    }));
  });

  it('surfaces a transient conflict after bounded optimistic retries are exhausted', async () => {
    const generation = `billing-v1-${hashConfiguration({
      feeLineId: 'fee-1',
    })}`;
    const stale = occurrence({ generationKey: generation, baseAmount: '90.00' });
    const fresh = occurrence({
      generationKey: generation,
      baseAmount: '90.00',
      updatedAt: new Date('2026-08-19T00:00:00.000Z'),
      notes: 'Repeated concurrent edit',
    });
    mocks.billingOccurrence.findMany.mockResolvedValue([stale]);
    mocks.billingOccurrence.updateMany.mockResolvedValue({ count: 0 });
    mocks.billingOccurrence.findFirst.mockResolvedValue(fresh);

    await expect(reconcileClientServiceBilling({
      ...input,
      horizonEnd: '2026-09-01',
    })).rejects.toMatchObject({ code: 'BILLING_RECONCILIATION_CONFLICT' });
    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledTimes(3);
  });

  it('does not report a cancellation when a concurrent write changes its optimistic token', async () => {
    mocks.billingOccurrence.findMany.mockResolvedValue([occurrence({ generationKey: 'old-generation' })]);
    mocks.billingOccurrence.updateMany.mockResolvedValue({ count: 0 });
    mocks.billingOccurrence.findFirst.mockResolvedValue(occurrence({ notes: 'concurrent edit' }));

    const result = await reconcileClientServiceBilling(input);

    expect(result.cancelled).toBe(0);
    expect(result.preserved).toBe(1);
    expect(mocks.billingOccurrence.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        updatedAt: new Date('2026-08-18T00:00:00.000Z'),
        status: 'OPEN',
        operativeExpectedDate: { gte: new Date('2026-08-18T00:00:00.000Z') },
        dateOverridden: false,
        valueOverridden: false,
      }),
    }));
  });

  it('keeps the generation stable across ordinary schedule edits while changing fee-line lifecycle identity', async () => {
    const run = async (line: Record<string, unknown>) => {
      mocks.billingOccurrence.findMany.mockResolvedValue([]);
      mocks.clientService.findFirst.mockResolvedValue(service({ feeLines: [line] }));
      await reconcileClientServiceBilling(input);
      return (mocks.billingOccurrence.createMany.mock.calls.at(-1)?.[0].data as Array<Record<string, unknown>>)[0].generationKey;
    };

    const first = await run(feeLine());
    const reordered = await run(feeLine({
      scheduleConfig: {
        ...feeLine().scheduleConfig as Record<string, unknown>,
        scheduleEntries: [...(feeLine().scheduleConfig as Record<string, unknown>).scheduleEntries as Array<Record<string, unknown>>].reverse(),
      },
    }));
    const edited = await run(feeLine({
      scheduleConfig: {
        ...feeLine().scheduleConfig as Record<string, unknown>,
        scheduleEntries: [{
          key: 'default',
          label: 'Edited billing date',
          expression: { kind: 'DAY_OF_MONTH', day: 2 },
          businessDayAdjustment: 'NONE',
        }],
      },
    }));
    const reactivated = await run(feeLine({ id: 'fee-2' }));

    expect(reordered).toBe(first);
    expect(edited).toBe(first);
    expect(reactivated).not.toBe(first);
  });
});
