import {
  generationSessionStateV1Schema,
  generationSessionStateV2Schema,
  type GenerationSessionState,
} from '@/lib/validations/generated-document';
import type { ServiceAgreementDraftDto } from '@/services/service-agreement/types';

export interface GenerationSessionEnvelope {
  id: string;
  savedAt: string;
  state: GenerationSessionState;
  agreement: ServiceAgreementDraftDto | null;
}

export function readActiveGenerationSession(metadata: unknown): GenerationSessionState | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const stored = (metadata as Record<string, unknown>).generationSession;
  const current = generationSessionStateV2Schema.safeParse(stored);
  if (current.success) return current.data;

  const legacy = generationSessionStateV1Schema.safeParse(stored);
  if (!legacy.success) return null;
  const legacyStep = legacy.data.currentStep;
  const normalizedStep = (!Number.isFinite(legacyStep) || legacyStep <= 1)
    ? 0
    : legacyStep <= 3
      ? 1
      : 2;
  return {
    ...legacy.data,
    version: 2,
    currentStep: normalizedStep,
    serviceAgreementId: null,
  };
}

export function isActiveGenerationSessionMetadata(metadata: unknown): boolean {
  return readActiveGenerationSession(metadata) !== null;
}
