import { describe, expect, it } from 'vitest';
import { evaluateBizFileFullStateIndependentReview } from '../../full-state-review-contract';
import { calculateReviewerQuality, REVIEWER_QUALITY_THRESHOLDS } from '../../reviewer-evaluation';
import { HELD_OUT_REVIEWER_FIXTURES } from './held-out-reviewer-fixtures';

describe('P12 held-out reviewer evaluation', () => {
  it('meets the predeclared reviewer-quality thresholds', () => {
    const observations = HELD_OUT_REVIEWER_FIXTURES.map((fixture) => ({
      id: fixture.id,
      category: fixture.category,
      expectedDisposition: fixture.expectedDisposition,
      expectedAttribution: fixture.expectedAttribution,
      result: evaluateBizFileFullStateIndependentReview(fixture.input),
    }));
    const report = calculateReviewerQuality(observations, REVIEWER_QUALITY_THRESHOLDS);
    console.info(`P12_HELD_OUT_REVIEWER_REPORT=${JSON.stringify(report)}`);
    expect(report.accepted, JSON.stringify(report, null, 2)).toBe(true);
  });
});
