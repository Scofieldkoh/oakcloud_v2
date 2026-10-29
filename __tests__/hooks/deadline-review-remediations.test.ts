import { describe, expect, it } from 'vitest';
import { deadlineSearchParams } from '@/hooks/use-deadlines';

describe('deadline hook review remediations', () => {
  it('serializes inline text filters and the supported page size', () => {
    const params = deadlineSearchParams({
      from: '2026-08-01',
      to: '2026-08-31',
      companyQuery: ' Oaktree ',
      serviceQuery: 'Annual Return',
      milestoneQuery: 'annual-return',
      limit: 100,
    });
    expect(params).toContain('companyQuery=Oaktree');
    expect(params).toContain('serviceQuery=Annual+Return');
    expect(params).toContain('milestoneQuery=annual-return');
    expect(params).toContain('limit=100');
  });
});
