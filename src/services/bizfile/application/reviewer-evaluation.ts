import type {
  FullStateAttribution,
  FullStateDisposition,
  FullStateIndependentReviewResult,
} from './full-state-independent-review';

export interface ReviewerEvaluationExpectation {
  id: string;
  category: string;
  expectedDisposition: FullStateDisposition;
  expectedAttribution?: FullStateAttribution;
}

export interface ReviewerEvaluationObservation extends ReviewerEvaluationExpectation {
  result: FullStateIndependentReviewResult;
}

export interface ReviewerQualityThresholds {
  factualPassPrecision: number;
  factualPassRecall: number;
  defectRecall: number;
  abstentionRecall: number;
  attributionAccuracy: number;
  maxFalsePassRate: number;
  passEvidenceCoverage: number;
}

export const REVIEWER_QUALITY_THRESHOLDS: Readonly<ReviewerQualityThresholds> = Object.freeze({
  factualPassPrecision: 1,
  factualPassRecall: 0.95,
  defectRecall: 0.95,
  abstentionRecall: 0.95,
  attributionAccuracy: 0.9,
  maxFalsePassRate: 0,
  passEvidenceCoverage: 1,
});

export interface ReviewerMetric {
  numerator: number;
  denominator: number;
  value: number;
}

export interface ReviewerQualityReport {
  total: number;
  confusion: Record<FullStateDisposition, Record<FullStateDisposition, number>>;
  factualPassPrecision: ReviewerMetric;
  factualPassRecall: ReviewerMetric;
  defectRecall: ReviewerMetric;
  abstentionRecall: ReviewerMetric;
  attributionAccuracy: ReviewerMetric;
  falsePassRate: ReviewerMetric;
  passEvidenceCoverage: ReviewerMetric;
  overallEvidenceCoverage: ReviewerMetric;
  mismatchesByCategory: Record<string, number>;
  accepted: boolean;
  failedThresholds: string[];
}

function ratio(numerator: number, denominator: number): ReviewerMetric {
  return { numerator, denominator, value: denominator === 0 ? 0 : numerator / denominator };
}

export function calculateReviewerQuality(
  observations: readonly ReviewerEvaluationObservation[],
  thresholds: ReviewerQualityThresholds = REVIEWER_QUALITY_THRESHOLDS,
): ReviewerQualityReport {
  const confusion: ReviewerQualityReport['confusion'] = {
    PASS: { PASS: 0, FAIL: 0, ABSTAIN: 0 },
    FAIL: { PASS: 0, FAIL: 0, ABSTAIN: 0 },
    ABSTAIN: { PASS: 0, FAIL: 0, ABSTAIN: 0 },
  };
  const mismatchesByCategory: Record<string, number> = {};
  let predictedPass = 0;
  let truePass = 0;
  let expectedPass = 0;
  let correctPass = 0;
  let expectedFail = 0;
  let correctFail = 0;
  let expectedAbstain = 0;
  let correctAbstain = 0;
  let attributionExpected = 0;
  let attributionCorrect = 0;
  let falsePasses = 0;
  let passCoverageNumerator = 0;
  let passCoverageDenominator = 0;
  let allCoverageNumerator = 0;
  let allCoverageDenominator = 0;

  for (const observation of observations) {
    const actual = observation.result.disposition;
    confusion[observation.expectedDisposition][actual] += 1;
    if (actual === 'PASS') predictedPass += 1;
    if (observation.expectedDisposition === 'PASS') {
      expectedPass += 1;
      if (actual === 'PASS' && observation.result.factualPass) {
        truePass += 1;
        correctPass += 1;
      }
      passCoverageNumerator += observation.result.evidenceCoverage.reviewed;
      passCoverageDenominator += observation.result.evidenceCoverage.required;
    }
    if (observation.expectedDisposition === 'FAIL') {
      expectedFail += 1;
      if (actual === 'FAIL') correctFail += 1;
    }
    if (observation.expectedDisposition === 'ABSTAIN') {
      expectedAbstain += 1;
      if (actual === 'ABSTAIN') correctAbstain += 1;
    }
    if (actual === 'PASS' && observation.expectedDisposition !== 'PASS') falsePasses += 1;
    if (observation.expectedAttribution) {
      attributionExpected += 1;
      if (observation.result.findings.some((finding) => finding.attribution === observation.expectedAttribution)) attributionCorrect += 1;
    }
    allCoverageNumerator += observation.result.evidenceCoverage.reviewed;
    allCoverageDenominator += observation.result.evidenceCoverage.required;
    if (actual !== observation.expectedDisposition) {
      mismatchesByCategory[observation.category] = (mismatchesByCategory[observation.category] ?? 0) + 1;
    }
  }

  const metrics = {
    factualPassPrecision: ratio(truePass, predictedPass),
    factualPassRecall: ratio(correctPass, expectedPass),
    defectRecall: ratio(correctFail, expectedFail),
    abstentionRecall: ratio(correctAbstain, expectedAbstain),
    attributionAccuracy: ratio(attributionCorrect, attributionExpected),
    falsePassRate: ratio(falsePasses, observations.length),
    passEvidenceCoverage: ratio(passCoverageNumerator, passCoverageDenominator),
    overallEvidenceCoverage: ratio(allCoverageNumerator, allCoverageDenominator),
  };
  const failedThresholds: string[] = [];
  if (metrics.factualPassPrecision.value < thresholds.factualPassPrecision) failedThresholds.push('factualPassPrecision');
  if (metrics.factualPassRecall.value < thresholds.factualPassRecall) failedThresholds.push('factualPassRecall');
  if (metrics.defectRecall.value < thresholds.defectRecall) failedThresholds.push('defectRecall');
  if (metrics.abstentionRecall.value < thresholds.abstentionRecall) failedThresholds.push('abstentionRecall');
  if (metrics.attributionAccuracy.value < thresholds.attributionAccuracy) failedThresholds.push('attributionAccuracy');
  if (metrics.falsePassRate.value > thresholds.maxFalsePassRate) failedThresholds.push('falsePassRate');
  if (metrics.passEvidenceCoverage.value < thresholds.passEvidenceCoverage) failedThresholds.push('passEvidenceCoverage');

  return {
    total: observations.length,
    confusion,
    ...metrics,
    mismatchesByCategory,
    accepted: observations.length > 0 && failedThresholds.length === 0,
    failedThresholds,
  };
}
