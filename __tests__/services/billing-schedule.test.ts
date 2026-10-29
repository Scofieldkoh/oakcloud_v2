import { describe, expect, it } from 'vitest';

import {
  convertLegacyBillingSchedule,
  evaluateBillingSchedule,
} from '@/services/billing';
import { addBusinessDays, addCalendarDays, MAX_SEARCH_DAYS } from '@/services/service-schedule';
import type { BillingScheduleConfigV1 } from '@/services/billing';
import type { BusinessCalendarSnapshot, DateOnly } from '@/services/service-schedule';

const calendar: BusinessCalendarSnapshot = {
  id: 'sg-calendar',
  timeZone: 'Asia/Singapore',
  revision: 1,
  weekendDays: new Set([0, 6]),
  holidays: new Set(['2026-02-16']),
};

const entry = (key: string, day: number, businessDayAdjustment: 'NONE' | 'PREVIOUS' | 'NEXT' = 'NONE') => ({
  key,
  label: key,
  expression: { kind: 'DAY_OF_MONTH' as const, day },
  businessDayAdjustment,
});

function consecutiveWeekdayHolidays(start: DateOnly, count: number): Set<DateOnly> {
  const holidays = new Set<DateOnly>();
  let cursor = start;
  while (holidays.size < count) {
    const day = new Date(`${cursor}T00:00:00.000Z`).getUTCDay();
    if (day !== 0 && day !== 6) holidays.add(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return holidays;
}

class CountingHolidaySet extends Set<DateOnly> {
  iterationCount = 0;

  constructor(values: Iterable<DateOnly>) {
    super(values);
    const originalIterator = this[Symbol.iterator].bind(this);
    Object.defineProperty(this, Symbol.iterator, {
      value: () => {
        const iterator = originalIterator();
        const countIteration = () => {
          this.iterationCount += 1;
          if (this.iterationCount > 20_000) {
            throw new Error('holiday iteration budget exceeded');
          }
        };
        return {
          next() {
            const result = iterator.next();
            if (!result.done) countIteration();
            return result;
          },
          [Symbol.iterator]() {
            return this;
          },
        } as SetIterator<DateOnly>;
      },
    });
  }
}

describe('legacy billing schedule conversion', () => {
  it.each([
    ['MONTHLY', 1],
    ['QUARTERLY', 3],
    ['SEMI_ANNUALLY', 6],
    ['ANNUALLY', 12],
  ] as const)('converts %s without guessing a missing start date', (frequency, monthCount) => {
    expect(convertLegacyBillingSchedule({
      billingFrequency: frequency,
      billingStartDate: null,
      customFrequencyLabel: null,
    })).toMatchObject({
      config: {
        cadence: frequency,
        startDate: null,
        customInterval: { unit: 'MONTH', count: monthCount },
        scheduleEntries: [],
      },
      issueType: 'MISSING_START_DATE',
    });
  });

  it('converts a dated legacy line into a stable default entry', () => {
    expect(convertLegacyBillingSchedule({
      billingFrequency: 'MONTHLY',
      billingStartDate: '2026-08-31',
      customFrequencyLabel: null,
    })).toEqual({
      config: {
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2026-08-31',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [{
          key: 'default',
          label: 'Billing date',
          expression: { kind: 'DAY_OF_MONTH', day: 31 },
          businessDayAdjustment: 'NONE',
        }],
      },
      issueType: null,
    });
  });

  it('keeps one-time conversion bounded and preserves its optional start date', () => {
    expect(convertLegacyBillingSchedule({
      billingFrequency: 'ONE_TIME',
      billingStartDate: '2026-08-15',
      customFrequencyLabel: null,
    })).toEqual({
      config: {
        schemaVersion: 1,
        cadence: 'ONE_TIME',
        startDate: '2026-08-15',
        customInterval: null,
        scheduleEntries: [{
          key: 'default',
          label: 'Billing date',
          expression: { kind: 'DAY_OF_MONTH', day: 15 },
          businessDayAdjustment: 'NONE',
        }],
      },
      issueType: null,
    });
  });

  it('leaves label-only custom schedules invalid for review', () => {
    expect(convertLegacyBillingSchedule({
      billingFrequency: 'CUSTOM',
      billingStartDate: null,
      customFrequencyLabel: 'When needed',
    })).toEqual({ config: null, issueType: 'INVALID_CUSTOM_SCHEDULE' });
  });
});

describe('billing schedule evaluation', () => {
  it.each([
    ['id', { ...calendar, id: '' }, /business calendar id is required/i],
    ['revision', { ...calendar, revision: 0 }, /business calendar revision must be a positive integer/i],
    ['weekend day', { ...calendar, weekendDays: new Set([7]) }, /weekend days must be integers from 0 through 6/i],
    ['holiday', { ...calendar, holidays: new Set<DateOnly>(['2026-02-30' as DateOnly]) }, /expected a real Gregorian date/i],
  ] as const)('rejects a malformed %s calendar for plain calendar-day entries', (_field, malformedCalendar, message) => {
    expect(() => evaluateBillingSchedule({
      config: {
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2026-08-01',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [entry('plain', 1)],
      },
      feeLine: { id: 'fee-plain-calendar', amount: '10', currency: 'SGD' },
      calendar: malformedCalendar,
      from: '2026-08-01',
      to: '2026-08-31',
      generationKey: 'plain-calendar-v1',
    })).toThrow(message);
  });

  it('looks back beyond one cadence for a positive relative cycle-start offset', () => {
    const occurrences = evaluateBillingSchedule({
      config: {
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
      feeLine: { id: 'fee-relative-start', amount: '10', currency: 'SGD' },
      calendar,
      from: '2026-08-01',
      to: '2026-08-31',
      generationKey: 'rolling-v1',
    });

    expect(occurrences).toContainEqual(expect.objectContaining({
      billingPeriodKey: '2026-06',
      calculatedExpectedDate: '2026-08-30',
    }));
  });

  it('looks ahead beyond one cadence for a negative relative cycle-end offset', () => {
    const occurrences = evaluateBillingSchedule({
      config: {
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2026-01-01',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [{
          key: 'relative-end',
          label: 'Relative end',
          expression: { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'CYCLE_END' }, offset: -90, unit: 'CALENDAR_DAY' },
          businessDayAdjustment: 'NONE',
        }],
      },
      feeLine: { id: 'fee-relative-end', amount: '10', currency: 'SGD' },
      calendar,
      from: '2026-07-01',
      to: '2026-07-31',
      generationKey: 'rolling-v1',
    });

    expect(occurrences).toContainEqual(expect.objectContaining({
      billingPeriodKey: '2026-09',
      calculatedExpectedDate: '2026-07-02',
    }));
  });

  it('uses distant business-day relative offsets across the requested boundary', () => {
    const occurrences = evaluateBillingSchedule({
      config: {
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2026-01-01',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [{
          key: 'relative-business-start',
          label: 'Relative business start',
          expression: { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'CYCLE_START' }, offset: 45, unit: 'BUSINESS_DAY' },
          businessDayAdjustment: 'NEXT',
        }],
      },
      feeLine: { id: 'fee-relative-business-start', amount: '10', currency: 'SGD' },
      calendar,
      from: '2026-08-01',
      to: '2026-08-31',
      generationKey: 'rolling-v1',
    });

    expect(occurrences).toContainEqual(expect.objectContaining({
      billingPeriodKey: '2026-06',
      calculatedExpectedDate: '2026-08-03',
      operativeExpectedDate: '2026-08-03',
    }));
  });

  it('looks back across dense weekday holidays for a positive business-day offset', () => {
    const denseHolidayCalendar: BusinessCalendarSnapshot = {
      ...calendar,
      holidays: consecutiveWeekdayHolidays('2025-01-02', 100),
    };
    const occurrences = evaluateBillingSchedule({
      config: {
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
      feeLine: { id: 'fee-dense-positive', amount: '10', currency: 'SGD' },
      calendar: denseHolidayCalendar,
      from: '2025-05-22',
      to: '2025-05-22',
      generationKey: 'rolling-v1',
    });

    expect(occurrences).toContainEqual(expect.objectContaining({
      billingPeriodKey: '2025-01',
      calculatedExpectedDate: '2025-05-22',
    }));
  });

  it('looks ahead across dense weekday holidays for a negative business-day offset', () => {
    const denseHolidayCalendar: BusinessCalendarSnapshot = {
      ...calendar,
      holidays: consecutiveWeekdayHolidays('2025-01-17', 100),
    };
    const occurrences = evaluateBillingSchedule({
      config: {
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2025-01-01',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [{
          key: 'dense-negative',
          label: 'Dense negative',
          expression: { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'CYCLE_START' }, offset: -1, unit: 'BUSINESS_DAY' },
          businessDayAdjustment: 'NONE',
        }],
      },
      feeLine: { id: 'fee-dense-negative', amount: '10', currency: 'SGD' },
      calendar: denseHolidayCalendar,
      from: '2025-01-16',
      to: '2025-01-16',
      generationKey: 'rolling-v1',
    });

    expect(occurrences).toContainEqual(expect.objectContaining({
      billingPeriodKey: '2025-06',
      calculatedExpectedDate: '2025-01-16',
    }));
  });

  it('keeps NEXT adjustment lookaround safe across dense weekday holidays', () => {
    const denseHolidayCalendar: BusinessCalendarSnapshot = {
      ...calendar,
      holidays: consecutiveWeekdayHolidays('2025-02-03', 100),
    };
    const occurrences = evaluateBillingSchedule({
      config: {
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2025-01-01',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [{
          key: 'dense-next-adjustment',
          label: 'Dense next adjustment',
          expression: { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'CYCLE_END' }, offset: 1, unit: 'CALENDAR_DAY' },
          businessDayAdjustment: 'NEXT',
        }],
      },
      feeLine: { id: 'fee-dense-next-adjustment', amount: '10', currency: 'SGD' },
      calendar: denseHolidayCalendar,
      from: '2025-06-23',
      to: '2025-06-23',
      generationKey: 'rolling-v1',
    });

    expect(occurrences).toContainEqual(expect.objectContaining({
      billingPeriodKey: '2025-01',
      calculatedExpectedDate: '2025-02-01',
      operativeExpectedDate: '2025-06-23',
    }));
  });

  it('keeps PREVIOUS adjustment lookaround safe across dense weekday holidays', () => {
    const denseHolidayCalendar: BusinessCalendarSnapshot = {
      ...calendar,
      holidays: consecutiveWeekdayHolidays('2025-01-17', 100),
    };
    const occurrences = evaluateBillingSchedule({
      config: {
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2025-01-01',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [{
          key: 'dense-previous-adjustment',
          label: 'Dense previous adjustment',
          expression: { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'CYCLE_START' }, offset: -1, unit: 'CALENDAR_DAY' },
          businessDayAdjustment: 'PREVIOUS',
        }],
      },
      feeLine: { id: 'fee-dense-previous-adjustment', amount: '10', currency: 'SGD' },
      calendar: denseHolidayCalendar,
      from: '2025-01-16',
      to: '2025-01-16',
      generationKey: 'rolling-v1',
    });

    expect(occurrences).toContainEqual(expect.objectContaining({
      billingPeriodKey: '2025-06',
      calculatedExpectedDate: '2025-05-31',
      operativeExpectedDate: '2025-01-16',
    }));
  });

  it('looks past six configured weekend days without exceeding the bounded search', () => {
    const sixWeekendCalendar: BusinessCalendarSnapshot = {
      ...calendar,
      weekendDays: new Set([0, 1, 2, 3, 4, 5]),
      holidays: new Set(),
    };
    const occurrences = evaluateBillingSchedule({
      config: {
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2025-01-01',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [{
          key: 'six-weekend-days',
          label: 'Six weekend days',
          expression: { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'CYCLE_START' }, offset: 1, unit: 'BUSINESS_DAY' },
          businessDayAdjustment: 'NEXT',
        }],
      },
      feeLine: { id: 'fee-six-weekend-days', amount: '10', currency: 'SGD' },
      calendar: sixWeekendCalendar,
      from: '2025-01-04',
      to: '2025-01-04',
      generationKey: 'rolling-v1',
    });

    expect(occurrences).toContainEqual(expect.objectContaining({
      billingPeriodKey: '2025-01',
      calculatedExpectedDate: '2025-01-04',
      operativeExpectedDate: '2025-01-04',
    }));
  });

  it('preserves the shared deterministic cap for business-day movement', () => {
    expect(() => addBusinessDays('2025-01-01', MAX_SEARCH_DAYS + 1, calendar)).toThrow(/cannot exceed 100000 days/i);
  });

  it('keeps maximum-shape business-day evaluation within one calendar validation budget', () => {
    const holidays = new CountingHolidaySet(consecutiveWeekdayHolidays('2025-01-02', 500));

    expect(() => evaluateBillingSchedule({
      config: {
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2025-01-01',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [{
          key: 'maximum-shape',
          label: 'Maximum shape',
          expression: {
            kind: 'RELATIVE_TO_SOURCE',
            source: { kind: 'CYCLE_START' },
            offset: 1,
            unit: 'BUSINESS_DAY',
          },
          businessDayAdjustment: 'NONE',
        }],
      },
      feeLine: { id: 'fee-maximum-shape', amount: '10', currency: 'SGD' },
      calendar: {
        ...calendar,
        weekendDays: new Set([0, 1, 2, 3, 4, 5]),
        holidays,
      },
      from: '2025-01-01',
      to: '2025-01-01',
      generationKey: 'maximum-shape-v1',
    })).not.toThrow();

    expect(holidays.iterationCount).toBe(500);
  });

  it('clamps month dates and applies Singapore business-day adjustments at cadence boundaries', () => {
    const config: BillingScheduleConfigV1 = {
      schemaVersion: 1,
      cadence: 'MONTHLY',
      startDate: '2026-01-31',
      customInterval: { unit: 'MONTH', count: 1 },
      scheduleEntries: [entry('default', 31, 'NEXT')],
    };

    const occurrences = evaluateBillingSchedule({
      config,
      feeLine: { id: 'fee-1', amount: '125.00', currency: 'SGD' },
      calendar,
      from: '2026-01-01',
      to: '2026-03-31',
      generationKey: 'rolling-v1',
    });

    expect(occurrences.map(({ billingPeriodKey, scheduleEntryKey, calculatedExpectedDate, operativeExpectedDate }) => ({
      billingPeriodKey,
      scheduleEntryKey,
      calculatedExpectedDate,
      operativeExpectedDate,
    }))).toEqual([
      { billingPeriodKey: '2026-01', scheduleEntryKey: 'default', calculatedExpectedDate: '2026-01-31', operativeExpectedDate: '2026-02-02' },
      { billingPeriodKey: '2026-02', scheduleEntryKey: 'default', calculatedExpectedDate: '2026-02-28', operativeExpectedDate: '2026-03-02' },
      { billingPeriodKey: '2026-03', scheduleEntryKey: 'default', calculatedExpectedDate: '2026-03-31', operativeExpectedDate: '2026-03-31' },
    ]);
    expect(occurrences.every((occurrence) => occurrence.amount === '125.00' && occurrence.currency === 'SGD')).toBe(true);
  });

  it('looks one cadence period beyond the requested end for previous-adjusted dates', () => {
    const occurrences = evaluateBillingSchedule({
      config: {
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2026-07-01',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [entry('month-start', 1, 'PREVIOUS')],
      },
      feeLine: { id: 'fee-lookahead', amount: '10', currency: 'SGD' },
      calendar,
      from: '2026-07-01',
      to: '2026-07-31',
      generationKey: 'rolling-v1',
    });

    expect(occurrences).toContainEqual(expect.objectContaining({
      billingPeriodKey: '2026-08',
      calculatedExpectedDate: '2026-08-01',
      operativeExpectedDate: '2026-07-31',
    }));
  });

  it('uses structured custom month intervals and deterministic period keys', () => {
    const config: BillingScheduleConfigV1 = {
      schemaVersion: 1,
      cadence: 'CUSTOM',
      startDate: '2026-01-15',
      customInterval: { unit: 'MONTH', count: 2 },
      scheduleEntries: [entry('installment', 15)],
    };

    const occurrences = evaluateBillingSchedule({
      config,
      feeLine: { id: 'fee-2', amount: '50', currency: 'USD' },
      calendar,
      from: '2026-01-01',
      to: '2026-06-30',
      generationKey: 'reconciliation-v1',
    });

    expect(occurrences.map((occurrence) => [occurrence.billingPeriodKey, occurrence.calculatedExpectedDate])).toEqual([
      ['2026-01+2M', '2026-01-15'],
      ['2026-03+2M', '2026-03-15'],
      ['2026-05+2M', '2026-05-15'],
    ]);
  });

  it('returns every one-time occurrence only when its date is inside the requested range', () => {
    const config: BillingScheduleConfigV1 = {
      schemaVersion: 1,
      cadence: 'ONE_TIME',
      startDate: '2026-08-01',
      customInterval: null,
      scheduleEntries: [entry('z-balance', 15), entry('a-deposit', 1)],
    };

    const inRange = evaluateBillingSchedule({
      config,
      feeLine: { id: 'fee-3', amount: '75', currency: 'SGD' },
      calendar,
      from: '2026-08-01',
      to: '2026-08-31',
      generationKey: 'rolling-v1',
    });
    const outOfRange = evaluateBillingSchedule({
      config,
      feeLine: { id: 'fee-3', amount: '75', currency: 'SGD' },
      calendar,
      from: '2026-08-16',
      to: '2026-08-31',
      generationKey: 'rolling-v1',
    });

    expect(inRange).toHaveLength(2);
    expect(inRange.map((occurrence) => occurrence.scheduleEntryKey)).toEqual(['a-deposit', 'z-balance']);
    expect(inRange).toEqual(expect.arrayContaining([
      expect.objectContaining({
        billingPeriodKey: 'ONE_TIME:2026-08-01',
        scheduleEntryKey: 'a-deposit',
        calculatedExpectedDate: '2026-08-01',
      }),
      expect.objectContaining({
        billingPeriodKey: 'ONE_TIME:2026-08-01',
        scheduleEntryKey: 'z-balance',
        calculatedExpectedDate: '2026-08-15',
      }),
    ]));
    expect(outOfRange).toEqual([]);
  });

  it('materializes every stable one-time entry exactly once within the effective range', () => {
    const config: BillingScheduleConfigV1 = {
      schemaVersion: 1,
      cadence: 'ONE_TIME',
      startDate: '2026-08-01',
      customInterval: null,
      scheduleEntries: [entry('z-balance', 15), entry('a-deposit', 1)],
    };

    const occurrences = evaluateBillingSchedule({
      config,
      feeLine: { id: 'fee-one-time', amount: '75', currency: 'SGD' },
      calendar,
      from: '2026-08-01',
      to: '2026-08-31',
      generationKey: 'one-time-v1',
    });
    const repeated = evaluateBillingSchedule({
      config,
      feeLine: { id: 'fee-one-time', amount: '75', currency: 'SGD' },
      calendar,
      from: '2026-08-01',
      to: '2026-08-31',
      generationKey: 'one-time-v1',
    });

    expect(occurrences).toHaveLength(2);
    expect(occurrences.map((occurrence) => occurrence.scheduleEntryKey)).toEqual(['a-deposit', 'z-balance']);
    expect(new Set(occurrences.map((occurrence) => occurrence.scheduleEntryKey)).size).toBe(2);
    expect(occurrences.every((occurrence) => occurrence.billingPeriodKey === 'ONE_TIME:2026-08-01')).toBe(true);
    expect(repeated).toEqual(occurrences);
  });

  it('never emits a calculated date before the actual start date', () => {
    const occurrences = evaluateBillingSchedule({
      config: {
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2026-08-15',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [entry('too-early', 1), entry('at-start', 15)],
      },
      feeLine: { id: 'fee-start-date', amount: '15', currency: 'SGD' },
      calendar,
      from: '2026-08-01',
      to: '2026-08-31',
      generationKey: 'rolling-v1',
    });

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      scheduleEntryKey: 'at-start',
      calculatedExpectedDate: '2026-08-15',
      operativeExpectedDate: '2026-08-15',
    });
    expect(occurrences.every((occurrence) => occurrence.calculatedExpectedDate >= '2026-08-15')).toBe(true);
  });

  it('never emits an operative date before the actual start date', () => {
    const occurrences = evaluateBillingSchedule({
      config: {
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2026-08-01',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [entry('previous-start', 1, 'PREVIOUS')],
      },
      feeLine: { id: 'fee-operative-start', amount: '15', currency: 'SGD' },
      calendar,
      from: '2026-07-01',
      to: '2026-08-01',
      generationKey: 'rolling-v1',
    });

    expect(occurrences).toEqual([]);
  });

  it('sorts entries by stable key so reordering configuration does not change identities or values', () => {
    const base: BillingScheduleConfigV1 = {
      schemaVersion: 1,
      cadence: 'MONTHLY',
      startDate: '2026-08-01',
      customInterval: { unit: 'MONTH', count: 1 },
      scheduleEntries: [entry('second', 15), entry('first', 1)],
    };
    const evaluate = (config: BillingScheduleConfigV1) => evaluateBillingSchedule({
      config,
      feeLine: { id: 'fee-4', amount: '90.00', currency: 'SGD' },
      calendar,
      from: '2026-08-01',
      to: '2026-08-31',
      generationKey: 'rolling-v1',
    });

    expect(evaluate(base)).toEqual(evaluate({ ...base, scheduleEntries: [...base.scheduleEntries].reverse() }));
  });

  it('does not invent occurrences for an empty or missing-start schedule', () => {
    const base: BillingScheduleConfigV1 = {
      schemaVersion: 1,
      cadence: 'MONTHLY',
      startDate: null,
      customInterval: { unit: 'MONTH', count: 1 },
      scheduleEntries: [],
    };

    expect(evaluateBillingSchedule({
      config: base,
      feeLine: { id: 'fee-5', amount: '10', currency: 'SGD' },
      calendar: { ...calendar, id: '' },
      from: '2026-08-01',
      to: '2026-08-31',
      generationKey: 'rolling-v1',
    })).toEqual([]);
  });
});
