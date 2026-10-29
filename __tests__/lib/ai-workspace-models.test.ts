import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/connector.service', () => ({
  getAvailableConnectors: vi.fn(),
}));

describe('workspace AI model selection', () => {
  it.each([
    ['businessAssistant', true], ['businessAssistant', false],
    ['bizfileExtraction', true], ['bizfileExtraction', false],
  ] as const)('honors the %s default only when enabled (%s)', async (group, isEnabled) => {
    const { getAvailableConnectors } = await import('@/services/connector.service');
    const { getBestAvailableModelForWorkspace } = await import('@/lib/ai');
    vi.mocked(getAvailableConnectors).mockResolvedValue([{
      source: 'tenant', connector: {
        id: 'openrouter-connector', provider: 'OPENROUTER', settings: {
          models: [
            { modelId: 'general-model', isEnabled: true },
            { modelId: 'assistant-model', isEnabled },
          ],
          modelDefaults: { general: 'general-model', [group]: 'assistant-model' },
        },
      },
    }] as never);
    await expect(getBestAvailableModelForWorkspace('workspace-1', group))
      .resolves.toBe(isEnabled ? 'assistant-model' : 'general-model');
    await expect(getBestAvailableModelForWorkspace('workspace-1', group, { configuredOnly: true }))
      .resolves.toBe(isEnabled ? 'assistant-model' : null);
    await expect(getBestAvailableModelForWorkspace('workspace-1')).resolves.toBe('general-model');
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('prefers enabled connector models when a provider has an editable model list', async () => {
    const { getAvailableConnectors } = await import('@/services/connector.service');
    const { getBestAvailableModelForWorkspace } = await import('@/lib/ai');

    vi.mocked(getAvailableConnectors).mockResolvedValue([
      {
        source: 'system',
        connector: {
          id: 'openrouter-connector',
          provider: 'OPENROUTER',
          settings: {
            models: [
              {
                modelId: 'openai/gpt-5.4-mini',
                name: 'GPT 5.4 Mini',
                providerModelId: 'openai/gpt-5.4-mini',
                isEnabled: true,
              },
            ],
          },
        },
      },
    ] as never);

    await expect(getBestAvailableModelForWorkspace('workspace-1')).resolves.toBe(
      'openai/gpt-5.4-mini'
    );
  });
});
