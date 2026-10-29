import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
  callAIWithConnector: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    connector: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    connectorModelConfig: {
      findMany: vi.fn(),
    },
  },
}));

const session = {
  id: 'user-1',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'User',
  tenantId: 'workspace-1',
  isSuperAdmin: false,
  isWorkspaceAdmin: true,
  hasAllCompaniesAccess: true,
  companyIds: [],
};

const connector = {
  id: 'connector-1',
  workspaceId: 'workspace-1',
  name: 'OpenRouter',
  type: 'AI_PROVIDER',
  provider: 'OPENROUTER',
  settings: {
    models: [
      {
        modelId: 'openai/gpt-5.4-mini',
        name: 'GPT-5.4 Mini via OpenRouter',
        providerModelId: 'openai/gpt-5.4-mini',
        isEnabled: true,
      },
    ],
  },
  isEnabled: true,
};

describe('POST /api/connectors/[id]/models/pdf-test', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes the selected connector to the AI probe', async () => {
    const { requireAuth } = await import('@/lib/auth');
    const { callAIWithConnector } = await import('@/lib/ai');
    const { prisma } = await import('@/lib/prisma');
    const { POST } = await import('@/app/api/connectors/[id]/models/pdf-test/route');

    vi.mocked(requireAuth).mockResolvedValue(session);
    vi.mocked(prisma.connector.findFirst).mockResolvedValue(connector as never);
    vi.mocked(prisma.connectorModelConfig.findMany).mockResolvedValue([]);
    vi.mocked(prisma.connector.update).mockResolvedValue({} as never);
    vi.mocked(callAIWithConnector).mockResolvedValue({
      content: '{"ok":true}',
      model: 'openai/gpt-5.4-mini',
      provider: 'openrouter',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/connectors/connector-1/models/pdf-test', {
        method: 'POST',
        body: JSON.stringify({ modelId: 'openai/gpt-5.4-mini' }),
      }),
      { params: Promise.resolve({ id: 'connector-1' }) }
    );

    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(callAIWithConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'connector-1',
        isSuperAdmin: false,
        preferredProvider: 'openrouter',
      })
    );
  });
});
