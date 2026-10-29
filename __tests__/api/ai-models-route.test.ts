import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
  AI_MODELS: {
    'gpt-test': {
      id: 'gpt-test',
      name: 'GPT Test',
      provider: 'openai',
      description: 'Test OpenAI model',
      supportsJson: true,
      supportsVision: true,
      isDefault: true,
    },
    'openrouter-research': {
      id: 'openrouter-research',
      name: 'OpenRouter Research',
      provider: 'openrouter',
      description: 'Research model',
      supportsJson: true,
      supportsVision: false,
      isDefault: false,
    },
    'openrouter-ocr': {
      id: 'openrouter-ocr',
      name: 'OpenRouter OCR',
      provider: 'openrouter',
      description: 'OCR model',
      supportsJson: true,
      supportsVision: true,
      isDefault: false,
    },
  },
  PROVIDER_NAMES: {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    openrouter: 'OpenRouter',
  },
  getAvailableProvidersForWorkspace: vi.fn(),
  getBestAvailableModelForWorkspace: vi.fn(),
  getDefaultModelId: vi.fn(),
}));

vi.mock('@/services/connector.service', () => ({
  resolveConnector: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    connectorModelConfig: {
      findMany: vi.fn(),
    },
    connector: {
      findMany: vi.fn(),
    },
  },
}));

describe('GET /api/ai/models', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns available models when a connector lookup fails for another provider', async () => {
    const { requireAuth } = await import('@/lib/auth');
    const {
      getAvailableProvidersForWorkspace,
      getBestAvailableModelForWorkspace,
      getDefaultModelId,
    } = await import('@/lib/ai');
    const { resolveConnector } = await import('@/services/connector.service');
    const { prisma } = await import('@/lib/prisma');
    const { GET } = await import('@/app/api/ai/models/route');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(requireAuth).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
      isWorkspaceAdmin: true,
      hasAllCompaniesAccess: true,
      companyIds: [],
    });
    vi.mocked(getAvailableProvidersForWorkspace).mockResolvedValue(['openai']);
    vi.mocked(getBestAvailableModelForWorkspace).mockResolvedValue('gpt-test' as never);
    vi.mocked(getDefaultModelId).mockReturnValue('gpt-test' as never);
    vi.mocked(resolveConnector).mockImplementation(async (_tenantId, _type, provider) => {
      if (provider === 'ANTHROPIC') {
        throw new Error('bad connector credentials');
      }
      return null;
    });
    vi.mocked(prisma.connectorModelConfig.findMany).mockResolvedValue([]);

    const request = new NextRequest('http://localhost/api/ai/models');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'gpt-test',
          available: true,
        }),
      ])
    );
    expect(body.defaultModel).toBe('gpt-test');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error resolving anthropic connector for AI models:',
      expect.any(Error)
    );
    consoleErrorSpy.mockRestore();
  });

  it('applies connector model disables and grouped default models', async () => {
    const { requireAuth } = await import('@/lib/auth');
    const {
      getAvailableProvidersForWorkspace,
      getBestAvailableModelForWorkspace,
      getDefaultModelId,
    } = await import('@/lib/ai');
    const { resolveConnector } = await import('@/services/connector.service');
    const { prisma } = await import('@/lib/prisma');
    const { GET } = await import('@/app/api/ai/models/route');

    vi.mocked(requireAuth).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
      isWorkspaceAdmin: true,
      hasAllCompaniesAccess: true,
      companyIds: [],
    });
    vi.mocked(getAvailableProvidersForWorkspace).mockResolvedValue(['openrouter']);
    vi.mocked(getBestAvailableModelForWorkspace).mockResolvedValue('openrouter-research' as never);
    vi.mocked(getDefaultModelId).mockReturnValue('gpt-test' as never);
    vi.mocked(resolveConnector).mockImplementation(async (_tenantId, _type, provider) => {
      if (provider === 'OPENROUTER') {
        return {
          source: 'workspace',
          connector: {
            id: 'openrouter-connector',
            provider: 'OPENROUTER',
            settings: {
              modelDefaults: {
                general: 'openrouter-research',
                ocr: 'openrouter-ocr',
                research: 'openrouter-research',
              },
            },
          },
        } as never;
      }
      return null;
    });
    vi.mocked(prisma.connectorModelConfig.findMany).mockResolvedValue([
      {
        connectorId: 'openrouter-connector',
        modelId: 'openrouter-ocr',
        isEnabled: false,
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/ai/models');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'openrouter-research',
          available: true,
          isDefault: true,
        }),
        expect.objectContaining({
          id: 'openrouter-ocr',
          available: false,
          isDefault: false,
        }),
      ])
    );
    expect(body.defaultModel).toBe('openrouter-research');
    expect(body.defaultModels).toEqual({
      general: 'openrouter-research',
      ocr: null,
      research: 'openrouter-research',
    });
  });

  it('includes custom OpenRouter models from connector settings', async () => {
    const { requireAuth } = await import('@/lib/auth');
    const {
      getAvailableProvidersForWorkspace,
      getBestAvailableModelForWorkspace,
      getDefaultModelId,
    } = await import('@/lib/ai');
    const { resolveConnector } = await import('@/services/connector.service');
    const { prisma } = await import('@/lib/prisma');
    const { GET } = await import('@/app/api/ai/models/route');

    vi.mocked(requireAuth).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
      isWorkspaceAdmin: true,
      hasAllCompaniesAccess: true,
      companyIds: [],
    });
    vi.mocked(getAvailableProvidersForWorkspace).mockResolvedValue(['openrouter']);
    vi.mocked(getBestAvailableModelForWorkspace).mockResolvedValue(null);
    vi.mocked(getDefaultModelId).mockReturnValue('gpt-test' as never);
    vi.mocked(resolveConnector).mockImplementation(async (_tenantId, _type, provider) => {
      if (provider === 'OPENROUTER') {
        return {
          source: 'workspace',
          connector: {
            id: 'openrouter-connector',
            provider: 'OPENROUTER',
            settings: {
              customModels: [
                {
                  modelId: 'anthropic/claude-sonnet-4.5',
                  name: 'Claude Sonnet 4.5 via OpenRouter',
                  description: 'Custom OpenRouter model',
                  supportsJson: true,
                  supportsVision: true,
                  isEnabled: true,
                },
              ],
              modelDefaults: {
                general: 'anthropic/claude-sonnet-4.5',
              },
            },
          },
        } as never;
      }
      return null;
    });
    vi.mocked(prisma.connectorModelConfig.findMany).mockResolvedValue([]);

    const request = new NextRequest('http://localhost/api/ai/models');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'anthropic/claude-sonnet-4.5',
          name: 'Claude Sonnet 4.5 via OpenRouter',
          provider: 'openrouter',
          available: true,
          isDefault: true,
        }),
      ])
    );
    expect(body.defaultModel).toBe('anthropic/claude-sonnet-4.5');
  });
});
