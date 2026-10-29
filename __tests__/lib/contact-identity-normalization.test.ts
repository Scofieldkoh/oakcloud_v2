import { describe, expect, it } from 'vitest';
import {
  buildContactIdentityFingerprint,
  canonicalizeContactAlias,
  canonicalizeContactName,
  canonicalizeCorporateComparisonName,
  isDeterministicIdentifier,
  normalizeContactDetailValue,
  normalizeContactIdentifier,
} from '@/lib/contact-identity-normalization';
import type { ContactIdentityCandidate } from '@/types/contact-identity';

describe('contact identity normalization', () => {
  it('preserves and normalizes Chinese names', () => {
    expect(canonicalizeContactName(' 王\u3000小明 ')).toBe('王小明');
    expect(canonicalizeContactName('ＷＡＮＧ 王')).toBe('wang王');
  });

  it('uses Unicode default case folding', () => {
    expect(canonicalizeContactName('Straße')).toBe('strasse');
  });

  it('distinguishes an absent alias from a present alias that canonicalizes empty', () => {
    expect(canonicalizeContactAlias(null)).toBeNull();
    expect(canonicalizeContactAlias(' . ')).toBe('');
  });

  it('removes only terminal corporate suffixes from comparison form', () => {
    expect(canonicalizeCorporateComparisonName('Acme Pte. Ltd.')).toBe('acme');
    expect(canonicalizeCorporateComparisonName('有限公司')).toBe('有限公司');
  });

  it('normalizes strong identifiers by type and rejects masks', () => {
    expect(normalizeContactIdentifier('S 123-4567 A', 'NRIC')).toBe('S1234567A');
    expect(normalizeContactIdentifier('ab-12 34', 'PASSPORT')).toBe('AB-12 34');
    expect(isDeterministicIdentifier('S****567A', 'NRIC')).toBe(false);
    expect(isDeterministicIdentifier('unknown', 'PASSPORT')).toBe(false);
  });

  it('normalizes email and phone detail values without losing international prefixes', () => {
    expect(normalizeContactDetailValue('EMAIL', ' User@Example.COM ')).toBe('user@example.com');
    expect(normalizeContactDetailValue('PHONE', ' +65 (9123) 4567 ')).toBe('+6591234567');
    expect(normalizeContactDetailValue('WEBSITE', ' 例え.テスト ')).toBe('例え.テスト');
  });

  it('builds stable fingerprints from normalized identity data and sorted details', () => {
    const base: ContactIdentityCandidate = {
      source: 'MANUAL',
      contactType: 'INDIVIDUAL',
      firstName: ' Straße ',
      identificationType: 'PASSPORT',
      identificationNumber: ' ab-12 34 ',
      contactDetails: [
        { detailType: 'PHONE', value: '+65 9123 4567' },
        { detailType: 'EMAIL', value: 'USER@example.com' },
      ],
    };
    const reordered: ContactIdentityCandidate = {
      ...base,
      firstName: 'STRASSE',
      identificationNumber: 'AB-12 34',
      contactDetails: [...(base.contactDetails ?? [])].reverse(),
    };

    expect(buildContactIdentityFingerprint(base)).toMatch(/^[a-f0-9]{64}$/);
    expect(buildContactIdentityFingerprint(reordered)).toBe(buildContactIdentityFingerprint(base));
    expect(buildContactIdentityFingerprint({ ...base, dateOfBirth: '1990-01-01' })).not.toBe(
      buildContactIdentityFingerprint(base),
    );
  });
});
