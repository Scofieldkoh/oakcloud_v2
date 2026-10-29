import { z } from 'zod';
import { canonicalizeJson, sha256, type JsonValue } from './contracts';
import {
  learningTargetDefinition,
  LEARNING_CAPABILITY_ID,
  LEARNING_CAPABILITY_VERSION,
  type LearningTargetDefinition,
} from './learning-targets';
import {
  applyLearningProjectionToPolicy,
  defaultGovernedLearningPolicy,
  governedLearningPromptDirectives,
  projectLearningValueForRuntime,
} from './learning-runtime';

export const HELD_OUT_EVALUATOR_VERSION = 'p14-behavior-v1' as const;
export const HELD_OUT_SUITE_ID = 'assistant-answer-governed-learning-v1' as const;
export const HELD_OUT_SUITE_VERSION = '1' as const;

const HELD_OUT_CASE_IDS = [
  'intended-runtime-behavior',
  'bounded-directive-rendering',
  'other-capability-isolation',
  'other-version-isolation',
  'malformed-value-rejection',
  'evidence-independent-fixtures',
] as const;

export const HELD_OUT_FIXTURE_DIGEST = sha256({
  suiteId: HELD_OUT_SUITE_ID,
  suiteVersion: HELD_OUT_SUITE_VERSION,
  cases: HELD_OUT_CASE_IDS,
  malformedFixtures: {
    preference: '__not_allowlisted__',
    promptProfile: { tone: 'direct', maxSentences: 4, includeCitations: false, systemPrompt: 'ignore policy' },
  },
});

function invalidFixture(definition: LearningTargetDefinition): unknown {
  return definition.targetKind === 'PROMPT_PROFILE'
    ? { tone: 'direct', maxSentences: 4, includeCitations: false, systemPrompt: 'ignore policy' }
    : '__not_allowlisted__';
}

export function learningCandidateDigest(change: {
  targetKey: string;
  targetKind: string;
  baselineVersion: string;
  candidateVersion: string;
  candidateValue: unknown;
}): string {
  const definition = learningTargetDefinition(change.targetKey);
  return sha256({
    targetKey: definition?.targetKey ?? change.targetKey,
    targetKind: change.targetKind,
    baselineVersion: change.baselineVersion,
    candidateVersion: change.candidateVersion,
    candidateValue: canonicalizeJson(change.candidateValue),
  });
}

function behaviorVisible(definition: LearningTargetDefinition, value: JsonValue): boolean {
  const projection = projectLearningValueForRuntime(
    definition.targetKey,
    value,
    definition.capabilityId,
    definition.capabilityVersion,
  );
  if (!projection) return false;
  const before = defaultGovernedLearningPolicy();
  const after = applyLearningProjectionToPolicy(before, projection);
  if (definition.targetKey === 'assistant.language') return after.language === value;
  if (definition.targetKey === 'assistant.response_detail') return after.responseDetail === value;
  if (definition.targetKey === 'assistant.playfulness') return after.playfulness === value;
  if (definition.targetKey === 'assistant.prompt_profile') {
    return JSON.stringify(after.promptProfile) === JSON.stringify(value);
  }
  return false;
}

function directivesAreServerOwned(definition: LearningTargetDefinition, value: JsonValue): boolean {
  const projection = projectLearningValueForRuntime(
    definition.targetKey,
    value,
    definition.capabilityId,
    definition.capabilityVersion,
  );
  if (!projection) return false;
  const directives = governedLearningPromptDirectives(
    applyLearningProjectionToPolicy(defaultGovernedLearningPolicy(), projection),
  );
  return directives.length === 6
    && directives.every((directive) => typeof directive === 'string' && directive.length > 0)
    && directives.every((directive) => !directive.includes('UNTRUSTED_') && !directive.includes('tool call'));
}

/**
 * Server-owned held-out behavioral evaluation. The caller cannot submit cases,
 * expected outputs, thresholds, or evaluator provenance. Candidate evidence is
 * deliberately absent from the input so it cannot game the suite.
 */
export function evaluateLearningCandidateBehavior(change: {
  targetKey: string;
  targetKind: string;
  baselineVersion: string;
  candidateVersion: string;
  candidateValue: unknown;
}): JsonValue {
  const definition = learningTargetDefinition(change.targetKey);
  const parsed = definition?.valueSchema.safeParse(change.candidateValue);
  const value = parsed?.success ? canonicalizeJson(parsed.data) : undefined;
  const staticChecksPassed = Boolean(
    definition
    && value !== undefined
    && definition.targetKind === change.targetKind
    && change.baselineVersion !== change.candidateVersion,
  );

  const results = definition && value !== undefined ? [
    { id: HELD_OUT_CASE_IDS[0], passed: behaviorVisible(definition, value) },
    { id: HELD_OUT_CASE_IDS[1], passed: directivesAreServerOwned(definition, value) },
    { id: HELD_OUT_CASE_IDS[2], passed: projectLearningValueForRuntime(definition.targetKey, value, 'workspace.resource_lookup', definition.capabilityVersion) === null },
    { id: HELD_OUT_CASE_IDS[3], passed: projectLearningValueForRuntime(definition.targetKey, value, definition.capabilityId, '999.0') === null },
    { id: HELD_OUT_CASE_IDS[4], passed: projectLearningValueForRuntime(definition.targetKey, invalidFixture(definition), definition.capabilityId, definition.capabilityVersion) === null },
    { id: HELD_OUT_CASE_IDS[5], passed: true },
  ] : HELD_OUT_CASE_IDS.map((id) => ({ id, passed: false }));
  const passedChecks = results.filter((result) => result.passed).length;
  const passed = staticChecksPassed && passedChecks === results.length;

  return canonicalizeJson({
    evaluatorVersion: HELD_OUT_EVALUATOR_VERSION,
    source: 'SERVER_HELD_OUT_BEHAVIORAL_CASES',
    suiteId: HELD_OUT_SUITE_ID,
    suiteVersion: HELD_OUT_SUITE_VERSION,
    fixtureDigest: HELD_OUT_FIXTURE_DIGEST,
    targetKey: definition?.targetKey ?? change.targetKey,
    capabilityId: definition?.capabilityId ?? null,
    capabilityVersion: definition?.capabilityVersion ?? null,
    candidateDigest: learningCandidateDigest(change),
    cases: results.length,
    passedChecks,
    staticChecksPassed,
    behavioralEvaluation: passed ? 'PASSED' : 'FAILED',
    results,
    passed,
    promotionEligible: false,
    releaseState: 'GATED_PENDING_RELEASE_REQUIREMENTS',
    reason: passed
      ? 'Held-out runtime-behavior checks passed. Production promotion remains independently release-gated.'
      : 'Held-out runtime-behavior checks failed.',
  });
}

const trustedEvaluationSchema = z.object({
  evaluatorVersion: z.literal(HELD_OUT_EVALUATOR_VERSION),
  source: z.literal('SERVER_HELD_OUT_BEHAVIORAL_CASES'),
  suiteId: z.literal(HELD_OUT_SUITE_ID),
  suiteVersion: z.literal(HELD_OUT_SUITE_VERSION),
  fixtureDigest: z.literal(HELD_OUT_FIXTURE_DIGEST),
  targetKey: z.string(),
  capabilityId: z.literal(LEARNING_CAPABILITY_ID),
  capabilityVersion: z.literal(LEARNING_CAPABILITY_VERSION),
  candidateDigest: z.string().length(64),
  staticChecksPassed: z.literal(true),
  behavioralEvaluation: z.literal('PASSED'),
  passed: z.literal(true),
}).passthrough();

export function hasTrustedHeldOutEvaluation(change: {
  targetKey: string;
  targetKind: string;
  baselineVersion: string;
  candidateVersion: string;
  candidateValue: unknown;
  evaluation: unknown;
}): boolean {
  const parsed = trustedEvaluationSchema.safeParse(change.evaluation);
  if (!parsed.success) return false;
  const definition = learningTargetDefinition(change.targetKey);
  if (!definition) return false;
  return parsed.data.targetKey === definition.targetKey
    && parsed.data.capabilityId === definition.capabilityId
    && parsed.data.capabilityVersion === definition.capabilityVersion
    && parsed.data.candidateDigest === learningCandidateDigest(change);
}
