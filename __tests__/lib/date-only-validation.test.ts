import { describe, expect, it } from 'vitest';
import { createCompanySchema, updateCompanySchema } from '@/lib/validations/company';
import { complianceSectionSchema } from '@/lib/validations/company-profile';

const companyBase = { uen: '202400001A', name: 'Example Pte Ltd' };
const updateBase = { id: '00000000-0000-0000-0000-000000000001' };

describe('authoritative company DateOnly validation', () => {
  it.each([
    '2026-08-18T12:34:00Z',
    'August 18, 2026',
    '2026-02-31',
    '2026-13-01',
  ])('rejects invalid date-only value %s in create, update, and Compliance schemas', (value) => {
    expect(createCompanySchema.safeParse({ ...companyBase, accountsDueDate: value }).success).toBe(false);
    expect(updateCompanySchema.safeParse({ ...updateBase, accountsDueDate: value }).success).toBe(false);
    expect(complianceSectionSchema.safeParse({
      financialYearEndDay: null,
      financialYearEndMonth: null,
      fyeAsAtLastAr: null,
      homeCurrency: 'SGD',
      lastAgmDate: null,
      lastArFiledDate: null,
      accountsDueDate: value,
    }).success).toBe(false);
  });

  it('preserves nullable and optional DateOnly values without timestamp coercion', () => {
    const created = createCompanySchema.parse({ ...companyBase, accountsDueDate: '2026-08-18' });
    const updated = updateCompanySchema.parse({ ...updateBase, accountsDueDate: '2026-08-18' });
    const compliance = complianceSectionSchema.parse({
      financialYearEndDay: null,
      financialYearEndMonth: null,
      fyeAsAtLastAr: null,
      homeCurrency: 'SGD',
      lastAgmDate: null,
      lastArFiledDate: null,
      accountsDueDate: '2026-08-18',
    });

    expect(created.accountsDueDate).toBe('2026-08-18');
    expect(updated.accountsDueDate).toBe('2026-08-18');
    expect(compliance.accountsDueDate).toBe('2026-08-18');
  });
});
