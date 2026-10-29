import { describe, expect, it } from 'vitest';
import { calculateReviewerQuality, REVIEWER_QUALITY_THRESHOLDS } from '../reviewer-evaluation';
import type { FullStateIndependentReviewResult } from '../full-state-independent-review';

function result(disposition: 'PASS' | 'FAIL' | 'ABSTAIN', reviewed = 10, required = 10): FullStateIndependentReviewResult {
  return {
    disposition,
    factualPass: disposition === 'PASS',
    fullStateEstablished: disposition === 'PASS',
    sourceBindingValid: true,
    beforeDigestValid: true,
    afterDigestValid: true,
    findings: [{ path: 'entity', disposition, attribution: disposition === 'FAIL' ? 'UNAUTHORIZED_UNSELECTED_WRITE' : disposition === 'ABSTAIN' ? 'INSUFFICIENT_EVIDENCE' : 'CONFIRMED_SOURCE_MATCH', selected: false, reason: 'synthetic metric test' }],
    failureCodes: [],
    evidenceCoverage: { required, reviewed, absent: 0, unreadable: required - reviewed, unsupported: 0, ratio: required === 0 ? 0 : reviewed / required },
  };
}

describe('reviewer quality metrics', () => {
  it('reports explicit denominators and accepts a perfect synthetic evaluation', () => {
    const report = calculateReviewerQuality([
      { id: 'p', category: 'pass', expectedDisposition: 'PASS', expectedAttribution: 'CONFIRMED_SOURCE_MATCH', result: result('PASS') },
      { id: 'f', category: 'fail', expectedDisposition: 'FAIL', expectedAttribution: 'UNAUTHORIZED_UNSELECTED_WRITE', result: result('FAIL') },
      { id: 'a', category: 'abstain', expectedDisposition: 'ABSTAIN', expectedAttribution: 'INSUFFICIENT_EVIDENCE', result: result('ABSTAIN', 9) },
    ]);
    expect(report.accepted).toBe(true);
    expect(report.factualPassPrecision).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(report.defectRecall.denominator).toBe(1);
    expect(report.abstentionRecall.denominator).toBe(1);
    expect(report.passEvidenceCoverage.value).toBe(1);
  });

  it('fails quality even when aggregate accuracy looks high if there is one dangerous false PASS', () => {
    const observations = Array.from({ length: 20 }, (_, index) => ({
      id: `safe-${index}`,
      category: 'safe',
      expectedDisposition: 'PASS' as const,
      result: result('PASS'),
    }));
    observations.push({ id: 'dangerous', category: 'defect', expectedDisposition: 'FAIL' as 'PASS', result: result('PASS') });
    const report = calculateReviewerQuality(observations.map((observation) => ({
      ...observation,
      expectedDisposition: observation.id === 'dangerous' ? 'FAIL' as const : 'PASS' as const,
    })));
    expect(report.accepted).toBe(false);
    expect(report.falsePassRate.numerator).toBe(1);
    expect(report.failedThresholds).toContain('factualPassPrecision');
    expect(report.failedThresholds).toContain('defectRecall');
    expect(REVIEWER_QUALITY_THRESHOLDS.maxFalsePassRate).toBe(0);
  });
});
