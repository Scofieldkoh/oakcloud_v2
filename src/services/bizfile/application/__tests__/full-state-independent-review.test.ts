import { describe, expect, it } from 'vitest';
import {
  computeFullStateDigest,
  evaluateFullStateIndependentReview,
  type FullStateFieldEvidence,
  type FullStateIndependentReviewInput,
} from '../full-state-independent-review';

const source = {
  sourceType: 'BIZFILE_PDF',
  sourceIdentity: 'bizfile-document-1',
  sourceReference: 'retained://bizfile/document-1',
  sha256: 'a'.repeat(64),
  sourceRevision: 'rev-1',
};

function field(overrides: Partial<FullStateFieldEvidence> = {}): FullStateFieldEvidence {
  return {
    path: 'company.name',
    selected: false,
    beforeValue: 'OAK PTE. LTD.',
    afterValue: 'OAK PTE. LTD.',
    sourceValue: 'OAK PTE. LTD.',
    coverageStatus: 'REVIEWED',
    binding: { evidenceIds: ['ev-1'], section: 'Company Information', pages: [1] },
    ...overrides,
  };
}

function input(fields: FullStateFieldEvidence[], overrides: Partial<FullStateIndependentReviewInput> = {}): FullStateIndependentReviewInput {
  const base: FullStateIndependentReviewInput = {
    source,
    verifiedSource: source,
    fields,
    canonicalPaths: fields.map((item) => item.path),
    beforeDigest: computeFullStateDigest(fields, 'before'),
    afterDigest: computeFullStateDigest(fields, 'after'),
    operationCompletedAt: '2026-09-10T10:00:00.000Z',
  };
  return { ...base, ...overrides };
}

describe('evaluateFullStateIndependentReview', () => {
  it('passes only when the complete declared state is independently reviewed', () => {
    const result = evaluateFullStateIndependentReview(input([field()]));
    expect(result.disposition).toBe('PASS');
    expect(result.factualPass).toBe(true);
    expect(result.fullStateEstablished).toBe(true);
  });

  it('abstains rather than passing when a canonical path lacks evidence', () => {
    const result = evaluateFullStateIndependentReview(input([field()], {
      canonicalPaths: ['company.name', 'company.status'],
    }));
    expect(result.disposition).toBe('ABSTAIN');
    expect(result.factualPass).toBe(false);
    expect(result.failureCodes).toContain('FULL_STATE_COVERAGE_MISSING');
  });

  it('fails an unexplained write outside the approved change set', () => {
    const result = evaluateFullStateIndependentReview(input([
      field({ afterValue: 'UNAPPROVED NAME' }),
    ]));
    expect(result.disposition).toBe('FAIL');
    expect(result.factualPass).toBe(false);
    expect(result.findings[0]?.attribution).toBe('UNAUTHORIZED_UNSELECTED_WRITE');
  });

  it('cannot pass after before/after evidence is altered without matching immutable digests', () => {
    const original = [field()];
    const reviewInput = input(original);
    reviewInput.fields = [field({ afterValue: 'TAMPERED' })];
    const result = evaluateFullStateIndependentReview(reviewInput);
    expect(result.factualPass).toBe(false);
    expect(result.afterDigestValid).toBe(false);
    expect(result.failureCodes).toContain('AFTER_EVIDENCE_IMMUTABILITY_FAILURE');
  });
});
