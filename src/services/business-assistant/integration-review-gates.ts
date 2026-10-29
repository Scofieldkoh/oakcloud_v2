import type { BusinessAssistantCapability, JsonValue, ReviewResult } from './contracts';

type JsonRecord = Record<string, JsonValue>;

function asRecord(value: JsonValue | undefined): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function hasEstablishedBizFileFullStateGate(reviewed: ReviewResult): boolean {
  const coverage = asRecord(reviewed.coverage);
  if (!coverage) return false;
  const failureCodes = coverage.failureCodes;
  return coverage.selectedChangeEvidenceEstablished === true
    && coverage.fullStateEstablished === true
    && coverage.sourceBindingValid === true
    && coverage.beforeDigestValid === true
    && coverage.afterDigestValid === true
    && typeof coverage.fullStateRequired === 'number'
    && coverage.fullStateRequired > 0
    && coverage.fullStateReviewed === coverage.fullStateRequired
    && Array.isArray(failureCodes)
    && failureCodes.length === 0;
}

function fullStateRequiredFinding(): JsonValue {
  return {
    source: 'INTEGRATION_GATE',
    code: 'FULL_STATE_REVIEW_REQUIRED',
    severity: 'ERROR',
    message: 'Selected-change evidence cannot establish factual PASS until the independent full-state review contract is satisfied.',
  };
}

/**
 * Registration-time fail-closed integration gates.
 *
 * PR #19 made full-state source evidence mandatory for factual BizFile PASS,
 * while the older registered capability still returns its selected-change
 * reviewer directly. Until the runtime evidence producer supplies the final
 * combiner coverage, prevent that legacy result from bypassing the mandatory
 * full-state gate. This function never upgrades a review and never enables a
 * capability or production feature flag.
 */
export function applyBusinessAssistantIntegrationReviewGates(
  capabilities: readonly BusinessAssistantCapability[],
): readonly BusinessAssistantCapability[] {
  return capabilities.map((capability) => {
    if (capability.id !== 'bizfile.import_and_review'
      || capability.executionKind !== 'CANONICAL_WRITE'
      || capability.reviewPolicy !== 'REQUIRED'
      || !capability.review) {
      return capability;
    }

    const review = capability.review;
    return {
      ...capability,
      review: async (...args: Parameters<typeof review>): Promise<ReviewResult> => {
        const reviewed = await review(...args);
        if (hasEstablishedBizFileFullStateGate(reviewed)) return reviewed;

        const hardFailure = reviewed.verdict === 'REVIEW_FAILED'
          || reviewed.executionConformance === 'FAIL'
          || reviewed.sourceAlignment === 'DIFFERENCES_PRESENT';
        const findings = Array.isArray(reviewed.findings)
          ? [...reviewed.findings, fullStateRequiredFinding()]
          : [fullStateRequiredFinding()];
        const priorCoverage = asRecord(reviewed.coverage) ?? {};

        return {
          ...reviewed,
          verdict: reviewed.verdict === 'REVIEW_FAILED' ? 'REVIEW_FAILED' : 'NEEDS_REVIEW',
          executionConformance: hardFailure
            ? reviewed.executionConformance
            : 'UNVERIFIABLE',
          sourceAlignment: reviewed.sourceAlignment === 'DIFFERENCES_PRESENT'
            ? 'DIFFERENCES_PRESENT'
            : 'INCOMPLETE',
          findings,
          coverage: {
            ...priorCoverage,
            integrationGate: 'BIZFILE_FULL_STATE_REQUIRED',
            fullStateEstablished: false,
          },
        };
      },
    } satisfies BusinessAssistantCapability;
  });
}
