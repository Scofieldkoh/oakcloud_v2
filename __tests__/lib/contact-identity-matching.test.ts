import { describe, expect, it } from 'vitest';
import { rankContactMaster, scoreContactIdentityMatch } from '@/lib/contact-identity-matching';
import type { ContactIdentityCandidate, ContactIdentityRecord } from '@/types/contact-identity';

function candidate(
  name: string,
  identificationNumber?: string,
  overrides: Partial<ContactIdentityCandidate> = {},
): ContactIdentityCandidate {
  return {
    source: 'MANUAL',
    contactType: 'INDIVIDUAL',
    firstName: name,
    identificationType: identificationNumber ? 'NRIC' : null,
    identificationNumber,
    ...overrides,
  };
}

function record(
  name: string,
  identificationNumber?: string,
  overrides: Partial<ContactIdentityRecord> = {},
): ContactIdentityRecord {
  return {
    ...candidate(name, identificationNumber),
    id: 'contact-1',
    tenantId: 'tenant-1',
    canonicalName: name,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    relationshipCount: 0,
    populatedFieldCount: 1,
    ...overrides,
  };
}

describe('contact identity matching', () => {
  it('auto-reuses exact Chinese names but only recommends near Chinese names', () => {
    expect(scoreContactIdentityMatch(candidate('王小明'), record('王小明')).automatic).toBe(true);
    const near = scoreContactIdentityMatch(candidate('王小明'), record('王小敏'));
    expect(near.automatic).toBe(false);
  });

  it('lets identifier conflicts override exact names', () => {
    const result = scoreContactIdentityMatch(
      candidate('王小明', 'S1234567A'),
      record('王小明', 'S7654321B'),
    );
    expect(result.score).toBe(0);
    expect(result.blockedByIdentifierConflict).toBe(true);
    expect(result.automatic).toBe(false);
  });

  it('blocks different deterministic identifiers even when their types differ', () => {
    const result = scoreContactIdentityMatch(
      candidate('王小明', 'S1234567A'),
      record('王小明', 'K1234567', { identificationType: 'PASSPORT' }),
    );
    expect(result.score).toBe(0);
    expect(result.blockedByIdentifierConflict).toBe(true);
  });

  it('does not use low-confidence extracted identifiers as deterministic keys', () => {
    const incoming = candidate('Different Person', 'S1234567A', {
      source: 'DOCUMENT_VAULT',
      confidence: { identificationNumber: 0.89 },
    });
    const result = scoreContactIdentityMatch(incoming, record('Existing Person', 'S1234567A'));
    expect(result.score).toBe(0);
    expect(result.automatic).toBe(false);
  });

  it('scores deterministic identifiers, approved aliases, and corporate suffix variants', () => {
    expect(
      scoreContactIdentityMatch(candidate('Different', 'S1234567A'), record('Name', 'S 123-4567 A')),
    ).toMatchObject({ score: 1, automatic: true, reasons: ['IDENTIFIER'] });
    expect(
      scoreContactIdentityMatch(candidate('International Business Machines'), record('IBM', undefined, { alias: 'International Business Machines' })),
    ).toMatchObject({ score: 1, automatic: true, reasons: ['APPROVED_ALIAS'] });

    const corporateCandidate = candidate('ignored', undefined, {
      contactType: 'CORPORATE',
      firstName: null,
      corporateName: 'Acme Pte Ltd',
    });
    const corporateRecord = record('ignored', undefined, {
      contactType: 'CORPORATE',
      firstName: null,
      corporateName: 'Acme',
      canonicalName: 'acme',
    });
    expect(scoreContactIdentityMatch(corporateCandidate, corporateRecord)).toMatchObject({
      score: 0.99,
      automatic: true,
      reasons: ['CORPORATE_SUFFIX_VARIANT'],
    });
  });

  it('recommends eligible same-script fuzzy names but does not auto-accept them', () => {
    const result = scoreContactIdentityMatch(
      candidate('alexanderthegreat'),
      record('alexanderthegrebt'),
    );
    expect(result.score).toBeGreaterThanOrEqual(0.93);
    expect(result.automatic).toBe(false);
    expect(result.reasons).toEqual(['FUZZY_NAME']);
  });

  it('rejects mixed-script fuzzy confusables', () => {
    const result = scoreContactIdentityMatch(candidate('paypalservice'), record('pаypalservice'));
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  it('ranks masters by strong ID, populated fields, relationships, age, then ID', () => {
    const records = [
      record('Same', undefined, { id: 'no-id', populatedFieldCount: 10, relationshipCount: 10 }),
      record('Same', 'S1234567A', { id: 'newer', createdAt: new Date('2025-01-01'), populatedFieldCount: 1 }),
      record('Same', 'S1234567A', { id: 'fewer-fields', populatedFieldCount: 2, relationshipCount: 9 }),
      record('Same', 'S1234567A', { id: 'fewer-links', populatedFieldCount: 3, relationshipCount: 1 }),
      record('Same', 'S1234567A', { id: 'b', populatedFieldCount: 3, relationshipCount: 2 }),
      record('Same', 'S1234567A', { id: 'a', populatedFieldCount: 3, relationshipCount: 2 }),
    ];

    expect(rankContactMaster(records).map(({ id }) => id)).toEqual([
      'a',
      'b',
      'fewer-links',
      'fewer-fields',
      'newer',
      'no-id',
    ]);
  });
});
