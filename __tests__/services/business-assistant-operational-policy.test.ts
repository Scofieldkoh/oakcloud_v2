import { describe, expect, it } from 'vitest';
import {
  BUSINESS_ASSISTANT_OPERATIONAL_LIMITS,
  BusinessAssistantBudgetExhaustedError,
  assertBusinessAssistantProviderBudget,
  assertBusinessAssistantResourceBudget,
  assertBusinessAssistantRetryBudget,
  assertBusinessAssistantStageBudget,
  businessAssistantRetryDelayMs,
} from '@/services/business-assistant/operational-policy';

describe('Business Assistant operational budgets', () => {
  it('accepts resource workloads through the documented 1-10 item range', () => {
    for (let count = 1; count <= 10; count += 1) {
      const resources = Array.from({ length: count }, (_, index) => ({ resourceType: 'document', resourceId: `doc-${index}`, role: 'source' as const }));
      expect(() => assertBusinessAssistantResourceBudget(resources)).not.toThrow();
    }
  });

  it('fails explicitly when a resource budget is exhausted', () => {
    const resources = Array.from({ length: BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxResourcesPerItem + 1 }, (_, index) => ({ resourceType: 'document', resourceId: `doc-${index}`, role: 'source' as const }));
    expect(() => assertBusinessAssistantResourceBudget(resources)).toThrowError(BusinessAssistantBudgetExhaustedError);
    try {
      assertBusinessAssistantResourceBudget(resources);
    } catch (error) {
      expect(error).toMatchObject({ kind: 'RESOURCE', dispositionReason: 'RESOURCE_BUDGET_EXHAUSTED' });
    }
  });

  it('does not allow worker retries, stage attempts, or provider dispatch to replenish past their bounds', () => {
    expect(() => assertBusinessAssistantRetryBudget(BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxWorkerFailuresPerItem - 1)).not.toThrow();
    expect(() => assertBusinessAssistantRetryBudget(BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxWorkerFailuresPerItem)).toThrow(/retry budget exhausted/i);
    expect(() => assertBusinessAssistantStageBudget(BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxTotalStageAttemptsPerItem)).toThrow(/stage budget exhausted/i);
    expect(() => assertBusinessAssistantProviderBudget(BUSINESS_ASSISTANT_OPERATIONAL_LIMITS.maxProviderDispatchesPerItem)).toThrow(/provider budget exhausted/i);
  });

  it('uses deterministic capped retry delays', () => {
    expect(businessAssistantRetryDelayMs(0)).toBe(2_000);
    expect(businessAssistantRetryDelayMs(1)).toBe(4_000);
    expect(businessAssistantRetryDelayMs(100)).toBe(30_000);
  });
});
