import { describe, expect, it } from 'vitest';
import { parseDeadlineSearchParams } from '@/lib/validations/deadline';

describe('deadline transport validation', () => {
  it('rejects impossible date-only values', () => {
    expect(() => parseDeadlineSearchParams(new URLSearchParams({ from: '2026-02-30', to: '2026-03-01' }))).toThrow();
  });

  it('accepts a range of exactly 366 elapsed days and rejects 367', () => {
    expect(() => parseDeadlineSearchParams(new URLSearchParams({ from: '2026-01-01', to: '2027-01-02' }))).not.toThrow();
    expect(() => parseDeadlineSearchParams(new URLSearchParams({ from: '2026-01-01', to: '2027-01-03' }))).toThrow();
  });

  it('accepts a table request without a date range', () => {
    const parsed = parseDeadlineSearchParams(new URLSearchParams({ mode: 'TABLE' }));
    expect(parsed.mode).toBe('TABLE');
    expect(parsed).not.toHaveProperty('from');
    expect(parsed).not.toHaveProperty('to');
  });

  it('requires a date range for calendar requests', () => {
    expect(() => parseDeadlineSearchParams(new URLSearchParams({ mode: 'CALENDAR' }))).toThrow();
  });

});
