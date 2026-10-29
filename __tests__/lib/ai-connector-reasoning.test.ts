import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ provider: vi.fn(), resolve: vi.fn() }));
vi.mock('@/services/connector.service', () => ({ resolveConnector: mocks.resolve, getConnectorById: vi.fn() }));
vi.mock('@/services/connector-usage.service', () => ({ logConnectorUsage: vi.fn(async () => undefined) }));
vi.mock('@/lib/prisma', () => ({ prisma: { connectorModelConfig: { findUnique: vi.fn(async () => null) } } }));
vi.mock('@/lib/ai/providers/openrouter', () => ({ callOpenRouter: mocks.provider, isOpenRouterConfigured: () => false }));
import { callAIWithConnector } from '@/lib/ai';

describe('connector reasoning defaults dispatch', () => {
  it.each([['business_assistant_answer', 'high'], ['bizfile_extraction', 'low'], ['other', undefined]])('dispatches %s with its own saved effort', async (operation, expected) => {
    mocks.provider.mockResolvedValue({ content: 'OK', model: 'custom', provider: 'openrouter' });
    mocks.resolve.mockImplementation(async (_tenant, _type, provider) => provider === 'OPENROUTER' ? {
      source: 'workspace', connector: { id: 'connector', credentials: { apiKey: 'test' }, settings: {
        models: [{ modelId: 'custom', providerModelId: 'vendor/model', isEnabled: true }],
        reasoningDefaults: { businessAssistant: { modelId: 'custom', effort: 'high' }, bizfileExtraction: { modelId: 'custom', effort: 'low' } },
      } },
    } : null);
    await callAIWithConnector({ tenantId: 'tenant', model: 'custom', userPrompt: 'Hello', operation });
    expect(mocks.provider).toHaveBeenLastCalledWith(expect.objectContaining({ reasoningEffort: expected }), { apiKey: 'test' });
  });
});
