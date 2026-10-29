import { describe, expect, it } from 'vitest';

import { assistantCapabilities as bizFileCapabilities } from '@/services/bizfile/assistant-capabilities';
import { applyBusinessAssistantIntegrationReviewGates } from '@/services/business-assistant/integration-review-gates';
import type { ReviewResult } from '@/services/business-assistant/contracts';

const base = bizFileCapabilities[0];

function capabilityReturning(result: ReviewResult) {
  return {
    ...base,
    review: async () => result,
  };
}

async function runReview(result: ReviewResult): Promise<ReviewResult> {
  const [gated] = applyBusinessAssistantIntegrationReviewGates([capabilityReturning(result)]);
  expect(gated.executionKind).toBe('CANONICAL_WRITE');
  expect(gated.review).toBeDefined();
  return gated.review!({} as never, {} as never, {} as never, {} as never);
}

const selectedOnlyPass: ReviewResult = {
  verdict: 'PASS',
  executionConformance: 'PASS',
  sourceAlignment: 'NO_UNEXPLAINED_DIFFERENCE',
  findings: [],
  coverage: {
    complete: true,
    comparisonScope: 'SELECTED_CHANGES_ONLY',
  },
};

describe('Business Assistant integration review gates', () => {
  it('prevents the legacy selected-change BizFile reviewer from establishing factual PASS', async () => {
    const result = await runReview(selectedOnlyPass);

    expect(result.verdict).toBe('NEEDS_REVIEW');
    expect(result.executionConformance).toBe('UNVERIFIABLE');
    expect(result.sourceAlignment).toBe('INCOMPLETE');
    expect(result.findings).toContainEqual(expect.objectContaining({
      source: 'INTEGRATION_GATE',
      code: 'FULL_STATE_REVIEW_REQUIRED',
    }));
    expect(result.coverage).toMatchObject({
      integrationGate: 'BIZFILE_FULL_STATE_REQUIRED',
      fullStateEstablished: false,
    });
  });

  it('does not block a result that carries the complete PR #19 full-state contract', async () => {
    const established: ReviewResult = {
      ...selectedOnlyPass,
      coverage: {
        selectedChangeEvidenceEstablished: true,
        fullStateEstablished: true,
        fullStateRequired: 10,
        fullStateReviewed: 10,
        sourceBindingValid: true,
        beforeDigestValid: true,
        afterDigestValid: true,
        failureCodes: [],
      },
    };

    await expect(runReview(established)).resolves.toEqual(established);
  });

  it('preserves hard review failures while adding the missing full-state evidence finding', async () => {
    const failed: ReviewResult = {
      verdict: 'NEEDS_REVIEW',
      executionConformance: 'FAIL',
      sourceAlignment: 'DIFFERENCES_PRESENT',
      findings: [{ code: 'UNAUTHORIZED_WRITE' }],
      coverage: { complete: false },
    };

    const result = await runReview(failed);
    expect(result).toMatchObject({
      verdict: 'NEEDS_REVIEW',
      executionConformance: 'FAIL',
      sourceAlignment: 'DIFFERENCES_PRESENT',
    });
    expect(result.findings).toHaveLength(2);
  });
});
