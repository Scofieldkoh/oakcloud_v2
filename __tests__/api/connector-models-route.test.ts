import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/ai/openrouter-reasoning', () => ({ getOpenRouterReasoningCatalog: vi.fn(async () => new Map()) }));

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    connector: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    connectorModelConfig: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/ai/models', () => ({
  AI_MODELS: {
    'openrouter-research': {
      id: 'openrouter-research',
      name: 'OpenRouter Research',
      provider: 'openrouter',
      description: 'Built-in research model',
      providerModelId: 'perplexity/sonar-pro-search',
    },
  },
}));

const adminSession = {
  id: 'user-1',
  email: 'user@example.com',
  firstName: 'Test',
  lastName: 'User',
  tenantId: 'workspace-1',
  isSuperAdmin: false,
  isWorkspaceAdmin: true,
  hasAllCompaniesAccess: true,
  companyIds: [],
};

const openRouterConnector = {
  id: 'connector-1',
  workspaceId: 'workspace-1',
  provider: 'OPENROUTER',
  settings: {
    customModels: [
      {
        modelId: 'anthropic/claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5 via OpenRouter',
        description: 'Custom OpenRouter model',
        isEnabled: true,
      },
    ],
    modelDefaults: {
      general: 'anthropic/claude-sonnet-4.5',
      research: 'openrouter-research',
    },
  },
};

describe('/api/connectors/[id]/models', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('lists seeded and added models for a connector', async () => {
    const { requireAuth } = await import('@/lib/auth');
    const { prisma } = await import('@/lib/prisma');
    const { GET } = await import('@/app/api/connectors/[id]/models/route');

    vi.mocked(requireAuth).mockResolvedValue(adminSession);
    vi.mocked(prisma.connector.findFirst).mockResolvedValue(openRouterConnector as never);
    vi.mocked(prisma.connectorModelConfig.findMany).mockResolvedValue([]);

    const response = await GET(new NextRequest('http://localhost/api/connectors/connector-1/models'), {
      params: Promise.resolve({ id: 'connector-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: 'openrouter-research',
        }),
        expect.objectContaining({
          modelId: 'anthropic/claude-sonnet-4.5',
          name: 'Claude Sonnet 4.5 via OpenRouter',
          providerModelId: 'anthropic/claude-sonnet-4.5',
          isEnabled: true,
          documentInputMode: 'auto',
        }),
      ])
    );
  });

  it('adds a model to connector settings', async () => {
    const { requireAuth } = await import('@/lib/auth');
    const { prisma } = await import('@/lib/prisma');
    const { POST } = await import('@/app/api/connectors/[id]/models/route');

    vi.mocked(requireAuth).mockResolvedValue(adminSession);
    vi.mocked(prisma.connector.findFirst).mockResolvedValue({
      ...openRouterConnector,
      settings: { customModels: [] },
    } as never);
    vi.mocked(prisma.connector.update).mockResolvedValue({} as never);

    const request = new NextRequest('http://localhost/api/connectors/connector-1/models', {
      method: 'POST',
      body: JSON.stringify({
        modelId: 'openai/gpt-5',
        name: 'GPT-5 via OpenRouter',
        description: 'Custom model',
        documentInputMode: 'image',
      }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: 'connector-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        modelId: 'openai/gpt-5',
        name: 'GPT-5 via OpenRouter',
        providerModelId: 'openai/gpt-5',
        isEnabled: true,
        documentInputMode: 'image',
      })
    );
    expect(prisma.connector.update).toHaveBeenCalledWith({
      where: { id: 'connector-1' },
      data: {
        settings: {
          models: [
            expect.objectContaining({
              modelId: 'openrouter-research',
            }),
            expect.objectContaining({
              modelId: 'openai/gpt-5',
              name: 'GPT-5 via OpenRouter',
              documentInputMode: 'image',
            }),
          ],
        },
      },
    });
  });

  it('removes models and clears deleted defaults', async () => {
    const { requireAuth } = await import('@/lib/auth');
    const { prisma } = await import('@/lib/prisma');
    const { DELETE } = await import('@/app/api/connectors/[id]/models/route');

    vi.mocked(requireAuth).mockResolvedValue(adminSession);
    vi.mocked(prisma.connector.findFirst).mockResolvedValue(openRouterConnector as never);
    vi.mocked(prisma.connector.update).mockResolvedValue({} as never);
    vi.mocked(prisma.connectorModelConfig.deleteMany).mockResolvedValue({ count: 0 } as never);

    const request = new NextRequest(
      'http://localhost/api/connectors/connector-1/models?modelId=anthropic%2Fclaude-sonnet-4.5',
      { method: 'DELETE' }
    );
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'connector-1' }),
    });

    expect(response.status).toBe(200);
    expect(prisma.connector.update).toHaveBeenCalledWith({
      where: { id: 'connector-1' },
      data: {
        settings: {
          models: [
            expect.objectContaining({
              modelId: 'openrouter-research',
            }),
          ],
          modelDefaults: {
            research: 'openrouter-research',
          },
        },
      },
    });
  });

  it('preserves PDF input test metadata in connector settings', async () => {
    const { requireAuth } = await import('@/lib/auth');
    const { prisma } = await import('@/lib/prisma');
    const { GET } = await import('@/app/api/connectors/[id]/models/route');

    vi.mocked(requireAuth).mockResolvedValue(adminSession);
    vi.mocked(prisma.connector.findFirst).mockResolvedValue({
      ...openRouterConnector,
      settings: {
        models: [
          {
            modelId: 'openai/gpt-5.4-mini',
            name: 'GPT-5.4 Mini',
            providerModelId: 'openai/gpt-5.4-mini',
            isEnabled: true,
            supportsPdfInput: false,
            documentInputMode: 'image',
            lastPdfInputTest: {
              success: false,
              testedAt: '2026-06-27T12:07:40.000Z',
              error: 'unsupported MIME type application/pdf',
            },
          },
        ],
      },
    } as never);
    vi.mocked(prisma.connectorModelConfig.findMany).mockResolvedValue([]);

    const response = await GET(new NextRequest('http://localhost/api/connectors/connector-1/models'), {
      params: Promise.resolve({ id: 'connector-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        modelId: 'openai/gpt-5.4-mini',
        supportsPdfInput: false,
        documentInputMode: 'image',
        lastPdfInputTest: {
          success: false,
          testedAt: '2026-06-27T12:07:40.000Z',
          error: 'unsupported MIME type application/pdf',
        },
      }),
    ]);
  });

  it('removes seeded models too', async () => {
    const { requireAuth } = await import('@/lib/auth');
    const { prisma } = await import('@/lib/prisma');
    const { DELETE } = await import('@/app/api/connectors/[id]/models/route');

    vi.mocked(requireAuth).mockResolvedValue(adminSession);
    vi.mocked(prisma.connector.findFirst).mockResolvedValue(openRouterConnector as never);

    const request = new NextRequest(
      'http://localhost/api/connectors/connector-1/models?modelId=openrouter-research',
      { method: 'DELETE' }
    );
    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'connector-1' }),
    });

    expect(response.status).toBe(200);
    expect(prisma.connector.update).toHaveBeenCalledWith({
      where: { id: 'connector-1' },
      data: {
        settings: {
          models: [
            expect.objectContaining({
              modelId: 'anthropic/claude-sonnet-4.5',
            }),
          ],
          modelDefaults: {
            general: 'anthropic/claude-sonnet-4.5',
          },
        },
      },
    });
  });
});
