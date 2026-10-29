import { describe, expect, it } from 'vitest';
import {
  deriveCompanyInitials,
  getCompanyDisplayLabel,
  normalizeCompanyAlias,
} from '@/lib/company-display-label';
import { createCompanySchema, updateCompanySchema } from '@/lib/validations/company';
import { identitySectionSchema } from '@/lib/validations/company-profile';

describe('company display labels', () => {
  it.each([
    ['removes punctuation and a legal suffix chain', 'Oaktree Accounting & Corporate Solution Pte. Ltd.', 'OACS'],
    ['keeps Unicode letters and numbers', 'Élan 東京 Pte Ltd', 'É東'],
    ['removes multiple legal suffix words', 'Acme Private Limited', 'A'],
    ['falls back to the first character for legal-suffix-only names', 'Pte. Ltd.', 'P'],
    ['falls back to a question mark for blank names', '', '?'],
    ['falls back to the first character for punctuation-only names', '… —', '…'],
  ])('%s', (_description, legalName, expected) => {
    expect(deriveCompanyInitials(legalName)).toBe(expected);
  });

  it.each([
    [{ name: 'Long Legal Name Pte Ltd', displayAlias: ' LLN ' }, 'LLN'],
    [{ name: 'Long Legal Name Pte Ltd', displayAlias: null }, 'LLN'],
    [{ name: 'Long Legal Name Pte Ltd' }, 'LLN'],
  ])('uses an alias only when it is meaningful: %o', (company, expected) => {
    expect(getCompanyDisplayLabel(company)).toBe(expected);
  });

  it('normalizes blank aliases to null', () => {
    expect(normalizeCompanyAlias('   ')).toBeNull();
  });

  it.each([
    ['create', createCompanySchema, { uen: '202400001A', name: 'Example Pte Ltd' }],
    ['update', updateCompanySchema, { id: '00000000-0000-0000-0000-000000000001' }],
    ['identity', identitySectionSchema, {
      uen: '202400001A',
      name: 'Example Pte Ltd',
      entityType: 'PRIVATE_LIMITED',
      status: 'LIVE',
      statusDate: null,
      incorporationDate: null,
    }],
  ])('accepts omitted, null, and ten-character aliases in %s schema', (_name, schema, base) => {
    expect(schema.parse(base)).not.toHaveProperty('displayAlias');
    expect(schema.parse({ ...base, displayAlias: null }).displayAlias).toBeNull();
    expect(schema.parse({ ...base, displayAlias: 'X'.repeat(10) }).displayAlias).toHaveLength(10);
  });

  it.each([
    ['create', createCompanySchema, { uen: '202400001A', name: 'Example Pte Ltd' }],
    ['update', updateCompanySchema, { id: '00000000-0000-0000-0000-000000000001' }],
    ['identity', identitySectionSchema, {
      uen: '202400001A',
      name: 'Example Pte Ltd',
      entityType: 'PRIVATE_LIMITED',
      status: 'LIVE',
      statusDate: null,
      incorporationDate: null,
    }],
  ])('rejects an eleven-character alias in the %s schema', (_name, schema, base) => {
    expect(() => schema.parse({ ...base, displayAlias: 'X'.repeat(11) })).toThrow();
  });

  it('truncates legacy or extracted aliases to ten characters for display', () => {
    expect(normalizeCompanyAlias('ABCDEFGHIJK')).toBe('ABCDEFGHIJ');
  });
});
