import { z } from 'zod';
import { getAssistantPreferenceDefinition } from '@/lib/business-assistant-preferences';
import type { JsonValue } from './contracts';

export const LEARNING_CAPABILITY_ID = 'assistant.answer' as const;
export const LEARNING_CAPABILITY_VERSION = '1.0' as const;

const promptProfileSchema = z.object({
  tone: z.enum(['direct', 'warm']),
  maxSentences: z.number().int().min(1).max(8),
  includeCitations: z.boolean(),
}).strict();

export type LearningTargetKind = 'PREFERENCE' | 'PROMPT_PROFILE';

export interface LearningTargetDefinition {
  readonly targetKey: string;
  readonly targetKind: LearningTargetKind;
  readonly capabilityId: typeof LEARNING_CAPABILITY_ID;
  readonly capabilityVersion: typeof LEARNING_CAPABILITY_VERSION;
  readonly valueSchema: z.ZodTypeAny;
  readonly defaultValue: JsonValue;
  readonly defaultVersion: string;
  readonly activationTtlDays: number;
}

function preferenceTarget(key: 'language' | 'response_detail' | 'playfulness'): LearningTargetDefinition {
  const definition = getAssistantPreferenceDefinition(key);
  if (!definition) throw new Error(`Missing source-controlled assistant preference definition: ${key}`);
  return {
    targetKey: `assistant.${key}`,
    targetKind: 'PREFERENCE',
    capabilityId: LEARNING_CAPABILITY_ID,
    capabilityVersion: LEARNING_CAPABILITY_VERSION,
    valueSchema: definition.schema,
    defaultValue: definition.options[0]?.value ?? null,
    defaultVersion: '1',
    activationTtlDays: 90,
  };
}

const TARGETS = {
  'assistant.language': preferenceTarget('language'),
  'assistant.response_detail': preferenceTarget('response_detail'),
  'assistant.playfulness': preferenceTarget('playfulness'),
  'assistant.prompt_profile': {
    targetKey: 'assistant.prompt_profile',
    targetKind: 'PROMPT_PROFILE',
    capabilityId: LEARNING_CAPABILITY_ID,
    capabilityVersion: LEARNING_CAPABILITY_VERSION,
    valueSchema: promptProfileSchema,
    defaultValue: { tone: 'direct', maxSentences: 4, includeCitations: false },
    defaultVersion: '1',
    activationTtlDays: 30,
  },
} as const satisfies Record<string, LearningTargetDefinition>;

/**
 * Legacy keys are enumerated deliberately. Never replace this map with prefix
 * stripping: doing so would turn newly introduced runtime/database namespaces
 * into learnable configuration without an explicit source review.
 */
const LEGACY_TARGET_ALIASES = {
  language: 'assistant.language',
  'preference.language': 'assistant.language',
  'assistant.preference.language': 'assistant.language',
  response_detail: 'assistant.response_detail',
  'preference.response_detail': 'assistant.response_detail',
  'assistant.preference.response_detail': 'assistant.response_detail',
  playfulness: 'assistant.playfulness',
  'preference.playfulness': 'assistant.playfulness',
  'assistant.preference.playfulness': 'assistant.playfulness',
  prompt_profile: 'assistant.prompt_profile',
  'preference.prompt_profile': 'assistant.prompt_profile',
  'assistant.preference.prompt_profile': 'assistant.prompt_profile',
} as const;

export type CanonicalLearningTargetKey = keyof typeof TARGETS;

export interface ResolvedLearningTarget {
  readonly requestedKey: string;
  readonly canonicalKey: CanonicalLearningTargetKey;
  readonly aliasUsed: boolean;
  readonly definition: LearningTargetDefinition;
}

export function resolveLearningTarget(targetKey: string): ResolvedLearningTarget | undefined {
  const direct = Object.prototype.hasOwnProperty.call(TARGETS, targetKey)
    ? targetKey as CanonicalLearningTargetKey
    : undefined;
  const alias = Object.prototype.hasOwnProperty.call(LEGACY_TARGET_ALIASES, targetKey)
    ? LEGACY_TARGET_ALIASES[targetKey as keyof typeof LEGACY_TARGET_ALIASES]
    : undefined;
  const canonicalKey = direct ?? alias;
  if (!canonicalKey) return undefined;
  return {
    requestedKey: targetKey,
    canonicalKey,
    aliasUsed: canonicalKey !== targetKey,
    definition: TARGETS[canonicalKey],
  };
}

export function learningTargetDefinition(targetKey: string): LearningTargetDefinition | undefined {
  return resolveLearningTarget(targetKey)?.definition;
}

export function canonicalLearningTargetKeys(): readonly CanonicalLearningTargetKey[] {
  return Object.keys(TARGETS) as CanonicalLearningTargetKey[];
}

export function canonicalLearningTargetForCapability(
  targetKey: string,
  capabilityId: string,
  capabilityVersion: string,
): LearningTargetDefinition | undefined {
  const definition = learningTargetDefinition(targetKey);
  if (!definition || definition.capabilityId !== capabilityId || definition.capabilityVersion !== capabilityVersion) return undefined;
  return definition;
}
