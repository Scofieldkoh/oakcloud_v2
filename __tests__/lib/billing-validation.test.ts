import { describe, expect, it } from 'vitest';

import { billingScheduleConfigSchema } from '@/lib/validations/billing';

const entry = (key: string, day: number) => ({
  key,
  label: key,
  expression: { kind: 'DAY_OF_MONTH' as const, day },
  businessDayAdjustment: 'NEXT' as const,
});

describe('billing schedule validation', () => {
  it('accepts multiple billing entries through the shared schedule schema', () => {
    const result = billingScheduleConfigSchema.parse({
      schemaVersion: 1,
      cadence: 'MONTHLY',
      startDate: '2026-08-01',
      customInterval: { unit: 'MONTH', count: 1 },
      scheduleEntries: [entry('deposit', 1), entry('balance', 15)],
    });

    expect(result.scheduleEntries).toHaveLength(2);
    expect(result.scheduleEntries[1]?.businessDayAdjustment).toBe('NEXT');
  });

  it('requires a structured custom interval', () => {
    expect(() => billingScheduleConfigSchema.parse({
      schemaVersion: 1,
      cadence: 'CUSTOM',
      startDate: '2026-08-01',
      customInterval: null,
      scheduleEntries: [],
    })).toThrow('customInterval');
  });

  it('uses the shared date-only and unique-entry constraints', () => {
    expect(() => billingScheduleConfigSchema.parse({
      schemaVersion: 1,
      cadence: 'MONTHLY',
      startDate: '2026-02-30',
      customInterval: null,
      scheduleEntries: [],
    })).toThrow('Gregorian');

    expect(() => billingScheduleConfigSchema.parse({
      schemaVersion: 1,
      cadence: 'MONTHLY',
      startDate: null,
      customInterval: null,
      scheduleEntries: [entry('same', 1), entry('same', 2)],
    })).toThrow('unique');
  });

  it('requires canonical intervals for fixed cadences and no interval for one-time schedules', () => {
    expect(() => billingScheduleConfigSchema.parse({
      schemaVersion: 1,
      cadence: 'MONTHLY',
      startDate: '2026-08-01',
      customInterval: { unit: 'MONTH', count: 12 },
      scheduleEntries: [],
    })).toThrow('MONTHLY');

    expect(() => billingScheduleConfigSchema.parse({
      schemaVersion: 1,
      cadence: 'QUARTERLY',
      startDate: '2026-08-01',
      customInterval: { unit: 'MONTH', count: 1 },
      scheduleEntries: [],
    })).toThrow('QUARTERLY');

    expect(() => billingScheduleConfigSchema.parse({
      schemaVersion: 1,
      cadence: 'ONE_TIME',
      startDate: '2026-08-01',
      customInterval: { unit: 'MONTH', count: 1 },
      scheduleEntries: [],
    })).toThrow('one-time');
  });

  it('rejects shared schedule sources and operands unavailable to billing evaluation', () => {
    const unsupportedEntries = [
      {
        key: 'company-date',
        label: 'Company date',
        expression: {
          kind: 'RELATIVE_TO_SOURCE' as const,
          source: { kind: 'COMPANY_FIELD' as const, field: 'incorporationDate' as const },
          offset: 1,
          unit: 'CALENDAR_DAY' as const,
        },
        businessDayAdjustment: 'NONE' as const,
      },
      {
        key: 'parameter-offset',
        label: 'Parameter offset',
        expression: {
          kind: 'RELATIVE_TO_SOURCE' as const,
          source: { kind: 'CYCLE_START' as const },
          offset: { kind: 'INTEGER_PARAMETER' as const, key: 'daysAfterStart' },
          unit: 'CALENDAR_DAY' as const,
        },
        businessDayAdjustment: 'NONE' as const,
      },
      {
        key: 'milestone-date',
        label: 'Milestone date',
        expression: {
          kind: 'RELATIVE_TO_SOURCE' as const,
          source: { kind: 'MILESTONE' as const, key: 'filing-date' },
          offset: 1,
          unit: 'BUSINESS_DAY' as const,
        },
        businessDayAdjustment: 'NONE' as const,
      },
      {
        key: 'schedule-entry-date',
        label: 'Schedule entry date',
        expression: {
          kind: 'RELATIVE_TO_SOURCE' as const,
          source: { kind: 'SCHEDULE_ENTRY' as const, key: 'deposit' },
          offset: 1,
          unit: 'CALENDAR_DAY' as const,
        },
        businessDayAdjustment: 'NONE' as const,
      },
    ];

    for (const scheduleEntry of unsupportedEntries) {
      expect(() => billingScheduleConfigSchema.parse({
        schemaVersion: 1,
        cadence: 'MONTHLY',
        startDate: '2026-08-01',
        customInterval: { unit: 'MONTH', count: 1 },
        scheduleEntries: [scheduleEntry],
      })).toThrow();
    }
  });
});
