import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), catalog: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mocks.create } }; } }));
vi.mock('@/lib/ai/openrouter-reasoning', () => ({ getOpenRouterReasoningCatalog: mocks.catalog }));
import { callOpenRouter } from '@/lib/ai/providers/openrouter';

describe('OpenRouter reasoning request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ choices: [{ message: { content: 'OK' } }] });
  });
  it.each(['supported', 'unsupported', 'unavailable', 'default'])('handles %s reasoning without changing provider defaults', async (state) => {
    mocks.catalog.mockResolvedValue(state === 'unavailable' ? null : new Map([['provider/model', state === 'supported' ? ['high'] : []]]));
    await callOpenRouter({
      model: 'local-model', userPrompt: 'Hello', reasoningEffort: state === 'default' ? undefined : 'high',
      modelConfig: { id: 'local-model', name: 'Model', provider: 'openrouter', providerModelId: 'provider/model', description: '', supportsJson: true, supportsVision: false, maxTokens: 4096, inputPricePerMillion: 0, outputPricePerMillion: 0 },
    }, { apiKey: 'test-key' });
    const request = mocks.create.mock.calls[0][0];
    if (state === 'supported') expect(request.reasoning).toEqual({ effort: 'high' });
    else expect(request).not.toHaveProperty('reasoning');
    if (state === 'default') expect(mocks.catalog).not.toHaveBeenCalled();
    expect(request).not.toHaveProperty('reasoning_effort');
  });
});
