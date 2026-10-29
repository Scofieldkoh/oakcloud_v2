import { describe, expect, it } from 'vitest';
import { getCopyableText } from '@/lib/clipboard';

describe('getCopyableText', () => {
  it('returns trimmed text for copyable values', () => {
    expect(getCopyableText(' INV-725785 ')).toBe('INV-725785');
  });

  it('returns null for blank and placeholder values', () => {
    expect(getCopyableText('')).toBeNull();
    expect(getCopyableText('   ')).toBeNull();
    expect(getCopyableText('-')).toBeNull();
    expect(getCopyableText(null)).toBeNull();
    expect(getCopyableText(undefined)).toBeNull();
  });
});
