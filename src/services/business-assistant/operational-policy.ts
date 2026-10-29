import { BUSINESS_ASSISTANT_LIMITS, capabilityStages, type ResourceRef } from './contracts';

/**
 * Durable assistant work must have a finite amount of retry/resource/provider
 * work attached to one item. These bounds deliberately derive from the
 * capability contract so a worker restart cannot silently reset the budget.
 */
export const BUSINESS_ASSISTANT_OPERATIONAL_LIMITS = {
  maxResourcesPerItem: BUSINESS_ASSISTANT_LIMITS.maxResourceRefs,
  maxWorkerFailuresPerItem: BUSINESS_ASSISTANT_LIMITS.maxAttemptsPerStage * 2,
  maxProviderDispatchesPerItem: BUSINESS_ASSISTANT_LIMITS.maxAttemptsPerStage,
  maxTotalStageAttemptsPerItem: capabilityStages.length * BUSINESS_ASSISTANT_LIMITS.maxAttemptsPerStage,
} as const;

export type BusinessAssistantBudgetKind = 'PROVIDER' | 'RESOURCE' | 'RETRY' | 'STAGE';

const dispositionByBudget: Readonly<Record<BusinessAssistantBudgetKind, string>> = {
  PROVIDER: 'PROVIDER_BUDGET_EXHAUSTED',
  RESOURCE: 'RESOURCE_BUDGET_EXHAUSTED',
  RETRY: 'RETRY_BUDGET_EXHAUSTED',
  STAGE: 'STAGE_BUDGET_EXHAUSTED',
};

export class BusinessAssistantBudgetExhaustedError extends Error {
  readonly dispositionReason: string;

  constructor(
    readonly kind: BusinessAssistantBudgetKind,
    readonly used: number,
    readonly limit: number,
  ) {
    super(`Business Assistant ${kind.toLowerCase()} budget exhausted (${used}/${limit}).`);
    this.name = 'BusinessAssistantBudgetExhaustedError';
    this.dispositionReason = dispositionByBudget[kind];
  }
}

export function assertBusinessAssistantResourceBudget(resources: readonly ResourceRef[]): void {
  const used = resources.length;
  const limit = BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxResourcesPerItem;
  if (used > limit) throw new BusinessAssistantBudgetExhaustedError('RESOURCE', used, limit);
}

/** Check before starting another worker-level retry. */
export function assertBusinessAssistantRetryBudget(retryCount: number): void {
  const used = Math.max(0, retryCount);
  const limit = BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxWorkerFailuresPerItem;
  if (used >= limit) throw new BusinessAssistantBudgetExhaustedError('RETRY', used, limit);
}

/** Check persisted stage rows before starting another stage attempt. */
export function assertBusinessAssistantStageBudget(totalStageAttempts: number): void {
  const used = Math.max(0, totalStageAttempts);
  const limit = BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxTotalStageAttemptsPerItem;
  if (used >= limit) throw new BusinessAssistantBudgetExhaustedError('STAGE', used, limit);
}

/**
 * Provider-backed capabilities call this with the persisted number of prior
 * provider-dispatch stage attempts. The count is durable, so process restarts
 * do not replenish the budget.
 */
export function assertBusinessAssistantProviderBudget(providerDispatchAttempts: number): void {
  const used = Math.max(0, providerDispatchAttempts);
  const limit = BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxProviderDispatchesPerItem;
  if (used >= limit) throw new BusinessAssistantBudgetExhaustedError('PROVIDER', used, limit);
}

/** Backoff is deterministic, capped, and cannot grow without bound. */
export function businessAssistantRetryDelayMs(retryCount: number): number {
  const bounded = Math.max(0, Math.min(retryCount, BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxWorkerFailuresPerItem));
  return Math.min(30_000, 2_000 * (2 ** bounded));
}
