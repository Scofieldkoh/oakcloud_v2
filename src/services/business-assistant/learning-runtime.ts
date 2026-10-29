import type { JsonValue } from './contracts';
import {
  LEARNING_CAPABILITY_ID,
  LEARNING_CAPABILITY_VERSION,
  learningTargetDefinition,
} from './learning-targets';

export interface GovernedLearningPolicy {
  language: 'en' | 'zh' | 'ms';
  responseDetail: 'concise' | 'standard' | 'detailed';
  playfulness: 'none' | 'light';
  promptProfile: {
    tone: 'direct' | 'warm';
    maxSentences: number;
    includeCitations: boolean;
  };
}

export interface LearningRuntimeProjection {
  readonly targetKey: string;
  readonly targetKind: string;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly value: JsonValue;
}

export function defaultGovernedLearningPolicy(): GovernedLearningPolicy {
  return {
    language: 'en',
    responseDetail: 'concise',
    playfulness: 'none',
    promptProfile: { tone: 'direct', maxSentences: 4, includeCitations: false },
  };
}

export function projectLearningValueForRuntime(
  targetKey: string,
  value: unknown,
  capabilityId: string,
  capabilityVersion: string,
): LearningRuntimeProjection | null {
  const definition = learningTargetDefinition(targetKey);
  if (!definition
    || definition.capabilityId !== capabilityId
    || definition.capabilityVersion !== capabilityVersion) return null;
  const parsed = definition.valueSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    targetKey: definition.targetKey,
    targetKind: definition.targetKind,
    capabilityId: definition.capabilityId,
    capabilityVersion: definition.capabilityVersion,
    value: parsed.data as JsonValue,
  };
}

export function applyLearningProjectionToPolicy(
  current: GovernedLearningPolicy,
  projection: LearningRuntimeProjection,
): GovernedLearningPolicy {
  if (projection.capabilityId !== LEARNING_CAPABILITY_ID
    || projection.capabilityVersion !== LEARNING_CAPABILITY_VERSION) return current;
  if (projection.targetKey === 'assistant.language') {
    return { ...current, language: projection.value as GovernedLearningPolicy['language'] };
  }
  if (projection.targetKey === 'assistant.response_detail') {
    return { ...current, responseDetail: projection.value as GovernedLearningPolicy['responseDetail'] };
  }
  if (projection.targetKey === 'assistant.playfulness') {
    return { ...current, playfulness: projection.value as GovernedLearningPolicy['playfulness'] };
  }
  if (projection.targetKey === 'assistant.prompt_profile') {
    return { ...current, promptProfile: projection.value as GovernedLearningPolicy['promptProfile'] };
  }
  return current;
}

/**
 * Converts bounded configuration into fixed server-owned behavioral directives.
 * Candidate strings are never concatenated into the prompt; only enum/object
 * branches defined here can alter runtime wording behavior.
 */
export function governedLearningPromptDirectives(policy: GovernedLearningPolicy): readonly string[] {
  const language = policy.language === 'zh'
    ? 'Respond in Chinese.'
    : policy.language === 'ms'
      ? 'Respond in Malay.'
      : 'Respond in English.';
  const detail = policy.responseDetail === 'detailed'
    ? 'Use comprehensive detail when it helps answer the question.'
    : policy.responseDetail === 'standard'
      ? 'Use moderate detail.'
      : 'Prefer a concise answer.';
  const playfulness = policy.playfulness === 'light'
    ? 'A light, friendly touch is allowed when appropriate.'
    : 'Keep the wording straightforward rather than playful.';
  const tone = policy.promptProfile.tone === 'warm'
    ? 'Use a warm professional tone.'
    : 'Use a direct professional tone.';
  const sentenceLimit = `When practical, keep the answer within ${policy.promptProfile.maxSentences} sentences.`;
  const citations = policy.promptProfile.includeCitations
    ? 'When source citations are available in the capability, include them.'
    : 'Do not add citation placeholders when no source citations are available.';
  return [language, detail, playfulness, tone, sentenceLimit, citations];
}
