import { describe, expect, it } from 'vitest';
import {
  calculateAttributedCapital,
  computeSectionVersion,
} from '@/lib/company-profile-sections';

describe('company profile section helpers', () => {
  it('attributes capital using the shareholder proportion of its share class', () => {
    expect(calculateAttributedCapital({
      currency: 'SGD',
      shareholderShares: '60000',
      classShares: '100000',
      classValue: '100000',
    })).toEqual({ currency: 'SGD', amount: '60000.00' });
  });

  it('does not invent attributed capital when the class denominator is zero', () => {
    expect(calculateAttributedCapital({
      currency: 'SGD',
      shareholderShares: '60000',
      classShares: '0',
      classValue: '100000',
    })).toBeNull();
  });

  it('produces deterministic section versions independent of object key order', () => {
    const first = computeSectionVersion({ b: 2, a: { y: 4, x: 3 } });
    const reordered = computeSectionVersion({ a: { x: 3, y: 4 }, b: 2 });

    expect(first).toBe(reordered);
    expect(computeSectionVersion({ a: { x: 3, y: 5 }, b: 2 })).not.toBe(first);
  });
});
