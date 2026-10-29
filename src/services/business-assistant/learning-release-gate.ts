import { HELD_OUT_EVALUATOR_VERSION, HELD_OUT_SUITE_ID } from './learning-behavioral-evaluator';

interface LearningReleaseGateState {
  readonly enabled: boolean;
  readonly gateVersion: string;
  readonly requiredEvaluatorVersion: string;
  readonly requiredSuiteId: string;
  readonly reason: string;
  readonly testOnlyOverride: boolean;
}

/**
 * Production promotion is intentionally compile-time gated. There is no
 * production environment variable that can turn it on. A future release must
 * change this source-controlled constant after independent evaluation and P16.
 */
const PRODUCTION_RELEASED = false;
let testOnlyOverride = false;

export const BUSINESS_ASSISTANT_LEARNING_RELEASE_REQUIREMENTS = Object.freeze({
  gateVersion: 'p14-release-gate-v1',
  requiredEvaluatorVersion: HELD_OUT_EVALUATOR_VERSION,
  requiredSuiteId: HELD_OUT_SUITE_ID,
  reason: 'Production learning promotion remains blocked pending independent reviewer-quality evaluation and P16 final release verification.',
});

export function learningPromotionReleaseGate(): LearningReleaseGateState {
  const testEnabled = process.env.NODE_ENV === 'test' && process.env.VITEST === 'true' && testOnlyOverride;
  return {
    enabled: PRODUCTION_RELEASED || testEnabled,
    ...BUSINESS_ASSISTANT_LEARNING_RELEASE_REQUIREMENTS,
    testOnlyOverride: testEnabled,
  };
}

/** Test harness only. It cannot enable promotion outside a Vitest process. */
export function setLearningPromotionTestGateForTests(enabled: boolean): void {
  if (process.env.NODE_ENV !== 'test' || process.env.VITEST !== 'true') {
    throw new Error('The learning promotion test gate is only available inside Vitest.');
  }
  testOnlyOverride = enabled;
}
