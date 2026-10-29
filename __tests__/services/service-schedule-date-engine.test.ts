import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/lib/errors';
import {
  addBusinessDays,
  addCalendarDays,
  addMonthsClamped,
  adjustBusinessDay,
  alignAnnualLandmarkToPeriod,
  businessDayFromEnd,
  businessDayFromStart,
  compareDateOnly,
  currentDateInSingapore,
  dayOfMonth,
  fixedDateFromSourceYear,
  formatDateOnly,
  isBusinessDay,
  parseDateOnly,
  type BusinessCalendarSnapshot,
  type DateOnly,
} from '@/services/service-schedule';
import { hashConfiguration } from '@/services/service-schedule/hash';

const calendar: BusinessCalendarSnapshot = {
  id: 'sg-calendar',
  timeZone: 'Asia/Singapore',
  revision: 1,
  holidays: new Set<DateOnly>(['2026-08-10', '2026-08-31']),
  weekendDays: new Set([0, 6]),
};

describe('date-only engine', () => {
  it('accepts only real Gregorian dates and formats through UTC getters', () => {
    expect(formatDateOnly(parseDateOnly('2028-02-29'))).toBe('2028-02-29');
    expect(() => parseDateOnly('2027-02-29')).toThrow();
    expect(() => parseDateOnly('2028-04-31')).toThrow();
    expect(() => parseDateOnly('2028-00-01')).toThrow();
    expect(() => parseDateOnly('2028-13-01')).toThrow();
    expect(() => parseDateOnly('2028-2-01')).toThrow();
    expect(() => parseDateOnly('2028-02-01T00:00:00.000Z' as DateOnly)).toThrow();
    expect(() => formatDateOnly(new Date('not-a-date'))).toThrow();
  });

  it('uses Singapore date parts rather than the host timezone', () => {
    expect(currentDateInSingapore(new Date('2026-08-17T16:00:00.000Z'))).toBe('2026-08-18');
    expect(currentDateInSingapore(new Date('2026-08-18T15:59:59.999Z'))).toBe('2026-08-18');
    expect(currentDateInSingapore(new Date('2026-08-18T16:00:00.000Z'))).toBe('2026-08-19');
  });

  it('supports zero and negative calendar offsets without locale parsing', () => {
    expect(addCalendarDays('2028-02-29', 0)).toBe('2028-02-29');
    expect(addCalendarDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addCalendarDays('2028-02-28', 2)).toBe('2028-03-01');
  });

  it('clamps month arithmetic in both directions and across leap years', () => {
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonthsClamped('2028-03-31', -1)).toBe('2028-02-29');
    expect(addMonthsClamped('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonthsClamped('2028-02-29', -12)).toBe('2027-02-28');
    expect(dayOfMonth('2028-02-01', 31)).toBe('2028-02-29');
    expect(dayOfMonth('2027-02-01', 31)).toBe('2027-02-28');
  });

  it('compares date-only values stably', () => {
    expect(compareDateOnly('2026-01-01', '2026-01-01')).toBe(0);
    expect(compareDateOnly('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDateOnly('2026-01-02', '2026-01-01')).toBe(1);
  });


  it('builds exact fixed dates from a source year without preserving source month or day', () => {
    expect(fixedDateFromSourceYear('2026-12-31', 1, 11, 30)).toBe('2027-11-30');
    expect(fixedDateFromSourceYear('2027-01-31', 1, 11, 30)).toBe('2028-11-30');
    expect(fixedDateFromSourceYear('2027-06-30', 1, 11, 30)).toBe('2028-11-30');
  });

  it('rejects impossible fixed calendar dates rather than silently clamping them', () => {
    expect(() => fixedDateFromSourceYear('2027-01-31', 0, 2, 29)).toThrow(ValidationError);
    expect(() => fixedDateFromSourceYear('2027-01-31', 0, 4, 31)).toThrow(ValidationError);
  });
});

describe('alignAnnualLandmarkToPeriod', () => {
  it.each([
    ['2027-07-31', '2026-08-01', '2027-07-31'],
    ['2024-07-31', '2026-08-01', '2027-07-31'],
    ['2024-12-31', '2026-08-01', '2026-12-31'],
    ['2024-02-29', '2025-03-01', '2026-02-28'],
  ] as const)('%s from %s becomes %s', (source, periodStart, expected) => {
    expect(alignAnnualLandmarkToPeriod(source, periodStart)).toBe(expected);
  });

  it('keeps a landmark already inside the period year unchanged', () => {
    expect(alignAnnualLandmarkToPeriod('2024-07-31', '2024-01-01')).toBe('2024-07-31');
  });
});

describe('business-day engine', () => {
  it('handles weekends and configured holidays', () => {
    expect(isBusinessDay('2026-08-07', calendar)).toBe(true);
    expect(isBusinessDay('2026-08-08', calendar)).toBe(false);
    expect(isBusinessDay('2026-08-10', calendar)).toBe(false);
    expect(isBusinessDay('2026-08-11', calendar)).toBe(true);
  });

  it('moves positively, negatively, and by zero business days', () => {
    expect(addBusinessDays('2026-08-07', 0, calendar)).toBe('2026-08-07');
    expect(addBusinessDays('2026-08-07', 1, calendar)).toBe('2026-08-11');
    expect(addBusinessDays('2026-08-11', -1, calendar)).toBe('2026-08-07');
    expect(addBusinessDays('2026-08-14', 2, calendar)).toBe('2026-08-18');
  });

  it('resolves ordinals within bounded periods from either end', () => {
    expect(businessDayFromStart('2026-08-01', '2026-08-31', 1, calendar)).toBe('2026-08-03');
    expect(businessDayFromStart('2026-08-01', '2026-08-31', 2, calendar)).toBe('2026-08-04');
    expect(businessDayFromEnd('2026-08-01', '2026-08-31', 1, calendar)).toBe('2026-08-28');
    expect(businessDayFromEnd('2026-08-01', '2026-08-31', 2, calendar)).toBe('2026-08-27');
  });

  it('supports previous, next, and none adjustments', () => {
    expect(adjustBusinessDay('2026-08-08', 'PREVIOUS', calendar)).toBe('2026-08-07');
    expect(adjustBusinessDay('2026-08-08', 'NEXT', calendar)).toBe('2026-08-11');
    expect(adjustBusinessDay('2026-08-10', 'PREVIOUS', calendar)).toBe('2026-08-07');
    expect(adjustBusinessDay('2026-08-11', 'NONE', calendar)).toBe('2026-08-11');
  });

  it('throws the repository typed validation error for impossible ordinals and bounds', () => {
    expect(() => businessDayFromStart('2026-08-01', '2026-08-02', 1, calendar)).toThrow(ValidationError);
    expect(() => businessDayFromEnd('2026-08-01', '2026-08-02', 1, calendar)).toThrow(ValidationError);
    expect(() => businessDayFromStart('2026-08-31', '2026-08-01', 1, calendar)).toThrow(ValidationError);
    expect(() => businessDayFromStart('2026-08-01', '2026-08-31', 0, calendar)).toThrow(ValidationError);
    expect(() => businessDayFromStart('2026-01-01', '2040-01-01', 1, calendar)).toThrow(ValidationError);
  });

  it('rejects invalid weekend definitions instead of allowing unbounded searches', () => {
    expect(() => isBusinessDay('2026-08-11', { ...calendar, weekendDays: new Set([7]) })).toThrow(ValidationError);
    expect(() => isBusinessDay('2026-08-11', { ...calendar, weekendDays: new Set([0, 1, 2, 3, 4, 5, 6]) })).toThrow(ValidationError);
  });
});

describe('canonical configuration hashing', () => {
  it('hashes equal objects identically regardless of object key order', () => {
    expect(hashConfiguration({ b: 2, a: { d: 4, c: 3 } })).toBe(
      hashConfiguration({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it('preserves array order so reordered schedule entries hash differently', () => {
    const first = { scheduleEntries: [
      { key: 'first', expression: { kind: 'DAY_OF_MONTH', day: 1 } },
      { key: 'second', expression: { kind: 'DAY_OF_MONTH', day: 2 } },
    ] };
    const reordered = { scheduleEntries: [...first.scheduleEntries].reverse() };
    expect(hashConfiguration(first)).not.toBe(hashConfiguration(reordered));
  });

  it('returns a lowercase SHA-256 digest', () => {
    expect(hashConfiguration({ scheduleEntries: [] })).toMatch(/^[a-f0-9]{64}$/);
    expect(hashConfiguration({ a: 1, b: 2 })).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
  });
});
