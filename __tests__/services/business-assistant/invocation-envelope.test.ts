import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  assertAssistantWorkspaceOperational: vi.fn(),
  registryGet: vi.fn(),
  registryList: vi.fn(() => []),
  messages: new Map<string, { id: string; conversationId: string; bodyHash: string; payload: Record<string, unknown> }>(),
  runs: [] as Array<Record<string, unknown>>,
  messageCreates: [] as Array<Record<string, unknown>>,
  conversations: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/generated/business-assistant-capability-registry', () => ({
  businessAssistantCapabilityRegistry: {
    get: mocks.registryGet,
    list: mocks.registryList,
  },
}));

vi.mock('@/services/business-assistant/policy.service', () => ({
  assertAssistantWorkspaceOperational: mocks.assertAssistantWorkspaceOperational,
  assertAssistantAdministrativeAccess: vi.fn(),
  assertAssistantReadAccess: vi.fn(),
  filterCapabilityDescriptors: vi.fn(() => []),
  normalizeResourceRefs: vi.fn((resources: unknown[]) => resources),
}));

const tx = vi.hoisted(() => ({
  businessAssistantMessage: {
    findFirst: vi.fn(async ({ where }: { where: { clientRequestId?: string; operationKind?: string } }) => {
      if (where.operationKind === 'TURN' && where.clientRequestId) return mocks.messages.get(where.clientRequestId) ?? null;
      return null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const id = `message-${mocks.messageCreates.length + 1}`;
      mocks.messageCreates.push(data);
      const record = {
        id,
        conversationId: String(data.conversationId),
        bodyHash: String(data.bodyHash),
        payload: data.payload as Record<string, unknown>,
      };
      mocks.messages.set(String(data.clientRequestId), record);
      return { id };
    }),
  },
  businessAssistantConversation: {
    findFirst: vi.fn(async () => ({ id: 'conversation-existing' })),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const id = `conversation-${mocks.conversations.length + 1}`;
      mocks.conversations.push({ id, ...data });
      return { id };
    }),
  },
  businessAssistantRun: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const id = `run-${mocks.runs.length + 1}`;
      mocks.runs.push({ id, ...data });
      return { id };
    }),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: tx }));
vi.mock('@/lib/prisma-transaction', () => ({ runSerializableTransaction: vi.fn(async (_prisma: unknown, handler: (value: typeof tx) => unknown) => handler(tx)) }));

import { acceptTurn, ConversationServiceError } from '@/services/business-assistant/conversation.service';

const actor = { tenantId: 'workspace-1', userId: 'user-1', requestId: 'request-1' };
const capability = {
  id: 'test.read',
  version: '1.0',
  contractVersion: '1',
  inputSchema: z.object({ query: z.string().trim().min(1), limit: z.number().int().positive().default(10) }).strict(),
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: 'client-1',
    message: 'Run the selected capability',
    resources: [],
    context: { capabilityId: 'test.read', capabilityVersion: '1.0' },
    ...overrides,
  };
}

describe('Business Assistant capability invocation envelope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messages.clear();
    mocks.runs.length = 0;
    mocks.messageCreates.length = 0;
    mocks.conversations.length = 0;
    process.env.BUSINESS_ASSISTANT_ENABLED = 'true';
    process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED = 'false';
    mocks.assertAssistantWorkspaceOperational.mockResolvedValue(undefined);
    mocks.registryGet.mockImplementation((id: string) => id === 'test.read' ? capability : undefined);
  });

  it('keeps an ordinary turn valid without capability input', async () => {
    mocks.registryGet.mockReturnValue(undefined);
    const accepted = await acceptTurn(actor, { clientRequestId: 'ordinary-1', message: 'Hello there', resources: [] });
    expect(accepted.runId).toBeNull();
    expect(mocks.messageCreates).toHaveLength(1);
  });

  it('keeps an explicitly selected capability backward compatible without capability input', async () => {
    const accepted = await acceptTurn(actor, request());
    expect(accepted.runId).toBe('run-1');
    expect(mocks.runs[0].input).toEqual({ message: 'Run the selected capability', context: { capabilityId: 'test.read', capabilityVersion: '1.0' } });
  });

  it('validates, normalizes, and persists explicit capability input as the run input', async () => {
    await acceptTurn(actor, request({ capabilityInput: { query: '  Acme  ' } }));
    expect(mocks.runs[0].input).toEqual({ limit: 10, query: 'Acme' });
  });

  it('rejects invalid capability input before persistence', async () => {
    await expect(acceptTurn(actor, request({ capabilityInput: { query: '' } }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mocks.runs).toHaveLength(0);
    expect(mocks.messageCreates).toHaveLength(0);
  });

  it('rejects capability input without an explicit capability id', async () => {
    await expect(acceptTurn(actor, {
      clientRequestId: 'client-no-capability',
      message: 'Do something',
      resources: [],
      capabilityInput: { query: 'Acme' },
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mocks.runs).toHaveLength(0);
  });

  it('rejects an unavailable explicitly selected capability', async () => {
    mocks.registryGet.mockReturnValue(undefined);
    await expect(acceptTurn(actor, request())).rejects.toMatchObject({ code: 'CAPABILITY_VERSION_UNAVAILABLE' });
  });

  it('replays the same request id with the same normalized capability input', async () => {
    const first = await acceptTurn(actor, request({ capabilityInput: { query: 'Acme' } }));
    const second = await acceptTurn(actor, request({ capabilityInput: { query: ' Acme ', limit: 10 } }));
    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({ duplicate: true, runId: first.runId, messageId: first.messageId, conversationId: first.conversationId });
    expect(mocks.runs).toHaveLength(1);
  });

  it('conflicts when the same request id is reused with different capability input', async () => {
    await acceptTurn(actor, request({ capabilityInput: { query: 'Acme' } }));
    await expect(acceptTurn(actor, request({ capabilityInput: { query: 'Beta' } }))).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
    expect(mocks.runs).toHaveLength(1);
  });

  it('keeps cross-workspace requests forbidden before persistence', async () => {
    await expect(acceptTurn(actor, request({ workspaceId: 'workspace-2', capabilityInput: { query: 'Acme' } }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.assertAssistantWorkspaceOperational).not.toHaveBeenCalled();
    expect(mocks.runs).toHaveLength(0);
  });

  it('uses the existing Business Assistant artifact bound for explicit capability input', async () => {
    const oversizedCapability = {
      ...capability,
      inputSchema: z.object({ payload: z.string() }).strict(),
    };
    mocks.registryGet.mockReturnValue(oversizedCapability);
    const oversized = 'x'.repeat(1_000_001);
    await expect(acceptTurn(actor, request({ capabilityInput: { payload: oversized } }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mocks.runs).toHaveLength(0);
  });

  it('surfaces invocation errors through the existing conversation service error boundary', async () => {
    try {
      await acceptTurn(actor, request({ capabilityInput: { query: '' } }));
      throw new Error('Expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ConversationServiceError);
    }
  });
});
