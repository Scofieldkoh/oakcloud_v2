import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    connector: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    workspaceConnectorAccess: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  maskSensitive: vi.fn((value: string) => `masked:${value}`),
}));

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
  computeChanges: vi.fn(),
}));

function connector(overrides: Record<string, unknown>) {
  return {
    id: 'connector-id',
    workspaceId: null,
    name: 'Connector',
    type: 'AI_PROVIDER',
    provider: 'OPENAI',
    credentials: 'encrypted',
    settings: null,
    isEnabled: true,
    isDefault: false,
    callCount: 0,
    lastUsedAt: null,
    lastTestedAt: null,
    lastTestResult: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('connector visibility with undecryptable credentials', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('keeps connectors visible when credentials cannot be decrypted for masking', async () => {
    const { prisma } = await import('@/lib/prisma');
    const { decrypt } = await import('@/lib/encryption');
    const { searchConnectors } = await import('@/services/connector.service');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(prisma.connector.findMany).mockResolvedValue([
      connector({ id: 'bad-openai', name: 'OpenAI', credentials: 'bad' }) as never,
      connector({ id: 'openrouter', name: 'OpenRouter', provider: 'OPENROUTER', credentials: 'good' }) as never,
    ]);
    vi.mocked(prisma.connector.count).mockResolvedValue(2);
    vi.mocked(decrypt).mockImplementation((ciphertext: string) => {
      if (ciphertext === 'bad') {
        throw new Error('Unsupported state or unable to authenticate data');
      }
      return JSON.stringify({ apiKey: 'sk-test' });
    });

    const result = await searchConnectors(
      { includeSystem: true, page: 1, limit: 20 },
      { tenantId: 'tenant-1', userId: 'user-1', isSuperAdmin: true }
    );

    expect(result.connectors).toHaveLength(2);
    expect(result.connectors[0]).toEqual(
      expect.objectContaining({
        id: 'bad-openai',
        credentials: {},
        credentialsMasked: false,
      })
    );
    expect(result.connectors[1]).toEqual(
      expect.objectContaining({
        id: 'openrouter',
        credentials: { apiKey: 'masked:sk-test' },
        credentialsMasked: true,
      })
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Unable to decrypt credentials for connector bad-openai:',
      expect.any(Error)
    );
    consoleErrorSpy.mockRestore();
  });

  it('skips only the undecryptable provider when finding available connectors', async () => {
    const { prisma } = await import('@/lib/prisma');
    const { decrypt } = await import('@/lib/encryption');
    const { getAvailableConnectors } = await import('@/services/connector.service');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    (vi.mocked(prisma.connector.findFirst) as unknown as { mockImplementation: (fn: (args?: unknown) => Promise<unknown>) => void })
      .mockImplementation(async (args?: unknown) => {
      const where = (args as { where?: { provider?: string } } | undefined)?.where;
      if (where?.provider === 'OPENAI') {
        return connector({ id: 'bad-openai', provider: 'OPENAI', credentials: 'bad' }) as never;
      }
      if (where?.provider === 'OPENROUTER') {
        return connector({ id: 'openrouter', provider: 'OPENROUTER', credentials: 'good' }) as never;
      }
      return null;
    });
    vi.mocked(prisma.workspaceConnectorAccess.findUnique).mockResolvedValue(null);
    vi.mocked(decrypt).mockImplementation((ciphertext: string) => {
      if (ciphertext === 'bad') {
        throw new Error('Unsupported state or unable to authenticate data');
      }
      return JSON.stringify({ apiKey: 'sk-test' });
    });

    const result = await getAvailableConnectors('tenant-1', 'AI_PROVIDER');

    expect(result.map((item) => item.connector.provider)).toEqual(['OPENROUTER']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Unable to resolve OPENAI connector:',
      expect.any(Error)
    );
    consoleErrorSpy.mockRestore();
  });

  it('records a failed test result when connector credentials cannot be decrypted', async () => {
    const { prisma } = await import('@/lib/prisma');
    const { decrypt } = await import('@/lib/encryption');
    const { createAuditLog } = await import('@/lib/audit');
    const { testConnector } = await import('@/services/connector.service');

    vi.mocked(prisma.connector.findFirst).mockResolvedValue(
      connector({ id: 'bad-openai', workspaceId: 'tenant-1', credentials: 'bad' }) as never
    );
    vi.mocked(prisma.connector.update).mockResolvedValue(
      connector({
        id: 'bad-openai',
        workspaceId: 'tenant-1',
        credentials: 'bad',
        lastTestResult: 'error:Unsupported state or unable to authenticate data',
      }) as never
    );
    vi.mocked(decrypt).mockImplementation(() => {
      throw new Error('Unsupported state or unable to authenticate data');
    });

    const result = await testConnector('bad-openai', {
      tenantId: 'tenant-1',
      userId: 'user-1',
      isSuperAdmin: false,
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Unsupported state or unable to authenticate data',
      })
    );
    expect(prisma.connector.update).toHaveBeenCalledWith({
      where: { id: 'bad-openai' },
      data: expect.objectContaining({
        lastTestResult: 'error:Unsupported state or unable to authenticate data',
      }),
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONNECTOR_TESTED',
        metadata: expect.objectContaining({ success: false }),
      })
    );
  });

  it('preserves signed-document filing settings during a general connector update', async () => {
    const { prisma } = await import('@/lib/prisma');
    const { decrypt } = await import('@/lib/encryption');
    const { updateConnector } = await import('@/services/connector.service');
    const filingSettings = {
      enabled: false,
      configVersion: 3,
      clientDocumentsRoot: { driveId: 'drive-id', itemId: 'client-root', name: 'Client Documents', webUrl: 'https://sharepoint.test/client' },
      orphanDocumentsFolder: { driveId: 'drive-id', itemId: 'orphan-root', name: 'Unassigned', webUrl: 'https://sharepoint.test/unassigned' },
    };
    const existing = connector({
      id: 'sharepoint-connector',
      workspaceId: 'tenant-1',
      type: 'STORAGE',
      provider: 'SHAREPOINT',
      settings: { signedDocumentFiling: filingSettings, mailboxUserIds: ['old@example.com'] },
    });

    vi.mocked(prisma.connector.findFirst).mockResolvedValue(existing as never);
    vi.mocked(prisma.connector.update).mockResolvedValue(existing as never);
    vi.mocked(decrypt).mockReturnValue(JSON.stringify({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      tenantId: 'tenant-id',
      siteId: 'site-id',
    }));

    await updateConnector(
      'sharepoint-connector',
      { settings: { mailboxUserIds: ['new@example.com'] } },
      { tenantId: 'tenant-1', userId: 'user-1', isSuperAdmin: false }
    );

    expect(prisma.connector.update).toHaveBeenCalledWith({
      where: { id: 'sharepoint-connector' },
      data: {
        settings: {
          mailboxUserIds: ['new@example.com'],
          signedDocumentFiling: filingSettings,
        },
      },
    });
  });
});
