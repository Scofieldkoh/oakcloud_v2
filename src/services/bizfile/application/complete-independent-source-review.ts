import type { JsonValue, ReviewResult } from '@/services/business-assistant/contracts';
import {
  evaluateBizFileFullStateIndependentReview,
} from './full-state-review-contract';
import type {
  FullStateIndependentReviewInput,
  FullStateIndependentReviewResult,
} from './full-state-independent-review';

export interface SelectedChangeIndependentReviewSummary {
  verdict: 'PASS' | 'PASS_WITH_WARNINGS' | 'NEEDS_REVIEW' | 'REVIEW_FAILED';
  executionConformance: 'PASS' | 'FAIL' | 'UNVERIFIABLE';
  sourceAlignment: 'NO_UNEXPLAINED_DIFFERENCE' | 'DIFFERENCES_PRESENT' | 'INCOMPLETE';
  commitStatus: 'COMMITTED' | 'NO_COMMIT' | 'UNKNOWN';
  source: { hashVerified: boolean };
  coverage: { sourceCoverageComplete: boolean; complete: boolean };
  findings: readonly { code: string; severity: 'ERROR' | 'WARNING' | 'INFO'; message: string }[];
}

export interface CompletedBizFileIndependentReview extends ReviewResult {
  fullState: FullStateIndependentReviewResult;
}

function selectedStreamEstablished(selected: SelectedChangeIndependentReviewSummary): boolean {
  return selected.commitStatus === 'COMMITTED'
    && selected.source.hashVerified
    && selected.coverage.sourceCoverageComplete
    && selected.coverage.complete
    && selected.executionConformance === 'PASS'
    && selected.sourceAlignment === 'NO_UNEXPLAINED_DIFFERENCE';
}

function jsonFinding(value: Record<string, JsonValue>): JsonValue {
  return value;
}

/**
 * Final read-only review gate. The old selected-change review remains useful
 * for approved-change conformance, but can never establish a factual PASS on
 * its own. Full-state source evidence is independently mandatory.
 */
export function completeBizFileIndependentReview(
  selected: SelectedChangeIndependentReviewSummary,
  fullStateInput: FullStateIndependentReviewInput,
): CompletedBizFileIndependentReview {
  const fullState = evaluateBizFileFullStateIndependentReview(fullStateInput);
  const selectedEstablished = selectedStreamEstablished(selected);
  const hardSelectedFailure = selected.verdict === 'REVIEW_FAILED'
    || selected.executionConformance === 'FAIL'
    || selected.sourceAlignment === 'DIFFERENCES_PRESENT';
  const fullStateFailure = fullState.disposition === 'FAIL';
  const factualPass = selectedEstablished && fullState.factualPass;

  const verdict: ReviewResult['verdict'] = factualPass
    ? 'PASS'
    : selected.verdict === 'REVIEW_FAILED'
      ? 'REVIEW_FAILED'
      : 'NEEDS_REVIEW';
  const executionConformance: ReviewResult['executionConformance'] = hardSelectedFailure || fullStateFailure
    ? 'FAIL'
    : factualPass
      ? 'PASS'
      : 'UNVERIFIABLE';
  const sourceAlignment: ReviewResult['sourceAlignment'] = factualPass
    ? 'NO_UNEXPLAINED_DIFFERENCE'
    : fullStateFailure || selected.sourceAlignment === 'DIFFERENCES_PRESENT'
      ? 'DIFFERENCES_PRESENT'
      : 'INCOMPLETE';

  const selectedFindings = selected.findings
    .filter((finding) => finding.code !== 'SOURCE_REVIEW_SELECTED_ONLY')
    .map((finding) => jsonFinding({
      source: 'SELECTED_CHANGE_REVIEW',
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
    }));
  const fullStateFindings = fullState.findings.map((finding) => jsonFinding({
    source: 'FULL_STATE_REVIEW',
    path: finding.path,
    disposition: finding.disposition,
    attribution: finding.attribution,
    selected: finding.selected,
    reason: finding.reason,
  }));

  return {
    verdict,
    executionConformance,
    sourceAlignment,
    findings: [...selectedFindings, ...fullStateFindings],
    coverage: {
      selectedChangeEvidenceEstablished: selectedEstablished,
      fullStateEstablished: fullState.fullStateEstablished,
      fullStateRequired: fullState.evidenceCoverage.required,
      fullStateReviewed: fullState.evidenceCoverage.reviewed,
      fullStateCoverageRatio: fullState.evidenceCoverage.ratio,
      sourceBindingValid: fullState.sourceBindingValid,
      beforeDigestValid: fullState.beforeDigestValid,
      afterDigestValid: fullState.afterDigestValid,
      failureCodes: fullState.failureCodes,
    },
    fullState,
  };
}
