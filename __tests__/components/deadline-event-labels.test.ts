import { describe, expect, it } from 'vitest';
import { deadlineTimingLabel, milestoneLabel } from '@/components/services/deadlines/deadline-event';

describe('deadline labels', () => {
  it('prints acronyms in milestone keys in capitals', () => {
    expect(milestoneLabel({ milestoneKey: 'eci-due' })).toBe('ECI Due');
    expect(milestoneLabel({ milestoneKey: 'agm_due' })).toBe('AGM Due');
    expect(milestoneLabel({ milestoneKey: 'form-c-due' })).toBe('Form C Due');
    expect(milestoneLabel({ milestoneKey: 'annual-return-due' })).toBe('Annual Return Due');
  });

  it('describes how far away an open deadline is, else its status', () => {
    expect(deadlineTimingLabel({ status: 'OPEN', timingBucket: 'WITHIN_3_MONTHS' })).toBe('Within 3 months');
    expect(deadlineTimingLabel({ status: 'OPEN', timingBucket: 'OVER_12_MONTHS' })).toBe('Over 12 months');
    expect(deadlineTimingLabel({ status: 'COMPLETED', timingBucket: null })).toBe('Completed');
  });
});
