import { describe, expect, it } from 'vitest';
import { computeFullStateDigest, type FullStateFieldEvidence } from '../full-state-independent-review';
import {
  BIZFILE_FULL_STATE_REVIEW_CONTRACT,
  evaluateBizFileFullStateIndependentReview,
} from '../full-state-review-contract';

const source = {
  sourceType: 'BIZFILE_PDF',
  sourceIdentity: 'document-1',
  sourceReference: 'retained://document-1',
  sha256: 'b'.repeat(64),
  sourceRevision: 'rev-1',
};

function reviewedSection(path: string): FullStateFieldEvidence {
  return {
    path,
    selected: false,
    beforeValue: { path, value: 'same' },
    afterValue: { path, value: 'same' },
    sourceValue: { path, value: 'same' },
    coverageStatus: 'REVIEWED',
    binding: { evidenceIds: [`ev-${path}`], section: path, pages: [1] },
  };
}

function completeInput() {
  const fields = BIZFILE_FULL_STATE_REVIEW_CONTRACT.canonicalPaths.map(reviewedSection);
  return {
    source,
    verifiedSource: source,
    fields,
    // Deliberately wrong: the contract wrapper must ignore this producer value.
    canonicalPaths: ['entity'],
    beforeDigest: computeFullStateDigest(fields, 'before'),
    afterDigest: computeFullStateDigest(fields, 'after'),
    operationCompletedAt: '2026-09-10T10:00:00.000Z',
  };
}

describe('BizFile full-state review contract', () => {
  it('uses reviewer-owned completeness rather than evidence-supplied paths', () => {
    const result = evaluateBizFileFullStateIndependentReview(completeInput());
    expect(result.factualPass).toBe(true);
    expect(result.evidenceCoverage.required).toBe(BIZFILE_FULL_STATE_REVIEW_CONTRACT.canonicalPaths.length);
  });

  it('cannot be tricked into PASS by omitting an unselected section from the producer denominator', () => {
    const input = completeInput();
    input.fields = input.fields.filter((field) => field.path !== 'charges');
    input.beforeDigest = computeFullStateDigest(input.fields, 'before');
    input.afterDigest = computeFullStateDigest(input.fields, 'after');
    const result = evaluateBizFileFullStateIndependentReview(input);
    expect(result.factualPass).toBe(false);
    expect(result.fullStateEstablished).toBe(false);
    expect(result.failureCodes).toContain('FULL_STATE_COVERAGE_MISSING');
  });
});
