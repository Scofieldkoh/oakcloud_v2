import { describe, expect, it } from 'vitest';
import {
  buildDuplicateEnvelopeTitle,
  getDuplicateEnvelopeExpiry,
} from '@/services/esigning-envelope/shared';

describe('e-signing envelope duplication helpers', () => {
  const now = new Date('2026-10-06T08:00:00.000Z');

  it('keeps an expiry that is still in the future', () => {
    const expiresAt = new Date('2026-11-01T00:00:00.000Z');
    expect(getDuplicateEnvelopeExpiry(expiresAt, now)).toBe(expiresAt);
  });

  it('drops an expiry that has already passed so the copy does not expire on send', () => {
    expect(getDuplicateEnvelopeExpiry(new Date('2026-09-01T00:00:00.000Z'), now)).toBeNull();
    expect(getDuplicateEnvelopeExpiry(now, now)).toBeNull();
    expect(getDuplicateEnvelopeExpiry(null, now)).toBeNull();
  });

  it('marks the copy title', () => {
    expect(buildDuplicateEnvelopeTitle('Board resolution')).toBe('Board resolution (Copy)');
    expect(buildDuplicateEnvelopeTitle('x'.repeat(160))).toHaveLength(160);
  });
});
