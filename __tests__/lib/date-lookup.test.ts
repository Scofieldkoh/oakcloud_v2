import { describe, expect, it } from 'vitest';
import { resolveLookupDate } from '@/lib/date-lookup';

describe('resolveLookupDate', () => {
  it('keeps valid lookup dates intact', () => {
    const result = resolveLookupDate('2025-06-30');

    expect(result.isoDate).toBe('2025-06-30');
    expect(result.usedFallback).toBe(false);
  });

  it('falls back instead of throwing on invalid dates', () => {
    const result = resolveLookupDate('not-a-date');

    expect(result.usedFallback).toBe(true);
    expect(result.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(result.date.getTime())).toBe(false);
  });
});
