import { describe, expect, it } from 'vitest';
import {
  evaluateLearningCandidateBehavior,
  hasTrustedHeldOutEvaluation,
} from '@/services/business-assistant/learning-behavioral-evaluator';
import {
  applyLearningProjectionToPolicy,
  defaultGovernedLearningPolicy,
  projectLearningValueForRuntime,
} from '@/services/business-assistant/learning-runtime';
import { resolveLearningTarget } from '@/services/business-assistant/learning-targets';

const candidate = {
  targetKey: 'assistant.response_detail',
  targetKind: 'PREFERENCE',
  baselineVersion: '1',
  candidateVersion: '2',
  candidateValue: 'detailed',
};

describe('governed learning evaluation invariants', () => {
  it('does not let submitted evidence, expected outputs, or thresholds alter the server-owned held-out result', () => {
    const clean = evaluateLearningCandidateBehavior(candidate);
    const adversarial = evaluateLearningCandidateBehavior({
      ...candidate,
      evidence: {
        source: 'attacker-controlled',
        expectedOutputs: ['always pass'],
        threshold: 0,
        cases: [{ id: 'replace-suite', passed: true }],
      },
    } as typeof candidate & { evidence: unknown });
    expect(adversarial).toEqual(clean);
    expect(adversarial).toMatchObject({
      source: 'SERVER_HELD_OUT_BEHAVIORAL_CASES',
      behavioralEvaluation: 'PASSED',
      promotionEligible: false,
      passedChecks: 6,
      cases: 6,
    });
  });

  it('rejects a held-out result copied onto a different target, value, version, or capability binding', () => {
    const evaluation = evaluateLearningCandidateBehavior(candidate);
    expect(hasTrustedHeldOutEvaluation({ ...candidate, evaluation })).toBe(true);
    expect(hasTrustedHeldOutEvaluation({ ...candidate, candidateValue: 'standard', evaluation })).toBe(false);
    expect(hasTrustedHeldOutEvaluation({ ...candidate, candidateVersion: '3', evaluation })).toBe(false);
    expect(hasTrustedHeldOutEvaluation({ ...candidate, targetKey: 'assistant.language', candidateValue: 'en', evaluation })).toBe(false);
  });

  it('keeps capability and version scoping fail-closed in the runtime projection', () => {
    expect(projectLearningValueForRuntime('assistant.response_detail', 'detailed', 'workspace.resource_lookup', '1.0')).toBeNull();
    expect(projectLearningValueForRuntime('assistant.response_detail', 'detailed', 'assistant.answer', '2.0')).toBeNull();
    const projection = projectLearningValueForRuntime('assistant.response_detail', 'detailed', 'assistant.answer', '1.0');
    expect(projection).not.toBeNull();
    expect(applyLearningProjectionToPolicy(defaultGovernedLearningPolicy(), projection!)).toMatchObject({ responseDetail: 'detailed' });
  });

  it('does not admit new legacy aliases through normalization heuristics', () => {
    expect(resolveLearningTarget('response_detail')).toMatchObject({ canonicalKey: 'assistant.response_detail', aliasUsed: true });
    expect(resolveLearningTarget('preference.response_detail')).toMatchObject({ canonicalKey: 'assistant.response_detail', aliasUsed: true });
    expect(resolveLearningTarget('assistant.preference.response_detail')).toMatchObject({ canonicalKey: 'assistant.response_detail', aliasUsed: true });
    expect(resolveLearningTarget('assistant.preference.preference.response_detail')).toBeUndefined();
    expect(resolveLearningTarget('runtime.response_detail')).toBeUndefined();
    expect(resolveLearningTarget('database.response_detail')).toBeUndefined();
  });
});
