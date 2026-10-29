import { describe, expect, it } from 'vitest';
import { normalizeCompanyRuleSource } from '@/services/service-schedule';

describe('shared company rule source normalization', () => {
  it('materializes stored FYE month/day in the supplied Singapore date year', () => {
    expect(normalizeCompanyRuleSource({ financialYearEndDay: 31, financialYearEndMonth: 12 }, '2026-08-18'))
      .toMatchObject({ financialYearEnd: '2026-12-31' });
  });

  it('keeps invalid stored FYE input absent', () => {
    expect(normalizeCompanyRuleSource({ financialYearEndDay: 31, financialYearEndMonth: 2 }, '2026-08-18'))
      .not.toHaveProperty('financialYearEnd');
  });
});
