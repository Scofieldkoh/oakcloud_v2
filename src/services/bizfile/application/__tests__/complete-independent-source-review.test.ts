import { describe, expect, it } from 'vitest';
import { completeBizFileIndependentReview, type SelectedChangeIndependentReviewSummary } from '../complete-independent-source-review';
import { computeFullStateDigest, type FullStateFieldEvidence } from '../full-state-independent-review';
import { BIZFILE_FULL_STATE_REVIEW_CONTRACT } from '../full-state-review-contract';

const source = {
  sourceType: 'BIZFILE_PDF', sourceIdentity: 'integration-doc', sourceReference: 'retained://integration-doc',
  sha256: '3'.repeat(64), sourceRevision: 'rev-1',
};

function fullState(missing?: string) {
  const fields: FullStateFieldEvidence[] = BIZFILE_FULL_STATE_REVIEW_CONTRACT.canonicalPaths
    .filter((path) => path !== missing)
    .map((path) => ({
      path, selected: false, beforeValue: path, afterValue: path, sourceValue: path, coverageStatus: 'REVIEWED' as const,
      binding: { evidenceIds: [`ev-${path}`], section: path, pages: [1] },
    }));
  return {
    source,
    verifiedSource: source,
    fields,
    canonicalPaths: [],
    beforeDigest: computeFullStateDigest(fields, 'before'),
    afterDigest: computeFullStateDigest(fields, 'after'),
    operationCompletedAt: '2026-09-10T10:00:00.000Z',
  };
}

const selected: SelectedChangeIndependentReviewSummary = {
  verdict: 'NEEDS_REVIEW', // legacy reviewer intentionally cannot complete full-state review itself
  executionConformance: 'PASS',
  sourceAlignment: 'NO_UNEXPLAINED_DIFFERENCE',
  commitStatus: 'COMMITTED',
  source: { hashVerified: true },
  coverage: { sourceCoverageComplete: true, complete: true },
  findings: [{ code: 'SOURCE_REVIEW_SELECTED_ONLY', severity: 'WARNING', message: 'legacy scope marker' }],
};

describe('complete BizFile independent review gate', () => {
  it('can complete the legacy selected-change review only after independent full-state evidence passes', () => {
    const result = completeBizFileIndependentReview(selected, fullState());
    expect(result.verdict).toBe('PASS');
    expect(result.executionConformance).toBe('PASS');
    expect(result.sourceAlignment).toBe('NO_UNEXPLAINED_DIFFERENCE');
    expect(result.fullState.factualPass).toBe(true);
  });

  it('cannot turn selected-change conformance into a factual pass when one unselected section is absent', () => {
    const result = completeBizFileIndependentReview(selected, fullState('charges'));
    expect(result.verdict).toBe('NEEDS_REVIEW');
    expect(result.executionConformance).toBe('UNVERIFIABLE');
    expect(result.sourceAlignment).toBe('INCOMPLETE');
    expect(result.fullState.factualPass).toBe(false);
  });
});
