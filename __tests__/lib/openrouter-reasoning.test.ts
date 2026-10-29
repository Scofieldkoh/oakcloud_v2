import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseReasoningEfforts } from '@/lib/ai/openrouter-reasoning';
import { getConfiguredReasoningEffort, REASONING_EFFORTS } from '@/lib/ai/reasoning-settings';

describe('OpenRouter reasoning capabilities', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('does not infer effort support from model names or reasoning token support', () => {
    expect(parseReasoningEfforts({ id: 'openai/gpt-5', supported_parameters: ['reasoning'] })).toEqual([]);
    expect(parseReasoningEfforts({ reasoning: { supports_max_tokens: true } })).toEqual([]);
  });
  it('filters unsupported values and removes None for mandatory reasoning', () => {
    expect(parseReasoningEfforts({ reasoning: { supported_efforts: ['none', 'high', 'low', 'unknown'], mandatory: true } })).toEqual(['low', 'high']);
    expect(parseReasoningEfforts({ reasoning: { supported_efforts: null } })).toEqual(REASONING_EFFORTS);
  });
  it('keeps use-case settings independent and prevents stale choices on a different model', () => {
    const settings = { reasoningDefaults: {
      businessAssistant: { modelId: 'model', effort: 'high' },
      bizfileExtraction: { modelId: 'model', effort: 'low' },
      general: { modelId: 'model', effort: 'invalid' },
    } };
    expect(getConfiguredReasoningEffort(settings, 'model', 'business_assistant_answer')).toBe('high');
    expect(getConfiguredReasoningEffort(settings, 'model', 'bizfile_extraction')).toBe('low');
    expect(getConfiguredReasoningEffort(settings, 'different', 'bizfile_extraction')).toBeUndefined();
    expect(getConfiguredReasoningEffort(settings, 'model')).toBeUndefined();
  });
  it('loads public metadata once for concurrent callers and caches it', async () => {
    vi.resetModules();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'model', reasoning: { supported_efforts: ['high'] } }] })));
    vi.stubGlobal('fetch', fetch);
    const { getOpenRouterReasoningCatalog } = await import('@/lib/ai/openrouter-reasoning');
    const results = await Promise.all([getOpenRouterReasoningCatalog(), getOpenRouterReasoningCatalog()]);
    expect(results[0]?.get('model')).toEqual(['high']);
    await getOpenRouterReasoningCatalog();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('returns unknown capabilities on a catalog failure', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { getOpenRouterReasoningCatalog } = await import('@/lib/ai/openrouter-reasoning');
    expect(await getOpenRouterReasoningCatalog()).toBeNull();
  });
});
