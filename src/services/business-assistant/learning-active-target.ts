import { z } from 'zod';
import { canonicalizeJson, sha256, type JsonValue } from './contracts';
import { learningTargetDefinition, type LearningTargetDefinition } from './learning-targets';

const envelopeSchema = z.object({
  __oakcloudLearningTarget: z.object({
    schemaVersion: z.literal('1'),
    state: z.enum(['ACTIVE', 'DEACTIVATED', 'EXPIRED', 'DELETED']),
    capabilityId: z.string().min(1).max(200),
    capabilityVersion: z.string().min(1).max(40),
    changeId: z.string().min(1).nullable(),
    value: z.unknown().optional(),
    valueDigest: z.string().length(64).nullable(),
    activatedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    lifecycleAt: z.string().datetime().nullable(),
  }).strict(),
}).strict();

export type LearningActiveState = 'ACTIVE' | 'DEACTIVATED' | 'EXPIRED' | 'DELETED';

export interface DecodedLearningActiveValue {
  readonly state: LearningActiveState;
  readonly value: JsonValue | null;
  readonly valueDigest: string | null;
  readonly changeId: string | null;
  readonly activatedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly lifecycleAt: Date | null;
  readonly legacy: boolean;
}

function asDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

export function createLearningActiveEnvelope(
  definition: LearningTargetDefinition,
  value: unknown,
  changeId: string,
  activatedAt = new Date(),
): JsonValue {
  const parsed = definition.valueSchema.safeParse(value);
  if (!parsed.success) throw new Error('Cannot activate a learning value outside the source-controlled target schema.');
  const canonicalValue = canonicalizeJson(parsed.data);
  const expiresAt = new Date(activatedAt.getTime() + definition.activationTtlDays * 24 * 60 * 60 * 1000);
  return canonicalizeJson({
    __oakcloudLearningTarget: {
      schemaVersion: '1',
      state: 'ACTIVE',
      capabilityId: definition.capabilityId,
      capabilityVersion: definition.capabilityVersion,
      changeId,
      value: canonicalValue,
      valueDigest: sha256(canonicalValue),
      activatedAt: activatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lifecycleAt: null,
    },
  });
}

export function createLearningLifecycleMarker(
  definition: LearningTargetDefinition,
  state: Exclude<LearningActiveState, 'ACTIVE'>,
  options: { valueDigest?: string | null; changeId?: string | null; lifecycleAt?: Date } = {},
): JsonValue {
  const lifecycleAt = options.lifecycleAt ?? new Date();
  return canonicalizeJson({
    __oakcloudLearningTarget: {
      schemaVersion: '1',
      state,
      capabilityId: definition.capabilityId,
      capabilityVersion: definition.capabilityVersion,
      changeId: options.changeId ?? null,
      valueDigest: options.valueDigest ?? null,
      activatedAt: null,
      expiresAt: null,
      lifecycleAt: lifecycleAt.toISOString(),
    },
  });
}

/** Decode new envelopes and pre-P14 direct values without trusting either. */
export function decodeLearningActiveValue(
  targetKey: string,
  storedValue: unknown,
  now = new Date(),
): DecodedLearningActiveValue | null {
  const definition = learningTargetDefinition(targetKey);
  if (!definition) return null;
  const envelope = envelopeSchema.safeParse(storedValue);
  if (envelope.success) {
    const data = envelope.data.__oakcloudLearningTarget;
    if (data.capabilityId !== definition.capabilityId || data.capabilityVersion !== definition.capabilityVersion) return null;
    const expiresAt = asDate(data.expiresAt);
    const effectiveState: LearningActiveState = data.state === 'ACTIVE' && expiresAt && expiresAt <= now ? 'EXPIRED' : data.state;
    if (effectiveState !== 'ACTIVE') {
      return {
        state: effectiveState,
        value: null,
        valueDigest: data.valueDigest,
        changeId: data.changeId,
        activatedAt: asDate(data.activatedAt),
        expiresAt,
        lifecycleAt: asDate(data.lifecycleAt),
        legacy: false,
      };
    }
    const parsedValue = definition.valueSchema.safeParse(data.value);
    if (!parsedValue.success) return null;
    const value = canonicalizeJson(parsedValue.data);
    if (data.valueDigest !== sha256(value)) return null;
    return {
      state: 'ACTIVE',
      value,
      valueDigest: data.valueDigest,
      changeId: data.changeId,
      activatedAt: asDate(data.activatedAt),
      expiresAt,
      lifecycleAt: asDate(data.lifecycleAt),
      legacy: false,
    };
  }

  const legacy = definition.valueSchema.safeParse(storedValue);
  if (!legacy.success) return null;
  const value = canonicalizeJson(legacy.data);
  return {
    state: 'ACTIVE',
    value,
    valueDigest: sha256(value),
    changeId: null,
    activatedAt: null,
    expiresAt: null,
    lifecycleAt: null,
    legacy: true,
  };
}

export function isDeletedLearningTarget(targetKey: string, storedValue: unknown): boolean {
  return decodeLearningActiveValue(targetKey, storedValue)?.state === 'DELETED';
}
