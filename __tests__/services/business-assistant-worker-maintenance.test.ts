import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ inbound: vi.fn(), item: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/generated/business-assistant-capability-registry', () => ({ businessAssistantCapabilityRegistry: {} }));
vi.mock('@/services/business-assistant/claim.repository', () => ({
  claimInboundMessage: mocks.inbound,
  claimRunnableItem: mocks.item,
}));

import { runBusinessAssistantWorker } from '@/services/business-assistant/worker';

describe('module-owned worker maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inbound.mockResolvedValue(null);
    mocks.item.mockResolvedValue(null);
    vi.stubEnv('BUSINESS_ASSISTANT_PROVIDER_ENABLED', 'false');
    vi.stubEnv('BUSINESS_ASSISTANT_MUTATIONS_ENABLED', 'false');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('drains already committed module effects with new dispatch disabled', async () => {
    const effectDrain = vi.fn().mockResolvedValue({ claimed: 1, errors: 0 });
    const result = await runBusinessAssistantWorker({ once: true, effectDrain });
    expect(effectDrain).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ messagesProcessed: 0, itemsProcessed: 0, errors: 0 });
  });

  it('does not starve committed effects after intake fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.inbound.mockRejectedValue(new Error('intake unavailable'));
    const effectDrain = vi.fn().mockResolvedValue({ claimed: 1, errors: 0 });
    const result = await runBusinessAssistantWorker({ once: true, effectDrain });
    expect(effectDrain).toHaveBeenCalledTimes(1);
    expect(result.errors).toBe(1);
  });

  it('reports a maintenance failure without failing worker shutdown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const effectDrain = vi.fn().mockRejectedValue(new Error('effect storage unavailable'));
    await expect(runBusinessAssistantWorker({ once: true, effectDrain })).resolves.toMatchObject({ errors: 1 });
  });
});
